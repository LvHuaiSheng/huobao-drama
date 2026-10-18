import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import { fileURLToPath } from 'url'

import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import tasks from './routes/tasks.js'
import upload from './routes/upload.js'
import aiConfigs, { aiProviders } from './routes/aiConfigs.js'
import stylePresets from './routes/stylePresets.js'
import prompts from './routes/prompts.js'
import agent from './routes/agent.js'
import merge from './routes/merge.js'
import skills from './routes/skills.js'
import props from './routes/props.js'
import settings from './routes/settings.js'
import storage from './routes/storage.js'
import serverUpdate from './routes/serverUpdate.js'
import refmod from './routes/refmod.js'
import voice from './routes/voice.js'
import maintenance from './routes/maintenance.js'
import mv from './routes/mv.js' // 2026-10-18 音乐 MV（独立模块，与短剧链路隔离）
import { requestLogger, errorHandler } from './middleware/logger.js'
import { DATA_ROOT } from './utils/paths.js'
import { installFileLogging } from './utils/log-file.js'
import { recoverInterruptedTasks } from './services/generation.js'

// 最早安装：此后所有 console 输出（含崩溃堆栈）同时落盘
// <DATA_ROOT>/logs/backend-YYYY-MM-DD.log —— 主进程崩溃/异常退出后才有据可查。
installFileLogging()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()

// Middleware
app.use('*', cors({
  origin: ['http://localhost:3013', 'http://localhost:5679'],
  credentials: true,
}))
app.use('*', requestLogger)
app.use('*', errorHandler)

// Health check（version 供部署巡检/更新检查核对当前运行版本）
app.get('/api/v1/health', (c) => c.json({
  status: 'ok',
  version: process.env.HUOBAO_VERSION || undefined,
  timestamp: new Date().toISOString(),
}))

// API routes
const api = new Hono()
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/storyboards', storyboards)
api.route('/scenes', scenes)
api.route('/characters', characters)
api.route('/tasks', tasks)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/style-presets', stylePresets)
api.route('/prompts', prompts)
api.route('/agent', agent)
api.route('/merge', merge)
api.route('/skills', skills)
api.route('/props', props)
api.route('/storage', storage)
api.route('/settings', settings)
api.route('/server-update', serverUpdate)
api.route('/refmod', refmod)
api.route('/voice', voice) // 2026-10-08 角色声音（语音卡）
api.route('/maintenance', maintenance) // 2026-10-10 存储维护（扫描/清理历史孤儿文件）
api.route('/mv', mv) // 2026-10-18 音乐 MV（独立页面用，与短剧链路隔离）

app.route('/api/v1', api)

// Serve static files (storage)
// 生成的图片/视频按 uuid 命名、内容不变，标记为 immutable 让浏览器长缓存
app.use('/static/*', async (c, next) => {
  await next()
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
app.use('/static/*', serveStatic({ root: DATA_ROOT }))
// /static/* 下不存在的文件必须 404 —— 否则会落到下面的 SPA 兜底，返回 200 的 HTML：
// 图片解码失败时前端拿不到「文件真的没有」这个信号（缩略图缺失时的回退就靠它）。
app.use('/static/*', async (c) => c.body(null, 404))

// Serve frontend (production build) — 桌面版由主进程注入 FRONTEND_DIST（resources/frontend）
const distPath = process.env.FRONTEND_DIST || path.join(projectRoot, 'frontend', 'dist')
app.use('*', serveStatic({ root: distPath }))
app.get('*', serveStatic({ root: distPath, path: 'index.html' }))

const port = Number(process.env.PORT || 5679)
console.log(`🚀 Huobao Drama TS server on http://localhost:${port}`)

// 进程重启后内存中的轮询线程全部丢失。原实现在这里把所有 processing 任务无条件标失败，
// 但服务商侧的任务其实还在跑、甚至已经跑完（实测 2026-10-13：后台服务异常退出后重启，
// 3 条已经在服务器上出片的任务被一次性判成失败，成片只能事后手动捞回）。
// 现在改为：逐条向服务商查一次真实状态再决定 —— 已完成直接接回、处理中恢复轮询、
// 任务确实不存在才标失败。异步执行，不阻塞 serve()。
recoverInterruptedTasks()
  .then((stats) => console.log(`🔁 启动恢复：${JSON.stringify(stats)}`))
  .catch((err) => console.error('启动恢复中断任务失败:', err?.message))

serve({ fetch: app.fetch, port })
