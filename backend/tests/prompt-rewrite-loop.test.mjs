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
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 纯判据函数：直接跑真代码（seg-compress-gate.ts 零依赖，node 能直接 import TS）
const { shouldKeepCompressing } = await import('../src/services/seg-compress-gate.ts')
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

test('接线与参数：循环走该判定、轮数上限 6、逐拍额度写进两处压缩 prompt、失败文案可执行', () => {
  assert.match(src, /while \(shouldKeepCompressing\(bad, assemble\(\)\.length, budget\.limit\) && rewriteState\.round < MAX_SEG_RETRY\)/)
  assert.match(src, /^const MAX_SEG_RETRY = 6$/m)
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

test('首稿写飞（超上限 >800）→ 整稿重来一次（用户 2026-10-15 拍板 B）', () => {
  const src3 = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf8')
  assert.match(src3, /const DRAFT_OVER_LIMIT_RETRY = 800/)
  assert.match(src3, /for \(let pass = 0; pass < 2; pass\+\+\)/)
  assert.match(src3, /if \(pass === 0 && over > DRAFT_OVER_LIMIT_RETRY\)/)
  // 实测两条失败首稿超 2172 / 3418，成功首稿只超 0~313 → 阈值 800 落在两者之间
  assert.match(src3, /'en-full-regenerate'/)
})
