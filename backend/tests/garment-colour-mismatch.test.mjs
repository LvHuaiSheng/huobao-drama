/**
 * 「服装颜色写得对不对」闸回归（2026-10-16）
 *
 * 用户报「第8集 分镜8/9/10 王梅上身应该是灰褐色，出来的都是蓝色」。
 * 库里王梅的角色数据是干净的（styling / final_prompt 都写「灰褐色对襟布衫 + 洗得发白碎花围裙」），
 * 但三份提示词都被模型换成了别的颜色：
 *   分镜8  <Subject 2> … dark blue front-opening cloth jacket over a faded small-floral apron
 *   分镜10 <Subject 3> … dark blue front-opening cloth jacket over a faded small-floral apron
 *   分镜9  <Subject 2> … deep red sleeveless evening dress   ← 连款式都换了
 * 旧闸（findColourGaps）只查「有没有写颜色」，所以三条全过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { findGarmentColourMismatch, findColourMismatchInPrompt, garmentColours, colourConcept } =
  await import('../src/services/asset-colour-gate.ts')

const WANGMEI = '九十年代至千禧年初风格的佣人打扮：灰褐色对襟布衫，外罩洗得发白的碎花围裙，头发染成枯黄后长出黑根，梳成低矮松散的半扎发；脚穿黑色老式布鞋，腕上一只细银镯已氧化发暗。'
const ASSETS = [{ picture: 2, kind: 'character', name: '王梅', assetText: WANGMEI }]
const defs = (line) => `subject_definitions:\n<Subject 1> is the banquet hall scene in <Picture 1>, flat colour blocks.\n${line}`

test('实测 sb481/sb483：卡面灰褐、提示词写 dark blue → 命中', () => {
  const line = "<Subject 2> is the stooped middle-aged Chinese woman in <Picture 2>, lank straw-dyed hair with dark roots, dark blue front-opening cloth jacket over a faded small-floral apron, whose outfit comes from <Picture 2> only."
  const hits = findGarmentColourMismatch(defs(line), ASSETS)
  assert.equal(hits.length, 1, '应命中 1 条')
  assert.equal(hits[0].picture, 2)
  assert.match(hits[0].expected, /灰/)   // 卡面写「灰褐色」→ 抽成 灰/褐（COLOURS 词表里没有「灰褐」这个词）
  assert.match(hits[0].found, /蓝/)   // found/expected 报的是颜色概念（中文），给体检文案直接用
})

test('实测 sb482：deep red sleeveless evening dress（颜色+款式都换）→ 命中', () => {
  const line = "<Subject 2> is the middle-aged Chinese woman in <Picture 2>, round soft face, monolid eyes, deep red sleeveless evening dress, whose outfit comes from <Picture 2> only."
  assert.equal(findGarmentColourMismatch(defs(line), ASSETS).length, 1)
})

test('写对了不报（grey-brown / brown），**写笼统的 grey 必报**（用户实测：grey 出纯灰）', () => {
  for (const ok of [
    'grey-brown front-opening cloth jacket over a faded small-floral apron',
    'brown front-opening cloth jacket over a faded small-floral apron',
  ]) {
    const line = `<Subject 2> is the woman in <Picture 2>, ${ok}, whose outfit comes from <Picture 2> only.`
    assert.equal(findGarmentColourMismatch(defs(line), ASSETS).length, 0, `不该报：${ok}`)
  }
  // 2026-10-16 用户实测对照（同一角色、同一卡面）：
  //   9集分镜1 写 grey-brown → 成片对 ✓；8集分镜7/8/9 写 grey → 成片纯灰 ✗
  //   ⇒ H3 只认字面颜色词，「写得更笼统」不算对，必须报出来打回重写成 grey-brown。
  const grey = '<Subject 2> is the woman in <Picture 2>, grey front-opening cloth jacket over a white small-floral apron.'
  const hits = findGarmentColourMismatch(defs(grey), ASSETS)
  assert.equal(hits.length, 1, 'grey 必须报')
  assert.equal(hits[0].what, 'garment')
  assert.match(hits[0].found, /灰/)
  assert.match(hits[0].expected, /灰褐/)   // 卡面（本测试用的旧卡面文字：灰褐色对襟布衫/碎花围裙/黑布鞋）里的服装颜色
})

test('警察 navy 制服 vs 卡面深蓝警服 → 不报（同色异名）；别把款式相同的别的角色算进来', () => {
  const police = [{ picture: 3, kind: 'character', name: '警察甲', assetText: '四十岁上下的中年男性警察，深蓝色警服上衣，肩章与胸徽，黑色领带。' }]
  const line = '<Subject 3> is the male police officer in <Picture 3>, navy police uniform jacket with shoulder boards and chest badge, black necktie.'
  assert.equal(findGarmentColourMismatch(defs(line), police).length, 0)
})

test('场景/道具不参与；找不到颜色的一边直接跳过（不误报）', () => {
  const mixed = [
    { picture: 1, kind: 'scene', name: '宴会厅', assetText: '米白色大理石地面，深蓝夜色玻璃幕墙。' },
    { picture: 4, kind: 'character', name: '神秘来客', assetText: '高大男性剪影，深色正装。' },
  ]
  const line = '<Subject 4> is the tall mysterious man in <Picture 4>, dark formal coat drawn as flat black colour blocks.'
  assert.deepEqual(findGarmentColourMismatch(defs(line), mixed), [])
})

test('发色也查：卡面「染成枯黄后长出黑根」，稿子写 brown hair → 命中', () => {
  const line = '<Subject 2> is the woman in <Picture 2>, brown hair in a low loose ponytail, grey-brown front-opening cloth jacket over a faded small-floral apron.'
  const hits = findGarmentColourMismatch(defs(line), ASSETS)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].what, 'hair')
  assert.match(hits[0].found, /棕|褐/)
  // 同一行服装颜色写对（grey-brown）⇒ 只报发色一条，不报服装
  assert.equal(hits.filter(h => h.what === 'garment').length, 0)
})

test('发色写对就不报：卡面枯黄+黑根 ↔ straw-dyed hair with dark roots', () => {
  const line = '<Subject 2> is the woman in <Picture 2>, lank straw-dyed hair with dark roots, grey-brown front-opening cloth jacket.'
  assert.deepEqual(findGarmentColourMismatch(defs(line), ASSETS), [])
})

test('保留段的颜色也查（4.0.53）：定义段改对了、保留段还写 dark blue → 成片照样全蓝', () => {
  // 实测 sb480：日志里 garment-colour-after-fix remaining=0（只统计定义段），
  // 而 retention_analysis 那行 `<Subject 2> … fully_preserved - dark blue front-opening cloth jacket`
  // 原样留着 → H3 读全文 → 出片全蓝。闸的覆盖面必须等于模型的读入面。
  const en = [
    'subject_definitions:',
    '<Subject 2> is the stooped middle-aged Chinese woman in <Picture 2>, lank straw-dyed hair with dark roots, grey-brown front-opening cloth jacket over a white small-floral apron.',
    '',
    'summary:',
    'A nine-second sequence.',
    '',
    'retention_analysis:',
    '<Subject 2> (appears in every shot): fully_preserved - dark blue front-opening cloth jacket, white small-floral apron, black cloth shoes.',
    '',
    'detailed_description:',
    '[Shot 1] the stooped woman in the grey-brown cloth jacket.',
  ].join('\n')
  const hits = findColourMismatchInPrompt(en, ASSETS)
  assert.equal(hits.length, 1, '保留段那条必须被抓到')
  assert.match(hits[0].found, /蓝/)
  assert.match(hits[0].line, /fully_preserved/)
  // 同一条稿子把保留段也改成 grey-brown 后 → 0 命中（不许误报）
  const ok = en.replace('dark blue front-opening cloth jacket, white small-floral apron, black cloth shoes',
                        'grey-brown front-opening cloth jacket, white small-floral apron, black cloth shoes')
  assert.deepEqual(findColourMismatchInPrompt(ok, ASSETS), [])
})

test('误报回归：配饰颜色（发圈）+ 英文子串（whitened/blurred）都不许算成服装色（10集分镜3 实测）', () => {
  // ① 苏清禾：卡面「头发用黑色皮筋扎成低马尾」+「灰蓝色保洁服」；
  //    稿子 `loose low ponytail tied with a plain black elastic … grey-blue cleaner work jacket`
  //    → 黑来自**发圈**（卡面就写了黑），必须不报。原来 GARMENTS 没有「皮筋/elastic」⇒ 卡面那 黑 没被算进去 ⇒ 误报。
  const su = '一身灰蓝色保洁工作服（本集为干净的灰蓝色制服），布料洗得发僵、袖口磨得发白起毛边；头发用黑色皮筋随意扎成低马尾。'
  const suLine = '<Subject 2> is the young Chinese woman in <Picture 2>, loose low ponytail tied with a plain black elastic; whose outfit comes from <Picture 2> only: grey-blue cleaner work jacket, faded fabric with frayed whitened cuffs, blurred chest logo, old apron string knotted at the waist.'
  assert.deepEqual(findColourMismatchInPrompt(defs(suLine), [{ picture: 2, kind: 'character', name: '苏清禾', assetText: su }]), [],
    '发圈的黑 + 磨白/模糊都不是服装颜色问题，不许报')
  // ② 陆沉渊：卡面「蓝色西装 / 纯白衬衫 / 金色徽章 / 黑色皮鞋」；
  //    稿子 `tailored blue suit jacket … pure white shirt … narrow black tie … black leather shoes` → 一致，不许报
  const lu = '一身剪裁极考究的蓝色西装，内搭纯白衬衫扣至领口，配深色窄版领带，西装左侧有一枚金色徽章；黑色皮鞋擦得一尘不染。'
  const luLine = '<Subject 3> is the tall Chinese businessman in <Picture 3>, high brow ridge, slicked-back side-parted black hair; whose outfit comes from <Picture 3> only: tailored blue suit jacket, pure white shirt buttoned to the collar, narrow black tie, small gold lapel badge, black leather shoes.'
  assert.deepEqual(findColourMismatchInPrompt(defs(luLine), [{ picture: 3, kind: 'character', name: '陆沉渊', assetText: lu }]), [])
})

test('主体号 ≠ 图号（换位）时不许张冠李戴（10集分镜8 实测）', () => {
  // 实测稿子：<Subject 2> …in <Picture 3>（年轻女性，绿丝绒）；<Subject 3> …in <Picture 2>（壮汉保镖，黑西装）
  // 旧实现假设「<Subject K> 就是第 K 张图」⇒ 把女性的绿裙拿去对保镖的黑西装卡，报出「保镖写绿、卡面黑白」。
  const bodyguard = '统一黑色西装，白衬衫，黑领带，墨镜，黑色皮鞋；黑色发型极短利落。'
  const woman = '墨绿色丝绒旗袍式内搭正装，立领斜襟盘扣；下配同色墨绿高腰直筒长裤，脚穿黑色尖头细跟皮鞋。'
  const assets = [
    { picture: 2, kind: 'character', name: '黑衣保镖', assetText: bodyguard },
    { picture: 3, kind: 'character', name: '苏清禾·内搭正装', assetText: woman },
  ]
  const en = [
    'subject_definitions:',
    '<Subject 1> is the ballroom scene in <Picture 1>, flat colour blocks.',
    '<Subject 2> is the young Chinese woman in <Picture 3>, neat black hair; whose outfit comes from <Picture 3> only: green velvet mandarin-collar top, matching high-waist straight trousers, black pointed heels.',
    '<Subject 3> is the burly male bodyguard in <Picture 2>, very short black hair; whose outfit comes from <Picture 2> only: black suit jacket, white shirt, black tie, dark sunglasses.',
    '',
    'summary:',
    '[reference generation] A ten-second sequence.',
    '',
    'retention_analysis:',
    '<Subject 2>: fully_preserved - green velvet mandarin-collar top, black pointed heels.',
    '<Subject 3>: fully_preserved - black suit jacket, white shirt, black tie.',
    '',
    'detailed_description:',
    '[Shot 1] <Subject 2>, the young woman in the green velvet top, stands still.',
  ].join('\n')
  assert.deepEqual(findColourMismatchInPrompt(en, assets), [],
    '稿子与卡面完全一致（女性=墨绿/黑、保镖=黑/白），不该报 —— 报出来就是主体号当图号用了')
})

test('英文颜色词必须按词边界匹配（whitened 里不许出 white、blurred 里不许出 red）', () => {
  assert.deepEqual(garmentColours('frayed whitened cuffs on the jacket'), [])
  assert.deepEqual(garmentColours('blurred chest logo on the uniform'), [])
  assert.deepEqual(garmentColours('the tailored blue suit jacket'), ['blue'])
})

test('提取器本身：只认紧挨服装词的颜色；中英概念映射正确', () => {
  assert.deepEqual(garmentColours('deep blue cloth jacket, black old-style cloth shoes'), ['deep blue', 'black'])
  assert.deepEqual(garmentColours('她站在灰褐色对襟布衫旁边'), ['灰褐色'])   // 复合色整体匹配，不许被「灰」抢先
  assert.equal(colourConcept('navy'), '藏蓝')
  assert.equal(colourConcept('灰褐'), '灰褐')
  assert.equal(colourConcept('blue'), '蓝')
  assert.equal(colourConcept('灰棕色'), '灰棕')   // 卡面写「灰棕色」，去掉尾「色」再查
})

// ── 2026-10-17（4.0.72）三类假警报回归：① 连字符英文复合色 ② 卡面把颜色写在内搭/配饰句里 ③ 中文本色族 ──

test('假警报回归：连字符 `navy-blue` 不许被拆成 navy+blue、报成「稿子写蓝」（15集分镜2、8集分镜3/4 实测）', () => {
  const police = [{ picture: 3, kind: 'character', name: '警察甲',
    assetText: '三十岁上下的男性警官，体格结实匀称，站姿笔挺端正…短发干净利落，肤色健康偏深。\n藏蓝色制式警服（春秋常服款），面料挺括哑光，肩章、胸徽、警号齐全，银色纽扣，黑色领带，腰间黑色皮带，黑色皮鞋；黑色短发，鬓角修净。' }]
  const line = '<Subject 3> is the Chinese police officer in <Picture 3>, with a complete head and face as shown in the face close-up panel, long square face, thick brows, short cropped black hair, wearing a navy-blue police uniform tunic with shoulder boards and chest badge and black buttons, dark necktie, black belt, black trousers, black leather shoes, whose outfit comes from <Picture 3> only.'
  // 词表原来只有空格版 `navy blue` ⇒ `\bnavy\b` 先命中、紧接着 `\bblue\b` 又命中 ⇒ 凭空多出一个「蓝」
  assert.deepEqual(findColourMismatchInPrompt(defs(line), police), [], 'navy-blue 就是藏蓝，本来就对，不许报')
  assert.equal(colourConcept('navy-blue'), '藏蓝')
  // 反向保险：真写泛蓝 `blue`（比卡面笼统，H3 会出纯蓝）必须照旧报出来 —— 别把闸修瞎
  const blue = findColourMismatchInPrompt(defs(line.replace('navy-blue police', 'blue police')), police)
  assert.equal(blue.length, 1)
  assert.match(blue[0].found, /蓝/)
})

test('假警报回归：卡面把颜色写在内搭/配饰句里（米白吊带打底、金色饰品）→ 稿子写对不许报', () => {
  // 15集分镜7 苏清禾·内搭正装：卡面「内衬米白色真丝吊带打底」整条从句原来因没有服装词被跳过
  const su = '黑发,墨绿色丝绒旗袍式内搭正装，立领斜襟盘扣，收腰剪裁贴合身形，面料哑光带细微竖向纹理；内衬米白色真丝吊带打底，下配同色墨绿高腰直筒长裤，脚穿黑色尖头细跟皮鞋；不佩戴饰品。'
  const suLine = '<Subject 2> is the young Chinese woman in <Picture 2>, long straight black hair, wearing a dark green velvet qipao-style top with mandarin collar and frog buttons over an off-white silk slip, dark green high-waist straight trousers, black pointed heels, no jewellery, whose outfit comes from <Picture 2> only.'
  assert.deepEqual(findColourMismatchInPrompt(defs(suLine), [{ picture: 2, kind: 'character', name: '苏清禾·内搭正装', assetText: su }]), [])
  // 8集分镜1 张莉：卡面「玫红连衣裙 + 金色饰品」↔ 稿子 `rose-magenta ... dress with an oversized gold necklace`
  const zl = '一身亮片的宴会连衣裙（玫红饱和色系），款式略显浮夸俗艳，佩戴 oversized 的金色饰品、多层手镯与夸张戒指。'
  const zlAssets = [{ picture: 2, kind: 'character', name: '张莉', assetText: zl }]
  const zlLine = '<Subject 2> is the young Chinese woman in <Picture 2>, wearing a saturated rose-magenta sequined party dress with an oversized gold necklace, whose outfit comes from <Picture 2> only.'
  assert.deepEqual(findColourMismatchInPrompt(defs(zlLine), zlAssets), [])
  // 反向保险：粉与玫红不互认（用户实测口径），稿子写 `pink` 仍必须报
  assert.equal(findColourMismatchInPrompt(defs(zlLine.replace('rose-magenta sequined party dress', 'pink sequined party dress')), zlAssets).length, 1)
})

test('假警报回归：同色族（卡面「（米白）」↔ 稿子 cream/white；卡面「酒红」↔ 稿子 wine-red/red）', () => {
  const shu = '深炭灰色（近黑）高档三件套西装，面料挺括泛暗光泽；内搭浅色（米白）衬衫，领口敞开不系领带；黑色皮鞋擦得锃亮。'
  const shuAssets = [{ picture: 3, kind: 'character', name: '苏家二叔', assetText: shu }]
  for (const ok of ['a cream open-collar shirt', 'a white open-collar shirt']) {
    const line = `<Subject 3> is the man in <Picture 3>, charcoal near-black three-piece suit over ${ok}, black leather shoes.`
    assert.deepEqual(findColourMismatchInPrompt(defs(line), shuAssets), [], `不该报：${ok}`)
  }
  const my = '一袭质感高级的曳地礼服裙（酒红缎面为佳），剪裁贴身勾勒腰线，露肩设计，面料泛柔和光泽。'
  const myAssets = [{ picture: 2, kind: 'character', name: '苏梦瑶', assetText: my }]
  for (const ok of ['a wine-red satin gown', 'a red satin gown']) {
    const line = `<Subject 2> is the woman in <Picture 2>, wearing ${ok}, whose outfit comes from <Picture 2> only.`
    assert.deepEqual(findColourMismatchInPrompt(defs(line), myAssets), [], `不该报：${ok}`)
  }
  // 反向保险：同色族只收同一颜色的写法，不许把别的色放进来（真写错色必须照旧报）
  const bad = '<Subject 3> is the man in <Picture 3>, a blue three-piece suit over a cream open-collar shirt, black leather shoes.'
  assert.equal(findColourMismatchInPrompt(defs(bad), shuAssets).length, 1)
})
