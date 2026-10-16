/**
 * 剧本声明的穿搭 → 该留哪个角色（2026-10-16 立；用户报「原始内容已经写了穿搭，就不应该后边提取错」）
 *
 * 实测场景（第 13 集）：剧本原文写着 `【女主穿搭】墨绿色丝绒旗袍式正装全套`，
 * 而库里同时有 `苏清禾`（基准：灰蓝色保洁工作服）与 `苏清禾·内搭正装`（墨绿丝绒正装）⇒
 * 提取把**两个都绑**到了这一集，成片就把原始穿搭也画了进来。
 * 光靠提示词让模型"自己按穿搭挑"不够 —— 这里给出**确定性的机械判据**：
 *   ① 从剧本里抓出声明的那套穿搭文字；
 *   ② 拿它与候选角色的 `styling` 做**字面重合度**打分（中文按去重字符集合算，不依赖模型）；
 *   ③ 分数明显更高的一方胜出，另一方在提取通道里**自动解绑**；
 *      分数接近（两边都像 / 都不像）⇒ 不动数据，只回报冲突让人判。
 *
 * 不用模型、不用向量：判据是"字面重合度"，可复现、可单测。
 */

/** 剧本里声明穿搭的形态：「【女主穿搭】…」「【穿搭】…」「换上…」「一身…」 */
const COSTUME_LINE = /(?:【[^】]*穿搭[^】]*】|【服装】|【造型】)\s*([^\n\r]{2,60})/
/** 从排版/标点里剥干净，只留下可比较的文字 */
function bare(s: string): string {
  return String(s || '')
    .replace(/[\s，。、；;,.：:！!？?“”"'（）()【】\[\]—\-～~]/g, '')
    .trim()
}

/**
 * 剧本声明的穿搭原文（读不到返回 null —— 读不到就不判，绝不瞎猜）。
 * 例：`### 第 13 集｜…\n【场景】…\n【女主穿搭】墨绿色丝绒旗袍式正装全套\n…` → `墨绿色丝绒旗袍式正装全套`
 */
export function declaredCostume(script: string): string | null {
  const t = String(script || '')
  const m = t.match(COSTUME_LINE)
  const s = bare(m?.[1] || '')
  // 太短的不算（「日常」这种抓出来也没法比较）
  return s.length >= 3 ? s : null
}

/** 字面重合度：声明文字里有几成的字出现在候选文字里（0~1） */
export function costumeScore(declared: string, candidate: string): number {
  const a = new Set(bare(declared).split(''))
  if (!a.size) return 0
  const b = new Set(bare(candidate).split(''))
  let hit = 0
  for (const ch of a) if (b.has(ch)) hit++
  return hit / a.size
}

/**
 * 在候选里挑出与声明穿搭最匹配的那个。
 * @returns 胜出下标 + 分数；差距不足 `minGap` 时返回 null（**判不出就不选**，交给人工/警告）
 */
export function pickCostumeMatch(
  declared: string | null,
  candidates: string[],
  minGap = 0.25,
): { index: number; score: number; runnerUp: number } | null {
  if (!declared || candidates.length < 2) return null
  const scored = candidates.map((c, i) => ({ i, s: costumeScore(declared, c) })).sort((x, y) => y.s - x.s)
  const [best, second] = scored
  if (!best || best.s <= 0) return null
  if (second && best.s - second.s < minGap) return null
  return { index: best.i, score: best.s, runnerUp: second?.s ?? 0 }
}
