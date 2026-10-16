/**
 * 画外音拍「嘴」闸（2026-10-14，两轮修正后定版）
 *
 * 症状（用户实测）：sb437 第4集分镜10 镜头2 —— 台词是**画外音**（`<Subject 2> (S1) says in an off-screen
 * voiceover: <d>…</d> while her lips remain completely closed.` 写法完全合规），**声音也对**（用户确认是苏清禾的），
 * 但**画面上顾明轩在说话**。同一拍原文：`His lips part to a narrow gap and close again`（第一版）→ 改成
 * `His mouth stays shut and his lips stay closed and still for the whole shot`（第二版）→ **仍然嘴动**。
 *
 * 两轮实测得到的判据（这才是对的）：
 *   ① 本链路 `BasicGuider` + cfg=1，**没有负向分支** —— 凡是**提到嘴的词**（不管是"张开"还是"闭着"）
 *      都等于把"嘴"这个元素放进正面描述里，H3 就会让嘴动。所以「必须显式锁嘴」这条是错的，
 *      正确做法是：**画外音那一拍，非说话角色一个嘴部相关的词都不许出现**（mouth / lips / 张嘴 / 嘴唇）。
 *   ② 台词主语那一句的官方锁嘴句 `while her/his lips remain completely closed.` 是**例外**（H3 训练过的固定句，实测有效）。
 *
 * 本闸只做一件事：逐 `[Shot N]` 扫描，若该拍是画外音拍，则**除官方锁嘴句外**不允许出现任何 mouth/lips 字样。
 * 高精度、低误报：`<d>` 台词块里的字（台词里可能提到"嘴"）不计，官方锁嘴句不计。
 *
 * 另一条只在规则里写、不进闸（避免误报）：画外音拍**不要给非说话角色脸部特写** —— 实测 sb302：
 * 同一分镜的手部特写拍旁白正常，写了脸部特写的那一拍"旁白被读出来、嘴照动"。
 *
 * 纯函数，单独成文件以便脱离 DB/Agent 模块图单测。
 */

/** 官方锁嘴句（唯一允许出现在画外音拍里的嘴部描写） */
const OFFICIAL_LOCK = /lips?\s+remain\s+completely\s+closed/gi
/** 自造锁嘴短语（归 zhEnConsistency 管；这里也去掉，避免与它重复命中） */
const SELF_MADE_LOCK = /(?:no\s+on-?screen\s+mouth\s+moves|mouth\s+stays\s+(?:shut|still)|nobody\s+is\s+in\s+frame|lips\s+do\s+not\s+move)/gi
/** 安全写法：明确把嘴排除在画面外（实测 sb302 [Shot 2] 就是这个写法，旁白正常）→ 不算命中 */
const MOUTH_OUT_OF_FRAME = /mouth\s+(?:is\s+)?(?:off-?screen|out\s+of\s+frame|not\s+in\s+frame)/gi
/** 任何嘴部字样（mouth / lip / lips / 嘴唇 / 嘴） */
const MOUTH_ANY = /\b(?:mouth|lips?)\b|嘴唇|嘴巴|张嘴/i

/**
 * 下半张脸的**动作**（下颌/下巴/喉结）—— 同上一条口径：cfg=1 没有负向分支，
 * 正文里写下颌动作就等于命令 H3 动下半张脸，而画外音那一拍动下半张脸 = 嘴在动。
 *
 * 2026-10-16 实测（用户「11集分镜1 旁白还是读出来的」）：稿子**点名版锁嘴句完全合规**，
 * 但同一拍里写了 `her chin dips a fraction`（中文原文「下颌微收」照抄过来）
 * ⇒ 成片嘴照动。旧判据只查 `mouth|lips`，`chin` 从眼皮底下过去了。
 *
 * 只认**带动作词**的写法（`chin dips` / `jaw tightens` / 「下颌微收」），不认静态/光影写法
 * （`a cold flat shape across her jaw` 这种只是打光，实测那条成片嘴是闭的 ⇒ 不能误报）。
 * ponytail: 词表式判据，靠"部位词 + 动作词相邻"过滤；无动作词但仍在描述下半张脸的长句可能漏过，靠规格文案兜。
 */
const LOWER_FACE_MOTION = new RegExp(
  '(' +
  "(?:chin|jaw|throat|adam's apple)[A-Za-z' ]{0,14}" +
  "(?:dips?|dipping|drops?|dropping|lifts?|lifting|tucks?|tucking|tightens?|tightening|clenches?|clenching" +
  '|sinks?|sinking|trembles?|trembling|quivers?|quivering|works?|working|sets?|setting|parts?|parting' +
  '|opens?|opening|moves?|moving|shifts?|shifting|jerks?|jerking|bobs?|bobbing|rises?|rising|falls?|falling)' +
  "|(?:dips?|drops?|lifts?|tucks?|tightens?|clenches?|sinks?|trembles?|parts?|opens?|jerks?|bobs?)[A-Za-z' ]{0,14}" +
  "(?:chin|jaw|throat|adam's apple)" +
  '|(?:下颌|下巴|喉结)[^。；;,.，]{0,6}(?:收|沉|抬|紧|动|张|颤|微收)' +
  '|(?:收|沉|抬|紧|张|颤)[^。；;,.，]{0,6}(?:下颌|下巴)' +
  ')', 'i')
const VOICEOVER = /says\s+in\s+an\s+off-?screen\s+voiceover/i

export interface VoiceoverMouthHit {
  shot: string
  sample: string
}

/**
 * 逐 `[Shot N]` 扫描：该拍有画外音台词（`says in an off-screen voiceover` + `<d>` 块）时，
 * 拍内是否还有**除官方锁嘴句以外**的嘴部字样。返回命中列表（空 = 通过）。
 */
export function findVoiceoverMouthAction(en: string): VoiceoverMouthHit[] {
  const src = String(en || '')
  if (!src || !VOICEOVER.test(src)) return []
  const hits: VoiceoverMouthHit[] = []
  for (const block of src.split(/(?=\[Shot \d+\])/)) {
    if (!/^\s*\[Shot \d+\]/.test(block)) continue
    if (!VOICEOVER.test(block) || !/<d>/.test(block)) continue
    // 去掉：台词块 / 官方锁嘴句 / 自造锁嘴短语 → 剩下的正文里还有嘴部字样就是问题
    const body = block
      .replace(/<d>[\s\S]*?<\/d>/g, ' ')
      .replace(OFFICIAL_LOCK, ' ')
      .replace(SELF_MADE_LOCK, ' ')
      .replace(MOUTH_OUT_OF_FRAME, ' ')
    const m = body.match(MOUTH_ANY) || body.match(LOWER_FACE_MOTION)
    if (m) {
      hits.push({
        shot: block.slice(0, block.indexOf(']') + 1),
        sample: `「${m[0]}」`,
      })
    }
  }
  return hits
}
