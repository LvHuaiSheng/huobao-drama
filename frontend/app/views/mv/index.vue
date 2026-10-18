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
      <nav class="page-tabs">
        <button type="button" :class="['tab-btn', { on: tab === 'origin' }]" @click="tab = 'origin'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg>
          原始内容
        </button>
        <button type="button" :class="['tab-btn', { on: tab === 'outline' }]" @click="tab = 'outline'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
          初步分镜
          <span class="tab-count">{{ outline.length }}</span>
        </button>
        <button type="button" :class="['tab-btn', { on: tab === 'assets' }]" @click="tab = 'assets'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          资产制作
          <span v-if="assets.length" class="tab-count">{{ assets.length }}</span>
        </button>
        <button type="button" :class="['tab-btn', { on: tab === 'video' }]" @click="tab = 'video'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          视频制作
          <span v-if="shots.length" class="tab-count">{{ shots.length }}</span>
        </button>
      </nav>

      <!-- 第 1 页 · 原始内容 -->
      <div v-if="tab === 'origin'" class="card mv-block">
        <div class="mv-block-title">原始内容（歌 + 歌词 + 分镜提示词）</div>
        <div class="mv-row">
          <span class="mv-label">风格</span>
          <BaseSelect v-model="editStyle" :options="styleOptions" placeholder="选一个画风" searchable @update:model-value="saveStyle" />
          <span v-if="styleDesc" class="field-hint">{{ styleDesc }}</span>
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
        <div class="mv-block-title">资产制作（从分镜提示词提取人物和场景 → 出图 → 抽卡）</div>
        <div v-if="!storyPrompt.trim()" class="mv-warn">
          还没有分镜提示词 —— 先去第 1 步「原始内容」写好。
          <button class="btn btn-sm" @click="tab = 'origin'">去第 1 步</button>
        </div>
        <div class="mv-row">
          <button class="btn btn-primary btn-sm" @click="extract" :disabled="busy">提取人物和场景</button>
          <span class="field-hint">重新提取会覆盖当前人物/场景（图和卡要重出）</span>
        </div>
        <div v-if="!assets.length" class="mv-hint">还没有资产 —— 点上面的「提取人物和场景」。</div>
        <div class="mv-assets">
          <div v-for="a in assets" :key="a.id" class="card mv-asset">
            <div class="mv-asset-head">
              <span class="tag" :class="a.kind === 'character' ? 'tag-accent' : 'tag-info'">{{ a.kind === 'character' ? '人物' : '场景' }}</span>
              <input v-model="a.name" class="input mv-asset-name" @blur="saveAsset(a)" />
              <button class="btn btn-ghost btn-sm" @click="removeAsset(a)" :disabled="busy">删</button>
            </div>
            <img v-if="a.image" class="mv-asset-img" :src="staticUrl(a.image)" :alt="a.name" />
            <div v-else class="mv-asset-ph">未出图</div>
            <textarea v-model="a.description" class="input textarea" rows="4" @blur="saveAsset(a)"></textarea>
            <div class="mv-asset-foot">
              <button class="btn btn-sm" @click="makeImage(a)" :disabled="busy">出图</button>
              <button class="btn btn-sm" @click="makeCard(a)" :disabled="busy || !a.image">抽卡</button>
              <span v-if="a.card" class="tag tag-success">卡已抽</span>
            </div>
          </div>
        </div>
        <div class="mv-row mv-row-end">
          <button class="btn btn-primary btn-sm" @click="goNext('video')" :disabled="busy">下一步：视频制作 →</button>
        </div>
      </div>

      <!-- 第 4 页 · 视频制作 -->
      <div v-else class="mv-block">
        <div class="card mv-block">
          <div class="mv-block-title">详细分镜（4080 按歌切段 → 配景别/机位/歌词 → 编译六段式提示词）</div>
          <div v-if="!characters.some((c) => c.image)" class="mv-warn">
            还没有人物图 —— 先去第 3 步「资产制作」提取人物并出图。
            <button class="btn btn-sm" @click="tab = 'assets'">去第 3 步</button>
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
    </template>

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
const tab = ref('origin')
const maxSeconds = ref(10)
const storyPrompt = ref('')
const lyrics = ref('')
const editStyle = ref('')
const form = reactive({ title: '', style: '', storyPrompt: '', maxShotSeconds: 10, song: null })

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
const hasCharImage = () => characters.value.some((a) => a.image)

function goNext(to) {
  if (to === 'outline' && !need(hasStory(), '先去「原始内容」写好分镜提示词，再进「初步分镜」')) return
  if (to === 'assets' && !need(outline.value.length, '先去「初步分镜」点「AI 改写成分镜」，再进「资产制作」')) return
  if (to === 'video' && !need(hasCharImage(), '先去「资产制作」提取人物并出图，再进「视频制作」')) return
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

async function extract() {
  if (!need(hasStory(), '先去第 1 步「原始内容」写好分镜提示词，再来提取人物和场景')) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/extract`, { story_prompt: storyPrompt.value }),
    'LLM 正在提取人物和场景…')
  if (r) {
    assets.value = r.assets || []
    await refresh()
  }
}

async function saveAsset(a) {
  await api.put(`/mv/projects/${pj.value.id}/assets/${a.id}`, {
    name: a.name, description: a.description,
  }).catch((err) => alert(String(err?.message || err)))
}

async function removeAsset(a) {
  const r = await call(() => api.delete(`/mv/projects/${pj.value.id}/assets/${a.id}`))
  if (r) assets.value = r.assets || []
}

async function makeImage(a) {
  if (!need(!!String(a.description || '').trim(), '这个资产还没有描述 —— 先写清外貌/场景，再出图')) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/assets/${a.id}/image`, {
    name: a.name, description: a.description,
  }), '正在出图（约 1 分钟）…')
  if (r) assets.value = r.assets || []
}

async function makeCard(a) {
  if (!need(!!a.image, '先给这个资产「出图」，再抽卡')) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/assets/${a.id}/card`, {}), '正在抽卡…')
  if (r) assets.value = r.assets || []
}

async function genOutline() {
  if (!need(hasStory(), '先去第 1 步「原始内容」写好分镜提示词')) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/plan`, {}), 'LLM 正在写初步分镜…')
  if (r) await refresh()
}

async function genShots() {
  if (!need(hasCharImage(), '先去第 3 步「资产制作」提取人物并出图，再切分详细分镜')) return
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/shots`, { max_seconds: maxSeconds.value }), '正在按歌切段…')
  if (r) await refresh()
}

async function genPrompts() {
  if (!need(shots.value.length, '先点「切分详细分镜」，再来编译提示词')) return
  if (!need(hasCharImage(), '先去第 3 步「资产制作」提取人物并出图')) return
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
  if (r) { current.value = r; shots.value = r.shots || [] }
  syncTimer()
}

function syncTimer() {
  const needPoll = shots.value.some((s) => s.status === 'processing')
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

/* 主 Tab 导航（与 drama/detail.vue 同款） */
.page-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}
.tab-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  padding: 8px 4px 10px;
  margin-right: 20px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  transition: color 0.16s var(--ease-out);
}
.tab-btn svg { opacity: 0.75; }
.tab-btn::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.16s var(--ease-out);
}
.tab-btn:hover { color: var(--text-0); }
.tab-btn.on { color: var(--text-0); font-weight: 650; }
.tab-btn.on::after { background: var(--accent); }
.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono);
  background: var(--bg-2);
  color: var(--text-2);
}
.tab-btn.on .tab-count { background: var(--accent-bg); color: var(--accent-text); }

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

/* 资产卡 */
.mv-assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 8px; }
.mv-asset { padding: 10px 12px; background: var(--bg-input); }
.mv-asset-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.mv-asset-name { flex: 1; min-width: 0; padding: 4px 8px; font-size: 12.5px; height: 28px; }
.mv-asset-img { width: 100%; border-radius: var(--radius); border: 1px solid var(--border); display: block; margin-bottom: 8px; }
.mv-asset-ph {
  height: 120px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--text-3);
  border: 1px dashed var(--border); border-radius: var(--radius); margin-bottom: 8px;
}
.mv-asset .textarea { font-size: 12px; margin-bottom: 8px; }
.mv-asset-foot { display: flex; align-items: center; gap: 6px; }

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

/* 弹窗 */
.mv-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.mv-modal-box { padding: 18px 20px; width: 560px; max-height: 88vh; overflow: auto; }
.mv-modal-sm { width: 420px; }
.mv-modal-box h3 { margin: 0 0 12px; font-size: 15px; }
.mv-modal-box .mv-label { display: block; margin: 10px 0 4px; }
.mv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
