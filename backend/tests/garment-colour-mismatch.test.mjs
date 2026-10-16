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

const { findGarmentColourMismatch, garmentColours, colourConcept } =
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

test('写对了就不报（grey-brown / 只写成分 grey / brown 也算对）', () => {
  for (const ok of [
    'grey-brown front-opening cloth jacket over a faded small-floral apron',
    'grey front-opening cloth jacket over a faded small-floral apron',
    'brown front-opening cloth jacket over a faded small-floral apron',
  ]) {
    const line = `<Subject 2> is the woman in <Picture 2>, ${ok}, whose outfit comes from <Picture 2> only.`
    assert.equal(findGarmentColourMismatch(defs(line), ASSETS).length, 0, `不该报：${ok}`)
  }
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

test('提取器本身：只认紧挨服装词的颜色；中英概念映射正确', () => {
  assert.deepEqual(garmentColours('deep blue cloth jacket, black old-style cloth shoes'), ['blue', 'black'])
  assert.deepEqual(garmentColours('她站在灰褐色对襟布衫旁边'), ['灰', '褐'])
  assert.equal(colourConcept('navy'), '藏蓝')
  assert.equal(colourConcept('灰褐'), '灰褐')
  assert.equal(colourConcept('blue'), '蓝')
})
