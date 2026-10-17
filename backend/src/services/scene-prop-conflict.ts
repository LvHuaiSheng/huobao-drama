/**
 * 「场景抢戏」—— 场景资产的文字里出现了本分镜的**道具**（2026-10-17 加，Festo 产品片第1集分镜1 实锤）
 *
 * 症状：3 张参考图齐全、道具卡（RefMod）也在、提示词每一拍都点了名 —— 可**广角那一拍道具完全没锁住，
 *      另一拍却看着对**。
 * 机制：场景图是整拍的视觉底 ⇒ 场景图（及其「场景描述」文字）里本来就画了同一件东西、还是通用款时，
 *      模型直接抄场景里那台，道具参考图/道具卡被压过去。
 * 实锤（sb619 / 任务 959）：场景描述原文「台上陈列工控样机——一台窄长机身银灰色伺服驱动器
 *      （正面深色接线端子区、绿色状态指示灯）…」，生成的场景图里台面 1 台 ＋ 货架 4 台，
 *      全是「银灰机身／深色面板／绿色指示灯」的通用款 ≠ 实拍 CMMT-AS（浅灰白塑料壳＋白显示模块＋蓝 FESTO）。
 *
 * 判据：**道具名里的实义段**（连续中文 ≥3 字 / 连续英文数字 ≥3 字符，先去「样机/道具/模型…」这类通用尾词）
 *      出现在场景资产的文字里 → 命中。例：「CMMT-AS伺服驱动器样机」→ 实义段 `CMMT-AS`、`伺服驱动器`。
 * 只报告、不写库：修法在**场景资产侧**（场景只画空间与陈设，道具交给道具图与道具卡）。
 */

/** 名字尾部的通用词（去掉它们剩下的才是「这东西是什么」） */
const GENERIC_TAILS = [
  '样机', '样件', '实物', '模型', '道具', '物品', '物件', '画面', '图片', '照片', '图像', '截图',
  '特写', '近景', '远景', '镜头', '小道具', '大样', '样品',
]

/** 道具名 → 实义段（连续中文 ≥3 字 / 连续英文数字 ≥3 字符） */
export function propNameRuns(name: string): string[] {
  const runs = String(name || '').match(/[A-Za-z0-9][A-Za-z0-9._-]*|[\u4e00-\u9fff]+/g) || []
  const out: string[] = []
  for (const raw of runs) {
    let r = raw
    if (/^[\u4e00-\u9fff]+$/.test(r)) {
      for (const tail of GENERIC_TAILS) {
        if (r.length > tail.length && r.endsWith(tail)) r = r.slice(0, r.length - tail.length)
      }
      if (r.length < 3) continue
    } else if (r.length < 3) {
      continue
    }
    out.push(r)
  }
  return Array.from(new Set(out))
}

export interface ScenePropConflict { propName: string; matched: string }

/** 场景文字里命中的道具（同一个道具只报一条，命中段取最长那个） */
export function findScenePropConflicts(sceneText: string, propNames: string[]): ScenePropConflict[] {
  const text = String(sceneText || '')
  if (!text.trim()) return []
  const lower = text.toLowerCase()
  const out: ScenePropConflict[] = []
  for (const name of propNames) {
    const hits = propNameRuns(name).filter(r => lower.includes(r.toLowerCase()))
    if (!hits.length) continue
    hits.sort((a, b) => b.length - a.length)
    out.push({ propName: name, matched: hits[0] })
  }
  return out
}
