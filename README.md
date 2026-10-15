# HuobaoDrama · 大胖紫自维护分支

> 上游项目：[chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)（本仓是它的 fork）
> 自维护分支：**`chain`** —— 我自己的改动全部在这里；`master` 保持上游原样，方便对照。
> 应用版本 `desktop 4.0.13` · 最近更新 2026-10-15 · 本分支自己的提交 224 条（2026-10-07 → 2026-10-15）

## 这个分支比上游多了什么

一句话：**把一套「AI 短剧批量生产」流水线做到能长期跑**。四块主要工作：

1. **提示词三道防线**：规则层（中英模板同步改）→ 入库层（机器闸：语言闸、越界编号清理、画外音锁嘴、道具引用闸…）→ 体检层（整集体检 + 一键修复）。同一个病三层一起治，不靠模型自觉。
2. **续拍链**：链 ID / 段号可推导（单段重拍能接上）、airlock 接头自动前置、链上参数与前端按钮打通。
3. **资产体系**：RefMod 身份卡（人物 / 场景 / 道具）、换装造型变体（独立角色行 + 图像编辑保脸）、声音（32k 源 wav 直出，换装角色可沿用原角色声音）、资产软删过滤与删集/删剧级联清理。
4. **自用工程化**：任务栏「真正在渲染」秒表、批量生成进度与成功/失败分色、本机 macOS 打包流程（ffmpeg/ffprobe 按架构分装、ad-hoc 签名 → 免装 Rosetta、免「已损坏」）。

## 更新日志（我的改动）

> 约定：**每次交付一个安装包就打一个 tag**（格式 `v<应用版本>-zdz<N>`），要点记在下表；完整提交历史折叠在本节最后。

| 日期 | tag | 主要改动 |
|---|---|---|
| 2026-10-15 | `v4.0.13-zdz1` | 换装：参考图可勾选本剧已有形象 · 衣服描述 AI 生成 · 换装角色可沿用原角色声音 · 造型卡也能再换装；提示词「压缩轮白跑」修复；批量进度条成功/失败分色 |
| 2026-10-14 | | 换装造型端到端上线；旁白锁嘴必须锁「画面里的那个角色」；外观字段禁二选一；提取合并只填空、不覆盖手改妆造；项目设置弹窗；任务耗时显示真实生成时间、批量不再误报超时；崩溃后不再无条件把在跑任务判死 |
| 2026-10-13 | | 提示词体检（单条 + 整集）+ 一键修复；英文版混中文源头治理；越界编号机械兜底；mac 包 ad-hoc 签名（消掉「已损坏」） |
| 2026-10-12 | | 长度硬约束（分段生成 + 只重写超标组）；拍点 / 切点规则收紧（含 3 次实测翻车记录）；拆解层「地点一变必须拆段」与场景绑定规则 |
| 2026-10-11 | | 声音改 32k 源 wav 直出（砍掉无效的声音卡环节）；画风预设分两段（风格头 + 正文渲染语言）；参考图尺寸跟随项目画幅 |
| 2026-10-10 | | 双语提示词（中文工作版 + 英文发送版）；长度治理 v3；角色板「无头三视图」定版；台词预算量化；道具改单张正面；禁建群像角色 |
| 2026-10-09 | | 双语化落地；缺英文版即拒发（老格式转换路径退休）；CAST / BLOCKING 升为顶层段；素材与声音面板交互修复 |
| 2026-10-08 | | RefMod 身份卡产品化（抽卡 / 状态 / 界面按钮 / 删除联动）；verbatim_lock 机械注入；防「瞎说」的官方音频两段；mac 包 ffmpeg/ffprobe 按架构分别内置 |
| 2026-10-07 | | 续拍链第一条打通 + mac 编包流程（GitHub Actions）；角色 / 视频模板大修（人种锁定、禁歪头、打光词、@ 全覆盖） |

## 打包与安装（本仓自用流程）

- **CI**：`.github/workflows/build-mac.yml`，push 到 `chain` 触发，产出 dmg（Actions artifact）。
  ⚠️ 2026-10-15 起本仓 Actions 被 GitHub 平台侧限制：push 不起流水线，手动触发返回 `422 Actions has been disabled for this repository`，而仓库设置里却显示「已启用」（自己点不开）。要恢复需本人向 GitHub Support 提工单（分类选 Account / Trust & Safety）。
- **本机打包**（CI 不可用时，实测可跑）：
  1. `cd frontend && npm ci && npm run generate`
  2. `cd desktop && npm ci && npm run dist`
     （首次会下载 Electron 与 ffmpeg/ffprobe；`scripts/prepare-resources.mjs` 下载失败时，可把同名二进制预置到 `desktop/build/bin-cache/` 绕过，例如从已装的 app 里取 `Contents/Resources/bin/ffprobe`）
  3. 产物：`desktop/release/*.dmg`（arm64 与 x64 各一份）。末尾 publish 步骤在本地会报 `Cannot read properties of null (reading 'channel')`，**在产物生成之后，可忽略**。
- **安装**：退出 App → 打开 dmg → 拖进「应用程序」替换；若提示「已损坏」跑一次 `xattr -cr /Applications/HuobaoDrama.app`。
- **数据**：全在 `~/Library/Application Support/HuobaoDrama/`（库 `data/huobao.sqlite3`、身份卡 `data/refmods/`、声音 `data/voices/`、提示词规范 `workspace/`），换包不影响。

<details>
<summary><b>完整提交历史（本分支 224 条，2026-10-07 → 2026-10-15）</b></summary>

| 日期 | commit | 说明 |
|---|---|---|
| 2026-10-07 | `3b6fc73` | 续拍链: 字段透传+runner+chain接口+前端按钮+提示词规范+mac编包 |
| 2026-10-07 | `a8a5bf2` | CI修复: lock换公网源 + node22 |
| 2026-10-07 | `a3c3ea3` | CI修复: backend依赖供esbuild解析 |
| 2026-10-07 | `ff6b924` | 链总闸进App: 续拍按钮旁勾选(默认开)+chain_enabled透传+中转双闸 |
| 2026-10-07 | `e5f0d89` | 提示词模板补链规: 出场header+顺序绑定+@全覆盖+画外音统一+道具文字 |
| 2026-10-07 | `114f9d2` | 角色模板加人种锁定: 东亚面孔+禁欧美脸词汇(张建国串脸教训) |
| 2026-10-07 | `25f94c5` | 角色模板禁歪头: 正脸特写头正对镜头(脸部锚点) |
| 2026-10-07 | `0bb13da` | 视频模板: 禁强烈对比等打光词+出场header+@全覆盖 |
| 2026-10-07 | `993bede` | 角色模板: 头位锁升级为证件照式构图骨架(防歪头) |
| 2026-10-07 | `a799796` | 角色模板: 正面/侧面全身视图无头化(脸部只留左特写锚点) |
| 2026-10-07 | `1947dbe` | 角色模板: 左特写限头肩(1寸照)+正面/侧面全身无头(背面留后脑) |
| 2026-10-07 | `0e7d43d` | 角色模板: 自检与描述口径对齐(正面/侧面无头,背面留后脑) |
| 2026-10-07 | `23e494c` | 角色模板: 三视图改颈部裁切(非白盖)+特写服装逐件对齐 |
| 2026-10-07 | `a192255` | 角色模板: 口径统一(三张全裁切无头) |
| 2026-10-07 | `0d1948e` | 角色模板: 三视图改无头人台强先验写法 |
| 2026-10-07 | `f7dba4b` | 角色模板: 三视图改画面上边缘裁切(头部在画面外) |
| 2026-10-07 | `3aa1e70` | 角色模板重构: 三视图->服装参考图(颈部以下无面部,行业口径) |
| 2026-10-07 | `5b8fe0b` | 角色模板: 加全局约束(整板只有一处面部) |
| 2026-10-07 | `943ba2e` | 角色模板重构v2: 一帧三格(无头正/背面+脸部特写)+head cleanly removed措辞+砍侧面 |
| 2026-10-07 | `ca46bee` | 路由词: 角色三视图→角色参考板(一帧三格,头部干净移除) |
| 2026-10-07 | `a03b961` | 角色模板: 改一帧四格(脸/正/侧/背,无头三格头部干净移除) |
| 2026-10-07 | `dc8a8e4` | 角色模板: 四格顺序改为 正/侧/背/脸(脸在最右) |
| 2026-10-07 | `2758151` | 角色模板: 侧面格固定左侧面(90度正左,面朝画面左) |
| 2026-10-07 | `3f0ee61` | 角色模板: 侧面只留一句画面语言(鼻尖朝画面左),去掉第二方向词 |
| 2026-10-07 | `1f68a2c` | 妆造冻结: 角色styling/appearance跨段逐字照抄(分镜拆解+视频提示词+提示词生成三处) |
| 2026-10-07 | `75f1d31` | 续拍链: chainId稳定(剧+集)+段号绑定本集序号+单段重拍(按钮>=1,plan补位防误续) |
| 2026-10-07 | `71b3f08` | 续拍链: 去掉自加的首句重复尾词(回归作者airlock:hold2s+无台词+微动作); 禁止手写承接句/禁同段叠新旧构图 |
| 2026-10-07 | `ea005f0` | 续拍链：第2段起首段必须承接上段结尾构图（并集警告正解）；换场景时首段留给 airlock hold |
| 2026-10-07 | `e64e33f` | 提示词模板: 官方R2V主体绑定口径(多角色分别声明防平均脸+参考板逐镜点名格子) |
| 2026-10-07 | `5d2f7d3` | 提示词模板收紧: 妆造串整串原文连写(禁拆句/调序/省略)+点名格子只能四选一逐字照抄 |
| 2026-10-08 | `72615e7` | 模板: 妆造串含最后一句整体总结也必须逐字带上 |
| 2026-10-08 | `214878e` | 机械注入: 提交视频前用数据库角色 styling/appearance 原文整串兜底(verbatim_lock), 不再依赖LLM逐字照抄 |
| 2026-10-08 | `3b95fe9` | 脸格加强+段尾静音: 提交前自动切参考板最右1/4(脸部特写格)当独立参考图并声明face_ref; 模板加链上段尾必须留静音1.5-2s |
| 2026-10-08 | `0e5c037` | 模板: 台词预算量化(≤(段长-2)x4.5字, 实测语速5-6字/秒) + 段尾静音口径收紧 |
| 2026-10-08 | `44ba8cc` | 台词窗规则(段首2s+段尾2s禁台词, 预算(段长-4)x4.5) + 单段重拍也前置airlock hold头 |
| 2026-10-08 | `cb3a2bd` | 防瞎说: 官方 overall_soundscape/non_diegetic_music 两段(取 sound_effect 原文, 写死无任何人声) + 模板加安静处写死规则 |
| 2026-10-08 | `fbba555` | RefMod 卡产品化(批次3+4): 资产身份随参考图同序下发 + 抽卡/状态接口 + 界面按钮 + 删除联动 + 对账 |
| 2026-10-08 | `6c1fd99` | 打包修复: mac 按架构分别内置 ffmpeg/ffprobe（arm64 包不再混入 x86_64 ffprobe，免装 Rosetta） |
| 2026-10-08 | `cd8c396` | 场景/道具提示词: 画面内文字硬性规则(逐字写清要显示的文字) + 修掉 prompt_generator 里残留的旧角色板说法 |
| 2026-10-08 | `a5b62e7` | RefMod 卡方案: 编号统一(<Subject N>=<Picture N>=mod_N) + 视频提示词正文瘦身(-46%) |
| 2026-10-08 | `b39e485` | 下线「脸格裁切追加」: 参考图不再额外追一张裁切脸（RefMod 卡上线后冗余） |
| 2026-10-08 | `036aba7` | 修复: 资产身份没落库 → 视频生成实际没带卡（实测 bug） |
| 2026-10-08 | `f511c66` | 场景/道具/视频提示词: 纸张/证件类道具三条硬性（内容编全 + 逐字写死 + 背面留空） |
| 2026-10-08 | `5a73230` | 视频提示词模板: 声音声明改为「逐拍自检清单」+ 实测反例（防 6-9 秒乱说话复发） |
| 2026-10-08 | `007357b` | 角色声音(批次②后端): voice 卡生成/试听/状态 + 下发时排在图片卡之后 + 底样本库12条\n\n- services/voice.ts: 底样本清单/试听/生成声音卡/状态/删除 + 两层缓存(in-flight 去重 + 内容指纹)\n- routes/voice.ts: /voice/{bases,bases/:id/audio,preview,generate,status} + DELETE\n- generation.ts: 本段角色中做过声音的卡排在图片卡之后一并下发(refmod_files)\n- characters/dramas: 删角色/删项目连带清声音\n- 不新增数据库列(schema 只有 CREATE TABLE IF NOT EXISTS、无加列迁移)→ 用文件状态 |
| 2026-10-08 | `459898e` | 角色声音(批次③前端): 角色卡「生成声音」+ 底样本试听面板 + 修两个布局 bug |
| 2026-10-08 | `21dd477` | 修 App 侧底样本没生效(真 bug)：callTts 把 base 字段塞成了中转网址 → 4080 按底样本文件名解析失败 → 静默回落 CosyVoice 自带女声底。改为上传底样本本体(base_wav, base64)，不依赖 4080 本地目录；顺带把 TTS 返回的 seconds 落进参数 json。 |
| 2026-10-08 | `ec1c5c7` | 声音面板：已有卡时「重新生成」带 force=1（否则命中内容指纹复用旧卡，含修复前用错底生成的那批） |
| 2026-10-08 | `9bc346a` | 角色音色描述: 生成角色提示词时顺带生成，声音面板自动带出 |
| 2026-10-08 | `f66085f` | 音色描述落地到界面: 角色编辑弹层可看可改 + 角色卡显示一行 + AI 重新生成 |
| 2026-10-08 | `a3f410f` | 修编包失败: voice-prompt.ts 不再 import 'ai'（后端未声明该包，esbuild 打包报 Could not resolve "ai"） |
| 2026-10-08 | `579efc0` | 修黑屏(真因): detail.vue 残留 TS 泛型 ref<any>({...}) 让整页 setup 崩 ReferenceError: any is not defined |
| 2026-10-08 | `37e9fa1` | 修黑屏(第二层): detail.vue 补回被误删的 isPending()，渲染时 _ctx.isPending is not a function |
| 2026-10-08 | `95c736a` | 音色面板/资产页一批修复: 描述接口漏 import + 生成中状态按资产 + 素材库总刷新 + 生成完可直接试听 |
| 2026-10-09 | `f63d780` | 素材/声音面板一批交互修复: 保存不关弹层 + AI描述每次换侧重 + 声音面板描述联动最新 |
| 2026-10-09 | `3e9b73e` | 视频提示词双语化：中文工作版 + H3 官方 Ref2VA 六段式英文发送版 |
| 2026-10-09 | `f7c8e48` | 视频提示词规则补齐 + 修历史视频误报"删除失败" |
| 2026-10-09 | `333535d` | 画外音规则矛盾消除 + 道具靠机位不靠角色举 + 当前主视频也能删 |
| 2026-10-09 | `d9fc04b` | feat(export): 成片列表支持删除已拼接的成品 |
| 2026-10-09 | `3827f79` | fix(prompt): 道具朝向靠机位不靠角色举，新增 CAST + BLOCKING 空间约束 |
| 2026-10-09 | `1cb082c` | feat(prompt): CAST + BLOCKING 提升为顶层段，作废"不许新增顶层段名" |
| 2026-10-09 | `9b01850` | feat(video): 缺英文版提示词即拒发，老格式转换路径退休 |
| 2026-10-09 | `546a25d` | perf(generation): 官方六段式 prompt 不再拼 verbatim_lock / audio_lock |
| 2026-10-09 | `84ffd7f` | feat(prop): 道具改用三联参考板（主视角/侧视/背面），生图尺寸对齐角色 |
| 2026-10-10 | `1d81d48` | fix(video-prompt): 长度闭环——超 6200 由后端实测并回喂重写（Agent 不数字符数） |
| 2026-10-10 | `a416168` | feat(video-prompt): 英文版改分段生成——每段当场达标，结构性封死不超 |
| 2026-10-10 | `811b846` | fix(video-prompt): 分段生成的 maxSteps 2 → 4（原本刚好卡在步数边界） |
| 2026-10-10 | `4fecff2` | fix(video-prompt): 长度治理 v3 —— 不与 Agent 较劲：整体生成 + 后端切段 + 只重写超标组 |
| 2026-10-10 | `777eaa9` | fix(tool): video_prompt_en 写入硬闸门——超 6200 拒绝写入，覆盖全部写入路径 |
| 2026-10-10 | `8b5ee13` | perf(video-prompt): 让 Agent 第一次就写短（给目标长度 + 去掉无效的整体重试） |
| 2026-10-10 | `06add5f` | fix(video-prompt): 单条按钮改走治理路径 + 教 AI 怎么砍 —— 治「等 10 分钟还超长」 |
| 2026-10-10 | `a3c74ec` | fix(video-prompt): 配额重分配（head 组 640→880）—— 实测压不下来的真正原因 |
| 2026-10-10 | `92face6` | fix(video-prompt): 兜底——个别组略超配额但全文 ≤6200 时接受，不再整条作废 |
| 2026-10-10 | `75770ac` | feat(character): 角色参考板三视图改回无头（头部被干净地移除） |
| 2026-10-10 | `dbce9e2` | fix(storyboard): 分镜拆解阶段的台词预算对齐提示词阶段（(段长-4)×4.5） |
| 2026-10-10 | `f5100c8` | fix(storyboard): 台词预算加「建议值」档——拆解时留余量，不顶到上限 |
| 2026-10-10 | `54901b0` | feat(storyboard): 台词超预算时仿写剧本对白（保留原意与口吻），不照抄长对话 |
| 2026-10-10 | `f72bbe7` | fix(prompt): 英文版补齐两处——无头措辞残留 + 台词来源明确为 description（不翻剧本） |
| 2026-10-10 | `7a66047` | fix(prompt): 清掉最后两处「三视图都有头」残留（改无头时漏的） |
| 2026-10-10 | `fae422f` | fix(prompt): 英文版 L16 的无头表述（最后一处残留） |
| 2026-10-10 | `f0d52c4` | fix(storyboard): 台词改为写前仿写（读→数字数→先仿写→落笔→当场复核），禁超了再压 |
| 2026-10-10 | `b112f2a` | feat(video-prompt): 适配无头参考板——必须点名脸部特写格 + 显式声明角色有完整头部 |
| 2026-10-10 | `673b8ef` | fix(prompt): 同工种多角色加区分锁 + 禁写人名（实测分镜4把旁边工人画成第二个张建国） |
| 2026-10-10 | `b9e7017` | fix(picture-order): 上下文给出 reference_order 编号表 + 规则改为照表照抄（实测 sb148 <Picture 2>/<Picture 3> 对调导致两个张建国） |
| 2026-10-10 | `af46ed9` | fix(picture-order): 补「没有 reference_order 时自己算」的兜底排序规则（场景→角色id升序→道具id升序） |
| 2026-10-10 | `c4eebec` | fix(episode): 重新拆分后不再自动生成全部提示词（改为只提示条数） |
| 2026-10-10 | `5a6ebae` | fix(agents): 修模板字符串内裸反引号导致的 esbuild 编译失败 |
| 2026-10-10 | `6e22448` | fix(agent): maxSteps 按 Agent 类型区分——拆分被统一砍到 6 步导致跑不完静默失败 |
| 2026-10-10 | `0bc433e` | feat(episode): 重新拆分加确认弹窗（会 replace_existing 清空旧分镜，一点就执行不安全） |
| 2026-10-10 | `cab48e3` | fix(breakdown): 拆分只拆镜头不生成 video_prompt（治「跑完但库里没变化」） |
| 2026-10-10 | `8054e74` | fix(breakdown): 台词多句累加 + 角色绑定必须与描述一致（实测 2 条台词超标、1 条多绑角色） |
| 2026-10-10 | `f453e76` | fix(breakdown): ja/ko 补上绑定一致规则 |
| 2026-10-10 | `0ea6c72` | fix(breakdown): 段落时长改 8-10 秒（用户要求；原 8-15/10-15/12-15 全部收口） |
| 2026-10-10 | `e19226f` | fix(rewriter): 剧本改写加 90 秒总时长硬约束（单集 1 分半；400-550 字、2-4 场景、对白按 3.5 字/秒） |
| 2026-10-10 | `4c11ecc` | fix(rewriter): ja/ko 补上 90 秒总时长约束 |
| 2026-10-10 | `d0739cf` | fix(rewriter): 一集=一个小节点（一章拆5-6集）；输入超90秒时只取最关键1-2个情节点 |
| 2026-10-10 | `8cc3def` | fix(rewriter): ko 补上一集=一个小节点规则 |
| 2026-10-10 | `abd73ae` | revert: 回滚单集总时长 90 秒限制（用户拍板：视频总时长先不限制，恢复旧口径） |
| 2026-10-10 | `6b98011` | feat(extract): 场景按地点去重（不再按时段拆条）+ 角色只登记基准外观（临时变化不写资产） |
| 2026-10-10 | `9109f25` | docs: 场景去重需求清单（已实施状态） |
| 2026-10-10 | `279a1c6` | fix(detail): 素材库场景标题读 location（修「未命名」）+ 补角色/场景/道具删除按钮 |
| 2026-10-10 | `9162cd0` | fix(prop-prompt): 格③按道具形状分三档（圆柱/长条=从另一端看），禁写「背面」防画丢一端（香烟没滤嘴） |
| 2026-10-10 | `9a3edfa` | fix(prop-prompt): en/ko 补齐格③分档规则行 |
| 2026-10-10 | `3274039` | fix(api): 资产列表查询补 isNull(deletedAt) 过滤——软删的场景/角色/道具不再返回（素材库残留无用素材） |
| 2026-10-10 | `dfe9a68` | docs: 记录「抽卡/生声音必须进队列」需求 + 4080 实测证据 |
| 2026-10-10 | `0ef7ccc` | docs: 抽卡/生声音加锁已实施（4080 shim） |
| 2026-10-10 | `c2f38d3` | fix(ui): 拆分按钮文案去掉「生成提示词」误导——实际只拆分镜，提示词由用户另点批量补齐 |
| 2026-10-10 | `19c417a` | feat(api): 删集/删剧级联清理（分镜+关联+资产+任务），支持 purge_files=1 连文件一起删 |
| 2026-10-10 | `2471b9c` | feat: 设置-存储页加「清理历史遗留数据」入口（扫描+清理孤儿文件） |
| 2026-10-10 | `103ee26` | fix(settings): 清理入口补挂 ConfirmDialog（缺组件导致点按钮无反应）+ 扫描排除 debug/uploads 目录 |
| 2026-10-10 | `8ac3a00` | fix(prompt): read_storyboard_context 补声音卡信息（has_voice_card/voice_desc）+ 规则强化中英台词一致、禁止编台词、内心独白必须进 description |
| 2026-10-10 | `ac053f1` | feat(prompt): 台词覆盖率硬下限90% + 开场不静音 + 内心独白默认转旁白 + 台词字数下限 |
| 2026-10-10 | `60b0276` | feat(prompt): 道具锁定必须逐拍覆盖（retention_analysis+正文每拍点名，拍数三者对齐） |
| 2026-10-10 | `782a55e` | fix(storyboard): 拆分阶段从源头禁写 video_prompt（schema 剥字段 + insert/update 不再写入） |
| 2026-10-10 | `37903ba` | feat(prompt): 中文版禁混英文 + 画外音统一旁白写法（禁 X说（画外）） |
| 2026-10-10 | `79c23cd` | feat(prompt): en.md 补中文版禁混英文+画外音统一写法规则 |
| 2026-10-10 | `2c4ff76` | fix(prompt): 澄清中文工作版台词用旁白写法即可（不强制 <d>），中英按条数对应 |
| 2026-10-10 | `753d39c` | feat(prompt): 道具文字必须照抄参考图（下指令不写内容）+ 前提是参考图须单视角清晰 |
| 2026-10-10 | `596c13a` | feat(prop-prompt): 道具参考图从三联板改为单张主视角（字占满画面），治文字与参考图不符 |
| 2026-10-10 | `ca3436a` | feat(prompt): 补单视角道具写法（禁角度词）+ 清 prop11/12 定稿的三联布局残留 |
| 2026-10-10 | `0f504a0` | fix(video-prompt): 画外音拍禁半张脸（下巴/嘴入画=对口型）+ 旁白按拍长配字（防拖尾） |
| 2026-10-10 | `f98d860` | fix(prompt): 台词改逐拍预算（每拍≤拍长×4.5，2秒拍≤9字），治长台词拖进下一拍 |
| 2026-10-10 | `9c13635` | fix(prompt): 补中英时间轴逐拍对齐规则(只加中文版漏了英文版) + 禁输出HTML实体(&lt;Subject&gt;) |
| 2026-10-10 | `85403c6` | fix(prompt): en.md 补禁HTML实体规则+自检项(上轮锚点写错未命中) |
| 2026-10-10 | `ae78878` | feat(prompt): 改生成顺序(先中文后英文,中文时间轴为基准) + 中英一致性程序自动校验(时间轴/台词条数/HTML实体)不合格自动重写 |
| 2026-10-10 | `650783b` | fix(prompt): 手部/道具特写锁「一双手」数量+带前臂袖口锚点，治H3在裸手镜头补出第二个人(4只手) |
| 2026-10-10 | `b528a98` | fix(video-prompt): 旁白改用H3官方固定短语+锁嘴句位置/撤禁脸错规则/撤手部数量锁 |
| 2026-10-10 | `7ea2124` | fix(video-prompt): 撤销禁脸错规则(4文件) |
| 2026-10-10 | `a06539d` | fix(prompt): 撤CAST/BLOCKING回官方六段 + 补切镜官方动词/scenetrans/cutoff/说话人声音身份 |
| 2026-10-10 | `754b619` | chore(prompt): 清 en.md 最后一处 CAST/BLOCKING 引用 |
| 2026-10-10 | `4fb115b` | fix(prompt): 按官方口径重配六段配额(detailed_description 1900→2500词数达标, music 40→120)，注释更正 |
| 2026-10-10 | `b46282b` | fix(prompt): 规则文件补六段配额表(与代码一致)+清残留CAST/BLOCKING引用 |
| 2026-10-10 | `746360a` | fix(prompt): 清收尾自检里残留的画外音禁脸/手部数量锁项(主体规则已撤,自检漏了) |
| 2026-10-10 | `cf439b4` | feat(prompt): 硬规——镜头按description给正常镜头,禁为防嘴改背影/裸手/空镜 |
| 2026-10-10 | `9c07043` | feat(prompt): 补H3镜头写法5条硬规——景别标准词/每镜一机位/禁堆矛盾/运动三要素/framing连贯 |
| 2026-10-10 | `e4e8e4c` | fix(prompt): 体检修复8处——SKILL说话人写法改官方版/清CAST-BLOCKING残留/补回配额表/删无脸镜头残留/统一8-10秒/3秒段改按拍/修重复自检句/台词预算双口径 |
| 2026-10-11 | `0bbbd38` | fix(prompt): 深度体检修复——清代码内CAST/BLOCKING残留(6处)/zhEnConsistency补画外音/按需注入promptTask(省40%上下文)/补官方质量硬规Q1-Q9+RefMod作者规则RF1-RF6 |
| 2026-10-11 | `fbc1c0d` | refactor(voice): B方案——直出32k源wav,砍掉refmod声音卡环节 |
| 2026-10-11 | `dc3423b` | feat(style): 画风锁定改「预设分两段 + 正文渲染语言注入」，9 条预设补齐正文规范 |
| 2026-10-11 | `2c3ac90` | feat(style): 视频提示词也吃画风规范 + H3 正文预算按实际风格头动态算 |
| 2026-10-11 | `13daf94` | feat(style): 9 条预设补「体裁词必须换」规则（道具/场景/人物各给本画风的体裁词） |
| 2026-10-11 | `81167b3` | feat(style): 道具模板去画风声明 + 预设固化 B4 口径（体裁词/构图/厚度/边缘） |
| 2026-10-11 | `85ba646` | fix(templates): 三套通用模板清干净画风声明（场景/人物/道具，中英 9 处） |
| 2026-10-11 | `16148f6` | fix(templates): 英文版三处「product shot」对齐中文的「白底单品」（storyboard-breaker/extractor/prompt_generator） |
| 2026-10-11 | `15791df` | feat(image): 参考图尺寸跟随项目画幅 + 视频提示词整体生成空转自动重试 |
| 2026-10-12 | `be1f725` | fix(breakdown): 拆解规则加硬——地点一变必须拆段 + scene_id 以动作空间为准 + 保存前逐条自检（中英日韩 4 语） |
| 2026-10-12 | `e0bc0e4` | fix(breakdown): 拆解流程单同步补 scene_id 空间一致性规则（4 语） |
| 2026-10-12 | `e79e048` | fix(breakdown): 场景绑定以「改写稿标题行」为准（中英日韩，技能+流程单 8 处） |
| 2026-10-12 | `6f626c4` | fix(video-prompt): 补「拍点=硬切点」与「跨拍不许重复动作」两条规则（中英） |
| 2026-10-12 | `a9a059a` | fix(video-prompt): 拍点规则收紧 + 新增群演多样性规则（中英技能+流程单 4 处） |
| 2026-10-12 | `c05e0a1` | fix(video-prompt): 堵住「cuts to the same framing」假切点空子 + 台词窗口不算起拍理由（中英技能+流程单 4 处） |
| 2026-10-12 | `045032b` | fix(video-prompt): 撤销「段首/段尾 2 秒无台词」窗口（2026-10-12 实测否定） |
| 2026-10-12 | `4112a0f` | fix(video-prompt): 取消正文侧的「第一个时间段必须 hold」——头部 hold 只由 airlock 负责（用户拍板） |
| 2026-10-12 | `3f65ec3` | fix(video-prompt): 补三条硬堵——拍首禁「同景别/不切」写法 + 拍数上限=【镜头N】+1 + 三查自检 |
| 2026-10-12 | `862e235` | fix(video-prompt): 补「静止→横移/推近不算变化」（第 3 次实测翻车） |
| 2026-10-12 | `2b2820f` | fix(video-prompt): 给「静止→运镜不算变化」补一对 ✅/❌ 实例（规则连败三次，改走例子） |
| 2026-10-12 | `b74a95b` | fix(video-prompt): 拍结构规则块整段合并 + 去掉所有「去查/去搜/去数」动作指令（修生成失败） |
| 2026-10-12 | `93559c8` | fix(video-prompts): maxSteps 4 → 6（4 步零余量，模板自检类指令会把步数烧光） |
| 2026-10-12 | `39cd65c` | fix(video-prompt): 拍首禁「the same …」加宽 + 写作说明里禁止抄台词（假警报白跑 2 轮） |
| 2026-10-12 | `4f9b713` | fix(video-prompt): 真凶是模板里的示例在教切拍——格式示例 4 拍改 2 拍 |
| 2026-10-12 | `dbd0e3a` | fix(video-prompt): 删掉可抄的 ❌ 反例形状（模型照抄了「0-4 全景固定 ＋ 4-7 同一全景横移」） |
| 2026-10-12 | `b6a2ebb` | fix(video-prompt): 清掉日/韩文各语言里残留的「3 秒一段」旧口径 + 中文拍长枚举 |
| 2026-10-12 | `617a0b6` | fix(breakdown): 拆解流程单清掉「段首/段尾 2 秒不写台词」旧口径（中/日/韩） |
| 2026-10-12 | `3d3f2dc` | fix(prompt): 真凶——流程单里写着「长台词要么拆成两拍，要么挪到窗口更长的拍」 |
| 2026-10-12 | `6e804aa` | fix(video-prompt): 正文里也去掉「已废弃旧规则」的引用（引用旧规则=给模型可抄材料） |
| 2026-10-12 | `acaa7a0` | fix(video-prompts): 代码里那个「2-5秒→5-8秒」3 拍样例 + onlySkills 逻辑 bug |
| 2026-10-12 | `795e454` | fix(agents): DEFAULT_PROMPTS 兜底里也清掉「按 3 秒为一段 / 1-2 个连续 3 秒段」 |
| 2026-10-12 | `b16a0ee` | fix: 拆解流程单四语言 + DEFAULT_PROMPTS 兜底，去掉「引用旧规则」的写法 |
| 2026-10-12 | `3b4ebf9` | fix(agents): 修编译错误 —— DEFAULT_PROMPTS 模板串里误用了反引号（CI #88 失败） |
| 2026-10-12 | `100fe94` | fix(video-prompt): 「每段一个镜头状态」逼模型把「切镜+推近」拆两拍（分镜4 的 7 秒假切点） |
| 2026-10-12 | `e3c1891` | fix(video-prompt): 补「description 里一个景别+一个运镜 = 一拍」的映射规则 |
| 2026-10-12 | `5c3310b` | fix(video-prompt): 拍数上限的「+1」被模型当成额度 —— 改成「一拍对应一个镜头」 |
| 2026-10-12 | `5049e6b` | feat(video-prompts): 中文工作版按【镜头N】数量硬校验 + 不符合自动重写 |
| 2026-10-12 | `88e1615` | fix(breakdown/video-prompt): description 必须带【镜头N】标记 + 无标记时的拍数兜底 |
| 2026-10-12 | `9deec77` | fix(video-prompt): 按引擎口径讲清「硬切是什么」——文字里写"不作硬切"无效 |
| 2026-10-12 | `9c72341` | feat(video-prompts): 中文工作版也吃「补充说明」（此前只有英文版吃） |
| 2026-10-12 | `c92cd7c` | perf(video-prompts): A 合并重写（请求数 8~12 → ≤3）+ B 模板写死逐段配额 |
| 2026-10-12 | `1b13c3c` | perf(video-prompts): B 补齐流程单两处（CN 配额表头 / EN 合计行） |
| 2026-10-12 | `81fe581` | fix(video-prompts): 六段缺失静默漏段 → 补写 + 六段齐全闸（分镜7 不能续拍的真因） |
| 2026-10-12 | `a564247` | feat(settings): 文本服务器配置加「思考模式」开关（温度下方） |
| 2026-10-12 | `6df7af3` | fix(thinking): 关思考兜底档位 none → minimal（对齐 zzz halogen 的 high/medium/minimal） |
| 2026-10-12 | `9b685ba` | perf(prompts): 精简技能/流程单（每次请求少读 2 万字符） |
| 2026-10-12 | `60cd692` | perf(prompts): 按生成阶段裁剪技能注入（中文工作版少读 2.9 万字符） |
| 2026-10-12 | `392edb2` | perf(prompts): 流程单也按阶段裁剪（中文工作版再少读 1 万字符） |
| 2026-10-12 | `c91f9e6` | revert(prompts): 撤回「按章节分段注入」的内容标记（会裁掉共享规则） |
| 2026-10-12 | `74efdb3` | fix(video-prompts): 分组标题漏进正文 + 英文版拍数不校验 + 说话人编号/声音身份 |
| 2026-10-12 | `cfb6a8e` | fix(video-prompts): 英文版拍数修复漏传补充说明+中文时间轴，且校验排在它之前 |
| 2026-10-12 | `c4a99e8` | fix(episode): 历史视频预览被 refresh 无条件清空（点非当前视频自动切回当前） |
| 2026-10-13 | `f036a4b` | feat(storyboards): 视频提示词「体检」按钮（单条分镜，只读） |
| 2026-10-13 | `0bbd509` | feat(prompt-check): 体检 v2 —— 诊断报告结构 + 参考素材预检 + 一键修复 |
| 2026-10-13 | `be61bff` | fix(prompt): 手持物「没被提取成道具资产就不许编号」+ 体检抓「编造的主体编号」 |
| 2026-10-13 | `f2ec046` | feat(prompt-check): 整集体检（总按钮 + 总览页 + 单击跳转 + 一键修复全部） |
| 2026-10-13 | `c4b683f` | fix(prompt): 英文版禁止出现中文（含 retention_analysis 标注）+ 体检加 en-has-chinese |
| 2026-10-13 | `e9bfd3e` | feat(prompt-check): 按钮挨着放 + 一键修复全部互斥置灰 + 进度显示 |
| 2026-10-13 | `f3a58f9` | feat(agent-context): 白名单加固 —— 把「只许用哪些参考图编号」写进模型必读上下文 |
| 2026-10-13 | `8a5e5c2` | fix(video-prompts): 英文版混中文——源头修（清洗放宽 + 断根 + 语言闸），不靠体检 |
| 2026-10-13 | `3acdfc5` | build(mac): 打包时 ad-hoc 签名，消掉「已损坏」误报（免费，不需要 Apple 证书） |
| 2026-10-13 | `432de84` | fix(video-prompts): 落库前机械清掉越界的 <Subject N>/<Picture N>（源头兜底，不靠体检） |
| 2026-10-13 | `a85cf83` | fix(prompt-check): 拍数口径修正 + 新增「拍头没独占一行」 |
| 2026-10-14 | `2e21399` | fix(recovery): 启动不再无条件判死任务 + 崩溃日志落盘 + 项目封面改版 |
| 2026-10-14 | `9f6b9d2` | fix(video-prompts): 旁白锁嘴句只许官方原句 + 旁白主语必须带 (Sx)（模板 4 文件 + 机器闸） |
| 2026-10-14 | `6ec2f7c` | feat(project): 项目设置弹窗 —— 名称/类型/简介/视觉风格/画面比例 五项可改（两处入口） |
| 2026-10-14 | `b8780c6` | fix(prompt): 英文版画风规范源头双语化 —— 预设带英文「正文渲染语言」，英文任务不再现翻中文 |
| 2026-10-14 | `cb7bde1` | fix(任务耗时/超时): 显示真实生成时间 + 批量不再误报超时 |
| 2026-10-14 | `43f6a75` | fix(提示词/提取): 「照抄道具参考图」改条件句 + 关键信息载体开提取例外 |
| 2026-10-14 | `c59ad39` | fix(资产/提示词): 「重新生成提示词」先落库再生成 + 禁止建群像角色 |
| 2026-10-14 | `4ee56fe` | fix(提取): 合并只填空、不覆盖用户手改的资产文本（妆造/描述） |
| 2026-10-14 | `9136532` | feat(提示词): 外观类字段禁止二选一（规则 + 机械体检） |
| 2026-10-14 | `ac4c146` | fix(英文版): 机械清理「紧贴英文词的游离中文」+ 修重写指令的误判 |
| 2026-10-14 | `7f2d120` | fix(提示词): 动作类约束禁用否定句（cfg=1 无负向分支）+ negated-action 机器闸 |
| 2026-10-14 | `8fccfea` | feat(换装+分镜): 换装造型变体端到端集成 + 修「画面描述改完又变回去」 |
| 2026-10-14 | `67285b0` | fix(提示词): 道具纸面文字两向闸 + 画外音拍「多出来的嘴」闸（两起实测事故） |
| 2026-10-14 | `f836327` | fix(提示词): 撤回两条错误规则（道具看不清闸 / 必须显式锁嘴）+ 道具镜绝对静止 / 画外音拍零嘴部词 |
| 2026-10-14 | `4cd5580` | fix(提示词): retention_analysis 覆盖闸 —— 主体声明必须逐个对上，防道具整片没参考 |
| 2026-10-14 | `fc52456` | fix(提示词): 画外音锁嘴句必须锁「画面里的那个角色」——修本该画外音却由画面角色念出来 |
| 2026-10-14 | `19c470a` | feat(任务栏): 真正在渲染的任务显示秒表（排队中的不显示） |
| 2026-10-14 | `f540748` | rules(提示词): 多人同框必须写具体衣物 + 指定「服装以 <Picture N> 为准」 |
| 2026-10-14 | `1ac26d3` | rules(提示词): 多人同框每拍带简短辨识标签，动作紧跟标签（防动作对调） |
| 2026-10-14 | `5ffe13f` | feat(提示词进度): 批量生成提示词显示总进度条 + 本条进度（到哪一步/已用/预计剩余） |
| 2026-10-15 | `43a5bda` | feat(提示词进度): 进度条给成功/失败提示 —— 绿红分色 + 逐条流水 + 结束后保留结果 |
| 2026-10-15 | `7f83677` | fix(提示词): 压缩轮白跑导致整条判失败 —— 逐段写回 + 空转不占轮次 + 后置轮长度回滚 |
| 2026-10-15 | `20baca6` | feat(换装造型): 源图可选本剧已有形象 + 造型卡也能再次换装 |
| 2026-10-15 | `8ea041e` | chore(ci): 空提交触发编包（验证 fork Actions 是否可用） |
| 2026-10-15 | `7b7837b` | feat(换装): 衣服描述 AI 生成 + 造型角色可沿用原角色声音 |

</details>

---

## 上游 README 原文（未改动，供对照）

# 🎬 Huobao Drama - AI Short Drama Generation Platform

<div align="center">

**A full-stack TypeScript platform for automated AI short-drama production**

[![Node Version](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Download](https://img.shields.io/github/v/release/chatfire-AI/huobao-drama?style=flat&logo=github&label=Download)](https://github.com/chatfire-AI/huobao-drama/releases/latest)

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

[Features](#-features) • [Quick Start](#-quick-start) • [Walkthrough](#-visual-walkthrough) • [Desktop App](#-desktop-app-recommended) • [Deployment](#-deployment)

<h2>🔑 <a href="https://api.firemux.com">Get a Huobao API Key 👉 Get started</a></h2>

**Text, image, and video AI capabilities — one key unlocks everything**

After deploying, paste the key in "Settings → Huobao Quick Setup" to write three recommended configs in one click

<h3>📥 <a href="https://github.com/chatfire-AI/huobao-drama/releases/latest">Download Desktop App (macOS / Windows)</a></h3>
<h3>🌐 <a href="https://www.chatfire.site">Official Website</a></h3>

</div>

---

## 📖 Overview

Huobao Drama is an AI-powered short-drama production platform that automates the entire pipeline: script generation, character design, storyboard breakdown, and video compositing.

### 🎯 Core Value

- **🤖 AI-Driven**: LLMs parse scripts and extract characters, scenes, and storyboard information
- **🎨 Intelligent Creation**: AI image generation for character designs and scene backgrounds
- **📹 Video Generation**: Text-to-video and image-to-video models automatically produce storyboard clips
- **🔄 End-to-End Workflow**: A complete pipeline from idea to finished episode

### 🛠️ Architecture

```
frontend/   — Nuxt 3 + Vue 3 + TypeScript (pure CSS, no UI framework)
backend/    — Hono + Drizzle ORM + Mastra AI Agents + better-sqlite3
backend/workspace/skills/ — Agent skill definitions (SKILL.md, editable in the UI)
desktop/    — Electron desktop app (main process + esbuild + electron-builder dmg/exe)
data/       — Generated assets and the SQLite database
```

---

## ✨ Features

### 🎭 Character Management

- ✅ AI-generated character designs
- ✅ Batch character generation
- ✅ Character image upload and management

### 🎬 Video Tasks

- ✅ Automatic AI video-task generation
- ✅ Scene descriptions and video prompt generation
- ✅ Batch video generation per task

### 🎥 Video Generation

- ✅ Text-to-video generation
- ✅ FFmpeg per-shot compositing and subtitle handling
- ✅ Full-episode stitching and export

### 📦 Asset Management

- ✅ Unified asset library
- ✅ Local storage support
- ✅ Task progress tracking

### 🤖 AI Agents

Four built-in Mastra agents with database-backed configuration and Skill extensions:

| Agent | Role |
|---|---|
| `script_rewriter` | Novel → formatted script rewriting |
| `extractor` | Intelligent extraction and dedup of characters / scenes / props |
| `storyboard_breaker` | Script → storyboard sequence breakdown |
| `prompt_generator` | Image prompts for characters/scenes/props + storyboard video prompts |

### 🌐 Multi-Language UI

The interface ships in **中文 / English / 日本語 / 한국어**, with a global setting for AI-generated content language.

### 🔌 Multi-Provider Support

| Type | Providers |
|---|---|
| **Text** | OpenAI (compatible APIs), Gemini |
| **Image** | OpenAI, Gemini, Volcano Engine |
| **Video** | Volcano Engine Seedance 2.0 (Standard / Fast / Mini), MiniMax H3, Alibaba Bailian Wan 3.0 (Prime / Standard) |

---

## 🚀 Quick Start

### 📋 Requirements

| Software | Version | Notes |
|---|---|---|
| **Node.js** | 20+ | Runtime for frontend and backend |
| **npm** | 9+ | Package manager |

> **Zero-install database**: Bundled SQLite (single file in the project data directory) — no database server required.
> **No FFmpeg install needed**: Binaries ship via the `ffmpeg-static` / `ffprobe-static` npm packages — works out of the box.

### ⚙️ Environment Variables

No config files — everything is set via environment variables (all have defaults; local dev needs zero configuration):

| Variable | Default | Description |
|---|---|---|
| `SQLITE_PATH` | `<repo>/data/huobao.sqlite3` | SQLite database file location |
| `PORT` | `5679` | Backend service port |
| `STORAGE_PATH` | `<repo>/data/static` | Generated-file storage directory |
| `HUOBAO_DATA_DIR` | — | Injected by the Electron main process (userData data root) |
| `WORKSPACE_PATH` | `backend/workspace` | Agent skills/prompts directory (desktop: writable copy under userData) |
| `FRONTEND_DIST` | `frontend/dist` | Frontend static build directory |
| `FFMPEG_BIN` / `FFPROBE_BIN` | bundled npm binaries | Custom ffmpeg/ffprobe executable paths |
| `PUBLIC_BASE_URL` | — | Public URL Seedance needs to reference local assets (server deployments) |

> **Note**: AI service API keys, base URLs, and model parameters are all configured in the web UI "Settings" page and stored in the database — never in config files or environment variables.

### 📥 Installation

```bash
# Clone the repository
git clone https://github.com/chatfire-AI/huobao-drama.git
cd huobao-drama

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 🎯 Running

#### Option 1: Development mode (recommended)

Frontend and backend run separately with hot reload:

```bash
# Terminal 1: backend
cd backend
npm run dev

# Terminal 2: frontend
cd frontend
npm run dev
```

- Frontend: `http://localhost:3013`
- Backend API: `http://localhost:5679/api/v1`
- The frontend automatically proxies `/api` and `/static` to the backend

#### Option 2: Single-service mode

The backend serves both the API and the frontend static files:

```bash
# 1. Build the frontend
cd frontend && npm run generate

# 2. Copy the build output where the backend expects it
#    (generate outputs to .output/public; the backend reads frontend/dist)
cp -r .output/public dist

# 3. Start the backend
cd ../backend && npm start
```

Visit: `http://localhost:5679`

### 🗄️ Database

Bundled SQLite (`better-sqlite3` + WAL mode). Tables are created automatically on first launch (idempotent DDL replay + seed data). Default file: `data/huobao.sqlite3`, overridable via `SQLITE_PATH`. The desktop app stores data in the user-data directory (`~/Library/Application Support/HuobaoDrama/data/`).

Migrating data from a legacy MySQL deployment:

**Automatic migration on startup (recommended)**: When MySQL is explicitly configured (`DATABASE_URL` or `MYSQL_HOST`) and the SQLite database is empty, the backend automatically detects and imports all tables once (per-table row-count validation, single-transaction atomic writes, automatic rollback with retry on next launch, and a `.mysql-imported` marker to avoid re-importing). Set `MYSQL_AUTO_IMPORT=false` to disable.

```bash
# Or run manually (non-empty target requires --force; automatic backup before writing)
cd backend && npx tsx scripts/import-mysql-to-sqlite.ts
```

> Migration covers database rows only; media files (images/videos) under the old deployment's `data/static/` must be copied manually, or historical assets won't load.

### 🔑 First Use: Configure AI Services

All AI features (text/image/video) require model services to be configured first — a banner at the top of the page guides you until then:

1. Open the "Settings" page
2. Paste your Huobao API key in "Huobao Quick Setup" ([get one at api.firemux.com](https://api.firemux.com)) to write three recommended configs (text, image, video) in one click
3. Or add providers one by one via "Manual Templates", with connectivity testing

Once configured, the banner disappears and you can start producing episodes.

---

## 📖 Visual Walkthrough

The complete pipeline from novel to finished episode. The left progress rail always shows where you are.

### Step 1 · Create a Project

On the home page click "New Project", pick a **aspect ratio** (16:9 landscape / 9:16 portrait, fixed after creation) and a **visual style** (3D, realistic, … — injected into every image prompt).

<p align="center">
  <img src="docs/screenshots/02-create-drama.png" alt="Create a project" width="800">
</p>

<p align="center">
  <img src="docs/screenshots/01-projects.png" alt="Project list" width="800">
</p>

### Step 2 · Configure AI Services (first run)

Paste an API key in Settings → "Huobao Quick Setup" to write the three recommended configs at once, or add providers manually. The current model can be switched any time from the top bar (see Step 5).

<p align="center">
  <img src="docs/screenshots/03-settings-quick.png" alt="AI service setup" width="800">
</p>

### Step 3 · Script Stage

Paste your **source novel** into the workbench, then hit "AI Rewrite" to produce a shooting script — split by episode with scenes and characters annotated. You can switch text models and tone while rewriting.

<p align="center">
  <img src="docs/screenshots/05-script.png" alt="Script stage" width="800">
</p>

### Step 4 · Assets

Run **extraction** on the script to get the character / scene / prop list, then generate a consistent reference image for each (or in batch). These images are injected as reference material when generating videos.

<p align="center">
  <img src="docs/screenshots/06-assets.png" alt="Asset production" width="800">
</p>

### Step 5 · Storyboard & Videos

On the "Video Production" page, first run **storyboard breakdown** (AI splits shots and writes video prompts). Then:

- Pick the **video model** in the top bar (Seedance / Wan 3.0 / MiniMax…); resolution and duration tiers follow the model
- Review and tweak each shot's prompt on the right (`@character` references map to reference images automatically)
- Click "Batch Generate Videos"; failed tasks can be retried in one click

<p align="center">
  <img src="docs/screenshots/07-storyboard.png" alt="Storyboard breakdown" width="800">
</p>

<p align="center">
  <img src="docs/screenshots/08-videos.png" alt="Video generation" width="800">
</p>

### Step 6 · Merge & Export

Select shots (hover to preview each clip), click "Start Merging" and FFmpeg assembles the full episode — play online or download. Click "Mark Done" when finished to light up the progress rail.

<p align="center">
  <img src="docs/screenshots/09-export.png" alt="Merge & export" width="800">
</p>

The episode list shows the production status of every episode — click "Enter Studio" to continue:

<p align="center">
  <img src="docs/screenshots/04-episodes.png" alt="Episode list" width="800">
</p>

---

## 📦 Deployment

### 🖥️ Desktop App (recommended)

**⬇️ Prebuilt installers: [GitHub Releases](https://github.com/chatfire-AI/huobao-drama/releases/latest) · [Mirror for China (Tencent COS)](https://installer.chatfire.site/huobao-drama/v4.0.5/)**

| Platform | File to download |
|---|---|
| macOS (Apple Silicon, M-series) | `HuobaoDrama-4.0.5-arm64.dmg` |
| macOS (Intel) | `HuobaoDrama-4.0.5.dmg` |
| Windows | `HuobaoDrama.Setup.4.0.5.exe` |

> China users: use the COS mirror above (GitHub is slow/unreachable in mainland China). The in-app updater also checks the COS mirror first, then falls back to GitHub.

**Command-line install (recommended, no Gatekeeper fix needed)**: downloading via curl never sets macOS's quarantine attribute, so the app opens cleanly with no "damaged" prompt (use the `-arm64.dmg` for Apple Silicon, the plain dmg for Intel):

```bash
curl -L -o /tmp/HuobaoDrama.dmg https://installer.chatfire.site/huobao-drama/v4.0.5/HuobaoDrama-4.0.5-arm64.dmg \
  && hdiutil attach -nobrowse /tmp/HuobaoDrama.dmg \
  && cp -R /Volumes/HuobaoDrama*/HuobaoDrama.app /Applications/ \
  && hdiutil detach /Volumes/HuobaoDrama*
```

No build required — download the dmg/exe and install. Installed clients auto-update via the built-in updater. (To package from source instead, see the commands below.)

Double-click to install, works out of the box (macOS + Windows): the SQLite database, generated media, and Agent skills all live in the user-data directory — uninstalling the app does not affect your data.

```bash
# One-command packaging (frontend generate → backend esbuild → electron-builder)
npm run dist        # macOS dmg (arm64 + Intel)
npm run dist:win    # Windows NSIS installer (win-x64, cross-buildable on macOS)

# Artifacts
# desktop/release/HuobaoDrama-<version>-arm64.dmg     (Apple Silicon)
# desktop/release/HuobaoDrama-<version>.dmg           (Intel)
# desktop/release/HuobaoDrama Setup <version>.exe     (Windows)
```

Installation notes:

- The macOS build is unsigned — on first launch you may see "App is damaged and can't be opened" (common on Apple Silicon). This is Gatekeeper's quarantine attribute, not actual file damage. Two ways to fix it:
  1. **The dmg bundles a fix script**: after dragging the app into Applications, double-click the "如提示已损坏请双击我.command" script at the bottom of the dmg window — it removes the quarantine attribute automatically;
  2. Or run `sudo xattr -cr /Applications/HuobaoDrama.app` in Terminal.

  The fix is one-time only — the app then launches normally, and in-app auto-updates are not affected.
- The Windows build is unsigned — SmartScreen will prompt "More info → Run anyway"
- User-data directory: `~/Library/Application Support/HuobaoDrama/` (database, generated media, writable copies of online-edited skills)
- FFmpeg/FFprobe binaries are bundled — no system install needed
- Electron is pinned to 37.x: better-sqlite3's win32 prebuilds max out at that ABI (the key to compilation-free cross-packaging)
- External links open in the system browser (e.g. "Get a key at api.firemux.com")

#### 🔄 In-App Updates (no Apple signing required)

The desktop app ships with a built-in updater (same class of solution as Tauri: directory replacement on macOS / silent installer on Windows, with local sha256 verification). To publish a new release:

```bash
# 1. Bump version in desktop/package.json, then package
npm run dist        # macOS (produces dmg + update zip)
npm run dist:win    # Windows (produces Setup.exe)

# 2. Generate the release manifest release/latest.json (with per-platform sha256)
cd desktop && npm run feed

# 3. Publish: upload latest.json + installers + zips to a GitHub Release (tag like v1.0.1)
```

Installed clients check the manifest automatically after launch (manual check available in "Settings → About & Updates") and prompt to download and install when a new version is found. Override the manifest URL with the `HUOBAO_UPDATE_FEED` environment variable.

Desktop development:

```bash
npm run build:frontend   # frontend static output (frontend/.output/public)
cd desktop && npm run dev  # bundle the backend and run in an Electron window
```

> Known limitation: Seedance video models need a `PUBLIC_BASE_URL` public address to reference local assets; the desktop app has no public entry point, so that scenario produces a clear error message. Text-to-video, image generation, and all other capabilities are unaffected.

---

### 🏭 Server Deployment

```bash
# 1. Build the frontend
cd frontend && npm run generate

# 2. Copy the build output (generate outputs to frontend/.output/public; the backend reads
#    frontend/dist — skip this step and the API works but pages 404)
cp -r .output/public dist && cd ..

# 3. Start the backend
cd backend && npm start
```

Files to upload to the server:

```
backend/                    # backend source + node_modules
backend/workspace/skills/   # Agent skill files
frontend/dist/              # frontend build output
data/                       # data directory (auto-created on first run)
```

#### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Max 50MB for reference video/audio uploads
    client_max_body_size 100m;

    # Generated images/videos served straight from disk, bypassing Node:
    # sendfile zero-copy + long-lived caching
    # (files are uuid-named and immutable, so immutable caching is safe)
    location /static/ {
        alias /path/to/huobao-drama/data/static/;
        sendfile on;
        tcp_nopush on;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://localhost:5679;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> Media loading optimization: the backend automatically generates 400px thumbnails (`*_thumb.webp`) for list pages and extracts poster frames (`*_poster.jpg`) as video covers — the frontend only loads original files when opening the full image or playing. To backfill historical files, run `npm run backfill-artwork` under `backend/`.

### 🐳 Docker Deployment (with in-app updates)

**Option A — prebuilt image (no clone, no build):** multi-arch (`linux/amd64` + `linux/arm64`), x86 servers and ARM devices match automatically

```bash
docker pull huobao/huobao-drama:4.0.6

docker run -d \
  --name huobao-drama \
  -p 5679:5679 \
  -v huobao-data:/app/data \
  --restart unless-stopped \
  huobao/huobao-drama:4.0.6
```

**Option B — docker compose (source build + Watchtower in-app updates):** the repo root provides an all-in-one `Dockerfile` (three stages: frontend generate + backend dependencies + runtime; the backend runs via tsx just like server deployment) and `docker-compose.yml` (app + Watchtower):

```bash
# 1. Configure the environment (Watchtower token — must match on the app and watchtower sides)
cp .env.example .env   # edit WATCHTOWER_TOKEN

# 2. Build and start (inject a version at publish time for "About & Updates" comparison)
HUOBAO_VERSION=4.0.5 docker compose up -d --build

# 3. Visit http://localhost:5679
```

- **Data persistence**: the named volume `huobao-data` mounts `/app/data` (SQLite + generated images/videos + workspace/skills) — image updates don't lose data
- **In-app updates**: the compose file ships a [Watchtower](https://containrrr.dev/watchtower/) sidecar (`--label-enable` only updates labeled containers, `--cleanup` removes old images, daily self-check). "Settings → About & Updates" can check for new versions and "Update Now" — the backend triggers it via the Watchtower HTTP API, which pulls the new image and rebuilds the container; refresh the page after a few minutes
- **Manual mode**: remove the app's two `HUOBAO_WATCHTOWER_*` env vars (or the whole watchtower service) from `docker-compose.yml` — "About & Updates" then degrades to a new-version notice + manual `docker compose pull && docker compose up -d`
- **Publishing images**: `docker buildx build --platform linux/amd64,linux/arm64 --build-arg HUOBAO_VERSION=x.y.z -t huobao/huobao-drama:x.y.z -t huobao/huobao-drama:latest --push .` — the version manifest is shared with the desktop app via `latest.json` on GitHub Releases (overridable with `HUOBAO_UPDATE_FEED`)

---

## 🎨 Tech Stack

### Backend

- **Runtime**: Node.js 20+
- **Web framework**: Hono
- **ORM**: Drizzle ORM + better-sqlite3 (WAL mode)
- **AI Agents**: Mastra + AI SDK (OpenAI compatible)
- **Video processing**: FFmpeg (fluent-ffmpeg + bundled binaries)
- **Image processing**: Sharp

### Desktop

- **Shell**: Electron (utilityProcess hosts the backend; BrowserWindow loads same-origin)
- **Packaging**: esbuild (single-file backend bundle) + electron-builder (dmg arm64/x64, NSIS win-x64)

### Frontend

- **Framework**: Nuxt 3 (SPA mode)
- **Language**: Vue 3 + TypeScript
- **Routing**: File-based routing (Vue Router 4)
- **Styling**: Pure CSS + CSS Variables
- **Icons**: Lucide Vue
- **i18n**: vue-i18n (中文 / English / 日本語 / 한국어)

---

## 📝 FAQ

### Q: Where does the desktop app store data?

A: `~/Library/Application Support/HuobaoDrama/data/` (SQLite database + generated images/videos); writable copies of online-edited skills live in the sibling `workspace/` directory. In development mode the repo's `data/` directory is used instead.

### Q: How do I migrate legacy MySQL data to SQLite?

A: Keep MySQL reachable (environment variables or `backend/.env`), then run `cd backend && npx tsx scripts/import-mysql-to-sqlite.ts`. The script creates tables automatically, imports table-by-table, and validates row counts (non-empty targets require `--force`; a backup is made before writing).

### Q: FFmpeg not installed or not found?

A: No install needed. The project bundles `ffmpeg-static` / `ffprobe-static` binaries (carried along in the desktop package). A system `PATH` FFmpeg won't conflict either, and you can point explicitly via `FFMPEG_BIN`/`FFPROBE_BIN`.

### Q: The top of the page says "No model configured"?

A: That's the normal first-deploy guidance. Go to "Settings" and use "Huobao Quick Setup" to paste an API key and write configs in one click, or add providers via "Manual Templates". The banner disappears once text, image, and video all have an enabled config.

### Q: The frontend can't reach the backend API?

A: Check that the backend is running and the port is correct. In dev mode the proxy config lives in `frontend/nuxt.config.ts`.

### Q: Database tables not created?

A: The backend creates all tables automatically on first launch — check the logs to confirm initialization succeeded.

---

## 📋 Changelog

### v4.0.0 (2026-08)

#### 🖥️ Desktop App + Database Migration

- Electron desktop app (macOS dmg, arm64/x64 dual architecture)
  - Double-click install, works out of the box: automatic port selection, single-instance lock, crash-isolated backend subprocess
  - User-data isolation: SQLite database / generated media / skill copies all live in the userData directory
  - FFmpeg/FFprobe bundled; workspace skill templates copied on first launch, upgrades only fill gaps without overwriting
- Database fully migrated from MySQL to SQLite (better-sqlite3 + WAL)
  - Zero business-code changes (the Drizzle query layer is naturally portable); idempotent DDL replay
  - New one-shot import script `import-mysql-to-sqlite.ts` (per-table row-count validation + automatic backup)
- Backend bundled to a single file with esbuild (externals: sharp/better-sqlite3/ffmpeg binary packages)
- Removed Docker/MySQL deployment (recoverable from git history)

### v3.1.0 (2026-09)

- Added Alibaba Bailian Wan 3.0 video models (Prime / Standard, official `input.media`/`parameters` payloads)
- Resolution selector in the workbench top bar with native tiers per provider (Seedance 480p/720p, MiniMax 768P/2K, Wan 480P/720P/1080P)
- Default video model changed to Seedance 2.0 Mini
- Fixed generation errors caused by provider/model mismatch when switching video models
- Batch video: selection mode + pre-generation confirmation (shot count / total duration / model / resolution), one-click retry for failed tasks
- Storyboard duration now editable directly in the video-generation params area, applied to single and batch generation
- Content-moderation failures (real-person / sensitive content) now prompt to switch models and retry

### v3.0.0 (2026-08)

#### 🚀 Deployment & Experience Improvements

- Docker deployment readiness
  - MySQL / app health checks; the app waits for the database before starting
  - Database initialization retries — zero manual intervention on first containerized deploy
  - Removed the system FFmpeg dependency; bundled binaries everywhere
  - Agent skills directory volume persistence (online edits in Settings survive)
  - New `docker/init.sql` and export scripts (DBA review / pre-created tables)
- First-use guidance
  - Site-wide banner guiding to Settings when no AI service is configured
  - New "Huobao Quick Setup" in Settings: one key writes three recommended configs (text/image/video)
  - Unconfigured-model errors localized with pointers to Settings
- Default video model changed to Seedance 2.0 Fast
- Provider consolidation: OpenAI / Gemini / Volcano Engine only
- Workbench: task-list drawer, pipeline stage status, selective stitching (validates video files exist before merging)
- Asset library redesign, @mention improvements, episode list rework

### v2.0.0 (2026-04)

#### 🚀 Major Update

- Full migration to a TypeScript stack
  - Backend: Hono + Drizzle ORM + mysql2
  - Frontend: Nuxt 3 + Vue 3
  - AI Agents: Mastra framework
- Episode workbench UI and production flow rebuilt
  - More compact console layout
  - Storyboard editing area rebuilt
  - Shot image, video, compositing, and export screens rebuilt
- Docker deployment support — frontend and backend merged into a single image
- Runtime Skill loading mechanism
- Expanded multi-provider media adapters
  - Image: OpenAI, Gemini, Volcano Engine, Alibaba
  - Video: Volcano Engine/Seedance, Vidu, Alibaba
- Improved local file handling and on-demand reference-image transcoding

### v1.0.4 (2026-01-27)

- Local storage strategy to avoid dead external asset links
- Base64 reference-image embedded transport
- Fixed shot-switch state reset
- Scene migration to chapters

### v1.0.3 (2026-01-16)

- Database concurrency performance improvements
- Docker cross-platform support for host.docker.internal

### v1.0.2 (2026-01-14)

- Fixed video-generation API response parsing
- OpenAI Sora video endpoint configuration
- Improved error handling and logging

---

## 📄 License

This project is licensed under **[CC BY-NC-SA 4.0](LICENSE)** (Attribution-NonCommercial-ShareAlike 4.0 International).

- ✅ Personal use, learning, and non-commercial projects are welcome
- ✅ Modifications and redistribution allowed under the same license with attribution
- ❌ **Commercial use is prohibited** — you may not use this project, in whole or in part, for any commercial purpose (including paid services, commercial deployments, or resale) without prior written permission from the author

Full license text: see [LICENSE](LICENSE).

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Common checks:

```bash
cd backend && npm run typecheck
cd ../frontend && npm run build
```

---

## ☕ Donate

If this project helps you, buy the author a coffee ☕ — your support keeps the updates coming!

<div align="center">
  <img src="donate.png" alt="Alipay donation QR code" width="240" />
</div>

---

## 💬 WeChat Group

Scan the QR code to join the WeChat group:

<div align="center">
  <img src="docs/images/wx-group.jpg" width="200" alt="WeChat group QR code" />
</div>

---

> _"Let AI do the creating with us"_

## 🔗 Links

This project has been recognized with a link from the [LINUX DO](https://linux.do/) community.

- [LINUX DO](https://linux.do/) — a genuine open-source spirit, a community built on sharing

---

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=chatfire-ai/huobao-drama&type=date&legend=top-left)](https://www.star-history.com/?repos=chatfire-ai%2Fhuobao-drama&type=date&legend=top-left)
