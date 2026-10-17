/**
 * 「场景抢戏」判据回归（2026-10-17）
 *
 * 实测事故：Festo 产品片（drama9）第1集分镜1（sb619 / 任务 959）—— 三张参考图齐全、道具卡也在、
 * 提示词每一拍都点了名，可镜头1（广角全景）里驱动器「完全没锁住」、镜头2 看着对。
 * 根因：场景 56 的「场景描述」原文就写着「台上陈列工控样机——一台窄长机身银灰色伺服驱动器…」，
 * 生成的场景图里台面 1 台＋货架 4 台通用款 ⇒ 广角那拍模型直接抄场景里那台。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { propNameRuns, findScenePropConflicts } = await import('../src/services/scene-prop-conflict.ts')

// 真实原文（scenes.id=56「工业直播间展示台」的 prompt，截取含设备的整句）
const SCENE = '简约工业风直播间内景：浅灰色微水泥背景墙，墙面悬挂白色费斯托（FESTO）蓝色logo灯牌常亮；'
  + '中景一张哑光黑色金属展示台，台面铺深灰色防静电垫，台上陈列工控样机——一台窄长机身银灰色伺服驱动器'
  + '（正面深色接线端子区、绿色状态指示灯）与配套圆柱形银色伺服电机并排摆放；背景侧后方置浅木色工控设备置物架，'
  + '摆放数台同系列驱动器与电机样机作衬景；画面右侧立一块大尺寸直播监视屏'
const PROPS = ['CMMT-AS伺服驱动器样机', 'EMMT-AS伺服电机样机']

test('实名义：道具名去掉「样机」后剩下的实义段能在场景描述里命中', () => {
  assert.deepEqual(propNameRuns('CMMT-AS伺服驱动器样机').sort(), ['CMMT-AS', '伺服驱动器'])
  assert.deepEqual(propNameRuns('EMMT-AS伺服电机样机').sort(), ['EMMT-AS', '伺服电机'])
  // 短片名（<3 字）不参与匹配，避免「AS」这类碎片误命中
  assert.deepEqual(propNameRuns('刀'), [])
})

test('实锤：Festo 场景描述 vs 两个道具 → 两个都命中', () => {
  const hits = findScenePropConflicts(SCENE, PROPS)
  assert.equal(hits.length, 2)
  const m = Object.fromEntries(hits.map(h => [h.propName, h.matched]))
  assert.equal(m['CMMT-AS伺服驱动器样机'], '伺服驱动器')   // 命中段取最长那个（CMMT-AS 也命中，但「伺服驱动器」更长）
  assert.equal(m['EMMT-AS伺服电机样机'], '伺服电机')
})

test('干净的场景（只有空间与陈设）不许报', () => {
  const clean = '顶级酒店的大型宴会厅，挑高天花高悬多盏璀璨水晶吊灯，光亮通明；米白色大理石地面抛光如镜；'
    + '厅内布置高脚香槟塔、铺白缎桌布的小圆桌与花艺隔断。'
  assert.deepEqual(findScenePropConflicts(clean, ['DNA血缘鉴定报告', '废锉刀', '报到单']), [])
  assert.deepEqual(findScenePropConflicts('', PROPS), [])
  assert.deepEqual(findScenePropConflicts(SCENE, []), [])
})

test('英文/数字型号：场景里写了型号（CMMT-AS）也要命中', () => {
  const hits = findScenePropConflicts('The display table holds one CMMT-AS unit and the shelf shows four similar drives.', ['CMMT-AS伺服驱动器样机'])
  assert.equal(hits.length, 1)
  assert.equal(hits[0].matched, 'CMMT-AS')
})
