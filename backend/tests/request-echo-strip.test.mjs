/**
 * 「要求的回声」机械清理回归（2026-10-16，用户报「10集分镜4 英文版本里混入中文」）
 *
 * 症状：落库的英文稿里夹着
 *   ```
 *   组二：summary / retention_analysis
 *   ```
 *   summary: …
 * 这些行只可能是**压缩指令本身的回声**（指令是中文写的、按「组」组织），写回时被并进上一段末尾。
 * 语言闸（③.4）确实抓到那几个汉字，但走 AI 重写要么再被照抄、要么改完变长被回滚（源码里记着 sb432）
 * ⇒ 机械删除最可靠。
 *
 * 跑法：cd backend && node --test tests/request-echo-strip.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { stripRequestEcho } = await import('../src/services/en-cn-gate.ts')

const RAW = [
  'subject_definitions:',
  '<Subject 1> is the banquet hall scene in <Picture 1>, flat colour blocks.',
  'one single pair, never duplicated.',
  '```',
  '',
  '组二：summary / retention_analysis',
  '',
  '```',
  'summary:',
  '[reference generation] A nine-second sequence.',
  '',
  'retention_analysis:',
  '<Subject 1> (appears in every shot): fully_preserved - face kept.',
  '',
  'detailed_description:',
  '[Shot 1] <Subject 3> (S1) says, <d>[Chinese] 涉嫌故意杀人、侵吞巨额资产，现在对你执行逮捕。</d> Apart from this line nothing else.',
  '',
  'overall_soundscape:',
  'room tone.',
  '',
  'non_diegetic_music:',
  'low strings.',
].join('\n')

test('stripRequestEcho：删掉围栏与中文分组标题回声，六个段与 <d> 台词原样保留', () => {
  const out = stripRequestEcho(RAW)
  assert.doesNotMatch(out, /组[一二三四五六七八九十\d]+\s*[:：]/, '不许留中文分组标题')
  assert.doesNotMatch(out, /```/, '不许留围栏')
  for (const seg of ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']) {
    assert.ok(out.includes(seg), `段落必须保留：${seg}`)
  }
  assert.match(out, /<d>\[Chinese\] 涉嫌故意杀人、侵吞巨额资产，现在对你执行逮捕。<\/d>/, '台词里的中文必须原样保留')
})

test('画面内中文文字（引号）不被误删', () => {
  const withOnScreen = 'detailed_description:\n[Shot 2] close on the screen reading "真正的幕后大佬，到底是谁？" in white type.'
  assert.match(stripRequestEcho(withOnScreen), /真正的幕后大佬，到底是谁？/)
})

test('接线断言：cleanSegText 与 sanitizeEnPrompt 都过这道清理', () => {
  const src = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf-8')
  assert.match(src, /import \{[^}]*stripRequestEcho[^}]*\} from '\.\/en-cn-gate\.js'/, '必须从零依赖模块引入')
  assert.equal((src.match(/stripRequestEcho\(/g) || []).length >= 2, true,
    'cleanSegText 与 sanitizeEnPrompt 都要调用（写回时 + assemble 兜底）')
})
