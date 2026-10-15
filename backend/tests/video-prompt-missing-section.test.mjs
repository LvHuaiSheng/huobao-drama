/**
 * 4.0.27 回归：缺段 / 整稿重来 / 落库拦截（2026-10-15 实测 sb481）
 *
 * 事故链（日志 + debug 原文）：
 *   模型首稿整段漏 `subject_definitions`（三次尝试全是 5/6 段）→「缺段补写」只给它一个段名，
 *   它写出「只有场景的 1 行」stub → 正文/retention 引用 <Subject 2..5> 却没有任何定义 →
 *   落库前只记了一条日志就照样 accepted → 5790 字的坏稿进了库（旧稿 6193 反倒是完整的）。
 *
 * 跑法：cd backend && node --test tests/video-prompt-missing-section.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 零依赖纯函数（与 seg-compress-gate / retention-gate 同惯例，node 可直接 import TS）
const { shouldRegenerateDraft, zhRosterLine, rosterBlock } = await import('../src/services/seg-compress-gate.ts')
const src = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')

const roster = '出场人物：@王梅（参照脸部特写格）、@警察甲（参照脸部特写格）；场景：@宴会厅中央；道具：@金属手铐。'

test('shouldRegenerateDraft：六段不齐时禁止整稿重来；六段齐且超限才重来一次', () => {
  assert.equal(shouldRegenerateDraft(0, 2000, 1), false, '缺段（count=1）不许重来 —— 否则丢掉刚补好的段')
  assert.equal(shouldRegenerateDraft(0, 2000, 0), true, '六段齐 + 超 800 才重来')
  assert.equal(shouldRegenerateDraft(0, 800, 0), false, '刚好 800 不算超')
  assert.equal(shouldRegenerateDraft(0, 801, 0), true, '>800 算超')
  assert.equal(shouldRegenerateDraft(1, 5000, 0), false, '第二次不许再重来（最多一次）')
  // 4.0.28：本轮补写过（filledCount>0）就不许重来 —— 否则刚补回来的段被丢掉重抽（实测 sb481 白烧约 50 秒）
  assert.equal(shouldRegenerateDraft(0, 2000, 0, 1), false, '补写过的这轮不许重来')
  assert.equal(shouldRegenerateDraft(0, 2000, 0, 0), true, '没补写过才允许')
})

test('rosterBlock：把中文工作版首行的主体清单拼进去（没有清单时不注入）', () => {
  assert.equal(rosterBlock(undefined), '')
  assert.equal(rosterBlock(''), '')
  const zh = `${roster}\n0-3秒：@王梅被押着…`
  const b = rosterBlock(zh)
  assert.ok(b.includes(roster), '清单原文必须在块里')
  assert.match(b, /每一个角色、场景、道具各写一行/)
  assert.match(b, /一个都不许漏/)
  assert.equal(zhRosterLine(zh), roster, '首行即清单')
  // 4.0.28：逐主体字数预算（实测补写一口气给 5 个主体写了 ~3000 字符；配额 4.0.36 起收紧到 1000 = 每主体 ≤250）
  assert.match(b, /本次共 4 个主体/)
  // 4.0.36 起定义段配额 1000（每主体 ≤250），逐主体预算按配额自动算 → 只锁句式
  assert.match(b, /每行 ≤ \d+ 字符/)
})

test('首稿与补写/压缩 prompt 都必须带主体清单（回归 sb481 的成因）', () => {
  const builders = src.slice(src.indexOf('function buildFullPrompt('), src.indexOf('function buildRewriteMultiPrompt('))
  assert.match(builders, /\$\{rosterBlock\(zhPrompt\)\}/, 'buildFullPrompt 要注入清单')
  const rewrite = src.slice(src.indexOf('function buildRewriteMultiPrompt('))
  assert.match(rewrite.slice(0, 3000), /\$\{rosterBlock\(zhPrompt\)\}/, 'buildRewriteMultiPrompt（补写/压缩）要注入清单')
})

test('整稿重来条件走纯函数（不再写死 pass/over 判断）', () => {
  assert.match(src, /if \(shouldRegenerateDraft\(pass, over, missingSegs\(\)\.length, filledCount\)\) \{/)
  assert.doesNotMatch(src, /if \(pass === 0 && over > DRAFT_OVER_LIMIT_RETRY\)/)
})

test('落库拦截：retention 编号/服装未达标 → 不落库（旧稿保留）', () => {
  assert.match(src, /let retentionBlocked = false/)
  assert.equal((src.match(/retentionBlocked = true/g) || []).length, 2, 'rm 与 outfit 都要置标志')
  const i = src.indexOf('if (retentionBlocked) {')
  assert.ok(i > 0, '必须有拦截分支')
  assert.match(src.slice(i, i + 700), /return \{ text: '', ok: false \}/)
  assert.match(src.slice(i, i + 700), /retention-blocked-not-saved/)
})
