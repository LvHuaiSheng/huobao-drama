/**
 * AI 配置保存回归（2026-10-15）
 *
 * 事故（用户报「无法修改温度，改完自动会回去 0.7」）：
 *   前端每次保存 AI 配置都会把两个字段一起发：
 *     body: {"name":"halogen",...,"temperature":0.2,"enable_thinking":false}
 *   后端 `PUT /ai-configs/:id` 里 temperature 与 enable_thinking **各自**从
 *   `existing.settings` 重新解析、**各自**写一次 `updates.settings` →
 *   后执行的 enable_thinking 块用**旧值**（0.7）把刚写好的 temperature 覆盖掉 ✗。
 *   实测：PUT 返回 200，但 DB 里 temperature 永远是 0.7（14:43/14:46/14:47 连续三次都这样）。
 *   修法：两个字段先在内存里合并成 settingsPatch，**只写一次** settings。
 *
 * 跑法：cd backend && node --test tests/ai-configs-settings-merge.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/routes/aiConfigs.ts', import.meta.url), 'utf8')
const put = src.slice(src.indexOf("app.put('/:id'"), src.indexOf("app.delete('/:id'"))

test('PUT /ai-configs/:id：settings 只写一次（否则后写的字段会覆盖前一个）', () => {
  assert.notEqual(put, '', 'PUT 分支应存在')
  assert.equal((put.match(/updates\.settings =/g) || []).length, 1,
    `settings 在 PUT 里只能赋值一次，实际 ${(put.match(/updates\.settings =/g) || []).length} 次`)
  assert.match(put, /const settingsPatch: Record<string, number \| boolean \| null> = \{\}/)
  assert.match(put, /for \(const \[key, value\] of Object\.entries\(settingsPatch\)\)/)
  assert.match(put, /settingsPatch\.temperature = normalizeTemperature\(body\.temperature\)/)
  assert.match(put, /settingsPatch\.enable_thinking = normalizeEnableThinking\(body\.enable_thinking\)/)
})

test('清空某个字段 = 从 settings JSON 里删掉（不是写成 null）', () => {
  assert.match(put, /if \(value === null\) delete settings\[key\]/)
})

test('校验失败仍然返回 400（别把校验顺手删掉）', () => {
  assert.match(put, /temperature 须为 0 到 2 之间的数字/)
  assert.match(put, /enable_thinking 须为 true \/ false/)
})
