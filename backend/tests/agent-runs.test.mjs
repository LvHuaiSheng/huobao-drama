/**
 * Agent 运行态登记（2026-10-16）
 *
 * 实测事故：用户「点了拆分镜头，切换画面以后拆分镜头又可以重新点了，另外没有进度条」
 * —— 前端把 running 放在组件局部 ref 里，切页就归零；且只有一个布尔，没有进度信息。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { beginRun, endRun, getRun, listRuns, addSaved, __resetAgentRuns } =
  await import('../src/services/agent-runs.ts')

test('同一 Agent + 同一集同时只能跑一个（切页/多窗口都挡得住）', () => {
  __resetAgentRuns()
  assert.ok(beginRun('storyboard_breaker', 25), '第一次可以起')
  assert.equal(beginRun('storyboard_breaker', 25), null, '同集重复提交必须被挡')
  assert.ok(beginRun('storyboard_breaker', 26), '别的集不受影响')
  assert.ok(beginRun('script_rewriter', 25), '别的 Agent 不受影响')
})

test('运行态可查（前端切页回来据此复原按钮 + 显示进度）', () => {
  __resetAgentRuns()
  const run = beginRun('storyboard_breaker', 25)
  const st = getRun('storyboard_breaker', 25)
  assert.equal(st.type, 'storyboard_breaker')
  assert.equal(st.episodeId, 25)
  assert.ok(st.elapsedSeconds >= 0)
  addSaved(25, 8)
  addSaved(25, 6)
  assert.equal(getRun('storyboard_breaker', 25).saved, 14, '已写入条数要累加')
  assert.equal(listRuns('storyboard_breaker').length, 1)
  endRun('storyboard_breaker', 25)
  assert.equal(getRun('storyboard_breaker', 25), null, '结束后查不到 = 前端按钮恢复可点')
})

test('失败路径也必须放行（否则该 Agent 被自己永久挡住）', () => {
  __resetAgentRuns()
  beginRun('storyboard_breaker', 25)
  endRun('storyboard_breaker', 25)   // 路由的 finally 走的正是这一步
  assert.ok(beginRun('storyboard_breaker', 25), '放行后必须能重新起')
})

test('接线断言：路由登记/放行/查询三件套齐，保存工具喂进度', () => {
  const route = readFileSync(new URL('../src/routes/agent.ts', import.meta.url), 'utf8')
  const tool = readFileSync(new URL('../src/agents/tools/storyboard-tools.ts', import.meta.url), 'utf8')
  assert.match(route, /beginRun\(agentType, Number\(episode_id\)\)/, '路由必须登记运行')
  assert.match(route, /endRun\(agentType, Number\(episode_id\)\)/, 'finally 必须放行')
  assert.match(route, /app\.get\('\/:type\/status'/, '必须暴露 status 供前端复原')
  assert.match(tool, /addSaved\(episodeId, storyboards\.length\)/, '保存分镜要累加进度')
})
