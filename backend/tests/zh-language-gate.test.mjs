/**
 * 语言闸回归测试（2026-10-15）
 *
 * 事故：批量/一键修复时模型把**英文**写进了中文工作版字段 `video_prompt`（实测 sb465：
 * 5763 字符全英文落库 → 用户看到「中文分镜描述变成英文」），而流程里没有任何一处校验
 * 「这一份必须是中文」。修法两处收口：
 *   ① 生成侧 `generateZhPrompt`：整篇不是中文 → 重试并点名「你写错语言了」；3 次仍不是中文 → 返回空串
 *      （调用方判该条失败、一个字都不落库，旧中文稿原样保留）。
 *   ② 写入侧 `filterPromptAgentFields`：Agent 自己回传的 `video_prompt` 非中文 → 丢弃。
 *
 * 跑法：cd backend && node --test tests/zh-language-gate.test.mjs
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

// ── ① 纯判据函数：直接跑真代码（zh-lang.ts 零依赖，node 能直接 import TS） ──────
const { looksLikeChinese, countChinese, zhDialogueLines, stripZhPreamble } = await import('../src/services/zh-lang.ts')

test('zhDialogueLines / stripZhPreamble：与体检同口径 + 砍掉模型前言', () => {
  // 内容侧：模型把台词写成「…吐字平稳：「台词」」（没有「说」字）也要数出来（实测 sb466/467 形态）
  const zh466 = '0-4秒：她脖子定、吐字平稳：「所有人都以为那是意外。」\n6-9秒：声音发颤但字字咬实：「可我查清楚了——有人蓄意策划那场车祸。」'
  assert.equal(zhDialogueLines(zh466).length, 2)
  // 画面内文字用双引号，不会被当台词（本管线约定）
  assert.equal(zhDialogueLines('画面左侧木质招牌上写着"老张面馆"四个字').length, 0)
  // 生成侧闸与体检必须共用同一个谓词
  const gate = read('src/services/video-prompts.ts')
  const check = read('src/services/prompt-check.ts')
  assert.match(gate, /const zhLines = zhDialogueLines\(zhPrompt\)\.length/)
  assert.match(check, /const zhLines = zhDialogueLines\(zhBody\)/)
  assert.doesNotMatch(check, /RE_ZH_LINE/)

  // 前言：整段英文闲聊 + 正文 → 砍到「出场人物：」；只有正文时原样返回
  const withPre = 'I\'ll start by reading the storyboard context for shot #2. I have the context — 4 【镜头N】 → exactly 4 beats.\n\n出场人物：@苏清禾；场景：@宴会厅中央。\n\n0-4秒：@宴会厅中央，中景机位静止。'
  const cut = stripZhPreamble(withPre)
  assert.ok(cut.startsWith('出场人物：'), cut.slice(0, 30))
  assert.ok(!cut.includes('storyboard context'))
  const clean = '出场人物：@苏清禾；场景：@宴会厅中央。\n\n0-4秒：中景机位静止。'
  assert.equal(stripZhPreamble(clean), clean)
  // 没有「出场人物」时兜底认第一拍
  assert.ok(stripZhPreamble('前言前言前言。0-4秒：中景机位静止。').startsWith('0-4秒：'))
})

test('looksLikeChinese 认中文工作版、挡整篇英文', () => {
  // 真实中文工作版（含 @角色名 / 秒数这类 ASCII，中文仍占多数）
  const zh = '出场人物：@林巧；场景：@二车间门口。\n0-2秒：@二车间门口，中景固定机位，清晨冷调侧逆光。\n2-5秒：镜头切到手部大特写。'
  assert.equal(looksLikeChinese(zh), true)
  // 事故原文形态：整篇英文（含 <Picture 1> / <Subject 1> 这类标记）
  const en = 'subject_definitions:\n<Subject 1> is the banquet hall in <Picture 1>, with a crystal chandelier drawn as simplified geometric colour blocks at the ceiling centre.'
  assert.equal(looksLikeChinese(en), false)
  // 英文里夹两个汉字 → 仍判非中文（防「英文为主、点缀汉字」蒙混）
  assert.equal(looksLikeChinese('shot 1: the woman stands，中等 shot，cold light，medium shot，no dialogue，hand close-up'), false)
  assert.equal(looksLikeChinese(''), false)
  assert.equal(looksLikeChinese('   \n  '), false)
  // 极短中文（老规矩：别把短句误杀）
  assert.equal(looksLikeChinese('无任何人声'), true)
  assert.equal(countChinese('中文abc'), 2)
})

// ── ② 写入侧收口：Agent 回传的非中文 video_prompt 必须被丢弃（跑真代码） ────────
test('filterPromptAgentFields 丢弃非中文 video_prompt，保留中英各自正确的值', async () => {
  const esbuild = await import('esbuild')
  const out = join(mkdtempSync(join(tmpdir(), 'hb-lang-')), 'bundle.mjs')
  await esbuild.build({
    entryPoints: [new URL('../src/agents/tools/prompt-agent-fields.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  })
  const { filterPromptAgentFields } = await import(out)
  rmSync(out, { force: true })

  const zh = '0-2秒：@二车间门口，中景固定机位，清晨冷调侧逆光，光线清冷克制。'
  const en = '<Subject 1> is the scene in <Picture 1>, a 1975 machine-plant exterior.'

  // 正常：两个字段都放行，其他键一律丢
  let r = filterPromptAgentFields({ storyboard_id: 465, video_prompt: zh, video_prompt_en: en, description: '改我' })
  assert.deepEqual(Object.keys(r.filtered).sort(), ['storyboard_id', 'video_prompt', 'video_prompt_en'])
  assert.deepEqual(r.dropped, ['description'])

  // 事故形态：中文槽位收到英文 → 丢弃并留痕（英文槽位照旧保留）
  r = filterPromptAgentFields({ storyboard_id: 465, video_prompt: en, video_prompt_en: en })
  assert.equal('video_prompt' in r.filtered, false)
  assert.ok(r.dropped.includes('video_prompt:not-chinese'), `dropped=${r.dropped}`)
  assert.equal(r.filtered.video_prompt_en, en)

  // 空字符串不算「写错语言」（保持原行为，交给落库判空）
  r = filterPromptAgentFields({ storyboard_id: 1, video_prompt: '  ' })
  assert.equal(r.filtered.video_prompt, '  ')
  assert.deepEqual(r.dropped, [])
})

// ── ③ 生成侧收口的结构断言（真代码在 video-prompts.ts 里，靠结构锁住不变量） ────
test('generateZhPrompt 有语言闸且非中文时返回空串；压缩指令传的是 current', () => {
  const svc = read('src/services/video-prompts.ts')

  // 语言闸：非中文 → 重试留痕 → 最终不返回英文
  assert.match(svc, /zh-not-chinese-retry/)
  assert.match(svc, /if \(!looksLikeChinese\(last\)\) \{[\s\S]{0,120}langWrong = true/)
  assert.match(svc, /return looksLikeChinese\(last\) \? last : ''/)

  // 🔴 压缩指令的字段名必须是 current（原来传 cur → ORIGINAL 段全是字面量 undefined，整轮压缩白跑）
  assert.match(svc, /return \{ stage, current: cur, problem: String\(groupProblem\(cur, stage\) \|\| ''\) \}/)
  assert.doesNotMatch(svc, /return \{ stage, cur, problem/)
  // 该字段名与 buildRewriteMultiPrompt 的读取方一致
  assert.match(svc, /const bodies = items\.map\(it => `=== ORIGINAL: \$\{it\.stage\.segs\.map\(s => s\.replace\(':', ''\)\)\.join\(' \/ '\)\} ===\\n\$\{it\.current\}`\)/)
})
