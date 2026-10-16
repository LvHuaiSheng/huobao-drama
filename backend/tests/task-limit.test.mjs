/**
 * 生成任务并发闸（2026-10-16）
 *
 * 实测事故：用户「一次点多了生成卡，App 卡顿」—— `createTask` 里 processTask 是 fire-and-forget，
 * 批量生成 N 张卡 = N 个请求同时发、N 张图同时下载落盘（Electron 主进程 UI 与 API 同进程）。
 */
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const { runLimited, runningCount, waitingCount, TASK_LIMIT, __resetTaskLimit } =
  await import('../src/services/task-limit.ts')

const tick = () => new Promise(r => setTimeout(r, 0))

test('图片任务同时最多 2 个在跑，其余排队（不是一起发）', async () => {
  __resetTaskLimit()
  let peak = 0
  let done = 0
  const jobs = Array.from({ length: 6 }, () => () => {
    peak = Math.max(peak, runningCount('image'))
    return new Promise(res => setTimeout(() => { done++; res() }, 5))
  })
  for (const j of jobs) runLimited('image', j)
  assert.equal(peak, TASK_LIMIT.image, '刚发出去时在跑的就是上限数')
  assert.equal(waitingCount('image'), 6 - TASK_LIMIT.image, '其余在排队')
  await new Promise(r => setTimeout(r, 60))
  assert.equal(done, 6, '排队的最终都要跑完')
  assert.equal(runningCount('image'), 0, '跑完要放掉计数，不能泄')
  assert.equal(waitingCount('image'), 0)
})

test('图片与视频互不挤占（各自一条闸）', async () => {
  __resetTaskLimit()
  let imgDone = 0, vidDone = 0
  for (let i = 0; i < 3; i++) runLimited('image', () => new Promise(r => setTimeout(() => { imgDone++; r() }, 5)))
  for (let i = 0; i < 3; i++) runLimited('video', () => new Promise(r => setTimeout(() => { vidDone++; r() }, 5)))
  await tick()
  assert.equal(runningCount('image'), TASK_LIMIT.image)
  assert.equal(runningCount('video'), TASK_LIMIT.video, '视频不该等图片腾位置')
  await new Promise(r => setTimeout(r, 60))
  assert.deepEqual([imgDone, vidDone], [3, 3])
})

test('任务抛错不许卡死队列（错误由调用方记日志，闸只管放行）', async () => {
  __resetTaskLimit()
  let ok = 0
  runLimited('image', () => Promise.reject(new Error('boom')))
  runLimited('image', () => { throw new Error('sync boom') })
  runLimited('image', () => new Promise(r => setTimeout(() => { ok++; r() }, 5)))
  await new Promise(r => setTimeout(r, 40))
  assert.equal(ok, 1, '前面两个失败不能挡住第三个')
  assert.equal(runningCount('image'), 0)
  assert.equal(waitingCount('image'), 0)
})

test('接线断言：createTask 必须走闸，不许再直接 fire-and-forget', () => {
  const src = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8')
  assert.match(src, /runLimited\(type, \(\) => processTask/, 'createTask 必须过并发闸')
  assert.doesNotMatch(src, /^\s*processTask\(id, config\)\.catch/m, '旧的裸 fire-and-forget 必须删掉')
})
