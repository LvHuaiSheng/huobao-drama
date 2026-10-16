/**
 * 「屏幕要露出来」的拍不许出现人物主体（2026-10-16 立，用户要求）
 *
 * 用户原话：「手机等道具需要展示屏幕的时候，经常出现人物主体，会导致穿帮 ——
 *   改成需要展示手机/平板等屏幕的时候，镜头只有手部拿着展示出来，没有身体的其他部位。」
 *
 * 为什么要机械判：这类拍一旦把人物主体写进去，H3 就会把参考图里的脸/身体一起画进来
 * （多主体同框时脸和衣服还会互相串），而这一拍真正要的是**屏幕上那行内容**。
 * 实测样本（全库 144 个含设备的拍）：写对的形状长这样 ——
 *   `Extreme close-up …: a raised arm fills the frame, fingers curled around <Subject 4>,
 *    its screen dominating the composition.`（只有手臂+手指+设备，没有脸/身）
 * 写成事故的形状（同样要求展示屏幕内容）——
 *   `… one hand lifting a phone that throws flat red light upward onto his face …
 *    <Subject 3> stands beside him with a drained pale face, shoulders hunched …`
 *
 * 判据（**只在"屏幕内容确实是这一拍的重点"时才管**，避免误报）：
 *   触发 = 该拍提到设备屏幕 **且** 提到屏上内容（shows / displays / text / message / notice /
 *          content / rows / glyphs / screen fills / screen dominating …）；
 *   命中 = ①该拍出现人物主体词（face / head / eyes / chest / shoulders / torso / body /
 *          waist / neck / chin / jaw / hair），或 ②该拍压根没写手/手臂（hand / arm / fingers /
 *          thumb / wrist / palm / cuff / knuckles）—— 两者都说明"只有手 + 设备"这条没落地。
 *
 * 只判英文版（发送版）；中文工作版的写法由规格文案约束（`prompt_generator.md`）。
 * 纯函数，单独成文件以便脱离 DB/Agent 模块图单测。
 */

export interface DeviceScreenHit {
  /** 拍号标记，如 `[Shot 1]` */
  shot: string
  /** 命中原因：出现人物主体 / 没写手部 */
  reason: 'body' | 'no-hand'
  /** 命中的原句片段（给人定位用） */
  sample: string
}

/** 设备（手机/平板/设备本体） */
const DEVICE = /\b(?:phone|smartphone|tablet|handset|device|screen|display)\b/i
/** 屏上的内容/可读性是这一拍的重点 */
const SCREEN_CONTENT =
  /\b(?:screen|display)\b[^.]{0,60}\b(?:shows?|displays?|reads?|carries?|fills?|dominating|content|text|message|notice|rows?|glyphs?|notification|interface|ui)\b|\b(?:text|message|notice|notification|glyphs?|interface)\b[^.]{0,40}\b(?:screen|display)\b/i
/** 手持设备（只有这类才要求"手拿着"；立式屏幕/墙面屏不需要手，实测 sb452 就是立式直播屏） */
const HANDHELD = /\b(?:phone|smartphone|tablet|handset)\b/i
/** 人物主体词（出现即说明人物被写进画面；手/手臂不在其列 —— 那是允许的） */
const BODY_PART = /\b(?:face|faces|head|eyes?|chest|shoulders?|torso|body|waist|neck|chin|jaw|hair)\b/i
/** 允许出现的手部与袖口 */
const HAND_PART = /\b(?:hands?|arms?|fingers?|thumb|wrist|palm|cuffs?|knuckles?)\b/i

/**
 * 逐 `[Shot N]` 扫描：屏幕内容要露出来的拍里有没有人物主体（或压根没写手）。
 * 返回命中列表（空 = 通过）。
 */
export function findDeviceScreenBody(en: string): DeviceScreenHit[] {
  const src = String(en || '')
  if (!src || !DEVICE.test(src)) return []
  const hits: DeviceScreenHit[] = []
  for (const block of src.split(/(?=\[Shot \d+\])/)) {
    if (!/^\s*\[Shot \d+\]/.test(block)) continue
    if (!DEVICE.test(block) || !SCREEN_CONTENT.test(block)) continue
    const shot = block.slice(0, block.indexOf(']') + 1)
    const body = block.match(BODY_PART)
    if (body) {
      hits.push({ shot, reason: 'body', sample: `「${body[0]}」` })
      continue
    }
    // 只有**手持设备**才要求镜头里是"手拿着设备"；立式/墙面屏本来就没有手
    if (HANDHELD.test(block) && !HAND_PART.test(block)) {
      hits.push({ shot, reason: 'no-hand', sample: '（这一拍没有写手/手臂）' })
    }
  }
  return hits
}

/** 给重写与体检用的一句话说明 */
export function deviceScreenNote(hits: DeviceScreenHit[]): string {
  return hits
    .map(h => h.reason === 'body'
      ? `${h.shot}：这一拍要露屏幕内容，但正文里出现了人物主体 ${h.sample}`
      : `${h.shot}：这一拍要露手持设备的屏幕，但没有写「手拿着设备」`)
    .join('\n')
}
