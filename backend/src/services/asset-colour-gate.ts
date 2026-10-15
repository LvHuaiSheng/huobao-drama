/**
 * 发色 / 肤色 / 服装颜色 / 配饰颜色的机械闸 —— 零依赖纯函数（与 retention-gate / seg-compress-gate 同惯例，可单测）
 *
 * 2026-10-15 加。实测（用户报「第8集分镜8 人物头发和衣服颜色没保住，长相保住了」）：
 *   ① 警察两位卡面是**黑色短发**，但卡字段里从没写过发色（警察甲的 `styling` 当时写的是剧情说明）
 *      → 生成提示词的模型**看不到图、只能读文字** → 颜色从没进过提示词 → H3 自己猜 → 发色跑掉；
 *   ② 王梅的 `styling` 写「深蓝**或**灰褐色对襟布衫」，提示词挑走深蓝，而定妆卡实际是灰褐色
 *      → 文字与参考图打架 → 衣服颜色保不住。
 * 项目铁律：**能给提示词"看见"的只有卡里的文字** —— 发色/肤色/服装色/配饰色都要写死，且不许「或」。
 *
 * 判据同时认**中英两种写法**：资产字段是中文（王梅「肤色蜡黄」「银镯」），英文发送版是英文（`straw-dyed hair`、`navy uniform jacket`）。
 */

/** 颜色/材质词（中英） */
const COLOURS = [
  // 英
  'black', 'white', 'grey', 'gray', 'silver', 'golden', 'gold', 'brown', 'blond', 'blonde', 'straw',
  'auburn', 'ginger', 'red', 'maroon', 'wine', 'navy', 'blue', 'beige', 'cream', 'ivory', 'pink',
  'orange', 'yellow', 'green', 'purple', 'tan', 'bronze', 'copper',
  // 中
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
/** 肤色的「色」判据：肤色词 ↔ 颜色/明暗词 */
const SKINWORDS = ['skin', 'complexion', '肤色', '皮肤', '面色', '妆面', '肤色健康'].join('|')
const SKIN_TONES = COLOURS + '|' + ['fair', 'pale', 'olive', 'sallow', 'dark', 'tanned', '深', '浅', '健康', '白皙', '黝黑', '小麦', '素颜', '哑光', '蜡黄', '红润'].join('|')
/** 配饰判据（要带颜色或材质） */
const ACCESSORIES = ['bangle', 'bracelet', 'necklace', 'earring', 'ring', 'watch', 'badge', 'button', 'hairpin', 'glasses',
  'scarf', 'bead', 'pendant', 'brooch',
  '手镯', '镯', '项链', '耳环', '耳钉', '戒指', '手表', '徽章', '胸章', '纽扣', '发卡', '发夹', '眼镜', '腰带扣', '头饰', '玉佩'].join('|')

/** 颜色词与目标词相距 ≤40 字符（任一侧）就算「写出来了」 */
function near(line: string, colours: string, targets: string): boolean {
  const t = String(line || '')
  return new RegExp(`(?:${colours})[^。；;,.，]{0,40}(?:${targets})`, 'i').test(t)
    || new RegExp(`(?:${targets})[^。；;,.，]{0,40}(?:${colours})`, 'i').test(t)
}

/** 写了发色吗（`black short hair` / `lank straw-dyed hair` / 「染成枯黄后长出黑根」） */
export function hasHairColour(line: string): boolean { return near(line, COLOURS, HAIRWORDS) }
/** 写了服装颜色吗（`navy police uniform jacket` / 「深蓝或灰褐色对襟布衫」） */
export function hasGarmentColour(line: string): boolean { return near(line, COLOURS, GARMENTS) }
/** 写了肤色吗（`sallow skin` / 「肤色健康偏深」/「皮肤蜡黄」） */
export function hasSkinTone(line: string): boolean { return near(line, SKIN_TONES, SKINWORDS) }
/** 写了配饰颜色/材质吗（`tarnished silver bangle` / 「腕上一只细银镯」） */
export function hasAccessoryColour(line: string): boolean { return near(line, COLOURS, ACCESSORIES) }

/** 资产文字里有「或 / 皆可 / 任选 / 可能 / either」→ 返回命中的词（造型没写死） */
export function ambiguousStyling(text: string): string | null {
  const m = String(text || '').match(/或|皆可|任选|可能|亦可|either|or the|二者/)
  return m ? m[0] : null
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
export type ColourWhat = 'hair' | 'skin' | 'garment' | 'accessory'
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
export const WHAT_ZH: Record<ColourWhat, string> = { hair: '发色', skin: '肤色', garment: '服装颜色', accessory: '配饰颜色' }
const CHECKERS: Record<ColourWhat, (s: string) => boolean> = {
  hair: hasHairColour, skin: hasSkinTone, garment: hasGarmentColour, accessory: hasAccessoryColour,
}

/** 定义段 vs 资产文字：逐角色比对「发色 / 肤色 / 服装色 / 配饰色」四类 */
export function findColourGaps(defs: string, assets: CommunityAsset[]): ColourGap[] {
  const lines = subjectLines(defs)
  const gaps: ColourGap[] = []
  for (const a of assets) {
    if (a.kind !== 'character') continue
    const line = lines.get(a.picture) || ''
    if (!line) continue
    const text = a.assetText || ''
    for (const what of ['hair', 'skin', 'garment', 'accessory'] as ColourWhat[]) {
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

/** 卡数据自身缺哪些颜色（体检 / 补卡提示用）：返回该角色缺的类别 */
export function assetColourGaps(text: string): ColourWhat[] {
  return (['hair', 'skin', 'garment', 'accessory'] as ColourWhat[]).filter(w => !CHECKERS[w](text))
}
