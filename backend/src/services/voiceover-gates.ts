/**
 * 画外音拍「嘴部动作」闸（2026-10-14，实测 sb437「顾明轩念出苏清禾的台词」）
 *
 * 症状：某一拍里，台词是**画外音**（`<Subject 2> (S1) says in an off-screen voiceover: <d>…</d> while her lips remain
 * completely closed.` ✔ 写法完全合规），可同一拍里**画面内的另一个角色**被写了嘴部动作 ——
 * `His lips part to a narrow gap and close again, his Adam's apple working once`（sb437 [Shot 2] 原文）。
 * H3 看到"画面上有人张嘴" + "一句画外音台词"，就把台词安在那个张嘴的人身上 → 用户看到的是
 * 「顾明轩念出了苏清禾的台词」。
 *
 * 官方 base 指南只要求给**台词主语**写锁嘴句（我们写了、也对），没规定画面内其它角色的嘴；
 * 实测结论：**画外音拍里，画面内任何角色的嘴部动作都会把台词吸过去** —— 所以这一拍里
 * 除了官方锁嘴句，不该出现任何嘴部动作描写；描述里若写了对方的"张嘴/说话/想解释"，要改写成
 * 不含嘴部的动作（抬手、喉结滚动、汗滴、眼神…）。
 *
 * 与既有 `zhEnConsistency` 的自造锁嘴闸（`while no on-screen mouth moves` 之类）分工：
 * 那边管**锁嘴句的写法**，这边管**画面里多出来的嘴部动作**；为避免双重命中，这里
 * 显式排除那几个自造锁嘴短语。
 *
 * 纯函数，单独成文件以便脱离 DB/Agent 模块图单测。
 */

/** 画面内角色的嘴部动作（不含官方锁嘴句） */
const MOUTH_PATTERNS: Array<[RegExp, string]> = [
  [/(?:his|her|their|the man's|the woman's)\s+lips?\s+(?:part|parts|open|opens|twitch|twitches|quiver|quivers)/i, 'lips part/open/twitch'],
  [/(?:parts?|opens?)\s+(?:his|her|their)\s+(?:lips|mouth)/i, 'opens his/her mouth'],
  [/\bmouth\s+(?:opens|open|parts|twitches|quivers)\b/i, 'mouth opens/parts'],
  [/\b(?:he|she)\s+(?:mouths|mutters|whispers)\b/i, 'he/she mutters/whispers'],
]

/** 自造锁嘴短语 —— 归 zhEnConsistency 管，这里不重复命中 */
const SELF_MADE_LOCK = /(?:no\s+on-?screen\s+mouth\s+moves|mouth\s+stays\s+(?:shut|still)|nobody\s+is\s+in\s+frame|lips\s+do\s+not\s+move)/gi

/** 官方锁嘴句（允许出现的唯一嘴部描写） */
const OFFICIAL_LOCK = /lips?\s+remain\s+completely\s+closed/gi

const VOICEOVER = /says\s+in\s+an\s+off-?screen\s+voiceover/i

export interface VoiceoverMouthHit {
  shot: string
  sample: string
}

/**
 * 逐 `[Shot N]` 扫描：该拍有画外音台词（`says in an off-screen voiceover` + `<d>` 块）时，
 * 拍内是否还有**画面内角色的嘴部动作**。返回命中列表（空 = 通过）。
 */
export function findVoiceoverMouthAction(en: string): VoiceoverMouthHit[] {
  const src = String(en || '')
  if (!src || !VOICEOVER.test(src)) return []
  const hits: VoiceoverMouthHit[] = []
  for (const block of src.split(/(?=\[Shot \d+\])/)) {
    if (!/^\s*\[Shot \d+\]/.test(block)) continue
    if (!VOICEOVER.test(block) || !/<d>/.test(block)) continue
    // 去掉官方锁嘴句与自造锁嘴短语后再找嘴部动作（那两处不是"多出来的嘴"）
    const body = block.replace(OFFICIAL_LOCK, ' ').replace(SELF_MADE_LOCK, ' ')
    for (const [re, label] of MOUTH_PATTERNS) {
      const m = body.match(re)
      if (m) {
        hits.push({ shot: block.slice(0, block.indexOf(']') + 1), sample: `${label} → 「${m[0]}」` })
        break
      }
    }
  }
  return hits
}
