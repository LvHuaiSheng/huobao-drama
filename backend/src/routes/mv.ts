/**
 * 音乐 MV 路由（2026-10-18 新增，独立模块）
 *
 * 与短剧链路彻底隔离：**不写 storyboards / sys_task，不碰 generation.ts**，
 * 只用自己的 mv_projects / mv_shots 两张表 + 4080 shim 的 /v2/mv/* 接口。
 *
 *   POST /projects                       建项目（带歌 + 参考图）→ 转 32k 上传 shim、落库
 *   GET  /projects                       项目列表
 *   GET  /projects/:id                   项目 + 镜头表
 *   POST /projects/:id/plan              调 shim 规划镜头 → 覆盖写 mv_shots
 *   PUT  /projects/:id/shots/:sid        手改单段（边界/景别/歌词/机位）
 *   POST /projects/:id/prompts           调 shim 编译六段式提示词 → 写回各段
 *   POST /projects/:id/shots/:sid/render 提交单段到 4080 生成
 *   GET  /projects/:id/shots/:sid/status 查单段状态；完成即把 mp4 落本地
 *   GET  /config                         当前 MV 用的 4080 地址（页面显示用）
 */
import { Hono } from 'hono'
import { eq, desc, and } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import { db, schema, getInsertId } from '../db/index.js'
import { getActiveConfig } from '../services/ai.js'
import { ffmpeg } from '../utils/ffmpeg.js'
import { downloadFile, saveUploadedFile, getAbsolutePath } from '../utils/storage.js'
import { DATA_ROOT } from '../utils/paths.js'
import { success, created, badRequest, notFound, serverError, now } from '../utils/response.js'
import { logTaskStart, logTaskSuccess, logTaskError } from '../utils/task-logger.js'

const app = new Hono()

/** MV 用的 4080 地址：优先 MV_SHIM_BASE，其次「视频通道」的 baseUrl */
async function shimBase(): Promise<string> {
  const env = String(process.env.MV_SHIM_BASE || '').trim()
  if (env) return env.replace(/\/+$/, '')
  const cfg = await getActiveConfig('video')
  const base = String(cfg?.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('没配视频服务地址（设置页的视频通道），MV 无法提交')
  return base
}

async function shimPost<T = any>(p: string, body: any): Promise<T> {
  const base = await shimBase()
  const resp = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json: any = await resp.json().catch(() => null)
  if (!resp.ok || (json && json.error)) throw new Error(json?.error || `shim ${p} HTTP ${resp.status}`)
  return json as T
}

/** 音频转 32kHz 单声道 PCM16 wav（H3 只认这个；24k 实测无效） */
function to32kWav(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioFrequency(32000)
      .audioChannels(1)
      .format('wav')
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(output)
  })
}

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function pushImage(name: string, dataUrl: string): Promise<string> {
  const resp = await shimPost<{ name: string }>('/v2/mv/image', { name: `mvref_${stamp()}.png`, data: dataUrl })
  if (!resp?.name) throw new Error(`参考图 ${name} 上传失败`)
  return resp.name
}

function parseRefs(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

async function loadProject(id: number) {
  const [row] = await db.select().from(schema.mvProjects).where(eq(schema.mvProjects.id, id))
  return row && !row.deletedAt ? row : null
}

async function shotsOf(projectId: number) {
  return db.select().from(schema.mvShots)
    .where(eq(schema.mvShots.projectId, projectId))
    .orderBy(schema.mvShots.shotNumber)
}

// ---------------------------------------------------------------- 项目

app.get('/config', async (c) => {
  try {
    return success(c, { base: await shimBase() })
  } catch (err: any) {
    return success(c, { base: '', error: err?.message })
  }
})

app.get('/projects', async (c) => {
  const rows = await db.select().from(schema.mvProjects).orderBy(desc(schema.mvProjects.id))
  return success(c, { items: rows.filter(r => !r.deletedAt) })
})

app.get('/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  return success(c, { project, shots: await shotsOf(id) })
})

app.post('/projects', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch (err: any) {
    return badRequest(c, `请求体不是 JSON: ${err?.message}`)
  }
  const song = body?.song || {}
  if (!song.data) return badRequest(c, '缺 song.data（base64 音频）')
  const ts = now()
  try {
    // 1) 原始音频落本地（备份/回放用）
    const raw = Buffer.from(String(song.data).split(',').pop() as string, 'base64')
    const songRel = await saveUploadedFile(raw as any, 'mv/songs', String(song.name || 'song.mp3'))

    // 2) 转 32k 单声道 wav → 送 4080 shim（H3 读的是 ComfyUI/input 下的文件）
    const tmpDir = path.join(DATA_ROOT, 'mv')
    fs.mkdirSync(tmpDir, { recursive: true })
    const wavTmp = path.join(tmpDir, `song-${stamp()}.wav`)
    await to32kWav(getAbsolutePath(songRel), wavTmp)
    const remote = await shimPost<{ name: string; seconds: number }>('/v2/mv/audio', {
      name: `mv_${stamp()}.wav`,
      data: fs.readFileSync(wavTmp).toString('base64'),
    })
    fs.unlinkSync(wavTmp)

    // 3) 参考图（人物图放第一张）+ 可选的景别首帧
    const refNames: string[] = []
    for (const r of body.ref_images || []) {
      if (r?.data) refNames.push(await pushImage(String(r.name || ''), String(r.data)))
    }
    let firstFrame = ''
    if (body.first_frame?.data) firstFrame = await pushImage('first_frame', String(body.first_frame.data))

    // 4) 落库
    const res = await db.insert(schema.mvProjects).values({
      title: String(body.title || '未命名 MV').slice(0, 80),
      songFile: songRel,
      songRemoteName: remote.name,
      songSeconds: Number(remote.seconds || 0),
      windowStart: Number(body.window_start || 0),
      windowEnd: Number(body.window_end || 0),
      refImages: JSON.stringify(refNames),
      firstFrame,
      performer: String(body.performer || '').slice(0, 400) || 'the same lead performer shown in the reference picture',
      style: String(body.style || '').slice(0, 300) || 'cinematic music video, natural skin, realistic light and texture',
      sceneNote: String(body.scene_note || '').slice(0, 200),
      pictures: refNames.length || 1,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    })
    const id = getInsertId(res)
    logTaskSuccess('MV', 'create-project', { id, song: remote.name, refs: refNames.length })
    return created(c, { id, song_remote_name: remote.name, song_seconds: remote.seconds, ref_images: refNames })
  } catch (err: any) {
    logTaskError('MV', 'create-project', { error: err?.message })
    return badRequest(c, err?.message || '建 MV 项目失败')
  }
})

// ---------------------------------------------------------------- 镜头表

app.post('/projects/:id/plan', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  try {
    const plan = await shimPost<{ shots: any[] }>('/v2/mv/plan', {
      audio_file: project.songRemoteName,
      boundaries: body.boundaries?.length ? body.boundaries : undefined,
      min_seconds: body.min_seconds,
      target_seconds: body.target_seconds,
      max_seconds: body.max_seconds,
    })
    const shots = plan.shots || []
    if (!shots.length) return badRequest(c, '规划结果为空（音频有问题？）')

    await db.delete(schema.mvShots).where(eq(schema.mvShots.projectId, id))
    const ts = now()
    for (const s of shots) {
      await db.insert(schema.mvShots).values({
        projectId: id,
        shotNumber: Number(s.index) + 1,
        startSeconds: Number(s.start),
        endSeconds: Number(s.end),
        frames: Number(s.frames),
        seconds: Number(s.seconds),
        shotSize: '',
        camera: '',
        vocalState: String(s.vocal_state || 'vocal_active'),
        lyric: '',
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      })
    }
    await db.update(schema.mvProjects)
      .set({ status: 'planned', updatedAt: ts })
      .where(eq(schema.mvProjects.id, id))
    logTaskSuccess('MV', 'plan', { id, shots: shots.length })
    return success(c, { count: shots.length, shots: await shotsOf(id) })
  } catch (err: any) {
    logTaskError('MV', 'plan', { id, error: err?.message })
    return badRequest(c, err?.message || '镜头规划失败')
  }
})

app.put('/projects/:id/shots/:sid', async (c) => {
  const id = Number(c.req.param('id'))
  const sid = Number(c.req.param('sid'))
  const [shot] = await db.select().from(schema.mvShots)
    .where(and(eq(schema.mvShots.id, sid), eq(schema.mvShots.projectId, id)))
  if (!shot) return notFound(c, '镜头不存在')
  let body: any
  try {
    body = await c.req.json()
  } catch (err: any) {
    return badRequest(c, `请求体不是 JSON: ${err?.message}`)
  }
  const patch: Record<string, any> = { updatedAt: now() }
  if (body.start_seconds !== undefined) patch.startSeconds = Number(body.start_seconds)
  if (body.end_seconds !== undefined) patch.endSeconds = Number(body.end_seconds)
  if (body.frames !== undefined) patch.frames = Number(body.frames)
  if (body.seconds !== undefined) patch.seconds = Number(body.seconds)
  if (body.shot_size !== undefined) patch.shotSize = String(body.shot_size).slice(0, 20)
  if (body.camera !== undefined) patch.camera = String(body.camera).slice(0, 300)
  if (body.vocal_state !== undefined) patch.vocalState = String(body.vocal_state).slice(0, 20)
  if (body.lyric !== undefined) patch.lyric = String(body.lyric).slice(0, 300)
  if (body.prompt !== undefined) patch.prompt = String(body.prompt)
  await db.update(schema.mvShots).set(patch).where(eq(schema.mvShots.id, sid))
  return success(c, { id: sid })
})

// ---------------------------------------------------------------- 提示词

app.post('/projects/:id/prompts', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const shots = await shotsOf(id)
  if (!shots.length) return badRequest(c, '还没有镜头表，先规划（或手填）')
  const payload = shots.map(s => ({
    index: s.shotNumber - 1,
    start: s.startSeconds,
    end: s.endSeconds,
    frames: s.frames,
    seconds: s.seconds,
    shot: s.shotSize || '',
    camera: s.camera || '',
    vocal_state: s.vocalState || 'vocal_active',
  }))
  try {
    const out = await shimPost<{ shots: any[] }>('/v2/mv/prompts', {
      shots: payload,
      lyrics: shots.map(s => s.lyric || ''),
      performer: project.performer,
      style: project.style,
      scene_note: project.sceneNote || '',
      pictures: Number(project.pictures || 1),
      global_prompt: body.global_prompt,
      language: body.language || 'Chinese',
      non_vocal_action: body.non_vocal_action,
    })
    const ts = now()
    for (const item of out.shots || []) {
      const row = shots[Number(item.index)]
      if (!row) continue
      await db.update(schema.mvShots)
        .set({ prompt: item.prompt, updatedAt: ts })
        .where(eq(schema.mvShots.id, row.id))
    }
    logTaskSuccess('MV', 'prompts', { id, shots: shots.length })
    return success(c, { count: shots.length, shots: await shotsOf(id) })
  } catch (err: any) {
    logTaskError('MV', 'prompts', { id, error: err?.message })
    return badRequest(c, err?.message || '提示词编译失败')
  }
})

// ---------------------------------------------------------------- 生成

app.post('/projects/:id/shots/:sid/render', async (c) => {
  const id = Number(c.req.param('id'))
  const sid = Number(c.req.param('sid'))
  const project = await loadProject(id)
  if (!project) return notFound(c, 'MV 项目不存在')
  const [shot] = await db.select().from(schema.mvShots)
    .where(and(eq(schema.mvShots.id, sid), eq(schema.mvShots.projectId, id)))
  if (!shot) return notFound(c, '镜头不存在')
  if (!shot.prompt) return badRequest(c, '这一段还没有提示词，先生成提示词')
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const ts = now()
  try {
    const refAll = parseRefs(project.refImages)
    const refs = body.ref_images?.length
      ? await Promise.all(body.ref_images.map((r: any) => pushImage(String(r.name || ''), String(r.data))))
      : refAll
    if (!refs.length) return badRequest(c, '这个项目没有参考图（建项目时传 ref_images）')
    const first = body.first_frame?.data
      ? await pushImage('first_frame', String(body.first_frame.data))
      : (project.firstFrame || '')
    const resp = await shimPost<{ task_id: string; frames: number }>('/v2/mv/shot', {
      prompt: shot.prompt,
      audio_file: project.songRemoteName,
      start_seconds: Number(shot.startSeconds || 0),
      frames: Number(shot.frames || 124),
      ref_images: refs,
      first_frame: first,
      width: Number(body.width || 768),
      height: Number(body.height || 1344),
      seed: body.seed,
      prefix: `mv/proj${id}_shot${shot.shotNumber}`,
    })
    await db.update(schema.mvShots)
      .set({ taskId: resp.task_id, status: 'processing', errorMsg: null, updatedAt: ts })
      .where(eq(schema.mvShots.id, sid))
    logTaskStart('MV', 'render', { id, sid, task: resp.task_id, frames: resp.frames })
    return success(c, { task_id: resp.task_id, frames: resp.frames })
  } catch (err: any) {
    await db.update(schema.mvShots)
      .set({ status: 'failed', errorMsg: String(err?.message || err).slice(0, 500), updatedAt: ts })
      .where(eq(schema.mvShots.id, sid))
    logTaskError('MV', 'render', { id, sid, error: err?.message })
    return badRequest(c, err?.message || '提交失败')
  }
})

app.get('/projects/:id/shots/:sid/status', async (c) => {
  const id = Number(c.req.param('id'))
  const sid = Number(c.req.param('sid'))
  const [shot] = await db.select().from(schema.mvShots)
    .where(and(eq(schema.mvShots.id, sid), eq(schema.mvShots.projectId, id)))
  if (!shot) return notFound(c, '镜头不存在')
  if (shot.status === 'completed' || !shot.taskId) return success(c, { shot })

  try {
    const base = await shimBase()
    const resp = await fetch(`${base}/v2/query/video_generation/${shot.taskId}`)
    const json: any = await resp.json()
    const task = json?.task || json
    const ts = now()
    if (task?.status === 'succeeded' && task?.content?.url) {
      const rel = await downloadFile(task.content.url, 'mv')
      await db.update(schema.mvShots)
        .set({ videoUrl: rel, status: 'completed', errorMsg: null, updatedAt: ts })
        .where(eq(schema.mvShots.id, sid))
      logTaskSuccess('MV', 'shot-done', { id, sid, url: rel })
    } else if (task?.status === 'failed') {
      const msg = String(task?.error?.message || task?.error || '生成失败').slice(0, 500)
      await db.update(schema.mvShots)
        .set({ status: 'failed', errorMsg: msg, updatedAt: ts })
        .where(eq(schema.mvShots.id, sid))
    }
  } catch (err: any) {
    logTaskError('MV', 'shot-status', { id, sid, error: err?.message })
  }
  const [fresh] = await db.select().from(schema.mvShots).where(eq(schema.mvShots.id, sid))
  return success(c, { shot: fresh })
})

export default app
