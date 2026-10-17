---
name: extractor
description: Rules and methods for extracting characters, scenes, and props
---

# Character, Scene & Prop Extraction Guide

## Character Extraction Rules

Extracted character fields (corresponding one-to-one with the `save_dedup_characters` tool parameters):
- **name** (required): the character's full name
- **role**: the character's positioning — protagonist / supporting / extra
- **appearance**: appearance description (300-500 characters) — gender, age impression, facial features, physique, bearing. **The skin-tone shade and its light/dark must be stated** (e.g. "sallow coarse skin", "healthy tanned skin") and **the hair colour must be stated** (e.g. "hair dyed straw-yellow with dark roots growing out"). **Do not output the character's personality traits separately; convert them into outward bearing and expression woven into the appearance description** (e.g. "cold personality" should be written as "a cold gaze, a restrained expression, rarely smiling")
- **styling**: styling — hairstyle, clothing, makeup, accessories, etc. **Every separate garment needs its own colour** (jacket / apron / trousers / shoes) and **every accessory needs its colour or material** (e.g. "one thin silver bangle, tarnished")
- 🔴 **When the script names a specific outfit, bind only that outfit's character — never the base look as well (added 2026-10-16, measured in episode 13)**: when the script states a concrete costume ("【女主穿搭】…", "changes into …", "dressed in a …"), pick **the character whose costume matches** (a `<base name>·<costume name>` variant takes priority) and do **not** also bind the base look — binding both drags the base outfit into the downstream shots (measured: episode 13 declares a deep-green velvet formal outfit, yet both `苏清禾` and `苏清禾·内搭正装` were bound). Bind the base character only when the script names no specific costume. Bind both only when the same character genuinely wears both looks within one episode (rare; the script must say so explicitly).
- 🔴 **All four colours are mandatory and no either/or is allowed (added 2026-10-15; measured on episode 8 shot 8 — the face held, the police officers' hair and Wang Mei's garment colour did not)**: `appearance`/`styling` must state **hair colour, skin tone, garment colour and accessory colour/material** — these are the **only** colour source for every later storyboard prompt (the prompt-writing model cannot see the image and reads only this text; whatever is missing gets guessed). **Never write an either/or** (`或`, `皆可`, `任选`, `亦可`, `or`) — counter-example: "a dark-blue **or** grey-brown jacket" made the prompt pick dark blue while the card image was drawn grey-brown: **text fights image and the on-screen colour drifts**. When the source carries an "or", **pick one on the spot and write it down**. — **background extras and crowds included**: a nameless extra registered only as background still needs one concrete hair colour (measured 2026-10-16: a card created that day said only "short neat hair" with no colour, leaving the video to guess). A card missing these is rejected by `save_dedup_characters` and sent back to be completed
- **description**: backstory and character relationships (optional supplement)

## Scene Extraction Rules

Extracted scene fields (corresponding one-to-one with the `save_dedup_scenes` tool parameters):
- **location** (required): the specific place name
- **time**: time period (e.g. daytime / dusk / late night); the same location at a different time period counts as a new scene
- **prompt**: scene description — space, set dressing, period texture, key visual elements (pure background, no people)
- **🔴 Never name the episode's props/products/devices in a scene description** (added 2026-10-17, measured incident): a scene description carries space, set dressing and fixed installations only; tabletops / desktops / display tables / shelves are written as **empty**. Key props (samples, products, specimens, documents…) have their own asset and reference image — naming one in the scene description makes the scene image **paint a second, generic copy of it**, and the finished shot is drawn from that copy while the prop's own reference image and identity card get overridden (measured: a Festo industrial livestream scene described "a display table holding an industrial sample — a narrow silver-grey servo drive…", the scene image came back with 1 drive on the table + 4 on the shelf, all generic ⇒ in that storyboard the prop was "not locked at all" in the wide shot and looked fine in the medium shot)
- **lighting**: scene lighting — light sources, color tone, brightness contrast, mood

## Prop Extraction Rules

**Core principle: prefer extracting too few over too many.** Props are high-cost assets used to generate white-background item shots and referenced by video close-ups; only plot-critical props are worth extracting. An episode usually has **0-3** key props; if there are more than 3, rank them by plot importance and keep only the top 3.

Both of the following conditions must be met — neither is optional:
1. **Directly drives the plot**: the item's appearance, handover, damage, or discovery triggers a plot turn (e.g. a murder weapon, a token, a key document, a love-token gift, key evidence).
2. **Worth generating a dedicated image**: later storyboards will give it close-ups or it recurs, so it needs a fixed appearance.

**Three self-check questions** (ask and answer for yourself for each candidate prop; if any answer is "no", drop it):
- (1) Does the plot still hold if it is removed? → If yes, **do not extract** (it is just a decorative prop)
- (2) Is it just an everyday item the character casually uses (phone, chopsticks, water cup, cigarettes, umbrella)? → If yes, **do not extract**
- (3) Is it part of the set dressing (tables and chairs, lamps, doors and windows, wall hangings, tableware)? → If yes, **do not extract** (these belong in the scene description)

**Typical non-props**: ordinary items used casually with no effect on the plot's direction; set dressing and furniture; items mentioned only once and never again; a character's regular attire (belongs in character styling).

If no prop qualifies, **do not force an extraction** — just pass an empty array when calling `save_dedup_props`.

Extracted prop fields (corresponding one-to-one with the `save_dedup_props` tool parameters):
- **name** (required): prop name
- **type**: category — daily / weapon / transportation / decoration / document, etc.
- **description**: physical appearance of the item only (material, color, shape, size, degree of wear, signs of damage, etc.); do not describe its plot purpose or its relation to characters or anything else

Props **do not need an image prompt** — a prop's final prompt is generated by the prompt-generation Agent before image generation (white-background product-shot specification).

## Steps

1. Call `read_script_for_extraction` to read the current episode's script
2. Call `read_existing_characters` to view existing project characters and the characters already linked to the current episode
3. Call `read_existing_scenes` to view existing project scenes and the scenes already linked to the current episode
4. Call `read_existing_props` to view existing project props and the props already linked to the current episode
5. Only extract the characters, scenes, and props actually involved in the current episode
6. Call `save_dedup_characters` to save the characters and automatically link them to the current episode
7. Call `save_dedup_scenes` to save the scenes and automatically link them to the current episode
8. Call `save_dedup_props` to save the props and automatically link them to the current episode

## Current-Episode Rules

- The goal is to fill in the characters, scenes, and props needed by the "current episode", not to rescan the entire project
- If an asset already exists in the project but is not yet linked to the current episode, reuse it and link it to the current episode
- Deduplication rules: characters/props are matched exactly by name, scenes are matched exactly by [location + time period]; on a hit, prefer reuse — do not create duplicates
- Near-name deduplication: when a name carries a parenthesized qualifier or alias, compare by the main part before the parentheses (e.g. "Lin Xiaoyu (protagonist)" and "Lin Xiaoyu" are the same character/prop — reuse the existing one); the normalized_name returned by read_existing_characters / read_existing_props is the normalized name, and normalized_location works the same way for scenes — use these for the judgment
