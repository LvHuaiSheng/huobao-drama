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

/** `subject_definitions` 段配额（与 video-prompts.ts 的 EN_SECTION_QUOTA 保持一致） */
export const SUBJECT_SECTION_QUOTA = 1700

export function shouldRegenerateDraft(pass: number, over: number, missingCount: number, filledCount = 0): boolean {
  // filledCount > 0 = 本轮刚靠「补写」把缺段补回来过 ⇒ 整稿重来会把这份成果丢掉再抽一次（实测 sb481 白烧约 50 秒）。
  return pass === 0 && missingCount === 0 && filledCount === 0 && over > DRAFT_OVER_LIMIT_RETRY
}

/** 中文工作版首行 = 本次分镜的主体清单（「出场人物：@A、@B；场景：@C；道具：@D」）。
 *  英文版 prompt 里 `<Subject N>` 的编号顺序就以它为准 —— 首稿与补写都必须拿到它。
 *  实测 sb481：补写时只给模型一个段名，它写出「只有场景的 1 行」stub，
 *  而正文/retention 引用 <Subject 2..5> → 编号没有定义，身份/服装绑定当场全废。 */
export function zhRosterLine(zhPrompt?: string): string {
  return zhPrompt ? (zhPrompt.split('\n').map(l => l.trim()).find(Boolean) || '') : ''
}

/** 主体清单块（拼进英文版 prompt；没有中文工作版时返回空串） */
export function rosterBlock(zhPrompt?: string, sectionQuota = SUBJECT_SECTION_QUOTA): string {
  const roster = zhRosterLine(zhPrompt)
  if (!roster) return ''
  // 主体数 = 清单里 @ 的个数（出场人物 + 场景 + 道具）。实测 sb481 补写时一口气给 5 个主体写了 ~3000 字符，
  // 而这一段配额只有 1700 → 直接顶破全文上限、多烧一轮压缩。所以这里把逐主体预算写死给模型。
  const n = Math.max(1, (roster.match(/@/g) || []).length)
  const per = Math.max(120, Math.floor(sectionQuota / n / 10) * 10)
  return `
🔴🔴 **本次主体清单（\`<Subject N>\` 的编号顺序以它为准）**：${roster}
\`subject_definitions\` 必须把清单里的**每一个角色、场景、道具各写一行**（N 从 1 开始、按清单顺序），**一个都不许漏** —— 只写场景不写人物（或反过来）都会让正文引用到没有定义的编号，身份/服装绑定当场全废（2026-10-15 sb481 实测）。
🔴 **每行字数预算**：本次共 ${n} 个主体、该段总额 ${sectionQuota} 字符 ⇒ **每个主体一行、每行 ≤ ${per} 字符**（脸型/发型/服装主色/关键道具为主，其余修饰词一律不要）。写超了后端会重发压缩，白等 20 多秒。
`
}

/** 拆出每一拍 / 每个主体（纯函数，给「逐项点名」用） */
function splitItems(text: string, kind: 'shot' | 'subject'): Array<{ label: string; len: number }> {
  const t = String(text || '')
  const re = kind === 'shot' ? /\[Shot (\d+)\]/g : /<Subject (\d+)>/g
  const hits: Array<{ at: number; label: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) hits.push({ at: m.index, label: kind === 'shot' ? `[Shot ${m[1]}]` : `<Subject ${m[1]}>` })
  return hits.map((h, i) => ({ label: h.label, len: (i + 1 < hits.length ? hits[i + 1].at : t.length) - h.at }))
}

/**
 * 逐拍 / 逐主体点名（2026-10-15 4.0.32 加）—— 比笼统喊「压 detail 段」有效得多。
 *
 * 实测 sb483：压缩指令只说「detail 超 1428 字符」时，模型 4 轮只肯砍 550/444/52/0（最后一轮一字不动）；
 * 而实测每拍 1450 字 vs 目标 830，把「Shot 2 现在 1450 → 目标 ≤830」写清楚，模型才知道砍哪儿、砍多少。
 */
export function itemBudgetLines(text: string, kind: 'shot' | 'subject', sectionQuota: number): string[] {
  const items = splitItems(text, kind)
  if (!items.length) return []
  const per = Math.max(80, Math.floor(sectionQuota / items.length / 10) * 10)
  return items.filter(it => it.len > per)
    .map(it => `- ${it.label} 现在 ${it.len} 字 → 目标 ≤${per}（砍 ${it.len - per}）`)
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
