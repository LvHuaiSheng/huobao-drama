/**
 * 音乐 MV 路由（2026-10-18 新增，独立模块）
 *
 * 与短剧链路彻底隔离：不写 storyboards / characters / scenes，只用自己的三张表
 * （mv_projects / mv_assets / mv_shots）+ 4080 shim 的 /v2/mv/* 接口。
 * 生成全部走 App 现成的三条通道（不写死地址和模型）：
 *   文本 = getTextConfig()｜图片 = generateImage()｜视频 = generateVideo(model=minimax-h3-mv)
 *
 * 流程（与短剧同构）：
 *   建项目（歌 + 风格 + 分镜提示词）→ 从分镜提示词提取人物/场景（mv_assets）
 *   → 逐个出图 → 逐个抽卡 → 粗分镜（与歌等长）→ 详细分镜（景别/机位/歌词）
 *   → 编译六段式提示词 → 逐段出片 → 无音轨拼接 + 原曲整段混入
 *
 * 4080 侧只用 shim 的 MV 专属接口（地址取自「视频通道」配置）：
 *   POST /v2/mv/audio        原曲 32k wav 落盘（只推一次）
 *   POST /v2/mv/plan         按能量/句界切段（H3 帧网格 5.167~14.375s，命中上限）
 *   POST /v2/mv/prompts      六段式提示词编译 + 硬校验
 *   POST /v2/refmod/extract  资产抽卡（卡保证人物和场景锁住；声音卡不接，音轨就是原曲）
 */
import { Hono } from 'hono'
import { eq, desc, and, isNull } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import { db, schema, getInsertId } from '../db/index.js'
import { generateImage, generateVideo, imageSizeForAspect } from '../services/generation.js'
import { getTextConfig, getTextProviderBaseUrl, getActiveConfig } from '../services/ai.js'
import { getStyleSpecByValue } from '../services/style-preset.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { loadAgentPromptFile } from '../agents/prompts.js'
import { DEFAULT_PROMPTS } from '../agents/index.js'
import { extractChatText } from '../services/asset-describe-prompt.js'
import { getAbsolutePath } from '../utils/storage.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { success, created, badRequest, notFound, serverError, now } from '../utils/response.js'
import { logTaskStart, logTaskSuccess, logTaskError } from '../utils/task-logger.js'
import { ffmpeg } from '../utils/ffmpeg.js'

const app = new Hono()

const MV_MODEL = 'minimax-h3-mv'   // 中转按 model 名走 mv_shot.api.json
const HARD_MAX_S = 15              // H3 单段极限（页面填的「最长切分」不得超）
const DEFAULT_MAX_S = 10
const KINDS = ['character', 'scene'] as const
type Kind = typeof KINDS[number]

// ---------------------------------------------------------------- 基础工具

/** 4080 地址：优先 MV_SHIM_BASE，其次「视频通道」的 baseUrl（不写死）
 *  末尾可能被填成 …:8100/v1（BeefTV 的口径）→ 去掉 v1/v2 段，MV 自己拼 /v2/mv/… */
async function shimBase(): Promise<string> {
  const env = String(process.env.MV_SHIM_BASE || '').trim()
  const raw = env || String((await getActiveConfig('video'))?.baseUrl || '').trim()
  if (!raw) throw new Error('没配视频服务地址（设置页的视频通道），MV 提交不了')
  return raw.replace(/\/(v1|v2)\/?$/i, '').replace(/\/+$/, '')
}

async function shimPost<T = any>(p: string, body: any): Promise<T> {
  const cfg = await getActiveConfig('video')
  const base = await shimBase()
  const resp = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg?.apiKey || ''}` },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!resp.ok || json?.error) throw new Error(json?.error || `中转 ${p} HTTP ${resp.status}：${text.slice(0, 160)}`)
  return json as T
}

/** 调当前文本模型（OpenAI 形状 /chat/completions；不用 Agent，避免它的提示词风格污染） */
async function askText(system: string, user: string, maxTokens = 2500): Promise<string> {
  const cfg = await getTextConfig()
  let model = ''
  try { model = (JSON.parse(cfg.model || '[]') as string[])[0] || '' } catch { model = String(cfg.model || '') }
  const resp = await fetch(joinProviderUrl(getTextProviderBaseUrl(cfg), '/v1', '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey || ''}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens }),
  })
  if (!resp.ok) throw new Error(`文本模型返回 ${resp.status}：${(await resp.text()).slice(0, 200)}`)
  const text = extractChatText(await resp.json())
  if (!text.trim()) throw new Error('文本模型返回空内容（换一个文本模型再试）')
  return text
}

/** 从模型回复里抠 JSON（容忍 ```json 围栏和前后废话） */
function pickJson<T>(text: string): T {
  const s = String(text).replace(/```(?:json)?/gi, '').trim()
  const i = s.search(/[[{]/)
  const j = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'))
  if (i < 0 || j <= i) throw new Error(`模型没回 JSON：${s.slice(0, 160)}`)
  return JSON.parse(s.slice(i, j + 1)) as T
}

function mvDir(projectId: number) {
  const rel = `mv/p${projectId}`
  fs.mkdirSync(path.join(STORAGE_ROOT, rel), { recursive: true })
  return rel
}

function b64ToBuffer(dataUrl: string): Buffer {
  const raw = String(dataUrl || '')
  const b64 = raw.startsWith('data:') ? raw.split(',').slice(1).join(',') : raw
  return Buffer.from(b64, 'base64')
}

function readAsDataUrl(rel: string, mime: string): string {
  return `data:${mime};base64,${fs.readFileSync(getAbsolutePath(rel)).toString('base64')}`
}

/** 音频转 32kHz 单声道 PCM16 wav（H3 音频锁定只认这个；24k 实测无效） */
function to32kWav(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input).noVideo().audioCodec('pcm_s16le').audioFrequency(32000).audioChannels(1).format('wav')
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(output)
  })
}

/** 帧网格 5+17k（H3 只认这个）：5.167s ~ 14.375s */
function snapFrames(seconds: number): number {
  const f = Math.round(seconds * 24)
  const k = Math.round((f - 5) / 17)
  return Math.min(345, Math.max(124, 5 + 17 * k))
}

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
void stamp   // 保留：出图/上传文件名可能用到

async function loadProject(id: number) {
  const [row] = await db.select().from(schema.mvProjects).where(and(eq(schema.mvProjects.id, id), isNull(schema.mvProjects.deletedAt)))
  return row || null
}

async function shotsOf(projectId: number) {
  return db.select().from(schema.mvShots).where(eq(schema.mvShots.projectId, projectId)).orderBy(schema.mvShots.shotNumber)
}

async function assetsOf(projectId: number, kind?: Kind) {
  const rows = await db.select().from(schema.mvAssets).where(
    kind ? and(eq(schema.mvAssets.projectId, projectId), eq(schema.mvAssets.kind, kind)) : eq(schema.mvAssets.projectId, projectId))
  return rows.sort((a, b) => (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) || a.id - b.id)
}

/** 出片用的「主」资产：每一类取第一个 */
async function primaryAssets(projectId: number) {
  const rows = await assetsOf(projectId)
  return {
    character: rows.find((r) => r.kind === 'character') || null,
    scene: rows.find((r) => r.kind === 'scene') || null,
  }
}

/** 风格预设的「风格头」（给图片/提示词当画风句）；没选或已停用返回 '' */
async function styleHead(project: any): Promise<string> {
  try {
    return (await getStyleSpecByValue(project?.style)).head
  } catch { return '' }
}

/**
 * MV 的可自定义指令：优先用「设置 → Agent 配置」里改过的 workspace/prompts/<type>.md，
 * 没有就回退代码默认（DEFAULT_PROMPTS）。
 */
async function mvPrompt(type: string): Promise<string> {
  try {
    const f = await loadAgentPromptFile(type)
    if (f?.instructions) return f.instructions
  } catch { /* 读不到就用默认 */ }
  return DEFAULT_PROMPTS[type]?.instructions || ''
}

/** 等 sys_task 跑完（图片/视频同一张表；MV 借它拿结果） */
async function waitTask(taskId: number, timeoutMs = 600_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId))
    if (!row) throw new Error(`任务 ${taskId} 不存在`)
    if (row.status === 'completed') return row
    if (row.status === 'failed') throw new Error(row.errorMsg || `任务 ${taskId} 失败`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`任务 ${taskId} 超时未完成`)
}

/** 本地读时长（ffprobe），建项目时就能给粗分镜用，不必先送 4080 */
function probeSeconds(file: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      ffmpeg.ffprobe(file, (err: any, meta: any) => {
        const d = Number(meta?.format?.duration)
        resolve(err || !Number.isFinite(d) ? 0 : Math.round(d * 1000) / 1000)
      })
    } catch { resolve(0) }
  })
}

/**
 * 原曲送 4080 —— **只在第一次真正需要时做**（切分镜 / 提交片段），建项目时只落本地。
 * 做一次就记住文件名，之后每段只带名字。
 */
async function ensureRemoteSong(project: any): Promise<string> {
  if (project?.songRemoteName) return String(project.songRemoteName)
  if (!project?.songFile) throw new Error('项目里没有歌文件')
  const rel = mvDir(Number(project.id))
  const wavRel = `${rel}/song_32k.wav`
  await to32kWav(getAbsolutePath(project.songFile), getAbsolutePath(wavRel))
  const name = `mv_p${project.id}_song_32k.wav`
  const info = await shimPost<{ name: string; seconds: number }>('/v2/mv/audio', {
    name, data: readAsDataUrl(wavRel, 'audio/wav'),
  })
  const remote = String(info?.name || name)
  await db.update(schema.mvProjects).set({
    songRemoteName: remote,
    songSeconds: Number(info?.seconds || project.songSeconds || 0),
    updatedAt: now(),
  }).where(eq(schema.mvProjects.id, Number(project.id)))
  project.songRemoteName = remote
  logTaskSuccess('MV', 'song-pushed', { id: project.id, name: remote, seconds: info?.seconds })
  return remote
}

// ---------------------------------------------------------------- 项目

app.get('/projects', async (c) => {
  const rows = await db.select().from(schema.mvProjects).where(isNull(schema.mvProjects.deletedAt)).orderBy(desc(schema.mvProjects.id))
  return success(c, { items: rows })
})

app.get('/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const shots = await shotsOf(id)
  // 顺手把在跑的任务状态同步进来（页面只轮询这一个接口）
  for (const s of shots) {
    if (s.status === 'processing' && s.taskId) {
      const [t] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, Number(s.taskId)))
      if (t && t.status !== 'processing') {
        const patch: Record<string, any> = { status: t.status, updatedAt: now() }
        if (t.localPath) patch.videoUrl = t.localPath
        if (t.errorMsg) patch.errorMsg = t.errorMsg
        await db.update(schema.mvShots).set(patch).where(eq(schema.mvShots.id, s.id))
        Object.assign(s, patch)
      }
    }
  }
  return success(c, { project, assets: await assetsOf(id), shots })
})

app.delete('/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.update(schema.mvProjects).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.mvProjects.id, id))
  return success(c, null)
})

/** 建项目：只做本地的事（落库 + 存歌 + 读时长），不碰 4080 */
app.post('/projects', async (c) => {
  let body: any
  try { body = await c.req.json() } catch (err: any) { return badRequest(c, `请求体不是 JSON: ${err?.message}`) }
  if (!body?.song?.data) return badRequest(c, '缺 song.data（歌的 base64/data URL）')
  const maxShot = Math.min(HARD_MAX_S, Math.max(5, Number(body.max_shot_seconds) || DEFAULT_MAX_S))
  const ts = now()
  try {
    const res = await db.insert(schema.mvProjects).values({
      title: String(body.title || '未命名 MV').slice(0, 80),
      idea: String(body.idea || '').slice(0, 2000),
      lyrics: String(body.lyrics || '').slice(0, 8000),
      style: String(body.style || '').slice(0, 60),
      storyPrompt: String(body.story_prompt || '').slice(0, 20000),
      aspectRatio: String(body.aspect_ratio || '9:16').slice(0, 10),
      maxShotSeconds: maxShot,
      status: 'draft',
      createdAt: ts, updatedAt: ts,
    })
    const id = getInsertId(res)
    const rel = mvDir(id)
    const srcExt = String(body.song.name || '').toLowerCase().endsWith('.wav') ? '.wav' : '.mp3'
    const songRel = `${rel}/song_src${srcExt}`
    fs.writeFileSync(getAbsolutePath(songRel), b64ToBuffer(String(body.song.data)))
    const seconds = await probeSeconds(getAbsolutePath(songRel))
    await db.update(schema.mvProjects).set({ songFile: songRel, songSeconds: seconds, updatedAt: now() })
      .where(eq(schema.mvProjects.id, id))
    logTaskSuccess('MV', 'create-project', { id, seconds })
    return created(c, { id, song_seconds: seconds })
  } catch (err: any) {
    logTaskError('MV', 'create-project', { error: err?.message })
    return serverError(c, err?.message || '建 MV 项目失败')
  }
})

/** 改项目（标题 / 风格 / 分镜提示词 / 想法 / 歌词 / 最长切分） */
app.put('/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const body = await c.req.json().catch(() => ({} as any))
  const patch: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) {
    const t = String(body.title).trim().slice(0, 80)
    if (!t) return badRequest(c, '标题不能为空')
    patch.title = t
  }
  if (body.style !== undefined) patch.style = String(body.style).slice(0, 60)
  if (body.aspect_ratio !== undefined) patch.aspectRatio = String(body.aspect_ratio).slice(0, 10)
  if (body.story_prompt !== undefined) patch.storyPrompt = String(body.story_prompt).slice(0, 20000)
  if (body.idea !== undefined) patch.idea = String(body.idea).slice(0, 2000)
  if (body.lyrics !== undefined) patch.lyrics = String(body.lyrics).slice(0, 8000)
  if (body.max_shot_seconds !== undefined) {
    patch.maxShotSeconds = Math.min(HARD_MAX_S, Math.max(5, Number(body.max_shot_seconds) || DEFAULT_MAX_S))
  }
  await db.update(schema.mvProjects).set(patch).where(eq(schema.mvProjects.id, id))
  return success(c, { project: await loadProject(id) })
})

// ---------------------------------------------------------------- 人物 / 场景（MV 自己的资产表）

/** 从分镜提示词提取人物 + 场景（覆盖式重建；不动短剧的 characters / scenes） */
app.post('/projects/:id/extract', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const body = await c.req.json().catch(() => ({} as any))
  const story = String(body.story_prompt ?? project.storyPrompt ?? '').trim()
  if (!story) return badRequest(c, '先填分镜提示词，再提取人物和场景')
  const ask = `下面是这支 MV 的分镜提示词（用户写的）：

"""
${story.slice(0, 12000)}
"""

请从中提取**人物**和**场景**，规则（与短剧一致）：
1) 只提取这份分镜提示词里真实出现过的，不要自己发明、不要补充没写的东西。
2) 人物 description：外貌 + 妆造（发型发色、肤色、脸型气质、服装颜色与款式、配饰颜色）。每条都必须写死唯一值，**禁止「或」「可能」「皆可」这类模糊词**。
3) 场景 description：地点、时间、光线、色调、氛围（写具体）。
4) name 用简短中文名（人物用名字或代称，场景用「地点+时间」）；同一个人的不同叫法合并成一个人。
5) 没有人物就返回空数组。

只输出 JSON：
{"characters":[{"name":"","description":"","appearance":"","styling":""}],"scenes":[{"name":"","description":""}]}
appearance 只写脸/身形容貌，styling 只写服装配饰；拆不出来就留空。`
  try {
    const out = pickJson<{ characters?: any[]; scenes?: any[] }>(
      await askText(await mvPrompt('mv_extractor'), ask, 3000))
    const ts = now()
    await db.delete(schema.mvAssets).where(eq(schema.mvAssets.projectId, id))
    let sort = 0
    for (const kind of KINDS) {
      const list = (kind === 'character' ? out.characters : out.scenes) || []
      for (const a of list) {
        const desc = String(a?.description || '').trim()
        const name = String(a?.name || '').trim()
        if (!desc && !name) continue
        await db.insert(schema.mvAssets).values({
          projectId: id,
          kind,
          name: name.slice(0, 60) || (kind === 'character' ? `人物${sort + 1}` : `场景${sort + 1}`),
          description: desc.slice(0, 4000),
          appearance: String(a?.appearance || '').slice(0, 2000),
          styling: String(a?.styling || '').slice(0, 2000),
          sortOrder: sort++,
          createdAt: ts, updatedAt: ts,
        })
      }
    }
    logTaskSuccess('MV', 'extract', { id, characters: out.characters?.length || 0, scenes: out.scenes?.length || 0 })
    return success(c, { assets: await assetsOf(id) })
  } catch (err: any) {
    logTaskError('MV', 'extract', { id, error: err?.message })
    return serverError(c, `提取失败：${err?.message}`)
  }
})

/** 改单个资产（名字 / 描述 / 容貌 / 服装） */
app.put('/projects/:id/assets/:aid', async (c) => {
  const id = Number(c.req.param('id'))
  const aid = Number(c.req.param('aid'))
  const [asset] = await db.select().from(schema.mvAssets)
    .where(and(eq(schema.mvAssets.id, aid), eq(schema.mvAssets.projectId, id)))
  if (!asset) return notFound(c, '资产不存在')
  const body = await c.req.json().catch(() => ({} as any))
  const patch: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) patch.name = String(body.name).slice(0, 60)
  if (body.description !== undefined) patch.description = String(body.description).slice(0, 4000)
  if (body.appearance !== undefined) patch.appearance = String(body.appearance).slice(0, 2000)
  if (body.styling !== undefined) patch.styling = String(body.styling).slice(0, 2000)
  await db.update(schema.mvAssets).set(patch).where(eq(schema.mvAssets.id, aid))
  return success(c, { assets: await assetsOf(id) })
})

app.delete('/projects/:id/assets/:aid', async (c) => {
  const id = Number(c.req.param('id'))
  const aid = Number(c.req.param('aid'))
  await db.delete(schema.mvAssets).where(and(eq(schema.mvAssets.id, aid), eq(schema.mvAssets.projectId, id)))
  return success(c, { assets: await assetsOf(id) })
})

/**
 * 给资产生成「生图提示词」（照短剧：描述 → 生成提示词 → 出图）
 *
 * 规则文本 = 「设置 → Agent 配置 → MV 资产出图」那条指令（---SCENE--- 前是人物板规则、后是场景规则），
 * 由当前文本模型把资产的描述写成一段可直接出图的提示词 ⇒ 出图按钮只认这条提示词。
 */
app.post('/projects/:id/assets/:aid/prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const aid = Number(c.req.param('aid'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const [asset] = await db.select().from(schema.mvAssets)
    .where(and(eq(schema.mvAssets.id, aid), eq(schema.mvAssets.projectId, id)))
  if (!asset) return notFound(c, '资产不存在')
  const body = await c.req.json().catch(() => ({} as any))
  const desc = String(body.description ?? asset.description ?? '').trim()
  if (!desc) return badRequest(c, '这个资产还没有描述 —— 先写清外貌/场景，再生成提示词')
  if (body.description !== undefined || body.name !== undefined) {
    await db.update(schema.mvAssets).set({
      description: desc.slice(0, 4000),
      name: String(body.name ?? asset.name ?? '').slice(0, 60),
      updatedAt: now(),
    }).where(eq(schema.mvAssets.id, aid))
  }
  const rawRule = await mvPrompt('mv_asset_image')
  const [charRule, sceneRule] = rawRule.includes('---SCENE---')
    ? rawRule.split('---SCENE---').map((s) => s.trim())
    : [rawRule, '']
  const rule = asset.kind === 'character' ? charRule : sceneRule
  try {
    const text = await askText(
      `${rule}\n\n按上面的规矩，把这个资产写成一段可直接用于出图的提示词：\n` +
      `- 只输出这一段提示词本身（英文，逗号分隔的短语），不要解释、不要标题、不要 markdown、不要编号；\n` +
      `- 描述里的服装和配饰颜色必须原样保留，不许换款式。`,
      `资产类型：${asset.kind === 'character' ? '人物' : '场景'}\n` +
      `名称：${asset.name || '（未命名）'}\n` +
      `描述：${desc}`,
      1500,
    )
    const prompt = text.trim()
    if (!prompt) throw new Error('文本模型返回空')
    await db.update(schema.mvAssets).set({ prompt: prompt.slice(0, 4000), updatedAt: now() })
      .where(eq(schema.mvAssets.id, aid))
    logTaskSuccess('MV', 'asset-prompt', { id, aid, kind: asset.kind, chars: prompt.length })
    return success(c, { assets: await assetsOf(id) })
  } catch (err: any) {
    logTaskError('MV', 'asset-prompt', { id, aid, error: err?.message })
    return serverError(c, `生成提示词失败：${err?.message}`)
  }
})

/**
 * 给资产出图（走 App 图片通道）
 * 人物 = 四格定妆板（左1 正脸特写 + 正视/左侧/背面全身，纯白底，只出现一张脸），尺寸固定 16:9
 * 场景 = 一张场景图，尺寸跟随项目画幅；两者都拼上项目的风格头
 * 用的是上一步「生成提示词」存下来的那条提示词（没生成过不许出图）
 */
/**
 * 资产出图尺寸（照短剧）：人物板固定 16:9 = 2048x1152；场景图跟随项目画幅。
 */
const CHAR_BOARD_SIZE = '2048x1152'
const imageSizeForAsset = (project: any, kind: string): string =>
  kind === 'character' ? CHAR_BOARD_SIZE : imageSizeForAspect(project?.aspectRatio)

/**
 * 成片画幅：H3 只认 9:16 / 16:9，其它比例按横竖就近映射。
 * ponytail: 想支持更多画幅得先让 H3 支持，别在这里造轮子。
 */
function videoSize(project: any): [number, number] {
  return String(project?.aspectRatio || '9:16') === '16:9' ? [1344, 768] : [768, 1344]
}

/**
 * 后台出图排队：同一个项目里的出图请求按点击顺序**串行**跑（图片通道一次只吃一个任务），
 * 每个资产各自记状态，所以一张卡在出图时别的卡照样能点。
 */
const renderQueue = new Map<number, Promise<unknown>>()
function enqueueRender(pid: number, job: () => Promise<unknown>) {
  const prev = renderQueue.get(pid) ?? Promise.resolve()
  const next = prev.then(job, job)
  renderQueue.set(pid, next.catch(() => { }))
  return next
}

app.post('/projects/:id/assets/:aid/image', async (c) => {
  const id = Number(c.req.param('id'))
  const aid = Number(c.req.param('aid'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const [asset] = await db.select().from(schema.mvAssets)
    .where(and(eq(schema.mvAssets.id, aid), eq(schema.mvAssets.projectId, id)))
  if (!asset) return notFound(c, '资产不存在')
  const body = await c.req.json().catch(() => ({} as any))
  if (body.description !== undefined || body.name !== undefined) {
    await db.update(schema.mvAssets).set({
      description: String(body.description ?? asset.description ?? '').slice(0, 4000),
      name: String(body.name ?? asset.name ?? '').slice(0, 60),
      updatedAt: now(),
    }).where(eq(schema.mvAssets.id, aid))
  }
  const assetPrompt = String(body.prompt ?? asset.prompt ?? '').trim()
  if (!assetPrompt) return badRequest(c, '先点「生成提示词」，再出图')
  if (body.prompt !== undefined && assetPrompt !== asset.prompt) {
    await db.update(schema.mvAssets).set({ prompt: assetPrompt.slice(0, 4000), updatedAt: now() })
      .where(eq(schema.mvAssets.id, aid))
  }
  const head = await styleHead(project)
  const prompt = [head, assetPrompt].filter(Boolean).join('\n')
  const imgSize = imageSizeForAsset(project, asset.kind)
  const kind = asset.kind
  const assetId = asset.id
  // 立刻回「已排队」，真实出图在后台按项目串行跑（接口不再阻塞一分钟）
  await db.update(schema.mvAssets).set({ imageStatus: 'processing', updatedAt: now() })
    .where(eq(schema.mvAssets.id, aid))
  enqueueRender(id, async () => {
    try {
      const size = imgSize      // 人物板固定 2048x1152（16:9）；场景图跟随项目画幅
      const taskId = await generateImage({ prompt, size })
      const task = await waitTask(taskId)
      if (!task.localPath) throw new Error('图片任务完成但没拿到文件路径')
      const imageRel = `${mvDir(id)}/${kind}-${assetId}.png`
      fs.copyFileSync(getAbsolutePath(task.localPath), getAbsolutePath(imageRel))
      await db.update(schema.mvAssets).set({ image: imageRel, imageStatus: null, updatedAt: now() })
        .where(eq(schema.mvAssets.id, aid))
      logTaskSuccess('MV', 'asset-image', { id, aid, kind, task: taskId })
    } catch (err: any) {
      await db.update(schema.mvAssets).set({ imageStatus: `failed: ${String(err?.message ?? err).slice(0, 160)}`, updatedAt: now() })
        .where(eq(schema.mvAssets.id, aid))
      logTaskError('MV', 'asset-image', { id, aid, error: err?.message })
    }
  })
  return success(c, { assets: await assetsOf(id) })
})

/** 给资产生卡（卡保证人物/场景锁得住；声音卡不接，音轨就是原曲） */
app.post('/projects/:id/assets/:aid/card', async (c) => {
  const id = Number(c.req.param('id'))
  const aid = Number(c.req.param('aid'))
  const [asset] = await db.select().from(schema.mvAssets)
    .where(and(eq(schema.mvAssets.id, aid), eq(schema.mvAssets.projectId, id)))
  if (!asset) return notFound(c, '资产不存在')
  if (!asset.image) return badRequest(c, '先出图，再生卡')
  const cardName = `refmod_${asset.kind}-mv${id}a${aid}_v1`
  try {
    await shimPost('/v2/refmod/extract', {
      name: cardName,
      image: readAsDataUrl(asset.image, 'image/png'),
      concept_type: asset.kind === 'character' ? 'identity' : 'scene',
    })
    await db.update(schema.mvAssets).set({ card: cardName, updatedAt: now() }).where(eq(schema.mvAssets.id, aid))
    logTaskSuccess('MV', 'asset-card', { id, aid, cardName })
    return success(c, { assets: await assetsOf(id) })
  } catch (err: any) {
    logTaskError('MV', 'asset-card', { id, aid, error: err?.message })
    return serverError(c, `抽卡失败：${err?.message}`)
  }
})
// ---------------------------------------------------------------- 分镜

/** 粗分镜：与歌等长的内容时间轴（只写画什么，不写景别运镜） */
app.post('/projects/:id/plan', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  if (!project.songSeconds) return badRequest(c, '还没拿到歌曲时长')
  const ask = `歌长 ${project.songSeconds} 秒，歌名《${project.title}》。
${project.storyPrompt
  ? `分镜提示词（用户写的）：\n"""\n${String(project.storyPrompt).slice(0, 8000)}\n"""`
  : `MV 想法：${project.idea || '(没写，按歌名发挥)'}`}
${project.lyrics ? `\n歌词（行，时间未知）：\n${String(project.lyrics).slice(0, 2000)}` : ''}

请给一条「与歌等长」的粗分镜：把 0 到 ${project.songSeconds} 秒分成若干段，前后衔接、不重叠、不留空。
每段只写「画面发生什么」（场景/动作/情绪，一句话），**不要写景别、不要写运镜**（下一步才配）。
段长参考歌曲结构（前奏/主歌/副歌/桥段/尾奏），每段 5~20 秒。
只输出 JSON 数组：[{"start":0,"end":8.5,"what":"…"}, …]`
  try {
    const outline = pickJson<any[]>(await askText(await mvPrompt('mv_storyboard'), ask, 3000))
    if (!Array.isArray(outline) || !outline.length) throw new Error('粗分镜为空')
    await db.update(schema.mvProjects).set({ outline: JSON.stringify(outline), status: 'planned', updatedAt: now() })
      .where(eq(schema.mvProjects.id, id))
    logTaskSuccess('MV', 'plan-outline', { id, segments: outline.length })
    return success(c, { outline })
  } catch (err: any) {
    logTaskError('MV', 'plan-outline', { id, error: err?.message })
    return serverError(c, err?.message || '粗分镜失败')
  }
})

/** 详细分镜：4080 按能量/句界切硬时间轴（H3 帧网格），MV 侧按镜头语言配景别/机位/歌词 */
app.post('/projects/:id/shots', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const body = await c.req.json().catch(() => ({} as any))
  const maxS = Math.min(HARD_MAX_S, Number(body.max_seconds || project.maxShotSeconds) || DEFAULT_MAX_S)
  // 到这一步才第一次把原曲转 32k 送 4080（建项目时不碰它）
  let remoteSong = ''
  try {
    remoteSong = await ensureRemoteSong(project)
  } catch (err: any) {
    return serverError(c, `原曲送 4080 失败：${err?.message || err}`)
  }
  let plan: { shots: any[]; grid?: number[] }
  try {
    plan = await shimPost('/v2/mv/plan', { audio_file: remoteSong, max_seconds: maxS, target_seconds: 7 })
  } catch (err: any) {
    return serverError(c, `切段失败：${err?.message}`)
  }
  const raw = plan?.shots || []
  if (!raw.length) return serverError(c, '切段结果为空')
  // 景别规则（MV）：中间只用 中景/特写 交替，只有头尾允许中远景；段内不换景别
  const sizes = raw.map((_s, i) => (i === 0 || i === raw.length - 1) ? '中远景' : (i % 2 ? '中景' : '特写'))
  let outline: any[] = []
  try { outline = JSON.parse(project.outline || '[]') } catch { outline = [] }
  const outlineLine = outline.map((o: any, i: number) => `${i + 1}. ${o.start}-${o.end}s：${o.what}`).join('\n')
  const lyricLines = String(project.lyrics || '').split('\n').map((l) => l.trim()).filter(Boolean)
  let perShot: any[] = []
  try {
    const ask = `下面是已经切好的镜头时间轴（秒/帧/是否在唱），**时间不许改、段数不许改**：
${raw.map((s, i) => `${i}: ${s.start}s 起 ${s.seconds}s（${s.frames}帧） ${s.vocal_state === 'vocal_active' ? '有唱' : '无唱(间奏)'}`).join('\n')}

对应内容（粗分镜）：
${outlineLine || '(无)'}
${lyricLines.length ? `歌词行：\n${lyricLines.map((l, i) => `${i + 1}. ${l}`).join('\n')}` : ''}

给每段配一个机位 camera：英文短句，必须一直看得清脸和嘴（有唱段尤其），例如
"locked-off static camera, medium shot, front three-quarter face view, stable framing"。
只输出 JSON 数组，长度必须等于 ${raw.length}：
[{"index":0,"camera":"…","lyric":"这一段正在唱的那句歌词，没唱就留空"}, …]`
    perShot = pickJson<any[]>(await askText(await mvPrompt('mv_camera'), ask, 3000))
  } catch { perShot = [] }

  try {
    const ts = now()
    await db.delete(schema.mvShots).where(eq(schema.mvShots.projectId, id))
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i]
      const extra = (Array.isArray(perShot) ? perShot : []).find((x: any) => Number(x?.index) === i) || {}
      await db.insert(schema.mvShots).values({
        projectId: id, shotNumber: i + 1,
        startSeconds: Number(s.start), endSeconds: Number(s.end),
        frames: Number(s.frames), seconds: Number(s.seconds),
        shotSize: sizes[i] || '中景', camera: String(extra?.camera || '').slice(0, 300),
        vocalState: String(s.vocal_state || 'vocal_active'), lyric: String(extra?.lyric || '').slice(0, 300),
        status: 'pending', createdAt: ts, updatedAt: ts,
      })
    }
    await db.update(schema.mvProjects).set({ status: 'shots', maxShotSeconds: maxS, updatedAt: ts }).where(eq(schema.mvProjects.id, id))
    logTaskSuccess('MV', 'shots', { id, count: raw.length, maxS })
    return success(c, { count: raw.length, max_seconds: maxS, grid: plan.grid || [], shots: await shotsOf(id) })
  } catch (err: any) {
    logTaskError('MV', 'shots', { id, error: err?.message })
    return serverError(c, err?.message || '写分镜表失败')
  }
})

/** 手改单段（景别/机位/歌词/提示词） */
app.put('/projects/:id/shots/:sid', async (c) => {
  const id = Number(c.req.param('id'))
  const sid = Number(c.req.param('sid'))
  const [shot] = await db.select().from(schema.mvShots)
    .where(and(eq(schema.mvShots.id, sid), eq(schema.mvShots.projectId, id)))
  if (!shot) return notFound(c, '分镜不存在')
  const body = await c.req.json().catch(() => ({} as any))
  const patch: Record<string, any> = { updatedAt: now() }
  if (body.shot_size !== undefined) patch.shotSize = String(body.shot_size).slice(0, 20)
  if (body.camera !== undefined) patch.camera = String(body.camera).slice(0, 300)
  if (body.vocal_state !== undefined) patch.vocalState = String(body.vocal_state).slice(0, 20)
  if (body.lyric !== undefined) patch.lyric = String(body.lyric).slice(0, 300)
  if (body.prompt !== undefined) patch.prompt = String(body.prompt)
  await db.update(schema.mvShots).set(patch).where(eq(schema.mvShots.id, sid))
  return success(c, { id: sid })
})

/** 编译六段式提示词（4080 侧编译 + 硬校验，一条不过整批不发） */
app.post('/projects/:id/prompts', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const shots = await shotsOf(id)
  if (!shots.length) return badRequest(c, '还没有分镜表，先切分详细分镜')
  const { character, scene } = await primaryAssets(id)
  if (!character) return badRequest(c, '还没有人物资产（先提取人物并出图）')
  const pictures = (character.image ? 1 : 0) + (scene?.image ? 1 : 0)
  try {
    const out = await shimPost<{ shots: any[] }>('/v2/mv/prompts', {
      pictures: Math.max(1, pictures),
      performer: String(character.description || character.name || 'the lead singer').slice(0, 600),
      style: (await styleHead(project)) || undefined,
      scene_note: scene?.description ? String(scene.description) : '',
      language: 'Chinese',
      lyrics: shots.map((s) => s.lyric || ''),
      shots: shots.map((s) => ({
        index: s.shotNumber - 1,
        start: s.startSeconds, end: s.endSeconds, frames: s.frames, seconds: s.seconds,
        shot: s.shotSize || '', camera: s.camera || '', vocal_state: s.vocalState || 'vocal_active',
      })),
    })
    const items = out?.shots || []
    if (items.length !== shots.length) throw new Error(`编译结果条数不对（${items.length}/${shots.length}）`)
    for (let i = 0; i < shots.length; i++) {
      await db.update(schema.mvShots).set({ prompt: String(items[i].prompt || ''), updatedAt: now() })
        .where(eq(schema.mvShots.id, shots[i].id))
    }
    logTaskSuccess('MV', 'prompts', { id, count: items.length })
    return success(c, { count: items.length, shots: await shotsOf(id) })
  } catch (err: any) {
    logTaskError('MV', 'prompts', { id, error: err?.message })
    return serverError(c, err?.message || '提示词编译失败')
  }
})

// ---------------------------------------------------------------- 出片

/** 提交单段：走 App 视频通道 → 中转按 model=minimax-h3-mv 走 MV 模板 */
app.post('/projects/:id/shots/:sid/render', async (c) => {
  const id = Number(c.req.param('id'))
  const sid = Number(c.req.param('sid'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const [shot] = await db.select().from(schema.mvShots)
    .where(and(eq(schema.mvShots.id, sid), eq(schema.mvShots.projectId, id)))
  if (!shot) return notFound(c, '分镜不存在')
  if (!shot.prompt) return badRequest(c, '这一段还没提示词，先编译提示词')
  const body = await c.req.json().catch(() => ({} as any))
  const { character, scene } = await primaryAssets(id)
  if (!character?.image) return badRequest(c, '还没有人物图（先提取人物并出图）')
  // 参考图与卡按「人物在前、场景在后」送上；没图/没卡的就不占槽位
  const refs: string[] = [readAsDataUrl(character.image, 'image/png')]
  if (scene?.image) refs.push(readAsDataUrl(scene.image, 'image/png'))
  const cards = [character.card, scene?.card].filter(Boolean) as string[]
  try {
    const taskId = await generateVideo({
      prompt: shot.prompt,
      model: MV_MODEL,
      duration: Math.max(5.167, Number(shot.seconds) || 5.167),
      aspectRatio: '9:16',
      resolution: '768x1344',
      referenceImageUrls: refs,
      seed: body.seed ? Number(body.seed) : undefined,
      // MV 专用字段（适配器原样并进请求体；短剧路径不传这些）
      mvExtras: {
        mv_audio: { name: await ensureRemoteSong(project) },
        mv_start_seconds: Number(shot.startSeconds) || 0,
        mv_frames: Number(shot.frames) || snapFrames(Number(shot.seconds) || 5.167),
        mv_width: videoSize(project)[0], mv_height: videoSize(project)[1],
        refmod_files: cards,
      },
    })
    await db.update(schema.mvShots).set({ taskId: String(taskId), status: 'processing', errorMsg: null, updatedAt: now() })
      .where(eq(schema.mvShots.id, sid))
    await db.update(schema.mvProjects).set({ status: 'rendering', updatedAt: now() }).where(eq(schema.mvProjects.id, id))
    logTaskStart('MV', 'render', { id, sid, task: taskId, frames: shot.frames })
    return success(c, { task_id: taskId })
  } catch (err: any) {
    await db.update(schema.mvShots).set({ status: 'failed', errorMsg: String(err?.message || err).slice(0, 500), updatedAt: now() })
      .where(eq(schema.mvShots.id, sid))
    logTaskError('MV', 'render', { id, sid, error: err?.message })
    return serverError(c, `提交失败：${err?.message}`)
  }
})

/** 成片：无音轨拼接 + 混原曲整段（听到的就是原歌，不是各段自己的音轨） */
app.post('/projects/:id/assemble', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const shots = await shotsOf(id)
  const done = shots.filter((s) => s.videoUrl)
  if (!done.length) return badRequest(c, '还没有生成好的分段')
  if (done.length !== shots.length) return badRequest(c, `还有 ${shots.length - done.length} 段没生成完`)
  if (!project.songFile) return badRequest(c, '找不到原曲文件')
  const rel = mvDir(id)
  const listPath = path.join(STORAGE_ROOT, rel, 'concat.txt')
  fs.writeFileSync(listPath, done.map((s) => `file '${getAbsolutePath(s.videoUrl as string)}'`).join('\n'))
  const videoOnly = path.join(STORAGE_ROOT, rel, 'video_only.mp4')
  const outAbs = path.join(STORAGE_ROOT, rel, 'mv_final.mp4')
  const start = Number(done[0].startSeconds) || 0
  const total = done.reduce((a, s) => a + (Number(s.seconds) || 0), 0)
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(listPath).inputOptions(['-f concat', '-safe 0']).outputOptions(['-c copy', '-an'])
        .on('end', () => resolve()).on('error', (e: Error) => reject(new Error(`拼接失败：${e.message}`))).save(videoOnly)
    })
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoOnly).input(getAbsolutePath(project.songFile as string)).inputOptions([`-ss ${start}`])
        .outputOptions(['-map 0:v', '-map 1:a', '-c:v copy', '-c:a aac', '-b:a 192k', '-t', String(total + 0.5), '-shortest', '-movflags +faststart'])
        .on('end', () => resolve()).on('error', (e: Error) => reject(new Error(`混音失败：${e.message}`))).save(outAbs)
    })
  } catch (err: any) {
    logTaskError('MV', 'assemble', { id, error: err?.message })
    return serverError(c, err?.message)
  }
  const outRel = `${rel}/mv_final.mp4`
  await db.update(schema.mvProjects).set({ outputUrl: outRel, status: 'done', updatedAt: now() }).where(eq(schema.mvProjects.id, id))
  logTaskSuccess('MV', 'assemble', { id, seconds: total })
  return success(c, { output_url: outRel, seconds: total })
})

export default app
