/**
 * Agent 聊天路由 — 非流式版本
 */
import { Hono } from 'hono'
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { mastra } from '../mastra/index.js'
import { success, badRequest } from '../utils/response.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { beginRun, endRun, getRun, listRuns } from '../services/agent-runs.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { parseScriptDurationSeconds, expectedStoryboardCount } from '../services/script-duration.js'

const app = new Hono()

// Mastra v1.17 的 ToolCallChunk / ToolResultChunk 结构：
// { type: 'tool-call', payload: { toolCallId, toolName, args } }
// { type: 'tool-result', payload: { toolCallId, toolName, result, isError } }
function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

// POST /agent/:type/chat — 非流式 Agent 对话
app.post('/:type/chat', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `无效的 Agent 类型：${agentType}`)
  }

  const body = await c.req.json()
  const { message, drama_id, episode_id } = body

  logTaskStart('Agent', agentType, {
    dramaId: drama_id,
    episodeId: episode_id,
    message,
  })
  logTaskPayload('Agent', `${agentType} input`, body)

  if (!episode_id || !drama_id) {
    logTaskError('Agent', agentType, { reason: 'missing drama_id or episode_id' })
    return badRequest(c, '需要 drama_id 与 episode_id')
  }

  const agent = mastra.getAgent(agentType)
  if (!agent) {
    logTaskError('Agent', agentType, { reason: 'agent not found' })
    return badRequest(c, 'Agent 不存在')
  }

  const requestContext = buildAgentRequestContext({
    episodeId: episode_id,
    dramaId: drama_id,
    modelOverride: body.model || undefined,
    textConfigId: body.config_id || undefined,
  })

  const startTime = performance.now()

  // 2026-10-10：maxSteps 按 Agent 类型区分。
  // 原先统一写 6 是为了治「单条生成提示词」的死循环（AI 写超长被写入闸门拒掉后
  // 一路重写、10 分钟不返回），但这里是**所有 Agent 的通用路由**——拆分 Agent
  // （storyboard_breaker）要「1 次 read_storyboard_context + N 批 save_storyboards」
  // （每批 ≤8 个分镜，28 个分镜 = 4 批）＝ 5 步以上，被统一砍到 6 步后跑不完、
  // 静默失败：用户报「我执行重新拆分了，但库里一条都没变」。
  const AGENT_MAX_STEPS: Record<string, number> = {
    storyboard_breaker: 30, // 拆分：读上下文 + 多批保存（每批 ≤8 个分镜）
    script_rewriter: 10, // 剧本改写：读 + 分段写回
    prompt_generator: 6, // 单条提示词：读上下文 + 1 次回答，超长被拒后不该无限重写
  }
  const maxSteps = AGENT_MAX_STEPS[agentType] ?? 20

  // 2026-10-16：同一 Agent + 同一集**只许跑一个**。前端原来是组件局部状态，切页回来就能再点，
  //   重复提交会让两条流水线同时写同一集的分镜（后一条 replace_existing 清空前一条的成果）。
  //   门放在后端 ⇒ 多窗口、手快点、刷新页面都挡得住。
  const run = beginRun(agentType, Number(episode_id))
  if (!run) {
    const cur = getRun(agentType, Number(episode_id))
    logTaskError('Agent', agentType, { reason: 'already-running', episodeId: episode_id, elapsedSeconds: cur?.elapsedSeconds })
    return badRequest(c, `${agentType} 正在跑这一集（已 ${cur?.elapsedSeconds ?? 0} 秒），等它结束再试`)
  }

  try {
    const result = await agent.generate(
      [{ role: 'user', content: message }],
      { maxSteps, requestContext },
    )

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 2026-10-16：拆分/改写跑完核对一次总时长（实测每集普遍短 40~96 秒 ⇒ 记下来便于事后核对）
    if (agentType === 'storyboard_breaker') {
      try {
        const [ep] = await db.select({ content: schema.episodes.content }).from(schema.episodes)
          .where(eq(schema.episodes.id, Number(episode_id)))
        const declared = parseScriptDurationSeconds(ep?.content || '')
        const rows = await db.select({ duration: schema.storyboards.duration }).from(schema.storyboards)
          .where(eq(schema.storyboards.episodeId, Number(episode_id)))
        const total = rows.reduce((s, r: any) => s + Number(r.duration || 0), 0)
        logTaskProgress('Agent', 'duration-check', {
          episodeId: episode_id, declaredSeconds: declared, storyboardCount: rows.length,
          totalSeconds: total, gapSeconds: declared == null ? null : declared - total,
        })
      } catch { /* 核对失败不影响结果 */ }
    }

    // 收集所有 tool calls 和 results
    const toolCalls = result.toolCalls || []
    const toolResults = result.toolResults || []
    const normalizedToolCalls = toolCalls.map((tc: any) => ({
      toolName: normalizeToolName(tc),
      args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
    }))
    const normalizedToolResults = toolResults.map((tr: any) => ({
      toolName: normalizeToolName(tr),
      result: normalizeToolResult(tr),
    }))

    logTaskProgress('Agent', 'tool-summary', {
      agentType,
      toolCalls: normalizedToolCalls.map((tc: any) => tc.toolName),
      toolResults: normalizedToolResults.map((tr: any) => tr.toolName),
    })
    logTaskPayload('Agent', `${agentType} tool-results`, normalizedToolResults)

    return success(c, {
      type: 'done',
      text: result.text || '',
      toolCalls: normalizedToolCalls,
      toolResults: normalizedToolResults,
    })
  } catch (err: any) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: err.message })
    console.error(err.stack || err)
    return badRequest(c, err.message || 'Agent 执行失败')
  } finally {
    // 成功与失败都要放行，否则这个 Agent 会被自己的登记永久挡住
    endRun(agentType, Number(episode_id))
  }
})

/**
 * GET /agent/:type/status?episode_id= — 当前运行态（前端切页回来靠它复原按钮状态 + 显示进度）
 * 不传 episode_id 时返回该 Agent 在跑的所有集。
 */
app.get('/:type/status', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, `无效的 Agent 类型：${agentType}`)
  const raw = c.req.query('episode_id')
  if (raw) {
    const episodeId = Number(raw)
    const run = getRun(agentType, episodeId)
    // 拆分镜头：把「目标条数 / 已写入秒数」一起给前端 ⇒ 进度条是**确定的**（用户要的进度条）
    let extra: Record<string, unknown> = {}
    if (agentType === 'storyboard_breaker' && Number.isFinite(episodeId)) {
      try {
        const [ep] = await db.select({ content: schema.episodes.content }).from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
        const declared = parseScriptDurationSeconds(ep?.content || '')
        const rows = await db.select({ duration: schema.storyboards.duration }).from(schema.storyboards)
          .where(eq(schema.storyboards.episodeId, episodeId))
        extra = {
          expected_storyboards: expectedStoryboardCount(declared),
          declared_seconds: declared,
          saved_seconds: rows.reduce((s, r: any) => s + Number(r.duration || 0), 0),
        }
      } catch { /* 取不到就不给目标，前端退回不确定进度条 */ }
    }
    return success(c, run ? { running: true, ...run, ...extra } : { running: false, ...extra })
  }
  const runs = listRuns(agentType)
  return success(c, { running: runs.length > 0, runs })
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, '无效的 Agent 类型')
  return success(c, { agent_type: agentType, valid: true })
})

export default app
