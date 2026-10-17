/**
 * 「按图写资产描述」的 IO 部分 —— 读资产图、调当前文本模型、返回建议字段
 *
 * 为什么需要：用户上传实拍图后，资产的文字描述**还是提取那一刻凭剧本编的** ——
 * 上传只写图片字段（PUT /characters|props|scenes/:id 只处理 image_url/local_path），不碰文字；
 * 而下游视频提示词**只读文字** ⇒ 文字与参考图打架 ⇒ 成片锁不住。
 * 实测（drama9「Festo-产品」道具 33/34，2026-10-17）：剧本里对产品外观一个字没写，
 * 提取却编出「正面为深色细长面板、拉丝金属外壳」；实拍是浅灰白面板 + 蓝色 FESTO 标识 +
 * 一整列黑色 RJ45 端口 ⇒ 4 条分镜的提示词里同一台驱动器被写成 3 种外观，成片必然锁不住。
 *
 * 能力来源：**当前配置的文本模型本身能读图**（2026-10-17 实测 halogen-qwen3.8-flash-next：
 * 768px 产品图 2.6s 认出外壳颜色与「FESTO」标识）⇒ 不需要新依赖、不需要新模型。
 *
 * 通道：**直连当前文本模型的 /chat/completions**（OpenAI 形状，带图）。
 * 曾经走 Mastra Agent（prompt_generator），2026-10-17 实锤**必须换掉**：那个 Agent 是「写图片/视频
 * 提示词」的，读场景图会回一段场景图片提示词（「固定机位广角镜头…三层分层构图」）⇒ 描述字段被
 * 提示词风格污染、分镜机位被锁死。⚠️ 不许 `import { generateText } from 'ai'` —— backend 没声明
 * 这个包，esbuild 打包会直接报 `Could not resolve "ai"`（voice-prompt.ts 的告诫）；用 fetch 即可。
 *
 * 只**返回建议文字、不写库**：前端填进资产编辑框，用户过目后再点保存。
 * 「问什么 / 怎么解析」在零依赖的 `asset-describe-prompt.ts` 里（可单测）。
 */
import fs from 'fs'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getTextConfig, getTextProviderBaseUrl } from './ai.js'
import { joinProviderUrl } from './adapters/url.js'
import { getAbsolutePath } from '../utils/storage.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'
import {
  buildAssetDescribeAsk, createSerialQueue, extractChatText, parseAssetDescribeReply, type AssetKind,
} from './asset-describe-prompt.js'

/**
 * 图片 → data URL。先缩到 ≤1024px 再编码：
 * 上传的实拍图常有几 MB，原图直发既慢又占 token（实测同一张 768px ≈ 50KB、2.6s 出结果）。
 */
async function imageDataUrl(relPath: string): Promise<string> {
  const abs = getAbsolutePath(relPath)
  const buf = await sharp(abs)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

/** 所有读图请求共用一条串行队列（用户连点多个资产时按点击顺序出结果，不并发抢模型） */
const enqueueDescribe = createSerialQueue()

/**
 * 直接把图发给当前文本模型（OpenAI 形状 /chat/completions）。
 *
 * 为什么不用 prompt_generator Agent（2026-10-17 实锤）：那个 Agent 的职责就是**写图片/视频提示词**
 * （挂着 scene-prompt / prop-prompt 等技能），让它读场景图，它回的是一段**场景图片提示词**
 * （「固定机位广角镜头…前景/中景/后景三层分层构图…」）—— 落进「场景描述」字段就把分镜机位锁死了，
 * 而且带上了「道具不进场景图」这类**生成侧**的话。描述任务只需要「看一张图 + 写一段话」，
 * 一个请求就够，不需要 Agent 的多步循环和工具。
 */
async function askTextModelWithImage(image: string, ask: string): Promise<string> {
  const cfg = await getTextConfig()
  let model = ''
  try { model = (JSON.parse(cfg.model || '[]') as string[])[0] || '' } catch { model = '' }
  const url = joinProviderUrl(getTextProviderBaseUrl(cfg), '/v1', '/chat/completions')
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey || ''}` },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: ask },
          { type: 'image_url', image_url: { url: image } },
        ],
      }],
      max_tokens: 1500,
    }),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`文本模型返回 ${resp.status}：${body.slice(0, 200)}`)
  }
  const text = extractChatText(await resp.json())
  if (!text.trim()) throw new Error('文本模型返回空内容（换一个文本模型再试）')
  return text
}

interface AssetRow { name: string; dramaId: number; imageUrl: string | null; localPath: string | null }

async function loadAsset(kind: AssetKind, id: number): Promise<AssetRow> {
  if (kind === 'character') {
    const [r] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
    if (!r) throw new Error('角色不存在')
    return { name: r.name, dramaId: r.dramaId, imageUrl: r.imageUrl, localPath: r.localPath }
  }
  if (kind === 'scene') {
    const [r] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, id))
    if (!r) throw new Error('场景不存在')
    return { name: r.location, dramaId: r.dramaId, imageUrl: r.imageUrl, localPath: r.localPath }
  }
  const [r] = await db.select().from(schema.props).where(eq(schema.props.id, id))
  if (!r) throw new Error('道具不存在')
  return { name: r.name, dramaId: r.dramaId, imageUrl: r.imageUrl, localPath: r.localPath }
}

/** 读资产图 → 让当前文本模型按图写描述 → 返回建议字段（**不写库**） */
export async function describeAssetFromImage(
  kind: AssetKind,
  id: number,
  opts?: { episodeId?: number },
): Promise<Record<string, string>> {
  const row = await loadAsset(kind, id)
  const rel = String(row.imageUrl || row.localPath || '')
  if (!rel) throw new Error('该资产还没有图片（先上传或生成一张）')
  if (!fs.existsSync(getAbsolutePath(rel))) throw new Error(`图片文件找不到：${rel}`)

  try {
    logTaskProgress('AssetDescribe', 'start', { kind, id, rel })
    const image = await imageDataUrl(rel)
    const text = await enqueueDescribe(() => askTextModelWithImage(image, buildAssetDescribeAsk(kind, row.name)))
    const out = parseAssetDescribeReply(kind, text)
    if (!Object.keys(out).length) throw new Error('模型没有返回可用的描述，重试一次')
    if (/或|或者|皆可|任选/.test(Object.values(out).join(' '))) {
      logTaskProgress('AssetDescribe', 'ambiguous-word', { kind, id })
    }
    return out
  } catch (err: any) {
    logTaskError('AssetDescribe', 'failed', { kind, id, error: err?.message })
    throw err
  }
}

export type { AssetKind }
