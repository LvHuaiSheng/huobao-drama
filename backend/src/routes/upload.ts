import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { saveUploadedFile, generateImageThumb } from '../utils/storage.js'
import { describeAssetFromImage, type AssetKind } from '../services/asset-describe.js'
import { logTaskSuccess, logTaskError } from '../utils/task-logger.js'

const app = new Hono()

// POST /upload/image
app.post('/image', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, '文件必填')
  }

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads', file.name)
  // 同步生成列表页缩略图，上传图与生图走同一套展示链路（失败不影响上传结果）
  await generateImageThumb(path)
  return success(c, { url: `/${path}`, path })
})

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
const VIDEO_MAX = 50 * 1024 * 1024 // 50MB

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac'])
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'])
const AUDIO_MAX = 20 * 1024 * 1024 // 20MB

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

async function saveMediaUpload(
  c: any,
  kind: 'video' | 'audio',
  allowedExt: Set<string>,
  allowedMime: Set<string>,
  maxBytes: number,
) {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return badRequest(c, '文件必填')
  }
  const label = kind === 'video' ? '视频' : '音频'
  const ext = extOf(file.name)
  // MIME 可伪造，扩展名兜底；空 / octet-stream 视为未知类型，仅按扩展名校验
  const mimeKnown = file.type && file.type !== 'application/octet-stream'
  if (!allowedExt.has(ext) || (mimeKnown && !allowedMime.has(file.type))) {
    return badRequest(c, `仅支持 ${Array.from(allowedExt).join('/')} 格式的${label}文件`)
  }
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    return badRequest(c, `${label}文件大小不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`)
  }
  const path = await saveUploadedFile(buffer, 'uploads', file.name)
  return success(c, { url: `/${path}`, path })
}

// POST /describe — 让当前文本模型按资产图写描述（只返回建议字段，**不写库**）
// 用途：上传实拍图后，资产的文字描述还是提取时凭剧本编的，与图不符会让成片锁不住。
// 前端拿到 fields 填进编辑框，用户过目后再点保存。
app.post('/describe', async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const kind = String(body?.kind || '')
  const id = Number(body?.id)
  if (!['character', 'scene', 'prop'].includes(kind) || !id) return badRequest(c, 'kind / id 必填')
  try {
    const fields = await describeAssetFromImage(kind as AssetKind, id, {
      episodeId: body?.episode_id ? Number(body.episode_id) : undefined,
    })
    logTaskSuccess('AssetDescribe', 'done', { kind, id, fields: Object.keys(fields).join(',') })
    return success(c, { fields })
  } catch (e: any) {
    logTaskError('AssetDescribe', 'route-failed', { kind, id, error: e?.message })
    return badRequest(c, e?.message || '读图失败')
  }
})

// POST /upload/video — 参考视频上传（Seedance 多模态参考用）
app.post('/video', async (c) => saveMediaUpload(c, 'video', VIDEO_EXT, VIDEO_MIME, VIDEO_MAX))

// POST /upload/audio — 参考音频上传（Seedance 多模态参考用）
app.post('/audio', async (c) => saveMediaUpload(c, 'audio', AUDIO_EXT, AUDIO_MIME, AUDIO_MAX))

export default app
