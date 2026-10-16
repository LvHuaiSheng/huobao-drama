/**
 * 压缩目标口径回归（2026-10-16，第四次修订）
 *
 * 三个反面教材（都是当天实测）：
 *  ① 「只认全文、各组配额不考核」(4.0.42)：模型失去具体落点 ⇒ 一轮只砍 445、随后 0/0（8集分镜8）。
 *  ② 「各组压到自己的配额」但组缺口高达 41% 时（sb493）：目标够不着 ⇒ 原样返回、两轮 cut=0。
 *  ③ 「按超出比例把缺口分摊成每组砍多少」(4.0.49~53)：缺口只有 41 字时摊出「这组 10 字、那组 8 字」
 *     这种**小目标** ⇒ 模型干脆不动，七轮 93/358/134/43/29/0/0，最后 41 字过不去整条作废（8集分镜7）。
 *
 * 现在（4.0.54）的口径：**每组给「压到配额」这个大而具体的目标 + 明写过关线（全文 ≤ 硬上限）
 * + 写明某组压不到配额就多压别组**（既避免小目标让模型不动，也避免死目标让它放弃）。
 * 关键算术：配额目标远大于当时的缺口 —— 模型哪怕只照做三成，也早把缺口填平了。
 *
 * 跑法：cd backend && node --test tests/segment-compress-target.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf-8')

test('压缩指令：每组给「压到配额」的大目标（不许只给缺口里摊出来的小数字）', () => {
  assert.match(src, /目标压到 ≤ \$\{it\.stage\.limit\} 字符/, '必须给每组的配额目标')
  assert.doesNotMatch(src, /本轮就砍 \$\{cut\} 字符/, '不许再按缺口分摊成小目标')
  assert.doesNotMatch(src, /cutPlan\(/, 'cutPlan 分摊已废弃')
})

test('压缩指令：过关线只有一条（全文 ≤ 硬上限），且给出「某组压不到就多压别组」的退路', () => {
  assert.match(src, /过关线只有一条：全文 ≤ \$\{hard!\.limit\} 字符/)
  assert.match(src, /某一组实在压不到配额，就多压别的组/)
  assert.match(src, /别只做几处小修小补/)
})

test('压缩指令：不许再出现「各组配额这一轮不考核」这类没有落点的说法', () => {
  assert.doesNotMatch(src, /各组自己的配额这一轮不考核/)
  assert.doesNotMatch(src, /各组自己的绝对配额/)
})
