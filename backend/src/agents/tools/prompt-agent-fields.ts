/**
 * 视频提示词 Agent 的写入字段白名单（2026-10-14）
 *
 * 背景（实测，2026-10-14 18:58:06 日志）：
 *   [StoryboardTool] update-begin ... fields=["title","shot_type",...,"description",...]
 * prompt_generator 的指令与技能都明写「只传 storyboard_id + video_prompt + video_prompt_en，
 * 其他字段一律不传」，但模型照旧把整行字段回传。它读上下文是**生成开始时**的快照，
 * 一次生成要跑 50 秒以上 —— 用户在生成过程中手改的「画面描述」就被这份旧快照覆盖回去，
 * 用户看到的症状是「画面描述改完又变回去」。
 * 同族问题（模型不自律）反复出现 → 规则写在提示词里拦不住，就在工具层机械拦：
 * 白名单外的键直接丢弃（并留痕 prompt-agent-fields-dropped）。
 *
 * 放在独立文件里是为了能脱离 DB/Agent 模块图单测（那些模块有循环依赖，dev 下 import 会撞 TDZ）。
 */
export const PROMPT_AGENT_ALLOWED_KEYS = ['storyboard_id', 'video_prompt', 'video_prompt_en'] as const

const ALLOWED = new Set<string>(PROMPT_AGENT_ALLOWED_KEYS)

/** 过滤视频提示词 Agent 回传的字段：只留白名单内的键，返回被丢弃的键名便于留痕 */
export function filterPromptAgentFields(input: Record<string, any> | null | undefined): {
  filtered: Record<string, any>
  dropped: string[]
} {
  const keys = Object.keys(input || {})
  const dropped = keys.filter(k => !ALLOWED.has(k))
  const filtered: Record<string, any> = {}
  for (const k of keys) if (ALLOWED.has(k)) filtered[k] = (input as Record<string, any>)[k]
  return { filtered, dropped }
}
