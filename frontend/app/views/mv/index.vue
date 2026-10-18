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
        <span v-if="current" class="tag tag-accent">{{ statusZh(pj.status) }}</span>
        <div class="page-meta">
          <span class="meta-item" v-if="current">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
            {{ Number(pj.songSeconds || 0).toFixed(1) }}s
          </span>
          <span class="meta-item" v-if="current && (pj.characterCard || pj.sceneCard)">人物卡 / 场景卡 已抽</span>
          <span class="meta-item" v-if="!current">给一首歌 → 写设定出图抽卡 → 粗分镜 → 详细分镜 → 逐段出片 → 合成</span>
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
          <span v-if="p.characterCard" class="tag tag-success">有卡</span>
        </div>
      </div>
    </div>

    <!-- 项目详情 -->
    <template v-else>
      <!-- 1 人物与场景 -->
      <div class="card mv-block">
        <div class="mv-block-title">1 · 人物与场景</div>
        <div class="mv-row">
          <button class="btn btn-sm" @click="writePrompts" :disabled="busy">AI 写设定</button>
          <button class="btn btn-sm" @click="savePrompts" :disabled="busy">保存设定</button>
          <button class="btn btn-primary btn-sm" @click="makeImages" :disabled="busy">出图</button>
          <button class="btn btn-sm" @click="makeCards" :disabled="busy || !pj.characterImage">抽卡</button>
          <span v-if="pj.characterCard" class="tag">人物卡 {{ pj.characterCard }}</span>
          <span v-if="pj.sceneCard" class="tag">场景卡 {{ pj.sceneCard }}</span>
        </div>
        <div class="mv-two">
          <div>
            <label class="mv-label">人物设定（四格定妆板：正脸特写 + 正视/左侧/背面全身）</label>
            <textarea v-model="characterPrompt" class="input textarea" rows="5" placeholder="点「AI 写设定」自动生成，可改"></textarea>
          </div>
          <div>
            <label class="mv-label">场景提示词</label>
            <textarea v-model="scenePrompt" class="input textarea" rows="5" placeholder="点「AI 写设定」自动生成，可改"></textarea>
          </div>
        </div>
        <div class="mv-two" v-if="pj.characterImage || pj.sceneImage">
          <div v-if="pj.characterImage">
            <div class="mv-label">人物板</div>
            <img class="mv-img" :src="staticUrl(pj.characterImage)" alt="人物板" />
          </div>
          <div v-if="pj.sceneImage">
            <div class="mv-label">场景图</div>
            <img class="mv-img" :src="staticUrl(pj.sceneImage)" alt="场景图" />
          </div>
        </div>
      </div>

      <!-- 2 粗分镜 -->
      <div class="card mv-block">
        <div class="mv-block-title">2 · 粗分镜（与歌等长，只写画面内容）</div>
        <div class="mv-row">
          <button class="btn btn-primary btn-sm" @click="genOutline" :disabled="busy">生成粗分镜</button>
          <span class="tag">{{ outline.length }} 段</span>
        </div>
        <ol class="mv-outline">
          <li v-for="(o, i) in outline" :key="i">
            <span class="meta-item">{{ Number(o.start).toFixed(1) }}–{{ Number(o.end).toFixed(1) }}s</span> {{ o.what }}
          </li>
        </ol>
      </div>

      <!-- 3 详细分镜 -->
      <div class="card mv-block">
        <div class="mv-block-title">3 · 详细分镜（景别 / 机位 / 歌词）</div>
        <div class="mv-row">
          <label class="mv-label">最长切分（秒，H3 上限 15）</label>
          <input v-model.number="maxSeconds" class="input mv-num" type="number" min="5" max="15" step="0.5" />
          <button class="btn btn-primary btn-sm" @click="genShots" :disabled="busy">切分详细分镜</button>
          <button class="btn btn-sm" @click="genPrompts" :disabled="busy || !shots.length">编译提示词</button>
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

      <!-- 4 出片 -->
      <div class="card mv-block">
        <div class="mv-block-title">4 · 出片</div>
        <div class="mv-row">
          <button class="btn btn-primary btn-sm" @click="renderAll" :disabled="busy || !shots.length">依次生成全部片段</button>
          <button class="btn btn-sm" @click="assemble" :disabled="busy || !shots.length">合成成片</button>
          <span class="tag">已完成 {{ shots.filter(s => s.videoUrl).length }}/{{ shots.length }}</span>
          <span class="meta-item">每段约 1~4 分钟，按段排队跑</span>
        </div>
        <video v-if="pj.outputUrl" class="mv-video" :src="staticUrl(pj.outputUrl)" controls />
        <div v-if="pj.outputUrl" class="mv-row">
          <a class="btn btn-sm" :href="staticUrl(pj.outputUrl)" target="_blank">打开成片</a>
        </div>
      </div>
    </template>

    <!-- 新建弹窗 -->
    <div v-if="showCreate" class="mv-modal" @click.self="showCreate = false">
      <div class="card mv-modal-box">
        <h3>新建 MV</h3>
        <label class="mv-label">标题</label>
        <input v-model.trim="form.title" class="input" placeholder="例：翻到那一页" />

        <label class="mv-label">歌文件（mp3/wav）</label>
        <input class="input" type="file" accept="audio/*" @change="onSong" />

        <label class="mv-label">想法（这首歌想拍成什么样，一两句就够）</label>
        <textarea v-model="form.idea" class="input textarea" rows="3" placeholder="例：一个人在城市里找旧照片，最后回到老家"></textarea>

        <label class="mv-label">歌词（可选，用来把切点落在句界上）</label>
        <textarea v-model="form.lyrics" class="input textarea" rows="4" placeholder="一行一句，可留空"></textarea>

        <label class="mv-label">最长切分（秒，默认 10，最大 15）</label>
        <input v-model.number="form.maxShotSeconds" class="input mv-num" type="number" min="5" max="15" step="0.5" />

        <label class="mv-label">风格句（可选）</label>
        <input v-model.trim="form.style" class="input" placeholder="留空用默认：cinematic music video, natural skin…" />

        <div class="mv-modal-actions">
          <button class="btn btn-sm" @click="showCreate = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="createProject" :disabled="busy || !form.song">
            {{ busy ? '建项目中…' : '建项目' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { api } from '~/composables/useApi'

const projects = ref([])
const current = ref(null)
const shots = ref([])
const busy = ref(false)
const stepMsg = ref('')
const showCreate = ref(false)
const maxSeconds = ref(10)
const characterPrompt = ref('')
const scenePrompt = ref('')
const form = reactive({ title: '', idea: '', lyrics: '', maxShotSeconds: 10, style: '', song: null })

const pj = computed(() => current.value?.project || {})
const outline = computed(() => {
  try { return JSON.parse(pj.value.outline || '[]') } catch { return [] }
})

let timer = null

const ZH = { draft: '未开始', planned: '有粗分镜', shots: '有分镜', rendering: '出片中', done: '已完成', pending: '待生成', processing: '生成中', completed: '已完成', failed: '失败' }
function statusZh(s) { return ZH[s] || s || '' }
function staticUrl(rel) { return rel ? `/static/${rel}` : '' }

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
    idea: form.idea,
    lyrics: form.lyrics,
    style: form.style,
    max_shot_seconds: form.maxShotSeconds,
    song: { name: form.song?.name || 'song.mp3', data: await toBase64(form.song) },
  }), '正在建项目…')
  if (!r) return
  showCreate.value = false
  form.title = ''; form.idea = ''; form.lyrics = ''; form.style = ''; form.song = null
  await loadProjects()
  await openProject(r.id)
}

async function openProject(id) {
  const r = await call(() => api.get(`/mv/projects/${id}`))
  if (!r) return
  current.value = r
  sync(r)
  syncTimer()
}

function sync(r) {
  shots.value = r.shots || []
  maxSeconds.value = Number(r.project.maxShotSeconds || 10)
  characterPrompt.value = r.project.characterPrompt || ''
  scenePrompt.value = r.project.scenePrompt || ''
}

function back() {
  current.value = null
  shots.value = []
  loadProjects()
}

async function refresh() {
  const r = await call(() => api.get(`/mv/projects/${pj.value.id}`))
  if (r) { current.value = r; sync(r) }
}

async function writePrompts() {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/write`, {}), 'LLM 正在写人物与场景…')
  if (!r) return
  characterPrompt.value = r.character_prompt || ''
  scenePrompt.value = r.scene_prompt || ''
}

async function savePrompts() {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/write`, {
    character_prompt: characterPrompt.value, scene_prompt: scenePrompt.value,
  }))
  if (r) await refresh()
}

async function makeImages() {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/images`, {
    character_prompt: characterPrompt.value, scene_prompt: scenePrompt.value,
  }), '正在出人物板 + 场景图（约 1 分钟）…')
  if (r) await refresh()
}

async function makeCards() {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/cards`, {}), '正在抽卡…')
  if (r) await refresh()
}

async function genOutline() {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/plan`, {}), 'LLM 正在写粗分镜…')
  if (r) await refresh()
}

async function genShots() {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/shots`, { max_seconds: maxSeconds.value }), '正在按歌切段…')
  if (r) await refresh()
}

async function genPrompts() {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/prompts`, {}), '正在编译六段式提示词…')
  if (r) await refresh()
}

async function saveShot(s) {
  await api.put(`/mv/projects/${pj.value.id}/shots/${s.id}`, {
    shot_size: s.shotSize, camera: s.camera, lyric: s.lyric, vocal_state: s.vocalState,
  }).catch((err) => alert(String(err?.message || err)))
}

async function render(s) {
  const r = await call(() => api.post(`/mv/projects/${pj.value.id}/shots/${s.id}/render`, {}))
  if (r) { s.status = 'processing'; syncTimer() }
}

async function renderAll() {
  for (const s of shots.value) {
    if (s.videoUrl) continue
    if (!s.prompt) { alert(`第 ${s.shotNumber} 段还没提示词，先点「编译提示词」`); return }
    await render(s)
    await new Promise((res) => setTimeout(res, 1200))
  }
}

async function assemble() {
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
  const need = shots.value.some((s) => s.status === 'processing')
  if (need && !timer) timer = setInterval(pollOnce, 6000)
  if (!need && timer) { clearInterval(timer); timer = null }
}

onMounted(async () => { await loadProjects() })
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
/* 页壳照抄短剧页（app/views/drama/detail.vue 的 .page / .page-head / .page-title / .page-meta） */
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

/* 列表 */
.mv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.mv-empty { padding: 28px; text-align: center; color: var(--text-3); }
.mv-item { padding: 14px 16px; cursor: pointer; }
.mv-item:hover { border-color: var(--accent); }
.mv-item-title { font-weight: 700; margin-bottom: 8px; }
.mv-item-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

/* 步骤块 */
.mv-block { padding: 14px 16px; margin-bottom: 14px; }
.mv-block-title { font-weight: 700; font-size: 13px; margin-bottom: 10px; }
.mv-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.mv-label { display: block; font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.mv-num { width: 88px; }
.mv-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0; }
.mv-two .input { font-size: 12px; }
.mv-img { width: 100%; max-width: 320px; border-radius: var(--radius); border: 1px solid var(--border); display: block; }
.mv-video { width: 100%; max-width: 420px; border-radius: var(--radius-lg); margin-top: 6px; }
.mv-outline { margin: 6px 0 0; padding-left: 20px; font-size: 12.5px; line-height: 1.8; }
.mv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mv-table th { text-align: left; color: var(--text-3); font-weight: 600; padding: 6px; border-bottom: 1px solid var(--border); }
.mv-table td { padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.mv-cell { padding: 3px 8px; font-size: 12px; height: 26px; }
.mv-cell-wide { padding: 3px 8px; font-size: 12px; height: 26px; min-width: 160px; }
.mv-actions { display: flex; gap: 6px; }
.ok { color: var(--tag-success-text, var(--accent-text)); }
.bad { color: var(--action-danger); }
.dim { color: var(--text-3); }
.busy-hint { font-size: 12px; color: var(--accent-text); }
.mv-prompt {
  white-space: pre-wrap; font-family: var(--font-mono, monospace);
  font-size: 11.5px; line-height: 1.6;
  background: var(--bg-input); border-radius: var(--radius);
  padding: 10px; max-height: 240px; overflow: auto;
}

/* 弹窗 */
.mv-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.mv-modal-box { padding: 18px 20px; width: 560px; max-height: 88vh; overflow: auto; }
.mv-modal-box h3 { margin: 0 0 12px; font-size: 15px; }
.mv-modal-box .mv-label { margin: 10px 0 4px; }
.mv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
