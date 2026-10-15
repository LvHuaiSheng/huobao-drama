import fs from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { refmodCardName, refmodCardPath } from './refmod.js'
import { effectiveVoiceId, voiceCardName, voiceWavPath } from './voice.js'
import type { MediaContext, MediaRef } from './prompt-check.js'

/**
 * 组装某条分镜的「参考素材上下文」（2026-10-13 抽出，单条体检与整集体检共用）
 *
 * 参考图顺序与 agents/tools/storyboard-tools.ts 的 reference_order 严格同序：
 *   场景 → 角色 id 升序 → 道具 id 升序
 * 只读：查库 + 看文件在不在，不写库、不调模型、不占 GPU。
 */
export async function buildMediaRefs(storyboardId: number, slotLimit = 9): Promise<MediaContext> {
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  const refs: MediaRef[] = []
  if (!sb) return { refs, slotLimit }

  const charLinks = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  const propLinks = await db.select().from(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))
  const allChars = await db.select().from(schema.characters)
  const allProps = await db.select().from(schema.props)
  const allScenes = await db.select().from(schema.scenes)

  let picNo = 1
  const scene = sb.sceneId ? allScenes.find(s => s.id === sb.sceneId && !s.deletedAt) : undefined
  if (scene) {
    refs.push({
      picture: picNo++, kind: 'scene', id: scene.id, name: scene.location || '',
      hasImage: !!(scene.imageUrl || '').trim(),
      hasCard: fs.existsSync(refmodCardPath(refmodCardName('scene', scene.id))),
    })
  }
  for (const cid of charLinks.map(l => l.characterId).sort((a, b) => a - b)) {
    const ch = allChars.find(x => x.id === cid && !x.deletedAt)
    if (!ch) continue
    refs.push({
      picture: picNo++, kind: 'character', id: ch.id, name: ch.name,
      // 发色/服装颜色闸的判据：只有「卡里的文字」能被写提示词的模型看到（2026-10-15 加）
      assetText: [ch.appearance, ch.styling, ch.costumeLabel].filter(Boolean).join(' ｜ '),
      hasImage: !!(ch.imageUrl || '').trim(),
      hasCard: fs.existsSync(refmodCardPath(refmodCardName('character', ch.id))),
      // 判据是**源 wav 在不在**（.safetensors 声音卡 2026-10-11 已废）；换装变体沿用原角色时解析到原角色那份
      hasVoiceCard: fs.existsSync(voiceWavPath(voiceCardName(effectiveVoiceId(ch.id)))),
    })
  }
  for (const pid of propLinks.map(l => l.propId).sort((a, b) => a - b)) {
    const pr = allProps.find(x => x.id === pid && !x.deletedAt)
    if (!pr) continue
    refs.push({
      picture: picNo++, kind: 'prop', id: pr.id, name: pr.name,
      assetText: [pr.description, pr.finalPrompt].filter(Boolean).join(' ｜ '),
      hasImage: !!(pr.imageUrl || '').trim(),
      hasCard: fs.existsSync(refmodCardPath(refmodCardName('prop', pr.id))),
    })
  }
  return { refs, slotLimit }
}
