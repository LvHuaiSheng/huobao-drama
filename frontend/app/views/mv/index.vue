<template>
  <div class="page">
    <!-- 紧凑头部：标题 + 统计 + 新建 一行（照短剧项目启动台 pages/index.vue） -->
    <div class="launcher-head">
      <div class="head-left">
        <h1 class="launcher-title">音乐 MV</h1>
        <span class="launcher-sub">一个项目下可以建多个 MV（歌），人物和场景在项目里共用</span>
      </div>
      <div class="hero-stats">
        <span class="tag">{{ series.length }} 个项目</span>
        <span class="tag tag-success">{{ totalSongs }} 个 MV</span>
        <span class="tag tag-accent">{{ totalAssets }} 个素材</span>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" @click="showCreate = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新建 MV 项目
        </button>
      </div>
    </div>

    <div class="toolbar">
      <label class="search-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input v-model.trim="q" class="input" placeholder="搜索 MV 项目" />
      </label>
      <div class="chip-row">
        <button v-for="f in filters" :key="f.value" type="button" class="filter-chip" :class="{ on: statusFilter === f.value }"
          @click="statusFilter = f.value">{{ f.label }}</button>
      </div>
    </div>

    <div v-if="loading" class="project-grid">
      <div v-for="i in 6" :key="i" class="card skeleton-card">
        <div class="skeleton-cover"></div>
        <div class="skeleton-body">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
        </div>
      </div>
    </div>

    <div v-else-if="filtered.length" class="project-grid">
      <article
        v-for="(sr, i) in filtered"
        :key="sr.id"
        class="card project-card"
        :style="{ animationDelay: `${i * 0.04}s` }"
        tabindex="0"
        role="button"
        :aria-label="`打开 MV 项目 ${sr.title || ''}`"
        @click="openSeries(sr)"
        @keydown.enter.prevent="openSeries(sr)"
        @keydown.space.prevent="openSeries(sr)"
      >
        <div class="project-cover" :class="{ 'has-image': !!sr.cover }">
          <img v-if="sr.cover" class="cover-img" :src="staticUrl(sr.cover)" alt="" loading="lazy" />
          <div v-if="sr.cover" class="cover-shade"></div>
          <span v-else class="cover-initial">{{ initialOf(sr.title) }}</span>
          <span v-if="sr.aspectRatio" class="cover-ratio">{{ sr.aspectRatio }}</span>
          <div class="status-wrap" @click.stop>
            <span class="cover-badge">{{ sr.songCount || 0 }} 个 MV</span>
          </div>
          <div class="more-wrap" @click.stop>
            <AppMenu
              :open="menuId === sr.id"
              placement="bottom-end"
              :min-width="140"
              @update:open="(v) => { menuId = v ? sr.id : null }"
            >
              <template #trigger>
                <button class="btn btn-icon btn-sm cover-more" type="button" title="更多">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
                  </svg>
                </button>
              </template>
              <AppMenuItem @click="menuId = null; openSeries(sr)">打开项目</AppMenuItem>
              <AppMenuItem @click="openRename(sr)">改名</AppMenuItem>
              <AppMenuItem danger @click="menuId = null; deleteTarget = sr">删除项目</AppMenuItem>
            </AppMenu>
          </div>
        </div>
        <div class="project-body">
          <h2 class="project-name truncate">{{ sr.title || '未命名 MV 项目' }}</h2>
          <div class="project-meta">
            <span v-if="sr.style" class="tag tag-accent">{{ styleLabel(sr.style) }}</span>
            <span class="dim">{{ sr.songCount || 0 }} 个 MV · {{ sr.assetCount || 0 }} 个素材</span>
          </div>
          <div class="project-foot dim">
            <Clock :size="11" :stroke-width="1.8" />
            {{ fmtDate(sr.updatedAt) }}
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      </div>
      <p class="empty-title">{{ series.length ? '没有匹配的项目' : '还没有 MV 项目' }}</p>
      <p class="empty-desc">{{ series.length ? '换个关键词或筛选条件试试' : '一个项目下可以放多首歌，人物和场景在项目里共用' }}</p>
      <button v-if="!series.length" class="btn btn-primary" @click="showCreate = true">新建 MV 项目</button>
    </div>

    <!-- 新建项目：Electron 里 window.prompt 不可用 ⇒ 一律内联/弹窗输入 -->
    <div v-if="showCreate" class="overlay" @click.self="showCreate = false">
      <div class="dialog create-dialog">
        <div class="dialog-head">
          <div class="dialog-title">新建 MV 项目</div>
        </div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">项目名字 <span class="required">*</span></span>
            <input v-model.trim="newTitle" class="input" placeholder="例：翻到那一页" @keyup.enter="createSeries" />
          </label>
          <label class="field">
            <span class="field-label">画风（可选，建完也能改）</span>
            <BaseSelect v-model="newStyle" :options="styleOptions" placeholder="选一个画风" searchable />
          </label>
          <label class="field">
            <span class="field-label">画幅</span>
            <BaseSelect v-model="newRatio" :options="RATIOS" placeholder="选画幅" />
            <span class="field-hint">人物板固定 16:9；场景图和成片按这个比例</span>
          </label>
        </div>
        <div class="dialog-foot">
          <button class="btn" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" :disabled="creating || !newTitle" @click="createSeries">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 改名 -->
    <div v-if="renameTarget" class="overlay" @click.self="renameTarget = null">
      <div class="dialog create-dialog">
        <div class="dialog-head"><div class="dialog-title">改项目名字</div></div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">项目名字</span>
            <input v-model.trim="renameTitle" class="input" placeholder="项目名字" @keyup.enter="doRename" />
          </label>
        </div>
        <div class="dialog-foot">
          <button class="btn" @click="renameTarget = null">取消</button>
          <button class="btn btn-primary" :disabled="!renameTitle" @click="doRename">保存</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!deleteTarget"
      title="删除 MV 项目"
      :message="`确定删除「${deleteTarget?.title || '未命名 MV 项目'}」？项目里所有 MV 的人物 / 场景 / 分镜 / 成片记录都会一起删掉，这一步不能撤销。`"
      :loading="deleting"
      @confirm="doDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Clock } from 'lucide-vue-next'
import { api, stylePresetAPI } from '~/composables/useApi'
import BaseSelect from '~/components/BaseSelect.vue'

const series = ref([])
const loading = ref(false)
const creating = ref(false)
const deleting = ref(false)
const presets = ref([])
const q = ref('')
const statusFilter = ref('all')
const menuId = ref(null)
const showCreate = ref(false)
const newTitle = ref('')
const newStyle = ref('')
const newRatio = ref('16:9')
const renameTarget = ref(null)
const renameTitle = ref('')
const deleteTarget = ref(null)

const RATIOS = [
  { label: '9:16 竖屏（手机/抖音）', value: '9:16' },
  { label: '16:9 横屏', value: '16:9' },
]
const filters = [
  { label: '全部', value: 'all' },
  { label: '有 MV', value: 'active' },
  { label: '空项目', value: 'empty' },
]
const styleOptions = computed(() => presets.value.map((p) => ({ label: p.name, value: p.value })))
const styleLabel = (key) => presets.value.find((p) => p.value === key)?.name || key || ''
const totalSongs = computed(() => series.value.reduce((n, s) => n + Number(s.songCount || 0), 0))
const totalAssets = computed(() => series.value.reduce((n, s) => n + Number(s.assetCount || 0), 0))

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return series.value.filter((s) => {
    const okQ = !kw || String(s.title || '').toLowerCase().includes(kw)
    const st = Number(s.songCount || 0) ? 'active' : 'empty'
    const okS = statusFilter.value === 'all' || st === statusFilter.value
    return okQ && okS
  })
})

// 资产图存的是 'mv/p1/x.png'（不带 static 前缀），视频/成片带前缀 —— 幂等处理（照旧口径）
function staticUrl(rel) {
  if (!rel) return ''
  return String(rel).startsWith('static/') ? `/${rel}` : `/static/${rel}`
}
function initialOf(title) {
  const text = String(title || '').trim().replace(/^[《〈「『【〔（(["'“”‘’\s]+/, '')
  return (text.slice(0, 1) || '?').toUpperCase()
}
function fmtDate(iso) {
  if (!iso) return ''
  const t = new Date(String(iso).replace(' ', 'T')).getTime()
  if (!t) return ''
  const diff = Date.now() - t
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

async function load() {
  loading.value = true
  try {
    const [r, p] = await Promise.all([api.get('/mv/series'), stylePresetAPI.list().catch(() => [])])
    series.value = r?.series || []
    presets.value = p || []
    if (!newStyle.value && presets.value.length) newStyle.value = presets.value[0].value
  } catch (err) {
    alert(String(err?.message || err))
  } finally {
    loading.value = false
  }
}

async function createSeries() {
  if (!newTitle.value) return
  creating.value = true
  try {
    const r = await api.post('/mv/series', { title: newTitle.value, style: newStyle.value, aspect_ratio: newRatio.value })
    showCreate.value = false
    newTitle.value = ''
    if (r?.id) navigateTo(`/mv/series/${r.id}`)
    else await load()
  } catch (err) {
    alert(String(err?.message || err))
  } finally {
    creating.value = false
  }
}

function openSeries(sr) {
  menuId.value = null
  navigateTo(`/mv/series/${sr.id}`)
}

function openRename(sr) {
  menuId.value = null
  renameTarget.value = sr
  renameTitle.value = sr.title || ''
}

async function doRename() {
  const sr = renameTarget.value
  if (!sr || !renameTitle.value) return
  try {
    await api.put(`/mv/series/${sr.id}`, { title: renameTitle.value })
    renameTarget.value = null
    await load()
  } catch (err) {
    alert(String(err?.message || err))
  }
}

async function doDelete() {
  const sr = deleteTarget.value
  if (!sr) return
  deleting.value = true
  try {
    await api.del(`/mv/series/${sr.id}`)
    deleteTarget.value = null
    await load()
  } catch (err) {
    alert(String(err?.message || err))
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 页壳与卡片数值照抄短剧项目启动台（pages/index.vue），别自造视觉 */
.page {
  padding: 20px 28px 48px;
  overflow-y: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  animation: fadeUp 0.35s var(--ease-out) both;
  background: var(--surface-base);
}
.launcher-head { display: flex; align-items: center; gap: var(--sp-4); padding-bottom: var(--sp-4); }
.head-left { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.launcher-title { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; color: var(--text-0); white-space: nowrap; }
.launcher-sub { color: var(--text-3); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero-stats { display: flex; gap: var(--sp-2); margin-left: auto; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.toolbar { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); }
.search-box { position: relative; width: 240px; flex: 0 0 auto; }
.search-box svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.search-box .input { padding-left: 34px; border-radius: var(--radius-pill); border-color: var(--border); background: var(--bg-hover); }
.search-box .input:focus { background: var(--surface-input); }
.chip-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 1px; }
.filter-chip {
  appearance: none; cursor: pointer; padding: 6px 14px; border: none; border-radius: var(--radius-pill);
  background: var(--overlay-track); color: var(--text-2); font-size: 12px; font-weight: 600; white-space: nowrap;
  transition: all 0.16s var(--ease-out);
}
.filter-chip:hover { color: var(--text-0); background: var(--bg-active); }
.filter-chip.on { background: var(--inverse-surface); color: var(--on-inverse); }

.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.project-card {
  position: relative; overflow: hidden; cursor: pointer;
  animation: fadeUp 0.32s var(--ease-out) both;
  transition: border-color 0.16s var(--ease-out), background 0.16s var(--ease-out);
}
.project-card:hover { border-color: var(--border-strong); }
.project-card:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3.5px var(--button-focus); }

.project-cover {
  position: relative; aspect-ratio: 2.1 / 1; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-1) 70%);
  border-bottom: 1px solid var(--border); overflow: hidden;
}
.project-cover.has-image { background: #16181d; }
.cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 42%; }
.cover-shade {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.5) 100%);
}
.cover-initial { position: relative; font-size: 34px; font-weight: 600; color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,0.35); user-select: none; }
.cover-ratio {
  position: absolute; right: 10px; bottom: 8px; padding: 2px 7px; border-radius: 5px;
  background: var(--surface-raised); border: 1px solid var(--border); color: var(--text-3);
  font-size: 10px; font-weight: 500; letter-spacing: 0.02em; font-family: var(--font-mono);
}
.cover-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
  border: 1px solid var(--border); border-radius: var(--radius-pill);
  background: var(--surface-raised); color: var(--text-2); font-size: 11px; font-weight: 500; white-space: nowrap;
}
.project-cover.has-image .cover-badge { background: rgba(18,18,22,0.62); border-color: rgba(255,255,255,0.22); color: #fff; backdrop-filter: blur(4px); }
.project-cover.has-image .cover-ratio { background: rgba(18,18,22,0.6); border-color: rgba(255,255,255,0.2); color: #fff; }
.status-wrap { position: absolute; top: 10px; left: 10px; }
.more-wrap { position: absolute; top: 8px; right: 8px; }
.cover-more {
  width: 30px; min-width: 30px; height: 30px; min-height: 30px;
  background: var(--surface-raised); border: 1px solid var(--border); color: var(--text-2);
  opacity: 0; transition: opacity 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.cover-more:hover { color: var(--text-0); }
.project-card:hover .cover-more, .more-wrap:focus-within .cover-more { opacity: 1; }
.project-cover.has-image .cover-more { background: rgba(18,18,22,0.55); border-color: rgba(255,255,255,0.2); color: #fff; }

.project-body { padding: 12px 14px 13px; }
.project-name { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; color: var(--text-0); }
.project-meta { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 11.5px; flex-wrap: wrap; }
.project-foot { display: flex; align-items: center; gap: 4px; margin-top: 10px; font-size: 11px; color: var(--text-3); white-space: nowrap; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.skeleton-card { overflow: hidden; }
.skeleton-cover { aspect-ratio: 2.1 / 1; background: var(--bg-2); animation: skeleton-pulse 1.4s ease-in-out infinite alternate; }
.skeleton-body { padding: 12px 14px 14px; display: grid; gap: 10px; }
.skeleton-line { height: 12px; border-radius: 99px; background: var(--bg-2); animation: skeleton-pulse 1.4s ease-in-out infinite alternate; }
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-40 { width: 40%; }
@keyframes skeleton-pulse { to { opacity: 0.55; } }

.empty-state {
  flex: 1; min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-raised); text-align: center;
}
.empty-icon {
  width: 56px; height: 56px; border-radius: var(--radius-lg); background: var(--bg-2);
  display: flex; align-items: center; justify-content: center; color: var(--text-3); margin-bottom: 4px;
}
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-1); }
.empty-desc { font-size: 12px; color: var(--text-3); max-width: 260px; line-height: 1.6; }

.create-dialog { width: 460px; max-width: calc(100vw - 32px); }
.dialog-body { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.required { color: var(--error); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }

@media (max-width: 760px) {
  .page { padding: 16px 16px 40px; }
  .launcher-head { flex-wrap: wrap; }
  .launcher-sub, .hero-stats { display: none; }
  .toolbar { flex-wrap: wrap; }
  .search-box { width: 100%; flex: 1 1 100%; }
  .project-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
</style>
