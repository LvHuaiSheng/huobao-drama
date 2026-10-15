/**
 * 保留项「服装写错人」闸回归（2026-10-15）
 *
 * 事故：第7集分镜8（sb472）出片**两个角色身份/服装互换**。已排除图片顺序（提示词 <Picture N> 编号正确、
 * App 下发的 mods 顺序也正确：[scene-34, character-28, character-31]）。真因在提示词自己：
 *   - `subject_definitions` 写对了（S2 苏清禾 = 灰蓝工作服、S3 张莉 = 玫红亮片裙）；
 *   - `retention_analysis` **沿用了旧稿**（S2 = dark navy suit jacket / grey trousers / silver wristwatch、
 *     S3 = burgundy dress）；
 *   - 2026-10-14 的规则要求每拍用**服装名词点人**（`<Subject 2>, the woman in the dark navy suit`）
 *     → 错服装被抄进正文每一拍 → 视频模型按文字走，两人互换。
 * 全库 125 条角色主体实测：命中 10 条、全部是真错（含 sb472 S2/S3、sb477 S2/S3），
 * 正常改写（cream-white→cream、rose sequined party dress→rose sequined dress）零误报。
 *
 * 跑法：cd backend && node --test tests/retention-outfit-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { findRetentionOutfitMismatch, findRetentionMismatch } = await import('../src/services/retention-gate.ts')

const SD_BAD = [
  'subject_definitions:',
  '<Subject 1> is the banquet hall corner scene in <Picture 1>, with a low floral partition drawn as flat colour blocks.',
  '<Subject 2> is the young Chinese woman Su Qinghe in <Picture 2>, with a complete head and face as shown in the face close-up panel, long black hair tied into a low loose ponytail, a grey-blue work jacket washed stiff and slightly oversized with frayed pale cuffs, an old apron string knotted at her waist, simple flat cloth shoes.',
  '<Subject 3> is the Chinese woman Zhang Li in <Picture 3>, with a complete head and face as shown in the face close-up panel, dark hair set into stiff structured curls, a saturated rose sequined party dress with a showy cut falling to her knees, oversized gold earrings.',
].join('\n')

const RA_BAD = [
  'retention_analysis:',
  '<Subject 1> (appears in every shot): fully_preserved - the hall corner with the floral partition and marble wall behind.',
  '<Subject 2> (appears in every shot): fully_preserved - face and complete head from the face close-up panel; dark navy suit jacket over pale blue open-collar shirt, grey trousers, silver wristwatch.',
  '<Subject 3> (appears in every shot): fully_preserved - face and complete head from the face close-up panel; burgundy dress, bangle bracelets on both wrists.',
].join('\n')

const RA_GOOD = [
  'retention_analysis:',
  '<Subject 1> (appears in every shot): fully_preserved - floral partition, marble wall and crowd silhouettes per <Picture 1>.',
  '<Subject 2> (appears in every shot): fully_preserved - grey-blue work jacket with frayed pale cuffs, low loose ponytail, apron string at the waist, cloth shoes; outfit from <Picture 2> only.',
  '<Subject 3> (appears in every shot): fully_preserved - rose sequined dress, gold bangles, stiff updone curls; outfit from <Picture 3> only.',
].join('\n')

const wrap = (sd, ra) => sd + '\nsummary:\n x\n' + ra + '\ndetailed_description:\n[Shot 1] x\n'

test('实测事故：保留项写着别人的衣服 → 命中 S2 与 S3', () => {
  const hits = findRetentionOutfitMismatch(wrap(SD_BAD, RA_BAD))
  assert.deepEqual(hits.map(h => h.subject).sort(), [2, 3])
  const s2 = hits.find(h => h.subject === 2)
  assert.equal(s2.reason, 'garment')            // 定义是 work jacket/apron，保留项是 suit jacket/trousers
  assert.ok(s2.overlap < 0.5)
})

test('正常稿（保留项服装取自同号定义）→ 零命中', () => {
  assert.deepEqual(findRetentionOutfitMismatch(wrap(SD_BAD, RA_GOOD)), [])
})

test('颜色对不上也算（服装品类相同、颜色不同）', () => {
  // 只换颜色、保留同一个服装名词（dress），这样重叠率仍是 1.0 → 只能靠颜色判定
  const ra = RA_GOOD.replace('rose sequined dress', 'burgundy sequined dress')
  const hits = findRetentionOutfitMismatch(wrap(SD_BAD, ra))
  assert.deepEqual(hits.map(h => h.subject), [3])
  assert.equal(hits[0].reason, 'colour')
})

test('场景/道具主体不参与（只查人物）', () => {
  const hits = findRetentionOutfitMismatch(wrap(SD_BAD, RA_BAD))
  assert.ok(!hits.some(h => h.subject === 1))
})

test('原有编号覆盖闸不受影响', () => {
  const en = wrap(SD_BAD, RA_BAD.replace('<Subject 3>', '<Subject 4>'))
  const rm = findRetentionMismatch(en)
  assert.ok(rm && rm.missing.includes(3) && rm.extra.includes(4))
})
