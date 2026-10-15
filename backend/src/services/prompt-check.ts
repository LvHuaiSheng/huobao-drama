/**
 * 视频提示词「机械体检」v2 —— 纯函数、零依赖、不调模型（2026-10-13 用户拍板升级）
 *
 * v2 相比 v1：
 *  ① 每条问题带「位置 / 是否阻断 / 能否靠重写修 / 指纹（可忽略）」——对标社区 diagnosticReport 的做法
 *  ② 新增「参考素材预检」：参考图顺序、缺图、缺卡、编号越界、该绑没绑、有声音卡没写 <Audio N>
 *  ③ 新增 buildRepairNotes()：把问题翻成可直接塞进「补充说明」的修法清单（一键修复用）
 * 判据全部对齐本仓生成侧约束；不做任何内容改写、不写库。
 */

// 台词判据与生成侧闸（services/video-prompts.ts 的 zhEnConsistency）共用同一个纯函数 ——
// 两边用不同谓词会给出相反结论（2026-10-15 实测 sb466/467）。zh-lang 零依赖，本文件「纯函数、零依赖」的性质不变。
import { zhDialogueLines } from './zh-lang.js'

export type CheckLevel = 'error' | 'warn'

export interface CheckIssue {
  level: CheckLevel
  code: string
  /** 问题出在哪（段落名 / 第几拍 / 哪一行 / 参考图序号） */
  location: string
  message: string
  /** true = 会让生成被拒或必然出穿帮，必须处理 */
  blocking: boolean
  /** true = 带着修法清单重写一次就能修（false = 要动素材或改分镜描述） */
  autoFixable: boolean
  /** 稳定指纹：前端用它记住「这条我忽略」 */
  fingerprint: string
}

export interface MediaRef {
  picture: number
  kind: 'scene' | 'character' | 'prop'
  id: number
  name: string
  /** 资产图是否已生成 */
  hasImage: boolean
  /** RefMod 身份卡是否已抽好 */
  hasCard: boolean
  /** 仅角色：声音卡是否已抽好 */
  hasVoiceCard?: boolean
}

export interface MediaContext {
  refs: MediaRef[]
  /** 参考图槽位上限（默认 9） */
  slotLimit?: number
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
  /** 参考素材上下文（不传则跳过素材类检查） */
  media?: MediaContext
}

const EN_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
]

/**
 * 逐拍台词密度上限（字/秒）—— 2026-10-15 由 4.5 提到 6，用户当天拍板。
 *
 * 4.5 是生成侧规则里的「建议值」（`(段长−4)×4.5` 那一套推出来的），当体检警戒线太吵：
 * 全库 102 条带英文版的分镜里命中 **14 条（14%）**，其中大半是 5.33 字/秒 —— 而 H3 中文旁白
 * **实测语速 5~6 字/秒**（见 `video-prompt` 技能的逐拍预算条），用户在成片里也确认这类念得完。
 * 提到 6 之后全库只剩 **3 条**（6.0~6.3 字/秒，比语速上限还快 → 会被念快或吃掉字），当兜底保留。
 * ⚠️ 这是**体检阈值**，生成侧规则（逐拍预算 ≤ 秒数×4.5）不动 —— 那边是「建议值」，改的是它才影响写法。
 */
const ZH_DIALOGUE_RATE_LIMIT = 6

const RE_CN_CHAR = /[\u4e00-\u9fff]/g
const RE_SHOT_HEADER = /^[ \t]*\[Shot \d+\]/gm
const RE_ZH_BEAT = /^[ \t]*(\d+)[ \t]*-[ \t]*(\d+)[ \t]*秒[ \t]*[：:]/gm
const RE_EN_AT = /\[Shot (\d+)\][^\n]*?\bAt[ \t]+(\d{1,2}):(\d{2})\.(\d{3})/g
const RE_EN_D = /<d>[ \t]*\[Chinese\][ \t]*([\s\S]*?)[ \t]*<\/d>/g
// 只匹配真正会让「画外音被念出来」的机位写法（真数据实测：「chin lifted」「jaw-level shot」这类正常描写必须放过）
const RE_FACE_WORDS = /from the jaw down|below the jaw|jaw down|from the chin down|chin[ ,、]+neck[ ,、]+(?:collar|shoulders?)|chin and neck only|over[- ]the[- ]shoulder near|lips above the (?:top )?edge/i
const RE_HTML_ENTITY = /&(lt|gt|amp|quot|#\d+);/

function sectionRe(name: string): RegExp {
  return new RegExp('(^|\\n)[ \\t]*' + name + '[ \\t]*[:：]', 'g')
}

/** 取 detailed_description 段正文（拍头应只在这里出现；到下一个段名为止） */
function enDetailSection(en: string): string {
  const m = en.match(/detailed_description:([\s\S]*?)(?:\n[a-z_]+:|$)/)
  return m ? m[1] : ''
}

/** 英文版拍头数（2026-10-13 修口径）：只数 detailed_description 段内的 `[Shot N]`。
 *  为什么：① retention_analysis 里的 `(appears in [Shot 1], …)` 是引用、不是拍头，全文数会把拍数数虚高；
 *  ② 旧实现按「行首」计数，遇到「拍头挤在同一行」的产出会数成 0（实测 id=385：写了 3 拍却报 0）。
 *  段内计数两头都躲开：引用不在这一段，拍头无论换不换行都算。 */
function countEnBeatsInDetail(en: string): number {
  return count(/\[Shot \d+\]/g, enDetailSection(en))
}

/** 拍头是否没独占一行（有 [Shot N] 却不在行首）——格式问题，另外报警 */
function countEnBeatsNotAnchored(en: string): number {
  const sec = enDetailSection(en)
  return count(/\[Shot \d+\]/g, sec) - count(/^[ \t]*\[Shot \d+\]/gm, sec)
}

function count(re: RegExp, s: string): number {
  return (s.match(re) || []).length
}

function cnLen(s: string): number {
  return (s.match(RE_CN_CHAR) || []).length
}

/** 稳定指纹（FNV-1a，32 位）：同一条问题每次算出来一样，前端用它记住「忽略」 */
function fingerprint(code: string, location: string): string {
  const s = code + '|' + location
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

interface RawIssue {
  level: CheckLevel
  code: string
  location?: string
  message: string
  blocking?: boolean
  autoFixable?: boolean
}

function mk(i: RawIssue): CheckIssue {
  const location = i.location || ''
  return {
    level: i.level,
    code: i.code,
    location,
    message: i.message,
    blocking: i.blocking ?? i.level === 'error',
    autoFixable: i.autoFixable ?? true,
    fingerprint: fingerprint(i.code, location),
  }
}

/** 对单条分镜做体检，返回问题列表（空数组 = 通过） */
export function checkStoryboardPrompt(sb: StoryboardCheckInput, opts: CheckOptions = {}): CheckIssue[] {
  const enLimit = opts.enLimit ?? 6200
  const hardLimit = opts.hardLimit ?? 7000
  const out: CheckIssue[] = []

  const en = (sb.videoPromptEn || '').trim()
  const zh = (sb.videoPrompt || '').trim()
  const desc = (sb.description || '').trim()

  // ① 有没有英文发送版（没有会被硬保护直接拒发）
  if (!en) {
    out.push(mk({
      level: 'error', code: 'no-en', location: '整条',
      message: '没有英文发送版（video_prompt_en）——点「生成视频」会被直接拒绝，先点「重新生成」',
    }))
    return out
  }

  // ② 官方六段是否齐全
  const missing = EN_SECTIONS.filter(s => count(sectionRe(s), en) === 0)
  if (missing.length) {
    out.push(mk({
      level: 'error', code: 'section-missing', location: '整条',
      message: '英文版缺段落：' + missing.join('、'),
    }))
  }
  const dup = EN_SECTIONS.filter(s => count(sectionRe(s), en) > 1)
  if (dup.length) {
    out.push(mk({
      level: 'warn', code: 'section-dup', location: '整条',
      message: '英文版段落重复出现：' + dup.join('、'),
    }))
  }

  // ③ 长度
  if (en.length > hardLimit) {
    out.push(mk({
      level: 'error', code: 'too-long-hard', location: '整条',
      message: `英文版 ${en.length} 字符，超过硬上限 ${hardLimit}（会被截断或打回重写）`,
    }))
  } else if (en.length > enLimit) {
    out.push(mk({
      level: 'warn', code: 'too-long', location: '整条',
      message: `英文版 ${en.length} 字符，超过软上限 ${enLimit}`,
    }))
  }

  // ④ 拍数：中文描述【镜头】= 中文工作版拍数 = 英文 [Shot N] 拍头数
  const descBeats = count(/【镜头/g, desc)
  const enHeads = countEnBeatsInDetail(en)
  const zhBeats = count(RE_ZH_BEAT, zh)

  if (descBeats && zhBeats !== descBeats) {
    out.push(mk({
      level: 'error', code: 'zh-beat-mismatch', location: '中文工作版',
      message: `中文工作版 ${zhBeats} 拍，与描述里的 ${descBeats} 个【镜头】不一致`,
      autoFixable: false,
    }))
  }
  if (descBeats && enHeads !== descBeats) {
    out.push(mk({
      level: 'error', code: 'en-beat-mismatch', location: 'detailed_description',
      message: `英文版 ${enHeads} 个 [Shot N]，与描述里的 ${descBeats} 个【镜头】不一致（成片会多切一刀或少一拍）`,
    }))
  } else if (!descBeats && zhBeats && enHeads !== zhBeats) {
    out.push(mk({
      level: 'warn', code: 'en-zh-beat-mismatch', location: 'detailed_description',
      message: `英文版 ${enHeads} 拍，与中文工作版 ${zhBeats} 拍不一致`,
    }))
  }

  // ④b 拍头没独占一行（2026-10-13 加）：能切但格式不合规 —— 实测 id=385 整段挤成一行
  const notAnchored = countEnBeatsNotAnchored(en)
  if (notAnchored > 0) {
    out.push(mk({
      level: 'warn', code: 'shot-header-not-line-start', location: 'detailed_description',
      message: `有 ${notAnchored} 个 [Shot N] 拍头夹在正文里（没独占一行）—— H3 按 [Shot N] 切拍，拍头独占一行才稳`,
    }))
  }

  // ⑤ 中英时间轴逐拍对齐
  const zhRanges = [...zh.matchAll(RE_ZH_BEAT)].map(m => ({ start: Number(m[1]), end: Number(m[2]) }))
  const enAts = [...en.matchAll(RE_EN_AT)].map(m => Number(m[2]) * 60 + Number(m[3]))
  if (zhRanges.length) {
    const want = zhRanges.slice(1).map(r => r.start)
    if (enAts.length !== want.length) {
      out.push(mk({
        level: 'warn', code: 'timeline-count', location: 'detailed_description',
        message: `英文版带时间戳 ${enAts.length} 处，按中文 ${zhRanges.length} 拍应为 ${want.length} 处（第 1 拍不带时间戳）`,
      }))
    } else {
      const bad = want
        .map((s, i) => (enAts[i] === s ? null : `第 ${i + 2} 拍：中文 ${s}s / 英文 ${enAts[i]}s`))
        .filter((x): x is string => !!x)
      if (bad.length) {
        out.push(mk({
          level: 'error', code: 'timeline-mismatch', location: 'detailed_description',
          message: '中英时间轴对不上 → ' + bad.slice(0, 3).join('；'),
        }))
      }
    }
  }

  // ⑥ 台词条数：中英必须一致（H3 只吃英文版）
  // 中文工作版末尾常有「（两句旁白逐字取自…）」这类自标注，里面的引号会被误当台词 → 先剥掉全角括号
  const zhBody = zh.replace(/（[^）]*）/g, '')
  const enLines = [...en.matchAll(RE_EN_D)].map(m => m[1].trim()).filter(Boolean)
  const zhLines = zhDialogueLines(zhBody)
  if (zhLines.length && enLines.length !== zhLines.length) {
    out.push(mk({
      level: 'error', code: 'dialogue-count', location: 'detailed_description',
      message: `英文版 ${enLines.length} 句台词，与中文工作版 ${zhLines.length} 句不一致（成片说的和你看的对不上）`,
    }))
  }

  // ⑦ 中文台词末尾必须收标点（否则解码器吞最后一个字）
  const noPunct = zhLines.filter(t => !/[。！？…!?]$/.test(t))
  if (noPunct.length) {
    out.push(mk({
      level: 'warn', code: 'zh-dialogue-punct', location: '中文工作版',
      message:
        `中文台词 ${noPunct.length} 句末尾没收标点（最后一个字会被吞掉）：` +
        noPunct.slice(0, 2).map(t => `「${t.slice(0, 10)}」`).join('、'),
    }))
  }

  // ⑧ 逐拍台词预算：每一拍台词字数 ≤ 该拍秒数 × 4.5
  if (zhRanges.length >= 2) {
    const blocks = en.split(/(?=^[ \t]*\[Shot \d+\])/m).filter(b => /^[ \t]*\[Shot \d+\]/.test(b))
    const over = blocks
      .map((b, i) => {
        const r = zhRanges[i]
        if (!r) return null
        const chars = [...b.matchAll(RE_EN_D)].reduce((n, m) => n + cnLen(m[1]), 0)
        if (!chars) return null
        const budget = Math.floor((r.end - r.start) * ZH_DIALOGUE_RATE_LIMIT)
        return chars > budget ? `第 ${i + 1} 拍 ${chars} 字 / 上限 ${budget} 字（${r.end - r.start} 秒 ≈ ${(chars / (r.end - r.start)).toFixed(1)} 字/秒）` : null
      })
      .filter((x): x is string => !!x)
    if (over.length) {
      out.push(mk({
        level: 'warn', code: 'dialogue-over-budget', location: 'detailed_description',
        message: '台词比 H3 的实测语速还快（可能被念快或吃掉字）→ ' + over.slice(0, 3).join('；'),
        // 不喂给「一键修复」：模型改不动自己的时间轴（要把台词拆到别的拍才有效），
        // 历史实测每轮都改不掉、白烧一轮约 45 秒。真要收紧就改生成侧规则（见 SKILL 的逐拍预算条）。
        autoFixable: false,
      }))
    }
  }

  // ⑨b 英文版混入中文字符（2026-10-13 实测：40 条里 13 条中招，全在 retention_analysis 标注里）
  // 起因 = 中文侧规则写「标注用中文写」没限定版本 → 模型中英同产，把中文标注抄进了英文版。
  // 已知危害：中文会被 H3 当台词念（shim 代码里有 2026-10-09 实测记录）。
  const enNoDialogue = en.replace(/<d>[\s\S]*?<\/d>/g, '')
  const cnChars = enNoDialogue.match(/[\u4e00-\u9fff]/g) || []
  if (cnChars.length) {
    const idx = enNoDialogue.search(/[\u4e00-\u9fff]/)
    const heads = enNoDialogue.slice(0, idx).match(/^([a-z_]+):/gm)
    const loc = heads && heads.length ? heads[heads.length - 1].replace(':', '') : '整条'
    const sample = (enNoDialogue.slice(idx).match(/^[^\n]{0,24}/) || [''])[0]
    out.push(mk({
      level: 'error', code: 'en-has-chinese', location: loc,
      message: `英文版里混入 ${cnChars.length} 个中文字符（除 <d> 台词与画面文字外不许有中文）→ 例：${sample} —— 中文会被 H3 当台词念，标注必须写英文`,
    }))
  }

  // ⑨ HTML 转义（H3 不认识 <Subject N>，身份绑定会直接失效）
  if (RE_HTML_ENTITY.test(en)) {
    out.push(mk({
      level: 'error', code: 'html-entity', location: '整条',
      message: '出现 HTML 转义（&lt; / &gt; / &amp; 等）——H3 不认识 <Subject N>，身份绑定会失效',
    }))
  }

  // ⑩ 画外音那拍写了「下巴/嘴入画」类机位（旁白会被对着嘴念出来）
  const faceHit = (en.match(RE_FACE_WORDS) || [])[0]
  if (faceHit) {
    out.push(mk({
      level: 'warn', code: 'face-in-voiceover-shot', location: 'detailed_description',
      message: `出现「${faceHit}」这类让下巴或嘴入画的写法——画外音那拍可能被念出来（对口型）`,
    }))
  }

  // ⑪ 参考素材预检（v2 新增）
  const media = opts.media
  if (media && Array.isArray(media.refs)) {
    const slotLimit = media.slotLimit ?? 9
    const refs = media.refs

    if (refs.length > slotLimit) {
      out.push(mk({
        level: 'warn', code: 'media-slot-overflow', location: '参考素材',
        message: `参考图 ${refs.length} 张，超过槽位上限 ${slotLimit}`,
        autoFixable: false,
      }))
    }

    const maxPicture = Math.max(0, ...[...en.matchAll(/<Picture (\d+)>/g)].map(m => Number(m[1])))
    if (maxPicture > refs.length) {
      out.push(mk({
        level: 'error', code: 'media-picture-out-of-range', location: 'subject_definitions',
        message: `正文用了 <Picture ${maxPicture}>，但这条分镜只有 ${refs.length} 张参考图（编号越界 = 身份/场景错配）`,
      }))
    }

    // 2026-10-13 实测新增：正文给「没被提取成道具资产」的东西编了 <Subject N>（抹布/手机架/夹子/食物…）
    // 诱因 = 规则「手持物必须有参考图」被误读成「那就自己造一个主体编号」；40 条真数据里 9 条中招
    const subjNums = [...new Set([...en.matchAll(/<Subject (\d+)>/g)].map(m => Number(m[1])))]
    const overSubj = subjNums.filter(n => n > refs.length).sort((a, b) => a - b)
    if (overSubj.length) {
      const detail = overSubj
        .map(n => {
          const m = en.match(new RegExp('<Subject ' + n + '> is ([^\\.]{0,36})'))
          return '<Subject ' + n + '>' + (m ? ' = ' + m[1].trim() : '')
        })
        .join('；')
      out.push(mk({
        level: 'error', code: 'media-subject-out-of-range', location: 'subject_definitions',
        message: `正文编了 ${overSubj.length} 个没有参考图的主体（本分镜只有 ${refs.length} 张参考图）→ ${detail} —— 这些东西没被提取成道具资产，必须当画面元素用普通名词写、不许编号`,
      }))
    }

    for (const r of refs) {
      const label = `${r.kind === 'scene' ? '场景' : r.kind === 'character' ? '角色' : '道具'}「${r.name}」`
      if (!r.hasImage) {
        out.push(mk({
          level: 'error', code: 'media-no-image', location: `参考图 ${r.picture}`,
          message: `${label}没有资产图 —— 这张参考图是空的，视频里锁不住`,
          autoFixable: false,
        }))
      }
      if (!new RegExp('<Subject ' + r.picture + '>').test(en)) {
        out.push(mk({
          level: 'error', code: 'media-missing-subject', location: `参考图 ${r.picture}`,
          message: `${label}在正文里没有对应的 <Subject ${r.picture}> —— 不定妆（脸/形状会漂）`,
        }))
      }
      if (r.kind === 'character') {
        if (!r.hasCard) {
          out.push(mk({
            level: 'warn', code: 'media-no-identity-card', location: `参考图 ${r.picture}`,
            message: `${label}还没抽身份卡 —— 只有参考图、没有卡，脸更容易漂`,
            autoFixable: false,
          }))
        }
        // 2026-10-15 去掉 `media-no-audio-decl`（原来是「有声音卡但正文没写 <Audio N>」的告警）：
        //   ① 声音卡（.safetensors）2026-10-11 已废 —— 中转侧改成「App 直发 wav → 按落盘 wav 名接线
        //      + 反查图片卡槽位自动补 `<Audio j>` 声明」，且补之前先 `have = set(re.findall(r"<Audio (\d+)>"))`
        //      去重 ⇒ 正文不写也保证有声明、写了也不会重复（已读线上 shim 源码确认）。
        //   ② 生成侧 `has_voice_card`（`agents/tools/storyboard-tools.ts` 的 readVoiceCardInfo）判据是
        //      **旧声音卡文件在不在** → 自 10-11 起恒为 false，模型本来就不会写；而体检按「源 wav 在不在」
        //      判断 → 两边口径相反 ⇒ 一键修复带着「必须写 <Audio N>」的修法清单去修，模型的上下文却写着
        //      `has_voice_card: false`（实测 sb466 的自述原文）→ **每条白烧修复轮次、告警永不消失**
        //      （2026-10-15 ep21 实测 6 条）。
        //   ③ 真正的 `<Audio j>` 由中转注入、索引由它自己算（j = 音频槽位；App 只发一条 wav ⇒ j=1），
        //      比让模型猜编号可靠 ⇒ 不再作为告警。`hasVoiceCard` 字段保留（数据还在，只是不报警）。
      }
    }
  }

  return out
}

/** 二选一（「或 / 或者 / 皆可 / 任选 / 亦可 / 均可」）机械体检（2026-10-14 加，用户拍板 A）
 *
 *  为什么查：外观类字段（角色 appearance/styling、场景 prompt/lighting、道具 description）是**最终事实源** ——
 *  生图 `final_prompt` 由它们生成、视频 `verbatim_lock` 原文照抄。写「黑色或蓝色西装」= 让模型每次随机挑一个，
 *  同一角色跨图跨镜头不一致（实测全库 23 个角色里 6 个中招）。
 *
 *  判据：**按句切分**（。；换行），句内有二选一词且**没有否定词**才算命中。
 *  否定词 = 排他说明，属于正确用法，必须放过（「画面中不出现任何文字、水印或签名」
 *  「没有手、手指、手臂、人物或任何场景环境」「无任何身影、剪影、倒影中的人或照片里的人」）。
 */
export function findAlternatives(text: string): { count: number; samples: string[] } {
  if (!text) return { count: 0, samples: [] }
  const ALT = /或者|或(?=[\u4e00-\u9fff])|皆可|任选|亦可|均可/
  const NEG = /不出现|没有|不含|不得|禁止|无任何|不许|不要|不能|勿|未出现|杜绝/
  const samples: string[] = []
  for (const sentence of text.split(/[。；;\n]/)) {
    const s = sentence.trim()
    if (!s || !ALT.test(s) || NEG.test(s)) continue
    samples.push(s.length > 80 ? s.slice(0, 80) + '…' : s)
  }
  return { count: samples.length, samples: samples.slice(0, 3) }
}

export function summarizeChecks(items: Array<{ issues: CheckIssue[] }>) {
  const errorCount = items.reduce((n, it) => n + it.issues.filter(i => i.level === 'error').length, 0)
  const warnCount = items.reduce((n, it) => n + it.issues.filter(i => i.level === 'warn').length, 0)
  const blockingCount = items.reduce((n, it) => n + it.issues.filter(i => i.blocking).length, 0)
  return {
    total: items.length,
    badCount: items.filter(it => it.issues.length).length,
    errorCount,
    warnCount,
    blockingCount,
  }
}

/** 每条问题 → 一句可直接粘进「补充说明」的修法（一键修复用；素材类不进这里，因为要补素材不是改文字） */
const REPAIR_TEXT: Record<string, string> = {
  'no-en': '必须同时输出中英两版：英文版（video_prompt_en，官方六段式）和中文工作版。',
  'section-missing': '英文版必须完整输出官方六段（subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music），一段都不能少。',
  'section-dup': '六个段名各只出现一次，不要重复输出同一段。',
  'too-long': '英文版总长压缩到 6200 字符以内，优先精简描述性从句，不许删台词、不许删拍。',
  'too-long-hard': '英文版总长必须压到 6200 字符以内（超过会被打回），优先精简描述性从句。',
  'en-beat-mismatch': '拍数必须正好等于 description 里【镜头N】的个数：同一机位的运镜延续写在同一个 [Shot N] 里，不要另起一拍。',
  'en-zh-beat-mismatch': '英文版拍数必须与中文工作版完全一致，一拍不多一拍不少。',
  'zh-beat-mismatch': '中文工作版拍数必须正好等于 description 里【镜头N】的个数。',
  'shot-header-not-line-start': '每个 `[Shot N]` 拍头必须独占一行（前面只能是换行），不要把 `[Shot N]` 夹在句子中间。',
  'timeline-count': '英文版只有第 2 拍起才写时间戳（[Shot N] At 00:xx.000），第 1 拍不写；数量与中文拍数减一相同。',
  'timeline-mismatch': '英文版每一拍的时间戳必须与中文工作版该拍的起始秒数完全一致。',
  'dialogue-count': '台词句数与中文工作版完全一致、逐字取自 description，不许新增或删除台词。',
  // `dialogue-over-budget` 故意**不进修法清单**（2026-10-15）：模型改不动自己写的时间轴，
  // 历史实测每轮都改不掉、白烧一轮约 45 秒（该条已标 autoFixable:false）；真要收紧就改生成侧逐拍预算规则。
  'zh-dialogue-punct': '中文台词句末必须收标点（。！？），不许光秃秃结束。',
  'en-has-chinese': '英文版里除 `<d>[Chinese]…</d>` 台词与画面文字外，禁止出现任何中文字符；`retention_analysis` 的标注必须写成英文（(appears in every shot) / (appears in shots 2 and 3 only) / (off-screen only)）。',
  'html-entity': '禁止输出 &lt; / &gt; / &amp;：所有尖括号（<Subject N> / <Picture N> / <Audio N> / <d>）一律裸写。',
  'face-in-voiceover-shot': '画外音那拍不许出现下巴/嘴入画的机位（from the jaw down / chin+neck / over-the-shoulder near），只许手部特写、纯背影或空镜。',
  'media-picture-out-of-range': '「<Picture N>」的编号不得超过该分镜实际参考图的数量。',
  'media-subject-out-of-range': '`<Subject N>` 的编号不得超过该分镜实际参考图的数量；没被提取成道具资产的东西（抹布、餐具、手机架、食物等）只许当画面元素用普通名词写，禁止编号、禁止写 `<Subject N>` / `<Picture N>`。',
  'media-missing-subject': '每一张参考图都要在正文里有对应的 <Subject N> 声明（场景→角色→道具按编号顺序），不许漏。',
}

/** 把体检问题翻成「补充说明」文本（同一 code 只写一次；素材类问题不会进来） */
export function buildRepairNotes(issues: CheckIssue[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const i of issues) {
    if (seen.has(i.code)) continue
    const t = REPAIR_TEXT[i.code]
    if (!t) continue
    seen.add(i.code)
    lines.push('- ' + t)
  }
  if (!lines.length) return ''
  return '逐条满足以下自检要求（不改剧情、不改台词原文、不改参考图对应关系）：\n' + lines.join('\n')
}
