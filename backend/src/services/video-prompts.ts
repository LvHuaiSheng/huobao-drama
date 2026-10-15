/**
 * 批量视频提示词任务 — 异步为缺少 video_prompt 的分镜逐个运行 prompt_generator Agent
 * 进程内内存态：按集跟踪一份任务，运行中不重复启动；重启后状态丢失
 *
 * 2026-10-10 长度治理的最终形态（前两版都失败，教训留在这里）：
 *  v1 全文一次写完 → Agent 不数字符数（sb147 写到 7823 仍以为没超）→ 拼上风格头 8414 → 被 7000 拒
 *  v2 逼 Agent「只输出本轮那几段」→ 与技能「六个段名固定、顺序固定」正面冲突，
 *     Agent 每轮照技能输出完整六段 → 每轮都超配额 → 全部重试失败 → 整条放弃、不落库
 *     （表现：用户点了重新生成，但库里的英文版一字未改，测试还照旧报 8414）
 *  v3（本版）不与 Agent 的固有行为较劲：
 *     ① 第 1 轮照技能写**完整六段**（这本来就是它最自然的输出）
 *     ② 后端按段名切段、逐组实测
 *     ③ **只对超标的那一组**下发「压缩这一组」的重写，并容错抽取
 *        （Agent 若又输出全文，后端只取那几段，不判失败）
 *     ④ 八段全部达标才拼起来落库；任一组压不下去才整条记失败
 *  配额之和 = 5725（含换行）≤ 6200 = 全文上限 → 「每组达标 ⇒ 必然不超」。
 */
import fs from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { looksLikeChinese, stripZhPreamble, zhDialogueLines } from './zh-lang.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { getDramaStylePrompt } from './style-preset.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { buildMediaRefs } from './prompt-media.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export interface VideoPromptBatchStatus {
  status: 'running' | 'done' | 'error'
  total: number
  completed: number
  failed: number
  current_storyboard_id?: number
  started_at: string
  finished_at?: string
  error?: string
  /** ── 2026-10-14 进度显示（前端画「总进度条 + 本条进度」）──
   *  stage      = 当前这条走到哪一步：中文工作版 / 英文发送版 / 落库
   *  stage_note = 步骤细类（zh 生成中文版 / en_draft 初稿 / en_fill 补缺段 /
   *               en_rewrite 压缩重写 / en_beats 拍数校正 / en_check 中英校验）
   *  stage_step/stage_steps = 该步骤内第几轮 / 最多几轮（同一步会重试好几轮） */
  stage?: 'zh' | 'en' | 'save'
  stage_note?: string
  stage_step?: number
  stage_steps?: number
  /** 当前这条的开始时刻（前端算「本条已用」） */
  item_started_at?: string
  /** 每条的结果（成功/失败 + 耗时 + 失败原因）。前端用它画
   *  ① 绿/红分段进度条 ② 逐条流水 ③ 结束后的结果汇总（哪几条失败、为什么）。
   *  条数上界 = 本次要跑的分镜数（一次批量最多几十条），不额外限长。 */
  items: VideoPromptBatchItem[]
}

export interface VideoPromptBatchItem {
  storyboard_id: number
  storyboard_number: number | null
  ok: boolean
  /** 这一条实际耗时（秒，含内部重试） */
  seconds: number
  error?: string
}

const tasks = new Map<number, VideoPromptBatchStatus>()

/** video_prompt_en 的基准硬上限（含换行与标点），与 video-prompt 技能「英文发送版」节一致：
 *  MiniMax H3 官方 7000 字符 hard limit − 发送时拼的风格头 − 余量 ≈ 6200。
 *  ⚠️ 6220（4.0.37 起）隐含假设「风格头 ≤768 字符」；真实上限请用 promptEnLimit() 按项目算。 */
// 2026-10-16（4.0.37）：长度边界算式搬进零依赖模块 `seg-compress-gate.ts`（便于单测），此处转出以保持既有 import 不变。
export { PROMPT_EN_LIMIT, H3_PROMPT_HARD_LIMIT, PROMPT_HEAD_RESERVE, promptEnLimit } from './seg-compress-gate.js'
import { PROMPT_EN_LIMIT, H3_PROMPT_HARD_LIMIT, PROMPT_HEAD_RESERVE, promptEnLimit } from './seg-compress-gate.js'

/**
 * 按项目实际的风格头长度算 video_prompt_en 的上限（2026-10-11 加）。
 *
 * 为什么必须动态算：7000 − 6200 − 32 = 768，即风格头一旦超过 768 字符，
 * 「正文写满 6200」+「风格头」就会 > 7000，H3 直接拒收（anime 风格头正好 768，
 * 已是临界值 —— 再往风格头里加一个字都会顶破）。风格头长度由用户在设置页改预设决定，
 * 与代码无关，所以预算必须跟着它走，而不是写死。
 *   风格头短 → 仍是 6200（行为不变）；风格头长 → 自动收紧正文预算。
 */

/** 重写轮数上限（2026-10-12 提速 A：合并重写后一轮 = 1 次请求；2026-10-15 B 方案：2 → 3 轮。
 *  理由：一条分镜常常只差几十字符（实测 sb450 只超 5 字符、sb460 超 51、sb426 超 81），
 *  多跑一轮的代价（约 45 秒）远小于整条作废、用户还得手动重来的代价。
 *  2026-10-15 二次上调 3 → 4：压缩通道修好后（字段名 `current`）实测 sb473 仍差 84 字符
 *  （全文 6284 > 6200，detail 组 3627 > 2920）—— 一轮能压掉四五百字符，多给一轮就能过线。 */
// 2026-10-15（4.0.33）：6 → 8。实测 sb483（4.0.32）：6 轮把「超 2034」压到「只超 16」，
// 第 4、6 轮模型回 0 但第 5 轮仍砍 89 —— 说明它没到底、只是轮数用完。多两轮 ≈ 多 40 秒，
// 且仅在已超限时才跑（超限时后面的质量闸已跳过），净收益远大于代价。
const MAX_SEG_RETRY = 8
// 2026-10-15：4 → 6。证据（失控第7集分镜9/sb473，10 秒 3 镜、描述只有 323 字）：
// detail 组 4272 → 4176 → 3901 → 3743 → 3631（≈110~160 字符/轮，约 14 秒/轮），
// 而硬闸是「全文 6390 ≤ 6200」→ 只差 **190 字符**、再给两轮就能过（旧值 4 轮卡死 → 整条作废）。
// 每轮成本仅约 14 秒，比整条作废便宜得多；干净条目不会进循环（见 shouldKeepCompressing）。
/** 「空转」重发上限（2026-10-15 A 方案加）：模型只回一句前言（`I'll read the storyboard context…`）
 *  或空文本、一个段名都没带回来时，**不消耗重写轮次**、原样重发，最多连续重发这么多次。
 *  实测（2026-10-10~15 的 debug 日志）：压缩轮空转率 9%（rewrite-multi-1）/ 21%（rewrite-multi-2），
 *  sb450 第一轮 0 字符、sb423 补写两轮都是 0 字符；原来空转照样吃满 2 轮配额
 *  → 两轮烧完文本一字未改 → 整条判失败（用户看到的就是「生成失败、重试还失败」）。 */
const MAX_EMPTY_RETRY = 2
/** 「缺段补写」轮数上限（原来写死在循环里的 2） */
const MAX_SEG_FILL_RETRY = 2
/** 「整体生成」的重试次数上限（2026-10-11 加）：模型偶尔只回一句开场白、不输出任何段名 */
const MAX_FULL_RETRY = 3

/** 段名 → 字符配额（顺序即文档顺序） */
const EN_SECTION_QUOTA: Array<[string, number]> = [
  // 2026-10-10 晚：撤掉自加的 CAST/BLOCKING 顶层段，回到官方 Ref2VA 六段（官方只有这六段）。
  // 配额按官方口径重配：detailed_description 官方要 350–500 英文词（≈1750–2500 字符），
  // 原 1900 卡在下限偏少 → 提到 2500；non_diegetic_music 官方要 1–3 句，原 40 写不完 → 120。
  // 合计 5720（+ 5 个换行 = 5725）≤ 6200 = 全文硬上限。
  ['subject_definitions:', SUBJECT_SECTION_QUOTA],
  ['summary:', 340],
  ['retention_analysis:', 760],
  ['detailed_description:', 2500],
  ['overall_soundscape:', 300],
  ['non_diegetic_music:', 120],
]

/** 核定/重写分组：相邻段一起处理，limit = 组内配额之和。
 *  六段配额相加 = 5720；全部达标后拼接总长 ≤ 5725 < 6200 = PROMPT_EN_LIMIT。 */
const EN_STAGES: Array<{ key: string; label: string; segs: string[]; limit: number }> = [
  { key: 'subj', label: 'subject_definitions 段', limit: SUBJECT_SECTION_QUOTA, segs: ['subject_definitions:'] },
  { key: 'summ', label: 'summary 和 retention_analysis 两段', limit: 1100, segs: ['summary:', 'retention_analysis:'] },
  {
    key: 'detail',
    label: 'detailed_description、overall_soundscape、non_diegetic_music 三段',
    limit: 2920,
    segs: ['detailed_description:', 'overall_soundscape:', 'non_diegetic_music:'],
  },
]

/** 段名标记（正则片段），用于把 Agent 输出里段名之前的解释性前言裁掉 */
const SEG_MARKERS = EN_SECTION_QUOTA.map(([s]) => s).join('|')

/** 去掉英文版里被模型照抄进来的「【…】」分组标题行（后端重写指令用 【】 分组，模型会连标题一起抄）
 *  2026-10-13 修：原正则卡了 `{2,60}`，而 `【detailed_description、overall_soundscape、non_diegetic_music 三段】`
 *  是 63 字符 → 没被清掉、落库成中文（吃播第4集分镜1 实测）。现在放宽到 300 并支持「标题+段名同一行」。
 *  英文版正文里不该出现整行 【…】 —— 一律清掉。 */
export function sanitizeEnPrompt(t: string): string {
  const cleaned = String(t || '')
    .replace(/^[ \t]*【[^】]{1,300}】[ \t]*$/gm, '')
    .replace(/^[ \t]*【[^】]{1,300}】[ \t]*(?=[a-z_]+:)/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return stripStrayChinese(cleaned).text
}

/** 机械清理「紧贴英文词的游离中文」（2026-10-14 加，实测 sb419/422/425）
 *
 *  症状：英文发送版里出现 `the pale marble floor carries mirrored倒影 rendered as …`、
 *  `only the thin碎碎 whisper of the guests`、`a rising wave of whispered议论, skirt hems` ——
 *  模型把想说的中文词跟在英文词后面（同一概念的翻译残留）。语言闸能抓到，但重写指令把中文一律
 *  当「哪几拍出现」类标注，模型认为没有标注可改 → 一轮重写后原样保留（日志 en-cn-unresolved）。
 *
 *  修法：机械删除「**前一个字符是 ASCII 字母** 且 **后一个字符是字母/空白/标点**」的 1~4 字中文串。
 *  安全性：① `<d>…</d>` 台词块整段跳过（台词本来就是中文）；② 画面内中文文字（招牌/字幕）在英文版里
 *  总是带引号且前后有空格，不满足「紧贴字母」条件，不会被误伤；③ 只处理 ≤4 字（更长的中文串交给
 *  语言闸的 AI 重写，机械删可能丢语义）。
 */
export function stripStrayChinese(en: string): { text: string; stripped: string[] } {
  if (!en) return { text: en, stripped: [] }
  const stripped: string[] = []
  const parts = String(en).split(/(<d>[\s\S]*?<\/d>)/g)
  const out = parts.map((seg, idx) => {
    if (idx % 2 === 1) return seg // <d> 台词块：原样保留
    return seg.replace(/([A-Za-z])([\u4e00-\u9fff]{1,4})(?=[A-Za-z\s,.;:!?)\]])/g, (_m, ascii: string, cn: string) => {
      stripped.push(cn)
      return ascii
    })
  })
  return { text: out.join(''), stripped }
}

/** 英文版 `<d>…</d>` 台词之外的汉字（个数 + 首个样例）—— 语言闸用 */
/** 英文版语言闸：见 `./en-cn-gate.ts`（零依赖、可单测）——引号里的画面内文字不算违规 */

/** 动作类否定句检测（2026-10-14 加，实测 sb421）
 *  本链路是 BasicGuider + cfg=1，**没有负向分支** —— `he does not turn his head or slow down`
 *  不扣分，反而把 turn his head / slow down 当正面描述喂给模型，成片里他真的停下并转向她。
 *  判据：同一子句里「否定词 + 动作动词」。ACT 表故意只收**会改变画面的动作/朝向动词**：
 *    · 不收 `speak` —— 「No one speaks in this shot」是本规则**要求写**的音频声明（15+ 条真实数据命中），
 *      收进来会把每一条都误报；
 *    · 不收 `face/faces` —— 「never a repeated face」「never detailed faces」是背景群演防重复的正当约束；
 *      只留 `facing`（`never facing the lens` 才是真该改的动作约束）。
 *  于是数量锁（never duplicated）、画面音频属性（no gradients / no human voice）、
 *  官方锁嘴句（lips remain completely closed）、音色参考（without copying the original signal）
 *  这些正当否定天然不命中，不需要额外白名单。 */
export function findNegatedAction(en: string): { count: number; sample: string } {
  if (!en) return { count: 0, sample: '' }
  const body = String(en).replace(/<d>[\s\S]*?<\/d>/g, ' ')
  const NEG = "(?:does not|do not|doesn't|don't|never|without|no one|nobody|cannot|can't|fails to|is not|are not|was not|were not)"
  const ACT = '(?:turn|turns|turning|look|looks|looking|glance|glances|stop|stops|stopping|slow|slows|slowing|move|moves|moving|react|reacts|respond|responds|nod|nods|smile|smiles|reach|reaches|touch|touches|lift|lifts|raise|raises|pause|pauses|hesitate|hesitates|walk|walks|walking|facing|head|heads)'
  // 「没人提高嗓门」这类仍是音频声明（不改变画面），放过
  const WHITELIST = ['their voice', 'his voice', 'her voice']
  const re = new RegExp(`${NEG}\\s+(?:\\w+\\s+){0,2}?${ACT}\\b`, 'gi')
  const hits: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const hit = m[0].trim()
    // 白名单按「命中处往后 30 字符」判（匹配常停在动词上，如 `no one raises` + `their voice`）
    const win = body.slice(m.index, m.index + m[0].length + 30).toLowerCase()
    if (WHITELIST.some(w => win.includes(w))) continue
    hits.push(hit)
  }
  return { count: hits.length, sample: hits.slice(0, 3).join(' | ') }
}

/** 落库前的源头兜底（2026-10-13，用户要求「不能只靠体检」）：机械清掉越界的主体/参考图编号。
 *  实测模型仍会给「没被提取成道具资产」的东西编 `<Subject 3>`（甚至 `<Picture 3>`），规则层治不住 100%。
 *  做法（确定性，不依赖模型）：
 *    ① N > refCount 的整行 `<Subject N> …` → 删掉该行；若它是 `is …` 声明，记下名词短语
 *    ② 正文里同编号的引用 → 换成记下的名词短语（没记到就用 the object）
 *    ③ N > refCount 的 `<Picture N>` 标记 → 直接删标记（保留周围文字）
 *  合法编号（N ≤ refCount）与 `<d>` 台词一字不动。
 */
export function stripOutOfRangeRefs(t: string, refCount: number): { text: string; stripped: string[] } {
  const src = String(t || '')
  if (!refCount || refCount <= 0) return { text: src, stripped: [] }
  const stripped: string[] = []
  const names = new Map<number, string>()
  const kept: string[] = []
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*<Subject (\d+)>(?=[\s(（:：]|$)/)
    if (m && Number(m[1]) > refCount) {
      const decl = line.match(/^\s*<Subject (\d+)>\s*(?:is|是)\s+(.{2,90}?)(?:[,，.。;；]|$)/)
      names.set(Number(m[1]), decl ? decl[2].trim() : '')
      stripped.push(`删行 <Subject ${m[1]}>（超出 ${refCount} 张参考图）`)
      continue
    }
    kept.push(line)
  }
  let out = kept.join('\n')
  for (const n of [...names.keys()].sort((a, b) => a - b)) {
    const noun = names.get(n) || 'the object'
    out = out.replace(new RegExp(`<Subject ${n}>`, 'g'), noun)
  }
  out = out.replace(/<Subject (\d+)>/g, (whole, d) => (Number(d) > refCount ? `the object${(stripped.push(`删引用 <Subject ${d}>`), '')}` : whole))
  // 越界 <Picture N>：先把「介词 + 标记」整体删掉（`in <Picture 3>` → 空），再删裸标记；
  // 不留 the prop 这类占位词，避免读起来别扭。
  out = out.replace(/\b(?:in|on|from|per|see|shown in|as in)\s+<Picture (\d+)>/gi, (whole, d) =>
    (Number(d) > refCount ? `_DEL_${(stripped.push(`删引用 <Picture ${d}>（含介词）`), '')}` : whole))
  out = out.replace(/<Picture (\d+)>/g, (whole, d) => (Number(d) > refCount ? `_DEL_${(stripped.push(`删引用 <Picture ${d}>`), '')}` : whole))
  out = out.replace(/_DEL_/g, '')
  // 清掉标记被删后留下的空壳（成对括号、多余空格、行首尾空格）
  out = out
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,;.])/g, '$1')
    .replace(/[ \t]+([,;.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: out, stripped }
}

/** 清洗 Agent 输出：去代码块围栏、去段名之前的废话、去尾部结语。循环跑到稳定
 *  （围栏与前言同时出现时单趟清理会残留尾部围栏）。 */
function cleanSegText(raw: string): string {
  let s = String(raw || '').trim()
  for (let i = 0; i < 4; i++) {
    const before = s
    s = s.replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    s = s.replace(/\n?\s*```\s*$/, '')
    const at = s.search(new RegExp(`(?:^|\\n)(?:${SEG_MARKERS})`))
    if (at > 0) s = s.slice(at)
    s = s.replace(/\n+(?:以上[^\n]{0,80}|希望对[^\n]{0,80}|如需[^\n]{0,80})\s*$/, '')
    s = s.trim()
    if (s === before) break
  }
  return s
}

/** 按段名切段 → Map<段名, 内容>（段名优先按行首匹配，切不出任何段返回空 Map） */
function splitEnSections(t: string): Map<string, string> {
  const found = EN_SECTION_QUOTA
    .map(([seg]) => {
      const at = t.indexOf('\n' + seg)
      return { seg, i: at >= 0 ? at + 1 : t.indexOf(seg) }
    })
    .filter(x => x.i >= 0)
    .sort((a, b) => a.i - b.i)
  const m = new Map<string, string>()
  found.forEach((p, n) => {
    const end = n + 1 < found.length ? found[n + 1].i - 1 : t.length
    m.set(p.seg, t.slice(p.i, end).trim())
  })
  return m
}

/** 从任意输出里抽出指定几段（Agent 不听话又输出全文也能救回来；缺任一指定段返回 null）
 *  ⚠️ 2026-10-15 起**只用于「从已定稿文本里取某组当重写输入」**（`cur`），不再用于写回判定 ——
 *  写回一律走 `writeBackSections`（逐段写回，缺段不再整轮丢弃）。 */
function extractSections(raw: string, segs: string[]): string | null {
  const m = splitEnSections(raw)
  const picked: string[] = []
  for (const s of segs) {
    const v = m.get(s)
    if (!v) return null
    picked.push(v)
  }
  return picked.join('\n')
}

/** 逐段写回：把重建输出里**实际带回的段**写进 parts，返回写回了哪几段（纯函数，可离线干跑）。
 *
 *  2026-10-15 修（A 方案）：原来要求「请求的段全都带回来」才写 —— extractSections 缺任一段就返回 null、
 *  writeBack 直接 return，**整轮输出被丢弃**；而模型经常只回其中两段 → 它已经压好的那部分也被扔掉，
 *  下一轮报的问题一字不差（实测 sb421/sb450/sb432：连续两轮「实测 1716/1298/3347」完全相同 = 整轮白跑，
 *  占全部连续重写轮对的 26%）。现在有一段就写一段，缺的段留给后续轮次/补写。
 */
export function writeBackSections(parts: Map<string, string>, raw: string, segs: string[]): string[] {
  const got = splitEnSections(raw)
  const written: string[] = []
  for (const s of segs) {
    const v = got.get(s)
    // 只认「段名后面真有内容」的段：实测模型会只回一行光秃秃的段名（`subject_definitions:`），
    // 写进去会把该段清空、而 groupProblem 只查段名在不在 → 空壳会被当成合格段落落库。
    const body = v ? (v.startsWith(s) ? v.slice(s.length) : v).trim() : ''
    if (v && body) {
      parts.set(s, v)
      written.push(s)
    }
  }
  return written
}

/** 重写/补写轮次的计数推进（纯函数，可离线干跑）：
 *  - 带回内容（`wroteAny`）→ 消耗一轮；
 *  - 空转（模型只回前言/空文本）→ **不消耗轮次**，只累加 emptyStreak，最多连续 maxEmpty 次；
 *    连续空转超过上限才消耗一轮往前走（否则会死循环）。
 *  返回的 `consumed=false` 表示调用方应当原样重发、不要推进轮次计数。 */
export function advanceRewriteState(
  state: { round: number; emptyStreak: number },
  wroteAny: boolean,
  maxEmpty: number = MAX_EMPTY_RETRY,
): { round: number; emptyStreak: number; consumed: boolean } {
  if (wroteAny) return { round: state.round + 1, emptyStreak: 0, consumed: true }
  const streak = state.emptyStreak + 1
  if (streak <= maxEmpty) return { round: state.round, emptyStreak: streak, consumed: false }
  return { round: state.round + 1, emptyStreak: 0, consumed: true }
}

/** 某组内容是否合格：非空、段名齐全、且不超该组配额 */
function groupProblem(text: string, stage: { segs: string[]; limit: number }): string | null {
  if (!text) return '这一组没有内容'
  const missing = stage.segs.filter(mk => !text.includes(mk))
  if (missing.length) return `缺少这些段：${missing.join(' ')}`
  if (text.length > stage.limit) return `实测 ${text.length} 字符，超 ${stage.limit} 上限 ${text.length - stage.limit} 字符`
  return null
}

/**
 * 道具参考图引用闸（纯函数在 ./prop-text-gates.ts，可脱离 DB/Agent 模块图单测）
 *
 * 2026-10-14 晚修正：上一版还加了「有参考图却写『看不清』」的闸（findIllegibleWithPropRef）——
 * **判据是错的，已撤掉**。证据：用户认可、工作正常的 sb431 稿子里本来就写着
 * `illegible character blocks, no readable text`，说明这句话并不妨碍道具锁定；
 * 而那道闸的改写指令（要求「逐字复刻每一行字」）反而把 sb432 弄得更差。
 * 道具锁不住的真正差异见 video-prompt 技能「道具镜必须绝对静止」一节。
 */
import { findDanglingPropRef } from './prop-text-gates.js'
import { shouldKeepCompressing, shouldRegenerateDraft, rosterBlock, itemBudgetLines, shouldTargetTotalOnly, SUBJECT_SECTION_QUOTA } from './seg-compress-gate.js'
import { findChineseOutsideDialogue } from './en-cn-gate.js'
import { findVoiceoverMouthAction, type VoiceoverMouthHit } from './voiceover-gates.js'
import { findRetentionMismatch, findRetentionOutfitMismatch, type RetentionMismatch, type RetentionOutfitHit } from './retention-gate.js'
import { findColourGaps, shouldRewriteForColour, colourRewriteNote } from './asset-colour-gate.js'
import { findVoiceoverOnscreenLock, type VoiceoverLockGap } from './voiceover-onscreen-gate.js'
export { findDanglingPropRef } from './prop-text-gates.js'
export { findRetentionMismatch } from './retention-gate.js'
export { findVoiceoverOnscreenLock } from './voiceover-onscreen-gate.js'

/** 本集「绑定 + 已有图」的道具数（道具参考图引用闸的输入） */
async function countEpisodePropRefs(episodeId: number): Promise<number> {
  const links = await db.select().from(schema.episodeProps).where(eq(schema.episodeProps.episodeId, episodeId))
  if (!links.length) return 0
  const ids = new Set(links.map(l => l.propId))
  const rows = await db.select().from(schema.props)
  return rows.filter(p => ids.has(p.id) && !p.deletedAt && !!(p.imageUrl || p.localPath)).length
}

/** 中英一致性程序校验：返回问题描述（null = 通过）。
 *  2026-10-10 立：英文版是 H3 唯一消费的版本，中文工作版只是给人看的 —— 两边必须逐拍对齐。
 *  否则中文版改对了时间轴、英文版还是旧的，成片照旧出问题（sb302 实测：中文 0/2/5/8 秒，
 *  英文 0/3/6/8 秒 → 第 3 拍只剩 2 秒窗口装 11 字 → 旁白拖尾原样复现）。 */
function zhEnConsistency(enText: string, zhPrompt?: string): string | null {
  if (!enText) return '英文版为空'
  // ① HTML 实体：模型偶发把 <Subject 1> 写成 &lt;Subject 1&gt;，H3 会完全不认识 → 身份绑定失效
  if (/&lt;|&gt;|&amp;/.test(enText)) {
    return '英文版出现 HTML 实体（&lt; / &gt; / &amp;）：<Subject N>/<Picture N>/<Audio N>/<d> 必须用裸尖括号'
  }
  // ①.5 旁白/画外音写法闸（2026-10-14 立，用户报「旁白还是被念出来」）：
  //      H3 只认官方那两句 —— ① 锁嘴句必须是官方原句、② 旁白主语必须带说话人编号 (Sx)。
  //      只依赖 enText，与中文工作版无关，所以放在 `if (!zhPrompt) return null` 之前。
  //      命中 → 返回 problem → 走既有重写循环（落到 detail 组），最多 2 轮，仍不达标只留痕不硬拦。
  const selfMade = enText.match(
    /(?:while\s+no\s+on-?screen\s+mouth\s+moves|since\s+nobody\s+is\s+in\s+frame|while\s+(?:her|his|its)\s+mouth\s+stays\s+shut|(?:her|his|its)\s+lips\s+do\s+not\s+move|mouth\s+stays\s+still)/i,
  )
  if (selfMade) {
    return `旁白锁嘴句用了自造写法「${selfMade[0]}」：锁嘴句只许逐字用官方原句「while her/his/its lips remain completely closed.」`
  }
  for (const m of enText.matchAll(/says\s+in\s+an\s+off-?screen\s+voiceover/gi)) {
    const at = m.index ?? 0
    const after = enText.slice(at, at + 400)
    if (!/(?:her|his|its)\s+lips\s+remain\s+completely\s+closed/i.test(after)) {
      return '画外音/旁白句后面 400 字符内没有官方锁嘴句：必须紧跟 <d> 块写「while her/his/its lips remain completely closed.」'
    }
    const before = enText.slice(Math.max(0, at - 100), at)
    if (!/\(S\d+\)/.test(before)) {
      return '画外音/旁白句的主语缺说话人编号：必须写成「<Subject N> (Sx) says in an off-screen voiceover:」（官方示例：The woman (S1) says in an off-screen voiceover:）'
    }
  }
  if (!zhPrompt) return null
  // ② 时间轴逐拍对齐：中文「X-Y秒」的起点序列 = 英文第 2 拍起的 At 00:XX.000 序列（第 1 拍无时间戳）
  const zhStarts = [...zhPrompt.matchAll(/^\s*(\d+)\s*-\s*\d+\s*秒\s*[：:]/gm)].map(m => Number(m[1]))
  const enStarts = [...enText.matchAll(/\[Shot \d+\]\s*At\s*00:(\d+)\.000/g)].map(m => Number(m[1]))
  const expect = zhStarts.slice(1)
  if (expect.length && enStarts.length && expect.join(',') !== enStarts.join(',')) {
    return `英文版每拍起始秒数 [${enStarts.join(',')}] 与中文工作版 [${zhStarts.join(',')}] 不一致；英文第 2 拍起应依次为 [${expect.join(',')}]`
  }
  // ③ 台词条数一致：中文「旁白/X说：「…」」句数 = 英文 <d> 条数
  // 2026-10-10 修：补「画外音」，此前三种合法写法里漏了一种 → 中文有画外音、英文漏 <d> 也能过检
  const zhLines = zhDialogueLines(zhPrompt).length
  const enLines = (enText.match(/<d>/g) || []).length
  if (zhLines !== enLines) {
    return `中英台词条数不一致：中文工作版 ${zhLines} 句，英文版 <d> ${enLines} 条（必须逐条对应，一句不多一句不少）`
  }
  return null
}

/** 第 1 轮指令：照技能写完整六段（与技能「六段固定、顺序固定」一致，不冲突）。
 *  ⚠️ 关键设计：**给"目标长度"而不是只给"上限"** —— 实测 Agent 对"≤6200"无感
 *  （写成 7746 仍以为没问题），但对"这段约 1500 字符"有明确落点，一次就能写到位。
 *  目标值取配额的 ~80%，合计约 4900，远低于硬上限，留足余量、也避免回头压缩（压缩要重跑，很慢）。 */
function buildFullPrompt(
  sb: { id: number; storyboardNumber: number | null },
  videoLabel: string,
  extra?: string,
  zhPrompt?: string,
  limit: number = PROMPT_EN_LIMIT,
  headLen: number = 0,
): string {
  const targets = EN_SECTION_QUOTA
    .map(([s, q]) => `${s.replace(':', '')} 约${Math.round(q * 0.8 / 10) * 10}`)
    .join(' / ')
  // 目标长度随实际上限等比例缩放（6200 → 4600~5600，即 ~74%~90%）
  const tLow = Math.round(limit * 0.74 / 50) * 50
  const tHigh = Math.round(limit * 0.9 / 50) * 50
  // 2026-10-10：中文工作版先于英文版生成，其时间轴就是本次的基准。
  // 只把「X-Y秒」那几行抽出来给英文版，避免把整份中文塞进 prompt 稀释注意力。
  const zhTimeline = zhPrompt
    ? (zhPrompt.match(/^\s*\d+\s*-\s*\d+\s*秒[：:].*$/gm) || []).join('\n')
    : ''
  // 主体清单块（rosterBlock）见 ./seg-compress-gate.ts —— 首稿/补写都会带上它，4.0.27 实测 sb481 起的修复
  return `请为分镜 #${sb.storyboardNumber}(ID:${sb.id})生成视频提示词 video_prompt_en（H3 官方 Ref2VA 六段式）。视频模型:${videoLabel}。

请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围及时长；格式与规则见 video-prompt 技能「英文发送版」节。

🔴 长度要求（**一开始就写到位，不要写完再回头压** —— 压缩必须重跑一遍，很浪费）：
- **目标长度 ${tLow}~${tHigh} 字符**（完整提示词，含换行与标点）。
- 逐段目标：${targets}
- **硬上限 ${limit} 字符**：写入时后端会校验，超了直接拒绝并要求重写。MiniMax H3 上限 7000 字符，发送时还会在最前面拼上${headLen ? `本项目 ${headLen} 字符的风格头` : '风格头'}——这部分额度**已经从这个上限里扣掉了**，不要再想"还能多写一点"。
- **宁可精炼**：每段只说必要的，形容词能省则省，但必须保住下面这些不许砍的内容。

绝不许为了压长度而砍：<d> 台词、retention_analysis 的 fully_preserved、<Picture N> 的 with 外观。
${rosterBlock(zhPrompt)}
${zhTimeline ? `
🔴🔴 **时间轴基准（本次中文工作版已定，必须逐拍对齐，绝不许自己另算）**：
中文工作版每一拍的起止秒数如下 —— 英文版第 N 拍的 \`[Shot N] At MM:SS.mmm\` **起始秒数必须与中文第 N 拍的起点逐拍一致**（例：中文第 2 拍 \`6-10秒\` → 英文 \`[Shot 2] At 00:06.000\`）。第 1 拍不带时间戳。**中文版改了时间轴，英文版就必须跟着改。**

${zhTimeline}
` : ''}
${extra ? `\n\n【补充说明 — 必须在生成时逐条满足】\n${extra}\n（若该分镜已有 video_prompt_en，read_storyboard_context 会返回现值，请在其基础上按补充说明改写，不要把补充说明当新剧情编造。）` : ''}

**直接输出提示词正文**：不要解释、前言、结语；不要用代码块围栏；不要调用任何保存工具（后端负责落库）。`
}

/** 单组重写指令：只压这一组，其他组已定稿。
 *  ⚠️ 关键是**告诉它怎么砍**：早先只写"绝不许砍 XXX"，Agent 什么都不敢删 →
 *  反复重写仍是 7746（实测 sb147 卡了 10 分钟一个字没改进去）。 */
function buildRewritePrompt(
  sb: { id: number; storyboardNumber: number | null },
  stage: { label: string; segs: string[]; limit: number },
  current: string,
  problem: string,
  attempt: number,
  extra?: string,
  zhPrompt?: string,
): string {
  const segQuota = stage.segs
    .map(s => `${s.replace(':', '')} ≤${(EN_SECTION_QUOTA.find(([k]) => k === s) || ['', 0])[1]}`)
    .join(' / ')
  // 2026-10-13：指令里一律用 ASCII 段名，不再给模型中文分组标题 —— 实测它会把中文标题照抄进英文正文
  const segNames = stage.segs.map(s => s.replace(':', '')).join(' / ')
  const zhTimeline = zhPrompt
    ? (zhPrompt.match(/^\s*\d+\s*-\s*\d+\s*秒[：:].*$/gm) || []).join('\n')
    : ''
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en 需要局部压缩（第 ${attempt} 次）。

问题：${segNames} 这一组，${problem}。

**怎么压（照做，这些都是安全的）**：
1. 删修饰性形容词与程度词：\`wind-and-oil weathered wheat-toned skin\` → \`weathered skin\`；\`slightly\` / \`very\` / \`gently\` / \`faintly\` 一律删
2. 同一件事只说一遍：retention_analysis 说过的保留项，detailed_description 里不再复述外观细节；画面里同一动作只写一次
3. \`subject_definitions\` 每个主体只留 5~6 个辨识特征（脸型 / 发型 / 服装主色 / 关键道具），其余删
4. \`retention_analysis\` 每条压成一句话：\`<Subject N> (appears in ...): fully_preserved - <一句>\`，不要重述外观细节
5. 镜头描述去掉氛围补充：\`soft modelling\`、\`light level unchanged\`、\`consistent exposure\` 这类删掉
6. \`overall_soundscape\` 只留 3~5 个主要音效，其余删
7. 删掉所有重复的 "stays identical to the reference" 类尾句，保留一次即可
8. \`detailed_description\` 的正文**按拍均分**：每拍上限 = ⌊2500 ÷ 拍数⌋（3 拍＝每拍 ≤830 字符）——**逐拍自己数着写**，别指望回头统一砍（2026-10-15 加：实测 sb473 首稿正文 4272 字符、压 4 轮才到 3631，每轮只肯砍 100 多字符，最后差 190 字符整条作废）

**必须保留（砍了会穿帮）**：
- <d>…</d> 里的台词原文（一个字都不能改）
- 每个 Subject 的 fully_preserved 字样（retention 状态不能降级）
- <Picture N> 编号（参考图绑定）
- 主体编号与名称的对应关系
${zhTimeline ? `\n**🔴 时间轴必须与中文工作版逐拍一致（压缩时不许改动任何秒数）**：\n${zhTimeline}\n` : ''}
${extra ? `\n**压缩时仍必须继续满足补充说明**：${extra}\n` : ''}输出要求：**只压缩上面列出的这一组（${segNames}）**并压到 ≤ ${stage.limit} 字符（组内逐段：${segQuota}）；输出这一组内容（保留段名行）；其他组不用输出；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

【待压缩的原文】
${current}`
}

/** 多组合并重写指令（2026-10-12 提速 A）：把所有超标的组**一次性**交给模型压到位。
 *  原来是「每组各发一次请求」（3 组 × 最多 3 次 = 最多 9 次）→ 实测一个分镜要跑 8~12 次 LLM、
 *  最坏 617 秒。合并后最多 MAX_SEG_RETRY 次请求，长度治理的目标/怎么压/必保项全在同一个 prompt 里。 */
function buildRewriteMultiPrompt(
  sb: { id: number; storyboardNumber: number | null },
  items: Array<{ stage: { label: string; segs: string[]; limit: number }; current: string; problem: string }>,
  attempt: number,
  extra?: string,
  zhPrompt?: string,
  hard?: { len: number; limit: number; need: number },
): string {
  // 2026-10-15（4.0.34）：全文只差几十字、却要它把每组配额都压到位 → 模型追不动就一字不砍。
  //  这种情况只报全文缺口，并明说「各段不必单独达标」（详见 shouldTargetTotalOnly 注释与实测数据）。
  const totalOnly = shouldTargetTotalOnly(
    hard?.need,
    items.map(it => it.current.length - it.stage.limit),
  )
  const quotaLines = items
    .map(it => {
      const quota = it.stage.segs
        .map(s => `${s.replace(':', '')} ≤${(EN_SECTION_QUOTA.find(([k]) => k === s) || ['', 0])[1]}`)
        .join(' / ')
      // 缺段 ≠ 超标：缺段要「补写」，只喊压缩它救不回来（实测 sb354 缺 subject_definitions 后仍缺）
      const verb = /缺少|没有内容/.test(it.problem) ? `🔴 **这一段是缺失的，请补写它**（段名 + 完整内容）` : '压缩'
      const segNames = it.stage.segs.map(s => s.replace(':', '')).join(' / ')
      return totalOnly
        ? `- [${segNames}] ${verb}｜**只需全文达标，本组不必压到 ${it.stage.limit} 字符**（组内配额 ${quota} 这一轮不考核）—— 现状：${it.problem}`
        : `- [${segNames}] ${verb}｜目标 ≤ ${it.stage.limit} 字符（组内逐段：${quota}）—— 现状：${it.problem}`
    })
    .join('\n')
  const totalOnlyNote = totalOnly
    ? `
🔴 **本轮判定标准只有一条：全文 ≤ ${hard!.limit} 字符（差 ${hard!.need} 字）。各组自己的配额这一轮不考核** —— 别去追「每组都要达标」（那是砍不出来的），挑最啰嗦的形容词、氛围补充、重复复述删，全文够了就算成功。
`
    : ''
  const zhTimeline = zhPrompt
    ? (zhPrompt.match(/^\s*\d+\s*-\s*\d+\s*秒[：:].*$/gm) || []).join('\n')
    : ''
  const bodies = items.map(it => `=== ORIGINAL: ${it.stage.segs.map(s => s.replace(':', '')).join(' / ')} ===\n${it.current}`).join('\n\n')
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en 有 ${items.length} 组超标，**一次全部压到位**（第 ${attempt} 次合并压缩）。

超标组与目标：
${quotaLines}
${totalOnlyNote}${hard ? `
🔴 **本轮是硬欠账**：全文现在 **${hard.len}** 字符，硬上限 **${hard.limit}**，**本轮至少砍掉 ${hard.need} 字符**。砍不够这轮就算白跑（后端会重发、你等更久，最后可能整条作废）。**别逐词微调**——直接删整句：氛围补充（光线/气氛/明暗描写）、重复复述的外观与保留句、"stays identical to the reference" 类尾句、形容词堆叠。英文一个句子通常就是 60~120 字符，删 5~8 句就够了。
` : ''}
${rosterBlock(zhPrompt)}
${(() => {
  const lines: string[] = []
  for (const it of items) {
    if (it.stage.segs.includes('detailed_description:')) lines.push(...itemBudgetLines(it.current, 'shot', 2500))
    if (it.stage.segs.includes('subject_definitions:')) lines.push(...itemBudgetLines(it.current, 'subject', SUBJECT_SECTION_QUOTA))
  }
  return lines.length
    ? `\n🔴 **逐项点名（每一项自己数一遍字数，别只看整段）**：\n${lines.join('\n')}\n（这些是**优先下手处**：${totalOnly ? '不必每项都到目标，全文总量达标即可' : '每一项都要压到目标以内，别只压整段总量'}；压不下来就先删氛围补充与重复复述。）\n`
    : ''
})()}
**怎么压（照做，这些都是安全的）**：
1. 删修饰性形容词与程度词：\`wind-and-oil weathered wheat-toned skin\` → \`weathered skin\`；\`slightly\` / \`very\` / \`gently\` / \`faintly\` 一律删
2. 同一件事只说一遍：retention_analysis 说过的保留项，detailed_description 里不再复述外观细节；画面里同一动作只写一次
3. \`subject_definitions\` 每个主体只留 5~6 个辨识特征（脸型 / 发型 / 服装主色 / 关键道具），其余删
4. \`retention_analysis\` 每条压成一句话：\`<Subject N> (appears in ...): fully_preserved - <一句>\`，不要重述外观细节
5. 镜头描述去掉氛围补充：\`soft modelling\`、\`light level unchanged\`、\`consistent exposure\` 这类删掉
6. \`overall_soundscape\` 只留 3~5 个主要音效，其余删
7. 删掉所有重复的 "stays identical to the reference" 类尾句，保留一次即可
8. \`detailed_description\` 的正文**按拍均分**：每拍上限 = ⌊2500 ÷ 拍数⌋（3 拍＝每拍 ≤830 字符）——**逐拍自己数着写**，别指望回头统一砍（2026-10-15 加：实测 sb473 首稿正文 4272 字符、压 4 轮才到 3631，每轮只肯砍 100 多字符，最后差 190 字符整条作废）

**必须保留（砍了会穿帮）**：
- <d>…</d> 里的台词原文（一个字都不能改）
- 每个 Subject 的 fully_preserved 字样（retention 状态不能降级）
- <Picture N> 编号（参考图绑定）
- 主体编号与名称的对应关系
${zhTimeline ? `\n**🔴 时间轴必须与中文工作版逐拍一致（压缩时不许改动任何秒数）**：\n${zhTimeline}\n` : ''}
${extra ? `\n**压缩时仍必须继续满足补充说明**：${extra}\n` : ''}输出要求：**上面列出的每一组都要处理到位**（标了「补写」的写全，其余压到配额内），按组输出、每组保留自己的段名行；**不要输出未列出的组**；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

${bodies}`
}

/** 诊断日志：把每轮 Agent 的原始输出记到 data/debug/video-prompt.log，便于事后复盘 */
export function debugLog(episodeId: number, sbId: number, tag: string, text: string, extra?: Record<string, unknown>) {
  try {
    const dir = path.join(STORAGE_ROOT, 'debug')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'video-prompt.log'),
      JSON.stringify({ t: new Date().toISOString(), episodeId, storyboardId: sbId, tag, len: text.length, head: text.slice(0, 200), ...(extra || {}) }) + '\n',
      'utf-8',
    )
  } catch {
    /* 诊断日志失败不影响主流程 */
  }
}

/** 生成完整 video_prompt_en：整体生成 → 逐组核定 → 只重写超标组 */
async function generateEnByStages(
  agent: { generate: (m: unknown, o: unknown) => Promise<unknown> },
  sb: { id: number; storyboardNumber: number | null; description?: string | null },
  videoLabel: string,
  requestContext: unknown,
  episodeId: number,
  extra?: string,
  zhPrompt?: string,
  budget: { limit: number; headLen: number } = { limit: PROMPT_EN_LIMIT, headLen: 0 },
  onNote?: (note: string, step?: number, steps?: number) => void,
): Promise<{ text: string; ok: boolean }> {
  // 2026-10-12：本函数全程走英文发送版 —— 标记阶段，让技能注入保留共享段 + 英文专用段
  requestContext?.set?.('promptStage' as never, 'en' as never)

  // ① 整体生成：**空转可重试**（2026-10-11 加）。
  //    原注释说「不做整体重试」——那条经验只对"写得不够短要压缩"成立（重试长度几乎一样，
  //    真正有效的是下面「按组局部重写」）。但实测（sb339）模型会只回一句开场白
  //    （"I'll read the storyboard context first."，39 字符、无任何段名）然后结束，
  //    此时整单直接判失败 —— 这类"整段空转"必须重试，否则一集十几条分镜全靠碰运气。
  //    maxSteps 4 → 6（2026-10-12）：4 步是零余量（read_storyboard_context + 写正文 = 2 步），
  //    模板里任何"自检/去查/去数"类指令都会让 agent 多走一步、烧光步数后返回空文本。
  // 2026-10-15（用户拍板 B）：**首稿「写飞」就整稿重来一次**。
  //   实测依据：同两条失败分镜的首稿分别**超上限 2172 / 3418 字符**（压 6 轮也救不回来，白烧约 2 分钟），
  //   而同批成功的首稿只超 0~313 → 用「超 800」当分界：超太多就别磨，直接重采样一次
  //   （重来的一次若同样写飞，照旧走压缩/失败路径，**不再第三次**，避免无限重试）。
  const draftLen = () => EN_SECTION_QUOTA.map(([s]) => parts.get(s) || '').filter(Boolean).join('\n').length
  // DRAFT_OVER_LIMIT_RETRY 已挪到 ./seg-compress-gate.ts（连同 shouldRegenerateDraft 一起单测）
  let parts = new Map<string, string>()
  // 2026-10-15（4.0.27）：retention_analysis 与 subject_definitions 对不上（编号/服装）时，
  //   重写一轮仍不达标的**不许静默落库**（实测 sb481 缺段补写把定义段削成 1 行后照样落库，稿子表面合格、身份绑定全废）。
  let retentionBlocked = false
  /** 容错写回：Agent 若又输出全文，只取需要的段 —— 逐段写回（见 writeBackSections 的注释）。 */
  const writeBack = (raw: string, segs: string[]): string[] => writeBackSections(parts, raw, segs)
  for (let pass = 0; pass < 2; pass++) {
    // ── ① 整体生成（pass 0 = 首次；pass 1 = 首稿写飞后的重采样） ─────────────
    let full = ''
    parts = new Map<string, string>()
    for (let attempt = 1; attempt <= MAX_FULL_RETRY; attempt++) {
      onNote?.('en_draft', attempt, MAX_FULL_RETRY)
      const res = (await agent.generate(
        [{ role: 'user', content: buildFullPrompt(sb, videoLabel, extra, zhPrompt, budget.limit, budget.headLen) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      full = cleanSegText(res?.text || '')
      parts = splitEnSections(full)
      debugLog(episodeId, sb.id, attempt === 1 ? 'full' : `full-retry-${attempt}`, full, {
        under: full.length <= budget.limit,
        sections: parts.size,
      })
      // 2026-10-12：判据从「切出任何一段」改成「**六段齐**」——实测（sb354）模型首轮只输出 5 段
      //（漏 subject_definitions），旧的「有段就 break」会让残废输出过关，最后被视频侧拒发。
      if (parts.size >= EN_SECTION_QUOTA.length) break
      logTaskProgress('VideoPrompt', 'full-retry', {
        episodeId, storyboardId: sb.id, attempt, len: full.length, head: full.slice(0, 60),
      })
    }
    if (!parts.size) {
      logTaskError('VideoPrompt', 'segment-give-up', {
        episodeId, storyboardId: sb.id, stage: 'full',
        error: `整体生成 ${MAX_FULL_RETRY} 次都没切出任何段名（最后一次 ${full.length} 字符）`,
      })
      return { text: '', ok: false }
    }

    // ①.5 缺段补写（2026-10-12 加）：首轮可能整段漏掉（模型直接从 summary: 开始写）。
    //      缺段不是"超标"，压缩指令救不回来 → 单独一次「补写」请求；最多 2 轮。
    const missingSegs = () => EN_SECTION_QUOTA.map(([s]) => s).filter(s => !parts.get(s))
    const fillState = { round: 0, emptyStreak: 0 }
    let filledCount = 0   // 本轮靠「补写」补回来的段数（>0 ⇒ 禁止整稿重来，见 shouldRegenerateDraft）
    while (missingSegs().length && fillState.round < MAX_SEG_FILL_RETRY) {
      onNote?.('en_fill', fillState.round + 1, MAX_SEG_FILL_RETRY)
      const miss = missingSegs()
      logTaskProgress('VideoPrompt', 'segment-missing', { episodeId, storyboardId: sb.id, round: fillState.round + 1, missing: miss })
      const res = (await agent.generate(
        [{ role: 'user', content: buildRewriteMultiPrompt(sb, miss.map(s => {
          const stage = EN_STAGES.find(st => st.segs.includes(s)) || EN_STAGES[0]
          return { stage, current: '', problem: `缺少这一段：${s}` }
        }), fillState.round + 1, extra, zhPrompt) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, `write-missing-${fillState.round + 1}-${fillState.emptyStreak + 1}`, raw, { missing: miss })
      const written = writeBack(raw, miss)
      filledCount += written.length
      // 2026-10-15（A 方案）：补写空转（模型只回前言/空文本，实测 sb423 两轮都是 0 字符）不消耗补写轮次
      const next = advanceRewriteState(fillState, written.length > 0)
      if (!next.consumed) {
        logTaskProgress('VideoPrompt', 'segment-fill-empty', {
          episodeId, storyboardId: sb.id, round: fillState.round + 1, streak: next.emptyStreak, len: raw.length,
        })
        fillState.emptyStreak = next.emptyStreak
        continue
      }
      fillState.round = next.round
      fillState.emptyStreak = next.emptyStreak
    }

    // 首稿写飞 → 清空重来一次（pass 1）；没写飞（或已经重来过）就进 ② 压缩
    const over = draftLen() - budget.limit
    if (shouldRegenerateDraft(pass, over, missingSegs().length, filledCount)) {
      logTaskProgress('VideoPrompt', 'en-full-regenerate', {
        episodeId, storyboardId: sb.id, draft: draftLen(), over, limit: budget.limit,
      })
      for (const k of parts.keys()) parts.delete(k)
      continue
    }
    break
  }

  // ② 逐组核定 → 超标组**一次性合并重写**（2026-10-12 提速 A）。
  //    原来「每组各发一次请求」（3 组 × 最多 3 次 = 最多 9 次）→ 实测一个分镜 8~12 次 LLM、最坏 617 秒；
  //    合并后最多 MAX_SEG_RETRY 次请求，长度治理的目标/怎么压/必保项仍全在同一个 prompt 里。
  //    容错抽取不变：Agent 若又输出全文，只取需要的段；写回"最后一次输出"，保证拼接时有内容。
  const checkStages = () => EN_STAGES
    .map(stage => {
      const cur = stage.segs.map(s => parts.get(s) || '').filter(Boolean).join('\n')
      // 🔴 字段名必须叫 `current`：buildRewriteMultiPrompt 读的是 `it.current`。
      //    2026-10-15 修：这里原来叫 `cur` → 压缩指令里的 ORIGINAL 段全是字面量 `undefined`
      //    （模型的原话：「本轮附带的 ORIGINAL 三段内容均为 undefined（空），无法压缩」），
      //    整轮压缩白跑、英文版留在超标状态落库（用户报「一键修复没成功」）。
      //    这个字段名不匹配一直是 tsc 的一条既存报错（TS2345 @ 本函数调用处），改名后消失。
      return { stage, current: cur, problem: String(groupProblem(cur, stage) || '') }
    })
    .filter(x => x.problem)

  // 2026-10-12：拼装时剥掉「【…】」分组标题行 —— 那些是后端重写指令里的分组标题
  //（EN_STAGES 的 label），模型会照抄进正文（实测 sb356/分镜9 混进 2 行），必须一律清掉。
  const assemble = () => sanitizeEnPrompt(EN_SECTION_QUOTA.map(([s]) => parts.get(s) || '').filter(Boolean).join('\n'))

  let bad = checkStages()
  const rewriteState = { round: 0, emptyStreak: 0 }
  let noopStreak = 0
  // 循环条件见 shouldKeepCompressing：缺段必补；总量已达标就别再磨组配额（省时间）。
  while (shouldKeepCompressing(bad, assemble().length, budget.limit) && rewriteState.round < MAX_SEG_RETRY) {
    onNote?.('en_rewrite', rewriteState.round + 1, MAX_SEG_RETRY)
    const lenBefore = assemble().length
    const need = lenBefore - budget.limit
    logTaskProgress('VideoPrompt', 'segment-retry', {
      episodeId, storyboardId: sb.id, attempt: rewriteState.round + 1,
      stages: bad.map(b => b.stage.key), problem: bad.map(b => b.problem).join(' | '),
    })
    const res = (await agent.generate(
      // 2026-10-15：带上**硬欠账指标**（全文现在多少、上限多少、本轮至少砍多少）——
      // 实测模型每轮只肯砍 100~300 字符、后几轮只砍 20~30（sb481 六轮才从 8660 压到 6616、
      // 差 416 就作废）。光说「目标 ≤ 2920」它不当硬要求，必须点名差额。
      [{ role: 'user', content: buildRewriteMultiPrompt(sb, bad, rewriteState.round + 1, extra, zhPrompt,
        need > 0 ? { len: lenBefore, limit: budget.limit, need } : undefined) }],
      { maxSteps: 6, requestContext },
    )) as { text?: string } | undefined
    const raw = cleanSegText(res?.text || '')
    debugLog(episodeId, sb.id, `rewrite-multi-${rewriteState.round + 1}-${rewriteState.emptyStreak + 1}`, raw, {
      groups: bad.map(b => b.stage.key),
    })
    const written = writeBack(raw, bad.flatMap(b => b.stage.segs))
    // 2026-10-15 加：记下**这一轮实际砍了多少**（用来判断「硬欠账」指标有没有用、每轮是否在白磨）
    const cut = lenBefore - assemble().length
    logTaskProgress('VideoPrompt', 'segment-round-cut', {
      episodeId, storyboardId: sb.id, round: rewriteState.round + 1,
      cut, len: assemble().length, need: Math.max(0, need),
    })
    // 2026-10-15 加：**连着两轮一个字符都没砍掉就直接收工** —— 实测（同批 sb483 第 4/5/6 轮
    // 报的数字一模一样 1315/3784）模型对同一份原文会原样回一遍，再发几轮也只是重复烧时间。
    // 早收工 = 早点进「按全文裁决」（达标就落库、不达标就立刻给出拆分镜的建议）。
    if (cut <= 5) {
      noopStreak += 1
      if (noopStreak >= 2) {
        logTaskProgress('VideoPrompt', 'segment-noop-stop', {
          episodeId, storyboardId: sb.id, round: rewriteState.round + 1, len: assemble().length,
        })
        break
      }
    } else noopStreak = 0
    // 2026-10-15（A 方案）：空转不消耗轮次 —— 模型只回一句前言/空文本时原样重发，
    // 连续 MAX_EMPTY_RETRY 次仍空转才记账往前走（见 advanceRewriteState）。
    const next = advanceRewriteState(rewriteState, written.length > 0)
    if (!next.consumed) {
      logTaskProgress('VideoPrompt', 'segment-rewrite-empty', {
        episodeId, storyboardId: sb.id, attempt: rewriteState.round + 1,
        streak: next.emptyStreak, len: raw.length, head: raw.slice(0, 60),
      })
      rewriteState.emptyStreak = next.emptyStreak
      continue
    }
    rewriteState.round = next.round
    rewriteState.emptyStreak = next.emptyStreak
    bad = checkStages()
  }
  // 不立刻放弃：没压到位的组记下来，最后按「全文是否 ≤ 硬上限」统一裁决
  //（个别组略超自己的配额可以容忍，不该让整条作废）
  const failedStages: Array<{ key: string; problem: string }> = bad.map(b => ({ key: b.stage.key, problem: String(b.problem || '') }))
  if (failedStages.length) {
    logTaskProgress('VideoPrompt', 'segment-over-quota', {
      episodeId, storyboardId: sb.id, stages: failedStages.map(f => `${f.key}: ${f.problem}`),
    })
  }

  // ③ 按文档顺序拼接 + 统一裁决
  let text = assemble()
  debugLog(episodeId, sb.id, 'assembled', text, {
    segments: EN_SECTION_QUOTA.filter(([s]) => parts.get(s)).length,
    under: text.length > 0 && text.length <= budget.limit,
    failedStages: failedStages.map(f => f.key),
  })

  // ③.2 六段齐全闸（2026-10-12 加）：缺任一段 = 残废提示词，绝不能落库 ——
  //      以前拼装是 `parts.get(段名) || ''` 静默跳过，结果 5 段提示词进了库，
  //      直到"生成视频"那一步才被拒（sb354 分镜7 实测：报「不是六段式，已拒绝发」）。
  const stillMissing = EN_SECTION_QUOTA.map(([s]) => s).filter(s => !parts.get(s))
  if (stillMissing.length) {
    logTaskError('VideoPrompt', 'segment-give-up', {
      episodeId, storyboardId: sb.id, stage: 'six-sections',
      error: `六段不全，缺：${stillMissing.join(' ')}（补写与重写都没救回来）`,
    })
    return { text: '', ok: false }
  }

  // ③.3 英文版拍数硬校验（2026-10-12 加）：中文工作版早就有这道闸，英文版一直没有 →
  //      实测 sb356(分镜9) description 只有 2 个【镜头】，英文版却写了 3 拍（0-3/3-6/6-9），
  //      成片会多切一刀（假切点复发）。不符就带「必须 N 拍、上一版 M 拍」重写，最多 2 轮；
  //      2026-10-15：改成**逐段写回**（拿回几段用几段），并在改写后顶破硬上限时回滚。
  const expBeats = ((sb.description || '').match(/【镜头/g) || []).length
  if (expBeats) {
    for (let round = 0; round < 2; round++) {
      onNote?.('en_beats', round + 1, 2)
      const gotBeats = countEnBeats(text)
      if (gotBeats === expBeats) break
      logTaskProgress('VideoPrompt', 'en-beat-count-retry', {
        episodeId, storyboardId: sb.id, round: round + 1, expected: expBeats, got: gotBeats,
      })
      const res = (await agent.generate(
        [{ role: 'user', content: buildBeatFixPrompt(sb, text, expBeats, gotBeats, extra, zhPrompt) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, `beat-fix-${round + 1}`, raw, { expected: expBeats, got: gotBeats })
      const snapshot = new Map(parts)
      if (writeBack(raw, EN_SECTION_QUOTA.map(([k]) => k)).length) {
        text = assemble()
        if (text.length > budget.limit) {
          // 2026-10-15（B 方案）：后置校验轮把文本改长、顶破硬上限时回滚 ——
          // 否则整条分镜会因为「结构改对了但变长了」而判失败（实测 sb432：7208 被语言闸改成 7315 后 give-up）。
          for (const k of [...parts.keys()]) parts.delete(k)
          for (const [k, v] of snapshot) parts.set(k, v)
          text = assemble()
          logTaskProgress('VideoPrompt', 'beat-fix-rollback-over-limit', {
            episodeId, storyboardId: sb.id, limit: budget.limit,
          })
          break
        }
      }
    }
    const finalBeats = countEnBeats(text)
    if (finalBeats !== expBeats) {
      logTaskProgress('VideoPrompt', 'en-beat-count-unresolved', {
        episodeId, storyboardId: sb.id, expected: expBeats, got: finalBeats,
      })
    }
  }

  // ③.4 英文版语言闸（2026-10-13 加：源头修，不靠体检）—— 英文版正文除 <d>…</d> 台词外不许有中文。
  //      已由 assemble/sanitizeEnPrompt 清掉「照抄分组标题」那一类；这里兜住其它类（模型自己写的中文标注）：
  //      带「只改这几处中文」的指令重写 1 轮；2026-10-15 起逐段写回，顶破硬上限时回滚。
  {
    let cn = findChineseOutsideDialogue(text)
    if (cn.count) {
      logTaskProgress('VideoPrompt', 'en-cn-detected', {
        episodeId, storyboardId: sb.id, count: cn.count, sample: cn.sample,
      })
      const res = (await agent.generate(
        [{ role: 'user', content: buildChineseFixPrompt(sb, text, cn.sample) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, 'en-cn-fix-1', raw, { count: cn.count })
      const snapshot = new Map(parts)
      if (writeBack(raw, EN_SECTION_QUOTA.map(([k]) => k)).length) {
        text = assemble()
        if (text.length > budget.limit) {
          // 2026-10-15（B 方案）：语言修复轮把文本改长、顶破硬上限 → 回滚（宁留少量中文也不整条作废；
          // 紧贴英文词的游离中文在 assemble 前已被 stripStrayChinese 机械清掉）。
          for (const k of [...parts.keys()]) parts.delete(k)
          for (const [k, v] of snapshot) parts.set(k, v)
          text = assemble()
          logTaskProgress('VideoPrompt', 'en-cn-fix-rollback-over-limit', {
            episodeId, storyboardId: sb.id, limit: budget.limit,
          })
        }
      }
      cn = findChineseOutsideDialogue(text)
      if (cn.count) {
        logTaskProgress('VideoPrompt', 'en-cn-unresolved', {
          episodeId, storyboardId: sb.id, count: cn.count, sample: cn.sample,
        })
      }
    }
  }

  // 2026-10-15（4.0.32）：**全文已超硬上限时，下面所有质量/格式闸全部跳过**（③.5 起，含 zh-en 一致性）。
  //   实测 sb483：全文 6703 已注定失败（under=false → 下面直接 return ok:false），可 4 次闸改写
  //  （zh-en-fix / voiceover-mouth / voiceover-onscreen-lock / colour-fix）**全部 rollback-over-limit**，
  //   白烧约 90 秒、什么都没改出来。超限时改稿必然是「越改越长或原样」，改了也救不回长度。
  //   4.0.33 修正：③.5（zh-en 一致性）原在 `overLimit` 声明之前，漏跳了一次（sb483 实测白烧 12 秒）。
  const overLimit = text.length > budget.limit
  if (overLimit) {
    logTaskProgress('VideoPrompt', 'gates-skipped-over-limit', {
      episodeId, storyboardId: sb.id, len: text.length, limit: budget.limit,
    })
  }

  // ③.5 中英一致性程序校验（时间轴逐拍对齐 / 台词条数一致 / 无 HTML 实体）
  //      不合格 → 自动重写对应的组（时间轴/台词在 detail 组；HTML 实体在它出现的组），
  //      最多 2 轮；仍不达标则留痕放行（不硬拦，避免像 sb147 那样卡死）
  //      2026-10-12 挪到「③.3 拍数修复」**之后**（原来在它之前）：拍数修复会重写时间戳，
  //      先跑校验会被它推翻 → 结构先定、时间轴最后过闸（实测 sb362：中文 2 秒起、
  //      英文被拍数修复改成 At 00:04.000，而校验是在改写之前跑的，没人复核）。
  if (!overLimit) {
    let problem = zhEnConsistency(text, zhPrompt)
    for (let attempt = 0; problem && attempt < 2; attempt++) {
      onNote?.('en_check', attempt + 1, 2)
      logTaskProgress('VideoPrompt', 'zh-en-fix', {
        episodeId, storyboardId: sb.id, attempt: attempt + 1, problem,
      })
      const snapshot = new Map(parts)
      // 选要重写的组：HTML 实体散落在哪段就重写哪段（实体常见于 subject_definitions）；
      // 时间轴 / 台词条数的问题都在 detailed_description 所在的 detail 组。
      const targets = /HTML 实体/.test(problem)
        ? EN_STAGES.filter(st => st.segs.some(sg => /&lt;|&gt;|&amp;/.test(parts.get(sg) || '')))
        : [EN_STAGES[EN_STAGES.length - 1]]
      const list = targets.length ? targets : [EN_STAGES[EN_STAGES.length - 1]]
      for (const st of list) {
        const cur = extractSections(text, st.segs) || ''
        const res2 = (await agent.generate(
          [{ role: 'user', content: buildRewritePrompt(sb, st, cur, problem, attempt + 1, extra, zhPrompt) }],
          { maxSteps: 6, requestContext },
        )) as { text?: string } | undefined
        const raw = cleanSegText(res2?.text || '')
        debugLog(episodeId, sb.id, `fix-zhen-${attempt + 1}-${st.key}`, raw, { problem })
        writeBack(raw, st.segs)
      }
      text = assemble()
      if (text.length > budget.limit) {
        // 2026-10-15（B 方案）：中英一致性修复把文本改长、顶破硬上限 → 回滚并收工
        //（继续用同一版重跑只会再改长一次）
        for (const k of [...parts.keys()]) parts.delete(k)
        for (const [k, v] of snapshot) parts.set(k, v)
        text = assemble()
        logTaskProgress('VideoPrompt', 'zh-en-fix-rollback-over-limit', {
          episodeId, storyboardId: sb.id, limit: budget.limit,
        })
        break
      }
      problem = zhEnConsistency(text, zhPrompt)
    }
    if (problem) {
      logTaskProgress('VideoPrompt', 'zh-en-unresolved', { episodeId, storyboardId: sb.id, problem })
    }
    // 时间轴校正可能又把拍数改坏 → 复核一次，只留痕（结构问题下次生成会再拦）
    const beatsAfterFix = countEnBeats(text)
    if (expBeats && beatsAfterFix !== expBeats) {
      logTaskProgress('VideoPrompt', 'en-beat-count-after-zhen', {
        episodeId, storyboardId: sb.id, expected: expBeats, got: beatsAfterFix,
      })
    }
  }

  // 本集「绑定 + 已有图」的道具数：③.6（没图却写照抄）/ ③.7（否定句重写）共用
  const propRefCount = await countEpisodePropRefs(episodeId)

  // 本分镜「角色」主体的编号（按参考图顺序，供 ③.11 画外音锁嘴闸用）
  const charSubjects = (await buildMediaRefs(sb.id)).refs
    .filter(r => r.kind === 'character').map(r => r.picture)

  // ③.6 道具参考图引用闸（2026-10-14 加，实测 sb393/sb394）
  //      提示词写了「照抄道具参考图」但本集根本没有道具参考图 → 指向不存在的资源
  //      （中文工作版那句会误导审片；英文版那句会让屏幕文字没有锁 → H3 自己编字）。
  //      不合格 → 重写 detail 组，最多 2 轮；仍不达标留痕放行（不硬拦）。
  {
    let dangling = findDanglingPropRef(text, propRefCount)
    for (let attempt = 0; dangling && attempt < 2; attempt++) {
      logTaskProgress('VideoPrompt', 'prop-ref-dangling', {
        episodeId, storyboardId: sb.id, attempt: attempt + 1, propRefCount, problem: dangling,
      })
      const snapshot = new Map(parts)
      const st = EN_STAGES[EN_STAGES.length - 1]
      const cur = extractSections(text, st.segs) || ''
      const res3 = (await agent.generate(
        [{ role: 'user', content: buildRewritePrompt(sb, st, cur, dangling, attempt + 1, extra, zhPrompt) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res3?.text || '')
      debugLog(episodeId, sb.id, `fix-propref-${attempt + 1}`, raw, { problem: dangling })
      writeBack(raw, st.segs)
      text = assemble()
      if (text.length > budget.limit) {
        // 2026-10-15（B 方案）：后置校验轮把文本改长、顶破硬上限 → 回滚（保命优先：这条分镜还能落库）
        for (const k of [...parts.keys()]) parts.delete(k)
        for (const [k, v] of snapshot) parts.set(k, v)
        text = assemble()
        logTaskProgress('VideoPrompt', 'prop-ref-rollback-over-limit', {
          episodeId, storyboardId: sb.id, limit: budget.limit,
        })
        break
      }
      dangling = findDanglingPropRef(text, propRefCount)
    }
    if (dangling) {
      logTaskProgress('VideoPrompt', 'prop-ref-unresolved', { episodeId, storyboardId: sb.id, problem: dangling })
    }
  }

  // ③.7 动作类否定句闸（2026-10-14 加，实测 sb421）
  //      本链路 BasicGuider + cfg=1，没有负向分支 —— `he does not turn his head or slow down`
  //      不扣分，反而把 turn his head / slow down 当正面描述喂给模型，成片里他真停下、真转向她。
  //      命中 → 带「改成正面描述」指令重写 1 轮（输出完整六段，拿不全就保留原版）；
  //      仍不达标只留痕放行（不硬拦）。重写后若总长超出硬上限 → 回滚，避免把整条分镜做废。
  {
    let na = findNegatedAction(text)
    if (na.count) {
      logTaskProgress('VideoPrompt', 'negated-action-detected', {
        episodeId, storyboardId: sb.id, count: na.count, sample: na.sample,
      })
      const snapshot = new Map(parts)
      const res = (await agent.generate(
        [{ role: 'user', content: buildNegatedActionFixPrompt(sb, text, na.sample) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, 'negated-action-fix-1', raw, { count: na.count })
      if (writeBack(raw, EN_SECTION_QUOTA.map(([k]) => k)).length) {
        text = assemble()
        if (text.length > budget.limit) {
          // 正面描述通常更长 → 顶破硬上限就回滚（宁可留着否定句，也不能让整条分镜落库失败）
          for (const k of parts.keys()) parts.delete(k)
          for (const [k, v] of snapshot) parts.set(k, v)
          text = assemble()
          logTaskProgress('VideoPrompt', 'negated-action-rollback-over-limit', {
            episodeId, storyboardId: sb.id, limit: budget.limit,
          })
        }
      }
      na = findNegatedAction(text)
      if (na.count) {
        logTaskProgress('VideoPrompt', 'negated-action-unresolved', {
          episodeId, storyboardId: sb.id, count: na.count, sample: na.sample,
        })
      }
    }
  }

  // ③.9 画外音拍「多出来的嘴」闸（2026-10-14 加，实测 sb437「顾明轩念出苏清禾的台词」）
  //      该拍台词是画外音（`says in an off-screen voiceover` + 锁嘴句，写法完全合规），
  //      但同一拍里画面内的另一个角色被写了嘴部动作（`His lips part to a narrow gap and close again`）→
  //      H3 把台词安在那个张嘴的人身上。命中 → 带指令重写 1 轮（嘴部动作改成不含嘴部的写法）；
  //      仍不达标只留痕放行；重写后顶破硬上限 → 回滚。
  if (!overLimit) {
    let vm: VoiceoverMouthHit[] = findVoiceoverMouthAction(text)
    if (vm.length) {
      logTaskProgress('VideoPrompt', 'voiceover-mouth-detected', {
        episodeId, storyboardId: sb.id, count: vm.length,
        shots: vm.map(h => h.shot).join(','), sample: vm.map(h => h.sample).join(' | '),
      })
      const snapshot = new Map(parts)
      const res = (await agent.generate(
        [{ role: 'user', content: buildVoiceoverMouthFixPrompt(sb, text, vm) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, 'voiceover-mouth-fix-1', raw, { count: vm.length })
      if (writeBack(raw, EN_SECTION_QUOTA.map(([k]) => k)).length) {
        text = assemble()
        if (text.length > budget.limit) {
          for (const k of parts.keys()) parts.delete(k)
          for (const [k, v] of snapshot) parts.set(k, v)
          text = assemble()
          logTaskProgress('VideoPrompt', 'voiceover-mouth-rollback-over-limit', {
            episodeId, storyboardId: sb.id, limit: budget.limit,
          })
        }
      }
      vm = findVoiceoverMouthAction(text)
      if (vm.length) {
        logTaskProgress('VideoPrompt', 'voiceover-mouth-unresolved', {
          episodeId, storyboardId: sb.id, count: vm.length,
          shots: vm.map(h => h.shot).join(','), sample: vm.map(h => h.sample).join(' | '),
        })
      }
    }
  }

  // ③.10 retention_analysis 覆盖闸（2026-10-14 加，实测 sb432：道具整片没参考）
  //      参考图与 RefMod 卡都已进工作流（运行时图核对过），但 retention_analysis 漏了道具主体、
  //      且编号整体错位（继承上一版提示词 + 主体重新编号所致）→ 模型没有保留声明，就不保它。
  //      判据：retention_analysis 的 <Subject N> 集合必须与 subject_definitions 完全一致。
  //      命中 → 带指令重写 1 轮；仍不达标只留痕放行；重写后顶破硬上限 → 回滚。
  if (!overLimit) {
    let rm: RetentionMismatch | null = findRetentionMismatch(text)
    let outfit = findRetentionOutfitMismatch(text)
    if (rm || outfit.length) {
      if (rm) {
        logTaskProgress('VideoPrompt', 'retention-mismatch-detected', {
          episodeId, storyboardId: sb.id,
          defined: rm.defined.join(','), listed: rm.listed.join(','),
          missing: rm.missing.join(','), extra: rm.extra.join(','),
        })
      }
      if (outfit.length) {
        // 2026-10-15 加：保留项写着**别人的衣服**（实测 sb472 出片两人互换）
        logTaskProgress('VideoPrompt', 'retention-outfit-mismatch-detected', {
          episodeId, storyboardId: sb.id,
          subjects: outfit.map(h => `S${h.subject}(${h.reason} 重合${h.overlap} 定义=${h.defGarments.join('/')}${h.defColours.join('/')} 保留=${h.retGarments.join('/')}${h.retColours.join('/')})`).join(' | '),
        })
      }
      const snapshot = new Map(parts)
      const res = (await agent.generate(
        [{ role: 'user', content: buildRetentionFixPrompt(sb, text, rm, outfit) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, 'retention-fix-1', raw, {
        defined: rm?.defined, listed: rm?.listed, outfit: outfit.map(h => h.subject),
      })
      if (writeBack(raw, EN_SECTION_QUOTA.map(([k]) => k)).length) {
        text = assemble()
        if (text.length > budget.limit) {
          for (const k of parts.keys()) parts.delete(k)
          for (const [k, v] of snapshot) parts.set(k, v)
          text = assemble()
          logTaskProgress('VideoPrompt', 'retention-rollback-over-limit', {
            episodeId, storyboardId: sb.id, limit: budget.limit,
          })
        }
      }
      rm = findRetentionMismatch(text)
      if (rm) {
        retentionBlocked = true
        logTaskProgress('VideoPrompt', 'retention-mismatch-unresolved', {
          episodeId, storyboardId: sb.id,
          defined: rm.defined.join(','), listed: rm.listed.join(','),
          missing: rm.missing.join(','), extra: rm.extra.join(','),
        })
      }
      outfit = findRetentionOutfitMismatch(text)
      if (outfit.length) {
        retentionBlocked = true
        logTaskProgress('VideoPrompt', 'retention-outfit-unresolved', {
          episodeId, storyboardId: sb.id, subjects: outfit.map(h => `S${h.subject}`).join(','),
        })
      }
    }
  }

  // ③.11 画外音「锁嘴锁错人」闸（2026-10-14 加，实测 sb437：本该画外音，画面里的顾明轩张嘴念了出来）
  //      官方基础指南：画外音 `<d>` 块之后要锁的是「**这一拍画面里在的那个角色**」的嘴唇，
  //      不是画外的旁白者。稿子写成 `while her lips remain completely closed`（her=画外旁白者）时，
  //      画面里的角色没被锁嘴 → H3 让他张嘴把旁白念出来。
  //      命中 → 带指令重写 1 轮；仍不达标只留痕放行；重写后顶破硬上限 → 回滚。
  if (!overLimit) {
    let vg: VoiceoverLockGap[] = findVoiceoverOnscreenLock(text, charSubjects)
    if (vg.length) {
      logTaskProgress('VideoPrompt', 'voiceover-onscreen-lock-detected', {
        episodeId, storyboardId: sb.id, charSubjects: charSubjects.join(','),
        shots: vg.map(h => `${h.shot} onscreen=${h.onscreen.join('/')}`).join(' | '),
      })
      const snapshot = new Map(parts)
      const res = (await agent.generate(
        [{ role: 'user', content: buildVoiceoverOnscreenFixPrompt(sb, text, vg) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, 'voiceover-onscreen-lock-fix-1', raw, { gaps: vg.length })
      if (writeBack(raw, EN_SECTION_QUOTA.map(([k]) => k)).length) {
        text = assemble()
        if (text.length > budget.limit) {
          for (const k of parts.keys()) parts.delete(k)
          for (const [k, v] of snapshot) parts.set(k, v)
          text = assemble()
          logTaskProgress('VideoPrompt', 'voiceover-onscreen-lock-rollback-over-limit', {
            episodeId, storyboardId: sb.id, limit: budget.limit,
          })
        }
      }
      vg = findVoiceoverOnscreenLock(text, charSubjects)
      if (vg.length) {
        logTaskProgress('VideoPrompt', 'voiceover-onscreen-lock-unresolved', {
          episodeId, storyboardId: sb.id,
          shots: vg.map(h => `${h.shot} onscreen=${h.onscreen.join('/')}`).join(' | '),
        })
      }
    }
  }

  // ③.12 发色 / 服装颜色闸（2026-10-15 加，实测第 8 集分镜 8：脸保住了、警察发色与王梅衣色没保住）
  //   两个成因：① 警察两位卡面是黑发，但资产字段里从没写发色（写提示词的模型看不到图 ⇒ 颜色从没进过提示词，
  //   H3 自己猜）；② 王梅字段写「深蓝**或**灰褐色」而卡面是灰褐 ⇒ 文字与参考图打架。
  //   判据：定义段每个角色主体必须写出发色与服装色。资产文字里有的（assetHasIt）打回重写一轮；
  //   资产文字里压根没有的只留一条 warning —— 那种重写也变不出来，得先去补卡（体检里也会报）。
  if (!overLimit) {
    const refs = (await buildMediaRefs(sb.id)).refs
    const assets = refs.map(r => ({ picture: r.picture, kind: r.kind, name: r.name, assetText: r.assetText || '' }))
    const defsOf = () => parts.get('subject_definitions:') || ''
    let gaps = findColourGaps(defsOf(), assets)
    const assetSide = gaps.filter(g => !g.assetHasIt)
    if (assetSide.length) {
      logTaskProgress('VideoPrompt', 'asset-colour-missing', {
        episodeId, storyboardId: sb.id,
        subjects: assetSide.map(g => `S${g.picture}:${g.what}`).join(','),
      })
    }
    if (shouldRewriteForColour(gaps)) {
      const snapshot = new Map(parts)
      const res = (await agent.generate(
        [{ role: 'user', content: buildRewriteMultiPrompt(sb, [{
          stage: EN_STAGES[0],
          current: defsOf(),
          problem: `缺少这些颜色（必须写进 subject_definitions；颜色只能取自下面给的资产文字，不许自己编）:\n${colourRewriteNote(gaps)}`,
        }], 1, extra, zhPrompt) }],
        { maxSteps: 6, requestContext },
      )) as { text?: string } | undefined
      const raw = cleanSegText(res?.text || '')
      debugLog(episodeId, sb.id, 'colour-fix-1', raw, { gaps: gaps.length })
      if (writeBack(raw, ['subject_definitions:']).length) {
        const next = assemble()
        if (next.length > budget.limit) {
          for (const k of parts.keys()) parts.delete(k)
          for (const [k, v] of snapshot) parts.set(k, v)
          logTaskProgress('VideoPrompt', 'colour-rollback-over-limit', { episodeId, storyboardId: sb.id, limit: budget.limit })
        } else {
          text = next
        }
      }
      gaps = findColourGaps(defsOf(), assets)
      logTaskProgress('VideoPrompt', 'colour-after-fix', {
        episodeId, storyboardId: sb.id, remaining: gaps.length,
        left: gaps.map(g => `S${g.picture}:${g.what}`).join(','),
      })
    }
  }

  const under = text.length > 0 && text.length <= budget.limit
  if (!text) {
    logTaskError('VideoPrompt', 'segment-give-up', { episodeId, storyboardId: sb.id, stage: 'all', error: '拼接结果为空' })
    return { text: '', ok: false }
  }
  if (!under) {
    // 全文仍超硬上限 → 真失败（超了会被 H3 拒收，不能落库）
    // 2026-10-15：错误文案改成**可执行的下一步**——用户看到的不该只是数字（他没法据此做任何事）。
    const shots = ((sb.description || '').match(/【镜头/g) || []).length
    logTaskError('VideoPrompt', 'segment-give-up', {
      episodeId, storyboardId: sb.id, stage: 'all',
      error: `全文 ${text.length} > ${budget.limit}（超出 ${text.length - budget.limit} 字符，压缩到轮数上限仍未达标；风格头 ${budget.headLen} 字符已计入预算）。`
        + `这条分镜的内容量超过了 H3 单段提示词上限 → 处理办法：① 在分镜列表把这条拆成两条；`
        + `② 或减少镜头数（现在 ${shots} 个镜头）后重新生成；③ 或先不管它、整集先出片（其余分镜不受影响）。`,
    })
    return { text: '', ok: false }
  }
  // 全文在硬上限内 → 接受（个别组略超自身配额可容忍，避免"差一点就全盘失败"）
  if (failedStages.length) {
    logTaskProgress('VideoPrompt', 'accepted-with-over-quota', {
      episodeId, storyboardId: sb.id, len: text.length,
      stages: failedStages.map(f => `${f.key}: ${f.problem}`),
    })
  }
  if (retentionBlocked) {
    // 编号/服装对不上 = 稿子会把角色/服装绑错（实测第 7 集分镜 8 两人互换）。宁可不落库、让用户重跑，
    // 也绝不把这种稿子送去出片（失败时不写库 ⇒ 旧稿原样保留）。
    logTaskError('VideoPrompt', 'retention-blocked-not-saved', {
      episodeId, storyboardId: sb.id,
      error: 'retention_analysis 与 subject_definitions 编号/服装对不上，重写一轮仍未达标 → 本条不落库（旧稿保留）',
    })
    return { text: '', ok: false }
  }
  return { text, ok: true }
}

/** 英文版混入中文时的重写指令（2026-10-13）：只改那几处中文，其余一字不许动，输出完整六段。 */
function buildChineseFixPrompt(
  sb: { id: number; storyboardNumber: number | null },
  current: string,
  sample: string,
): string {
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en 里混进了**中文字符**（英文发送版必须全英文）。

出问题的地方（例）：${sample}

**怎么改**（两类，按实际情况判断）：
- **① 紧贴在英文词后面的中文残留**（如 \`mirrored倒影\` / \`thin碎碎 whisper\` / \`whispered议论\`）：**直接删掉那几个中文字，英文词保留**，其余不动。
- **② 「哪几拍出现」这类中文标注 / 分组标题**（如 \`（每个镜头都出现）\` / \`…三段】\`）：改成对应的英文说法（\`(appears in every shot)\` 等）。
- 判据：**中文字符一个都不许留**（⚠️ **引号里的画面内文字是合法的**——招牌/屏幕/横幅上的原文要保留原样中文，别去改它；只处理引号外的中文）；台词、时间戳、\`<Subject N>\` / \`<Picture N>\` 编号**一个字符都不许改**。
**输出要求**：输出**完整六段**（\`subject_definitions:\` / \`summary:\` / \`retention_analysis:\` / \`detailed_description:\` / \`overall_soundscape:\` / \`non_diegetic_music:\`，段名与顺序不变）；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

=== CURRENT VERSION ===
${current}`
}

/** 画外音拍「多出来的嘴」重写指令（2026-10-14 加，实测 sb437）：
 *  画外音台词写法是对的，问题在同一拍里画面内的角色被写了嘴部动作 → H3 会把台词安到那个张嘴的人身上。
 *  输出要求与其它重写一致：完整六段。 */
function buildVoiceoverMouthFixPrompt(
  sb: { id: number; storyboardNumber: number | null },
  current: string,
  hits: VoiceoverMouthHit[],
): string {
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en 里，**画外音那一拍**给画面内的角色写了「嘴」（张嘴、闭嘴、嘴唇、mouth、lips 都算）—— 本链路 cfg=1、没有负向分支，**提到嘴就等于让嘴动**，H3 会把台词安到那个嘴动的人身上（实测：sb437 顾明轩在画面上念出了苏清禾的画外音台词）。

命中的拍与词：${hits.map(h => `${h.shot} ${h.sample}`).join('；')}

**怎么改（只改这些句子，其余一字不动）**：
- **删掉画面内角色所有嘴部字样**：lips part / lips open / mouth opens / opens his mouth / **mouth stays shut** / **lips stay closed and still** / mutters / whispers —— 一个都不许留。**不要用「嘴闭着」去锁嘴**（提到嘴反而会让嘴动）。
- **改成不含嘴部的动作**：汗珠从额角渗到下颌线、一滴一滴坠落、手臂抬起僵在半空、指节发僵、眼神定在某点、呼吸变浅、肩背绷紧 —— 用这些承载情绪。（**喉结/颈部动作也一并去掉**，它紧邻下颌，同样会把注意力引到嘴。）
- **画面取景**：**不要**给这个角色脸部特写（实测 sb302：画外音拍给了脸部特写 → 旁白被读出来、嘴照动）。改成手部、肩背、侧后方中景，或让他的脸不入画。
- **台词那一句照原样保留**：\`<Subject N> (Sx) says in an off-screen voiceover: <d>…</d> while her/his lips remain completely closed.\` 逐字不动（主语、编号、**官方锁嘴句**都不许改 —— 这句是唯一允许出现的嘴部描写）。
**输出要求**：输出**完整六段**（subject_definitions: / summary: / retention_analysis: / detailed_description: / overall_soundscape: / non_diegetic_music:，段名与顺序不变）；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

=== CURRENT VERSION ===
${current}`
}

/** 画外音「锁嘴锁错人」的重写指令（2026-10-14 加，实测 sb437）：
 *  官方口径：画外音 `<d>` 块之后锁的是**这一拍画面里在的那个角色**的嘴唇，不是画外的旁白者。 */
function buildVoiceoverOnscreenFixPrompt(
  sb: { id: number; storyboardNumber: number | null },
  current: string,
  gaps: VoiceoverLockGap[],
): string {
  const detail = gaps.map(g =>
    `- ${g.shot}：旁白者是画外的 <Subject ${g.narrator}>，这一拍画面里在的角色是 <Subject ${g.onscreen.join('> / <Subject ')}>`).join('\n')
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en 里，**画外音那一拍的锁嘴句锁错了人**：

${detail}

官方基础指南原文（MiniMax H3 提示词指南）：
> For voiceover, use the exact phrase \`says in an off-screen voiceover\`. Immediately after every voiceover \`<d>\` block, state that the corresponding **on-screen character's** lips remain closed.
> 例：\`The man (S1) says in an off-screen voiceover: <d>[English] I still remember that road.</d> while his lips remain completely closed.\`

**问题**：稿子写成 \`while her lips remain completely closed\` —— 那个 "her" 指的是**画外的旁白者**，画面里在的那个角色**没有被锁嘴** → H3 会让他张嘴，把旁白台词念出来（实测事故：本该是画外音，画面里的顾明轩张嘴念了苏清禾的旁白）。

**怎么改（只改这些句子，其余一字不动）**：
- 把上述每一拍的锁嘴句改成**画面里那个角色**的：\`while <Subject K>'s lips remain completely closed.\`（K 换成上面列出的画面角色编号），位置仍然**紧跟在 \`<d>\` 块之后**。
- **删掉**原来指向画外旁白者的那句（\`while her lips remain completely closed\` / \`while his lips remain completely closed\`，若它指的是画外的人）。
- 这一拍里**除这句锁嘴句外**，不要再写任何嘴部/下颌/喉结动作（\`lips part\` / \`mouth opens\` / \`jaw\` / \`Adam's apple\` 之类）。
- 台词那一句本身（主语 \`<Subject N> (Sx) says in an off-screen voiceover: <d>…</d>\`）逐字保留，不许改台词、不许改编号。
**输出要求**：输出**完整六段**（subject_definitions: / summary: / retention_analysis: / detailed_description: / overall_soundscape: / non_diegetic_music:，段名与顺序不变）；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

=== CURRENT VERSION ===
${current}`
}

/** retention_analysis 覆盖/编号的重写指令（2026-10-14 加，实测 sb432：道具整片没参考）：
 *  参考图与 RefMod 卡都在工作流里，但 retention_analysis 漏了主体、编号还整体错位
 *  （继承上一版提示词 + 主体重新编号所致）→ 模型没有保留声明，就不保那个主体。
 *  输出要求与其它重写一致：完整六段。 */
function buildRetentionFixPrompt(
  sb: { id: number; storyboardNumber: number | null },
  current: string,
  rm: RetentionMismatch | null,
  outfit: RetentionOutfitHit[] = [],
): string {
  const miss = rm && rm.missing.length ? `<Subject ${rm.missing.join('> <Subject ')}>` : '（无）'
  const extra = rm && rm.extra.length ? `<Subject ${rm.extra.join('> <Subject ')}>` : '（无）'
  const coverBlock = rm
    ? `\`retention_analysis\` 与 \`subject_definitions\` 对不上：
- \`subject_definitions\` 声明了 <Subject ${rm.defined.join('> <Subject ')}>
- \`retention_analysis\` 只写了 <Subject ${rm.listed.join('> <Subject ')}>
- **漏了**：${miss}
- **多出**（定义里没有的编号）：${extra}` + '\n\n'
    : ''
  // 2026-10-15 加：保留项写着**别人的衣服**（实测 sb472 出片两人互换）
  const outfitBlock = outfit.length
    ? `\`retention_analysis\` 里这几个主体的**服装写错了人**（写着别人的衣服/别的颜色，与同号定义对不上）：\n`
      + outfit.map(h => `- <Subject ${h.subject}>：\`subject_definitions\` 写的是 **${h.defColours.join('/')} ${h.defGarments.join('/')}**，`
        + `retention 却写成 **${h.retColours.join('/')} ${h.retGarments.join('/')}**（${h.reason === 'colour' ? '颜色对不上' : '服装词对不上'}）`).join('\n')
      + `\n\n⚠️ 为什么必须改：模型每拍会用\`<Subject N>, the woman in the …\`这种**服装名词**点人，保留项里的错服装会被抄进正文每一拍 → 视频模型按文字走，成片里两个人**身份/服装互换**（实测事故：第7集分镜8）。\n\n`
    : ''
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en 里，\`retention_analysis\` 有问题（这一版的原样保留项**不许沿用**）：

${coverBlock}${outfitBlock}参考图和身份卡都已按 <Subject N> 序号接好，retention_analysis 是模型"保不保这个主体、保成什么样"的唯一声明。

**怎么改（只改 \`retention_analysis\` 这一段，其余五段一字不动）**：
- **逐个重写**：以**本版 \`subject_definitions\`** 为准，<Subject N> 一条不漏、一条不多，编号严格对应（不要沿用旧编号）。
- **每条写什么**：\`<Subject N>: fully_preserved - <该主体在画面里必须保持不变的具体特征>\`；主体是人物时，**服装措辞必须取自同号定义那一句**（同一套衣服、同一个颜色，可以压缩但**不许换成别的衣服/别的颜色**），再带脸/发型基准；是场景时写空间与光线，是道具时写它的**结构特征**（纸张颜色与边缘、表格线位置、印章位置与油墨边缘、单张不重复）。
- **不许**在 retention 里写它"出现于哪一拍"以外的剧情动作，也不许写文字内容本身。
- 若定义里出现了 <Audio J>，保留原有的音频条目（\`<Audio J>: reference - ...\`）不动。
**输出要求**：输出**完整六段**（subject_definitions: / summary: / retention_analysis: / detailed_description: / overall_soundscape: / non_diegetic_music:，段名与顺序不变）；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

=== CURRENT VERSION ===
${current}`
}

/** 动作类否定句的重写指令（2026-10-14 加，实测 sb421）：把「否定词 + 动作动词」改成正面描述，其余一字不动。 */
function buildNegatedActionFixPrompt(
  sb: { id: number; storyboardNumber: number | null },
  current: string,
  sample: string,
): string {
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en 里**用否定句写了动作要求**，这在 H3 上等于没写、还会起反作用（本链路 cfg=1，没有负向分支：否定句不扣分，反而把被否定的动作词当成正面描述喂给模型，模型会照着演）。

出问题的句子（例）：${sample}

**怎么改（只改这些句子，其余一字不动）**：
- **禁写**「否定词 + 动作动词」（does not / never / without / no one / nobody / cannot + turn / stop / slow / look back / look / touch / react / nod / smile / move / walk / speak …）。
- **改成正面描述**：写他**看向哪、朝向哪、步幅与节奏如何、结果是什么**。
  - \`he does not turn his head or slow down\` → \`his chin stays level and square to the far end of the aisle, his eyes fixed on the far doors, his strides keeping exactly the same length and rhythm through the whole shot\`
  - \`without turning his head\` → \`his eyes fixed on the far end of the hall\`
  - \`never turning back\` / \`never facing the lens\` → \`his back stays to the lens\`
  - 「没人接她的手」→ 写成结果本身：\`her outstretched hands stay unanswered in mid-air\`
- **必须保留、不算违规（一个字都不许改）**：数量锁 \`only one … never duplicated\` / \`never a second\`；画面与音频属性 \`no gradients\` / \`no gloss\` / \`no depth-of-field blur\` / \`no new light source\` / \`no repeated identical outfits\` / \`no human voice …\` / \`no readable text\`；官方锁嘴原句 \`while her lips remain completely closed\`；音色参考 \`without copying the original signal\`；以及全部台词、时间戳、\`<Subject N>\` / \`<Picture N>\` 编号。
**输出要求**：输出**完整六段**（\`subject_definitions:\` / \`summary:\` / \`retention_analysis:\` / \`detailed_description:\` / \`overall_soundscape:\` / \`non_diegetic_music:\`，段名与顺序不变）；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

=== CURRENT VERSION ===
${current}`
}

/** 统计英文版的拍数（\`[Shot N]\` 个数） */
function countEnBeats(en: string): number {
  return (en.match(/\[Shot \d+\]/g) || []).length
}

/** 英文版拍数不符时的重写指令（2026-10-12 加）：要求「输出完整六段」，这样后端能整份替换、不会越改越坏。
 *  2026-10-12 补（根因修复）：这一步以前**既不带补充说明、也不带中文时间轴**，而且它的示例里写死了
 *  一句 `[Shot 2] At 00:04.000` —— 模型照抄 → 英文版时间轴被改坏、补充说明被整份重写抹掉。
 *  中文工作版没有这条流程，所以症状表现为「补充说明只对中文有效、英文无效」
 *  （实测 sb362：中文 0-2/2-9 秒，英文却是 [Shot 2] At 00:04.000，且日志里没有任何 fix-zhen 校正记录）。
 *  现在两个都带上，示例时间戳按中文第 2 拍起点实算，杜绝照抄。 */
function buildBeatFixPrompt(
  sb: { id: number; storyboardNumber: number | null },
  current: string,
  expected: number,
  got: number,
  extra?: string,
  zhPrompt?: string,
): string {
  const zhTimeline = zhPrompt
    ? (zhPrompt.match(/^\s*\d+\s*-\s*\d+\s*秒[：:].*$/gm) || []).join('\n')
    : ''
  const zhStarts = zhPrompt
    ? [...zhPrompt.matchAll(/^\s*(\d+)\s*-\s*\d+\s*秒\s*[：:]/gm)].map(m => Number(m[1]))
    : []
  const secondStart = zhStarts.length > 1
    ? `00:${String(zhStarts[1]).padStart(2, '0')}.000`
    : '00:MM.000（MM = 中文第 2 拍的起始秒数）'
  return `分镜 #${sb.storyboardNumber}(ID:${sb.id}) 的 video_prompt_en **拍数不对**。

🔴🔴 这个分镜的 description 里有 **${expected} 个【镜头N】** → 英文版必须**正好写 ${expected} 拍**（${expected} 个 \`[Shot N]\`）。
你现在写了 **${got} 拍** —— 多出来的是把「同一机位/同一景别、只是运镜延续（继续推近／继续横移／静止→横移）」拆成了两拍。

**怎么改**：把这种相邻两拍**合并成一拍** —— 切镜与随后的运镜写在**同一个** \`[Shot N]\` 里（例：\`[Shot 2] At ${secondStart}, the camera cuts to a close-up and then pushes in slowly to chest-up\`）。**不要用删台词、删镜头内容、或把两拍挤成一句的方式凑数**。
${zhTimeline ? `\n🔴🔴 **时间轴基准（本次中文工作版已定，绝不许自己另算）**：合并后**每一拍的起始秒数都必须与中文工作版同一拍一致**（第 1 拍不带时间戳）。中文工作版每一拍如下：\n\n${zhTimeline}\n` : '\n时间戳按合并后的真实节奏重排（第 1 拍不带时间戳）。\n'}${extra ? `\n🔴 **补充说明必须继续满足（合并拍结构时一个字都不许丢）**：${extra}\n` : ''}
**输出要求**：输出**完整六段**（\`subject_definitions:\` / \`summary:\` / \`retention_analysis:\` / \`detailed_description:\` / \`overall_soundscape:\` / \`non_diegetic_music:\`，段名与顺序不变），**除拍结构（含时间戳）外其余内容一字不改**；不要解释、前言、结语；不要代码块围栏；**不要调用任何工具（包括 read_storyboard_context —— 原文已附在下面，直接输出结果，不要去查库里的旧稿）**。

=== CURRENT VERSION ===
${current}`
}

/** 统计中文工作版的拍数（`X-Y秒：` 行数） */
function countZhBeats(zh: string): number {
  return (zh.match(/^\s*\d+\s*-\s*\d+\s*秒\s*[：:]/gm) || []).length
}

/** 中文工作版（给人看的分镜说明，不直接发给视频模型，无长度压力）
 *  2026-10-12：**拍数必须等于 description 里【镜头N】的数量** —— 生成后由程序校验，
 *  不符合就带着「必须 N 拍、上一版 M 拍」的明确指令重写（最多 3 次）。
 *  起因：模型把「同机位、只是运镜延续」也当成一次换镜头，产出多一拍（成片多切一刀、闪一下）。 */
async function generateZhPrompt(
  agent: { generate: (m: unknown, o: unknown) => Promise<unknown> },
  sb: { id: number; storyboardNumber: number | null; description?: string | null },
  videoLabel: string,
  requestContext: unknown,
  extra?: string,
  onNote?: (note: string, step: number, steps: number) => void,
): Promise<string> {
  const expected = ((sb.description || '').match(/【镜头/g) || []).length
  let last = ''
  let langWrong = false
  const ZH_MAX_TRY = 3
  for (let attempt = 1; attempt <= ZH_MAX_TRY; attempt++) {
    // 2026-10-14：上报「本条进度」用（拍数不符会重试，最多 3 次）
    onNote?.('zh', attempt, ZH_MAX_TRY)
    // 2026-10-15：**语言闸**。实测模型会把英文写进这一份（sb465：5763 字符全英文）——
    //   而拍数校验对英文恒为 0，只会带「合并拍」这种没用的指令重试 3 次，最后照样把英文返回、落库。
    //   所以先判语言：上一版不是中文 → 下一轮直接点名「你写错语言了」。
    const langRule = langWrong
      ? '\n🔴🔴 **上一版你写成了英文 —— 这一份必须是中文工作版：用中文写、整篇以中文字符为主**。' +
        '英文版是另一个字段（video_prompt_en），不要在这里输出英文；`@角色名`、`<Picture N>`、秒数这类标记照旧保留。'
      : ''
    const rule = (expected
      ? `\n🔴🔴 **本分镜的 description 里有 ${expected} 个【镜头N】—— 必须正好写 ${expected} 拍（一个不多、一个不少）**：` +
        '每个【镜头N】对应一拍；镜头内部的运镜变化（继续推近／继续横移）、台词窗口、安静拍都不算新拍。' +
        (attempt > 1 && !langWrong
          ? `\n上一版你写了 ${countZhBeats(last)} 拍（应为 ${expected} 拍）：请把「同机位、只是运镜延续」的相邻两拍合并成一拍（切镜与推近写在同一条拍里），不要用别的方式凑数。`
          : '')
      : '') + langRule
    const res = (await agent.generate(
      [
        {
          role: 'user',
          content: `请为分镜 #${sb.storyboardNumber}(ID:${sb.id})生成中文工作版视频提示词(video_prompt)。视频模型:${videoLabel},请根据该模型的特性和时长限制生成。
请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围及时长。${rule}${extra ? `\n\n【补充说明 — 必须在生成时逐条满足】\n${extra}\n（若该分镜已有 video_prompt，请在其基础上按补充说明改写，不要把补充说明当新剧情编造。）` : ''}
这份是给人看的工作版（不直接发给视频模型，无长度限制），写法见 video-prompt 技能的中文工作版章节。
**只输出正文**：不要输出解释、前言、结语；不要用代码块围栏；不要调用任何保存工具。`,
        },
      ],
      { maxSteps: 6, requestContext },
    )) as { text?: string } | undefined
    // 2026-10-15：先砍掉模型写在正文前的思考过程/前言（英文闲聊；cleanSegText 只认英文六段段名，
    //   对中文工作版无效 —— 实测 sb466/467 中文提示词开头有 507 个英文字符）
    last = stripZhPreamble(cleanSegText(res?.text || ''))
    if (!last) continue
    // 语言闸（2026-10-15）：整篇不是中文 ⇒ 这一份写错了语言，拍数校验对它没意义（英文拍数恒为 0）
    if (!looksLikeChinese(last)) {
      langWrong = true
      logTaskProgress('VideoPrompt', 'zh-not-chinese-retry', {
        storyboardId: sb.id, attempt, len: last.length, head: last.slice(0, 40).replace(/\s+/g, ' '),
      })
      continue
    }
    const got = countZhBeats(last)
    if (!expected || got === expected) return last
    logTaskProgress('VideoPrompt', 'zh-beat-count-retry', { storyboardId: sb.id, attempt, expected, got })
  }
  // 3 次都没写出中文 ⇒ 返回空串：调用方据此把这条判为失败、一个字都不落库，
  // **绝不把英文当中文工作版写进 video_prompt**（旧的中文稿原样保留）。
  return looksLikeChinese(last) ? last : ''
}

/** 启动批量生成（立即返回）；运行中返回 started:false,total:-1；无待生成分镜返回 started:false,total:0；
 *  传入 storyboardIds 时只处理所选分镜（即使已有提示词也重新生成），否则处理全部缺失提示词的分镜 */
export async function startVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number; extra?: string } = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  if (tasks.get(episodeId)?.status === 'running') return { started: false, total: -1 }

  const sbs = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
  const pending = storyboardIds?.length
    ? sbs.filter(sb => storyboardIds.includes(sb.id))
    // 2026-10-09：中英文**任一**缺失都算缺。英文版是视频生成唯一可用的那份
    // （前端已硬保护：缺英文版直接报错不发送），只判中文版会出现
    // 后端说"已齐"、前端说"发不了"的死锁。
    : sbs.filter(sb => !((sb.videoPrompt || '').trim() && (sb.videoPromptEn || '').trim()))
  if (!pending.length) return { started: false, total: 0 }

  // 视频模型标签：跟随该集锁定的视频配置，供 Agent 按模型特性生成
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  let videoLabel = '默认'
  if (ep?.videoConfigId) {
    const [cfg] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, ep.videoConfigId))
    if (cfg) videoLabel = `${cfg.name} (${cfg.provider})`
  }

  const task: VideoPromptBatchStatus = {
    status: 'running',
    total: pending.length,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
    items: [],
  }
  tasks.set(episodeId, task)

  // 2026-10-11：正文预算按项目实际风格头长度动态算 —— 风格头是发送时临时拼上去的，
  // 同样占 H3 的 7000 额度（anime 的风格头 768 字符，正是 7000−6200−32 的临界值）。
  const styleHeadLen = (await getDramaStylePrompt(dramaId)).length
  const budget = { limit: promptEnLimit(styleHeadLen), headLen: styleHeadLen }
  logTaskStart('VideoPrompt', 'batch', {
    episodeId, dramaId, total: pending.length, model: opts.model || undefined,
    prompt_en_limit: budget.limit, style_head_len: styleHeadLen,
  })
  ;(async () => {
    const agent = mastra.getAgent('prompt_generator')
    if (!agent) throw new Error('视频提示词 Agent 不可用')
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
      promptTask: 'video',   // 只注入 video-prompt 技能（按需注入，2026-10-10）
    })
    /** 2026-10-14：把「本条走到哪一步」写进内存态任务，前端据此画单条进度。
     *  纯显示用，写内存 Map、无 IO，不进每秒/每轮的日志。 */
    const mark = (stage: 'zh' | 'en' | 'save', note?: string, step?: number, steps?: number) => {
      task.stage = stage
      task.stage_note = note
      task.stage_step = step
      task.stage_steps = steps
    }
    for (const sb of pending) {
      task.current_storyboard_id = sb.id
      task.item_started_at = new Date().toISOString()
      mark('zh')
      const itemT0 = Date.now()
      let itemOk = false
      let itemErr = ''
      logTaskProgress('VideoPrompt', 'batch-shot', { episodeId, storyboardId: sb.id, index: task.completed + task.failed + 1, total: task.total })
      try {
        // 1) 中文工作版（**先生成** —— 它是本次时间轴的基准，英文版必须逐拍对齐它）
        // 2026-10-12：标记阶段 —— 中文工作版不需要技能里「英文发送版」那 16.8K 细则，注入时裁掉
  requestContext?.set?.('promptStage' as never, 'zh' as never)
  const zh = await generateZhPrompt(agent, sb, videoLabel, requestContext, opts.extra,
    (note, step, steps) => mark('zh', note, step, steps))
        if (!zh) {
          task.failed++
          itemErr = '中文工作版生成为空（或写成了英文，已不落库）'
          logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: itemErr })
          continue
        }
        // 2) 英文版：以中文版时间轴为基准整体生成 → 逐组核定 → 中英一致性程序校验（不合格自动重写）
        mark('en', 'en_draft', 1, MAX_FULL_RETRY)
        const en = await generateEnByStages(agent, sb, videoLabel, requestContext, episodeId, opts.extra, zh, budget,
          (note, step, steps) => mark('en', note, step, steps))
        if (!en.ok) {
          task.failed++
          itemErr = '英文版未达标（六段不全或超配额）'
          continue
        }
        if (en.text.length > budget.limit) {
          // 各组都已达标，理论上不会走到这里；留痕便于发现配额表与技能不一致
          logTaskError('VideoPrompt', 'batch-shot', {
            storyboardId: sb.id,
            error: `各组达标但拼接后仍超 ${en.text.length} > ${budget.limit}（请核对 EN_SECTION_QUOTA 与技能配额）`,
          })
        }
        mark('save')
        // 3) 后端落库（Agent 不落库，避免它顺手写别的字段）
        //    2026-10-13 源头兜底：落库前机械清掉越界的主体/参考图编号。
        //    规则层（技能/流程单）已要求「没被提取成道具资产的东西不许编号」，但模型实测仍会编；
        //    体检只能事后报，所以这里做确定性的最后一道机械清理（体检保留为兜底）。
        const refCount = (await buildMediaRefs(sb.id)).refs.length
        const cleanEn = stripOutOfRangeRefs(sanitizeEnPrompt(en.text), refCount)
        if (cleanEn.stripped.length) {
          logTaskProgress('VideoPrompt', 'en-ref-out-of-range-stripped', {
            episodeId, storyboardId: sb.id, refCount, stripped: cleanEn.stripped,
          })
        }
        await db.update(schema.storyboards)
          .set({ videoPrompt: zh, videoPromptEn: cleanEn.text })
          .where(eq(schema.storyboards.id, sb.id))
        const [fresh] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, sb.id))
        const freshEn = (fresh?.videoPromptEn || '').trim()
        if ((fresh?.videoPrompt || '').trim() && freshEn) {
          task.completed++
          itemOk = true
          logTaskProgress('VideoPrompt', 'batch-shot-saved', {
            episodeId, storyboardId: sb.id, en_len: freshEn.length, zh_len: (fresh?.videoPrompt || '').length,
          })
        } else {
          task.failed++
          itemErr = '落库后读回为空'
          logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: itemErr })
        }
      } catch (err: any) {
        task.failed++
        itemErr = err?.message || '未知错误'
        logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: itemErr })
      } finally {
        // 2026-10-14：记「本条结果 + 耗时（含重试）」—— 前端据此画绿/红分段进度条、逐条流水
        // 与结束后的结果汇总。finally 连 continue / 失败路径都会走到，别只在成功分支记。
        task.items.push({
          storyboard_id: sb.id,
          storyboard_number: sb.storyboardNumber ?? null,
          ok: itemOk,
          seconds: Math.max(1, Math.round((Date.now() - itemT0) / 1000)),
          ...(itemOk ? {} : { error: itemErr || '未知失败' }),
        })
      }
    }
  })()
    .then(() => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      task.current_storyboard_id = undefined
      logTaskSuccess('VideoPrompt', 'batch', { episodeId, total: task.total, completed: task.completed, failed: task.failed })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '批量生成失败'
      logTaskError('VideoPrompt', 'batch', { episodeId, error: err?.message })
    })
  return { started: true, total: pending.length }
}

export function getVideoPromptBatchStatus(episodeId: number): VideoPromptBatchStatus | null {
  return tasks.get(episodeId) || null
}
