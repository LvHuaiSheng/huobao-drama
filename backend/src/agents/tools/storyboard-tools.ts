/**
 * 分镜拆解 Agent 工具
 * 模块级单例 — episodeId + dramaId 通过 RequestContext 按请求注入
 */
import { createTool } from '@mastra/core/tools'
import type { ToolExecutionContext } from '@mastra/core/tools'
import { z } from 'zod'
import { db, getInsertId, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { addSaved } from '../../services/agent-runs.js'
import { enforceCostumeConsistency } from '../../services/costume-channel.js'
import { parseScriptDurationSeconds, expectedStoryboardCount, SEGMENT_SECONDS } from '../../services/script-duration.js'
import { logTaskError, logTaskProgress, logTaskSuccess } from '../../utils/task-logger.js'
import { promptEnLimit, debugLog } from '../../services/video-prompts.js'
import { getDramaStylePrompt } from '../../services/style-preset.js'
import { getDramaId, getEpisodeId } from '../context.js'
import fs from 'node:fs'
import { voiceCardName, voiceMetaPath } from '../../services/voice.js'
import { refmodCardPath } from '../../services/refmod.js'
import { filterPromptAgentFields } from './prompt-agent-fields.js'

/**
 * 角色是否已抽好「声音卡」——决定 video_prompt 要不要写 <Audio 1>（2026-10-10 修）
 *
 * 事故背景：声音卡在生成时其实一直有下发（generation.ts 按 referenceAssetKeys 里的角色
 * 调 voiceCardsForCharacters），但喂给提示词 Agent 的上下文里**完全没有这个信息** →
 * Agent 永远写不出规则要求的 <Audio 1> 那行，还会在 overall_soundscape 里写死
 * "No human voice anywhere"。H3 于是拿到「这段没人声」+ 一个音色参考音频，
 * 没有台词可念，就把参考音频当素材自己发挥——听感就是「把参考音频念出来了」。
 * 全库 11 个英文提示词里 <Audio> 命中 0 次，即此因。
 */
function readVoiceCardInfo(id: number): { has_voice_card: boolean; voice_desc: string } {
  try {
    const name = voiceCardName(id)
    if (!fs.existsSync(refmodCardPath(name))) return { has_voice_card: false, voice_desc: '' }
    let desc = ''
    try {
      desc = String(JSON.parse(fs.readFileSync(voiceMetaPath(name), 'utf8'))?.desc || '')
    } catch { /* 元数据缺失不影响判定 */ }
    return { has_voice_card: true, voice_desc: desc }
  } catch {
    return { has_voice_card: false, voice_desc: '' }
  }
}

async function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  await db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))


  const uniqueIds = [...new Set(characterIds.filter(Boolean))]
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    await db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    })
  }
}

async function syncStoryboardProps(storyboardId: number, propIds: number[]) {
  await db.delete(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))

  const uniqueIds = [...new Set(propIds.filter(Boolean))]
  if (!uniqueIds.length) return

  for (const propId of uniqueIds) {
    await db.insert(schema.storyboardProps).values({
      storyboardId,
      propId,
    })
  }
}

async function getEpisodeSceneIds(episodeId: number) {
  const links = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  return new Set(links.map(link => link.sceneId))
}

async function getEpisodeCharacterIds(episodeId: number) {
  const links = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  return new Set(links.map(link => link.characterId))
}

async function getEpisodePropIds(episodeId: number) {
  const links = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  return new Set(links.map(link => link.propId))
}

async function validateStoryboardBindings(episodeId: number, dramaId: number, sceneId: number | null | undefined, characterIds: number[] | undefined, propIds?: number[] | undefined) {
  const episodeSceneIds = await getEpisodeSceneIds(episodeId)
  const episodeCharacterIds = await getEpisodeCharacterIds(episodeId)
  const episodePropIds = await getEpisodePropIds(episodeId)

  // 场景/角色/道具属于本剧但尚未关联到当前集时，自动补关联（拆分时即完成绑定）
  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId))
    if (!scene || scene.dramaId !== dramaId || scene.deletedAt) {
      throw new Error(`scene_id ${sceneId} 不属于当前项目`)
    }
    await db.insert(schema.episodeScenes).values({ episodeId, sceneId, createdAt: now() })
  }

  const uniqueCharacterIds = [...new Set((characterIds || []).filter(Boolean))]
  for (const characterId of uniqueCharacterIds) {
    if (episodeCharacterIds.has(characterId)) continue
    const [character] = await db.select().from(schema.characters).where(eq(schema.characters.id, characterId))
    if (!character || character.dramaId !== dramaId || character.deletedAt) {
      throw new Error(`character_id ${characterId} 不属于当前项目`)
    }
    await db.insert(schema.episodeCharacters).values({ episodeId, characterId, createdAt: now() })
  }
  // 🔴 拆分通道同样要守「剧本写明穿搭就只留穿那套的角色」（2026-10-16 加）：
  //   拆分按分镜里的人名绑角色，会把**基准角色**（原始穿搭）也挂回本集 —— 与提取通道共用同一处纠正实现。
  try {
    const fix = await enforceCostumeConsistency(episodeId, dramaId)
    if (fix.fixes.length) {
      logTaskProgress('StoryboardTool', 'costume-variant-auto-fixed', {
        episodeId, dramaId, declared: fix.declared,
        fixes: fix.fixes.map(f => `${f.dropped} → ${f.kept}`).join(','),
      })
    }
  } catch { /* 纠正失败不阻断拆分 */ }

  const uniquePropIds = [...new Set((propIds || []).filter(Boolean))]
  for (const propId of uniquePropIds) {
    if (episodePropIds.has(propId)) continue
    const [prop] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
    if (!prop || prop.dramaId !== dramaId || prop.deletedAt) {
      throw new Error(`prop_id ${propId} 不属于当前项目`)
    }
    await db.insert(schema.episodeProps).values({ episodeId, propId, createdAt: now() })
  }
}

type ToolContext = ToolExecutionContext | undefined

function requireIds(context: ToolContext): { episodeId: number; dramaId: number } | { error: string } {
  const episodeId = getEpisodeId(context?.requestContext)
  const dramaId = getDramaId(context?.requestContext)
  if (!episodeId || !dramaId) return { error: 'Missing episodeId/dramaId in request context' }
  return { episodeId, dramaId }
}

const readStoryboardContext = createTool({
  id: 'read_storyboard_context',
  description: 'Read the screenplay, characters, scenes, and props for storyboard breakdown.',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const [ep] = await db.select().from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
    if (!ep) return { error: 'Episode not found' }
    const script = ep.scriptContent || ep.content
    if (!script) return { error: 'Episode has no script' }

    const charLinks = await db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId))
    const sceneLinks = await db.select().from(schema.episodeScenes)
      .where(eq(schema.episodeScenes.episodeId, episodeId))
    const propLinks = await db.select().from(schema.episodeProps)
      .where(eq(schema.episodeProps.episodeId, episodeId))

    const linkedCharacterIds = new Set(charLinks.map(link => link.characterId))
    const linkedSceneIds = new Set(sceneLinks.map(link => link.sceneId))
    const linkedPropIds = new Set(propLinks.map(link => link.propId))

    const chars = await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, dramaId))
    const scns = await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, dramaId))
    const prps = await db.select().from(schema.props)
      .where(eq(schema.props.dramaId, dramaId))
    const existingStoryboards = await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episodeId))

    const characters = chars
      .filter(c => !c.deletedAt)
      .filter(c => !linkedCharacterIds.size || linkedCharacterIds.has(c.id))
      .map(c => ({
        id: c.id,
        name: c.name,
        role: c.role || '',
        description: c.description || '',
        appearance: c.appearance || '',
        styling: c.styling || '',
        image_url: c.imageUrl || '',
        reference_images: c.referenceImages || '',
        // 换装造型变体（2026-10-14）：costume_label 有值 = 该角色是 variant_of 指向的基准角色的一个造型
        costume_label: c.costumeLabel || '',
        variant_of: c.variantOf ?? null,
        // 🔴 有声音卡的角色 → video_prompt 必须写 <Audio 1> 绑定它（规则见 prompt_generator.md）
        ...readVoiceCardInfo(c.id),
      }))

    const scenes = scns
      .filter(s => !s.deletedAt)
      .filter(s => !linkedSceneIds.size || linkedSceneIds.has(s.id))
      .map(s => ({
        id: s.id,
        location: s.location,
        time: s.time,
        prompt: s.prompt || '',
        lighting: s.lighting || '',
        image_url: s.imageUrl || '',
        storyboard_count: s.storyboardCount || 0,
      }))

    const props = prps
      .filter(p => !p.deletedAt)
      .filter(p => !linkedPropIds.size || linkedPropIds.has(p.id))
      .map(p => ({
        id: p.id,
        name: p.name,
        type: p.type || '',
        description: p.description || '',
        image_url: p.imageUrl || '',
      }))

    const existingStoryboardPayload = await Promise.all(existingStoryboards
      .filter(sb => !sb.deletedAt)
      .map(async (sb) => {
        const links = await db.select().from(schema.storyboardCharacters)
          .where(eq(schema.storyboardCharacters.storyboardId, sb.id))
        const sbPropLinks = await db.select().from(schema.storyboardProps)
          .where(eq(schema.storyboardProps.storyboardId, sb.id))
        const sbCharIds = links.map(link => link.characterId)
        const sbPropIds = sbPropLinks.map(link => link.propId)
        // 参考图实际编号表（与前端 getShotReferenceAssetKeys 同序：场景 → 角色 id 升序 → 道具 id 升序）。
        // 2026-10-10 实测事故：sb148 的 0-5s 出现两个张建国 —— LLM 拿不到这个顺序，按「谁先出场」
        // 猜编号，把张建国写成 <Picture 2>（实际是林巧），编号错位 → 身份全乱。这里显式给出，
        // 规则同时要求 <Picture N> 必须照抄本表，不许按出场顺序推断。
        const refOrder: Array<{ picture: number; kind: string; id: number; name: string }> = []
        let picNo = 1
        if (sb.sceneId) {
          const sc = scns.find((s: any) => s.id === sb.sceneId)
          if (sc) refOrder.push({ picture: picNo++, kind: 'scene', id: sc.id, name: sc.location || '' })
        }
        for (const cid of [...sbCharIds].sort((a, b) => a - b)) {
          const ch = chars.find((c: any) => c.id === cid)
          if (ch) refOrder.push({ picture: picNo++, kind: 'character', id: ch.id, name: ch.name })
        }
        for (const pid of [...sbPropIds].sort((a, b) => a - b)) {
          const pr = prps.find((p: any) => p.id === pid)
          if (pr) refOrder.push({ picture: picNo++, kind: 'prop', id: pr.id, name: pr.name })
        }
        return {
          id: sb.id,
          shot_number: sb.storyboardNumber,
          title: sb.title || '',
          scene_id: sb.sceneId,
          character_ids: sbCharIds,
          prop_ids: sbPropIds,
          // 🔴 <Picture N> 的权威编号表 —— 写 video_prompt 时逐条照抄，禁止按出场顺序推断
          reference_order: refOrder,
          // 🔴 白名单加固（2026-10-13 实测：40 条里 9 条给「没被提取成道具资产」的东西编了
          //    <Subject N>，4 条还编了 <Picture N>）。把「只许用哪些编号 + 没参考图怎么办」
          //    写进模型每次生成都会读到的权威上下文，比散在长文规则里更靠前、更硬。
          reference_count: refOrder.length,
          reference_rule:
            `正文只许使用 <Picture 1>~<Picture ${refOrder.length}> 与对应的 <Subject 1>~<Subject ${refOrder.length}>；` +
            `编号大于 ${refOrder.length} 即编造（会错配 mod_N 卡 / 指向不存在的参考图）。` +
            '没有参考图的元素（抹布、餐具、手机架、食物等）一律用普通名词当画面元素描述，禁止编号、禁止写 <Subject N>/<Picture N>；' +
            '这条对中英两版都适用。',
          shot_type: sb.shotType || '',
          duration: sb.duration || 0,
          description: sb.description || '',
          atmosphere: sb.atmosphere || '',
          video_prompt: sb.videoPrompt || '',
          video_prompt_en: sb.videoPromptEn || '',
        }
      }))

    const payload = {
      episode: {
        id: ep.id,
        title: ep.title,
        episode_number: ep.episodeNumber,
        description: ep.description || '',
      },
      script,
      characters,
      scenes,
      props,
      existing_storyboards: existingStoryboardPayload,
    }
    logTaskSuccess('StoryboardTool', 'read-context', {
      episodeId,
      dramaId,
      characters: characters.length,
      scenes: scenes.length,
      props: props.length,
      existingStoryboards: payload.existing_storyboards.length,
      scriptLength: script.length,
    })
    return payload
  },
})

const storyboardFields = z.object({
  shot_number: z.number(),
  title: z.string().optional(),
  shot_type: z.string().optional(),
  angle: z.string().optional(),
  movement: z.string().optional(),
  location: z.string().optional(),
  time: z.string().optional(),
  description: z.string().optional(),
  result: z.string().optional(),
  atmosphere: z.string().optional(),
  image_prompt: z.string().optional(),
  // 🔴 拆分阶段不接受 video_prompt / video_prompt_en（2026-10-10 用户拍板）
  // 规则要求 storyboard_breaker 只拆镜头、不写视频提示词，但模型曾在第 1 条违规填入
  // 半成品提示词（不符合 prompt_generator 的规则，长度也只有正规产出的六成）。
  // 这里从 schema 层堵死：模型即使回传这两个字段也会被 zod 剥掉，不会落库。
  bgm_prompt: z.string().optional(),
  sound_effect: z.string().optional(),
  duration: z.number().optional(),
  scene_id: z.number().nullable().optional(),
  character_ids: z.array(z.number()).optional(),
  prop_ids: z.array(z.number()).optional(),
})

const saveStoryboards = createTool({
  id: 'save_storyboards',
  description: 'Save storyboards for this episode. Call in batches of at most 8 storyboards: the first batch must set replace_existing: true (clears all old storyboards for the episode, then writes), every following batch omits replace_existing (appends). Rows are upserted by shot_number, so overlapping batches and retries never create duplicates.',
  inputSchema: z.object({
    replace_existing: z.boolean().optional(),
    storyboards: z.array(storyboardFields),
  }),
  execute: async ({ storyboards, replace_existing }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    logTaskProgress('StoryboardTool', 'save-begin', {
      episodeId,
      dramaId,
      replaceExisting: replace_existing === true,
      count: storyboards.length,
      shotNumbers: storyboards.map(sb => sb.shot_number).join(','),
    })
    if (replace_existing === true) {
      const existingStoryboardRows = await db.select().from(schema.storyboards)
        .where(eq(schema.storyboards.episodeId, episodeId))
      for (const storyboardId of existingStoryboardRows.map(sb => sb.id)) {
        await db.delete(schema.storyboardCharacters)
          .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
        await db.delete(schema.storyboardProps)
          .where(eq(schema.storyboardProps.storyboardId, storyboardId))
      }
      await db.delete(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
    }

    // shot_number → id 索引（含本次调用内新增的行），保证按分镜号幂等 upsert
    const existingRows = await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episodeId))
    const shotToId = new Map<number, number>(
      existingRows.filter(sb => !sb.deletedAt).map(sb => [sb.storyboardNumber, sb.id]),
    )

    for (const sb of storyboards) {
      await validateStoryboardBindings(episodeId, dramaId, sb.scene_id, sb.character_ids, sb.prop_ids)
      const existingId = shotToId.get(sb.shot_number)
      if (existingId !== undefined) {
        await db.update(schema.storyboards).set({
          title: sb.title, shotType: sb.shot_type,
          angle: sb.angle, movement: sb.movement,
          location: sb.location, time: sb.time,
          description: sb.description, result: sb.result,
          atmosphere: sb.atmosphere, imagePrompt: sb.image_prompt,
          // 拆分阶段不动 video_prompt（保留既有值，提示词由 prompt_generator 单独生成）
          bgmPrompt: sb.bgm_prompt,
          soundEffect: sb.sound_effect,
          sceneId: sb.scene_id, duration: sb.duration || 10,
          updatedAt: ts,
        }).where(eq(schema.storyboards.id, existingId))
        await syncStoryboardCharacters(existingId, sb.character_ids || [])
        await syncStoryboardProps(existingId, sb.prop_ids || [])
      } else {
        const res = await db.insert(schema.storyboards).values({
          episodeId,
          storyboardNumber: sb.shot_number,
          title: sb.title, shotType: sb.shot_type,
          angle: sb.angle, movement: sb.movement,
          location: sb.location, time: sb.time,
          description: sb.description, result: sb.result,
          atmosphere: sb.atmosphere, imagePrompt: sb.image_prompt,
          // 拆分阶段不写 video_prompt（留空，由 prompt_generator 批量补齐）
          bgmPrompt: sb.bgm_prompt,
          soundEffect: sb.sound_effect,
          sceneId: sb.scene_id, duration: sb.duration || 10,
          createdAt: ts, updatedAt: ts,
        })
        const newId = getInsertId(res)
        shotToId.set(sb.shot_number, newId)
        await syncStoryboardCharacters(newId, sb.character_ids || [])
        await syncStoryboardProps(newId, sb.prop_ids || [])
      }
    }

    // 整集时长 = 当前全部存活分镜时长之和（分批保存时不能再按单批累加）
    const allRows = await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episodeId))
    const totalDuration = allRows
      .filter(sb => !sb.deletedAt)
      .reduce((sum, sb) => sum + (sb.duration || 0), 0)

    await db.update(schema.episodes)
      .set({ duration: Math.ceil(totalDuration / 60), updatedAt: ts })
      .where(eq(schema.episodes.id, episodeId))

    logTaskSuccess('StoryboardTool', 'save-complete', {
      episodeId,
      count: storyboards.length,
      totalDuration,
    })
    // 2026-10-16：给「拆分镜头」的进度显示累加条数（前端切页回来也能看到已经写了多少条）
    addSaved(episodeId, storyboards.length)

    // 2026-10-16（用户报「拆分没按原始时长」）：剧本片头写着目标时长，分镜合计必须对得上。
    //   实测第 1~12 集每集都短 40~96 秒（拆完只有 48~113 秒，声明 130~160 秒）——
    //   原因是拆分只数了剧本里的镜头块，从没读片头那个时长。这里把「还差多少」直接回给 Agent，
    //   没写到目标之前它自己会继续补（工具反馈比提示词长文有效）。
    const [epRow] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
    const declared = parseScriptDurationSeconds(epRow?.content || '')
    const target = expectedStoryboardCount(declared)
    const savedRows = await db.select({ id: schema.storyboards.id, duration: schema.storyboards.duration })
      .from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
    const savedTotal = savedRows.length
    const savedSeconds = savedRows.reduce((sum, r: any) => sum + Number(r.duration || 0), 0)
    let durationNote = ''
    if (declared) {
      const gap = declared - savedSeconds
      durationNote = gap > 0
        ? `\n⚠️ **时长还没写够**：剧本片头声明 ${declared} 秒（${Math.floor(declared / 60)} 分 ${declared % 60} 秒），`
          + `目前 ${savedTotal} 条 / 合计 ${savedSeconds} 秒 ⇒ **还差 ${gap} 秒**（约 ${Math.ceil(gap / SEGMENT_SECONDS)} 条 ${SEGMENT_SECONDS} 秒的分镜）。`
          + `\n**必须继续调用本工具把剩余内容补完再结束**（每条 ${SEGMENT_SECONDS} 秒、最后一条可不足 ${SEGMENT_SECONDS} 秒；`
          + `目标 ${target} 条、合计正好 ${declared} 秒）。剧情没那么多内容时，就把动作/反应/环境铺开写足时长，不要压缩总长。`
        : `\n时长核对：剧本声明 ${declared} 秒，目前 ${savedTotal} 条 / 合计 ${savedSeconds} 秒 ✓（已达标）。`
    }
    return { message: `Saved ${storyboards.length} storyboards（本集累计 ${savedTotal} 条 / ${savedSeconds} 秒）${durationNote}`, count: storyboards.length, total_duration: totalDuration, episode_total_count: savedTotal, episode_total_seconds: savedSeconds, script_declared_seconds: declared }
  },
})

const updateStoryboard = createTool({
  id: 'update_storyboard',
  description: 'Update a specific storyboard shot.',
  inputSchema: z.object({
    storyboard_id: z.number(),
    title: z.string().optional(),
    shot_type: z.string().optional(),
    angle: z.string().optional(),
    movement: z.string().optional(),
    location: z.string().optional(),
    time: z.string().optional(),
    result: z.string().optional(),
    atmosphere: z.string().optional(),
    image_prompt: z.string().optional(),
    video_prompt: z.string().optional(),
    video_prompt_en: z.string().optional(),
    bgm_prompt: z.string().optional(),
    sound_effect: z.string().optional(),
    description: z.string().optional(),
    scene_id: z.number().nullable().optional(),
    character_ids: z.array(z.number()).optional(),
    prop_ids: z.array(z.number()).optional(),
    duration: z.number().optional(),
  }),
  execute: async ({ storyboard_id, ...fields }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const [storyboard] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard_id))
    if (!storyboard) return { error: `Storyboard ${storyboard_id} not found` }

    // 过滤模型回传的垃圾值：视频提示词 Agent 常把整行字段回传，
    // 拿不准的字符串字段写成 "null"/"undefined"，直接覆盖会毁掉已有内容
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      const v = fields[key]
      if (typeof v === 'string' && (v === 'null' || v === 'undefined' || v === 'NULL' || v === 'Null')) {
        delete fields[key]
      }
    }

    // 🔴 2026-10-10 长度硬闸门：video_prompt_en 超上限一律拒绝写入。
    // 为什么拦在这里：单条「生成提示词」按钮走 POST /agent/prompt_generator/chat（裸 Agent），
    // 不经过 services/video-prompts.ts 的分段治理 —— 实测 Agent 写到 7746 字符仍以为没问题，
    // 拼上后端风格头就是 8337 > H3 的 7000 上限，视频根本发不出去。
    // 工具层是唯一能覆盖所有写入路径的位置（批量接口 / 单条聊天 / 人工）。
    // 2026-10-16（4.0.38）：**风格头不再拼进视频提示词** ⇒ 上限不再扣风格头（6988 = 7000 − 12 余量）。
    // 历史上的动态算法（扣 768 + 32）已废止 —— 它正是「差 8 字整条作废」的元凶。
    if ('video_prompt_en' in fields) {
      const en = String(fields.video_prompt_en || '')
      const styleHeadLen = (await getDramaStylePrompt(dramaId)).length
      const limit = promptEnLimit(styleHeadLen)
      if (en.trim() && en.length > limit) {
        logTaskError('StoryboardTool', 'video-prompt-en-too-long', {
          episodeId, storyboardId: storyboard_id, len: en.length, limit, style_head_len: styleHeadLen,
        })
        // 记下被拒的原文长度与前 200 字符：这是唯一能看到「Agent 到底写了多长、
        // 有没有在改善」的地方（单条按钮走裸 Agent，没有其它日志）
        debugLog(episodeId, storyboard_id, 'gate-reject', en, { over: en.length - limit, styleHeadLen })
        return {
          error:
            `video_prompt_en 超长，已拒绝写入：当前 ${en.length} 字符，上限 ${limit} 字符。` +
            `MiniMax H3 的 prompt 上限是 7000 字符（官方 hard limit、不可放宽），本项目发送时**不再拼风格头**（画风由正文承载），` +
            `所以正文必须 ≤ ${limit}（仅扣 12 字余量）。请按 video-prompt 技能「英文发送版」节的逐段配额压缩后重新调用本工具：` +
            `subject_definitions ≤1000（每主体 ≤250） / summary ≤340 / retention_analysis ≤760 / ` +
            `detailed_description ≤2500 / overall_soundscape ≤300 / non_diegetic_music ≤120（合计 5020，余量刻意留给模型 10~30% 的超配）。` +
            `不许为了压长度而砍 <d> 台词、retention_analysis 的 fully_preserved、<Picture N> 的 with 外观。`,
        }
      }
    }

    logTaskProgress('StoryboardTool', 'update-begin', {
      episodeId,
      storyboardId: storyboard_id,
      fields: Object.keys(fields),
    })

    const currentCharacterIds = 'character_ids' in fields
      ? fields.character_ids
      : (await db.select().from(schema.storyboardCharacters)
          .where(eq(schema.storyboardCharacters.storyboardId, storyboard_id)))
          .map(link => link.characterId)

    const currentPropIds = 'prop_ids' in fields
      ? fields.prop_ids
      : (await db.select().from(schema.storyboardProps)
          .where(eq(schema.storyboardProps.storyboardId, storyboard_id)))
          .map(link => link.propId)

    await validateStoryboardBindings(
      episodeId,
      dramaId,
      'scene_id' in fields ? fields.scene_id : storyboard.sceneId,
      currentCharacterIds,
      currentPropIds,
    )

    const updates: Record<string, any> = { updatedAt: now() }
    if ('title' in fields) updates.title = fields.title
    if ('shot_type' in fields) updates.shotType = fields.shot_type
    if ('angle' in fields) updates.angle = fields.angle
    if ('movement' in fields) updates.movement = fields.movement
    if ('location' in fields) updates.location = fields.location
    if ('time' in fields) updates.time = fields.time
    if ('result' in fields) updates.result = fields.result
    if ('atmosphere' in fields) updates.atmosphere = fields.atmosphere
    if ('image_prompt' in fields) updates.imagePrompt = fields.image_prompt
    if ('video_prompt' in fields) updates.videoPrompt = fields.video_prompt
    if ('video_prompt_en' in fields) updates.videoPromptEn = fields.video_prompt_en
    if ('bgm_prompt' in fields) updates.bgmPrompt = fields.bgm_prompt
    if ('sound_effect' in fields) updates.soundEffect = fields.sound_effect
    if ('description' in fields) updates.description = fields.description
    if ('scene_id' in fields) updates.sceneId = fields.scene_id
    if ('duration' in fields) updates.duration = fields.duration
    await db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, storyboard_id))
    if ('character_ids' in fields) await syncStoryboardCharacters(storyboard_id, fields.character_ids || [])
    if ('prop_ids' in fields) await syncStoryboardProps(storyboard_id, fields.prop_ids || [])
    logTaskSuccess('StoryboardTool', 'update-complete', {
      episodeId,
      storyboardId: storyboard_id,
      updatedFields: Object.keys(updates),
      characterIds: 'character_ids' in fields ? (fields.character_ids || []).join(',') : undefined,
      propIds: 'prop_ids' in fields ? (fields.prop_ids || []).join(',') : undefined,
    })
    return { message: `Storyboard ${storyboard_id} updated` }
  },
})

/**
 * 视频提示词 Agent 专用版 update_storyboard（2026-10-14 修「分镜画面描述改完又变回去」）
 *
 * 为什么必须机械拦：prompt_generator 的指令（prompts/prompt_generator.md 第 3 条 + video-prompt 技能）
 * 明写「只传 storyboard_id + video_prompt + video_prompt_en，其他字段一律不传」，
 * 但实测模型照旧整行回传 —— 2026-10-14 18:58:06 日志实锤：
 *   [StoryboardTool] update-begin ... fields=["title","shot_type",...,"description",...]
 * 而 Agent 读到的上下文是**生成开始时**的快照（一次生成要跑 50 秒以上），
 * 用户在生成过程中手改的「画面描述」就被这份旧快照覆盖回去 —— 用户看到的症状正是「改完又变回去」。
 * 同族问题（模型不自律）已多次出现，所以在工具层做白名单：白名单外的键直接丢弃并留痕。
 */
const updateStoryboardPromptOnly = {
  ...updateStoryboard,
  execute: async (input: any, context: any) => {
    const { filtered, dropped } = filterPromptAgentFields(input)
    if (dropped.length) {
      logTaskProgress('StoryboardTool', 'prompt-agent-fields-dropped', {
        storyboardId: input?.storyboard_id,
        dropped: dropped.join(','),
      })
    }
    return (updateStoryboard.execute as any)(filtered, context)
  },
}

export const storyboardTools = { readStoryboardContext, saveStoryboards, updateStoryboard, updateStoryboardPromptOnly }
