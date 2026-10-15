/**
 * 发色 / 肤色 / 服装色 / 配饰色 闸回归（2026-10-15）
 *
 * 真实样本（sb481 当月实际数据）：
 *   警察甲：卡面黑发，卡字段里从没写发色（`styling` 当时写的是剧情说明）⇒ 提示词只写 `short cropped hair` → H3 自己猜；
 *   王梅：卡字段写「深蓝**或**灰褐色对襟布衫」，而卡面实际是灰褐色。
 * 判据要同时认中英两种写法（字段是中文、英文发送版是英文）。
 *
 * 跑法：cd backend && node --test tests/asset-colour-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { hasHairColour, hasGarmentColour, hasSkinTone, hasAccessoryColour, ambiguousStyling,
  subjectLines, findColourGaps, shouldRewriteForColour, colourRewriteNote, assetColourGaps }
  = await import('../src/services/asset-colour-gate.ts')

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

test('肤色 / 配饰色：也要写出来', () => {
  assert.equal(hasSkinTone('sallow skin, slack rounded face'), true)
  assert.equal(hasSkinTone('肤色健康偏深，颈侧可见晒痕'), true)
  assert.equal(hasSkinTone('slack rounded face, long square jaw'), false)
  assert.equal(hasAccessoryColour('one tarnished silver bangle'), true)
  assert.equal(hasAccessoryColour('腕上一只细银镯已氧化发暗'), true)
  assert.equal(hasAccessoryColour('shoulder boards and chest badge, black necktie'), false, '徽章没写颜色/材质就不算')
})

test('卡文字里的「或」要报出来（王梅样本）', () => {
  assert.equal(ambiguousStyling('深蓝或灰褐色对襟布衫，外罩洗得发白的碎花围裙'), '或')
  assert.equal(ambiguousStyling('藏蓝色制式警服，黑色领带，黑色皮鞋；黑色短发，鬓角修净。'), null)
})

test('findColourGaps：卡里有、提示词漏了 → 值得重写；卡里压根没有 → 只能补卡', () => {
  const defs = [
    'subject_definitions:',
    '<Subject 1> is the banquet hall scene in <Picture 1>, with flat colour blocks',
    '<Subject 2> is the woman in <Picture 2>, with black short hair, navy jacket, black trousers, sallow skin, one silver bangle',
    '<Subject 3> is the officer in <Picture 3>, with short cropped hair, navy uniform jacket, black necktie',
  ].join('\n')
  // 警察甲：卡里只写了「短发干净利落、肤色健康偏深」（没有发色、没有服装、没有配饰）
  const assets = [
    { picture: 2, kind: 'character', name: '王梅', assetText: '外观：面部圆润松弛，皮肤蜡黄粗糙；造型：黑色短发，深蓝对襟布衫，腕上一只细银镯' },
    { picture: 3, kind: 'character', name: '警察甲', assetText: '外观：短发干净利落，肤色健康偏深' },
  ]
  const gaps = findColourGaps(defs, assets)
  const pics = gaps.map(g => `${g.picture}:${g.what}:${g.assetHasIt ? 'card-has' : 'card-lacks'}`).sort()
  // 王梅一行四类都写了（不该报）；警察甲这行写了服装（navy uniform jacket）与肤色（tanned skin 在定义里没有 → 报），
  // 缺发色与配饰色，且卡里也没写 → 只能补卡
  assert.deepEqual(pics, [
    '3:accessory:card-lacks',
    '3:hair:card-lacks',
    '3:skin:card-has',
  ], `实际 ${JSON.stringify(gaps)}`)
  assert.equal(shouldRewriteForColour(gaps), true, '肤色卡里有、提示词漏了 → 值得重写一轮')
  // 卡里什么都没写 → 重写也变不出来，不该空跑
  const bare = findColourGaps(defs, [{ picture: 3, kind: 'character', name: '警察甲', assetText: '外观：短发干净利落' }])
  assert.equal(shouldRewriteForColour(bare), false, '卡里什么都没有 → 不该空跑重写')

  // 补完卡的警察甲（黑发 + 藏蓝警服）→ 只缺配饰，且卡里有 → 该重写
  const assets2 = [
    { picture: 3, kind: 'character', name: '警察甲', assetText: '外观：黑色短发干净利落，肤色健康偏深；造型：藏蓝色制式警服、银色纽扣、黑色领带，腰间黑色皮带' },
  ]
  const defs2 = [
    'subject_definitions:',
    '<Subject 3> is the officer in <Picture 3>, with short cropped hair, navy uniform jacket, black necktie, tanned skin',
  ].join('\n')
  const g2 = findColourGaps(defs2, assets2)
  assert.equal(shouldRewriteForColour(g2), true, `卡里有发色（黑色短发）→ 该重写，实际 ${JSON.stringify(g2)}`)
  assert.match(colourRewriteNote(g2), /<Subject 3>（警察甲）没写发色/)
  assert.match(colourRewriteNote(g2), /黑色短发/)
})

test('assetColourGaps：卡数据自身缺哪些颜色（体检用）', () => {
  assert.deepEqual(assetColourGaps('外观：短发干净利落，肤色健康偏深').sort(), ['accessory', 'garment', 'hair'])
  assert.deepEqual(assetColourGaps('外观：黑色短发，皮肤蜡黄；造型：藏蓝色制式警服，银色纽扣，腕上银镯'), [])
})

test('subjectLines：能按编号取回定义行', () => {
  const m = subjectLines('subject_definitions:\n<Subject 1> is the scene\n<Subject 2> is the woman')
  assert.equal(m.get(1), '<Subject 1> is the scene')
  assert.equal(m.get(2), '<Subject 2> is the woman')
})
