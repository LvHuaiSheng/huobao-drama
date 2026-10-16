/**
 * 「要露屏幕内容」的拍不许出现人物主体（2026-10-16 用户要求：屏幕镜头只留手 + 设备）
 *
 * 真实样本来自全库 144 个含设备的拍：写对的（sb393 手部特写）与写成事故的（sb392/519/520 带脸带肩）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { findDeviceScreenBody, deviceScreenNote } = await import('../src/services/device-screen-gate.ts')

test('写成手部 + 设备（实测 sb393 的形状）→ 通过', () => {
  const good = "[Shot 1] Extreme close-up from a three-quarter side angle: a raised arm fills the frame, fingers curled around <Subject 4>, its screen dominating the composition. On the screen sits one line of blood-red notice text in neat blocky characters arranged in two horizontal rows."
  assert.deepEqual(findDeviceScreenBody(good), [])
})

test('屏幕拍里带了脸/肩/第二个人（实测 sb519/sb520 的形状）→ 命中', () => {
  const bad = "[Shot 1] Chest-up close portrait of <Subject 2> holding a plain black bar smartphone; the screen shows one line of notice text. Her shoulders are square to the lens and her chin is level."
  const hits = findDeviceScreenBody(bad)
  assert.equal(hits.length, 1, '要露屏幕内容却写了人物主体 ⇒ 必须命中')
  assert.equal(hits[0].reason, 'body')
  assert.match(hits[0].sample, /chest|shoulders|chin/i)
})

test('手持设备写了屏幕内容但没写手 → 命中 no-hand；立式屏没有手不算', () => {
  const noHand = "[Shot 2] The phone screen fills the frame with a single row of glyph blocks."
  assert.equal(findDeviceScreenBody(noHand)[0].reason, 'no-hand')
  const wallScreen = "[Shot 1] Close-up on an upright live-broadcast screen standing at the side of the hall; the screen shows a finance feed: a thick red curve and rows of illegible red character blocks."
  assert.deepEqual(findDeviceScreenBody(wallScreen), [], '立式屏本来就没有手，不该报')
})

test('不是"屏幕内容"的拍不管（只是提到设备/屏幕）', () => {
  const reaction = "[Shot 2] <Subject 3> stands in the foreground staring down at a dead grey phone screen in his hands, face drained pale, shoulders hunched."
  assert.deepEqual(findDeviceScreenBody(reaction), [], '屏幕没内容（死屏）⇒ 不属于本规则')
})

test('接线断言：生成侧与体检都要接上这道闸', () => {
  const gen = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')
  const chk = readFileSync(new URL('../src/services/prompt-check.ts', import.meta.url), 'utf8')
  assert.match(gen, /findDeviceScreenBody\(text\)/, '生成侧必须调用设备屏幕闸')
  assert.match(gen, /device-screen-rollback-over-limit/, '改完超上限要回滚')
  assert.match(chk, /code: 'device-screen-body'/, '体检要能看见这条')
})
