/**
 * 「还要不要继续压缩」判定回归（2026-10-15）
 *
 * 事故（用户报「分镜9 还是生成失败，整个生成过程还是优化的不够好」）：ep21 分镜9(sb473)
 * 描述只有 323 字、10 秒 3 镜，完全正常，却连续两次跑完整流程作废：
 *   detail 组 4272 → 4176 → 3901 → 3743 → 3631（≈110~160 字符/轮，约 14 秒/轮），
 *   而真正的硬闸是「全文 6390 ≤ 6200」→ 只差 190 字符，第 5、6 轮就能压过去。
 * 旧循环条件是「有组超**自己的配额**就继续」，于是轮数全花在压不动的组上；
 * 反过来 sb471 detail 超配额 356 字符、全文 5883 ≤ 6200 —— 本来就该直接接受。
 * ⇒ 循环改判 `shouldKeepCompressing()`（纯函数，`src/services/seg-compress-gate.ts`）：缺段必补；
 *    总量已达标就收工。轮数上限 4 → 6；失败文案改成可执行的下一步。
 *
 * 跑法：cd backend && node --test tests/prompt-rewrite-loop.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

// 纯判据函数：直接跑真代码（seg-compress-gate.ts 零依赖，node 能直接 import TS）
const { shouldKeepCompressing, itemBudgetLines, shouldTargetTotalOnly, PROMPT_EN_LIMIT, H3_PROMPT_HARD_LIMIT, PROMPT_HEAD_RESERVE, promptEnLimit } = await import('../src/services/seg-compress-gate.ts')
const src = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')

test('总量已达标 + 各组只是超自己的配额 → 收工（别磨）', () => {
  // sb471 实测：detail 超配额 356 字符，全文 5883 ≤ 6200
  assert.equal(shouldKeepCompressing([{ problem: '实测 3276 字符，超 2920 上限 356 字符' }], 5883, 6200), false)
})

test('总量超硬上限 → 继续压（sb473 实测 6390 > 6200）', () => {
  assert.equal(shouldKeepCompressing([{ problem: '实测 3631 字符，超 2920 上限 711 字符' }], 6390, 6200), true)
})

test('缺段 → 无论总量多少都必须继续（要补写，否则废在六段齐全闸）', () => {
  assert.equal(shouldKeepCompressing([{ problem: '缺少这些段：subject_definitions:' }], 3000, 6200), true)
  assert.equal(shouldKeepCompressing([{ problem: '这一组没有内容' }], 0, 6200), true)
})

test('没有超标的组 → 不压', () => {
  assert.equal(shouldKeepCompressing([], 6390, 6200), false)
})

test('接线与参数：循环走该判定、轮数上限 8、逐拍额度写进两处压缩 prompt、失败文案可执行', () => {
  assert.match(src, /while \(shouldKeepCompressing\(bad, assemble\(\)\.length, budget\.limit\) && rewriteState\.round < MAX_SEG_RETRY\)/)
  assert.match(src, /^const MAX_SEG_RETRY = 8$/m)
  assert.equal((src.match(/每拍上限 = ⌊2500 ÷ 拍数⌋/g) || []).length, 2, '两个压缩 prompt 都要带上')
  assert.match(src, /在分镜列表把这条拆成两条/)
})

test('压缩轮带硬欠账指标 + 记录每轮实砍量（2026-10-15：sb481 六轮从 8660 才到 6616、差 416 作废）', () => {
  const src2 = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')
  // 循环把「全文现在多少 / 上限多少 / 本轮至少砍多少」传进压缩 prompt
  assert.match(src2, /const need = lenBefore - budget\.limit/)
  assert.match(src2, /need > 0 \? \{ len: lenBefore, limit: budget\.limit, need \} : undefined/)
  assert.match(src2, /hard\?: \{ len: number; limit: number; need: number \}/)
  assert.match(src2, /本轮至少砍掉 \$\{hard\.need\} 字符/)
  // 每轮实砍量进日志（用来验证这条指令到底有没有用）
  assert.match(src2, /'segment-round-cut'/)
  assert.match(src2, /const cut = lenBefore - assemble\(\)\.length/)
})

test('连续两轮一个字符都没砍掉 → 早停（2026-10-15 实测 sb483 第 4/5/6 轮一模一样，白烧 3 轮）', () => {
  const src2 = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')
  assert.match(src2, /let noopStreak = 0/)
  assert.match(src2, /if \(cut <= 5\) \{/)
  assert.match(src2, /if \(noopStreak >= 2\) \{/)
  assert.match(src2, /'segment-noop-stop'/)
  assert.match(src2, /\} else noopStreak = 0/)
})

test('长度边界（4.0.38）：风格头不再进视频提示词 ⇒ 上限 6988（=7000−12），且不再随风格头伸缩', () => {
  assert.equal(H3_PROMPT_HARD_LIMIT, 7000)
  assert.equal(PROMPT_HEAD_RESERVE, 12)
  assert.equal(PROMPT_EN_LIMIT, 6988)
  assert.equal(promptEnLimit(768), 6988)
  assert.equal(promptEnLimit(0), 6988)
  assert.equal(promptEnLimit(5000), 6988)   // 风格头长短不再影响正文预算（它不进提示词了）
  // 回归：差 8 字作废的那条（6208）现在有 ~780 字余量
  assert.ok(6208 <= promptEnLimit(768))
  // 端到端：正文 ≤ 6988 ⇒ 发送长度 ≤ 7000 硬上限
  assert.ok(promptEnLimit(768) <= H3_PROMPT_HARD_LIMIT)
})

test('只盯全文缺口（4.0.34）：全文差 43、组配额缺口合计 1051 → 必须放弃组配额（sb483 实测）', () => {
  // 实测：全文只差 43，却要它把 summ 砍 349 + detail 砍 702 → 模型两轮一字不砍，稿子作废
  assert.equal(shouldTargetTotalOnly(43, [349, 702]), true)
  // 4.0.42：组缺口远大于全文缺口时也必须只认全文 —— sb493 实测 need 1548 / 组缺口 3514 时按组配额要它砍 41%，
  // 模型两轮全部原样返回（第1轮只回 subj、第2轮回整篇），整条作废
  assert.equal(shouldTargetTotalOnly(1548, [1066, 665, 1783]), true)
  assert.equal(shouldTargetTotalOnly(0, [349, 702]), false)
  assert.equal(shouldTargetTotalOnly(undefined, [349, 702]), false)
  assert.equal(shouldTargetTotalOnly(43, []), false)
  // 接线：本判据仍在用（决定「按组配额」还是「只认全文」的措辞分支）。
  //   压缩指令的具体措辞（配额大目标 + 过关线 + 退路）由 tests/segment-compress-target.test.mjs 钉住 ——
  //   4.0.54 起不再按缺口分摊小目标（实测小目标会让模型干脆不动）。
  const src = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')
  assert.match(src, /shouldTargetTotalOnly\(/)
  assert.match(src, /过关线只有一条：全文 ≤ \$\{hard!\.limit\} 字符/)
})

test('逐项点名（4.0.32）：逐拍 / 逐主体给出目标字数', () => {
  // 实测 sb483：某些拍 1450 字、目标 830（2500÷3）
  const detail = [
    'detailed_description:',
    '[Shot 1] ' + 'x'.repeat(970),
    '[Shot 2] ' + 'y'.repeat(1490),
    '[Shot 3] ' + 'z'.repeat(1015),
  ].join('\n')
  const l1 = itemBudgetLines(detail, 'shot', 2500)
  // 2500÷3 拍 = 830/拍；三拍都超（980/1500/1024）→ 三条都要点出来
  assert.equal(l1.length, 3, `三拍都该点名，实际 ${JSON.stringify(l1)}`)
  assert.match(l1[1], /\[Shot 2\] 现在 1500 字 → 目标 ≤830（砍 670）/)
  // 逐主体：1000 ÷ 主体数（4.0.36 起定义段配额 1000）
  const defs = [
    'subject_definitions:',
    '<Subject 1> ' + 'a'.repeat(430),
    '<Subject 2> ' + 'b'.repeat(900),
    '<Subject 3> ' + 'c'.repeat(780),
  ].join('\n')
  const l2 = itemBudgetLines(defs, 'subject', 1000)
  // 1000÷3 主体 = 330/主体；三条都超 → 三条都点名
  assert.equal(l2.length, 3, `1000÷3=330，三条都超 → 三条都点名，实际 ${JSON.stringify(l2)}`)
  assert.ok(l2.every(x => /目标 ≤330/.test(x)), JSON.stringify(l2))
  assert.match(l2.join('\n'), /<Subject 2> 现在 \d+ 字 → 目标 ≤330/)
  assert.deepEqual(itemBudgetLines('', 'shot', 2500), [])
})

test('首稿写飞（超上限 >800、且六段齐）→ 整稿重来一次（4.0.27 起判据挪进纯函数）', () => {
  const src3 = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')
  const gate = readFileSync(new URL('../src/services/seg-compress-gate.ts', import.meta.url), 'utf8')
  assert.match(gate, /export const DRAFT_OVER_LIMIT_RETRY = 800/)
  assert.match(src3, /for \(let pass = 0; pass < 2; pass\+\+\)/)
  // 4.0.27：缺段时禁止重来（否则丢掉刚补好的段）→ 判据在 shouldRegenerateDraft 里，见
  //   tests/video-prompt-missing-section.test.mjs 的真值表
  assert.match(src3, /if \(shouldRegenerateDraft\(pass, over, missingSegs\(\)\.length, filledCount\)\) \{/)
  // 实测两条失败首稿超 2172 / 3418，成功首稿只超 0~313 → 阈值 800 落在两者之间
  assert.match(src3, /'en-full-regenerate'/)
})
