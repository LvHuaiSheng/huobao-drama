/**
 * 视频提示词「机械体检」——纯函数、零依赖、不调模型（2026-10-13）
 *
 * 用途：App 视频生产页的「体检」按钮（只查本集、只报不改、不写库）。
 * 判据全部对齐本仓生成侧的既有约束（services/video-prompts.ts 的六段 / 配额 / 拍数 / 时间轴口径），
 * 这里只做「数数与关键字比对」，不修改任何内容。
 * 保持零 import：既能被路由直接调用，也能单独用 node 跑单测。
 */

export type CheckLevel = 'error' | 'warn'

export interface CheckIssue {
  level: CheckLevel
  code: string
  message: string
}

export interface StoryboardCheckInput {
  id: number
  storyboardNumber?: number | null
  duration?: number | null
  description?: string | null
  videoPrompt?: string | null
  videoPromptEn?: string | null
}

export interface CheckOptions {
  /** 英文版软上限（默认 6200 = services/video-prompts.ts 的 PROMPT_EN_LIMIT） */
  enLimit?: number
  /** 英文版硬上限（默认 7000 = H3_PROMPT_HARD_LIMIT） */
  hardLimit?: number
}

const EN_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
]

const RE_CN_CHAR = /[\u4e00-\u9fff]/g
const RE_SHOT_HEADER = /^[ \t]*\[Shot \d+\]/gm
const RE_SHOT_ANY = /\[Shot \d+\]/g
const RE_ZH_BEAT = /^[ \t]*(\d+)[ \t]*-[ \t]*(\d+)[ \t]*秒[ \t]*[：:]/gm
const RE_ZH_LINE = /[：:][ \t]*「([^」]*)」/g
const RE_EN_AT = /\[Shot (\d+)\][^\n]*?\bAt[ \t]+(\d{1,2}):(\d{2})\.(\d{3})/g
const RE_EN_D = /<d>[ \t]*\[Chinese\][ \t]*([\s\S]*?)[ \t]*<\/d>/g
// 只匹配真正会让「画外音被念出来」的机位写法（真数据实测：「chin lifted」「jaw-level shot」
// 这类正常描写必须放过，否则每一条都会误报）
const RE_FACE_WORDS = /from the jaw down|below the jaw|jaw down|from the chin down|chin[ ,、]+neck[ ,、]+(?:collar|shoulders?)|chin and neck only|over[- ]the[- ]shoulder near|lips above the (?:top )?edge/i
const RE_HTML_ENTITY = /&(lt|gt|amp|quot|#\d+);/

function sectionRe(name: string): RegExp {
  return new RegExp('(^|\\n)[ \\t]*' + name + '[ \\t]*[:：]', 'g')
}

function count(re: RegExp, s: string): number {
  return (s.match(re) || []).length
}

function cnLen(s: string): number {
  return (s.match(RE_CN_CHAR) || []).length
}

/** 对单条分镜做体检，返回问题列表（空数组 = 通过） */
export function checkStoryboardPrompt(sb: StoryboardCheckInput, opts: CheckOptions = {}): CheckIssue[] {
  const enLimit = opts.enLimit ?? 6200
  const hardLimit = opts.hardLimit ?? 7000
  const out: CheckIssue[] = []

  const en = (sb.videoPromptEn || '').trim()
  const zh = (sb.videoPrompt || '').trim()
  const desc = (sb.description || '').trim()

  // ① 有没有英文发送版（没有就会被硬保护直接拒发）
  if (!en) {
    out.push({
      level: 'error',
      code: 'no-en',
      message: '没有英文发送版（video_prompt_en）——点「生成视频」会被直接拒绝，请先用「批量补齐提示词」重新生成',
    })
    return out
  }

  // ② 官方六段是否齐全
  const missing = EN_SECTIONS.filter(s => count(sectionRe(s), en) === 0)
  if (missing.length) {
    out.push({ level: 'error', code: 'section-missing', message: '英文版缺段落：' + missing.join('、') })
  }
  const dup = EN_SECTIONS.filter(s => count(sectionRe(s), en) > 1)
  if (dup.length) {
    out.push({ level: 'warn', code: 'section-dup', message: '英文版段落重复出现：' + dup.join('、') })
  }

  // ③ 长度
  if (en.length > hardLimit) {
    out.push({
      level: 'error',
      code: 'too-long-hard',
      message: `英文版 ${en.length} 字符，超过硬上限 ${hardLimit}（生成时会被截断或打回重写）`,
    })
  } else if (en.length > enLimit) {
    out.push({ level: 'warn', code: 'too-long', message: `英文版 ${en.length} 字符，超过软上限 ${enLimit}` })
  }

  // ④ 拍数：中文描述【镜头】= 中文工作版拍数 = 英文 [Shot N] 拍头数
  const descBeats = count(/【镜头/g, desc)
  const enHeads = count(RE_SHOT_HEADER, en)
  const zhBeats = count(RE_ZH_BEAT, zh)

  if (descBeats && zhBeats !== descBeats) {
    out.push({
      level: 'error',
      code: 'zh-beat-mismatch',
      message: `中文工作版 ${zhBeats} 拍，与描述里的 ${descBeats} 个【镜头】不一致`,
    })
  }
  if (descBeats && enHeads !== descBeats) {
    out.push({
      level: 'error',
      code: 'en-beat-mismatch',
      message: `英文版 ${enHeads} 个 [Shot N]，与描述里的 ${descBeats} 个【镜头】不一致（成片会多切一刀或少一拍）`,
    })
  } else if (!descBeats && zhBeats && enHeads !== zhBeats) {
    out.push({
      level: 'warn',
      code: 'en-zh-beat-mismatch',
      message: `英文版 ${enHeads} 拍，与中文工作版 ${zhBeats} 拍不一致`,
    })
  }

  // ⑤ 中英时间轴逐拍对齐
  const zhRanges = [...zh.matchAll(RE_ZH_BEAT)].map(m => ({ start: Number(m[1]), end: Number(m[2]) }))
  const enAts = [...en.matchAll(RE_EN_AT)].map(m => Number(m[2]) * 60 + Number(m[3]))
  if (zhRanges.length) {
    const want = zhRanges.slice(1).map(r => r.start)
    if (enAts.length !== want.length) {
      out.push({
        level: 'warn',
        code: 'timeline-count',
        message: `英文版带时间戳 ${enAts.length} 处，按中文 ${zhRanges.length} 拍应为 ${want.length} 处（第 1 拍不带时间戳）`,
      })
    } else {
      const bad = want
        .map((s, i) => (enAts[i] === s ? null : `第 ${i + 2} 拍：中文 ${s}s / 英文 ${enAts[i]}s`))
        .filter((x): x is string => !!x)
      if (bad.length) {
        out.push({ level: 'error', code: 'timeline-mismatch', message: '中英时间轴对不上 → ' + bad.slice(0, 3).join('；') })
      }
    }
  }

  // ⑦ 台词条数：中英必须一致（H3 只吃英文版）
  // ⚠️ 中文工作版末尾常有「（两句旁白逐字取自…：第一句…）」这种自标注，里面的引号会被误当台词
  //    → 先剥掉全角括号里的整段，再数
  const zhBody = zh.replace(/（[^）]*）/g, '')
  const enLines = [...en.matchAll(RE_EN_D)].map(m => m[1].trim()).filter(Boolean)
  const zhLines = [...zhBody.matchAll(RE_ZH_LINE)].map(m => m[1].trim()).filter(Boolean)
  if (zhLines.length && enLines.length !== zhLines.length) {
    out.push({
      level: 'error',
      code: 'dialogue-count',
      message: `英文版 ${enLines.length} 句台词，与中文工作版 ${zhLines.length} 句不一致（成片说的和你看的对不上）`,
    })
  }

  // ⑧ 中文台词末尾必须收标点（否则解码器吞最后一个字）
  const noPunct = zhLines.filter(t => !/[。！？…!?]$/.test(t))
  if (noPunct.length) {
    out.push({
      level: 'warn',
      code: 'zh-dialogue-punct',
      message:
        `中文台词 ${noPunct.length} 句末尾没收标点（最后一个字会被吞掉）：` +
        noPunct.slice(0, 2).map(t => `「${t.slice(0, 10)}」`).join('、'),
    })
  }

  // ⑨ 逐拍台词预算：每一拍台词字数 ≤ 该拍秒数 × 4.5（超了会念不完、拖到下一拍）
  if (zhRanges.length >= 2) {
    const blocks = en.split(/(?=^[ \t]*\[Shot \d+\])/m).filter(b => /^[ \t]*\[Shot \d+\]/.test(b))
    const over = blocks
      .map((b, i) => {
        const r = zhRanges[i]
        if (!r) return null
        const chars = [...b.matchAll(RE_EN_D)].reduce((n, m) => n + cnLen(m[1]), 0)
        if (!chars) return null
        const budget = Math.floor((r.end - r.start) * 4.5)
        return chars > budget ? `第 ${i + 1} 拍 ${chars} 字 / 上限 ${budget} 字（${r.end - r.start} 秒）` : null
      })
      .filter((x): x is string => !!x)
    if (over.length) {
      out.push({ level: 'warn', code: 'dialogue-over-budget', message: '台词可能念不完（会拖到下一拍）→ ' + over.slice(0, 3).join('；') })
    }
  }

  // ⑩ HTML 转义（H3 不认识 <Subject N>，身份绑定会直接失效）
  if (RE_HTML_ENTITY.test(en)) {
    out.push({
      level: 'error',
      code: 'html-entity',
      message: '出现 HTML 转义（&lt; / &gt; / &amp; 等）——H3 不认识 <Subject N>，身份绑定会失效',
    })
  }

  // ⑪ 画外音那拍写了「下巴/嘴入画」类机位（旁白会被对着嘴念出来）
  const faceHit = (en.match(RE_FACE_WORDS) || [])[0]
  if (faceHit) {
    out.push({
      level: 'warn',
      code: 'face-in-voiceover-shot',
      message: `出现「${faceHit}」这类让下巴或嘴入画的写法——画外音那拍可能被念出来（对口型）`,
    })
  }

  return out
}

export function summarizeChecks(items: Array<{ issues: CheckIssue[] }>) {
  const errorCount = items.reduce((n, it) => n + it.issues.filter(i => i.level === 'error').length, 0)
  const warnCount = items.reduce((n, it) => n + it.issues.filter(i => i.level === 'warn').length, 0)
  return {
    total: items.length,
    badCount: items.filter(it => it.issues.length).length,
    errorCount,
    warnCount,
  }
}
