/**
 * 「还要不要继续压缩」判定 —— 零依赖纯函数（与 prop-text-gates / retention-gate 同惯例，可脱离 DB/Agent 直接单测）。
 *
 * 2026-10-15 加。背景（用户报「分镜9 还是生成失败，整个生成过程还是优化的不够好」）：
 * 旧循环条件是「有组超**自己的配额**就继续压」，而 H3 真正卡的是**全文总量**（6200）。
 * 于是时间全花在压不动的组上：
 *   - sb473（失控第7集分镜9，10 秒 3 镜、描述 323 字）detail 组 4272 → 4176 → 3901 → 3743 → 3631
 *     （≈110~160 字符/轮，约 14 秒/轮），而全文 6390 只超硬上限 **190 字符** → 4 轮用尽、整条作废；
 *   - 反过来 sb471：detail 超配额 356 字符，但全文 5883 ≤ 6200 → 本来就该直接接受（组配额是建议值）。
 */
/** 「首稿写飞就整稿重来」的触发条件 —— 零依赖纯函数（2026-10-15 4.0.27 加）。
 *
 * 背景（实测 sb481 ep22 分镜8，两次跑都失败）：模型首稿**整段漏 `subject_definitions`**（三次尝试全是 5/6 段），
 * 流水线先走「缺段补写」把这一段补回来，紧接着旧逻辑又因为「首稿超 800 字符」触发**整稿重来** ——
 * 补好的段被整个丢掉、重新抽一次（还是 5 段），白烧约 1 分钟。
 * ⇒ 六段不齐时禁止整稿重来（缺段靠补写解决）；只有「六段齐但超限」才值得重采样一次。 */
export const DRAFT_OVER_LIMIT_RETRY = 800

export function shouldRegenerateDraft(pass: number, over: number, missingCount: number): boolean {
  return pass === 0 && missingCount === 0 && over > DRAFT_OVER_LIMIT_RETRY
}

/** 中文工作版首行 = 本次分镜的主体清单（「出场人物：@A、@B；场景：@C；道具：@D」）。
 *  英文版 prompt 里 `<Subject N>` 的编号顺序就以它为准 —— 首稿与补写都必须拿到它。
 *  实测 sb481：补写时只给模型一个段名，它写出「只有场景的 1 行」stub，
 *  而正文/retention 引用 <Subject 2..5> → 编号没有定义，身份/服装绑定当场全废。 */
export function zhRosterLine(zhPrompt?: string): string {
  return zhPrompt ? (zhPrompt.split('\n').map(l => l.trim()).find(Boolean) || '') : ''
}

/** 主体清单块（拼进英文版 prompt；没有中文工作版时返回空串） */
export function rosterBlock(zhPrompt?: string): string {
  const roster = zhRosterLine(zhPrompt)
  if (!roster) return ''
  return `
🔴🔴 **本次主体清单（\`<Subject N>\` 的编号顺序以它为准）**：${roster}
\`subject_definitions\` 必须把清单里的**每一个角色、场景、道具各写一行**（N 从 1 开始、按清单顺序），**一个都不许漏** —— 只写场景不写人物（或反过来）都会让正文引用到没有定义的编号，身份/服装绑定当场全废（2026-10-15 sb481 实测）。
`
}

export function shouldKeepCompressing(
  groups: Array<{ problem: string }>,
  total: number,
  limit: number,
): boolean {
  if (!groups.length) return false
  // 缺段必须继续：要补写，放着不管会废在后面的「六段齐全闸」（那是残废提示词，绝不能落库）。
  if (groups.some(g => /缺少|没有内容/.test(g.problem))) return true
  return !(total > 0 && total <= limit)
}
