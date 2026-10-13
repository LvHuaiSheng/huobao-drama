<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('cancel')">
      <div class="dialog project-edit-dialog" role="dialog" aria-modal="true" :aria-label="t('common.projectEdit.title')">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('common.projectEdit.title') }}</h2>
            <p class="dialog-desc">{{ t('common.projectEdit.desc') }}</p>
          </div>
        </div>
        <form class="dialog-form" @submit.prevent="submit">
          <div class="dialog-body">
            <label class="field">
              <span class="field-label">{{ t('common.projectEdit.name') }} <span class="required">*</span></span>
              <input v-model="form.title" class="input" :placeholder="t('common.projectEdit.namePlaceholder')" required autofocus />
            </label>
            <label class="field">
              <span class="field-label">{{ t('common.projectEdit.genre') }}</span>
              <input v-model="form.genre" class="input" :placeholder="t('common.projectEdit.genrePlaceholder')" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('common.projectEdit.description') }}</span>
              <textarea v-model="form.description" class="textarea" rows="3" :placeholder="t('common.projectEdit.descriptionPlaceholder')"></textarea>
            </label>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.aspectRatio') }}</span>
              <BaseSelect v-model="form.aspect_ratio" :options="ratioOptions" :placeholder="t('index.createDialog.aspectRatioPlaceholder')" />
              <span class="field-hint">{{ t('index.createDialog.aspectRatioHint') }}</span>
            </label>
            <label class="field">
              <span class="field-label">{{ t('common.projectEdit.style') }}</span>
              <BaseSelect v-model="form.style" :options="styleOptions" :placeholder="t('common.projectEdit.stylePlaceholder')" searchable />
              <span v-if="styleDesc" class="field-hint">{{ styleDesc }}</span>
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" :disabled="saving" @click="emit('cancel')">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Loader2 v-if="saving" :size="13" class="animate-spin" />
              {{ t('common.save') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * 项目设置弹窗（2026-10-14 新增）：名称 / 类型 / 简介 / 视觉风格 四项可改。
 *
 * 两处入口共用同一个组件，保证改的字段与保存口径一致：
 *   ① 项目列表卡片「⋯ 更多 → 编辑项目」
 *   ② 项目详情页标题旁的铅笔按钮
 * 后端 `PUT /dramas/:id` 本来就吃 title/description/genre/style，所以纯前端即可。
 * 画面比例也在可改范围（2026-10-14 用户追加）：标签/提示直接复用「新建项目」那套
 * `index.createDialog.aspectRatio*` 文案、选项复用 `index.ratio.*`，两处措辞永远一致；
 * 改比例只影响之后新生成的画面，已有资产图与视频不变。
 */
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { Loader2 } from 'lucide-vue-next'
import { dramaAPI, stylePresetAPI } from '~/composables/useApi'
import BaseSelect from '~/components/BaseSelect.vue'

const { t } = useI18n()

const props = defineProps({
  open: { type: Boolean, default: false },
  drama: { type: Object, default: null },
})
const emit = defineEmits(['cancel', 'saved'])

const form = ref({ title: '', description: '', genre: '', style: '', aspect_ratio: '16:9' })
const presets = ref([])
const saving = ref(false)
const styleOptions = computed(() => presets.value.map(p => ({ label: p.name, value: p.value })))
const styleDesc = computed(() => presets.value.find(p => p.value === form.value.style)?.description || '')
// 与「新建项目」同一套选项（label 渲染时求值，切语言即时生效）
const ratioOptions = computed(() => ([
  { label: t('index.ratio.landscape'), value: '16:9' },
  { label: t('index.ratio.portrait'), value: '9:16' },
  { label: t('index.ratio.square'), value: '1:1' },
  { label: t('index.ratio.adaptive'), value: 'adaptive' },
]))

async function hydrate() {
  const d = props.drama || {}
  form.value = {
    title: d.title || '',
    description: d.description || '',
    genre: d.genre || '',
    style: d.style || '',
    aspect_ratio: d.aspect_ratio || d.aspectRatio || '16:9',
  }
  if (!presets.value.length) {
    try {
      presets.value = (await stylePresetAPI.list()) || []
    } catch (e) {
      // 风格列表拿不到不挡改名/改简介：只让风格下拉为空，其余照常保存
    }
  }
}

watch(() => props.open, (v) => { if (v) hydrate() })

function onKeydown(e) {
  if (e.key === 'Escape' && !saving.value) emit('cancel')
}
watch(() => props.open, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

async function submit() {
  const d = props.drama
  if (!d?.id) return
  const title = form.value.title.trim()
  if (!title) return
  try {
    saving.value = true
    const payload = {
      title,
      description: form.value.description,
      genre: form.value.genre,
      style: form.value.style,
      aspect_ratio: form.value.aspect_ratio,
    }
    await dramaAPI.update(d.id, payload)
    toast.success(t('common.saved'))
    emit('saved', payload)
    emit('cancel')
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.project-edit-dialog { width: 460px; max-width: calc(100vw - 32px); }
.dialog-head-copy { display: flex; flex-direction: column; gap: 2px; }
.dialog-desc { font-size: 12.5px; color: var(--text-3); }
.dialog-form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dialog-body { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.required { color: var(--error); }
</style>
