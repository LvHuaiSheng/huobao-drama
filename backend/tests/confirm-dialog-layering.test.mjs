/**
 * 确认弹窗的层级（2026-10-16 用户报「删除场景/角色卡片时，确认弹窗在原卡片底下，被挡住」）
 *
 * 根因：共用 `.overlay` 是 z-index 100，而素材卡详情遮罩 118、剧集页弹窗 120、体检弹窗 300
 *   ⇒ 卡片开着时确认弹窗被压在底下。
 * 修法：确认弹窗是**压在所有模态之上**的临时弹窗，单独一层 .confirm-overlay = 400
 *   （高于各类模态 100~300，低于菜单 1000）。
 * 本测试钉住：① 组件确实用了那一层；② 它的 z-index 严格大于已知的所有模态；
 *   ③ 各调用方都走共用组件（不许再各写一套自绘确认框）。
 *
 * 跑法：cd backend && node --test tests/confirm-dialog-layering.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../frontend/app/', import.meta.url).pathname
const dialog = readFileSync(join(root, 'components/ConfirmDialog.vue'), 'utf8')

test('ConfirmDialog 用独立层级 .confirm-overlay，且高于所有已知模态遮罩', () => {
  assert.match(dialog, /class="overlay confirm-overlay"/, '遮罩必须挂上 confirm-overlay')
  const m = dialog.match(/\.confirm-overlay\s*\{\s*z-index:\s*(\d+)/)
  assert.ok(m, '必须有 .confirm-overlay 的 z-index 规则')
  const z = Number(m[1])
  assert.ok(z > 300, `确认弹窗必须高于体检弹窗(300)，实际 ${z}`)
  assert.ok(z < 1000, `但应低于菜单(1000)，实际 ${z}`)
})

function walk(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.vue') || p.endsWith('.css')) out.push(p)
  }
  return out
}

test('删除确认一律走共用组件（不许自绘确认框）', () => {
  const files = walk(root)
  const offenders = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    // 自绘：同一个文件里既有「删除」按钮的确认逻辑，又自己写了一个 role="alertdialog" 的固定遮罩
    if (f.includes('components/')) continue            // 共用组件本身（ConfirmDialog / LanguageSwitchDialog）不算自绘
    if (/role="alertdialog"/.test(src) && !/ConfirmDialog|<LanguageSwitchDialog/.test(src)) offenders.push(f.replace(root, ''))
  }
  assert.deepEqual(offenders, [], '这些文件自绘了确认弹窗，容易被层级压住：' + offenders.join(', '))
})
