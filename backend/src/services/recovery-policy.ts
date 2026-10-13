/**
 * 启动恢复的判定表（纯函数，零 IO —— 可离线干跑验证分支行为）
 *
 * 背景（2026-10-13 实测事故）：进程重启后内存里的轮询线程全部丢失，
 * 旧实现直接把所有 processing 任务无条件标失败；但服务商侧的任务其实还在跑、
 * 甚至已经出片 —— 结果 3 条已完成的视频被一次性判成失败，成片只能事后手动捞。
 *
 * 现在不猜，逐条查一次真实状态再决定。判定表：
 *   没有任务号 / 没有可用配置 → 标失败（无从查起）
 *   404 / 410（任务不存在）   → 标失败（服务商侧也没了）
 *   网络错误 / 5xx / 解析失败 → 恢复轮询（判不了真状态，宁可多等，不误杀在跑的任务）
 *   已完成 + 拿得到产物地址   → 直接接回（下载 + 落库 + 回写业务表）
 *   已完成但产物地址缺失      → 恢复轮询（再取一次）
 *   明确失败                  → 标失败（上游终态）
 *   处理中 / 其它状态         → 恢复轮询
 */

/** 探测结果（对服务商查一次之后得到的原始事实） */
export type RecoveryProbe =
  /** 连任务号都没有：提交都没跑完，没有任何可查的 ID */
  | 'no-task-id'
  /** 当前没有启用中的服务商配置，查不了 */
  | 'no-config'
  /** 404 / 410：服务商侧没有这个任务 */
  | 'not-found'
  /** 网络错误 / 5xx / 解析失败：判不了真实状态 */
  | 'probe-error'
  /** 拿到了任务状态 */
  | 'ok'

/** 恢复动作 */
export type RecoveryAction =
  /** 已完成：按正常完成流程接回（下载 + 落库 + 回写业务表） */
  | 'restore-completed'
  /** 恢复轮询（后台继续等） */
  | 'resume-polling'
  /** 标失败 */
  | 'fail'

export function decideRecoveryAction(
  probe: RecoveryProbe,
  opts: { apiStatus?: string; hasProductUrl?: boolean } = {},
): RecoveryAction {
  switch (probe) {
    case 'no-task-id':
    case 'no-config':
    case 'not-found':
      return 'fail'
    case 'probe-error':
      return 'resume-polling'
    case 'ok':
    default: {
      const status = String(opts.apiStatus || '')
      if (status === 'completed') {
        return opts.hasProductUrl ? 'restore-completed' : 'resume-polling'
      }
      if (status === 'failed' || status === 'cancelled') return 'fail'
      return 'resume-polling'
    }
  }
}
