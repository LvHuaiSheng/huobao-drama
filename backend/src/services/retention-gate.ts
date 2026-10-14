/**
 * retention_analysis 覆盖闸（2026-10-14 立，实测 sb432「DNA血缘鉴定报告」整片没参考）
 *
 * 症状：道具的参考图和 RefMod 卡**都**进了工作流（已核对 ComfyUI 运行时图：ref_image_5 + mod_5
 * 都在、卡文件 350,728 字节真实有效），但成片里那张纸**跟参考图毫无关系**。
 *
 * 实测到的真缺陷（不是猜的）：sb432 的 video_prompt_en 里
 *   `subject_definitions` 声明了 <Subject 1>~<Subject 5>（5 个：场景 / 苏清禾 / 宾客甲 / 宾客乙 / 报告）
 *   `retention_analysis` 却只写了 <Subject 1><Subject 2><Subject 3>，**且编号整体错位** ——
 *     <Subject 2> 那条写的是"单张报告纸、表格线、红章"（那是**道具**的保留描述），
 *     <Subject 3> 那条写的是"她的脸、卷发、耳环、礼服"（那是**苏清禾**的）。
 *   → 道具 <Subject 5> 在 retention 里**根本没有保留声明**，模型自然不保它。
 *
 * 成因：提示词重新生成时，`storyboard-tools.ts` 会把**上一版提示词**一起喂给模型（263-264 行），
 * 于是旧的 retention_analysis 整段被继承；而主体编号因为新加了角色而变了 → 编号错位、道具掉队。
 * 全库 82 条英文版里这样错位的有 4 条（sb378 / sb381 / sb393 / sb432）。
 *
 * 判据：`retention_analysis` 里出现的 <Subject N> 集合必须与 `subject_definitions` 的**完全一致**
 * （不缺、不多）。纯函数，单独成文件以便脱离 DB/Agent 模块图单测。
 */

export interface RetentionMismatch {
  /** subject_definitions 里声明了、retention_analysis 里没写的 */
  missing: number[]
  /** retention_analysis 里写了、subject_definitions 里没有的（编号越界） */
  extra: number[]
  defined: number[]
  listed: number[]
}

/** 按段名切出六段（段名必须独占一行、以 `name:` 开头） */
function splitSections(en: string): Record<string, string> {
  const names = ['subject_definitions', 'summary', 'retention_analysis',
    'detailed_description', 'overall_soundscape', 'non_diegetic_music']
  const hits: Array<[string, number]> = []
  for (const n of names) {
    const m = new RegExp(`^${n}\\s*:`, 'm').exec(en)
    if (m) hits.push([n, m.index])
  }
  hits.sort((a, b) => a[1] - b[1])
  const out: Record<string, string> = {}
  for (let i = 0; i < hits.length; i++) {
    const [name, start] = hits[i]
    const end = i + 1 < hits.length ? hits[i + 1][1] : en.length
    out[name] = en.slice(start, end)
  }
  return out
}

const subjectsIn = (s: string): number[] =>
  Array.from(new Set((s.match(/<Subject (\d+)>/g) || []).map(x => parseInt(x.replace(/\D+/g, ''), 10))))
    .sort((a, b) => a - b)

/**
 * 命中（缺/多）→ 返回差异；完全一致 → null。
 */
export function findRetentionMismatch(en: string): RetentionMismatch | null {
  const sec = splitSections(String(en || ''))
  const sd = sec['subject_definitions'] || ''
  const ra = sec['retention_analysis'] || ''
  if (!sd || !ra) return null
  const defined = subjectsIn(sd)
  const listed = subjectsIn(ra)
  if (!defined.length) return null
  const missing = defined.filter(n => !listed.includes(n))
  const extra = listed.filter(n => !defined.includes(n))
  if (!missing.length && !extra.length) return null
  return { missing, extra, defined, listed }
}
