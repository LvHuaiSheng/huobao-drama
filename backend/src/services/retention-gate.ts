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

// ─── 保留项「服装写错人」闸（2026-10-15 加，实测 sb472 第7集分镜8 出片两人互换） ─────────
//
// 事故：sb472 的 subject_definitions 写对了（<Subject 2> 苏清禾 = 灰蓝工作服、<Subject 3> 张莉 = 玫红亮片裙），
// 但 retention_analysis **沿用了旧稿**：<Subject 2> 写「dark navy suit jacket / grey trousers / silver wristwatch」、
// <Subject 3> 写「burgundy dress」。而 2026-10-14 的规则要求**每拍用服装名词点人**
// （`<Subject 2>, the woman in the dark navy suit`）→ 错服装词被抄进正文每一拍 →
// 视频模型按文字走：被告知"主体2 穿深蓝西装、主体3 穿酒红裙"，参考图却是灰蓝工作服/玫红亮片裙 → **两人身份/服装互换**。
// 已核对：提示词的 <Picture N> 编号正确、App 下发的参考图顺序也正确（中转日志 mods=[scene-34, character-28, character-31]），
// 所以问题在**提示词自己**。
//
// 判据（全库 125 条角色主体实测：命中 10 条、全部是真错，正常改写如「cream-white → cream」「rose sequined party dress → rose sequined dress」零误报）：
//   · 把「紧贴服装名词 ±5 词」的颜色与服装名词取出来；
//   · 同一 <Subject N>：保留项的服装词在定义里的**重合率 < 0.5** → 报；
//   · 或两边都说到颜色、颜色家族完全不重叠 → 报。
// 只比「服装」，不看饰品类（避免把发色/口红/首饰色算进来造成误报）。

const GARMENT_NOUN = /(?:jacket|dress|suit|shirt|trousers|pants|uniform|coat|skirt|apron|sweater|blouse|shoes|gown|robe)/i

/** 颜色 → 家族（同一家族的不同写法不算冲突） */
const COLOUR_FAMILIES: Record<string, string[]> = {
  black: ['black'],
  white: ['white', 'pure white'],
  grey: ['grey', 'gray', 'charcoal', 'slate', 'ashen', 'dark charcoal', 'matte charcoal'],
  navy: ['navy', 'navy-blue', 'navy blue', 'dark navy', 'midnight'],
  blue: ['blue', 'pale blue', 'grey-blue', 'denim'],
  red: ['red', 'crimson', 'wine-red', 'deep red'],
  burgundy: ['burgundy', 'wine', 'maroon'],
  rose: ['rose', 'rose-pink', 'pink', 'magenta', 'hot-pink', 'fuchsia'],
  cream: ['cream', 'cream-white', 'pale cream', 'beige', 'ivory', 'champagne'],
  plum: ['plum', 'deep plum'],
  gold: ['gold'],
  green: ['green', 'olive'],
  brown: ['brown', 'tan', 'khaki'],
  silver: ['silver'],
}

function colourFamily(word: string): string | null {
  const w = word.toLowerCase()
  for (const [fam, words] of Object.entries(COLOUR_FAMILIES)) if (words.includes(w)) return fam
  return null
}

/** 取「紧贴服装名词」的服装词与颜色（向左 5 个词的窗口） */
function garmentBits(text: string, window = 5): { garments: Set<string>; colours: Set<string> } {
  const words = String(text || '').match(/[A-Za-z][A-Za-z'-]*/g) || []
  const garments = new Set<string>()
  const colours = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    if (!GARMENT_NOUN.test(words[i])) continue
    garments.add(words[i].toLowerCase())
    for (const w of words.slice(Math.max(0, i - window), i + 1)) {
      const fam = colourFamily(w)
      if (fam) colours.add(fam)
    }
  }
  return { garments, colours }
}

export interface RetentionOutfitHit {
  subject: number
  /** 保留项的服装词在定义里的重合率（0~1） */
  overlap: number
  reason: 'garment' | 'colour'
  defGarments: string[]
  retGarments: string[]
  defColours: string[]
  retColours: string[]
}

/**
 * 命中「保留项的服装与定义对不上」的 <Subject N>；没命中返回空数组。
 * 只查**人物主体**（定义里带 `<Picture N>` 且写着 woman/man/… 的那些）。
 */
export function findRetentionOutfitMismatch(en: string): RetentionOutfitHit[] {
  const sec = splitSections(String(en || ''))
  const sd = sec['subject_definitions'] || ''
  const ra = sec['retention_analysis'] || ''
  if (!sd || !ra) return []
  const defs = new Map<number, string>()
  for (const m of sd.matchAll(/<Subject (\d+)>([\s\S]*?)(?=\n<Subject \d+>|$)/g)) defs.set(Number(m[1]), m[2])
  const rets = new Map<number, string>()
  for (const m of ra.matchAll(/<Subject (\d+)[^:\n]*:\s*(?:fully_preserved|partially_preserved|attribute_transfer|weak_reference)\s*-\s*([^\n]*)/g)) {
    rets.set(Number(m[1]), m[2])
  }
  const hits: RetentionOutfitHit[] = []
  for (const [n, def] of defs) {
    if (!/<Picture \d+>/.test(def)) continue
    if (!/\b(?:woman|man|girl|boy|lady|hostess|waiter|guard|mother|father|police|officer)\b/i.test(def)) continue
    const line = rets.get(n)
    if (!line) continue
    const d = garmentBits(def), r = garmentBits(line)
    if (!r.garments.size) continue
    const shared = [...r.garments].filter(g => d.garments.has(g)).length
    const overlap = shared / r.garments.size
    const colourConflict = d.colours.size > 0 && r.colours.size > 0
      && ![...r.colours].some(c => d.colours.has(c))
    if (overlap >= 0.5 && !colourConflict) continue
    hits.push({
      subject: n, overlap: Math.round(overlap * 100) / 100,
      reason: overlap < 0.5 ? 'garment' : 'colour',
      defGarments: [...d.garments].sort(), retGarments: [...r.garments].sort(),
      defColours: [...d.colours].sort(), retColours: [...r.colours].sort(),
    })
  }
  return hits
}
