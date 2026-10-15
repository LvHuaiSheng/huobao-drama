/**
 * 体检「声音卡/音频声明」判据回归（2026-10-15）
 *
 * 事故：ep21 六条分镜在体检里一直挂 `media-no-audio-decl`（「角色已有声音卡，但正文没有 <Audio N> 声明」），
 * 一键修复带着「必须写 <Audio N>」的修法清单去修、警告永不消失。根因是**两侧口径相反**：
 *   - 体检（`services/prompt-media.ts`）按「源 wav 在不在」判 `hasVoiceCard`；
 *   - 生成侧（`agents/tools/storyboard-tools.ts` 的 `readVoiceCardInfo`）按「旧声音卡文件在不在」判
 *     `has_voice_card` —— 而声音卡 2026-10-11 已废 ⇒ 恒为 false，模型因此从不写 `<Audio N>`。
 * 而且**中转侧本来就会补**：`shim.py` 按落盘 wav 名接线 + 反查图片卡槽位补 `<Audio j>`，
 * 且补之前先 `have = set(re.findall(r"<Audio (\d+)>"))` 去重。
 * ⇒ 该告警在现管线里是纯误报（还会白烧修复轮次），已删除。本测试锁死「不再出现」。
 *
 * 体检告警回归（2026-10-15）：
 *  1. 去掉 `media-no-audio-decl`（有声音卡但正文没写 `<Audio N>`）——中转侧本来就会补且去重，见下方注释；
 *  2. `dialogue-over-budget` 阈值 4.5 → 6 字/秒（用户当天拍板：模型会自动适配语速、大部分念得完）并标为「不可自动修」。
 *
 * 跑法：cd backend && node --test tests/prompt-check-warnings.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EN = [
  'subject_definitions:',
  '<Subject 1> is the young Chinese woman Su Qinghe in <Picture 1>, black hair in a low loose ponytail, grey-blue janitor work jacket.',
  '',
  'summary:',
  'Su Qinghe opens the file bag on stage.',
  '',
  'retention_analysis:',
  '<Subject 1> (appears in every shot): fully_preserved - face and hair kept.',
  '',
  'detailed_description:',
  '[Shot 1] Medium shot: <Subject 1> stands at the front of the banquet hall holding a yellowed kraft file bag.',
  '[Shot 2] At 00:04.000 Close-up of her hands untying the cotton string on the bag.',
  '',
  'overall_soundscape:',
  'paper crinkling, low murmuring crowd, distant string bed.',
  '',
  'non_diegetic_music:',
  'low suspenseful strings, slow build.',
].join('\n')

const ZH = '出场人物：@苏清禾；场景：@宴会厅中央。\n\n0-4秒：@苏清禾站在台前，中景固定机位，手里捧着档案袋。\n4-8秒：镜头切到手部特写，她在解开棉线。'

async function loadChecker() {
  const esbuild = await import('esbuild')
  const out = join(mkdtempSync(join(tmpdir(), 'hb-check-')), 'bundle.mjs')
  await esbuild.build({
    entryPoints: [new URL('../src/services/prompt-check.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  })
  const mod = await import(out)
  rmSync(out, { force: true })
  return mod.checkStoryboardPrompt
}

test('已有声音（源 wav 在）但正文没写 <Audio N> → 不再报 media-no-audio-decl', async () => {
  const checkStoryboardPrompt = await loadChecker()
  const sb = { id: 1, storyboardNumber: 1, duration: 10, description: '【镜头1】中景：苏清禾站在台前。', videoPrompt: ZH, videoPromptEn: EN }
  const media = {
    refs: [{ picture: 1, kind: 'character', id: 28, name: '苏清禾', hasImage: true, hasCard: true, hasVoiceCard: true }],
  }
  const issues = checkStoryboardPrompt(sb, { media })
  const codes = issues.map(i => i.code)
  assert.equal(codes.includes('media-no-audio-decl'), false, `不该再有该告警，实际：${codes.join(',')}`)
  // 同一个 ref 缺身份卡时那条告警必须还在（别把整块素材检查一起删了）
  const issues2 = checkStoryboardPrompt(sb, {
    media: { refs: [{ picture: 1, kind: 'character', id: 28, name: '苏清禾', hasImage: true, hasCard: false, hasVoiceCard: true }] },
  })
  assert.ok(issues2.map(i => i.code).includes('media-no-identity-card'), '缺身份卡的告警应保留')
})

test('逐拍台词告警阈值 = 6 字/秒（5.3 不报、6.5 才报）且不进一键修复', async () => {
  const checkStoryboardPrompt = await loadChecker()
  const zh2 = '0-2秒：她站住。\n2-4秒：她转身。'
  const mkSb = (dialogue) => ({
    id: 2, storyboardNumber: 2, duration: 4, description: '【镜头1】她站住。【镜头2】她转身。',
    videoPrompt: zh2,
    videoPromptEn: 'detailed_description:\n[Shot 1] she stops <d>[Chinese] ' + dialogue + '</d>\n[Shot 2] she turns',
  })
  // 12 字 / 2 秒 = 6.0 字/秒 → 刚好不报（用户 2026-10-15：H3 实测语速 5~6 字/秒，这类念得完）
  const ok = checkStoryboardPrompt(mkSb('所有人都以为那是意外事故'))
  assert.equal(ok.some(i => i.code === 'dialogue-over-budget'), false, '6.0 字/秒 不该再报')

  // 13 字 / 2 秒 = 6.5 字/秒 → 报，并标 autoFixable:false（不喂给一键修复）
  const bad = checkStoryboardPrompt(mkSb('所有人都以为那是意外事故了'))
  const item = bad.find(i => i.code === 'dialogue-over-budget')
  assert.ok(item, '6.5 字/秒 应报警')
  assert.equal(item.autoFixable, false)
  assert.match(item.message, /6\.5 字\/秒/)

  // 修法清单里不再包含这条 code（否则一键修复会照它白烧一轮）
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/services/prompt-check.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /^\s*'dialogue-over-budget':/m, '修法清单映射里不该再有这条')
  assert.match(src, /const ZH_DIALOGUE_RATE_LIMIT = 6/)
})

test('源码级：media-no-audio-decl 已从体检与修法清单里清干净', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/services/prompt-check.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /code: 'media-no-audio-decl'/, '该 code 不该再被产出')
  assert.doesNotMatch(src, /^\s*'media-no-audio-decl':/m, '修法清单映射里也该删掉')
  // 换掉的那段必须留下「为什么删」的说明，防止下次有人又加回来
  assert.match(src, /2026-10-15 去掉 `media-no-audio-decl`/)
})
