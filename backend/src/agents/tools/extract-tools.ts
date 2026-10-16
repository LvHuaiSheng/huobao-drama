/**
 * 角色/场景提取 Agent 工具
 * 模块级单例 — episodeId + dramaId 通过 RequestContext 按请求注入
 *
 * 单 Agent 一步流程：
 * 1. 读取剧本内容
 * 2. 读取项目中已存在的角色/场景（用于去重）
 * 3. 提取角色/场景并智能去重后直接保存
 */
import { createTool } from '@mastra/core/tools'
import type { ToolExecutionContext } from '@mastra/core/tools'
import { z } from 'zod'
import { db, getInsertId, schema } from '../../db/index.js'
import { assetColourGaps, WHAT_ZH } from '../../services/asset-colour-gate.js'
import { eq, and } from 'drizzle-orm'

/**
 * 合并策略（2026-10-14 用户拍板 A）：**用户维护过的非空文本不被提取结果覆盖**，
 * 提取只在字段为空时补。
 *
 * 实测事故：用户改完妆造（换了衣服颜色）→ 跑了「角色提取」→ 提取按剧本推断的外观把妆造顶回去
 * → 随后「重新拆分」出来的 8 条分镜描述逐字抄资产妆造，颜色还是旧的（分镜描述抄的是资产，不是剧本）。
 *
 * 返回 { value, kept }：kept=true 表示本次「保留了已有值、丢弃了提取结果」，用于留痕。
 */
export function mergeCuratedField(
  existing?: string | null,
  extracted?: string | null,
): { value: string; kept: boolean } {
  const cur = (existing || '').trim()
  if (cur) return { value: existing as string, kept: !!(extracted || '').trim() }
  return { value: (extracted || '').trim(), kept: false }
}
import { now } from '../../utils/response.js'
import { logTaskProgress, logTaskSuccess } from '../../utils/task-logger.js'
import { getDramaId, getEpisodeId } from '../context.js'

// ─── 关联辅助 ────────────────────────────────────────────────
async function linkCharToEpisode(episodeId: number, characterId: number) {
  const ts = now()
  const existing = await db.select().from(schema.episodeCharacters)
    .where(and(eq(schema.episodeCharacters.episodeId, episodeId), eq(schema.episodeCharacters.characterId, characterId)))

  if (!existing.length) {
    await db.insert(schema.episodeCharacters).values({ episodeId, characterId, createdAt: ts })
  }
}

async function linkSceneToEpisode(episodeId: number, sceneId: number) {
  const ts = now()
  const existing = await db.select().from(schema.episodeScenes)
    .where(and(eq(schema.episodeScenes.episodeId, episodeId), eq(schema.episodeScenes.sceneId, sceneId)))

  if (!existing.length) {
    await db.insert(schema.episodeScenes).values({ episodeId, sceneId, createdAt: ts })
  }
}

async function linkPropToEpisode(episodeId: number, propId: number) {
  const ts = now()
  const existing = await db.select().from(schema.episodeProps)
    .where(and(eq(schema.episodeProps.episodeId, episodeId), eq(schema.episodeProps.propId, propId)))

  if (!existing.length) {
    await db.insert(schema.episodeProps).values({ episodeId, propId, createdAt: ts })
  }
}

// ─── 名字归一化（近名去重） ───────────────────────────────────
// 提取时同一角色/道具可能出现不同书写形式（如「林小雨」与「林小雨（主角）」、
// 「林小雨(女主)」、「林小雨 」）。归一化后做精确比较，命中即复用已有，不重复创建。
function normalizeName(name: string): string {
  return (name || '')
    .replace(/[（(][^（()）]*[）)]/g, '') // 去掉成对的中/英文括号内容（角色定位/别名）
    .replace(/[（(].*$/, '')              // 兜底：未闭合括号从首个括号截断
    .replace(/[\s　]+/g, '')          // 去空白与全角空格
    .toLowerCase()
    .trim()
}

// 场景地点只做空白归一化（不删括号：如「火车站（候车厅）」与「火车站（站台）」是不同场景）
function normalizeLocation(loc: string): string {
  return (loc || '').replace(/[\s　]+/g, '').toLowerCase().trim()
}

type ToolContext = ToolExecutionContext | undefined

function requireIds(context: ToolContext): { episodeId: number; dramaId: number } | { error: string } {
  const episodeId = getEpisodeId(context?.requestContext)
  const dramaId = getDramaId(context?.requestContext)
  if (!episodeId || !dramaId) return { error: 'Missing episodeId/dramaId in request context' }
  return { episodeId, dramaId }
}

// 1. 读取剧本内容
const readScriptForExtraction = createTool({
  id: 'read_script_for_extraction',
  description: 'Read the formatted screenplay for character/scene extraction.',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const [ep] = await db.select().from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
    if (!ep) return { error: 'Episode not found' }
    const content = ep.scriptContent || ep.content
    if (!content) return { error: 'Episode has no script content' }
    logTaskSuccess('ExtractTool', 'read-script', { episodeId, dramaId, scriptLength: content.length })
    return { script: content }
  },
})

// 2. 读取项目中已存在的角色（用于去重判断）
const readExistingCharacters = createTool({
  id: 'read_existing_characters',
  description: 'Read all characters already existing in this drama project (for deduplication).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.characterId))
    const chars = (await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, dramaId)))
      .filter(c => !c.deletedAt)
    const visibleChars = chars.map(c => ({
      id: c.id,
      name: c.name,
      role: c.role || '',
      appearance: c.appearance || '',
      styling: c.styling || '',
      normalized_name: normalizeName(c.name), // 用于判断近名复用：括号定位/别名视为同名
      // 换装造型变体：costume_label 有值 = 这是某个基准角色的一个造型（variant_of = 基准角色 id）
      costume_label: c.costumeLabel || '',
      variant_of: c.variantOf ?? null,
    }))
    const payload = {
      count: visibleChars.length,
      characters: visibleChars,
      current_episode_characters: visibleChars.filter(c => linkedIds.has(c.id)),
    }
    logTaskSuccess('ExtractTool', 'read-characters', {
      episodeId,
      dramaId,
      projectCharacters: payload.count,
      episodeCharacters: payload.current_episode_characters.length,
    })
    return payload
  },
})

// 3. 读取项目中已存在的场景（用于去重判断）
const readExistingScenes = createTool({
  id: 'read_existing_scenes',
  description: 'Read all scenes already existing in this drama project (for deduplication).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeScenes)
      .where(eq(schema.episodeScenes.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.sceneId))
    const scenes = (await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, dramaId)))
      .filter(s => !s.deletedAt)
    const visibleScenes = scenes.map(s => ({
      id: s.id,
      location: s.location,
      time: s.time || '',
      prompt: s.prompt || '',
      lighting: s.lighting || '',
      normalized_location: normalizeLocation(s.location), // 用于判断近名复用（仅空白/大小写）
    }))
    const payload = {
      count: visibleScenes.length,
      scenes: visibleScenes,
      current_episode_scenes: visibleScenes.filter(s => linkedIds.has(s.id)),
    }
    logTaskSuccess('ExtractTool', 'read-scenes', {
      episodeId,
      dramaId,
      projectScenes: payload.count,
      episodeScenes: payload.current_episode_scenes.length,
    })
    return payload
  },
})

// 4. 智能保存角色（按名字去重，与现有数据合并）
const saveDedupCharacters = createTool({
  id: 'save_dedup_characters',
  description: 'Save extracted characters with deduplication. Existing characters (same name) are merged/updated; new ones are created. All are linked to the current episode.',
  inputSchema: z.object({
    characters: z.array(z.object({
      name: z.string(),
      role: z.string().optional(),
      description: z.string().optional(),
      appearance: z.string().optional(),
      styling: z.string().optional(),
      /** 换装造型变体：填「基准角色的名字」→ 本次按变体保存（appearance 强制照抄基准角色，脸不变） */
      costume_variant_of: z.string().optional(),
      /** 造型名（如「正装」「晚礼服」「工装」），与 costume_variant_of 同时给 */
      costume_label: z.string().optional(),
    })),
  }),
  execute: async ({ characters }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, merged: 0, variants: 0 }
    // 🔴 新卡写入前必须写全「发色 / 服装颜色」（2026-10-16 加，实测：技能里 10-15 就写了这条规则，
    //   模型对**背景龙套/群像**照样跳过 —— 宾客丙这张卡当天新建、`styling` 只有「发型短而整齐」没有发色，
    //   而卡面是后面所有分镜提示词唯一的颜色来源 ⇒ 成片只能靠猜。工具层的反馈比技能里的长文有效得多，
    //   所以缺色的**不写库**、把缺什么直接回给模型让它补齐重存（不是让它自己去看技能）。
    const deficient: string[] = []
    logTaskProgress('ExtractTool', 'save-characters-begin', {
      episodeId,
      dramaId,
      names: characters.map(char => char.name).join(','),
    })

    for (const char of characters) {
      const charsInProject = (await db.select().from(schema.characters)
        .where(eq(schema.characters.dramaId, dramaId)))
        .filter(c => !c.deletedAt)
      const exact = charsInProject.find(c => c.name === char.name)
      const normName = normalizeName(char.name)
      const existing = exact || (normName ? charsInProject.find(c => c.name && normalizeName(c.name) === normName) : undefined)
      const matchedViaNorm = !!existing && existing !== exact

      // 换装造型变体（2026-10-14）：找到「基准角色」→ 脸的文字描述（appearance）一律照抄它，
      // 只让 styling 用新造型 → 从数据层保证同一人的多个造型不会各写一套脸。
      const variantOfName = String(char.costume_variant_of || '').trim()
      let baseChar: typeof charsInProject[number] | undefined
      if (variantOfName) {
        const baseNorm = normalizeName(variantOfName)
        baseChar = charsInProject.find(c => c.name === variantOfName)
          || charsInProject.find(c => c.name && normalizeName(c.name) === baseNorm)
        if (!baseChar) {
          logTaskProgress('ExtractTool', 'costume-base-missing', { episodeId, dramaId, variant: char.name, base: variantOfName })
        }
      }
      const costumeLabel = String(char.costume_label || '').trim() || (variantOfName ? char.name.split('·').pop() || '' : '')
      const isVariant = !!baseChar

      if (existing) {
        // 归一化命中：括号定位/别名等近名视作同一角色复用，避免重复创建
        if (matchedViaNorm) logTaskProgress('ExtractTool', 'save-characters-reuse', { episodeId, dramaId, extracted: char.name, reused: existing.name })
        // 已存在：合并信息，保留 ID；**用户维护过的非空文本不覆盖**（见 mergeCuratedField）
        const appearance = mergeCuratedField(existing.appearance, char.appearance)
        const styling = mergeCuratedField(existing.styling, char.styling || char.description)
        const description = mergeCuratedField(existing.description, char.description)
        const keptFields = [appearance.kept && 'appearance', styling.kept && 'styling', description.kept && 'description'].filter(Boolean)
        if (keptFields.length) {
          logTaskProgress('ExtractTool', 'save-characters-keep-curated', {
            episodeId, dramaId, name: existing.name, kept: keptFields.join(','),
          })
        }
        await db.update(schema.characters).set({
          role: char.role || existing.role,
          description: description.value,
          // 🔴 变体的 appearance 一律照抄基准角色（覆盖上面的合并结果）
          appearance: isVariant ? (baseChar!.appearance || '') : appearance.value,
          styling: styling.value,
          ...(isVariant ? { variantOf: baseChar!.id, costumeLabel } : {}),
          updatedAt: ts,
        }).where(eq(schema.characters.id, existing.id))
        await linkCharToEpisode(episodeId, existing.id)
        if (isVariant) results.variants++
        results.merged++
      } else {
        // 新增角色 —— 缺发色/服装色的先不写，回给模型补齐（变体只查 styling：脸照抄基准角色）
        const gaps = assetColourGaps(isVariant ? (char.styling || '') : `${char.appearance || ''} ${char.styling || char.description || ''}`)
        if (gaps.length) {
          deficient.push(`${char.name}（缺${gaps.map(w => WHAT_ZH[w]).join('、')}）`)
          logTaskProgress('ExtractTool', 'save-characters-reject-colourless', {
            episodeId, dramaId, name: char.name, missing: gaps.join(','),
          })
          continue
        }
        const res = await db.insert(schema.characters).values({
          name: char.name,
          role: char.role || '',
          description: char.description || baseChar?.description || '',
          appearance: isVariant ? (baseChar!.appearance || '') : (char.appearance || ''),
          styling: char.styling || char.description || '',
          dramaId,
          ...(isVariant ? { variantOf: baseChar!.id, costumeLabel } : {}),
          createdAt: ts,
          updatedAt: ts,
        })
        const charId = getInsertId(res)
        await linkCharToEpisode(episodeId, charId)
        if (isVariant) results.variants++
        results.created++
      }
    }

    const payload = {
      message: deficient.length
        ? `角色保存完成：新增 ${results.created}，合并更新 ${results.merged}（其中换装造型变体 ${results.variants}）。`
          + `\n⚠️ 以下角色**没有写全颜色、已被拒绝入库**：${deficient.join('；')}。`
          + `\n请**立即**补齐后连同本条一起再调用一次 save_dedup_characters（其余已保存的角色不要重复提交）：`
          + `\n- 发色写死一个具体值（背景/龙套/群像同样要写，普通人写「纯黑色短发」这种最普通的即可，年长者可写「花白」）；`
          + `\n- 服装写清主色（上衣/裤/鞋各是什么颜色），配饰给颜色或材质；`
          + `\n- 不许出现「或 / 皆可 / 任选」这类二选一。`
        : `角色保存完成：新增 ${results.created}，合并更新 ${results.merged}（其中换装造型变体 ${results.variants}）`,
      ...results,
      ...(deficient.length ? { rejected: deficient } : {}),
    }
    logTaskSuccess('ExtractTool', 'save-characters-complete', { episodeId, ...results })
    return payload
  },
})

// 5. 智能保存场景（按地点+时间段去重，与现有数据合并）
const saveDedupScenes = createTool({
  id: 'save_dedup_scenes',
  description: 'Save extracted scenes with deduplication. Existing scenes (same location+time) are reused; new ones are created. All are linked to the current episode.',
  inputSchema: z.object({
    scenes: z.array(z.object({
      location: z.string(),
      time: z.string().optional(),
      prompt: z.string().optional(),
      description: z.string().optional(),
      lighting: z.string().optional(),
    })),
  }),
  execute: async ({ scenes }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, reused: 0 }
    logTaskProgress('ExtractTool', 'save-scenes-begin', {
      episodeId,
      dramaId,
      scenes: scenes.map(scene => `${scene.location}@${scene.time || ''}`).join(','),
    })

    for (const scene of scenes) {
      // 按地点+时间段精确匹配；地点仅做空白/大小写归一化（不删括号，避免误合并）
      const scenesInProject = (await db.select().from(schema.scenes)
        .where(eq(schema.scenes.dramaId, dramaId)))
        .filter(s => !s.deletedAt)
      const normLocation = normalizeLocation(scene.location)
      // 同地点即复用（2026-10-10 用户拍板：不再按时段拆成多条场景；时段差异交给分镜提示词）
      const existing = scenesInProject.find(s => s.location === scene.location)
        || (normLocation ? scenesInProject.find(s => normalizeLocation(s.location) === normLocation) : undefined)

      if (existing) {
        // 已存在完全匹配的场景：关联并补齐描述/光影；**用户维护过的非空文本不覆盖**
        const scPrompt = mergeCuratedField(existing.prompt, scene.prompt || scene.description)
        const scLighting = mergeCuratedField(existing.lighting, scene.lighting)
        const scKept = [scPrompt.kept && 'prompt', scLighting.kept && 'lighting'].filter(Boolean)
        if (scKept.length) {
          logTaskProgress('ExtractTool', 'save-scenes-keep-curated', {
            episodeId, dramaId, location: existing.location, kept: scKept.join(','),
          })
        }
        await db.update(schema.scenes).set({
          prompt: scPrompt.value,
          lighting: scLighting.value,
          // time 不覆盖：保留首次登记的时段（仅作参考，不参与去重）
          updatedAt: ts,
        }).where(eq(schema.scenes.id, existing.id))
        await linkSceneToEpisode(episodeId, existing.id)
        results.reused++
      } else {
        const res = await db.insert(schema.scenes).values({
          dramaId,
          location: scene.location,
          time: scene.time || '',
          prompt: scene.prompt || scene.description || scene.location,
          lighting: scene.lighting || '',
          createdAt: ts,
          updatedAt: ts,
        })
        const sceneId = getInsertId(res)
        await linkSceneToEpisode(episodeId, sceneId)
        results.created++
      }
    }

    const payload = {
      message: `场景保存完成：新增 ${results.created}，复用已有 ${results.reused}`,
      ...results,
    }
    logTaskSuccess('ExtractTool', 'save-scenes-complete', { episodeId, ...results })
    return payload
  },
})

// 6. 读取项目中已存在的道具（用于去重判断）
const readExistingProps = createTool({
  id: 'read_existing_props',
  description: 'Read all props already existing in this drama project (for deduplication).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeProps)
      .where(eq(schema.episodeProps.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.propId))
    const props = (await db.select().from(schema.props)
      .where(eq(schema.props.dramaId, dramaId)))
      .filter(p => !p.deletedAt)
    const visibleProps = props.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type || '',
      description: p.description || '',
      normalized_name: normalizeName(p.name), // 用于判断近名复用：括号定位/别名视为同名
    }))
    const payload = {
      count: visibleProps.length,
      props: visibleProps,
      current_episode_props: visibleProps.filter(p => linkedIds.has(p.id)),
    }
    logTaskSuccess('ExtractTool', 'read-props', {
      episodeId,
      dramaId,
      projectProps: payload.count,
      episodeProps: payload.current_episode_props.length,
    })
    return payload
  },
})

// 7. 智能保存道具（按名字去重，与现有数据合并）
const saveDedupProps = createTool({
  id: 'save_dedup_props',
  description: 'Save extracted props with deduplication. Existing props (same name) are merged/updated; new ones are created. All are linked to the current episode.',
  inputSchema: z.object({
    props: z.array(z.object({
      name: z.string(),
      type: z.string().optional(),
      description: z.string().optional(),
    })),
  }),
  execute: async ({ props }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, merged: 0 }
    logTaskProgress('ExtractTool', 'save-props-begin', {
      episodeId,
      dramaId,
      names: props.map(prop => prop.name).join(','),
    })

    for (const prop of props) {
      const propsInProject = (await db.select().from(schema.props)
        .where(eq(schema.props.dramaId, dramaId)))
        .filter(p => !p.deletedAt)
      const exact = propsInProject.find(p => p.name === prop.name)
      const normName = normalizeName(prop.name)
      const existing = exact || (normName ? propsInProject.find(p => p.name && normalizeName(p.name) === normName) : undefined)
      const matchedViaNorm = !!existing && existing !== exact

      if (existing) {
        // 归一化命中：括号定位/别名等近名视作同一道具复用
        if (matchedViaNorm) logTaskProgress('ExtractTool', 'save-props-reuse', { episodeId, dramaId, extracted: prop.name, reused: existing.name })
        // 已存在：合并信息，保留 ID；**用户维护过的非空文本不覆盖**（见 mergeCuratedField）
        const propType = mergeCuratedField(existing.type, prop.type)
        const propDesc = mergeCuratedField(existing.description, prop.description)
        const pKept = [propType.kept && 'type', propDesc.kept && 'description'].filter(Boolean)
        if (pKept.length) {
          logTaskProgress('ExtractTool', 'save-props-keep-curated', {
            episodeId, dramaId, name: existing.name, kept: pKept.join(','),
          })
        }
        await db.update(schema.props).set({
          type: propType.value,
          description: propDesc.value,
          // 旧最终提示词只在"描述真的被换掉"（原来为空、这次被提取填上）时失效；
          // 保留用户已有描述时资产与 final_prompt 仍一致，不能清
          finalPrompt: propDesc.kept ? existing.finalPrompt : (prop.description ? null : existing.finalPrompt),
          updatedAt: ts,
        }).where(eq(schema.props.id, existing.id))
        await linkPropToEpisode(episodeId, existing.id)
        results.merged++
      } else {
        const res = await db.insert(schema.props).values({
          name: prop.name,
          type: prop.type || '',
          description: prop.description || '',
          dramaId,
          createdAt: ts,
          updatedAt: ts,
        })
        const propId = getInsertId(res)
        await linkPropToEpisode(episodeId, propId)
        results.created++
      }
    }

    const payload = {
      message: `道具保存完成：新增 ${results.created}，合并更新 ${results.merged}`,
      ...results,
    }
    logTaskSuccess('ExtractTool', 'save-props-complete', { episodeId, ...results })
    return payload
  },
})

export const extractTools = {
  readScriptForExtraction,
  readExistingCharacters,
  readExistingScenes,
  readExistingProps,
  saveDedupCharacters,
  saveDedupScenes,
  saveDedupProps,
}
