<template>
  <div class="page">
    <!-- Header：与短剧页同款单行紧凑头部 -->
    <div class="page-head card">
      <button v-if="current" class="back-btn" title="返回列表" @click="back" :disabled="busy">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <div class="head-info">
        <h1 class="page-title">{{ current ? (pj.title || '未命名 MV') : '音乐 MV' }}</h1>
        <button v-if="current" class="btn btn-icon btn-sm title-edit-btn" title="改名称" @click="openRename">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <span v-if="current" class="tag tag-accent">{{ statusZh(pj.status) }}</span>
        <span v-if="current && styleLabel(pj.style)" class="tag">{{ styleLabel(pj.style) }}</span>
        <div class="page-meta">
          <span class="meta-item" v-if="current">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
            {{ Number(pj.songSeconds || 0).toFixed(1) }}s
          </span>
          <span class="meta-item" v-if="!current">上传一首歌 + 分镜提示词 → 初步分镜 → 资产制作 → 视频制作</span>
        </div>
      </div>
      <div class="head-actions">
        <span v-if="busy && stepMsg" class="busy-hint">{{ stepMsg }}</span>
        <button class="btn btn-sm" @click="loadProjects" :disabled="busy">刷新</button>
        <button v-if="!current" class="btn btn-primary btn-sm" @click="showCreate = true" :disabled="busy">新建 MV</button>
      </div>
    </div>

    <!-- 项目列表 -->
    <div v-if="!current" class="mv-grid">
      <div v-if="!projects.length" class="card mv-empty">还没有 MV 项目，点右上角「新建 MV」开始。</div>
      <div v-for="p in projects" :key="p.id" class="card mv-item" @click="openProject(p.id)">
        <div class="mv-item-title">{{ p.title || '未命名 MV' }}</div>
        <div class="mv-item-meta">
          <span class="tag">{{ Number(p.songSeconds || 0).toFixed(1) }}s</span>
          <span class="tag">{{ statusZh(p.status) }}</span>
          <span v-if="p.style" class="tag">{{ styleLabel(p.style) }}</span>
        </div>
      </div>
    </div>

    <!-- 项目详情：四页（照短剧的分页做法） -->
    <template v-else>
      <div class="mv-layout">
        <aside class="mv-side">
          <div class="mv-side-title">MV 制作流程</div>
          <button type="button" :class="['mv-side-item', { active: tab === 'origin' }]" @click="tab = 'origin'">
            <span class="mv-side-icon">🎵</span>
            <span class="mv-side-label">原始内容</span>
          </button>
          <button type="button" :class="['mv-side-item', { active: tab === 'outline' }]" @click="tab = 'outline'">
            <span class="mv-side-icon">📜</span>
            <span class="mv-side-label">初步分镜</span>
            <span v-if="outline.length" class="mv-side-count">{{ outline.length }}</span>
          </button>
          <button type="button" :class="['mv-side-item', { active: tab === 'assets' }]" @click="tab = 'assets'">
            <span class="mv-side-icon">🧑‍🎤</span>
            <span class="mv-side-label">资产制作</span>
            <span v-if="assets.length" class="mv-side-count">{{ assets.length }}</span>
          </button>
          <button type="button" :class="['mv-side-item', { active: tab === 'video' }]" @click="tab = 'video'">
            <span class="mv-side-icon">🎥</span>
            <span class="mv-side-label">视频制作</span>
            <span v-if="shots.length" class="mv-side-count">{{ shots.length }}</span>
          </button>
        </aside>
        <div class="mv-main">

      <!-- 第 1 页 · 原始内容 -->
      <div v-if="tab === 'origin'" class="card mv-block">
        <div class="mv-block-title">原始内容（歌 + 歌词 + 分镜提示词）</div>
        <div class="mv-row">
          <span class="mv-label">风格</span>
          <BaseSelect v-model="editStyle" :options="styleOptions" placeholder="选一个画风" searchable @update:model-value="saveStyle" />
          <span v-if="styleDesc" class="field-hint">{{ styleDesc }}</span>
          <span class="mv-label">画幅</span>
          <BaseSelect v-model="editRatio" :options="RATIOS" placeholder="画幅" @update:model-value="saveRatio" />
          <span class="field-hint">人物板固定 16:9；场景图和成片按这个比例（改了会重建画面，已出的图和已出的片不会自动重做）</span>
          <span class="field-hint">歌：{{ pj.songFile }}（{{ Number(pj.songSeconds || 0).toFixed(1) }}s）</span>
        </div>
        <label class="mv-label">歌词（可选，一行一句，用来把切点落在句界上）</label>
        <textarea v-model="lyrics" class="input textarea" rows="5" placeholder="一行一句，可留空"></textarea>
        <label class="mv-label">分镜提示词（你写的这支 MV 的画面；初步分镜和人物场景都从它来）</label>
        <textarea v-model="storyPrompt" class="input textarea" rows="10"
          placeholder="把这首歌的画面前后写清（开场什么画面、谁在做什么、场景怎么变、结尾怎么收）"></textarea>
        <div class="mv-row mv-row-end">
          <button class="btn btn-sm" @click="saveAll" :disabled="busy">保存</button>
          <button class="btn btn-primary btn-sm" @click="goNext('outline')" :disabled="busy">下一步：初步分镜 →</button>
        </div>
      </div>

      <!-- 第 2 页 · 初步分镜（AI 改写） -->
      <div v-else-if="tab === 'outline'" class="card mv-block">
        <div class="mv-block-title">初步分镜（AI 把原始内容改写成与歌等长的分镜，只写画面）</div>
        <div v-if="!storyPrompt.trim()" class="mv-warn">
          还没有分镜提示词 —— 先去第 1 步「原始内容」写好。
          <button class="btn btn-sm" @click="tab = 'origin'">去第 1 步</button>
        </div>
        <div class="mv-row">
          <button class="btn btn-primary btn-sm" @click="genOutline" :disabled="busy">AI 改写成分镜</button>
          <span class="tag">{{ outline.length }} 段</span>
          <span class="field-hint">不满意可以再点一次重写</span>
        </div>
        <ol class="mv-outline">
          <li v-for="(o, i) in outline" :key="i">
            <span class="meta-item">{{ Number(o.start).toFixed(1) }}–{{ Number(o.end).toFixed(1) }}s</span> {{ o.what }}
          </li>
        </ol>
        <div class="mv-row mv-row-end">
          <button class="btn btn-primary btn-sm" @click="goNext('assets')" :disabled="busy">下一步：资产制作 →</button>
        </div>
      </div>

      <!-- 第 3 页 · 资产制作 -->
      <div v-else-if="tab === 'assets'" class="card mv-block">
        <div class="mv-block-title">资产制作（从分镜提示词提取人物和场景 → 出图 → 生卡）</div>
        <div v-if="!hasStory() || !hasOutline()" class="mv-warn">
          {{ !hasStory() ? '还没有分镜提示词' : '还没有初步分镜' }} —— 先把前面步骤做完。
          <button class="btn btn-sm" @click="tab = !hasStory() ? 'origin' : 'outline'">去第 {{ !hasStory() ? 1 : 2 }} 步</button>
        </div>
        <div class="mv-row">
          <button class="btn btn-primary btn-sm" @click="extract" :disabled="busy">提取人物和场景</button>
          <span class="field-hint">重新提取会覆盖当前人物/场景（图和卡要重出）</span>
        </div>
        <div v-if="!assets.length" class="mv-hint">还没有资产 —— 点上面的「提取人物和场景」。</div>

        <!-- 人物（照短剧素材库：横排卡，图区固定 16:9） -->
        <template v-if="characters.length">
          <div class="mv-group-head"><span class="mv-group-name">人物</span><span class="tag">{{ characters.length }}</span></div>
          <div class="mv-char-grid">
            <article v-for="a in characters" :key="'c' + a.id" class="card mv-char-card" tabindex="0" role="button"
              @click="openEdit(a)" @keydown.enter.prevent="openEdit(a)">
              <button class="mv-del" title="删除" @click.stop="removeAsset(a)">✕</button>
              <div class="mv-char-main">
                <div class="mv-portrait">
                  <img v-if="a.image" :src="staticUrl(a.image)" :alt="a.name" class="previewable-image" @click.stop="openViewer(a)" />
                  <div v-else class="mv-cover-empty">未出图</div>
                  <span class="mv-badge" :class="a.image ? 'is-ready' : ''">{{ a.image ? '形象已生成' : '待生成' }}</span>
                </div>
                <div class="mv-char-head">
                  <div class="mv-name-row">
                    <strong class="mv-name">{{ a.name || '未命名' }}</strong>
                    <span class="tag">人物</span>
                  </div>
                  <div class="mv-summary" :title="a.appearance || a.description || ''">
                    <span class="mv-summary-label">样貌</span>{{ a.appearance || a.description || '（待填写）' }}
                  </div>
                  <div class="mv-summary" :title="a.styling || ''">
                    <span class="mv-summary-label">妆造</span>{{ a.styling || '（待填写）' }}
                  </div>
                  <div class="mv-card-btns">
                    <button class="btn btn-sm" @click.stop="genPrompt(a)" :disabled="promptBusy === a.id">
                      {{ promptBusy === a.id ? '生成中…' : (a.prompt ? '重新生成提示词' : '生成提示词') }}
                    </button>
                    <button class="btn btn-sm" @click.stop="makeImage(a)" :disabled="a.imageStatus === 'processing'">
                      {{ a.imageStatus === 'processing' ? '出图中…' : (a.image ? '重绘' : '出图') }}
                    </button>
                    <button class="btn btn-sm" @click.stop="makeCard(a)" :disabled="!a.image || cardBusy === a.id">生卡</button>
                    <span v-if="a.card" class="tag tag-success">卡已生成</span>
                  </div>
                </div>
              </div>
              <div class="mv-final" :class="{ dim: !a.prompt }" :title="a.prompt || ''">
                <span class="mv-final-label">最终提示词 · 三视图</span>{{ a.prompt || '未生成（先点「生成提示词」）' }}
              </div>
              <p v-if="a.imageStatus && a.imageStatus.startsWith('failed')" class="bad mv-asset-err">出图失败：{{ a.imageStatus.slice(8) }}</p>
            </article>
          </div>
        </template>

        <!-- 场景（照短剧素材库：竖排卡，封面跟随项目画幅） -->
        <template v-if="scenes.length">
          <div class="mv-group-head"><span class="mv-group-name">场景</span><span class="tag">{{ scenes.length }}</span></div>
          <div class="mv-scene-grid">
            <article v-for="a in scenes" :key="'s' + a.id" class="card mv-scene-card" tabindex="0" role="button"
              @click="openEdit(a)" @keydown.enter.prevent="openEdit(a)">
              <button class="mv-del" title="删除" @click.stop="removeAsset(a)">✕</button>
              <div class="mv-cover" :style="{ aspectRatio: coverAspect }">
                <img v-if="a.image" :src="staticUrl(a.image)" :alt="a.name" class="previewable-image" @click.stop="openViewer(a)" />
                <div v-else class="mv-cover-empty">未出图</div>
                <span class="mv-badge" :class="a.image ? 'is-ready' : ''">{{ a.image ? '场景已生成' : '待生成' }}</span>
              </div>
              <div class="mv-asset-body">
                <div class="mv-name-row">
                  <strong class="mv-name">{{ a.name || '未命名' }}</strong>
                  <span class="tag">场景</span>
                </div>
                <div class="mv-summary" :title="a.description || ''">
                  <span class="mv-summary-label">场景</span>{{ a.description || '（待填写）' }}
                </div>
                <div class="mv-card-btns">
                  <button class="btn btn-sm" @click.stop="genPrompt(a)" :disabled="promptBusy === a.id">
                    {{ promptBusy === a.id ? '生成中…' : (a.prompt ? '重新生成提示词' : '生成提示词') }}
                  </button>
                  <button class="btn btn-sm" @click.stop="makeImage(a)" :disabled="a.imageStatus === 'processing'">
                    {{ a.imageStatus === 'processing' ? '出图中…' : (a.image ? '重绘' : '出图') }}
                  </button>
                  <button class="btn btn-sm" @click.stop="makeCard(a)" :disabled="!a.image || cardBusy === a.id">生卡</button>
                  <span v-if="a.card" class="tag tag-success">卡已生成</span>
                </div>
                <div class="mv-final" :class="{ dim: !a.prompt }" :title="a.prompt || ''">
                  <span class="mv-final-label">最终提示词 · 场景图</span>{{ a.prompt || '未生成（先点「生成提示词」）' }}
                </div>
                <p v-if="a.imageStatus && a.imageStatus.startsWith('failed')" class="bad mv-asset-err">出图失败：{{ a.imageStatus.slice(8) }}</p>
              </div>
            </article>
          </div>
        </template>
        <div class="mv-row mv-row-end">
          <button class="btn btn-primary btn-sm" @click="goNext('video')" :disabled="busy">下一步：视频制作 →</button>
        </div>
      </div>

      <!-- 第 4 页 · 视频制作 -->
      <div v-else class="mv-block">
        <div class="card mv-block">
          <div class="mv-block-title">详细分镜（4080 按歌切段 → 配景别/机位/歌词 → 编译六段式提示词）</div>
          <div v-if="!hasOutline() || !hasCharImage()" class="mv-warn">
            {{ !hasOutline() ? '还没有初步分镜' : '还没有人物图' }} —— 先去第 {{ !hasOutline() ? 2 : 3 }} 步做完。
            <button class="btn btn-sm" @click="tab = !hasOutline() ? 'outline' : 'assets'">去第 {{ !hasOutline() ? 2 : 3 }} 步</button>
          </div>
          <div class="mv-row">
            <span class="mv-label">最长切分（秒，H3 上限 15）</span>
            <input v-model.number="maxSeconds" class="input mv-num" type="number" min="5" max="15" step="0.5" />
            <button class="btn btn-primary btn-sm" @click="genShots" :disabled="busy">切分详细分镜</button>
            <button class="btn btn-sm" @click="genPrompts" :disabled="busy">编译提示词</button>
            <span class="meta-item">中景／特写交替，只有头尾允许中远景；段内不换景别</span>
          </div>
          <table class="mv-table" v-if="shots.length">
            <thead>
              <tr>
                <th>#</th><th>起点</th><th>时长</th><th>帧</th><th>唱/非唱</th>
                <th>景别</th><th>机位（英文，留空用默认固定机位）</th><th>歌词</th>
                <th>提示词</th><th>状态</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in shots" :key="s.id">
                <td>{{ s.shotNumber }}</td>
                <td>{{ Number(s.startSeconds || 0).toFixed(2) }}s</td>
                <td>{{ Number(s.seconds || 0).toFixed(2) }}s</td>
                <td>{{ s.frames }}</td>
                <td>
                  <select v-model="s.vocalState" class="input mv-cell" @change="saveShot(s)">
                    <option value="vocal_active">唱</option>
                    <option value="non_vocal">非唱</option>
                  </select>
                </td>
                <td>
                  <select v-model="s.shotSize" class="input mv-cell" @change="saveShot(s)">
                    <option value="中远景">中远景</option>
                    <option value="中景">中景</option>
                    <option value="近景">近景</option>
                    <option value="特写">特写</option>
                  </select>
                </td>
                <td><input v-model="s.camera" class="input mv-cell-wide" @blur="saveShot(s)" /></td>
                <td><input v-model="s.lyric" class="input mv-cell-wide" @blur="saveShot(s)" /></td>
                <td><span class="ok" v-if="s.prompt">有</span><span class="dim" v-else>—</span></td>
                <td>
                  <span class="tag" :class="s.status === 'completed' ? 'tag-success' : (s.status === 'failed' ? 'tag-error' : '')">
                    {{ statusZh(s.status) }}
                  </span>
                  <span v-if="s.errorMsg" class="bad"> {{ s.errorMsg.slice(0, 40) }}</span>
                </td>
                <td class="mv-actions">
                  <button class="btn btn-sm" @click="render(s)" :disabled="busy || s.status === 'processing'">
                    {{ s.videoUrl ? '重做' : '生成' }}
                  </button>
                  <a v-if="s.videoUrl" class="btn btn-ghost btn-sm" :href="staticUrl(s.videoUrl)" target="_blank">看</a>
                </td>
              </tr>
            </tbody>
          </table>
          <pre v-if="shots[0]?.prompt" class="mv-prompt">首段提示词预览：{{ shots[0].prompt }}</pre>
        </div>

        <div class="card mv-block">
          <div class="mv-block-title">出片</div>
          <div class="mv-row">
            <button class="btn btn-primary btn-sm" @click="renderAll" :disabled="busy">依次生成全部片段</button>
            <button class="btn btn-sm" @click="assemble" :disabled="busy">合成成片</button>
            <span class="tag">已完成 {{ shots.filter(s => s.videoUrl).length }}/{{ shots.length }}</span>
            <span class="meta-item">每段约 1~4 分钟，按段排队跑</span>
          </div>
          <video v-if="pj.outputUrl" class="mv-video" :src="staticUrl(pj.outputUrl)" controls />
          <div v-if="pj.outputUrl" class="mv-row">
            <a class="btn btn-sm" :href="staticUrl(pj.outputUrl)" target="_blank">打开成片</a>
          </div>
        </div>
      </div>
        </div>
      </div>
    </template>

    <!-- 图片放大（照短剧素材库：点图弹大图，点空白关掉） -->
    <div v-if="viewer.open" class="mv-modal mv-viewer-overlay" @click.self="viewer.open = false">
      <div class="card mv-modal-box mv-viewer">
        <div class="mv-viewer-head">
          <span class="mv-viewer-title">{{ viewer.title }}</span>
          <button class="btn btn-ghost btn-sm" @click="viewer.open = false">关闭</button>
        </div>
        <img :src="viewer.src" :alt="viewer.title" class="mv-viewer-img" />
      </div>
    </div>

    <!-- 编辑资产（点卡片弹出，照短剧：左边大图 + 右边表单） -->
    <Teleport to="body">
      <div v-if="editAsset" class="mv-modal" @click.self="editAsset = null">
        <div class="card mv-dialog">
          <div class="mv-dialog-media">
            <img v-if="editAsset.image" :src="staticUrl(editAsset.image)" :alt="editAsset.name" @click="openViewer(editAsset)" />
            <div v-else class="mv-cover-empty">未出图</div>
          </div>
          <div class="mv-dialog-form">
            <h3>{{ editAsset.kind === 'character' ? '编辑人物' : '编辑场景' }}</h3>
            <label class="mv-label">名字</label>
            <input v-model="editAsset.name" class="input" />
            <template v-if="editAsset.kind === 'character'">
              <label class="mv-label">样貌（脸 / 身形；颜色写唯一值，别写「或」）</label>
              <textarea v-model="editAsset.appearance" class="input textarea" rows="3"></textarea>
              <label class="mv-label">妆造（服装 / 配饰）</label>
              <textarea v-model="editAsset.styling" class="input textarea" rows="3"></textarea>
            </template>
            <label class="mv-label">{{ editAsset.kind === 'character' ? '描述（提取时写的原文，可留空）' : '场景描述（地点 / 时间 / 光线 / 色调 / 氛围）' }}</label>
            <textarea v-model="editAsset.description" class="input textarea" rows="4"></textarea>
            <label class="mv-label">最终提示词（点「生成提示词」写入，也可以手改）</label>
            <textarea v-model="editAsset.prompt" class="input textarea" rows="5" placeholder="还没生成"></textarea>
            <div class="mv-modal-actions">
              <button class="btn btn-sm" @click="editAsset = null">取消</button>
              <button class="btn btn-sm" @click="genPrompt(editAsset)" :disabled="promptBusy === editAsset.id">
                {{ promptBusy === editAsset.id ? '生成中…' : '生成提示词' }}
              </button>
              <button class="btn btn-primary btn-sm" @click="saveAssetFull">保存</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 新建弹窗 -->
    <div v-if="showCreate" class="mv-modal" @click.self="showCreate = false">
      <div class="card mv-modal-box">
        <h3>新建 MV</h3>
        <label class="mv-label">名称</label>
        <input v-model.trim="form.title" class="input" placeholder="例：翻到那一页" />

        <label class="mv-label">歌文件（mp3/wav）</label>
        <input class="input" type="file" accept="audio/*" @change="onSong" />

        <label class="mv-label">风格</label>
        <BaseSelect v-model="form.style" :options="styleOptions" placeholder="选一个画风" searchable />
        <span v-if="formStyleDesc" class="field-hint">{{ formStyleDesc }}</span>

        <label class="mv-label">画幅</label>
        <BaseSelect v-model="form.aspectRatio" :options="RATIOS" placeholder="选画幅" />
        <span class="field-hint">人物板固定 16:9；场景图和成片按这个比例</span>

        <label class="mv-label">分镜提示词（人物和场景从它提取；先空着也行，进项目再写）</label>
        <textarea v-model="form.storyPrompt" class="input textarea" rows="5"
          placeholder="例：开场雨夜的城市街道，主角撑伞独行；副歌切到房间里翻旧照片……"></textarea>

        <label class="mv-label">最长切分（秒，默认 10，最大 15）</label>
        <input v-model.number="form.maxShotSeconds" class="input mv-num" type="number" min="5" max="15" step="0.5" />

        <div class="mv-modal-actions">
          <button class="btn btn-sm" @click="showCreate = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="createProject" :disabled="busy || !form.song">
            {{ busy ? '建项目中…' : '建项目' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 改名弹窗 -->
    <div v-if="showRename" class="mv-modal" @click.self="showRename = false">
      <div class="card mv-modal-box mv-modal-sm">
        <h3>改名称</h3>
        <input v-model.trim="renameTitle" class="input" placeholder="名称" @keyup.enter="doRename" />
        <div class="mv-modal-actions">
          <button class="btn btn-sm" @click="showRename = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="doRename" :disabled="busy || !renameTitle">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { api, stylePresetAPI } from '~/composables/useApi'

const projects = ref([])
const current = ref(null)
const shots = ref([])
const assets = ref([])
const presets = ref([])
const busy = ref(false)
const stepMsg = ref('')
const showCreate = ref(false)
const showRename = ref(false)
const renameTitle = ref('')
const editAsset = ref(null)
const cardBusy = ref(null)
const promptBusy = ref(null)
const viewer = ref({ open: false, src: '', title: '' })
const editRatio = ref('9:16')
const tab = ref('origin')
const maxSeconds = ref(10)
const storyPrompt = ref('')
const lyrics = ref('')
const editStyle = ref('')
const form = reactive({ title: '', style: '', storyPrompt: '', aspectRatio: '9:16', maxShotSeconds: 10, song: null })

/** 画幅（与短剧同一个思路：只有 H3 支持的两种；动态图/封面按它显示） */
const RATIOS = [
  { label: '9:16 竖屏（手机/抖音）', value: '9:16' },
  { label: '16:9 横屏', value: '16:9' },
]
const coverAspect = computed(() => String(pj.value.aspectRatio || '9:16').replace(':', ' / '))

const pj = computed(() => current.value?.project || {})
const characters = computed(() => assets.value.filter((a) => a.kind === 'character'))
const scenes = computed(() => assets.value.filter((a) => a.kind === 'scene'))
const outline = computed(() => {
  try { return JSON.parse(pj.value.outline || '[]') } catch { return [] }
})
const styleOptions = computed(() => presets.value.map((p) => ({ label: p.name, value: p.value })))
const styleDesc = computed(() => presets.value.find((p) => p.value === editStyle.value)?.description || '')
const formStyleDesc = computed(() => presets.value.find((p) => p.value === form.style)?.description || '')

let timer = null

const ZH = { draft: '未开始', planned: '有粗分镜', shots: '有分镜', rendering: '出片中', done: '已完成', pending: '待生成', processing: '生成中', completed: '已完成', failed: '失败' }
function statusZh(s) { return ZH[s] || s || '' }
function staticUrl(rel) { return rel ? `/static/${rel}` : '' }
function styleLabel(key) { return presets.value.find((p) => p.value === key)?.name || key || '' }

/** 前一步没做就别往下走：拦下来并告诉他去哪一步 */
function need(ok, msg) {
  if (ok) return true
  alert(msg)
  return false
}
const hasStory = () => !!storyPrompt.value.trim()
const hasOutline = () => outline.value.length > 0
const hasCharImage = () => characters.value.some((a) => a.image)

/** 全链路门禁：第 2 步要原始内容，第 3 步要初步分镜，第 4 步要人物图 */
function guardStep(n) {
  if (n >= 2 && !hasStory()) return need(false, '先去第 1 步「原始内容」写好分镜提示词')
  if (n >= 3 && !hasOutline()) return need(false, '先去第 2 步「初步分镜」点「AI 改写成分镜」')
  if (n >= 4 && !hasCharImage()) return need(false, '先去第 3 步「资产制作」提取人物并出图')
  return true
}

function goNext(to) {
  const step = to === 'outline' ? 2 : to === 'assets' ? 3 : 4
  if (!guardStep(step)) return
  tab.value = to
}

async function call(fn, msg) {
  busy.value = true
  stepMsg.value = msg || ''
  try {
    return await fn()
  } catch (err) {
    alert(String(err?.message || err))
    return null
  } finally {
    busy.value = false
    stepMsg.value = ''
  }
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('读文件失败'))
    fr.readAsDataURL(file)
  })
}

async function loadPresets() {
  const r = await stylePresetAPI.list().catch(() => null)
  presets.value = r || []
  if (!form.style && presets.value.length) form.style = presets.value[0].value
}

async function loadProjects() {
  const r = await call(() => api.get('/mv/projects'))
  if (r) projects.value = r.items || []
}

function onSong(e) {
  const f = e.target.files?.[0]
  if (f) form.song = f
}

async function createProject() {
  const r = await call(async () => api.post('/mv/projects', {
    title: form.title,
    style: form.style,
    story_prompt: form.storyPrompt,
    aspect_ratio: form.aspectRatio,
    max_shot_seconds: form.maxShotSeconds,
    song: { name: form.song?.name || 'song.mp3', data: await toBase64(form.song) },
  }), '正在建项目…')
  if (!r) return
  showCreate.value = false
  form.title = ''; form.storyPrompt = ''; form.song = null
  await loadProjects()
  await openProject(r.id)
}

async function openProject(id) {
  const r = await call(() => api.get(`/mv/projects/${id}`))
  if (!r) return
  current.value = r
  sync(r)
  tab.value = 'origin'
  syncTimer()
}

function sync(r) {
  shots.value = r.shots || []
  assets.value = r.assets || []
  storyPrompt.value = r.project.storyPrompt || ''
  lyrics.value = r.project.lyrics || ''
  editStyle.value = r.project.style || ''
  editRatio.value = r.project.aspectRatio || '9:16'
  maxSeconds.value = Number(r.project.maxShotSeconds || 10)
}

function back() {
  current.value = null
  shots.value = []
  assets.value = []
  loadProjects()
}

async function refresh() {
  const r = await call(() => api.get(`/mv/projects/${pj.value.id}`))
  if (r) { current.value = r; sync(r) }
}

function openRename() {
  renameTitle.value = pj.value.title || ''
  showRename.value = true
}

async function doRename() {
  const r = await call(() => api.put(`/mv/projects/${pj.value.id}`, { title: renameTitle.value }))
  if (!r) return
  showRename.value = false
  current.value = { ...current.value, project: r.project }
  await loadProjects()
}

async function saveAll() {
  const r = await call(() => api.put(`/mv/projects/${pj.value.id}`, {
    story_prompt: storyPrompt.value, lyrics: lyrics.value,
  }))
  if (r) {
    current.value = { ...current.value, project: r.project }
    stepMsg.value = '已保存'
    setTimeout(() => { if (stepMsg.value === '已保存') stepMsg.value = '' }, 1200)
  }
}

async function saveStyle(v) {
  const r = await call(() => api.put(`/mv/projects/${pj.value.id}`, { style: v }))
  if (r) current.value = { ...current.value, project: r.project }
}

async function saveRatio(v) {
  const r = await call(() => api.put(`/mv/projects/${pj.value.id}`, { aspect_ratio: v }))
  if (r) current.value = { ...current.value, project: r.project }
}

/** 点图看大图（照短剧素材库：点一下弹大图） */
function openViewer(a) {
  if (!a.image) return
  viewer.value = { open: true, src: staticUrl(a.image), title: `${a.kind === 'character' ? '人物' : '场景'} · ${a.name || ''}` }
}

/** 点卡片 → 编辑弹窗（名字 / 样貌 / 妆造 / 描述 / 最终提示词），与短剧一样在弹窗里改 */
function openEdit(a) {
  editAsset.value = { ...a }
}

async function saveAssetFull() {
  const a = editAsset.value
  if (!a) return
  try {
    const r = await api.put(`/mv/projects/${pj.value.id}/assets/${a.id}`, {
      name: a.name, description: a.description,
      appearance: a.appearance, styling: a.styling, prompt: a.prompt,
    })
    if (r) assets.value = r.assets || []
    editAsset.value = null
  } catch (err) {
    alert(String(err?.message || err))
  }
}

/** 生成提示词：把资产描述写成一段能直接出图的提示词（在这之前不许出图） */
async function genPrompt(a) {
  if (!need(!!String(a.description || a.appearance || a.styling || '').trim(), '这个资产还没有描述 —— 先写清外貌/场景，再生成提示词')) return
  if (promptBusy.value === a.id) return
  promptBusy.value = a.id
  try {
    const r = await api.post(`/mv/projects/${pj.value.id}/assets/${a.id}/prompt`, {
      name: a.name, description: a.description, appearance: a.appearance, styling: a.styling,
    })
    if (r) assets.value = r.assets || []
    if (r && editAsset.value && editAsset.value.id === a.id) {
      const fresh = (r.assets || []).find((x) => x.id === a.id)
      if (fresh) editAsset.value = { ...fresh }
    }
  } catch (err) {
    alert(String(err?.message || err))
  } finally {
    promptBusy.value = null
  }
}

async function extract() {
  if (!guardStep(3)) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/extract`, { story_prompt: storyPrompt.value }),
    'LLM 正在提取人物和场景…')
  if (r) {
    assets.value = r.assets || []
    await refresh()
  }
}

async function removeAsset(a) {
  const r = await call(() => api.delete(`/mv/projects/${pj.value.id}/assets/${a.id}`))
  if (r) assets.value = r.assets || []
}

/** 出图：提交后立刻返回，真出图在后台按项目排队（一张在跑，别的卡照样能点） */
async function makeImage(a) {
  if (!need(!!a.prompt, '先点「生成提示词」，再出图')) return
  try {
    const r = await api.post(`/mv/projects/${pj.value.id}/assets/${a.id}/image`, {
      name: a.name, description: a.description, prompt: a.prompt,
    })
    if (r) assets.value = r.assets || []
    syncTimer()
  } catch (err) {
    alert(String(err?.message || err))
  }
}

/** 生卡：单张几秒，只锁这一张的按钮 */
async function makeCard(a) {
  if (!need(!!a.image, '先给这个资产「出图」，再生卡')) return
  if (cardBusy.value === a.id) return
  cardBusy.value = a.id
  try {
    const r = await api.post(`/mv/projects/${pj.value.id}/assets/${a.id}/card`, {})
    if (r) assets.value = r.assets || []
  } catch (err) {
    alert(String(err?.message || err))
  } finally {
    cardBusy.value = null
  }
}

async function genOutline() {
  if (!guardStep(2)) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/plan`, {}), 'LLM 正在写初步分镜…')
  if (r) await refresh()
}

async function genShots() {
  if (!guardStep(4)) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/shots`, { max_seconds: maxSeconds.value }), '正在按歌切段…')
  if (r) await refresh()
}

async function genPrompts() {
  if (!guardStep(4)) return
  if (!need(shots.value.length, '先点「切分详细分镜」，再来编译提示词')) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/prompts`, {}), '正在编译六段式提示词…')
  if (r) await refresh()
}

async function saveShot(s) {
  await api.put(`/mv/projects/${pj.value.id}/shots/${s.id}`, {
    shot_size: s.shotSize, camera: s.camera, lyric: s.lyric, vocal_state: s.vocalState,
  }).catch((err) => alert(String(err?.message || err)))
}

async function render(s) {
  if (!need(!!s.prompt, `第 ${s.shotNumber} 段还没有提示词 —— 先点「编译提示词」`)) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/shots/${s.id}/render`, {}))
  if (r) { s.status = 'processing'; syncTimer() }
}

async function renderAll() {
  if (!need(shots.value.length, '先在「视频制作」页点「切分详细分镜」')) return
  for (const s of shots.value) {
    if (s.videoUrl) continue
    if (!s.prompt) { alert(`第 ${s.shotNumber} 段还没提示词 —— 先点「编译提示词」`); return }
    await render(s)
    await new Promise((res) => setTimeout(res, 1200))
  }
}

async function assemble() {
  if (!need(shots.value.length, '先在「视频制作」页点「切分详细分镜」并生成分段')) return
  const done = shots.value.filter((s) => s.videoUrl).length
  if (!need(done === shots.value.length, `还有 ${shots.value.length - done} 段没生成完，全部生成完才能合成`)) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/assemble`, {}), '正在拼接并混入原曲…')
  if (r) await refresh()
}

async function pollOnce() {
  if (!current.value || busy.value) return
  const r = await api.get(`/mv/projects/${pj.value.id}`).catch(() => null)
  if (!r) return
  current.value = r
  shots.value = r.shots || []
  // 资产只同步「出图状态 / 图 / 卡」，别把正在编辑的名字和描述冲掉
  for (const na of r.assets || []) {
    const cur = assets.value.find((x) => x.id === na.id)
    if (cur) { cur.image = na.image; cur.imageStatus = na.imageStatus; cur.card = na.card }
    else assets.value.push(na)
  }
  syncTimer()
}

function syncTimer() {
  const needPoll = shots.value.some((s) => s.status === 'processing')
    || assets.value.some((a) => a.imageStatus === 'processing')
  if (needPoll && !timer) timer = setInterval(pollOnce, 6000)
  if (!needPoll && timer) { clearInterval(timer); timer = null }
}

onMounted(async () => {
  await loadPresets()
  await loadProjects()
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
/* 页壳照抄短剧页（app/views/drama/detail.vue） */
.page {
  padding: 20px 28px 40px;
  overflow-y: auto;
  height: 100%;
  animation: fadeUp 0.35s var(--ease-out) both;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-lg);
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.head-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.title-edit-btn { flex: 0 0 auto; color: var(--text-3); }
.title-edit-btn:hover { color: var(--accent); background: var(--accent-bg); }
.back-btn {
  width: 30px; height: 30px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%;
  background: var(--overlay-track); color: var(--text-1);
  cursor: pointer;
  transition: background 0.16s var(--ease-out), color 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out);
}
.back-btn:hover { background: var(--bg-active); color: var(--text-0); }
.back-btn:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }
.page-title {
  font-size: 17px; font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.page-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.meta-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-2); }

/* 左侧流程导航 + 右侧内容（照短剧 episode/detail 的左导航布局） */
.mv-layout { display: flex; gap: 16px; align-items: flex-start; }
.mv-side {
  width: 210px; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px;
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--surface-raised);
  position: sticky; top: 0;
}
.mv-side-title {
  font-size: 11px; font-weight: 650; letter-spacing: 0.06em;
  color: var(--text-3); padding: 6px 10px 4px;
}
.mv-side-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 8px 10px; font-size: 13px; font-weight: 550; cursor: pointer;
  border: none; border-radius: var(--radius); background: transparent; color: var(--text-1);
  transition: all 0.16s var(--ease-out);
}
.mv-side-item:hover { background: var(--bg-hover); color: var(--text-0); }
.mv-side-item.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 650; }
.mv-side-item:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }
.mv-side-icon { width: 26px; text-align: center; font-size: 15px; }
.mv-side-label { flex: 1; min-width: 0; }
.mv-side-count {
  font-size: 10px; font-weight: 700; font-family: var(--font-mono);
  background: var(--bg-active); color: var(--text-2);
  padding: 1px 6px; border-radius: 99px;
}
.mv-side-item.active .mv-side-count { background: var(--accent-bg); color: var(--accent-text); }
.mv-main { flex: 1; min-width: 0; }

/* 列表 */
.mv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.mv-empty { padding: 28px; text-align: center; color: var(--text-3); }
.mv-item { padding: 14px 16px; cursor: pointer; }
.mv-item:hover { border-color: var(--accent); }
.mv-item-title { font-weight: 700; margin-bottom: 8px; }
.mv-item-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

/* 步骤块 */
.mv-block { padding: 14px 16px; margin-bottom: 14px; }
.card.mv-block + .card.mv-block { margin-top: 14px; }
.mv-block-title { font-weight: 700; font-size: 13px; margin-bottom: 10px; }
.mv-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.mv-row-end { justify-content: flex-end; margin-top: 10px; }
.mv-label { display: block; font-size: 12px; color: var(--text-2); margin: 8px 0 4px; }
.mv-num { width: 88px; }
.mv-hint { font-size: 12px; color: var(--text-3); padding: 6px 0; }
.field-hint { font-size: 11.5px; color: var(--text-3); }
.mv-warn {
  display: flex; align-items: center; gap: 10px;
  font-size: 12.5px; color: var(--warning-text, var(--text-1));
  background: var(--warning-bg, var(--bg-2));
  border-radius: var(--radius);
  padding: 8px 12px; margin-bottom: 10px;
}

/* 资产卡（照短剧素材库：卡片窄、可多张并排；人物竖排 = 图区 16:9 + 信息 + 提示词行） */
.mv-group-head { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; }
.mv-group-name { font-size: 12.5px; font-weight: 700; }
.mv-char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 260px)); justify-content: start; gap: 10px; }
.mv-scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; align-items: stretch; }
.mv-char-card, .mv-scene-card { position: relative; overflow: hidden; display: flex; flex-direction: column; }
.mv-char-card { cursor: pointer; }
.mv-scene-card { cursor: pointer; }
.mv-char-card:hover, .mv-scene-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-lift, 0 6px 18px rgba(0,0,0,.08)); }
.mv-char-card:focus-visible, .mv-scene-card:focus-visible { outline: none; border-color: var(--accent-glow, var(--accent)); box-shadow: 0 0 0 3px var(--button-focus), var(--shadow-panel, none); }
.mv-char-main { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
.mv-char-head { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.mv-portrait {
  width: 100%; position: relative; flex-shrink: 0;
  aspect-ratio: 16 / 9;                     /* 人物图区固定 16:9（与出图尺寸 2048x1152 一致） */
  border: 1px solid var(--surface-outline, var(--border)); border-radius: var(--radius);
  background: var(--bg-2); overflow: hidden;
}
.mv-portrait img, .mv-cover img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
.mv-cover {
  position: relative; width: 100%;
  border-bottom: 1px solid var(--border); background: var(--bg-2); overflow: hidden;
}
.mv-cover-empty { width: 100%; height: 100%; min-height: 90px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-3); }
.mv-badge {
  position: absolute; left: 6px; bottom: 6px;
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 99px;
  background: rgba(0, 0, 0, 0.55); color: #fff;
}
.mv-badge.is-ready { background: var(--success-bg, var(--accent-bg)); color: var(--tag-success-text, var(--accent-text)); }
.mv-del {
  position: absolute; top: 8px; right: 8px; z-index: 3;
  width: 22px; height: 22px; border-radius: 50%; border: none;
  background: rgba(0, 0, 0, 0.5); color: #fff; cursor: pointer;
  opacity: 0; transition: opacity 0.15s, background 0.15s;
}
.mv-char-card:hover .mv-del, .mv-scene-card:hover .mv-del { opacity: 1; }
.mv-del:hover { background: var(--action-danger); }
.mv-asset-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.mv-name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.mv-name { font-size: 12.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-summary { font-size: 11.5px; line-height: 1.45; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-summary-label { color: var(--text-3); margin-right: 4px; }
.mv-card-btns { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: auto; }
.mv-final {
  padding: 6px 8px; font-size: 11px; line-height: 1.45;
  border-top: 1px solid var(--border); background: var(--bg-input);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mv-final-label { color: var(--text-3); margin-right: 4px; }

.mv-outline { margin: 6px 0 0; padding-left: 20px; font-size: 12.5px; line-height: 1.8; }
.mv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mv-table th { text-align: left; color: var(--text-3); font-weight: 600; padding: 6px; border-bottom: 1px solid var(--border); }
.mv-table td { padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.mv-cell { padding: 3px 8px; font-size: 12px; height: 26px; width: auto; }
.mv-cell-wide { padding: 3px 8px; font-size: 12px; height: 26px; min-width: 160px; }
.mv-actions { display: flex; gap: 6px; }
.ok { color: var(--tag-success-text, var(--accent-text)); }
.bad { color: var(--action-danger); }
.dim { color: var(--text-3); }
.busy-hint { font-size: 12px; color: var(--accent-text); }
.mv-video { width: 100%; max-width: 420px; border-radius: var(--radius-lg); margin-top: 6px; }
.mv-prompt {
  white-space: pre-wrap; font-family: var(--font-mono, monospace);
  font-size: 11.5px; line-height: 1.6;
  background: var(--bg-input); border-radius: var(--radius);
  padding: 10px; max-height: 240px; overflow: auto;
}

.mv-asset-err { font-size: 11.5px; margin: 0 10px 8px; line-height: 1.5; }
/* 看大图 */
.mv-viewer-overlay { z-index: 60; }
.mv-viewer { width: min(960px, calc(100vw - 48px)); padding: 14px; }
.mv-viewer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.mv-viewer-title { font-size: 13px; font-weight: 600; }
.mv-viewer-img { width: 100%; max-height: 76vh; object-fit: contain; border-radius: var(--radius); background: var(--bg-2); display: block; }

/* 编辑资产弹窗（照短剧：左图 + 右表单） */
.mv-dialog {
  width: min(1040px, calc(100vw - 56px)); max-height: calc(100vh - 56px);
  padding: 14px; display: grid; grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
  gap: 14px; overflow: auto;
}
.mv-dialog-media {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-2); overflow: hidden; align-self: start; min-height: 140px;
}
.mv-dialog-media img { width: 100%; display: block; cursor: zoom-in; }
.mv-dialog-form { display: flex; flex-direction: column; min-width: 0; }
.mv-dialog-form h3 { margin: 0 0 6px; font-size: 15px; }
.mv-dialog-form .mv-label { display: block; margin: 10px 0 4px; }
.mv-dialog-form .textarea { font-size: 12.5px; }

/* 弹窗 */
.mv-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.mv-modal-box { padding: 18px 20px; width: 560px; max-height: 88vh; overflow: auto; }
.mv-modal-sm { width: 420px; }
.mv-modal-box h3 { margin: 0 0 12px; font-size: 15px; }
.mv-modal-box .mv-label { display: block; margin: 10px 0 4px; }
.mv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
