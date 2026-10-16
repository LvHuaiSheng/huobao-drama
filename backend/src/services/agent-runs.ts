/**
 * Agent 运行态登记（2026-10-16 加；用户报「点了拆分镜头、切画面回来又能点，而且没有进度条」）
 *
 * 死因：前端 `useAgent()` 把 `running` 放在**组件局部 ref** 里 —— 切页时组件卸载，
 *   `running` 直接归零 ⇒ 按钮又活（可重复提交）、进度无从显示（只有一个布尔，没有阶段信息）。
 *   修法不是在前端"记住状态"，而是把真值放到后端：谁在跑、从什么时候开始、已经写了几条分镜。
 *   前端切回来问一次就能复原，重复提交在后端被直接挡掉（多窗口/手快点也挡得住）。
 *
 * 内存登记即可（App 重启后没有在跑的任务 —— 请求本身随进程结束而结束，不需要落库）。
 */

export interface AgentRun {
  type: string
  episodeId: number
  /** 开始时间（epoch ms） */
  startedAt: number
  /** 本次运行已写入的分镜条数（由 save_storyboards 工具累加，供进度显示） */
  saved: number
}

const runs = new Map<string, AgentRun>()

const runKey = (type: string, episodeId: number) => `${type}:${episodeId}`

/**
 * 登记一次运行。**同一 Agent + 同一集已经在跑时返回 null**（调用方据此拒绝重复提交）。
 */
export function beginRun(type: string, episodeId: number): AgentRun | null {
  const key = runKey(type, episodeId)
  const existing = runs.get(key)
  if (existing) return null
  const run: AgentRun = { type, episodeId, startedAt: Date.now(), saved: 0 }
  runs.set(key, run)
  return run
}

/** 运行结束（成功或失败都要调，否则这个 Agent 会被永久挡住） */
export function endRun(type: string, episodeId: number): void {
  runs.delete(runKey(type, episodeId))
}

/** 该 Agent + 该集的当前运行态（含已用时秒数）；没在跑返回 null */
export function getRun(type: string, episodeId: number): (AgentRun & { elapsedSeconds: number }) | null {
  const run = runs.get(runKey(type, episodeId))
  if (!run) return null
  return { ...run, elapsedSeconds: Math.round((Date.now() - run.startedAt) / 1000) }
}

/** 某个 Agent 当前在跑的所有集（用于前端一次性恢复） */
export function listRuns(type?: string): (AgentRun & { elapsedSeconds: number })[] {
  const out: (AgentRun & { elapsedSeconds: number })[] = []
  for (const run of runs.values()) {
    if (type && run.type !== type) continue
    out.push({ ...run, elapsedSeconds: Math.round((Date.now() - run.startedAt) / 1000) })
  }
  return out
}

/** 累加「已写入分镜条数」（save_storyboards 工具调用；按集匹配在跑的那个 Agent） */
export function addSaved(episodeId: number, n: number): void {
  const id = Number(episodeId)
  if (!Number.isFinite(id) || !(n > 0)) return
  for (const run of runs.values()) {
    if (run.episodeId === id) run.saved += n
  }
}

/** 清空（仅测试用） */
export function __resetAgentRuns(): void {
  runs.clear()
}
