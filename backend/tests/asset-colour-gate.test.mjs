/**
 * 发色 / 服装颜色 闸回归（2026-10-15）
 *
 * 真实样本（sb481 当月实际数据）：
 *   警察甲：卡面黑发，卡字段里从没写发色（`styling` 当时写的是剧情说明）⇒ 提示词只写 `short cropped hair` → H3 自己猜；
 *   王梅：卡字段写「深蓝**或**灰褐色对襟布衫」，而卡面实际是灰褐色。
 *
 * 范围（2026-10-15 用户拍板）：**只查发色与服装颜色** —— 肤色与配饰不查
 * （有些角色是特殊肤色、有些角色压根没配饰，机械查会大量误报）。
 * 判据要同时认中英两种写法（字段是中文、英文发送版是英文）。
 *
 * 跑法：cd backend && node --test tests/asset-colour-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const gate = await import('../src/services/asset-colour-gate.ts')
const { hasHairColour, hasGarmentColour, ambiguousStyling, subjectLines,
  findColourGaps, shouldRewriteForColour, colourRewriteNote, assetColourGaps, hairColours,
  findColourMismatchInPrompt, findGarmentColourMismatch, subjectLinesByPicture, subjectToPicture, subjectLineForPicture } = gate

test('发色：中英都认，只写「short cropped hair」不算', () => {
  assert.equal(hasHairColour('<Subject 3>, with a long square jaw, short cropped hair, navy police uniform jacket'), false)
  assert.equal(hasHairColour('<Subject 3>, with black short cropped hair'), true)
  assert.equal(hasHairColour('<Subject 2>, with lank straw-dyed hair with dark roots'), true)
  assert.equal(hasHairColour('头发染成枯黄后长出黑根，梳成低矮松散的半扎发'), true)
  assert.equal(hasHairColour('发型为极短平头，鬓角修净'), false, '中文只写平头不写颜色也算漏')
})

test('服装色：颜色要贴着服装名词', () => {
  assert.equal(hasGarmentColour('navy police uniform jacket with shoulder boards, black necktie'), true)
  assert.equal(hasGarmentColour('dark blue front-opening cloth jacket over a faded small-floral apron'), true)
  assert.equal(hasGarmentColour('sallow skin, one tarnished silver bangle'), false)
  assert.equal(hasGarmentColour('藏蓝色制式警服，黑色领带，黑色皮鞋'), true)
})

test('不查肤色与配饰（用户拍板：特殊肤色/无配饰不误报）', () => {
  assert.equal(gate.hasSkinTone, undefined, 'hasSkinTone 应已移除')
  assert.equal(gate.hasAccessoryColour, undefined, 'hasAccessoryColour 应已移除')
  // 只写肤色、没写发色/服色的卡：只报两笔（发色 + 服装），不报肤色/配饰
  assert.deepEqual(assetColourGaps('外观：肤色靛蓝，无任何配饰').sort(), ['garment', 'hair'])
})

test('卡文字里没写死的二选一要报出来（王梅样本）', () => {
  const hit = ambiguousStyling('深蓝或灰褐色对襟布衫，外罩洗得发白的碎花围裙')
  assert.equal(hit?.word, '或')
  assert.match(hit.snippet, /深蓝或灰褐色对襟布衫/)
  assert.equal(ambiguousStyling('藏蓝色制式警服，黑色领带，黑色皮鞋；黑色短发，鬓角修净。'), null)
})

test('不误报：排他句 / 台词 / 语气词（2026-10-15 用户实跑命中的两条误报）', () => {
  // 手机通知屏的「或」在排他句里
  assert.equal(ambiguousStyling('除上述两行红字外不再出现任何其他文字、图标或数字。'), null, '排他句里的「或」不算')
  assert.equal(ambiguousStyling('没有手、手指、手臂、人物、底座、包装或任何场景环境。'), null, '否定句里的「或」不算')
  // 顾明轩的「可能」来自台词
  assert.equal(ambiguousStyling('本集他冷傲外壳出现裂缝：大喊「不可能！她就只是个保洁！」，满脸不敢置信'), null, '台词里的词不算、而且「可能」已不在判据里')
  assert.equal(ambiguousStyling('肤色偏白，下颌线利落，表情克制，可能戴眼镜'), null, '「可能」是语气词，不是二选一')
  // 真二选一仍然要抓
  assert.equal(ambiguousStyling('衣服可以是深蓝或者灰褐色')?.word, '或者')
})

test('findColourGaps：卡里有、提示词漏了 → 值得重写；卡里压根没有 → 只能补卡', () => {
  const defs = [
    'subject_definitions:',
    '<Subject 1> is the banquet hall scene in <Picture 1>, with flat colour blocks',
    '<Subject 2> is the woman in <Picture 2>, with black short hair, navy jacket, black trousers',
    '<Subject 3> is the officer in <Picture 3>, with short cropped hair, navy uniform jacket, black necktie',
  ].join('\n')
  // 王梅：卡里发色+服装色都有（中文写法）；警察甲：卡里只有「短发干净利落」（没有发色，服装也没写）
  const assets = [
    { picture: 2, kind: 'character', name: '王梅', assetText: '外观：面部圆润松弛；造型：黑色短发，深蓝对襟布衫' },
    { picture: 3, kind: 'character', name: '警察甲', assetText: '外观：短发干净利落，肤色健康偏深' },
  ]
  const gaps = findColourGaps(defs, assets)
  const pics = gaps.map(g => `${g.picture}:${g.what}:${g.assetHasIt ? 'card-has' : 'card-lacks'}`).sort()
  // 警察甲这行本来就写了服装色（navy uniform jacket / black necktie）→ 只报缺发色；卡里也没写发色 → 只能补卡
  assert.deepEqual(pics, ['3:hair:card-lacks'], `只该报警察甲缺发色，实际 ${JSON.stringify(gaps)}`)
  assert.equal(shouldRewriteForColour(gaps), false, '卡里没有 → 重写也变不出来，不该空跑一轮')

  // 补完卡的警察甲（黑色短发 + 藏蓝警服）→ 卡里有、提示词漏了 → 该重写
  const assets2 = [{ picture: 3, kind: 'character', name: '警察甲', assetText: '外观：黑色短发干净利落，肤色健康偏深；造型：藏蓝色制式警服，黑色领带' }]
  const g2 = findColourGaps(defs, assets2)
  assert.equal(shouldRewriteForColour(g2), true, `卡里有发色 → 该重写，实际 ${JSON.stringify(g2)}`)
  assert.match(colourRewriteNote(g2), /<Subject 3>（警察甲）没写发色/)
  assert.match(colourRewriteNote(g2), /黑色短发/)
})

test('assetColourGaps：卡数据自身缺发色/服装色（体检用）', () => {
  assert.deepEqual(assetColourGaps('外观：短发干净利落，肤色健康偏深').sort(), ['garment', 'hair'])
  assert.deepEqual(assetColourGaps('外观：黑色短发，皮肤蜡黄；造型：藏蓝色制式警服，腕上银镯'), [])
})

test('subjectLines：能按编号取回定义行', () => {
  const m = subjectLines('subject_definitions:\n<Subject 1> is the scene\n<Subject 2> is the woman')
  assert.equal(m.get(1), '<Subject 1> is the scene')
  assert.equal(m.get(2), '<Subject 2> is the woman')
})

test('角色卡缺发色会被判别出来（2026-10-16 实测：宾客丙当天新建的卡只有「发型短而整齐」）', () => {
  const guestC = '深藏青色商务西装，白衬衫，深色领带，黑色皮鞋；发型短而整齐，鬓角修剪干净；妆面素净日常。整体造型大众化，不与主要角色争视觉焦点。'
  assert.deepEqual(assetColourGaps(guestC), ['hair'], '有服装色、没有发色 → 只报缺发色')
  // 补上发色（背景龙套给最普通的具体值）后必须干净
  assert.deepEqual(assetColourGaps('纯黑色短发，鬓角修剪干净。' + guestC), [])
  // 服装色也缺时两条都要报
  assert.deepEqual(assetColourGaps('普通中年男子，发型短而整齐。').sort(), ['garment', 'hair'])
})

test('提取保存工具在写入前拦住缺色的新卡（源码级接线断言）', () => {
  const src = readFileSync(new URL('../src/agents/tools/extract-tools.ts', import.meta.url), 'utf8')
  assert.match(src, /assetColourGaps\(/, '保存角色必须调用 assetColourGaps 校验')
  assert.match(src, /save-characters-reject-colourless/, '拒绝入库要留日志，便于事后核对')
  assert.match(src, /已被拒绝入库/, '要把「缺什么」回给模型让它补齐，而不是静默写进去')
})

test('整身装束的说法要认（2026-10-16 实测：工装/休闲装/便装/中山装判不出服装色）', () => {
  assert.equal(hasGarmentColour('深蓝色工装，袖口磨旧，脖子上搭条灰汗巾，脚穿旧解放鞋。'), true, '深蓝色工装')
  assert.equal(hasGarmentColour('中档宴会蓝色商务休闲装，面料普通，配饰简单。'), true, '蓝色商务休闲装')
  assert.equal(hasGarmentColour('得体的浅灰色宴会便装，色调沉稳。'), true, '浅灰色宴会便装')
  assert.equal(hasGarmentColour('花白背头，穿深灰色中山装，扣子扣到领口。'), true, '深灰色中山装')
})

test('肤色/唇色不算发色（2026-10-16 实测：宾客乙「面色发白」掩盖了真缺的发色）', () => {
  const y = '二十多岁至三十出头的都市青年形象，面容圆润无害，眼神易显慌乱。权限封禁爆发后声音发虚、面色发白。得体的浅灰色宴会便装；发型整洁朴素；妆面清淡。'
  assert.equal(hasHairColour(y), false, '「面色发白」不是发色；「发型整洁朴素」没写颜色 ⇒ 应判缺发色')
  assert.deepEqual(assetColourGaps(y), ['hair'])
  // 真写了发色仍要认
  assert.equal(hasHairColour('面色发白，头发花白。'), true, '紧邻的肤色描写不许把真发色一起剥掉')
  assert.equal(hasHairColour('一头纯黑短发，面色发白。'), true)
  // 「艳粉唇色」不是服装色/发色
  assert.deepEqual(hairColours('艳粉唇色，粉感厚重的妆面。'), [])
})

