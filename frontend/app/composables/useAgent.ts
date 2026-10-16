import { toast } from 'vue-sonner'
import { api } from './useApi'
import { toastError } from './useToast'
import { i18n } from './i18n'

/**
 * Agent 运行态（2026-10-16 修）
 *
 * 实测事故：用户「点了拆分镜头，切换画面以后拆分镜头又可以重新点了，另外拆分镜头没有进度条」。
 * 两个症状同一个根：
 *   ① 原来的 `running` 是 `useAgent()` **函数内部**的 ref —— 每个组件实例各一份，
 *      切页时页面组件卸载 ⇒ 归零 ⇒ 按钮又活（前一次其实还在跑，重复提交会两条流水线同写一集）；
 *   ② 它只有一个布尔，没有阶段/进度信息 ⇒ 界面无从显示进度条。
 * 修法：
 *   · 状态提到**模块级**（单例，切页不丢）；
 *   · 真值放后端（`GET /agent/:type/status`，见 backend services/agent-runs.ts）——
 *     后端同时会挡掉重复提交，多窗口/手快点也挡得住；
 *   · 进度用后端给的真数据：已用时 + 已写入分镜条数（不编造百分比）。
 */
const running = ref(false)
const runningType = ref<string | null>(null)
const progress = ref<{ elapsedSeconds: number; saved: number; expected: number | null } | null>(null)

/** 本次 POST 还在飞（此时完成通知由 run() 负责，轮询只更新进度，避免双 toast） */
let postInFlight = false
let poller: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (poller) { clearInterval(poller); poller = null }
}

function applyStatus(st: any) {
  if (!st || !st.running) return false
  progress.value = {
    elapsedSeconds: Number(st.elapsedSeconds ?? st.elapsed_seconds ?? 0),
    saved: Number(st.saved ?? 0),
    // 拆分镜头：后端会给出目标条数（= 剧本声明时长 ÷ 10 秒）⇒ 进度条是确定的
    expected: st.expected_storyboards == null ? null : Number(st.expected_storyboards),
  }
  return true
}

/** 轮询进度；跑完了就收尾（若不是本次 POST 在管，则发完成提示 + 刷新） */
function startPolling(type: string, episodeId: number, onDone?: () => void) {
  stopPolling()
  const tick = async () => {
    try {
      const st = await api.get<any>(`/agent/${type}/status?episode_id=${episodeId}`)
      if (applyStatus(st)) return
      // 后端已无这次运行 ⇒ 结束了
      stopPolling()
      const mine = runningType.value === type
      running.value = false
      runningType.value = null
      progress.value = null
      if (mine && !postInFlight) {
        toast.success(i18n.global.t('composables.agent.done'))
        onDone?.()
      }
    } catch { /* 网络抖动下一轮再试 */ }
  }
  void tick()
  poller = setInterval(tick, 3000)
}

/**
 * 切页/刷新回来后复原：后端说这一集的某个 Agent 还在跑，就把按钮状态与进度接回来。
 * （与 `syncExtractStatus` 同一个套路 —— 状态从真值来源问，不靠前端记忆。）
 */
async function resume(type: string, episodeId: number, onDone?: () => void) {
  if (!episodeId) return false
  try {
    const st = await api.get<any>(`/agent/${type}/status?episode_id=${episodeId}`)
    if (!applyStatus(st)) return false
    running.value = true
    runningType.value = type
    // 这次不是本组件发起的 POST（切页回来的），跑完要提示 + 刷新
    postInFlight = false
    startPolling(type, episodeId, onDone)
    return true
  } catch {
    return false
  }
}

export function useAgent() {
  async function run(type: string, msg: string, dramaId: number, episodeId: number, onDone?: () => void, model?: string, configId?: number) {
    if (running.value) { toast.warning(i18n.global.t('composables.agent.busy')); return }
    running.value = true
    runningType.value = type
    progress.value = null
    postInFlight = true
    startPolling(type, episodeId)
    try {
      const data = await api.post<any>(`/agent/${type}/chat`, {
        message: msg,
        drama_id: dramaId,
        episode_id: episodeId,
        model: model || undefined,
        config_id: configId || undefined,
      })
      toast.success(i18n.global.t('composables.agent.done'))
      onDone?.()
    } catch (err: any) {
      toastError(err)
    } finally {
      postInFlight = false
      stopPolling()
      running.value = false
      runningType.value = null
      progress.value = null
    }
  }

  return { running, runningType, progress, run, resume }
}
