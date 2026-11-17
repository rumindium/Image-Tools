# 11 — Social Presets

> The right pixels in the right box, for platforms whose dimensions change without asking.
> Tool id: `social-resize` · category: `resize` · lane: `browser` · batch ✓ · phase 2
> Last updated: 16 November 2026

---

## 1. Overview

**Does:** resize and crop an image to a platform's documented dimensions, with a draggable focal point, optional
safe-zone guides, per-platform variants (post, story, thumbnail, banner), custom presets, and batch across one
preset.

**Does not:** guarantee that a platform will not re-compress the file (they all do), add text or logos, or fetch
dimensions from the platform at runtime.

Presets are data, not code. They live in `packages/presets/src/social.ts`, are versioned, and are the one part of
this product that must be *maintained* rather than merely correct — a platform changes a cover size and yesterday's
export is wrong.

---

## 2. The catalog

```ts
type SocialPreset = {
  platform: 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'linkedin' | 'x' | 'whatsapp' | 'custom';
  variant: string;             // "story", "feed-post"
  label: string;               // "Story"
  width: number; height: number;
  maxBytes?: number;           // where the platform documents a limit
  safe?: { top: number; bottom: number; left: number; right: number };  // % of the frame
  note?: string;
};
```

| Platform | Variant | Size | Notes |
|---|---|---|---|
| Instagram | Square post | 1080 × 1080 | |
| Instagram | Portrait post | 1080 × 1350 | the tallest a feed accepts without cropping |
| Instagram | Landscape post | 1080 × 566 | |
| Instagram | Story / Reel cover | 1080 × 1920 | safe zone 14 % top, 20 % bottom |
| Facebook | Profile | 320 × 320 | displayed at 176 px |
| Facebook | Cover | 851 × 315 | mobile crops to 640 × 360 |
| Facebook | Feed post | 1200 × 630 | |
| Facebook | Story | 1080 × 1920 | |
| YouTube | Thumbnail | 1280 × 720 | ≤ 2 MB |
| YouTube | Channel banner | 2560 × 1440 | safe area 1546 × 423 centred |
| YouTube | Profile | 800 × 800 | |
| YouTube | Shorts thumbnail | 1080 × 1920 | |
| TikTok | Video cover | 1080 × 1920 | safe zone 12 % top, 18 % bottom |
| TikTok | Profile | 200 × 200 | |
| LinkedIn | Profile | 400 × 400 | |
| LinkedIn | Cover | 1584 × 396 | |
| LinkedIn | Company banner | 1128 × 191 | |
| LinkedIn | Feed post | 1200 × 627 | |
| X | Profile | 400 × 400 | |
| X | Header | 1500 × 500 | |
| X | Post image | 1200 × 675 | |
| WhatsApp | Profile | 640 × 640 | |
| WhatsApp | Status | 1080 × 1920 | |

Every row is a **claim with a date**. `packages/presets/CHANGELOG.md` records when each dimension was last verified
against the platform's own documentation, and `presets_version` in the database says which catalog a deployment
serves ([0-API](0-API.md) §5). A preset that has not been verified in 12 months shows a small "verify" note in the
UI's tooltip — honesty about maintenance, not a warning that blocks work.

---

## 3. Options

| Option | Type | Default |
|---|---|---|
| `platform` | enum | `instagram` |
| `variant` | string, validated against the catalog | `square-post` |
| `fit` | `cover \| contain` | `cover` |
| `focal` | `{ x: 0..1, y: 0..1 }` | `{ 0.5, 0.5 }` |
| `background` | hex | `#ffffff` (used by `contain`) |
| `format` | `jpeg \| png \| webp` | `jpeg` |
| `quality` | 1–100 | 88 |
| `safeZone` | boolean | `false` (guides in the preview only) |
| `maxBytes` | number, optional | from the preset |

`cover` is the default because that is what these platforms do to an image that is not the right shape; matching the
platform's own crop is the only way the preview predicts the result.

---

## 4. API

```ts
{ t: 'run', jobId, op: 'social-resize', bitmap,
  options: { platform: 'instagram', variant: 'story', fit: 'cover',
             focal: { x: 0.5, y: 0.42 }, format: 'jpeg', quality: 88, safeZone: false } }
```

`variant` is validated at run time against `PRESETS_VERSION`: a stale client asking for a removed variant gets
`VALIDATION_ERROR` with the current list. That is why the schema uses `z.string()` plus a runtime lookup rather than
a static enum — platforms add sizes faster than this product ships.

Lane B: not offered. This is a crop and a resize.

---

## 5. Catalog delivery

```text
build time   packages/presets is bundled into the web app      → works offline, no request
runtime      GET /api/v1/presets with ETag                       → discovers a newer catalog
fallback     request fails → bundled catalog, no error, no empty state
```

The bundled copy is the source of truth at first paint; the fetch exists so a dimension fix does not require a
release. When the fetched version is newer, the UI merges it, shows a one-line note ("presets updated 3 Dec") and
caches it in `localStorage` under `ri-presets`. A cached catalog that fails validation is discarded, never merged
partially.

---

## 6. Flow

```text
drop 6 photos → choose Instagram → Story
preview: 1080 × 1920 frame over the photo, crop dimmed outside
drag the focal dot → the crop follows, the subject stays in frame
[Safe zones] → dashed guides, 14 % top / 20 % bottom, labelled "UI overlays"
Run → 6 outputs at exactly 1080 × 1920, JPEG q88
result: "6 files · 1080 × 1920 · 2.4 MB total"
```

Batch with a per-file focal point is allowed (`overrides[fileId].focal`), because a subject is not always centred
and a batch of portraits with one focal point would cut heads off.

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Source smaller than the target | upscale is allowed **only** here, capped at 2×, with a note; a 400 px logo into a 1080 story is a real request |
| Platform re-compression | not simulated; the note says "the platform will re-encode this too" |
| `contain` with a background | letterboxed, background filled before drawing (no black bars on JPEG) |
| Safe zones | preview-only; `safeZone` never affects the exported pixels (asserted) |
| maxBytes | when set, the target-size search from [02](02-COMPRESS.md) runs after the resize |
| Custom presets | name + width + height, session-scoped; not persisted (no account) |
| YouTube thumbnail 2 MB | enforced via maxBytes: q-search runs, and a warning if unreachable |
| EXIF | stripped by default (platforms strip it anyway; uploading GPS is the risk) |
| Odd dimensions | allowed where the platform allows them; even sizes are not forced |

| Limit | Value |
|---|---|
| Files | 100 |
| Output pixels | ≤ 64 MP (all presets are far below) |
| Upscale | ≤ 2× |
| Custom presets | 20 per session |

---

## 8. Why it has no sidebar slot

The sidebar is already twelve entries ([0-UI-DESIGN](0-UI-DESIGN.md) §2.1). "Social presets" is a *mode of resizing*,
reachable from `/resize` (the preset basis), from search, from the index grid, and at `/social`. A nav slot would
imply a separate activity, and its users are exactly the users who think "I need to resize for Instagram" — which is
the resize page's job.

---

## 9. Acceptance tests

```text
bun run e2e:tool -- --tool social-resize  8 cases

every preset        each catalog row produces exactly its dimensions (23 rows, table-driven)
cover               marker fixture is cropped, not stretched
safeZone            guides visible in the preview; exported pixels at the guide line unchanged
focal point         x 0.5 / y 0.42 moves the crop window as documented (pixel comparison)
custom preset       created, selectable, produces its dimensions
catalog fallback    API 503 → bundled catalog, tool fully usable
even/odd            no forced rounding; dimensions exact
batch 6 × 3        18 outputs, unique names, correct sizes
```

```text
bun run doc:parity   preset table in this doc ↔ packages/presets rows
```

---

## 10. Related docs

- [`04-RESIZE.md`](04-RESIZE.md) — the engine behind every preset
- [`02-COMPRESS.md`](02-COMPRESS.md) §5.2 — the byte-target search used when a platform caps size
- [`0-API.md`](0-API.md) §5 — the presets endpoint and its ETag
- [`0-CONFIG.md`](0-CONFIG.md) §5 — per-tool limits
