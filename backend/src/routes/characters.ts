import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { getDramaStylePrompt } from '../services/style-preset.js'
import { ensureCharacterFinalPrompt } from '../services/final-prompt.js'
import { ensureVoiceDesc } from '../services/voice-prompt.js'
import { removeRefmod, extractRefmod } from '../services/refmod.js'
import { removeVoice } from '../services/voice.js'
import { generateCostumeBoard, costumeEditPrompt, COSTUME_EDIT_MODEL } from '../services/costume-edit.js'
import { generateImageThumb } from '../utils/storage.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()
// 角色参考板**固定横版**（一帧四格横排），不跟随项目画幅 —— 它只提供身份、不参与画面构图，
// 竖版会把四格挤窄、五官与文字反而看不清。2048x1152 = 精确 16:9 且宽高都被 32 整除
// （旧值 1920x1080 的 1080 会被中转量化成 1056，比例变成 1.818）。
const CHARACTER_IMAGE_SIZE = '2048x1152'

// POST /characters — 手动新增角色（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id 必填')
  if (!body.name?.trim()) return badRequest(c, '名称必填')
  const ts = now()
  const res = await db.insert(schema.characters).values({
    name: body.name.trim(),
    role: body.role || '',
    description: body.description || '',
    appearance: body.appearance || '',
    styling: body.styling || '',
    dramaId: body.drama_id,
    createdAt: ts,
    updatedAt: ts,
  })
  const charId = getInsertId(res)
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeCharacters)
      .where(and(eq(schema.episodeCharacters.episodeId, Number(body.episode_id)), eq(schema.episodeCharacters.characterId, charId)))
    if (!existing.length) {
      await db.insert(schema.episodeCharacters).values({ episodeId: Number(body.episode_id), characterId: charId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, charId))
  return created(c, toSnakeCase(row))
})

function characterImagePrompt(char: typeof schema.characters.$inferSelect, stylePrompt = '') {
  return [
    stylePrompt || '',
    char.name,
    char.appearance || char.description || '人物立绘',
    char.styling || '',
    '16:9 横版角色定妆照',
    '半身角色海报构图',
    '正面',
    '高质量',
    '白色背景',
  ].filter(Boolean).join(', ')
}

// PUT /characters/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  for (const key of ['name', 'role', 'description', 'appearance', 'styling', 'imageUrl', 'localPath']) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    if (snakeKey in body) updates[key] = body[snakeKey]
    else if (key in body) updates[key] = body[key]
  }
  // 手动编辑最终提示词时以传入值为准；未传入则保留原值（修改信息时不再自动置空）
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  await db.update(schema.characters).set(updates).where(eq(schema.characters.id, id))
  return success(c)
})

// DELETE /characters/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.update(schema.characters).set({ deletedAt: now() }).where(eq(schema.characters.id, id))
  removeRefmod('character', id) // 2026-10-08 删角色连带清卡（Mac 主副本）
  removeVoice(id) // 2026-10-08 删角色连带清声音（卡+wav+参数）
  return success(c)
})

// POST /characters/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  const stylePrompt = await getDramaStylePrompt(char.dramaId)
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined })
  const prompt = finalPrompt || characterImagePrompt(char, stylePrompt)
  try {
    logTaskStart('CharacterImage', 'generate', { characterId: id, episodeId: ep.id, dramaId: char.dramaId })
    const genId = await generateImage({ characterId: id, dramaId: char.dramaId, prompt, model: body.model, size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
    logTaskSuccess('CharacterImage', 'generate', { characterId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('CharacterImage', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/:id/generate-prompt — 独立生成/重新生成三视图最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  logTaskStart('FinalPrompt', 'character-generate', { characterId: id, episodeId: ep.id, force: !!body.force })
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined })
  if (!finalPrompt) {
    logTaskError('FinalPrompt', 'character-generate', { characterId: id, error: 'agent returned empty prompt' })
    return badRequest(c, '最终提示词生成失败，请重试')
  }
  logTaskSuccess('FinalPrompt', 'character-generate', { characterId: id })
  // 顺带生成该角色的音色描述（声音面板自动带出；失败不阻断）
  const voiceDesc = await ensureVoiceDesc(char, !!body.force, {
    model: body.text_model,
    configId: body.text_config_id ?? undefined,
  })
  return success(c, { final_prompt: finalPrompt, voice_desc: voiceDesc })
})

// POST /characters/batch-generate-images
app.post('/batch-generate-images', async (c) => {
  const body = await c.req.json()
  const ids: number[] = body.character_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')
  const results: number[] = []
  const stylePrompt = await getDramaStylePrompt(ep.dramaId)
  for (const cid of ids) {
    const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, cid))
    if (!char) continue
    const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined })
    const prompt = finalPrompt || characterImagePrompt(char, stylePrompt)
    try {
      const genId = await generateImage({ characterId: cid, dramaId: char.dramaId, prompt, model: body.model, size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
      results.push(genId)
    } catch {}
  }
  logTaskSuccess('CharacterImage', 'batch-generate', { episodeId: ep.id, requested: ids.length, started: results.length })
  return success(c, { count: results.length, ids: results })
})

// GET /characters/:id/variants — 该角色的所有「换装造型变体」（UI 展示用）
app.get('/:id/variants', async (c) => {
  const baseId = Number(c.req.param('id'))
  const rows = await db.select().from(schema.characters).where(eq(schema.characters.variantOf, baseId))
  return success(c, { variants: rows.filter(r => !r.deletedAt).map(r => toSnakeCase(r)) })
})

// POST /characters/:id/costume-variant — 新建「换装造型变体角色」并生成它的定妆板
//   ① 变体是**独立角色行**（自带 RefMod 卡 / 分镜绑定 / 参考图槽位），基准角色与它的卡一个字都不动；
//   ② 变体的 appearance **强制逐字复制**基准角色 → 脸的文字描述不可能被改坏（提示词层脸不变）；
//   ③ 定妆板走图像编辑（qwen-image-2.1-edit + 全分辨率参考图），只换衣服、脸一点不动（像素层脸不变）。
//   body: { episode_id, costume_label, costume_desc?, reference_image_url?, model?, auto_card? }
app.post('/:id/costume-variant', async (c) => {
  const baseId = Number(c.req.param('id'))
  const body = await c.req.json()
  const [base] = await db.select().from(schema.characters).where(eq(schema.characters.id, baseId))
  if (!base || base.deletedAt) return badRequest(c, '原角色不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')
  const label = String(body.costume_label || '').trim()
  if (!label) return badRequest(c, 'costume_label（造型名）必填')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  const ts = now()
  const variantName = `${base.name}·${label}`
  const desc = String(body.costume_desc || '').trim() || label

  // 已存在同名变体 → 复用该行（只刷新妆造/外观同步），不重复建角色
  const siblings = await db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, base.dramaId), eq(schema.characters.name, variantName)))
  let variant = siblings.find(s => !s.deletedAt)
  if (variant) {
    await db.update(schema.characters).set({
      appearance: base.appearance || '',   // 🔴 每次都对齐基准角色的脸（文字层）
      styling: desc,
      variantOf: baseId,
      costumeLabel: label,
      updatedAt: ts,
    }).where(eq(schema.characters.id, variant.id))
    logTaskProgress('CostumeVariant', 'reuse', { baseId, variantId: variant.id, label })
  } else {
    const res = await db.insert(schema.characters).values({
      name: variantName,
      role: base.role || '',
      description: base.description || '',
      appearance: base.appearance || '',   // 🔴 逐字复制 = 脸不变的文字保证
      styling: desc,
      dramaId: base.dramaId,
      variantOf: baseId,
      costumeLabel: label,
      createdAt: ts,
      updatedAt: ts,
    })
    const newId = getInsertId(res)
    variant = (await db.select().from(schema.characters).where(eq(schema.characters.id, newId)))[0]
    logTaskProgress('CostumeVariant', 'created', { baseId, variantId: newId, label, name: variantName })
  }
  if (!variant) return badRequest(c, '变体角色创建失败')

  // 绑到该集（与手动新增角色同一套语义：集级绑定；分镜级绑定交给拆解层按造型词选择）
  const linked = await db.select().from(schema.episodeCharacters)
    .where(and(eq(schema.episodeCharacters.episodeId, ep.id), eq(schema.episodeCharacters.characterId, variant.id)))
  if (!linked.length) {
    await db.insert(schema.episodeCharacters).values({ episodeId: ep.id, characterId: variant.id, createdAt: ts })
  }

  // 参考图：默认基准角色的定妆板；调用方可传自己的（已上传的 static 路径）
  const refPath = String(body.reference_image_url || base.imageUrl || '').trim()
  if (!refPath) return badRequest(c, '原角色还没有定妆图，也没有传参考图')

  const model = String(body.model || '').trim() || COSTUME_EDIT_MODEL
  const prompt = costumeEditPrompt(label, desc)
  try {
    logTaskStart('CostumeVariant', 'generate', { baseId, variantId: variant.id, label, model, refPath })
    const { relativePath, bytes } = await generateCostumeBoard({ referenceImage: refPath, prompt, model })
    await db.update(schema.characters)
      .set({ imageUrl: relativePath, localPath: relativePath, updatedAt: now() })
      .where(eq(schema.characters.id, variant.id))
    await generateImageThumb(relativePath).catch(() => null)
    logTaskSuccess('CostumeVariant', 'done', { baseId, variantId: variant.id, imageUrl: relativePath, bytes })

    // 可选：顺手抽这张新板的 RefMod 卡（默认不抽，让用户先看脸）
    let cardName: string | null = null
    if (body.auto_card) {
      try {
        cardName = (await extractRefmod('character', variant.id)).name
      } catch (err: any) {
        logTaskError('CostumeVariant', 'card-failed', { variantId: variant.id, error: err.message })
      }
    }
    return created(c, {
      character_id: variant.id,
      name: variantName,
      image_url: relativePath,
      bytes,
      reference_image: refPath,
      card: cardName,
    })
  } catch (err: any) {
    logTaskError('CostumeVariant', 'generate', { baseId, variantId: variant.id, error: err.message })
    return badRequest(c, `换装图生成失败：${err.message}`)
  }
})

export default app
