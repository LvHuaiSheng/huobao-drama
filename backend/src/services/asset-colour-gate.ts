/**
 * 发色 / 服装颜色的机械闸 —— 零依赖纯函数（与 retention-gate / seg-compress-gate 同惯例，可单测）
 *
 * 2026-10-15 加。实测（用户报「第8集分镜8 人物头发和衣服颜色没保住，长相保住了」）：
 *   ① 警察两位卡面是**黑色短发**，但卡字段里从没写过发色（警察甲的 `styling` 当时写的是剧情说明）
 *      → 生成提示词的模型**看不到图、只能读文字** → 颜色从没进过提示词 → H3 自己猜 → 发色跑掉；
 *   ② 王梅的 `styling` 写「深蓝**或**灰褐色对襟布衫」，提示词挑走深蓝，而定妆卡实际是灰褐色
 *      → 文字与参考图打架 → 衣服颜色保不住。
 * 项目铁律：**能给提示词"看见"的只有卡里的文字** —— 发色/服装色要写死，且不许「或」。
 *
 * 🔴 只查这两项（2026-10-15 用户拍板）：**肤色与配饰不做机械检查** ——
 *   有些角色本来就是特殊肤色（异色/幻想肤色），有些角色压根没有配饰，机械查会大量误报。
 *   技能层仍要求把颜色写全（`appearance`/`styling`），但那属于写作指引、不做代码闸。
 *
 * 判据同时认**中英两种写法**：资产字段是中文（「头发染成枯黄后长出黑根」），英文发送版是英文（`straw-dyed hair`）。
 */

/** 颜色/材质词（中英） */
const COLOURS = [
  'black', 'white', 'grey', 'gray', 'silver', 'golden', 'gold', 'brown', 'blond', 'blonde', 'straw',
  'auburn', 'ginger', 'red', 'maroon', 'wine', 'navy', 'blue', 'beige', 'cream', 'ivory', 'pink',
  'orange', 'yellow', 'green', 'purple', 'tan', 'bronze', 'copper',
  '黑', '白', '灰', '银', '金', '棕', '褐', '栗', '黄', '红', '酒红', '藏蓝', '深蓝', '浅蓝', '蓝',
  '米白', '米色', '奶油', '粉', '橙', '绿', '紫', '花白', '灰白', '铜', '墨绿', '藏青', '驼', '蜡黄', '古铜',
].join('|')

/** 发色判据：颜色词 ↔ 发型词（彼此相距 ≤40 字符） */
const HAIRWORDS = ['hair', 'crew cut', 'cropped hair', 'buzz cut', 'bob', 'ponytail', 'braid', 'updo', 'sideburns', 'bald',
  '发', '头发', '短发', '长发', '平头', '寸头', '马尾', '辫', '刘海', '鬓角', '盘发', '发型', '染'].join('|')
/** 服装判据 */
const GARMENTS = ['jacket', 'coat', 'shirt', 'blouse', 'dress', 'uniform', 'apron', 'trousers', 'pants', 'skirt', 'suit',
  'robe', 'shoes', 'boots', 'cardigan', 'sweater', 'vest', 'scarf', 'tie', 'belt', 'hat', 'outfit', 'garment', 'top',
  '衫', '衣', '外套', '制服', '警服', '裙', '裤', '鞋', '围裙', '夹克', '西装', '衬衫', '大衣', '背心', '毛衣', '领带', '腰带', '帽', '褂'].join('|')

/** 颜色词与目标词相距 ≤40 字符（任一侧）就算「写出来了」 */
function near(line: string, targets: string): boolean {
  const t = String(line || '')
  return new RegExp(`(?:${COLOURS})[^。；;,.，]{0,40}(?:${targets})`, 'i').test(t)
    || new RegExp(`(?:${targets})[^。；;,.，]{0,40}(?:${COLOURS})`, 'i').test(t)
}

/** 写了发色吗（`black short hair` / `lank straw-dyed hair` / 「染成枯黄后长出黑根」） */
export function hasHairColour(line: string): boolean { return near(line, HAIRWORDS) }
/** 写了服装颜色吗（`navy police uniform jacket` / 「深蓝或灰褐色对襟布衫」） */
export function hasGarmentColour(line: string): boolean { return near(line, GARMENTS) }

/** 引号里的台词不参与检查（实测：顾明轩的 `外观` 里写着台词「不可能！她就只是个保洁！」） */
const DIALOGUE_SPAN = /「[^」]*」|“[^”]*”|"[^"]*"|<d>[\s\S]*?<\/d>/g
/** 排他说明的否定词 —— 项目既有口径：排他句里的「或」不算（如「不出现任何文字、水印或签名」） */
const NEGATION = /(不|无|没|未|禁|避免|不再|排除|除外|除[^，。;]{0,20}外|no |not |never|without|avoid|except)/i

/**
 * 资产文字里有没有**没写死的二选一**；有就返回命中的词 + 原句片段（片段是给人定位用的）。
 *
 * 豁免（2026-10-15 用户实跑体检命中两条误报后加的）：
 *   - 含否定/排他词的整句跳过：「除上述两行红字外不再出现任何其他文字、图标**或**数字」✓ 不算；
 *   - 引号/`<d>` 里的台词整段剥掉（台词里的「不可能」不是造型描述）；
 *   - 「可能 / 二者」这类语气词已从判据里删除（它们是含糊，不是二选一）。
 */
export function ambiguousStyling(text: string): { word: string; snippet: string } | null {
  const clean = String(text || '').replace(DIALOGUE_SPAN, ' ')
  for (const clause of clean.split(/[。；;，,\n]/)) {
    const m = clause.match(/或者|或|皆可|任选|亦可|either\s+\w+\s+or/)
    if (!m) continue
    if (NEGATION.test(clause)) continue
    return { word: m[0].trim(), snippet: clause.trim().slice(0, 120) }
  }
  return null
}

/** 从 `subject_definitions` 段抽出 `<Subject N>` → 该行原文 */
export function subjectLines(defs: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of String(defs || '').split('\n')) {
    const m = line.match(/<Subject (\d+)>/)
    if (m) out.set(parseInt(m[1], 10), line)
  }
  return out
}

export interface CommunityAsset { picture: number; kind: 'scene' | 'character' | 'prop'; name: string; assetText: string }
export type ColourWhat = 'hair' | 'garment'
export interface ColourGap {
  picture: number
  name: string
  kind: 'character' | 'prop'
  what: ColourWhat
  /** 资产文字里其实写了 → 提示词漏了，可以靠重写补上；false = 卡里就没有，得先补卡 */
  assetHasIt: boolean
  /** 资产文字片段（给重写 prompt / 报警用） */
  assetSnippet: string
}

const snippet = (t: string) => String(t || '').replace(/\s+/g, ' ').slice(0, 140)
export const WHAT_ZH: Record<ColourWhat, string> = { hair: '发色', garment: '服装颜色' }
const CHECKERS: Record<ColourWhat, (s: string) => boolean> = { hair: hasHairColour, garment: hasGarmentColour }

/** 定义段 vs 资产文字：逐角色比对「发色 / 服装颜色」 */
export function findColourGaps(defs: string, assets: CommunityAsset[]): ColourGap[] {
  const lines = subjectLines(defs)
  const gaps: ColourGap[] = []
  for (const a of assets) {
    if (a.kind !== 'character') continue
    const line = lines.get(a.picture) || ''
    if (!line) continue
    const text = a.assetText || ''
    for (const what of ['hair', 'garment'] as ColourWhat[]) {
      if (CHECKERS[what](line)) continue
      gaps.push({ picture: a.picture, name: a.name, kind: 'character', what, assetHasIt: CHECKERS[what](text), assetSnippet: snippet(text) })
    }
  }
  return gaps
}

/** 缺颜色要不要打回重写：只要有一条「卡里有、提示词漏了」就值得重写一轮 */
export function shouldRewriteForColour(gaps: ColourGap[]): boolean {
  return gaps.some(g => g.assetHasIt)
}

/** 给重写 prompt 用的一句话说明（只列能靠重写补上的） */
export function colourRewriteNote(gaps: ColourGap[]): string {
  return gaps.filter(g => g.assetHasIt)
    .map(g => `- <Subject ${g.picture}>（${g.name}）没写${WHAT_ZH[g.what]}；资产文字里写的是：${g.assetSnippet}`)
    .join('\n')
}

/** 卡数据自身缺哪些颜色（体检 / 补卡提示用）：只查发色与服装颜色 */
export function assetColourGaps(text: string): ColourWhat[] {
  return (['hair', 'garment'] as ColourWhat[]).filter(w => !CHECKERS[w](text))
}

/* ───────────────────────── 服装颜色「对不对」─────────────────────────
 * 2026-10-16 加（用户报「第8集分镜8/9/10 王梅上身应该是灰褐色，出来的都是蓝色」）。
 * 上面 `findColourGaps` 只查「有没有写颜色」，**不查写的颜色对不对** —— 而实测模型会
 * 照抄卡面的**衣服款式**、把**颜色换掉**：卡面「灰褐色对襟布衫 + 洗得发白碎花围裙」，
 * 提示词却写成 `dark blue front-opening cloth jacket over a faded small-floral apron`
 * （分镜8/10），分镜9 甚至编成 `deep red sleeveless evening dress`。库里的角色数据是干净的
 * （`styling` / `final_prompt` 都写灰褐），所以只能是模型自己换的色 —— 它会从同场的
 * 群演服饰（「深蓝、酒红、米白、浅灰」）或别的角色（警察深蓝制服）借颜色。
 *
 * 判据：① 卡面文字里的「服装颜色」→ 颜色概念集合（支持中英两写法）；
 *      ② 提示词该角色定义行里的服装颜色 → 颜色概念集合；
 *      ③ **两边都有颜色、且完全不相交** → 命中（低误报：任一边没颜色就跳过，交给上面的缺色闸）。
 * 组合色按成分放宽：卡面「灰褐」也接受提示词只写 `grey` 或 `brown`（是它的成分），
 * 但**不接受** `blue` / `red`（与灰褐无关）—— 本次事故正是后者。
 */
const CONCEPTS: Array<[string, string[]]> = [
  ['灰褐', ['grey-brown', 'greyish brown', 'greyish-brown', 'grey brown', 'greige', 'taupe']],
  ['深蓝', ['dark blue', 'deep blue', 'midnight blue']],
  ['藏蓝', ['navy', 'navy blue', 'dark navy']],
  ['藏青', ['dark navy blue']],   // navy 只归「藏蓝」：一个英文写法只能映射到一个概念，否则同色被判不同
  ['浅蓝', ['light blue', 'pale blue', 'pale blue-grey']],
  ['蓝', ['blue']],
  ['墨绿', ['dark green', 'deep green']],
  ['绿', ['green']],
  ['酒红', ['wine', 'wine-red', 'burgundy', 'maroon', 'oxblood', 'deep red', 'dark red']],
  ['红', ['red', 'crimson', 'scarlet']],
  ['米白', ['cream', 'ivory', 'off-white', 'bone']],
  ['米色', ['beige', 'sand']],
  ['花白', ['salt-and-pepper', 'greying', 'graying', 'steel grey', 'steel gray']],
  ['灰白', ['grey-white', 'gray-white', 'white-grey']],
  ['枯黄', ['straw', 'straw-dyed', 'yellowed', 'dull yellow']],
  ['蜡黄', ['sallow', 'waxy yellow', 'pale yellow']],
  ['黑', ['black']],
  ['白', ['white']],
  ['灰', ['grey', 'gray']],
  ['褐', ['brown', 'taupe']],
  ['棕', ['brown', 'chestnut', 'cocoa']],
  ['黄', ['yellow']],
  ['银', ['silver']],
  ['金', ['gold', 'golden']],
  ['粉', ['pink']],
  ['橙', ['orange']],
  ['紫', ['purple', 'violet']],
  ['驼', ['camel', 'tan']],
  ['古铜', ['bronze']],
  ['铜', ['copper']],
]
/** 英文写法 → 颜色概念（小写键） */
const TO_CONCEPT = new Map<string, string>()
/** 概念 → 自身 + 成分（组合色放宽用，如「灰褐」→ 灰、褐） */
const COMPONENTS = new Map<string, string[]>()
for (const [concept, aliases] of CONCEPTS) {
  TO_CONCEPT.set(concept, concept)
  for (const a of aliases) TO_CONCEPT.set(a.toLowerCase(), concept)
}
const CN_CONCEPTS = new Set(CONCEPTS.map(c => c[0]))
for (const [concept] of CONCEPTS) {
  const parts = [...concept].filter(ch => CN_CONCEPTS.has(ch) && ch !== concept)
  COMPONENTS.set(concept, [concept, ...parts])
}
// 同义色族（互认，避免把同一个颜色判成两个）：
//   褐 / 棕 —— 卡面写「灰褐色」而提示词写 `brown` 是常事；
//   深蓝 / 藏蓝 / 藏青 —— 卡面「深蓝色警服」↔ 提示词 `navy police uniform`（实测 sb481 警察）。
// 注意：**不把「蓝」算进深蓝一族** —— 深蓝 ≠ 笼统的蓝，让「写在深蓝卡面上、稿子写 light blue」能被抓出来。
COMPONENTS.set('褐', ['褐', '棕'])
COMPONENTS.set('棕', ['棕', '褐'])
COMPONENTS.set('深蓝', ['深蓝', '藏蓝', '藏青'])
COMPONENTS.set('藏蓝', ['藏蓝', '藏青', '深蓝'])
COMPONENTS.set('藏青', ['藏青', '藏蓝', '深蓝'])
/** 概念等价判据：两边任意组合有交集即算「同一个颜色」 */
const sameColour = (a: string, b: string): boolean => {
  const A = COMPONENTS.get(a) || [a]
  const B = COMPONENTS.get(b) || [b]
  return A.some(x => B.includes(x))
}
/** 抽出**含指定词**的从句里的颜色词。
 *  按从句（。；，\n 切分）取色，而不是「离目标词 ≤40 字符」——
 *  后者会把同一行里的发色 / 鞋子 / 银镯颜色一起算成服装色（实测王梅卡面一次抽出 灰/褐/白/黄/黑/银 六个），
 *  把判据稀释成几乎不会命中。 */
function coloursInClausesWith(text: string, targets: string): string[] {
  const t = String(text || '')
  const out: string[] = []
  for (const clause of t.split(/[。；;，,\n]/)) {
    if (!new RegExp(`(?:${targets})`, 'i').test(clause)) continue
    for (const m of clause.matchAll(new RegExp(COLOURS, 'gi'))) out.push(m[0])
  }
  return Array.from(new Set(out))
}
/** 服装从句里的颜色（`grey-blue janitor work jacket` / 「灰褐色对襟布衫」） */
export const garmentColours = (text: string): string[] => coloursInClausesWith(text, GARMENTS)
/** 发型从句里的颜色（`lank straw-dyed hair` / 「头发染成枯黄后长出黑根」）——4.0.51 一并纳入校色 */
export const hairColours = (text: string): string[] => coloursInClausesWith(text, HAIRWORDS)
/** 颜色写法 → 概念（认不出返回 null） */
export const colourConcept = (token: string): string | null =>
  TO_CONCEPT.get(String(token || '').trim().toLowerCase())
  || TO_CONCEPT.get(String(token || '').replace(/[a-z]/gi, '').trim())
  || null

export interface GarmentColourMismatch {
  picture: number
  name: string
  /** 哪一项不符：服装颜色 / 发色 */
  what: ColourWhat
  /** 卡面服装颜色（原文片段） */
  expected: string
  /** 提示词写成了什么 */
  found: string
  /** 提示词那一行（定位用） */
  line: string
}

/** 定义段 vs 资产文字：**颜色写得对不对**（只查服装；发色同理但事故仅见于服装，先只做服装） */
export function findGarmentColourMismatch(defs: string, assets: CommunityAsset[]): GarmentColourMismatch[] {
  const lines = subjectLines(defs)
  const out: GarmentColourMismatch[] = []
  for (const a of assets) {
    if (a.kind !== 'character') continue
    const line = lines.get(a.picture) || ''
    const text = a.assetText || ''
    if (!line || !text) continue
    // 服装与发色都查（发色同类事故：分镜9 稿子写 `short dark hair`，卡面是「染成枯黄后长出黑根」）
    for (const what of ['garment', 'hair'] as ColourWhat[]) {
      const pick = what === 'garment' ? garmentColours : hairColours
      const want = pick(text).map(colourConcept).filter((c): c is string => !!c)
      const got = pick(line).map(colourConcept).filter((c): c is string => !!c)
      if (!want.length || !got.length) continue          // 任一边没颜色 → 交给缺色闸
      // 严格判据：**有任何一处该部位的颜色与卡面不同族**就算错。
      //   （反例教训：宽松版「只要有一个颜色对上就放过」会被无关衣物的颜色救走 —— 实测 sb481 外套写
      //    `dark blue`、只因裤子写了 `grey` 就被判定为「一致」，而卡面灰褐 → 成片上半身全蓝。）
      const foreign = got.filter(g => !want.some(w => sameColour(g, w)))
      if (!foreign.length) continue
      out.push({
        picture: a.picture, name: a.name, what,
        expected: pick(text).join('/'),
        found: foreign.join('/'),
        line: snippet(line),
      })
    }
  }
  return out
}

/** 给重写 prompt 用：把「卡面是什么色」直接塞给模型 */
export function garmentColourNote(hits: GarmentColourMismatch[]): string {
  return hits
    .map(h => `- <Subject ${h.picture}>（${h.name}）**${WHAT_ZH[h.what]}写成了「${h.found}」，卡面文字是「${h.expected}」** —— 必须逐字改成卡面的颜色，不许借同场其他角色/群演的颜色`)
    .join('\n')
}
