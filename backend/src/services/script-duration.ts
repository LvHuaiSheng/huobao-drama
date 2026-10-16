/**
 * 剧本时长 → 分镜条数（2026-10-16 加；用户报「AI 改写和拆分分镜没有按照原始内容的时长来改」）
 *
 * 实测（全库第 1~12 集）：剧本片头写着目标时长（`## 第 11 集｜神秘短信，暗处狩猎｜时长：2 分 20 秒`），
 * 而拆分出来的分镜**合计时长普遍只有 48~113 秒**，比声明的 130~160 秒少 40~96 秒（约缺三分之一）。
 * 成因：拆分 Agent 只按"剧本里有多少个【镜头N】"来拆，从没读片头那个时长 ⇒ 每集天然短一截。
 *
 * 口径：本项目的生产单位是 **H3 单段 10 秒**（`[Shot 1] … [Shot 2] At 00:05.000 … [Shot 3] At 00:07.000`
 * 覆盖 0~10 秒那条实测稿就是 10.125 秒）⇒ **分镜条数 = 声明的秒数 ÷ 10**（最后一条可以短一点），
 * 且**所有分镜的 duration 之和必须等于声明的秒数**。
 *
 * 纯函数，单独成文件以便单测。
 */

/** 从剧本正文里读片头声明的时长（秒）；读不到返回 null（读不到就不判，不许瞎猜） */
export function parseScriptDurationSeconds(text: string): number | null {
  const t = String(text || '')
  // 「时长：2 分 20 秒」/「时长：2分20秒」/「时长：140 秒」/「时长：3 分钟」
  const m = t.match(/时长\s*[：:]\s*(?:(\d+)\s*分(?:钟)?)?\s*(?:(\d+)\s*秒)?/)
  if (m && (m[1] || m[2])) {
    const seconds = Number(m[1] || 0) * 60 + Number(m[2] || 0)
    if (seconds > 0) return seconds
  }
  // 「时长：2:20」（分:秒）
  const m2 = t.match(/时长\s*[：:]\s*(\d+)\s*[:：]\s*(\d+)/)
  if (m2) {
    const seconds = Number(m2[1]) * 60 + Number(m2[2])
    if (seconds > 0) return seconds
  }
  return null
}

/** 本项目单条分镜的生产时长（H3 单段 10 秒 —— 定版基线，别改） */
export const SEGMENT_SECONDS = 10

/** 目标分镜条数 = 声明秒数 ÷ 10（向上取整；最后一条可以不足 10 秒） */
export function expectedStoryboardCount(seconds: number | null): number | null {
  if (seconds == null || !(seconds > 0)) return null
  return Math.ceil(seconds / SEGMENT_SECONDS)
}
