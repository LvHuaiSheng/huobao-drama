/**
 * 日志落盘（2026-10-13）
 *
 * 桌面版从 Finder 启动时后端 stdout 没有接收端：崩溃 / 异常退出后现场全丢。
 * 实测事故：主进程异常退出、重启后把 3 条其实已跑完（服务器侧已出片）的任务判成失败，
 * 事后既没有退出码也没有堆栈可查，只能靠系统日志一点点猜。
 *
 * 这里把后端所有 stdout / stderr 追加写入 <DATA_ROOT>/logs/backend-YYYY-MM-DD.log，
 * 并记录未捕获异常、未处理拒绝、进程退出码与终止信号。
 *
 * 三条硬约束：
 *  1) 写盘失败必须静默吞掉 —— 日志绝不能拖垮主流程；
 *  2) 单文件超过 MAX_BYTES 后停止写入（防磁盘写满）；
 *  3) 不改变崩溃语义 —— uncaughtException 记录后仍按 Node 默认退出
 *     （若已有其它监听者则完全不接管退出，避免与此前行为不一致）。
 */
import fs from 'fs'
import path from 'path'
import { DATA_ROOT } from './paths.js'

const MAX_BYTES = 20 * 1024 * 1024
const KEEP_DAYS = 7
/** 单条日志最多写入的字符数（logTaskPayload 会打印整段请求体，截断防爆盘） */
const MAX_LINE_CHARS = 8000
const ANSI_RE = /\u001b\[[0-9;]*m/g

let installed = false
let disabled = false
let currentFile = ''
let writtenBytes = 0

function logDir() {
  return path.join(DATA_ROOT, 'logs')
}

function pad(n: number, width = 2) {
  return String(n).padStart(width, '0')
}

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function filePathForToday(d = new Date()) {
  return path.join(logDir(), `backend-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`)
}

/** 只清理本目录下 backend-YYYYMMDD.log 形态的旧文件，不碰用户其它数据 */
function sweepOldFiles() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400_000
    for (const name of fs.readdirSync(logDir())) {
      if (!/^backend-\d{8}\.log$/.test(name)) continue
      const full = path.join(logDir(), name)
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true })
      } catch { /* 单个文件清理失败忽略 */ }
    }
  } catch { /* 目录不可读忽略 */ }
}

function append(text: string) {
  if (disabled || !text) return
  try {
    const target = filePathForToday()
    if (target !== currentFile) {
      fs.mkdirSync(logDir(), { recursive: true })
      currentFile = target
      writtenBytes = fs.existsSync(target) ? fs.statSync(target).size : 0
      sweepOldFiles()
    }
    if (writtenBytes >= MAX_BYTES) return
    const payload = text
      .replace(ANSI_RE, '')
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .map((line) => {
        const clipped = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…<truncated>` : line
        return `[${stamp()}] ${clipped}\n`
      })
      .join('')
    if (!payload) return
    fs.appendFileSync(target, payload, 'utf8')
    writtenBytes += Buffer.byteLength(payload)
  } catch {
    disabled = true
  }
}

function toText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf8')
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8')
  return chunk == null ? '' : String(chunk)
}

let installedOnce = false

export function installFileLogging(): void {
  if (installedOnce) return
  installedOnce = true
  installed = true

  try {
    fs.mkdirSync(logDir(), { recursive: true })
  } catch {
    disabled = true
  }

  const patch = (stream: 'stdout' | 'stderr') => {
    const original = process[stream].write.bind(process[stream])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process[stream] as any).write = (chunk: any, encoding?: any, cb?: any) => {
      append(toText(chunk))
      return original(chunk, encoding, cb)
    }
  }
  patch('stdout')
  patch('stderr')

  const hadUncaughtListener = process.listenerCount('uncaughtException') > 0
  process.on('uncaughtException', (err: unknown) => {
    const e = err as { stack?: string } | undefined
    append(`FATAL uncaughtException: ${e?.stack || String(err)}\n`)
    if (!hadUncaughtListener) process.exit(1)
  })
  process.on('unhandledRejection', (reason: unknown) => {
    const r = reason as { stack?: string } | undefined
    append(`FATAL unhandledRejection: ${r?.stack || String(reason)}\n`)
  })
  process.on('exit', (code) => {
    append(`backend process exiting (code=${code})\n`)
  })
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      append(`backend received ${sig} → exit\n`)
      process.exit(0)
    })
  }

  append(`=== backend logging installed (pid=${process.pid}, dataRoot=${DATA_ROOT}) ===\n`)
}
