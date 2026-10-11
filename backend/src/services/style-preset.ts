/**
 * 风格预设服务 — 将项目绑定的视觉风格解析为英文提示词片段
 * dramas.style 存 style_presets.value；查不到/已停用时返回空串（调用方走兜底）
 */
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

/**
 * 预设有「正文渲染语言」时的分隔标记（独占一行；前后允许空行）
 * 2026-10-11：预设 prompt = 风格头（给图片模型）+ 该标记 + 正文渲染语言（给提示词 Agent）。
 * 依据（实测）：风格头改不动画风（头/尾/夹击都试过，无差别）；只有正文本身换成该画风的
 * 介质语言，画风才锁得住 —— 所以画风必须同时递给图片模型和提示词 Agent。
 * 旧预设没写这个标记 → bodyRules 为空 → 行为与改动前完全一致（向后兼容）。
 */
export const STYLE_BODY_SEP = '---BODY-RENDER-LANGUAGE---'

export interface DramaStyleSpec {
  /** 风格头：拼在最终提示词最前方的片段；无预设时为 '' */
  head: string
  /** 正文渲染语言规范：给提示词 Agent 读；旧预设无分隔标记时为 '' */
  bodyRules: string
}

/** 读项目绑定的启用中预设原文；查不到返回 '' */
async function loadPresetPrompt(dramaId: number | null | undefined): Promise<string> {
  if (!dramaId) return ''
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.style) return ''
  const [preset] = await db.select().from(schema.stylePresets)
    .where(and(eq(schema.stylePresets.value, drama.style), eq(schema.stylePresets.isActive, true)))
  return preset?.prompt || ''
}

/**
 * 查询项目绑定的风格预设「风格头」；查不到返回 ''
 * 注意：只返回分隔标记之前的部分 —— 正文渲染语言（标记之后）只给提示词 Agent 用，
 * 不得混进图片/视频提示词（H3 视频提示词有长度上限，且外挂处方对画风无实质作用）。
 */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  return (await getDramaStyleSpec(dramaId)).head
}

/** 查询项目绑定的风格预设完整规范（风格头 + 正文渲染语言） */
export async function getDramaStyleSpec(dramaId: number | null | undefined): Promise<DramaStyleSpec> {
  const raw = await loadPresetPrompt(dramaId)
  if (!raw) return { head: '', bodyRules: '' }
  const idx = raw.indexOf(STYLE_BODY_SEP)
  if (idx < 0) return { head: raw.trim(), bodyRules: '' }
  return {
    head: raw.slice(0, idx).trim(),
    bodyRules: raw.slice(idx + STYLE_BODY_SEP.length).trim(),
  }
}
