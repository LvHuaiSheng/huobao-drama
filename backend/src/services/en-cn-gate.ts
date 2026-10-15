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
