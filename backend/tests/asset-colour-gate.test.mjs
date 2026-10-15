/**
 * 发色 / 服装颜色 闸回归（2026-10-15）
 *
 * 真实样本（sb481 当月实际数据）：
 *   警察甲：卡面黑发，卡字段里从没写发色（`styling` 当时写的是剧情说明）⇒ 提示词只写 `short cropped hair` → H3 自己猜；
 *   王梅：卡字段写「深蓝**或**灰褐色对襟布衫」，而卡面实际是灰褐色。
 *
 * 范围（2026-10-15 用户拍板）：**只查发色与服装颜色** —— 肤色与配饰不查
 * （有些角色是特殊肤色、有些角色压根没配饰，机械查会大量误报）。
 * 判据要同时认中英两种写法（字段是中文、英文发送版是英文）。
 *
 * 跑法：cd backend && node --test tests/asset-colour-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const gate = await import('../src/services/asset-colour-gate.ts')
const { hasHairColour, hasGarmentColour, ambiguousStyling, subjectLines,
  findColourGaps, shouldRewriteForColour, colourRewriteNote, assetColourGaps } = gate

test('发色：中英都认，只写「short cropped hair」不算', () => {
  assert.equal(hasHairColour('<Subject 3>, with a long square jaw, short cropped hair, navy police uniform jacket'), false)
  assert.equal(hasHairColour('<Subject 3>, with black short cropped hair'), true)
  assert.equal(hasHairColour('<Subject 2>, with lank straw-dyed hair with dark roots'), true)
  assert.equal(hasHairColour('头发染成枯黄后长出黑根，梳成低矮松散的半扎发'), true)
  assert.equal(hasHairColour('发型为极短平头，鬓角修净'), false, '中文只写平头不写颜色也算漏')
})

test('服装色：颜色要贴着服装名词', () => {
  assert.equal(hasGarmentColour('navy police uniform jacket with shoulder boards, black necktie'), true)
  assert.equal(hasGarmentColour('dark blue front-opening cloth jacket over a faded small-floral apron'), true)
  assert.equal(hasGarmentColour('sallow skin, one tarnished silver bangle'), false)
  assert.equal(hasGarmentColour('藏蓝色制式警服，黑色领带，黑色皮鞋'), true)
})

test('不查肤色与配饰（用户拍板：特殊肤色/无配饰不误报）', () => {
  assert.equal(gate.hasSkinTone, undefined, 'hasSkinTone 应已移除')
  assert.equal(gate.hasAccessoryColour, undefined, 'hasAccessoryColour 应已移除')
  // 只写肤色、没写发色/服色的卡：只报两笔（发色 + 服装），不报肤色/配饰
  assert.deepEqual(assetColourGaps('外观：肤色靛蓝，无任何配饰').sort(), ['garment', 'hair'])
})

test('卡文字里的「或」要报出来（王梅样本）', () => {
  assert.equal(ambiguousStyling('深蓝或灰褐色对襟布衫，外罩洗得发白的碎花围裙'), '或')
  assert.equal(ambiguousStyling('藏蓝色制式警服，黑色领带，黑色皮鞋；黑色短发，鬓角修净。'), null)
})

test('findColourGaps：卡里有、提示词漏了 → 值得重写；卡里压根没有 → 只能补卡', () => {
  const defs = [
    'subject_definitions:',
    '<Subject 1> is the banquet hall scene in <Picture 1>, with flat colour blocks',
    '<Subject 2> is the woman in <Picture 2>, with black short hair, navy jacket, black trousers',
    '<Subject 3> is the officer in <Picture 3>, with short cropped hair, navy uniform jacket, black necktie',
  ].join('\n')
  // 王梅：卡里发色+服装色都有（中文写法）；警察甲：卡里只有「短发干净利落」（没有发色，服装也没写）
  const assets = [
    { picture: 2, kind: 'character', name: '王梅', assetText: '外观：面部圆润松弛；造型：黑色短发，深蓝对襟布衫' },
    { picture: 3, kind: 'character', name: '警察甲', assetText: '外观：短发干净利落，肤色健康偏深' },
  ]
  const gaps = findColourGaps(defs, assets)
  const pics = gaps.map(g => `${g.picture}:${g.what}:${g.assetHasIt ? 'card-has' : 'card-lacks'}`).sort()
  // 警察甲这行本来就写了服装色（navy uniform jacket / black necktie）→ 只报缺发色；卡里也没写发色 → 只能补卡
  assert.deepEqual(pics, ['3:hair:card-lacks'], `只该报警察甲缺发色，实际 ${JSON.stringify(gaps)}`)
  assert.equal(shouldRewriteForColour(gaps), false, '卡里没有 → 重写也变不出来，不该空跑一轮')

  // 补完卡的警察甲（黑色短发 + 藏蓝警服）→ 卡里有、提示词漏了 → 该重写
  const assets2 = [{ picture: 3, kind: 'character', name: '警察甲', assetText: '外观：黑色短发干净利落，肤色健康偏深；造型：藏蓝色制式警服，黑色领带' }]
  const g2 = findColourGaps(defs, assets2)
  assert.equal(shouldRewriteForColour(g2), true, `卡里有发色 → 该重写，实际 ${JSON.stringify(g2)}`)
  assert.match(colourRewriteNote(g2), /<Subject 3>（警察甲）没写发色/)
  assert.match(colourRewriteNote(g2), /黑色短发/)
})

test('assetColourGaps：卡数据自身缺发色/服装色（体检用）', () => {
  assert.deepEqual(assetColourGaps('外观：短发干净利落，肤色健康偏深').sort(), ['garment', 'hair'])
  assert.deepEqual(assetColourGaps('外观：黑色短发，皮肤蜡黄；造型：藏蓝色制式警服，腕上银镯'), [])
})

test('subjectLines：能按编号取回定义行', () => {
  const m = subjectLines('subject_definitions:\n<Subject 1> is the scene\n<Subject 2> is the woman')
  assert.equal(m.get(1), '<Subject 1> is the scene')
  assert.equal(m.get(2), '<Subject 2> is the woman')
})
