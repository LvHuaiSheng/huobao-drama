/**
 * 道具「纸面/屏幕文字」的两向闸（2026-10-14，实测事故）
 *
 * 提示词里关于纸面文字的写法只有两个方向，判据就一条 —— **本分镜有没有道具参考图**
 * （该道具已提取成资产、本集已绑定、`<Picture N>` 有图）。
 *
 *   ① **有参考图** → 必须写「纸面内容以参考图为准 / 必须与参考图完全一致」，
 *      **禁止**写「看不清 / 无法辨认的字符块 / no readable text / illegible」这类「糊掉」措辞。
 *      实测事故（2026-10-14，第4集分镜5 = sb432，道具「DNA血缘鉴定报告」）：
 *      模型两条分支**同时**写了 —— 一边写「必须与参考图完全一致」，一边在 [Shot 1] 写
 *      `the paper shows only faded pale table lines and illegible character blocks, no readable text`。
 *      而参考图本身字迹清清楚楚（「鉴定报告」「DNA血缘鉴定」「苏清禾才是苏家骨肉」+ 红章），
 *      模型照后一句把纸面糊掉 → 用户看到的现象就是「道具没锁住 / 道具没挂上」。
 *   ② **没有参考图** → 只能写「几行无法辨认的字符块、看不清内容」，**禁止**引用任何参考图
 *      （实测 sb393/sb394：本集没提取「手机」道具，提示词却写「与道具参考图完全一致」→ 指向不存在的资源）。
 *
 * 两个函数都是纯函数，单独放一个文件是为了能脱离 DB/Agent 模块图做单测（那圈有循环依赖，dev 下 import 会撞 TDZ）。
 */

/** ① 有道具参考图时**禁止**出现的「糊掉」措辞 */
export const ILLEGIBLE_PATTERNS: Array<[RegExp, string]> = [
  [/no readable text/i, 'no readable text'],
  [/illegible/i, 'illegible'],
  [/unreadable/i, 'unreadable'],
  [/cannot be read/i, 'cannot be read'],
  [/not legible/i, 'not legible'],
  [/blurred (?:character )?blocks?/i, 'blurred character blocks'],
  [/(?:看不清|无法辨认|不可辨认|字迹模糊)/, '看不清/无法辨认'],
]

/**
 * ① 有道具参考图（propRefCount > 0）却把纸面写成「看不清」→ 返回修正指令；否则 null。
 * `<d>…</d>` 台词块跳过（台词里说「看不清」可能是剧情，不算违规）。
 */
export function findIllegibleWithPropRef(en: string, propRefCount: number): string | null {
  if (propRefCount <= 0) return null
  const body = String(en || '').replace(/<d>[\s\S]*?<\/d>/g, ' ')
  for (const [re, label] of ILLEGIBLE_PATTERNS) {
    if (re.test(body)) {
      return `本分镜**有**道具参考图（本集已绑定且有图的道具数 = ${propRefCount}），却把纸面/屏幕写成「${label}」`
        + '—— 这等于让模型把参考图上的内容糊掉，道具必然"锁不住"（实测 sb432「DNA血缘鉴定报告」就是这么糊掉的）。'
        + '请删掉这类「看不清」措辞，改成「纸面内容一律以参考图为准、逐字一致，不复述具体文字」；'
        + '原来的 `<Picture N>` 引用与「必须与参考图完全一致」这类照抄指令**要保留**（那是本分镜该写的）。'
    }
  }
  return null
}

/**
 * ② 没有道具参考图（propRefCount = 0）却写了「照抄参考图」指令 → 返回修正指令；否则 null。
 * （原 `findDanglingPropRef`，2026-10-14 移到本文件，逻辑未改，只为了能单测）
 */
export function findDanglingPropRef(en: string, propRefCount: number): string | null {
  if (propRefCount > 0) return null
  const pats: Array<[RegExp, string]> = [
    [/must match <Picture \d+> exactly/i, '「必须与 <Picture N> 完全一致」'],
    [/exactly as drawn in the storyboard artwork/i, '「照分镜画面原样画」'],
    [/must match the (?:prop )?reference image exactly/i, '「必须与参考图完全一致」'],
    [/以道具参考图为准/, '「以道具参考图为准」'],
    // 2026-10-14 修：原写法 `/必须与参考图中的?完全一致/` 中间夹了个「中」→ 只认「必须与参考图中的…」，
    // 最常见的「必须与参考图完全一致」（sb432 中文工作版就是这么写的）**漏检**。改成可选「中」+ 可选「的」。
    [/与参考图(?:中)?的?(?:完全)?一致/, '「必须与参考图完全一致」'],
  ]
  for (const [re, label] of pats) {
    if (re.test(en)) {
      return `本分镜没有道具参考图（本集绑定且有图的道具数 = 0），却写了照抄指令${label} → 指向不存在的资源。`
        + '请删掉该句，改成「几行无法辨认的字符块、看不清内容」（英文 `a few illegible character blocks, no readable content`）；'
        + '若该文字确实是剧情关键信息，应先在 App 里把它建成道具并生成参考图，再重新生成本分镜提示词。'
    }
  }
  return null
}
