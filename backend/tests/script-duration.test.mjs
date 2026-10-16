/**
 * 剧本时长 → 目标条数（2026-10-16 用户报「AI 改写和拆分分镜没有按照原始内容的时长来改」）
 *
 * 实测全库第 1~12 集：剧本片头声明 130~160 秒，拆分出来的分镜合计只有 48~113 秒
 * （每集短 40~96 秒；第 11 集声明 2 分 20 秒 = 140 秒，只拆出 9 条 87 秒）。
 * 病因：拆分技能里写的是「目标总时长 = 剧本字数 ÷ 500字/分钟」，从没读片头那个时长。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { parseScriptDurationSeconds, expectedStoryboardCount, SEGMENT_SECONDS } =
  await import('../src/services/script-duration.ts')

test('读得出真实剧本片头（第 11 集原文）', () => {
  const real = '## 第 11 集｜神秘短信，暗处狩猎｜时长：2 分 20 秒\n苏清禾:内搭正装造型\n【镜头 1｜特写】…'
  assert.equal(parseScriptDurationSeconds(real), 140)
  assert.equal(expectedStoryboardCount(140), 14, '140 秒 ÷ 10 秒 = 14 条')
})

test('各种写法都要认', () => {
  assert.equal(parseScriptDurationSeconds('## 第1集｜时长：140 秒'), 140)
  assert.equal(parseScriptDurationSeconds('时长：3 分钟'), 180)
  assert.equal(parseScriptDurationSeconds('时长：2:20'), 140)
  assert.equal(parseScriptDurationSeconds('时长：1 分'), 60)
  assert.equal(parseScriptDurationSeconds('没有时长标注的剧本正文'), null, '读不到就返回 null，不许瞎猜')
})

test('条数向上取整（最后一条可以不足 10 秒）', () => {
  assert.equal(SEGMENT_SECONDS, 10, '本项目单条分镜的生产时长就是 10 秒（H3 单段基线）')
  assert.equal(expectedStoryboardCount(95), 10)
  assert.equal(expectedStoryboardCount(90), 9)
  assert.equal(expectedStoryboardCount(null), null)
})

test('接线断言：拆分提示词与保存工具都要按时长核对', () => {
  const tool = readFileSync(new URL('../src/agents/tools/storyboard-tools.ts', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../workspace/skills/storyboard-breaker/SKILL.md', import.meta.url), 'utf8')
  const prompt = readFileSync(new URL('../workspace/prompts/storyboard_breaker.md', import.meta.url), 'utf8')
  const rewriter = readFileSync(new URL('../workspace/prompts/script_rewriter.md', import.meta.url), 'utf8')
  assert.match(tool, /parseScriptDurationSeconds/, '保存时必须核对合计时长')
  assert.match(tool, /时长还没写够/, '没写够要明确回话让 Agent 继续')
  assert.doesNotMatch(skill, /目标总时长 = 剧本字数/, '旧的「字数估算」当规则用必须删掉（新文案里只作为反面说明出现）')
  assert.match(skill, /片头写的「时长/, '技能要改成读片头声明')
  assert.match(prompt, /本集总时长必须等于剧本片头声明的时长/, '运行期提示词同样要写')
  assert.match(rewriter, /改写必须与原始内容的时长匹配/, 'AI 改写也要守时长')
})
