/**
 * 剧本声明的穿搭 → 该留哪个角色（2026-10-16 用户报「原始内容已经写了穿搭，就不应该后边提取错」）
 *
 * 真实样本：第 13 集剧本 `【女主穿搭】墨绿色丝绒旗袍式正装全套`，
 * 库里同时有 `苏清禾`（基准：灰蓝保洁工作服）与 `苏清禾·内搭正装`（墨绿丝绒正装）⇒ 两个都被绑到本集。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { declaredCostume, costumeScore, pickCostumeMatch, resolveCostumeKeep } = await import('../src/services/costume-match.ts')

const REAL_SCRIPT = '### 第 13 集｜虚与委蛇，令牌秘辛｜时长：1 分 30 秒\n\n【场景】宴会厅主厅，宾客大半离场，灯光调暗\n【女主穿搭】墨绿色丝绒旗袍式正装全套\n\n## S01 | 内景 · 宴会厅主厅 | 深夜\n'
const BASE = '一身灰蓝色保洁工作服（本集为干净的灰蓝色制服），布料洗得发僵、略显宽大不合身，袖口磨得发白起毛边，胸前印有模糊的酒店logo；腰间随意系着一根旧围裙带。'
const VARIANT = '黑发,墨绿色丝绒旗袍式内搭正装，立领斜襟盘扣，收腰剪裁贴合身形，面料哑光带细微竖向纹理；内衬米白色真丝吊带打底，下配同色墨绿高腰直筒长裤，脚穿黑色尖头细跟皮鞋；'

test('从真实剧本里抓得出声明的穿搭', () => {
  assert.equal(declaredCostume(REAL_SCRIPT), '墨绿色丝绒旗袍式正装全套')
  assert.equal(declaredCostume('没有穿搭声明的剧本正文'), null, '读不到就返回 null，不许瞎猜')
  assert.equal(declaredCostume('【女主穿搭】日常'), null, '太短没法比较的不算')
})

test('真实数据上判定是干净可分的（0.83 vs 0.08）', () => {
  const d = declaredCostume(REAL_SCRIPT)
  assert.ok(costumeScore(d, VARIANT) > 0.7, '变体（墨绿丝绒正装）必须高')
  assert.ok(costumeScore(d, BASE) < 0.15, '基准（灰蓝保洁服）必须低')
  const pick = pickCostumeMatch(d, [BASE, VARIANT])
  assert.equal(pick.index, 1, '应选中变体（下标 1）')
})

test('判不出来就不动数据（两边都像 / 都不像 / 只有一个候选）', () => {
  const d = '墨绿色丝绒旗袍式正装全套'
  assert.equal(pickCostumeMatch(d, [VARIANT, VARIANT.replace('墨绿', '深绿')]), null, '两边都像 ⇒ null')
  assert.equal(pickCostumeMatch(d, ['红色T恤', '蓝色外套']), null, '都不像 ⇒ null')
  assert.equal(pickCostumeMatch(d, [BASE]), null, '只有一个候选 ⇒ 无可比')
  assert.equal(pickCostumeMatch(null, [BASE, VARIANT]), null, '剧本没声明 ⇒ null')
})

test('接线断言：提取通道里会按判定自动解绑不匹配的那个', () => {
  const src = readFileSync(new URL('../src/agents/tools/extract-tools.ts', import.meta.url), 'utf8')
  assert.match(src, /enforceCostumeConsistency/, '提取通道必须调用共用纠正')
  const ch = readFileSync(new URL('../src/services/costume-channel.ts', import.meta.url), 'utf8')
  const split = readFileSync(new URL('../src/agents/tools/storyboard-tools.ts', import.meta.url), 'utf8')
  assert.match(ch, /delete\(schema\.episodeCharacters\)/, '要真的解绑（删绑定行）')
  assert.match(ch, /and\(\s*$[\s\S]{0,120}characterId/m, '只删输的那一条绑定行，不许重建整集绑定')
  assert.match(split, /enforceCostumeConsistency\(episodeId, dramaId\)/, '拆分通道也要接上（否则拆分会把基准角色绑回来）')
  assert.match(src, /variant_auto_fixed/, '结果要回话/记日志，便于事后核对')
})

test('谁走谁留不许写反（2026-10-16 事故：把正确的变体解绑、留下原始穿搭）', () => {
  const d = declaredCostume(REAL_SCRIPT)
  const keep = resolveCostumeKeep(d, BASE, VARIANT)
  assert.equal(keep.keepBase, false, '变体分高 ⇒ 必须留变体、走基准')
  assert.ok(keep.score > 0.7 && keep.loserScore < 0.15, '分数也要报出来便于核对')
  // 反向：剧本写的是「灰蓝色保洁工作服」时，该留基准、走变体
  const keep2 = resolveCostumeKeep('一身灰蓝色保洁工作服', BASE, VARIANT)
  assert.equal(keep2.keepBase, true, '剧本写保洁服 ⇒ 留基准、走变体')
  assert.equal(resolveCostumeKeep(null, BASE, VARIANT), null, '没声明穿搭 ⇒ 不动数据')
  // 通道里的映射必须是「keepBase ? 变体走 : 基准走」
  const ch = readFileSync(new URL('../src/services/costume-channel.ts', import.meta.url), 'utf8')
  assert.match(ch, /const loser = keep\.keepBase \? v : base/, 'loser 映射固定为：keepBase ⇒ 走变体')
})

