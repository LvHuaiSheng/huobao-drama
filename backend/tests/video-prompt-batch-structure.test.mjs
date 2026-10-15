import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('video prompt batch service runs per-shot async agent loop', () => {
  const svc = read('src/services/video-prompts.ts')

  // 默认只处理缺少 video_prompt 的分镜；指定 storyboardIds 时只处理所选（已有提示词也重新生成）
  assert.match(svc, /filter\(sb => !\(sb\.videoPrompt \|\| ''\)\.trim\(\)\)/)
  assert.match(svc, /storyboardIds\?\.length/)
  assert.match(svc, /storyboardIds\.includes\(sb\.id\)/)
  // 运行中不重复启动
  assert.match(svc, /status === 'running'\) return \{ started: false, total: -1 \}/)
  // 逐个分镜调用 prompt_generator，以落库结果判定成败
  assert.match(svc, /mastra\.getAgent\('prompt_generator'\)/)
  assert.match(svc, /read_storyboard_context/)
  assert.match(svc, /update_storyboard/)
  assert.match(svc, /fresh\?\.videoPrompt/)
  // 进度跟踪与文本模型覆盖
  assert.match(svc, /current_storyboard_id/)
  assert.match(svc, /modelOverride: opts\.model/)
})

test('episodes route exposes video prompt batch endpoints', () => {
  const route = read('src/routes/episodes.ts')

  assert.match(route, /app\.post\('\/:id\/generate-video-prompts'/)
  assert.match(route, /app\.get\('\/:id\/video-prompts-status'/)
  assert.match(route, /startVideoPromptBatch\(ep\.id, ep\.dramaId/)
  assert.match(route, /body\.storyboard_ids/)
  assert.match(route, /already_running/)
})

// 2026-10-15：用户报「批量生产提示词还没完成，提示条就消失了（熄屏再开屏发现的）」。
// 真因：轮询固定 240 次（×2.5 秒 = 10 分钟）用尽就 emptyVideoPromptBatch() 静默清空，
// 而 10 条批量实测要跑 20~30 分钟；熄屏冻结渲染进程定时器 → 清空恰好发生在开屏那一刻。
// 另一条：面板/轮询用「当前浏览的集」，切页会被那一集的旧结果顶掉。
test('批量提示词进度条：绑任务归属集 + 轮询 100 分钟 + 用尽不清空（2026-10-15）', () => {
  const vue = readFileSync(new URL('../../frontend/app/views/drama/episode.vue', import.meta.url), 'utf8')
  assert.match(vue, /const VPB_RUN_KEY = 'hb\.vpb\.runningEpisode'/)
  assert.match(vue, /function markVpbEpisode\(id\)/)
  assert.match(vue, /function pollVideoPromptBatch\(attempts = 2400\)/)
  assert.match(vue, /const qid = vpbEpId\.value \|\| epId\.value/)
  assert.doesNotMatch(vue, /else videoPromptBatch\.value = emptyVideoPromptBatch\(\)/, '轮数用尽不许静默清空面板')
  assert.match(vue, /t\('episode\.sb\.pbStale'\)/)
  assert.match(vue, /episode\.sb\.pbOtherEpGo/)
  // 批量入口（批量补齐 / 单条体检修复 / 一键修复 / 单条重新生成）+ syncExtractStatus 的「本集在跑」分支
  // 都要绑定归属集（共 5 处）
  assert.equal((vue.match(/markVpbEpisode\(epId\.value\)/g) || []).length, 5)
  // 四种语言都要有新增文案
  for (const lang of ['zh', 'en', 'ja', 'ko']) {
    const loc = readFileSync(new URL(`../../frontend/app/locales/${lang}.json`, import.meta.url), 'utf8')
    for (const k of ['pbStale', 'pbOtherEp', 'pbOtherEpHint', 'pbOtherEpGo']) {
      assert.ok(loc.includes(`"${k}"`), `${lang}.json 缺 ${k}`)
    }
  }
})
