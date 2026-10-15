/**
 * 语言判据（纯函数，无任何依赖 —— 能脱离 DB/Agent 模块图直接单测）。
 *
 * 起因（2026-10-15 实测事故）：批量/一键修复生成时，模型把**英文**写进了中文工作版字段
 * `storyboards.video_prompt`（实测 sb465：5763 字符全英文落库，用户在界面上看到的
 * 就是「中文描述变成了英文」），而流程里没有任何一道闸拦它 —— 中文版的校验只有
 * 「拍数 = description 里的【镜头N】数」，英文文本的拍数恒为 0，重试 3 次都写英文，
 * 最后 `generateZhPrompt` 把最后一版（英文）当结果返回、落库路径无条件覆盖旧中文稿。
 */

/** 中文字符数 */
export function countChinese(text: string): number {
  return (String(text || '').match(/[\u4e00-\u9fff]/g) || []).length
}

/**
 * 这段文本「像中文工作版」吗？
 * 判据 = 有中文字符，且中文字符数 / 非空白字符数 ≥ 30%。
 * 门槛不用高（中文工作版里允许出现 `@角色名`、`<Picture 1>`、秒数这类 ASCII），
 * 但要能挡住「整篇英文」与「英文里夹两个汉字」两种。
 */
export function looksLikeChinese(text: string, minRatio = 0.3): boolean {
  const raw = String(text || '')
  const nonSpace = raw.replace(/\s/g, '').length
  if (!nonSpace) return false
  return countChinese(raw) / nonSpace >= minRatio
}

/**
 * 中文工作版里「台词行」的判据 —— **唯一口径**：生成侧的 `zhEnConsistency` 闸与体检
 * （`services/prompt-check.ts` 的 dialogue-count）必须用同一个谓词，否则两边会给出相反结论。
 *
 * 2026-10-15 统一：体检侧原本就是 `[：:][ \t]*「…」`（对话内容），而生成侧闸用的是
 * `(?:旁白|画外音|说)[^「\n]{0,30}「` —— 模型把台词写成 `…吐字平稳：「台词」`（没有「说」字）时，
 * 生成侧数出 0 句、英文有 2 条 `<d>` ⇒ 判「不一致」，每条白烧 2 轮修复后 `zh-en-unresolved`
 * （实测 sb466/467），而同一批内容体检侧根本不报。现在两边都走这个函数。
 * 「」在本管线里是**台词专用**引号（画面内的文字用双引号 "…"），所以「冒号 + 「」」是安全判据。
 */
export function zhDialogueLines(zh: string): string[] {
  return [...String(zh || '').matchAll(/[：:][ \t]*「([^」]*)」/g)]
    .map(m => (m[1] || '').trim())
    .filter(Boolean)
}

/**
 * 砍掉模型写在正文前面的「思考过程 / 前言」（英文闲聊 + 自述）。
 *
 * 症状（实测 sb466/467）：中文工作版开头是
 *   `I'll start by reading the storyboard context for shot #2. I have the context for #2 (ID:466) — 4 【镜头N】…`
 * 整整 507 个英文字符，然后才接真正的正文 —— 用户看到的「中文提示词」前一段是英文。
 * `cleanSegText` 的「砍到第一个段名之前」只认**英文六段段名**（subject_definitions…），
 * 对中文工作版完全失效（中文正文的标志是首行 `出场人物：…` 与 `X-Y秒：`）。
 */
export function stripZhPreamble(text: string): string {
  const raw = String(text || '')
  const at = raw.search(/(?:出场人物\s*[：:]|\d+\s*-\s*\d+\s*秒\s*[：:])/)
  return at > 0 ? raw.slice(at).trim() : raw
}
