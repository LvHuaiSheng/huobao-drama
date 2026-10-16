/**
 * 两条「检查规则自相矛盾 ⇒ 报错永远修不掉」的回归（2026-10-16，用户报「9集3分镜 报错修复不了」）
 *
 * ① 体检 zh-dialogue-punct：白名单只认 `。！？…!?`，把**结尾是破折号的被打断台词**
 *    （sb486 原文：`@苏家二叔说：「识相点，把苏家全部股权交出来——」`）判成「没收标点」。
 *    而台词必须逐字照抄分镜描述 ⇒ 生成/一键修复**永远动不了它**（点了修复还是同一条警告）。
 *    ⇒ 破折号算合法收尾；且这条标 autoFixable:false（只能去改分镜描述）。
 * ② 生成侧 zh-en 一致性闸的锁嘴句判据只认代词版 `her/his/its lips…`，而**我们自己规则要求的**
 *    是画面里出现别的角色时点名写 `<Subject K>'s lips remain completely closed`
 *    （见 voiceover-onscreen-gate.ts 文件头 sb437 事故）⇒ 稿子写对了反被判「没有锁嘴句」，
 *    自动修复两轮都改不掉（改成代词版反而违反另一条规则）。⇒ 两处共用一个判据。
 *
 * 跑法：cd backend && node --test tests/dialogue-punct-and-lip-lock.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { OFFICIAL_LIP_LOCK, findVoiceoverOnscreenLock } = await import('../src/services/voiceover-onscreen-gate.ts')
const { findVoiceoverMouthAction } = await import('../src/services/voiceover-gates.ts')

const EN = [
  'subject_definitions:',
  '<Subject 1> is Su Qinghe in <Picture 1>, black hair, grey-blue uniform.',
  '',
  'summary:',
  'The second uncle threatens Su Qinghe.',
  '',
  'retention_analysis:',
  "<Subject 1> (appears in every shot): fully_preserved - face and hair kept.",
  '',
  'detailed_description:',
  "[Shot 1] <Subject 2> says in an off-screen voiceover: <d>[Chinese] 识相点</d> while <Subject 1>'s lips remain completely closed.",
  "[Shot 2] At 00:04.000 Close-up of <Subject 1>.",
  '',
  'overall_soundscape:',
  'room tone.',
  '',
  'non_diegetic_music:',
  'low strings.',
].join('\n')

async function loadChecker() {
  const esbuild = await import('esbuild')
  const out = join(mkdtempSync(join(tmpdir(), 'hb-punct-')), 'bundle.mjs')
  await esbuild.build({
    entryPoints: [new URL('../src/services/prompt-check.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  })
  const mod = await import(out)
  rmSync(out, { force: true })
  return mod.checkStoryboardPrompt
}

test('台词以破折号收尾（被打断）= 合法，不再报 zh-dialogue-punct（sb486 原文）', async () => {
  const checkStoryboardPrompt = await loadChecker()
  const zh = '出场人物：@苏家二叔；@苏清禾。\n\n0-4秒：@苏家二叔说：「识相点，把苏家全部股权交出来——」话音落在他半步站定的姿势上。'
  const sb = { id: 486, storyboardNumber: 3, duration: 10, description: '【镜头1】二叔逼近，说台词。', videoPrompt: zh, videoPromptEn: EN }
  const issues = checkStoryboardPrompt(sb)
  assert.equal(issues.some(i => i.code === 'zh-dialogue-punct'), false,
    '破折号收尾属于合法标点，不该再报，实际：' + issues.map(i => i.code).join(','))
})

test('台词真的没标点收尾 → 照报，但标明「不可自动修复」（生成不会改台词原文）', async () => {
  const checkStoryboardPrompt = await loadChecker()
  const zh = '出场人物：@苏家二叔。\n\n0-4秒：@苏家二叔说：「我还能留你一条活路」'
  const sb = { id: 487, storyboardNumber: 4, duration: 10, description: '【镜头1】二叔说台词。', videoPrompt: zh, videoPromptEn: EN }
  const hit = checkStoryboardPrompt(sb).find(i => i.code === 'zh-dialogue-punct')
  assert.ok(hit, '裸收尾仍要报')
  assert.equal(hit.autoFixable, false, '这条只能改分镜描述，不能宣称可一键修复')
  assert.match(hit.message, /分镜描述/, '文案要告诉用户去哪儿改')
})

test('锁嘴句判据同时认「代词版」与「点名版」', () => {
  assert.ok(OFFICIAL_LIP_LOCK.test('while her lips remain completely closed.'))
  assert.ok(OFFICIAL_LIP_LOCK.test('while his lips remain completely closed.'))
  assert.ok(OFFICIAL_LIP_LOCK.test("while <Subject 2>'s lips remain completely closed."))
  assert.equal(OFFICIAL_LIP_LOCK.test('while no on-screen mouth moves, since nobody is in frame.'), false)
  assert.equal(OFFICIAL_LIP_LOCK.test('her lips do not move'), false)
})

test('接线断言：一致性闸用的是共用判据，不许再各写一份', () => {
  const src = readFileSync(new URL('../src/services/video-prompts.ts', import.meta.url), 'utf-8')
  // 2026-10-16（4.0.62）起：一致性闸只认**点名版**锁嘴句 —— 代词写法已作废（实测 sb509）
  assert.match(src, /<Subject \\d\+>'s lips\? remain completely closed/, '一致性闸必须要求点名版锁嘴句')
  assert.match(src, /代词写法 .*已作废|已作废/, '文案里要说明代词写法为什么被弃用')
  assert.doesNotMatch(src, /\(\?:her\|his\|its\)\\s\+lips\\s\+remain/, '旧的「只认代词版」正则必须删掉')
})

test('画外音锁嘴必须点名，代词写法不算（2026-10-16 实测 sb509：同一分镜点名那条嘴是闭的、代词那条旁白被念出来）', () => {
  const named = "[Shot 2] At 00:05.000, the camera cuts to a medium shot, completely still, holding <Subject 2>, the woman alone in frame. <Subject 2> (S1) says in an off-screen voiceover: <d>[Chinese] 你的仇恨，并未结束。</d> while <Subject 2>'s lips remain completely closed. The camera holds without shift."
  const pron = named.replace("while <Subject 2>'s lips remain completely closed.", 'while her lips remain completely closed.')
  assert.deepEqual(findVoiceoverOnscreenLock(named, [1, 2]), [], '点名版必须通过')
  const hit = findVoiceoverOnscreenLock(pron, [1, 2])
  assert.equal(hit.length, 1, '代词版必须命中 —— 画面里那个人没被点名锁嘴')
  assert.deepEqual(hit[0].onscreen, [2], '画面里的角色（含旁白者本人）都要出现在 onscreen 里')
  // 画面里没有任何角色（subject 号不在本分镜的角色清单里）→ 无需锁嘴
  assert.deepEqual(findVoiceoverOnscreenLock('[Shot 1] An empty corridor. <Subject 3> (S1) says in an off-screen voiceover: <d>x</d> while her lips remain completely closed.', [1, 2]), [])
})

test('画外音拍里不许写下颌/下巴动作（2026-10-16 实测 sb519：锁嘴句完全合规、成片仍读出台词）', () => {
  const real = "[Shot 3] At 00:07.000, the shot cuts to a chest-up close portrait of <Subject 2>. She keeps her eyes down; her chin dips a fraction. <Subject 2> (S1) says in an off-screen voiceover: <d>[Chinese] 二叔只是弃子，我的身世，还有第二层谎言。</d> while <Subject 2>'s lips remain completely closed."
  assert.equal(findVoiceoverMouthAction(real).length, 1, '下巴动作必须命中')
  assert.match(findVoiceoverMouthAction(real)[0].sample, /chin dips/i)
  // 光影/静态提到 jaw 不算动作（实测 sb509 那条成片嘴是闭的）
  const lighting = "[Shot 2] <Subject 2> (S1) says in an off-screen voiceover: <d>[Chinese] x</d> while <Subject 2>'s lips remain completely closed. Cold light lays one flat shape across her jaw."
  assert.deepEqual(findVoiceoverMouthAction(lighting), [], '只是打光提到下颌，不许误报')
  // 中文/其它写法
  const zh = "[Shot 1] <Subject 2> says in an off-screen voiceover: <d>[Chinese] x</d> while her lips remain completely closed, 下颌微收。"
  assert.equal(findVoiceoverMouthAction(zh).length, 1, '中文「下颌微收」也要命中')
  const jaw = "[Shot 1] <Subject 2> says in an off-screen voiceover: <d>[Chinese] x</d> while her lips remain completely closed, his jaw tightens."
  assert.equal(findVoiceoverMouthAction(jaw).length, 1, 'jaw tightens 要命中')
})

// 2026-10-17 实测（12集分镜9 / sb550）：旁白者写成角色短语 ⇒ H3 无从判断音色，用了画面里苏晚卿的音色
test('旁白者写成角色短语必须被拦（sb550 真实形状），点名写法不许误报', async () => {
  const { findNarratorRolePhrase } = await import('../src/services/voiceover-onscreen-gate.ts')
  const bad = 'A young adult female voice speaks as an off-screen narrator (S1): <d>[Chinese] 她心虚了。</d> '
    + "while <Subject 2>'s lips remain completely closed."
  const r = findNarratorRolePhrase(bad)
  assert.ok(r, '必须报错')
  assert.match(r, /off-screen narrator/i, '要报出抓到的那段短语')
  const good = "<Subject 3> (S1) says in an off-screen voiceover: <d>[Chinese] 她心虚了。</d> "
    + "while <Subject 2>'s lips remain completely closed."
  assert.equal(findNarratorRolePhrase(good), null, '点名写法必须放过')
})

