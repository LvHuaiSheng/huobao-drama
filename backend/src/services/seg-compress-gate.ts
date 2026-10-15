/**
 * 「还要不要继续压缩」判定 —— 零依赖纯函数（与 prop-text-gates / retention-gate 同惯例，可脱离 DB/Agent 直接单测）。
 *
 * 2026-10-15 加。背景（用户报「分镜9 还是生成失败，整个生成过程还是优化的不够好」）：
 * 旧循环条件是「有组超**自己的配额**就继续压」，而 H3 真正卡的是**全文总量**（6200）。
 * 于是时间全花在压不动的组上：
 *   - sb473（失控第7集分镜9，10 秒 3 镜、描述 323 字）detail 组 4272 → 4176 → 3901 → 3743 → 3631
 *     （≈110~160 字符/轮，约 14 秒/轮），而全文 6390 只超硬上限 **190 字符** → 4 轮用尽、整条作废；
 *   - 反过来 sb471：detail 超配额 356 字符，但全文 5883 ≤ 6200 → 本来就该直接接受（组配额是建议值）。
 */
export function shouldKeepCompressing(
  groups: Array<{ problem: string }>,
  total: number,
  limit: number,
): boolean {
  if (!groups.length) return false
  // 缺段必须继续：要补写，放着不管会废在后面的「六段齐全闸」（那是残废提示词，绝不能落库）。
  if (groups.some(g => /缺少|没有内容/.test(g.problem))) return true
  return !(total > 0 && total <= limit)
}
