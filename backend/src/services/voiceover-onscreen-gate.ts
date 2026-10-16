/**
 * 画外音「锁嘴锁错人」闸（2026-10-14 立，实测 sb437：本该是画外音，画面里的顾明轩却张嘴把台词念了出来）
 *
 * 官方基础指南原文（MiniMax H3 skills/h3-prompt-writing/references/base-en.txt）：
 *   *For voiceover, use the exact phrase `says in an off-screen voiceover`.
 *    Immediately after every voiceover `<d>` block, state that the corresponding
 *    **on-screen character's** lips remain closed.*
 * 例：`The man (S1) says in an off-screen voiceover: <d>[English] I still remember that road.</d>
 *      while his lips remain completely closed.`
 *
 * 关键点：**锁嘴锁的是"这一拍画面里在的那个角色"，不是画外的旁白者**。
 * 实测事故 sb437 [Shot 2]：画面里是顾明轩 `<Subject 3>`，旁白是画外的苏清禾 `<Subject 2>`，
 * 稿子却写成 `while her lips remain completely closed` —— "her" 指向画外的旁白者，
 * 画面里的顾明轩**没有被锁嘴**，于是 H3 让他张嘴把苏清禾的旁白念了出来（用户报的正是这个）。
 *
 * 判据（2026-10-16 收紧）：逐 `[Shot N]` 扫描；该拍有画外音 `<d>`、且画面前文提到了角色主体
 * （charSubjects 由调用方按参考图顺序给出）时，该拍必须有一句
 * **点名版** `<Subject K>'s lips remain completely closed`（K = 画面里那个角色，**包括旁白者本人**）。
 * 缺 → 命中。
 *
 * 🔴 **为什么连「画面里只有旁白者自己」也要点名**（实测 sb509，2026-10-16）：
 *   同一分镜三条成片 —— 11:29 那条写 `<Subject 2>'s lips remain completely closed` 嘴是闭的 ✓；
 *   12:11 / 12:28 两条写成 `while her lips remain completely closed`（原规则允许），
 *   用户报「旁白没有锁住嘴」，画面里的人把旁白念了出来。死因与 sb437 相同：
 *   **代词不绑定画面人物，H3 只对"被点到的那个 subject"执行闭嘴**。
 *   画面里没有角色主体时本来就无需锁嘴 ⇒ 代词写法不再有存在的理由，一律作废。
 *
 * 纯函数，单独成文件以便脱离 DB/Agent 模块图单测。
 */

export interface VoiceoverLockGap {
  /** 拍号标记，如 `[Shot 2]` */
  shot: string
  /** 旁白者主体号（画外） */
  narrator: number
  /** 这一拍画面里出现、但不是旁白者的角色主体号 */
  onscreen: number[]
}

const VOICEOVER = /says\s+in\s+an\s+off-?screen\s+voiceover/i
const subjectsOf = (s: string): number[] =>
  Array.from(new Set((s.match(/<Subject (\d+)>/g) || []).map(x => parseInt(x.replace(/\D+/g, ''), 10))))

/**
 * 官方锁嘴句的**两种合法写法**（2026-10-16 统一，别只认一种）：
 *   ① 代词版 `while her/his/its lips remain completely closed`（画面里只有旁白者自己或空镜）
 *   ② 点名版 `while <Subject K>'s lips remain completely closed`（画面里是别的角色 ⇒ **必须点名**，否则锁错人，见文件头 sb437）
 * 事故：`zhEnConsistency` 里另写了一份只认 ① 的正则 ⇒ 稿子按规则写了 ② 却被判「没有锁嘴句」，
 * 自动修复两轮都改不掉（模型改成 ① 反而违反本文件的规则）⇒ 用户看到「报错修复不了」（sb486，第9集分镜3）。
 */
export const OFFICIAL_LIP_LOCK = /(?:<Subject \d+>|her|his|its)(?:'s)?\s+lips?\s+remain\s+completely\s+closed/i

/** 拍内是否已按官方口径锁了某个画面角色的嘴：`<Subject K>'s lips remain completely closed` */
const locksSubject = (shot: string, k: number): boolean =>
  new RegExp(`<Subject ${k}>'s lips? remain completely closed`, 'i').test(shot)


/**
 * @param en 英文版提示词全文
 * @param charSubjects 本分镜里「角色」主体的编号（按参考图顺序，由调用方给出）
 * @returns 命中列表（空 = 通过）
 */
export function findVoiceoverOnscreenLock(en: string, charSubjects: number[]): VoiceoverLockGap[] {
  const src = String(en || '')
  const chars = new Set((charSubjects || []).filter(n => Number.isFinite(n)))
  if (!src || !chars.size || !VOICEOVER.test(src)) return []
  const hits: VoiceoverLockGap[] = []
  for (const block of src.split(/(?=\[Shot \d+\])/)) {
    if (!/^\s*\[Shot \d+\]/.test(block)) continue
    if (!VOICEOVER.test(block) || !/<d>/.test(block)) continue
    const head = block.slice(0, block.search(VOICEOVER))
    const mentioned = subjectsOf(head)          // 旁白句之前提到的 = 这一拍画面里的
    const narrator = mentioned.length ? mentioned[mentioned.length - 1] : 0
    const onscreen = mentioned.filter(n => chars.has(n))   // 含旁白者本人（见文件头 sb509）
    if (!onscreen.length) continue              // 画面里没有角色 → 无需锁嘴
    // 点到名的那个角色的嘴已锁 → 通过；只写代词（her/his/its）不算
    if (onscreen.some(k => locksSubject(block, k))) continue   // locksSubject 已经是点名版，代词写法匹配不上
    hits.push({ shot: block.slice(0, block.indexOf(']') + 1), narrator, onscreen })
  }
  return hits
}
