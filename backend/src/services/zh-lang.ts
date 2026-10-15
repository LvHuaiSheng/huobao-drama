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
