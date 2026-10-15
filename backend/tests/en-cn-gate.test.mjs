/**
 * 英文版语言闸判据回归（2026-10-15）
 *
 * 事故：ep22 分镜10（sb483）提示词本身**合法**，只是画面里的手机屏幕文字按规则写成了原样中文
 * （`the phone screen reads "真正的幕后大佬是谁"`）→ 旧判据只剥 `<d>…</d>`，把引号里的中文也算违规
 * → 白跑一轮「去中文」修复（模型把画面文字改成英文，反而违规）→ `en-cn-unresolved` → **整条判失败**。
 * 规则原文本来就写着：英文版除 `<d>[Chinese]…</d>` 台词**与画面内文字**外不许有中文。
 *
 * 跑法：cd backend && node --test tests/en-cn-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { findChineseOutsideDialogue } = await import('../src/services/en-cn-gate.ts')

test('引号里的画面内文字（招牌/屏幕/横幅）不算违规', () => {
  const en = 'detailed_description:\n[Shot 1] the phone screen reads "真正的幕后大佬是谁", laid out horizontally.\n[Shot 2] a wooden signboard reads "老张面馆".'
  assert.equal(findChineseOutsideDialogue(en).count, 0)
  // 全角引号 / 直角引号同样放过
  assert.equal(findChineseOutsideDialogue('a sign reads “老张面馆” and another 「静」').count, 0)
})

test('台词块 <d>[Chinese]…</d> 里的中文照旧不算违规', () => {
  const en = 'detailed_description:\n[Shot 1] she says <d>[Chinese] 我会说清楚。</d> while lips remain completely closed.'
  assert.equal(findChineseOutsideDialogue(en).count, 0)
})

test('正文里真正混进的中文仍然抓到（别把闸改瞎了）', () => {
  // 实测形态：紧贴英文词的中文残留 / 中文标注
  const bad1 = 'retention_analysis:\n<Subject 1> (appears in every shot): fully_preserved - mirror镜 kept.'
  assert.ok(findChineseOutsideDialogue(bad1).count >= 1)
  const bad2 = 'retention_analysis:\n<Subject 1> (每个镜头都出现): fully_preserved - face kept.'
  assert.ok(findChineseOutsideDialogue(bad2).count >= 1)
  // 混在引号外的一句中文说明
  const bad3 = 'summary:\n她站在台前，手里捧着档案袋 opening the file bag.'
  assert.ok(findChineseOutsideDialogue(bad3).count >= 5)
})

test('回归 sb483（4.0.35）：<d> 台词 + 引号内片尾标题 = 全部合法，体检不许误报 blocking', () => {
  // 实测原稿形态：49 个汉字全在这两类里；老判据只剥 <d>、不剥引号 → 误报 11 个 blocking error
  const sb483 = [
    'detailed_description:',
    '[Shot 2] The narration continues as <Subject 3> says in an off-screen voiceover:',
    '<d>[Chinese] 王梅的狂笑声仍在宴会厅中回荡，那双眼始终没有离开黑暗深处。</d> while <Subject 3>\'s lips remain completely closed.',
    '[Shot 3] one horizontal line of white Chinese end-title text fades in, reading "真正的幕后大佬，到底是谁？", holding position.',
  ].join('\n')
  assert.equal(findChineseOutsideDialogue(sb483).count, 0)
  // 体检侧必须用同一份判据（源码级接线断言）
  const src = readFileSync(new URL('../src/services/prompt-check.ts', import.meta.url), 'utf8')
  assert.match(src, /findChineseOutsideDialogue\(/)
  assert.ok(!/enNoDialogue/.test(src), '体检侧不许再留只剥 <d> 的老判据')
})

test('sample 用来给模型看上下文（不超过 80 字符、无换行）', () => {
  const r = findChineseOutsideDialogue('summary:\n' + 'a'.repeat(200) + '中文残留' + 'b'.repeat(200))
  assert.ok(r.sample.length <= 81 && !r.sample.includes('\n'))
})
