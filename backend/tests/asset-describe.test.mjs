/**
 * 「按图写资产描述」纯函数回归（2026-10-17）
 *
 * 背景：上传实拍图后资产文字还是提取时编的 ⇒ 与图不符 ⇒ 成片锁不住（drama9「Festo-产品」实测）。
 * 这组用例钉住：三类资产的指令口径（写死颜色/禁「或」/只写看得见的）、模型回复的解析与兜底、
 * 以及「这张图是不是用户上传的」判定（static/uploads/ vs static/images/）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildAssetDescribeAsk, parseAssetDescribeReply, isUploadedImage, createSerialQueue, extractChatText, ASSET_DESC_FIELDS } =
  await import('../src/services/asset-describe-prompt.ts')

test('指令口径：只写看得见的、颜色写死、禁「或」、只回 JSON，且带上资产名', () => {
  const prop = buildAssetDescribeAsk('prop', 'CMMT-AS伺服驱动器样机')
  for (const must of ['只写', '不许出现「或', '只输出 JSON', '{"description":"…"', 'CMMT-AS伺服驱动器样机']) {
    assert.ok(prop.includes(must), `道具指令应含「${must}」`)
  }
  assert.ok(prop.includes('不写它是什么用途'), '道具不许写用途（项目既有的道具字段规则）')
  const ch = buildAssetDescribeAsk('character', '苏清禾')
  assert.ok(ch.includes('{"appearance":"…","styling":"…"}'))
  assert.ok(ch.includes('逐件'))
  const sc = buildAssetDescribeAsk('scene', '宴会厅')
  assert.ok(sc.includes('忽略他们'), '场景资产是无人物空镜：图里有人要忽略')
  assert.deepEqual(ASSET_DESC_FIELDS.scene, ['prompt', 'lighting'])
})

test('解析：代码块围栏 / 前后废话 / 多字段 都能取出来', () => {
  const fenced = '```json\n{"appearance":"二十岁出头的年轻女性，肤色白皙。","styling":"黑色低马尾，灰蓝色保洁工作服。"}\n```'
  const a = parseAssetDescribeReply('character', fenced)
  assert.equal(a.appearance, '二十岁出头的年轻女性，肤色白皙。')
  assert.equal(a.styling, '黑色低马尾，灰蓝色保洁工作服。')
  const noisy = '好的，这是结果：\n{"description":"浅灰白色哑光外壳，正面印有蓝色 FESTO 标识。"}\n希望有帮助。'
  assert.equal(parseAssetDescribeReply('prop', noisy).description, '浅灰白色哑光外壳，正面印有蓝色 FESTO 标识。')
  // 换行/多空格压成单空格（落库文本要能直接进提示词）
  const messy = JSON.stringify({ description: 'a\n\nb   c' })   // 换行/多空格要压成单空格
  assert.equal(parseAssetDescribeReply('prop', messy).description, 'a b c')
})

test('解析兜底：模型没给 JSON 时不许静默丢空，整段塞进第一个字段', () => {
  const out = parseAssetDescribeReply('prop', '浅灰白色哑光外壳，正面深色面板，底部一排接线端子。')
  assert.equal(out.description, '浅灰白色哑光外壳，正面深色面板，底部一排接线端子。')
  assert.deepEqual(parseAssetDescribeReply('prop', ''), {})
})

test('取正文：字符串 / parts 数组都能取；空正文返回空串（当失败处理，不许假成功）', () => {
  assert.equal(extractChatText({ choices: [{ message: { content: '{"description":"x"}' } }] }), '{"description":"x"}')
  assert.equal(
    extractChatText({ choices: [{ message: { content: [{ type: 'text', text: 'ab' }, { text: 'cd' }] } }] }),
    'abcd',
  )
  // 推理模型把答案放 reasoning_content、content 空着 —— 必须返回空串让上层报错
  assert.equal(extractChatText({ choices: [{ message: { content: '', reasoning_content: '想了半天' } }] }), '')
  assert.equal(extractChatText({}), '')
  assert.equal(extractChatText(null), '')
})

test('场景指令：描述字段不许写机位/景别/构图（那是图片提示词的事）', () => {
  const sc = buildAssetDescribeAsk('scene', '工业直播间展示台')
  for (const must of ['不写机位', '固定机位', '分层构图', '图片提示词']) {
    assert.ok(sc.includes(must), `场景指令应含「${must}」`)
  }
})

test('上传图判定：static/uploads/ 才算上传（生图产物在 static/images/）', () => {
  assert.equal(isUploadedImage('static/uploads/da39f4e8.jpg'), true)
  assert.equal(isUploadedImage('static/images/2e0f5333.jpg'), false)
  assert.equal(isUploadedImage(''), false)
  assert.equal(isUploadedImage(null), false)
})

test('串行队列：按入队顺序一个个跑（后台排序），前一个失败不阻断后一个', async () => {
  const enqueue = createSerialQueue()
  const log = []
  const slow = (name, ms, fail = false) => enqueue(async () => {
    log.push(`start:${name}`)
    await new Promise(r => setTimeout(r, ms))
    if (fail) { log.push(`fail:${name}`); throw new Error(name) }
    log.push(`done:${name}`)
    return name
  })
  const p1 = slow('A', 30)
  const p2 = slow('B', 5, true)
  const p3 = slow('C', 5)
  assert.equal(await p1, 'A')
  await assert.rejects(p2)
  assert.equal(await p3, 'C')
  // 关键：不允许交叠 —— 前一个 done 之后才允许下一个 start
  assert.deepEqual(log, ['start:A', 'done:A', 'start:B', 'fail:B', 'start:C', 'done:C'])
})
