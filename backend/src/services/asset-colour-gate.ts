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
// ⚠️ 正则择先匹配：**长的 / 具体的写法必须排在短的 / 笼统的前面**，否则「灰棕」会被「灰」抢先吃掉
//    （2026-10-16 实测：卡面「灰棕色对襟布衫」抽成「灰」，于是稿子写 `grey` 也被判「一致」）。
const COLOURS = [
  // ① 多词英文（先长后短）
  'grey-brown', 'gray-brown', 'greyish brown', 'brownish grey', 'salmon pink', 'steel grey', 'steel gray',
  'dark blue', 'deep blue', 'midnight blue', 'navy blue', 'light blue', 'pale blue', 'dark green',
  'dark red', 'wine-red', 'off-white', 'salt-and-pepper',
  // ② 单字英文
  'black', 'white', 'grey', 'gray', 'silver', 'golden', 'gold', 'brown', 'blond', 'blonde', 'straw',
  'auburn', 'ginger', 'red', 'maroon', 'wine', 'navy', 'blue', 'beige', 'cream', 'ivory', 'pink',
  'orange', 'yellow', 'green', 'purple', 'tan', 'bronze', 'copper', 'greige', 'taupe',
  // ③ 中文复合色（必须先于单字：灰棕 > 灰、枯黄 > 黄、米白 > 白）
  '灰褐色', '灰棕色', '灰褐', '灰棕', '米白色', '米色', '奶油色', '花白', '灰白', '酒红色', '藏蓝色',
  '深蓝色', '浅蓝色', '墨绿色', '藏青色', '蜡黄', '枯黄', '古铜', '银灰',
  // ④ 中文单字
  '黑', '白', '灰', '银', '金', '棕', '褐', '栗', '黄', '红', '蓝', '粉', '橙', '绿', '紫', '铜', '驼',
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
  ['灰棕', ['grey-brown', 'greyish brown', 'greyish-brown', 'grey brown']],   // 用户 2026-10-16 把卡面改成「灰棕色」
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
for (const [concept] of CONCEPTS) COMPONENTS.set(concept, [concept])
/**
 * 同色族 = **互认的同义词**（不是「更笼统的写法」）。
 *
 * 2026-10-16 用户实测推翻了我原先的「组合色按成分放宽」假设：
 *   卡面「**灰棕**色对襟布衫」→ 提示词写 `grey-brown` 成片对（9集分镜1 ✓），
 *   写 `grey`（只有灰）成片就是**纯灰**（8集分镜7/8/9 ✗）。**H3 只认字面颜色词。**
 * ⇒ 所以 灰 ∉ 灰棕一族：宁可多报，也不许把 `grey` 当 `grey-brown` 放行。
 */
const FAMILIES: string[][] = [
  ['灰棕', '灰褐', '棕'],          // 灰棕/灰褐/棕：都是棕系（卡面写灰褐、稿子写 brown 算对；写 grey 不算）
  ['褐', '棕', '灰褐', '灰棕'],
  ['深蓝', '藏蓝', '藏青'],        // 卡面「深蓝色警服」↔ 稿子 `navy police uniform`（实测 sb481 警察）
  ['花白', '灰白', '灰'],          // 「花白短发」↔ `grey hair`
  ['黄', '枯黄', '蜡黄'],          // 「染成枯黄后长出黑根」↔ `straw-dyed hair`（同一个黄系）
]
for (const fam of FAMILIES) for (const c of fam) COMPONENTS.set(c, fam)
/** 颜色概念 → 写提示词时该用的英文（重写指令里直接给模型，避免它自己缩成 grey） */
export const EN_CANON: Record<string, string> = {
  灰棕: 'grey-brown', 灰褐: 'grey-brown', 褐: 'brown', 棕: 'brown',
  深蓝: 'navy / dark blue', 藏蓝: 'navy', 藏青: 'navy', 蓝: 'blue', 浅蓝: 'light blue',
  黑: 'black', 白: 'white', 灰: 'grey', 花白: 'greying grey', 灰白: 'pale grey',
  枯黄: 'straw-dyed', 蜡黄: 'sallow', 米白: 'cream', 米色: 'beige', 酒红: 'burgundy',
  红: 'red', 墨绿: 'dark green', 绿: 'green', 黄: 'yellow', 银: 'silver', 金: 'gold',
  粉: 'pink', 橙: 'orange', 紫: 'purple', 驼: 'camel', 古铜: 'bronze', 铜: 'copper',
}
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
/** 颜色写法 → 概念（认不出返回 null）。卡面常写「灰棕**色**对襟布衫」 ⇒ 去掉尾部「色」再查。 */
export const colourConcept = (token: string): string | null => {
  const raw = String(token || '').trim()
  return TO_CONCEPT.get(raw.toLowerCase())
    || TO_CONCEPT.get(raw.replace(/色$/, ''))
    || TO_CONCEPT.get(raw.replace(/色$/, '').toLowerCase())
    || TO_CONCEPT.get(raw.replace(/[a-z]/gi, '').trim())
    || null
}

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

/* ── 全文校色（4.0.53）─────────────────────────────────────────────
 * 事故（用户第二次报同一个问题）：「8集分镜7 衣服还是蓝色」。日志显示闸**每次都触发**、
 *   `garment-colour-after-fix remaining=0` —— 但它只查/只改 `subject_definitions` 一段，
 *   同一件衣服的颜色在另外两处原样留着：
 *     retention_analysis: <Subject 2> … fully_preserved - **dark blue** front-opening cloth jacket
 *     detailed_description: … the stooped woman in the **dark blue** cloth jacket …
 *   H3 读的是全文 ⇒ 成片照样全蓝。教训：**闸的覆盖面必须等于模型的读入面（全文）**，
 *   否则「修好了」只是自己骗自己（`remaining=0` 只看了一段）。
 */
const STOP = new Set(['the', 'and', 'with', 'that', 'this', 'her', 'his', 'its', 'for', 'from', 'only', 'left', 'right', 'side', 'who', 'has', 'have', 'are', 'was', 'she', 'he', 'him', 'them', 'their', 'into', 'over', 'under', 'same', 'each', 'when', 'while', 'than', 'then', 'them', 'very', 'still', 'both', 'does', 'holds', 'kept', 'keeps'])
/** 一行里的「非颜色实词」（衣物/款式/部位词）—— 用来判断正文某句在说**同一个人的同一件衣服** */

/** 从句里出现的颜色（服装从句 + 发型从句都算） */

function permitted(line: string, text: string, kind: ColourWhat): boolean {
  const pick = kind === 'garment' ? garmentColours : hairColours
  const want = pick(text).map(colourConcept).filter((c): c is string => !!c)
  const got = pick(line).map(colourConcept).filter((c): c is string => !!c)
  if (!want.length || !got.length) return true            // 任一边没颜色 → 交给缺色闸
  return !got.some(g => !want.some(w => sameColour(g, w)))
}

/**
 * 全文校色：定义段（按 `<Subject N>`）+ 保留段（同样带编号）+ **正文/概述里没有编号的散句**。
 *
 * 正文散句的归属判据（第二版，第一版用「身份线索词」误报严重 —— 实测把已知正确的 sb484 也抓了 2 条）：
 *   该从句必须与某主体的定义行**共享 ≥2 个非颜色实词**（如 `cloth`+`jacket`）才算同一个人的同一件衣服。
 *   实测对照：`the stooped woman in the dark blue cloth jacket` ↔ 王梅定义行共享 {cloth, jacket} ⇒ 命中 ✓；
 *   警察那句 `navy police uniform jacket` 只共享 {jacket} ⇒ 跳过 ✓（卡面颜色不同也不再误报）。
 * @param fullText 英文提示词全文（H3 实际读的那份）
 * @param assets   本分镜的参考资产（含角色卡文字）
 */
export function findColourMismatchInPrompt(fullText: string, assets: CommunityAsset[]): GarmentColourMismatch[] {
  const text = String(fullText || '')
  const out: GarmentColourMismatch[] = []
  // **逐段**扫带宽度的行（定义段 / 概述+保留段 / 正文段里的 `<Subject N>` 行）。
  //   ⚠️ 不能把全文合成一份 `<Subject N>` → 行 的 Map：同一主体在定义段和 retention_analysis 里各有一行，
  //   后出现的会覆盖前面的（4.0.51/52 的漏网正是这样：定义段被修好了，保留段那行「dark blue」没人看，
  //   而 H3 读全文 ⇒ 成片照样全蓝）。
  //   ⚠️ 也**不猜**没有编号的散文散句：试过「按身份线索词归属」和「按共享实词归属」两版，
  //   都会把已知正确的稿子误报（实测 sb484 两次被抓）⇒ 宁可漏报，只查可归属的行。
  //   只扫 `subject_definitions` 与 `retention_analysis` 两段：这两段里 `<Subject N>` 那行**只讲该主体**
  //   （一人一行）。正文段的行即使是 `<Subject N>` 打头也常混着群演/别的角色的颜色（实测 sb484 因此误报），
  //   正文的复述由重写指令覆盖（4.0.53 起重写会把三段一起交给模型改）。
  //   ⚠️ 切块要按**全部六个段名**切，否则「retention_analysis」那块会一路吃到正文段结尾，
  //   里面的 `<Subject N>` 行又变成最后一行说了算（第一次改成逐段查时正是这个 bug）。
  const SECTION = 'subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music'
  for (const block of text.split(new RegExp(`(?=^\\s*(?:${SECTION})\\s*:)`, 'm'))) {
    const head = (block.match(/^\s*([a-z_]+)\s*:/) || [])[1]
    if (head !== 'subject_definitions' && head !== 'retention_analysis') continue
    if (!/<Subject \d+>/.test(block)) continue
    out.push(...findGarmentColourMismatch(block, assets))
  }
  return out
}

/** 给重写 prompt 用：把「卡面是什么色」直接塞给模型 */
export function garmentColourNote(hits: GarmentColourMismatch[]): string {
  return hits
    .map(h => `- <Subject ${h.picture}>（${h.name}）**${WHAT_ZH[h.what]}写成了「${h.found}」，卡面文字是「${h.expected}」** —— 英文必须写成 ${h.expected.split('/').map(c => EN_CANON[c] || c).join(' / ')}（**不许缩写成更笼统的色词**，写 grey 就出纯灰、写 grey-brown 才出灰棕）；不许借同场其他角色/群演的颜色`)
    .join('\n')
}
