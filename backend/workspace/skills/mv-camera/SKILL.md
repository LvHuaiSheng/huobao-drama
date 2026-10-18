---
name: mv-camera
description: MV 每段的机位与景别写法（看得见嘴、段内不换景别、首尾才用中远景）
---

# MV 机位 / 景别写法

## 时间轴不许改
用户会给你一段已经切好的时间轴（秒 / 帧 / 有唱还是无唱），你要**为每一段配机位**：
- 段数不许改、时间不许改；
- 返回数组长度 = 输入段数，`index` 从 0 起。

## 景别（由代码按规则定，你只写机位句）
- 中景 / 特写交替；**只有第一段和最后一段**允许中远景。
- 一段里**只有一个景别**，不许段内从远拉到近或从近拉到远。

## 机位句要求（英文）
- 必须一直看得清脸和嘴 —— 有唱的段尤其（要能对上口型）。
- 用这种形状的短句：
  `locked-off static camera, medium shot, front three-quarter face view, stable framing`
- 不要写：远景/全身（wide shot、full body）、只拍眼睛（close-up on eyes）、背后视角（from behind）、隔着东西（over-the-shoulder）、镜头推拉（push in / pull out）。

## 歌词
`lyric` 填这一段正在唱的那句歌词 —— 从用户给的歌词行里挑**原样**的一句，没唱就填空字符串。

## 输出
只输出 JSON 数组，不要解释：
```json
[{"index":0,"camera":"locked-off static camera, medium shot, front three-quarter face view, stable framing","lyric":"翻到那一页"}]
```
