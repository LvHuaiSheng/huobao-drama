/**
 * 换装造型的「这套衣服」描述 AI 生成（2026-10-15 用户要求：换装弹窗里加 AI 生成按钮）
 *
 * 输入：角色（名字/身份/现有外观）+ 造型名（如「内搭正装」）+ 上一版描述（可选）
 * 输出：一段中文服装描述（30~80 字），直接填进弹窗的描述框，用户可再改。
 *
 * 与 services/voice-prompt.ts 同一套路（同一 Agent 通道、同一个 sanitize 纪律）：
 * ⚠️ **不要** `import { generateText } from 'ai'` —— backend/package.json 没有声明 `ai` 包，
 *    desktop 的 esbuild 打包会直接报 Could not resolve "ai" 把编包打挂（2026-10-08 实测两次失败）。
 *    走项目自己的 Mastra Agent（prompt_generator）——零新依赖，provider/模型解析与 Agent 一致。
 *
 * ⚠️ 描述直接进 `costumeEditPrompt()`（图像编辑指令），所以口径必须与之一致：
 *    四格必须是**同一套**衣服 ⇒ 每个部位只许写死唯一值，禁「或 / 皆可」这类二选一写法。
 */
import { eq, asc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'

export interface CostumeDescOptions { model?: string; configId?: number }

export interface CostumeDescChar {
  id: number
  dramaId: number
  name?: string | null
  role?: string | null
  appearance?: string | null
  styling?: string | null
}

function buildAsk(char: CostumeDescChar, label: string, prev?: string): string {
  const lines = [
    '任务：为下面这个角色的一套**换装造型**写「这套衣服的完整描述」，用于图像编辑（把角色定妆板上的衣服换成这一套）。',
    '',
    '硬规则（违反即无效）：',
    '1. 造型名就是这套衣服的定义，必须一致：先照造型名想清楚是哪一类衣物，再写细节。例：「内搭正装」=穿在外套里面的正装感衣物（衬衫/内搭+西裤这类），绝不是旗袍、晚礼服；「工装」=工作服；「晚礼服」才是礼服。',
    '2. 只写这套衣服本身，按这个顺序写全：颜色 + 款式 + 面料质感 + 内搭 + 下装 + 鞋 + 配饰（没有配饰就写「不佩戴饰品」）。',
    '3. 每个部位**必须写死唯一值**；严禁出现「或 / 皆可 / 可选 / 或者」这类二选一写法（会照成两套衣服混在一张板上）。',
    '4. 年代、场合、风格必须与这个角色现有的妆造一致（同一部剧里别突然变成另一个年代的衣服）。',
    '5. 不要写剧情、动作、表情、场景、镜头、光线、天气——那些与换衣服无关。',
    '6. 只输出这一段中文（30~80 字，一段话，不要换行、不要引号、不要序号、不要解释、不要调用任何工具）。',
  ]
  if (prev) {
    lines.push(
      '7. 必须与「上一版」明显不同：换颜色、换款式、换面料、换配饰组合，不要只改一两个字，也不要照抄。',
      `上一版（仅供避免重复用，不要出现在你的回答里）：${prev}`,
    )
  }
  lines.push(
    '',
    `角色名：${char.name || '（未命名）'}`,
    `身份：${char.role || '（未填）'}`,
    `造型名：${label}`,
    `现有妆造：${String(char.styling || '（未填）').slice(0, 120)}`,
    `现有外观：${String(char.appearance || '（未填）').slice(0, 120)}`,
  )
  return lines.join('\n')
}

/** 清洗模型输出：取首行、去引号、去前缀、限长 */
function sanitize(text: string): string {
  let s = String(text || '').split(/\r?\n/)[0].trim()
  s = s.replace(/^["'“”‘’《》]+|["'“”‘’《》]+$/g, '').trim()
  s = s.replace(/^(衣服描述|服装描述|描述|输出|答案)[:：。\s]*/i, '').trim()
  s = s.replace(/^[^：:]{0,8}[:：]\s*/, '').trim()
  if (s.length > 120) s = s.slice(0, 120)
  return s
}

/**
 * 生成「这套衣服」的描述。失败返回空串（调用方转成 400 提示），不抛异常。
 * 已有描述时不缓存（换装描述是草稿、不进库）——每次点按钮都重新生成一版。
 */
export async function generateCostumeDesc(
  char: CostumeDescChar,
  label: string,
  prev?: string,
  opts?: CostumeDescOptions,
): Promise<string> {
  try {
    logTaskProgress('CostumeDesc', 'generate', { characterId: char.id, label })
    const agent = mastra.getAgent('prompt_generator')
    if (!agent) throw new Error('prompt_generator Agent 不可用')
    const [ep] = await db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.dramaId, char.dramaId))
      .orderBy(asc(schema.episodes.id))
      .limit(1)
    const requestContext = buildAgentRequestContext({
      episodeId: ep?.id ?? 0,
      dramaId: char.dramaId,
      modelOverride: opts?.model || undefined,
      textConfigId: opts?.configId || undefined,
    })
    const res: any = await agent.generate(
      [{ role: 'user', content: buildAsk(char, label, prev) }],
      { maxSteps: 1, requestContext },
    )
    const desc = sanitize(String(res?.text || ''))
    if (!desc) throw new Error('模型返回为空')
    return desc
  } catch (err: any) {
    logTaskError('CostumeDesc', 'generate', { characterId: char.id, error: err?.message })
    return ''
  }
}

/** 自检：ask 组装 + 清洗（不调模型）。node --test 或 node 直接跑都行 */
export function __selfCheck(): void {
  const ask = buildAsk({ id: 1, dramaId: 2, name: '苏清禾', role: '主角', appearance: '清瘦' }, '正装')
  if (!ask.includes('造型名：正装') || !ask.includes('苏清禾')) throw new Error('buildAsk 缺关键行')
  if (sanitize('服装描述：黑色单排扣西装。\n第二行别要') !== '黑色单排扣西装。') throw new Error('sanitize 失败')
  if (sanitize('“白色衬衫”') !== '白色衬衫') throw new Error('sanitize 引号失败')
  if (sanitize('x'.repeat(300)).length !== 120) throw new Error('sanitize 限长失败')
  // eslint-disable-next-line no-console
  console.log('costume-prompt self-check ok')
}
