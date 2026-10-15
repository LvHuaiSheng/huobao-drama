# HuobaoDrama — self-maintained fork

[**中文版说明**](README.zh-CN.md)

A self-maintained fork of [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama) — an AI short-drama production pipeline (script → assets → storyboards → video), shipped as an Electron desktop app with a Nuxt front end and a TypeScript back end.

> **This is a personal fork.** All of my changes live on the **`chain`** branch; **`master`** is kept exactly as upstream delivered it, which makes diffing easy. I do not chase upstream updates, and I do not offer support for this fork.
> App version `desktop 4.0.23` · last update 2026-10-15 · 237 own commits since 2026-10-07.

## What this fork adds

1. **Three-layer prompt governance** — a rules layer (Chinese and English templates are always edited together), a persistence layer (machine gates: language gate, out-of-range `<Subject N>` / `<Picture N>` cleanup, voice-over lip lock, prop reference gate, and more) and an inspection layer (per-storyboard plus whole-episode checks with one-click repair). The same problem is fixed at all three layers instead of trusting the model to behave.
2. **Chained re-shoot** — a derivable chain id and segment ordinal (so a single re-shot segment can attach to the previous one), an automatically prepended airlock head, and wiring through the runner, the local relay and the UI.
3. **Asset system** — RefMod identity cards (character / scene / prop), costume variants (a separate character row produced by image editing, so the face is preserved), voices (a 32 kHz source wav is the artifact; a costume variant can reuse the original character's voice), soft-delete filtering plus cascade cleanup when an episode or a drama is deleted.
4. **Practical engineering** — a stopwatch that shows which task is really rendering, batch generation progress with green/red results, and a local macOS packaging path (per-architecture `ffmpeg` / `ffprobe`, ad-hoc signing so no Rosetta prompt and no "app is damaged" popup).

## Changelog

> Convention: **every delivered installer gets a tag** (`v<app version>-zdz<N>`), and its highlights are added to the table below. The complete history is the [`compare/master...chain`](https://github.com/zdx52/huobao-drama/compare/master...chain) view.

| Date | Tag | Highlights |
| --- | --- | --- |
| 2026-10-15 | `v4.0.23-zdz1` | The English-version Chinese check no longer flags in-frame on-screen text: the rules require such text to be written verbatim in Chinese inside quotes (`the phone screen reads "真正的幕后大佬是谁"`), yet the gate counted it as a violation and spent a “remove the Chinese” repair round on a perfectly legal prompt — which made the model translate the on-screen text (itself a rule violation) and failed the whole storyboard. Measured: ep22 storyboard 10 was discarded for exactly this. Quoted text is now excluded (half-width, full-width and corner quotes); genuine stray Chinese is still caught. |
| 2026-10-15 | `v4.0.22-zdz1` | Compression stops early after two consecutive rounds that cut nothing: the model re-sends the identical text once it has run out of things it is willing to delete (measured in the same batch: rounds 4, 5 and 6 all reported the same 1315/3784 character counts, ~19 s each, for nothing). Combined with 4.0.21 this turns a stuck storyboard's grind into “fail fast with an actionable message” or “accept because the total already fits”. |
| 2026-10-15 | `v4.0.21-zdz1` | Each compression round now carries a hard deficit target (“the prompt is 6616 characters, the cap is 6200 — cut at least 416 this round”). The model used to shave only 100–300 characters per round (20–30 in later rounds) when merely told “compress to the quota”, so one ordinary storyboard burned 6 rounds from 8660 down to 6616 and was thrown away for 416 characters. Every round also logs how much it actually cut, so the next live run shows whether the harder instruction works. Normal shots already finish in ~40 s since 4.0.19 (first draft fits, zero compression rounds). |
| 2026-10-15 | `v4.0.20-zdz1` | The batch progress strip no longer vanishes mid-run. It used to poll a fixed 240 times (2.5 s each = 10 minutes) and then silently clear itself, while a 10-storyboard batch really takes 20–30 minutes; display sleep freezes the renderer's timers, so the wipe landed right when the screen came back. The poll now follows the episode that owns the batch (persisted, survives page switches and reloads), runs for 100 minutes, keeps the panel with an explicit “stopped refreshing” hint instead of clearing it, and offers a “jump to that episode” button when the running batch belongs elsewhere. |
| 2026-10-15 | `v4.0.19-zdz1` | The generation pipeline no longer burns its compression rounds on a group that cannot shrink while the whole prompt already fits: the loop now targets the real hard limit (6200 characters total) instead of the advisory per-group quotas, stops as soon as it fits, and gets 6 rounds instead of 4 (measured: a perfectly ordinary 10-second storyboard was discarded for being **190 characters** over, after 4 rounds that each shaved ~110). When it still cannot fit, the error now says what to do — split the storyboard or cut a shot — instead of printing numbers. |
| 2026-10-15 | `v4.0.18-zdz1` | The per-beat dialogue-density warning now fires only above 6 characters/second (H3 Mandarin narration measures 5–6 char/s; the old 4.5 threshold flagged 14 of 102 prompts, mostly survivable 5.3 char/s lines) and is no longer fed to one-click repair — the model cannot rewrite its own timeline, so it only burned a round. Current library: 3 hits left, all 6.0–6.3 char/s. |
| 2026-10-15 | `v4.0.17-zdz1` | Health check: dropped the 「character has a voice but the prompt has no `<Audio N>` declaration」 warning — the relay injects `<Audio j>` itself (deduplicated, indices computed from its own binding) while the generator still reports `has_voice_card: false` (its predicate still points at the deprecated voice-card file), so the warning was unfixable and every repair pass burned rounds on it. Also one more compression round (3 → 4) for prompts that end up a few dozen characters over the limit. |
| 2026-10-15 | `v4.0.16-zdz1` | Two more repair-pipeline fixes: the Chinese working prompt now has the model's English "thinking out loud" preamble stripped (it used to be saved as the first ~500 characters of the prompt); the dialogue-count predicate is now shared between the generation gate and the health check (the gate used a narrower pattern, so a couple of storyboards were flagged as 「Chinese/English dialogue mismatch」 and burned two repair rounds each for nothing — measured on 102 live prompts: 5 false alarms down to 3, none of them false). |
| 2026-10-15 | `v4.0.15-zdz1` | Two repair-pipeline bugs found while investigating a failed one-click repair: (1) the compression request sent the literal `undefined` instead of the original prompt text — a caller/builder field-name mismatch that made every compression round a no-op, so an over-length English prompt was saved anyway; (2) the Chinese working prompt is now language-gated — an English reply can no longer be written into it, which is what had turned one storyboard's Chinese prompt into English. Regression tests added for both. |
| 2026-10-15 | `v4.0.14-zdz1` | Costume fixes: the image-edit call no longer doubles the `/v1` prefix (it used to fail with a 404); the costume dialog no longer wraps its long field label, its description box is taller, and opening it from a costume card pre-fills that costume's name and description; the AI-written outfit description now honours the costume name and the character's existing styling; costume generation shows up in the task list; one-click repair shows the same detailed progress as batch prompt generation (current storyboard, stage, elapsed, ETA, recent results) |
| 2026-10-15 | `v4.0.13-zdz1` | Costume: pick any existing look as the source image · AI-written outfit description · a costume character can reuse the original character's voice · costume cards can be costumed again; fix for a wasted prompt-compression round; batch progress messages coloured by result |
| 2026-10-14 | | Costume variants end to end; voice-over lip lock must lock the on-screen character; appearance fields may not offer either/or choices; extraction no longer overwrites hand-edited styling; project settings dialog; the task list shows real generation time; running tasks are no longer failed unconditionally after a crash |
| 2026-10-13 | | Prompt inspection (single storyboard and whole episode) with one-click repair; source-level fix for Chinese leaking into the English prompt; mechanical cleanup of out-of-range reference indices; ad-hoc signed macOS build |
| 2026-10-12 | | Hard length governance (segmented generation, only over-quota groups rewritten); tighter shot / cut rules (including three measured regressions); breakdown rules for location changes and scene binding |
| 2026-10-11 | | Voices switched to a direct 32 kHz source wav (the ineffective voice-card step was dropped); style presets split into a style head and a body render language; reference image size follows the project aspect ratio |
| 2026-10-10 | | Bilingual prompts (Chinese working version + English sending version); length governance v3; headless turnaround sheet; quantified dialogue budget; single-view prop sheets; group portraits are no longer created as characters |
| 2026-10-09 | | Bilingual prompts shipped; sending is refused without an English version; CAST / BLOCKING promoted to top-level sections; asset and voice panel fixes |
| 2026-10-08 | | RefMod identity cards productised (extract, status, UI buttons, cascade delete); mechanical `verbatim_lock` injection; official audio sections against invented sounds; per-architecture `ffmpeg` / `ffprobe` inside the macOS build |
| 2026-10-07 | | First working chained re-shoot plus the GitHub Actions macOS build; character and video template overhaul (ethnicity lock, no head tilt, lighting wording, full `@` coverage) |

## Quick Start

### Install a ready-built app

1. Quit the app completely (⌘Q).
2. Open the `.dmg`, drag **HuobaoDrama.app** into `/Applications` and choose *Replace*.
3. If macOS claims the app "is damaged": `xattr -cr /Applications/HuobaoDrama.app`, then open it again.

### Build it yourself

```bash
# 1) front end (static output in frontend/.output/public)
cd frontend && npm ci && npm run generate

# 2) desktop app (dmg under desktop/release)
cd ../desktop && npm ci && npm run dist
```

- The first desktop build downloads Electron as well as `ffmpeg` / `ffprobe`. If `scripts/prepare-resources.mjs` fails to download them, pre-seed `desktop/build/bin-cache/<name>` (for example copy `ffprobe` out of an installed app's `Contents/Resources/bin/`).
- The trailing publish step fails locally with `Cannot read properties of null (reading 'channel')`. That happens **after** the dmg has been produced — ignore it.
- CI: [`.github/workflows/build-mac.yml`](.github/workflows/build-mac.yml) runs on pushes to `chain`. **Since 2026-10-15 GitHub Actions is blocked for this repository by the platform** — a manual dispatch returns `422 Actions has been disabled for this repository` even though the repository setting shows "enabled", so restoring it needs a support ticket on GitHub's side.

### First run

Configure text / image / video providers under **Settings → AI services** (point them at your own relay or vendor endpoints), then create a project and add an episode.

## Features

- Script import and storyboard breakdown with configurable episode length and shot rules
- Asset extraction with de-duplication (characters, scenes, props) kept in sync across episodes of one drama
- Image generation for character turnaround sheets, scenes and props; optional RefMod identity cards and voice samples
- Bilingual storyboard prompts (Chinese working copy + English version for the video model) guarded by rules, gates and an inspection pass
- Chained re-shoot across storyboards, single-segment re-shoots, and merging finished clips
- Project settings (name, genre, synopsis, visual style, aspect ratio) and a four-language UI

## Tech Stack

- Front end: Nuxt 3 + Vue 3 + vue-i18n (Chinese / English / Japanese / Korean)
- Desktop shell: Electron + electron-builder (bundled per-architecture `ffmpeg` and `ffprobe`)
- Back end: TypeScript + Hono + Drizzle ORM + better-sqlite3 + Zod + sharp, with Mastra agents for the prompt pipeline
- Media: your own ComfyUI instance or relay for image and video models; 32 kHz reference audio for voices

## Project Structure

```
frontend/   Nuxt application (static output)
backend/    Hono API, agents, and the workspace templates (skills / prompts)
desktop/    Electron shell, packaging scripts, release/*.dmg
docker/     docker-compose helpers
configs/    sample service configurations
docs/       design notes
```

Runtime data lives in `~/Library/Application Support/HuobaoDrama/`: the SQLite database (`data/huobao.sqlite3`), identity cards (`data/refmods/`), voices (`data/voices/`) and the editable prompt templates (`workspace/`). Replacing the app never touches it.

## Upstream & License

- Upstream project: [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama). `master` tracks upstream; `chain` carries my changes.
- To pull upstream changes: `git remote add upstream https://github.com/chatfire-AI/huobao-drama.git`, `git fetch upstream`, then merge `upstream/master` into `chain` as needed.
- License: **CC BY-NC-SA 4.0**, same as upstream — attribution required, non-commercial, share-alike. See [LICENSE](LICENSE).
- The [Japanese](README.ja.md) and [Korean](README.ko.md) READMEs are upstream originals and are not maintained here.
