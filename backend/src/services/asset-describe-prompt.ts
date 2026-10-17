/**
 * 「按图写资产描述」的**纯函数**部分（零依赖，可单测 —— 与 retention-gate / asset-colour-gate 同惯例）
 *
 * 指令口径来自项目既有写作规则：写死颜色、禁「或」、只写看得见的、不写画风词。
 * 读图那一步（真要调模型）在 `asset-describe.ts`，本文件只负责「问什么」和「怎么解析」。
 */

export type AssetKind = 'character' | 'scene' | 'prop'

/** 每种资产要模型回哪几个字段（与 App 编辑框一一对应） */
export const ASSET_DESC_FIELDS: Record<AssetKind, string[]> = {
  character: ['appearance', 'styling'],
  scene: ['prompt', 'lighting'],
  prop: ['description'],
}

/** 三类资产各一份指令 */
export function buildAssetDescribeAsk(kind: AssetKind, name: string): string {
  const common = [
    '你看到的是一张图片。只写**照片上真实看得见**的东西：不许靠常识补、不许写剧情用途、不许写你猜的参数。',
    '颜色、材质、形状必须写死；**不许出现「或 / 或者 / 可能 / 大约 / 深浅不一」**这类二选一或含糊的说法。',
    '画面里可见的文字、标识、标签，逐字抄进引号里；看不清就别写，不许编。',
    '只输出 JSON（不要解释、不要代码块围栏、不要前后缀）。',
  ].join('\n')

  if (kind === 'prop') {
    return `这是一张道具图，道具名「${name}」。请按图片写它的「物品外貌」，后面会喂给 AI 视频生成。\n${common}\n要求：\n`
      + '- 只写物品本身：形状、尺寸感、**逐个部位的颜色与材质**、表面新旧与磨损、接口/按键/显示屏/铭牌等可见结构。\n'
      + '- 不写它是什么用途、不写它与角色或别的东西的关系。\n'
      + '- **不写照片的拍摄角度或朝向**（不写「斜侧角度 / 正对镜头 / 俯视 / 侧躺 / 面板朝上」这类词）—— 只写这件东西本身长什么样。描述是视频提示词的唯一来源，带了角度词，提示词就会把道具的朝向写死。\n'
      + '- 画面里只有一件就写清数量（例：全机仅此一台）。\n'
      + '- ≤200 字，一段话；不要写「单张产品图 / 影棚光 / 白底 / 高清 / 电影质感」这类摄影或画风词。\n'
      + '输出格式：{"description":"…"}'
  }
  if (kind === 'character') {
    return `这是一张角色定妆图，角色名「${name}」。请按图片写这个角色的「样貌」与「妆造」，后面会喂给 AI 视频生成。\n${common}\n要求：\n`
      + '- 样貌：年龄感、脸型、五官（眉/眼/鼻/唇）、体型、肤色、发色、气质神态。不写性格标签、不写剧情。\n'
      + '- 妆造：发型（长度＋颜色＋扎法）、**逐件**服装（上衣/下装/外套各自的颜色、面料、款式）、鞋、配饰（逐件写颜色或材质）、妆面浓淡与唇色；同一件衣服只写一次，不许写两个备选。\n'
      + '- 样貌 ≤300 字、妆造 ≤200 字，各一段，不要分点。\n'
      + '- 不要写「三视图 / 参考板 / 画风 / 影棚光 / 高清」这类词。\n'
      + '输出格式：{"appearance":"…","styling":"…"}'
  }
  return `这是一张场景图，场景名「${name}」。请按图片写这个场景的「场景描述」与「光影」，后面会喂给 AI 视频生成。\n${common}\n要求：\n`
    + '- 场景描述：空间类型与尺度、陈设与家具（含位置关系）、材质与颜色、年代质感、墙面/地面/门窗、画面里可见的文字招牌（逐字）。\n'
    + '- 光影：光源种类与方向、明暗分布、色调与氛围。\n'
    + '- 只写场景本身：**画面里若有人物，忽略他们**（场景资产按项目规定是无人物空镜）。\n'
    + '- 场景描述 ≤300 字、光影 ≤150 字，各一段。\n'
    + '- **不写机位、景别、构图**（不写「固定机位 / 广角 / 建立镜头 / 前景中景后景 / 分层构图 / 画幅 / 镜头探入」这类词）—— 那些是**图片提示词**的事，写进场景描述就会把分镜的机位锁死。\n'
    + '- 不要写画风词（照片 / 电影质感 / 高清）。\n'
    + '输出格式：{"prompt":"…","lighting":"…"}'
}

/** 解析模型回复：剥围栏 → 取第一个 JSON 对象 → 按 kind 收字段（模型不听话时兜底塞第一个字段） */
export function parseAssetDescribeReply(kind: AssetKind, raw: string): Record<string, string> {
  const want = ASSET_DESC_FIELDS[kind]
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let obj: any = null
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s >= 0 && e > s) {
    try { obj = JSON.parse(text.slice(s, e + 1)) } catch { obj = null }
  }
  const out: Record<string, string> = {}
  for (const f of want) {
    const v = obj && typeof obj[f] === 'string' ? String(obj[f]).replace(/\s+/g, ' ').trim() : ''
    if (v) out[f] = v
  }
  if (!Object.keys(out).length && text) out[want[0]] = text.replace(/\s+/g, ' ').slice(0, 600)
  return out
}

/**
 * 串行队列：同一时刻只跑一个任务，后来的排队（**后台排序**）。
 *
 * 为什么要它：用户会连着点好几个资产的「按图写描述」，而服务端只有一个文本模型端点
 * （zzz :8731，单台机器）。并发打过去只会互相排队+抢 token，还可能一方超时；
 * 在代码里排队能让「谁先点谁先出」这件事可见、可控。前一个失败不阻断后一个。
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = tail.then(task, task)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}

/** 图片是否来自「用户上传」（上传图在 static/uploads/，生图产物在 static/images/） */
export function isUploadedImage(rel: string | null | undefined): boolean {
  return /(^|\/)static\/uploads\//.test(String(rel || ''))
}

/**
 * 从 chat/completions 响应里取正文。
 *
 * 为什么要单独一个函数：这个端点（zzz :8731 的 halogen）回的是 OpenAI 形状，但正文可能是
 * 字符串、也可能是 parts 数组；推理模型还可能把答案全塞在 reasoning_content 里、content 空着
 * —— 空正文要当**失败**报出来，不能让前端以为成功却什么都没填。
 */
export function extractChatText(json: any): string {
  const msg = json?.choices?.[0]?.message
  const c = msg?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('')
  return ''
}

