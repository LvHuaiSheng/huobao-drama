/**
 * 「每组砍多少」分摊算法回归（2026-10-16）
 *
 * 事故链（同一条分镜 sb481，同一输入，两次实际返回量的对比）：
 *   10-15：压缩提示走「各组压到自己的配额」⇒ 一轮砍 2500 字（7596→5048），最终 6071 过稿；
 *   10-16：4.0.42 把目标改成「只认全文、各组配额这一轮不考核」⇒ 一轮只砍 445、甚至 0，连续作废
 *          （8157→7817→7817→7813，早停）。另一头 sb493 的教训相反：组缺口高达 41% 时给
 *          「各组压到配额」它也会原样返回。
 *   ⇒ 结论：模型不会自己把总量分配到组上。必须给**每组一个具体数字**，且合计正好等于 need，
 *      同时每个数字都要 ≤ 该组自己的超标量（否则又是"够不着的目标"→ 一个字不砍）。
 *      `cutPlan()` 就是这条口径（零依赖纯函数，见 src/services/seg-compress-gate.ts）。
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const { cutPlan } = await import('../src/services/seg-compress-gate.ts')

test('cutPlan: 合计正好等于 need，且每组不超过自己的超标量（实测 sb481）', () => {
  // sb481 10-16 01:58 那跑：全文 7815、硬上限 6988 ⇒ need 827；
  // 三组：定义 1655(配额1000)、摘要 1511(1100)、正文 4647(2920)
  const need = 827
  const excesses = [1655 - 1000, 1511 - 1100, 4647 - 2920]
  const cuts = cutPlan(need, excesses)
  assert.equal(cuts.reduce((a, b) => a + b, 0), need, '合计必须正好等于 need')
  cuts.forEach((c, i) => {
    assert.ok(c >= 0, `第 ${i} 组不能是负数`)
    assert.ok(c <= excesses[i], `第 ${i} 组砍 ${c} 不能超过它自己的超标量 ${excesses[i]}（否则目标够不着）`)
  })
})

test('cutPlan: 组缺口远大于 need（实测 sb493 的形状）也不会给出够不着的目标', () => {
  // sb493：全文 8536、need 1548；subj 2066(1000) / summ 1765(1100) / detail 4703(2920)
  const need = 1548
  const excesses = [2066 - 1000, 1765 - 1100, 4703 - 2920]
  const cuts = cutPlan(need, excesses)
  assert.equal(cuts.reduce((a, b) => a + b, 0), need)
  cuts.forEach((c, i) => assert.ok(c <= excesses[i]))
  // 按超标比例分：正文超标最多 ⇒ 它该砍最多
  assert.ok(cuts[2] > cuts[0] && cuts[2] > cuts[1], '最肥的正文段应该分摊最多')
})

test('cutPlan: 没有超标（或 need<=0）时全 0，不产生无依据的指标', () => {
  assert.deepEqual(cutPlan(0, [10, 20, 30]), [0, 0, 0])
  assert.deepEqual(cutPlan(100, []), [])
})

test('接线断言：压缩提示词确实使用了 cutPlan 的分摊结果', () => {
  const src = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf-8')
  assert.match(src, /cutPlan\(need, excesses\)/, 'video-prompts.ts 必须调用 cutPlan')
  assert.match(src, /本轮就砍 \$\{cut\} 字符/, '提示词里必须给每组写明「砍 N 字符」')
})
