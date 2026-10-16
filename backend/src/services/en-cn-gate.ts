/**
 * 英文发送版「混入中文」判据 —— 零依赖纯函数（可脱离 DB/Agent 直接单测）。
 *
 * 规则口径（2026-10-14 立）：英文版正文除 **`<d>[Chinese]…</d>` 台词** 与 **画面内文字** 外，
 * 不许出现任何中文字符；`retention_analysis` 的标注必须是英文。
 *
 * ⚠️ 2026-10-15 修：原来只剥 `<d>…</d>`，**没剥引号里的画面内文字** —— 而画面内文字按规则
 * 就是要写成原样的中文并加引号（如 `the phone screen reads "真正的幕后大佬是谁"`）。
 * 实测 sb483（失控第7集分镜10）：提示词正文合法、只是屏幕文字是中文 → 闸误报 9 个中文字
 * → 白跑一轮修复（模型按要求把画面文字改成英文 ✗）→ 最终 `en-cn-unresolved`、**整条判失败**
 * （同批 10 条里 2 条失败，这是其中一条）。所以引号内容一律排除。
 */
export function findChineseOutsideDialogue(en: string): { count: number; sample: string } {
  const body = String(en || '')
    .replace(/<d>[\s\S]*?<\/d>/g, ' ')          // 台词块：中文是规定的
    .replace(/"[^"\n]*"|“[^”\n]*”|「[^」\n]*」/g, ' ') // 引号里的画面内文字：规则要求写原样中文
  const hits = body.match(/[\u4e00-\u9fff]/g) || []
  if (!hits.length) return { count: 0, sample: '' }
  const i = body.search(/[\u4e00-\u9fff]/)
  return { count: hits.length, sample: body.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, ' ') }
}

/** 删掉「我们要求的结构回声」（2026-10-16，用户报「10集分镜4 英文版本里混入中文」）。
 *
 * 模型会把压缩指令里的**中文分组标题**和反引号围栏照抄回正文 —— 实测 sb493 落库的英文稿里夹着
 *   ```` ``` ```` 围栏 + 「组二：summary / retention_analysis」+「组三：detailed_description / …」，
 * 写回时这些行被并进**上一段**末尾 ⇒ 英文版混进中文。
 * 语言闸（③.4）确实抓到那几个汉字，但走 AI 重写要么再被照抄、要么改完变长被回滚（源码里记着 sb432 那次）
 * ⇒ 这类行**只可能是要求本身的回声、不可能是稿子内容**，机械删除最可靠。
 * 安全性：只认「行首围栏 / 行首 组N：/ 行首 ORIGINAL」三种形态 —— `<d>` 台词里的中文、
 *   引号里的画面内中文文字都不满足，不会被误伤。
 */
export function stripRequestEcho(text: string): string {
  return String(text || '').split('\n').filter(line => {
    const t = line.trim()
    if (/^```/.test(t)) return false                                    // 代码块围栏
    if (/^组[一二三四五六七八九十\d]+\s*[:：]/.test(t)) return false        // 中文分组标题回声
    if (/^[一二三四五六七八九\d]+\s*[.、]\s*(?:组|分组)\s*[:：]/.test(t)) return false
    if (/^(?:===+\s*)?(?:ORIGINAL|原文)\b/i.test(t)) return false          // ORIGINAL 回声
    return true
  }).join('\n')
}
