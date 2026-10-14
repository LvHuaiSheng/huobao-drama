/**
 * 道具参考图引用闸（纯函数，单独成文件以便脱离 DB/Agent 模块图单测）
 *
 * 只保留一个方向：**没有道具参考图却写了「照抄参考图」** → 指向不存在的资源（实测 sb393/sb394）。
 *
 * ⚠️ 2026-10-14 晚修正：本文件原有一个反向闸「有参考图却写『看不清』」（findIllegibleWithPropRef），
 * **判据错误、已删除**。证据：用户认可、工作正常的 sb431 稿子里本来就写着
 * `illegible character blocks, no readable text` —— 这句话不妨碍道具锁定；而那道闸的改写指令
 * （要求「逐字复刻每一行字」）反而把 sb432 改得更差。
 * 道具锁不住的真实差异是「道具在动 vs 绝对静止」，见 video-prompt 技能「道具镜必须绝对静止」一节。
 */

/**
 * 没有道具参考图（propRefCount = 0）却写了「照抄参考图」指令 → 返回修正指令；否则 null。
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
