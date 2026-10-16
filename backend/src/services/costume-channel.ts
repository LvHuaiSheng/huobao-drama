/**
 * 穿搭通道一致性（2026-10-16 立；用户要求「原始内容已经写了穿搭，就不应该后边提取错」）
 *
 * 两条通道都会把角色绑到某一集：
 *   ① 提取（`save_dedup_characters`）—— 按剧本里出现的人名匹配；
 *   ② 拆分（`save_storyboards`）—— 按每个分镜绑定的角色链接到本集。
 * 两条都可能把**基准角色**（原始穿搭）和**它的换装变体**同时挂上同一集，
 * 而剧本里其实已经写明了这一集穿哪套 ⇒ 成片把原始穿搭也画进来（实测第 13 集）。
 *
 * 这里给出**一处共用的确定性纠正**：剧本声明了穿搭时，用字面重合度选留谁，另一个解绑。
 * 判不出来（两边都像/都不像/没声明）就**不动数据**，只回报冲突让人判 —— 宁可不改，不许猜错。
 */

import { db, schema } from '../db/index.js'
import { and, eq } from 'drizzle-orm'
import { declaredCostume, resolveCostumeKeep, costumeScore } from './costume-match.js'

export interface CostumeFix {
  /** 被解绑的角色名 */
  dropped: string
  /** 留下的角色名 */
  kept: string
  /** 剧本声明的穿搭原文 */
  declared: string
}

/**
 * 纠正某一集的角色绑定：同集同时挂了「基准角色 + 它的换装变体」时，按剧本声明的穿搭留一个。
 * @returns 实际解绑的记录（空 = 无需处理或判不出来）
 */
export async function enforceCostumeConsistency(episodeId: number, dramaId: number): Promise<{ fixes: CostumeFix[]; declared: string | null }> {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  const declared = declaredCostume(ep?.scriptContent || ep?.content || '')
  if (!declared) return { fixes: [], declared: null }

  const all = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
    .filter(c => !c.deletedAt)
  const linked = (await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))).map(l => Number(l.characterId))

  const fixes: CostumeFix[] = []
  for (const v of all.filter(c => c.variantOf)) {
    const base = all.find(c => Number(c.id) === Number(v.variantOf))
    if (!base) continue
    if (!linked.includes(Number(v.id)) || !linked.includes(Number(base.id))) continue
    const keep = resolveCostumeKeep(declared, base.styling || '', v.styling || '')
    if (!keep) continue                      // 判不出来 ⇒ 不动数据
    // ⚠️ 分数高的留下：keepBase=true ⇒ 走变体；keepBase=false ⇒ 走基准（2026-10-16 这里曾写反）
    const loser = keep.keepBase ? v : base
    const winner = keep.keepBase ? base : v
    try {
      // 只删**输的那一条**绑定行（不重建整集绑定：重建一旦中途失败会丢数据）
      await db.delete(schema.episodeCharacters).where(and(
        eq(schema.episodeCharacters.episodeId, episodeId),
        eq(schema.episodeCharacters.characterId, Number(loser.id)),
      ))
      fixes.push({ dropped: loser.name || `#${loser.id}`, kept: winner.name || `#${winner.id}`, declared })
    } catch {
      // 个别失败（并发写等）不阻断整条流水线
    }
  }
  return { fixes, declared }
}

/** 给日志/回话用的一句话（含判定依据，便于事后核对） */
export function costumeFixNote(fixes: CostumeFix[], declared: string | null): string {
  if (!fixes.length) return ''
  const basis = declared ? `（依据剧本「${declared}」）` : ''
  return `${fixes.map(f => `${f.dropped} → 解绑，留下 ${f.kept}`).join('；')}${basis}`
}

/** 供日志用：两边分数（不带 db，纯算） */
export function costumeDebugScores(declared: string, a: string, b: string): string {
  return `${costumeScore(declared, a).toFixed(2)} vs ${costumeScore(declared, b).toFixed(2)}`
}
