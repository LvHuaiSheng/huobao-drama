<template>
  <div class="mv-page">
    <header class="mv-head">
      <div>
        <h1 class="mv-title">音乐 MV</h1>
        <p class="mv-sub">
          上传一首歌 → 规划镜头 → 生成提示词 → 逐段出片。音轨用原曲（H3 只出画面）。
          <span class="dim">提交目标：{{ shimBase || '未配视频通道' }}</span>
        </p>
      </div>
      <div class="mv-head-actions">
        <button class="btn btn-sm" @click="loadProjects" :disabled="busy">刷新</button>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">新建 MV</button>
      </div>
    </header>

    <!-- 项目列表 -->
    <section v-if="!current" class="mv-list">
      <div v-if="!projects.length" class="mv-empty">还没有 MV 项目，点右上角「新建 MV」开始。</div>
      <div v-for="p in projects" :key="p.id" class="mv-card" @click="openProject(p.id)">
        <div class="mv-card-title">{{ p.title || '未命名 MV' }}</div>
        <div class="mv-card-meta">
          <span class="tag">{{ Number(p.songSeconds || 0).toFixed(1) }}s</span>
          <span class="tag">{{ p.status }}</span>
          <span class="dim">#{{ p.id }}</span>
        </div>
      </div>
    </section>

    <!-- 项目详情 -->
    <section v-else class="mv-detail">
      <div class="mv-detail-head">
        <button class="btn btn-sm" @click="current = null">← 返回列表</button>
        <strong>{{ current.project.title || '未命名 MV' }}</strong>
        <span class="tag">{{ Number(current.project.songSeconds || 0).toFixed(1) }}s</span>
        <span class="tag tag-accent">{{ current.project.status }}</span>
        <span class="dim">歌：{{ current.project.songRemoteName }}</span>
        <span class="dim">参考图 {{ refs.length }} 张</span>
      </div>

      <!-- 规划 -->
      <div class="mv-block">
        <div class="mv-block-title">1 · 镜头表</div>
        <div class="mv-row">
          <label class="mv-label">手填切点（秒，逗号分隔；留空=按人声自动切）</label>
          <input v-model.trim="boundaries" class="input" placeholder="例：16.44, 23.02, 33.86" />
          <button class="btn btn-sm btn-primary" @click="plan" :disabled="busy">规划镜头</button>
        </div>
        <div class="mv-row">
          <label class="mv-label">最短/目标/最长（秒）</label>
          <input v-model.number="planOpts.min_seconds" class="input mv-num" type="number" step="0.1" />
          <input v-model.number="planOpts.target_seconds" class="input mv-num" type="number" step="0.1" />
          <input v-model.number="planOpts.max_seconds" class="input mv-num" type="number" step="0.1" />
          <span class="dim">H3 单段只能落在 17n+5 帧网格且 ≥124 帧（5.167s），后端会自动吸附</span>
        </div>
      </div>

      <!-- 每段 -->
      <div v-if="shots.length" class="mv-block">
        <div class="mv-block-title">2 · 逐段（景别 / 机位 / 歌词）</div>
        <table class="mv-table">
          <thead>
            <tr>
              <th>#</th><th>起点</th><th>时长</th><th>帧</th><th>唱/非唱</th>
              <th>景别</th><th>机位（留空用默认固定机位）</th><th>歌词（可空）</th>
              <th>提示词</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shots" :key="s.id">
              <td>{{ s.shotNumber }}</td>
              <td>{{ Number(s.startSeconds || 0).toFixed(3) }}s</td>
              <td>{{ Number(s.seconds || 0).toFixed(3) }}s</td>
              <td>{{ s.frames }}</td>
              <td>
                <select v-model="s.vocalState" class="input mv-cell" @change="saveShot(s)">
                  <option value="vocal_active">唱</option>
                  <option value="non_vocal">非唱（闭嘴）</option>
                </select>
              </td>
              <td>
                <select v-model="s.shotSize" class="input mv-cell" @change="saveShot(s)">
                  <option value="">默认</option>
                  <option value="中远景">中远景</option>
                  <option value="中景">中景</option>
                  <option value="近景">近景</option>
                  <option value="特写">特写</option>
                </select>
              </td>
              <td><input v-model="s.camera" class="input mv-cell-wide" @blur="saveShot(s)" /></td>
              <td><input v-model="s.lyric" class="input mv-cell-wide" @blur="saveShot(s)" /></td>
              <td>
                <span :class="s.prompt ? 'mv-ok' : 'dim'">{{ s.prompt ? '有' : '—' }}</span>
              </td>
              <td>
                <span :class="s.status === 'completed' ? 'mv-ok' : (s.status === 'failed' ? 'mv-bad' : 'dim')">
                  {{ s.status }}{{ s.errorMsg ? '：' + s.errorMsg.slice(0, 30) : '' }}
                </span>
              </td>
              <td class="mv-actions">
                <button class="btn btn-sm btn-primary" @click="render(s)" :disabled="busy || s.status === 'processing'">生成</button>
                <a v-if="s.videoUrl" class="btn btn-sm" :href="'/' + s.videoUrl" target="_blank">看</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 提示词 -->
      <div v-if="shots.length" class="mv-block">
        <div class="mv-block-title">3 · 提示词（由 4080 的 MV 编译器按官方六段式生成，带硬校验）</div>
        <div class="mv-row">
          <button class="btn btn-sm btn-primary" @click="genPrompts" :disabled="busy">生成/重生成全部提示词</button>
          <button class="btn btn-sm" @click="renderAll" :disabled="busy">依次生成全部片段</button>
          <span v-if="shots[0]" class="dim">首段预览：</span>
        </div>
        <pre v-if="shots[0]?.prompt" class="mv-prompt">{{ shots[0].prompt }}</pre>
      </div>
    </section>

    <!-- 新建弹窗 -->
    <div v-if="showCreate" class="mv-modal" @click.self="showCreate = false">
      <div class="mv-modal-box">
        <h3>新建 MV</h3>
        <label class="mv-label">标题</label>
        <input v-model.trim="form.title" class="input" placeholder="例：翻到那一页 MV" />

        <label class="mv-label">歌曲文件（mp3/wav，后端自动转 32k 并送到 4080）</label>
        <input class="input" type="file" accept="audio/*" @change="onSong" />

        <label class="mv-label">人物参考图（第 1 张，必填）</label>
        <input class="input" type="file" accept="image/*" @change="onRef(0)" />

        <label class="mv-label">场景参考图（第 2 张，可选）</label>
        <input class="input" type="file" accept="image/*" @change="onRef(1)" />

        <label class="mv-label">首帧图（可选：想锁定第一段的景别时给）</label>
        <input class="input" type="file" accept="image/*" @change="onFirstFrame" />

        <label class="mv-label">人物描述（给 H3 的身份句）</label>
        <input v-model.trim="form.performer" class="input" placeholder="留空用默认：参考图里的人" />

        <label class="mv-label">风格句</label>
        <input v-model.trim="form.style" class="input" placeholder="留空用默认：cinematic music video, natural skin…" />

        <div class="mv-modal-actions">
          <button class="btn btn-sm" @click="showCreate = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="createProject" :disabled="busy || !form.song">
            建项目（{{ busy ? '上传中…' : '上传歌 + 参考图' }}）
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { api } from '~/composables/useApi'

const projects = ref([])
const current = ref(null)
const shots = ref([])
const refs = ref([])
const shimBase = ref('')
const busy = ref(false)
const showCreate = ref(false)
const boundaries = ref('')
const planOpts = reactive({ min_seconds: 5.167, target_seconds: 7, max_seconds: 10 })
const form = reactive({ title: '', song: null, refs: [null, null], firstFrame: null, performer: '', style: '' })

let timer = null

async function call(fn, okMsg) {
  busy.value = true
  try {
    const r = await fn()
    if (okMsg) console.log('[MV]', okMsg)
    return r
  } catch (err) {
    alert(String(err?.message || err))
    return null
  } finally {
    busy.value = false
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

async function loadConfig() {
  const r = await call(() => api.get('/mv/config'))
  shimBase.value = r?.base || ''
}

function onSong(e) {
  const f = e.target.files?.[0]
  if (f) form.song = f
}
function onRef(i) {
  return (e) => {
    const f = e.target.files?.[0]
    if (f) form.refs[i] = f
  }
}
function onFirstFrame(e) {
  const f = e.target.files?.[0]
  if (f) form.firstFrame = f
}

async function createProject() {
  const payload = {
    title: form.title || '未命名 MV',
    song: { name: form.song?.name || 'song.mp3', data: await toBase64(form.song) },
    ref_images: [],
    first_frame: form.firstFrame ? { name: 'first_frame.png', data: await toBase64(form.firstFrame) } : null,
    performer: form.performer,
    style: form.style,
  }
  for (const f of form.refs) {
    if (f) payload.ref_images.push({ name: f.name, data: await toBase64(f) })
  }
  const r = await call(() => api.post('/mv/projects', payload), '建项目')
  if (!r) return
  showCreate.value = false
  form.title = ''
  form.song = null
  form.refs = [null, null]
  form.firstFrame = null
  await loadProjects()
  await openProject(r.id)
}

async function openProject(id) {
  const r = await call(() => api.get(`/mv/projects/${id}`))
  if (!r) return
  current.value = r
  shots.value = r.shots || []
  try {
    refs.value = JSON.parse(r.project.refImages || '[]')
  } catch {
    refs.value = []
  }
  syncTimer()
}

async function plan() {
  const id = current.value.project.id
  const bs = boundaries.value
    .split(/[,，\s]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0)
  const r = await call(() =>
    api.post(`/mv/projects/${id}/plan`, {
      boundaries: bs.length ? bs : undefined,
      min_seconds: planOpts.min_seconds,
      target_seconds: planOpts.target_seconds,
      max_seconds: planOpts.max_seconds,
    })
  )
  if (r) {
    shots.value = r.shots || []
    current.value.project.status = 'planned'
  }
}

async function saveShot(s) {
  const id = current.value.project.id
  await call(() =>
    api.put(`/mv/projects/${id}/shots/${s.id}`, {
      shot_size: s.shotSize,
      camera: s.camera,
      lyric: s.lyric,
      vocal_state: s.vocalState,
    })
  )
}

async function genPrompts() {
  const id = current.value.project.id
  const r = await call(() => api.post(`/mv/projects/${id}/prompts`, {}))
  if (r) shots.value = r.shots || []
}

async function render(s) {
  const id = current.value.project.id
  const r = await call(() => api.post(`/mv/projects/${id}/shots/${s.id}/render`, {}))
  if (r) {
    s.taskId = r.task_id
    s.status = 'processing'
    syncTimer()
  }
}

async function renderAll() {
  for (const s of shots.value) {
    if (s.status === 'completed') continue
    if (!s.prompt) {
      alert(`第 ${s.shotNumber} 段没有提示词，先生成提示词`)
      return
    }
    await render(s)
    await new Promise((res) => setTimeout(res, 1500))
  }
}

async function pollOnce() {
  if (!current.value) return
  const id = current.value.project.id
  const pending = shots.value.filter((s) => s.status === 'processing')
  for (const s of pending) {
    try {
      const r = await api.get(`/mv/projects/${id}/shots/${s.id}/status`)
      const fresh = r?.shot
      if (fresh) {
        s.status = fresh.status
        s.videoUrl = fresh.videoUrl
        s.errorMsg = fresh.errorMsg
      }
    } catch {
      /* 轮询失败不打断 */
    }
  }
  syncTimer()
}

function syncTimer() {
  const need = shots.value.some((s) => s.status === 'processing')
  if (need && !timer) timer = setInterval(pollOnce, 5000)
  if (!need && timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(async () => {
  await loadConfig()
  await loadProjects()
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.mv-page { padding: 18px 22px 40px; max-width: 1500px; }
.mv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.mv-title { font-size: 20px; font-weight: 800; margin: 0; }
.mv-sub { margin: 4px 0 0; font-size: 12px; color: var(--text-2); }
.mv-head-actions { display: flex; gap: 8px; }
.mv-empty { padding: 28px; text-align: center; color: var(--text-3); border: 1px dashed var(--border); border-radius: 12px; }
.mv-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.mv-card { border: 1px solid var(--border); background: var(--bg-1); border-radius: 12px; padding: 12px 14px; cursor: pointer; }
.mv-card:hover { border-color: var(--accent); }
.mv-card-title { font-weight: 700; margin-bottom: 6px; }
.mv-card-meta { display: flex; gap: 6px; align-items: center; font-size: 12px; }
.mv-detail-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.mv-block { border: 1px solid var(--border); background: var(--bg-1); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
.mv-block-title { font-weight: 700; font-size: 13px; margin-bottom: 10px; }
.mv-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.mv-label { font-size: 12px; color: var(--text-2); min-width: 96px; }
.mv-num { width: 82px; }
.mv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mv-table th { text-align: left; color: var(--text-3); font-weight: 600; padding: 6px 6px; border-bottom: 1px solid var(--border); }
.mv-table td { padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.mv-cell { padding: 3px 6px; font-size: 12px; height: 26px; }
.mv-cell-wide { padding: 3px 6px; font-size: 12px; height: 26px; min-width: 150px; }
.mv-actions { display: flex; gap: 6px; }
.mv-ok { color: #16a34a; }
.mv-bad { color: var(--action-danger); }
.dim { color: var(--text-3); font-size: 12px; }
.mv-prompt { white-space: pre-wrap; font-family: var(--font-mono, monospace); font-size: 11.5px; line-height: 1.5; background: var(--bg-2); border-radius: 8px; padding: 10px; max-height: 260px; overflow: auto; }
.mv-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.mv-modal-box { background: var(--bg-1); border-radius: 14px; padding: 18px 20px; width: 520px; max-height: 88vh; overflow: auto; }
.mv-modal-box h3 { margin: 0 0 12px; font-size: 15px; }
.mv-modal-box .mv-label { display: block; margin: 10px 0 4px; min-width: 0; }
.mv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
