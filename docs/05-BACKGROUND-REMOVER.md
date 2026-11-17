# 05 — Background Remover

> The flagship tool: a soft alpha matte of the foreground, produced on the user's own GPU, with an honest fallback
> when the device cannot.
> Tool id: `bg-remove` · category: `ai` · lane: `hybrid` · batch ✓ · phase 3
> Last updated: 16 November 2026

---

## 1. Overview

**Does:** segment the salient foreground of a photo and produce a transparent PNG/WebP, with a model chosen for the
content (portrait / product / general), an optional edge-refinement pass, alpha denoising, and a manual refine path
in [06](06-BACKGROUND-EDITOR.md).

**Does not:** cut out multiple objects separately, keep shadows cast on the background (the model has no notion of
"the shadow belongs to the subject"), produce a vector path, or process video.

Three constraints shape everything below:

1. The default path is **in the tab** (spec §7). A server round-trip for a feature whose whole appeal is privacy
   would be a product contradiction, so lane B is offered only when the device fails a measured probe.
2. The output is a **matte**, not a mask: a soft 0–1 alpha per pixel. A hard mask produces halos on every composite
   ([0-AI-MODELS](0-AI-MODELS.md) §6).
3. The model is 45 MB. Downloading it without asking is not acceptable, so the first run is always an explicit
   click with a size and a progress bar.

---

## 2. Inputs

| Property | Value |
|---|---|
| Accepted | JPEG, PNG, WebP, AVIF, HEIC (with decoder), TIFF (with decoder), BMP |
| Files | 1 / 20 local, 1 / 20 server |
| Max size | 100 MB local, 25 MB server |
| Max pixels | 40 MP local, 30 MP server |
| Animated | refused |
| Best results | one clear subject, ≥ 512 px on its short side, subject covering ≥ 10 % of the frame |

A photo where the subject is 2 % of the frame is accepted and will produce a poor matte; the result card says
"the subject is small in the frame — crop closer for a better edge" when the matte's foreground coverage is under
5 %. That sentence is generated from the matte itself, not from a guess.

---

## 3. Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `model` | `auto \| portrait \| product \| general` | `auto` | `auto` resolves by heuristic ([0-AI-MODELS](0-AI-MODELS.md) §3) |
| `refine` | `none \| fast \| quality` | `fast` | `quality` runs the guided filter; roughly +40 % time |
| `denoiseAlpha` | boolean | `true` | 3×3 median on the matte only |
| `outputFormat` | `png \| webp` | `png` | both keep alpha |
| `quality` | 1–100 | 90 | WebP only |
| `lane` | `browser \| server` | `browser` | server requires `consent` |
| `consent` | object | — | `{ acceptedAt, version }`; enforced by schema and API |

The UI never shows `lane` as a select. It shows one card ("Runs in this tab") and, only when the probe fails or the
user asks, a second card with a different colour and the retention sentence.

---

## 4. API

### 4.1 Lane A

```ts
{ t: 'run', jobId, op: 'bg-remove', bitmap,
  options: { model: 'portrait', refine: 'quality', denoiseAlpha: true, outputFormat: 'png', quality: 90 },
  budgetBytes: 500_000_000 }
```

```ts
{ t: 'result', blob, metrics: {
    inputWidth: 4032, inputHeight: 3024,
    modelId: 'isnet-portrait', runtime: 'webgpu', modelCached: true,
    inferenceMs: 1180, refineMs: 240, durationMs: 1860,
    foregroundCoverage: 0.31, alphaEdgeBand: 0.014 } }
```

### 4.2 Lane B

```http
POST /api/v1/jobs
{ "tool": "bg-remove", "files": ["0192…"],
  "options": { "model": "auto", "refine": "quality", "outputFormat": "png", "quality": 90 },
  "lane": "server", "consent": { "acceptedAt": "2026-11-16T10:31:02Z", "version": "2026-11-01" } }
```

```text
202 { id, queue: "img-ai", estimatedSeconds: 6, eventsUrl }
SSE: queued 0 → staging 5 → inference 20..80 → refine 88 → encode 94 → done 100
```

Errors: `MODEL_LOAD_FAILED`, `GPU_UNAVAILABLE` (retried on WASM before surfacing), `INFERENCE_FAILED`,
`NO_FOREGROUND_DETECTED` (folded into `INFERENCE_FAILED` with a specific message), `MEMORY_LIMIT_EXCEEDED`,
`SERVER_LANE_CONSENT_REQUIRED`, `QUOTA_EXCEEDED`.

---

## 5. Engine recipe

```text
1. letterbox    1024×1024, aspect preserved, pad mode 'edge', record scale/offset
2. normalise    /255, per-model mean/std from the manifest
3. session.run  → logits [1,1,1024,1024]
4. sigmoid      → alpha 0..1 (f32)
5. unpad        crop the letterbox border, keep the real region
6. upsample     bilinear to W×H on the GPU (drawImage with the alpha as a mask source)
7. refine       guided filter r=8, eps=1e-4, guide = original luminance   [refine: quality]
8. denoise      3×3 median on alpha only                                  [denoiseAlpha]
9. composite    RGBA = (RGB, round(alpha×255))
10. encode      PNG or WebP
```

### 5.1 Step 1 matters more than step 3

The model sees 1024². Squashing a 3:4 portrait into a square distorts the subject; the model was trained on
aspect-preserved inputs, so letterboxing is not cosmetic. Padding with **edge pixels** rather than black avoids a
false strong edge at the border that some models read as a foreground boundary.

### 5.2 The matte is upsampled as a mask, not as an image

A bilinear upsample of a 1024² matte to 4032 px is 0.25 px of detail per source pixel; the edge is soft by
construction, which is what a composite needs. Upsampling the *RGB* instead (running the model on a padded
high-resolution crop) would cost 16× the compute for a marginal edge gain, and is not offered.

### 5.3 Guided filter (step 7)

```ts
// window radius 8, eps 1e-4, guide = luma of the original at full resolution
// O(1) per pixel via integral images; ~240 ms at 12 MP in a worker
alpha = guidedFilter(guide, alphaRaw, { r: 8, eps: 1e-4 });
```

This is the single largest quality difference between a "model output" and a "product cutout": it snaps the soft
matte to the real image edge (hair, fur, thin straps) without a second network. It is why `refine: 'quality'` is
worth its 40 %.

### 5.4 Inverted-matte guard

```ts
const borderAlpha = meanAlpha(borderRing(matte, 2));    // 2 px ring at the image edge
if (borderAlpha > 0.8) { matte = invert(matte); warnings.push('ALPHA_INVERTED'); }
```

A salient-object model occasionally treats a bright product on a dark backdrop as background. Inverting on a
border statistic fixes the common case, and the warning keeps the fix visible to anyone debugging a strange result.

---

## 6. Flow

```text
first run
  ┌──────────────────────────────────────────────────────────────┐
  │ Remove background needs a 45 MB model.                       │
  │ Downloaded once, cached in this browser, runs on your GPU.   │
  │ [ Download and continue ]  [ Use the server instead ]  [ × ] │
  └──────────────────────────────────────────────────────────────┘
        │ download (progress, cancellable, hash-verified)
        ▼
  probe (64×64 inference) → webgpu | wasm | fail
        │
  detect content → portrait | product | general
        │
  inference → refine → denoise → composite → preview on checkerboard
        │
  [Erase] [Restore]  ← hands off to 06 for manual work
  [Export PNG] [Replace background →]
```

Second and later runs skip the download card and go straight to inference (model cached, session warm: ~1.2 s at
12 MP on WebGPU).

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Hair / fur | the portrait model + `refine: quality` keeps strands; `refine: none` produces a hard silhouette, and the UI says so |
| Glass, transparent objects | not handled; the matte treats them as foreground. Documented, not hidden |
| Cast shadows | removed with the background; the user can add a synthetic shadow in [06](06-BACKGROUND-EDITOR.md) §5 |
| Two subjects | both are kept (one matte); per-object separation is not offered |
| Tiny subject | matte + "subject is small in the frame" hint |
| Pure-white background product | product model preferred by the heuristic; if the border alpha is high, the inversion guard runs |
| Very large image | inference always at 1024², so time is nearly constant; the encode and refine scale with pixels |
| Server lane | same weights, same pre/post, `onnxruntime-node`; parity ΔE ≤ 1.0 |
| Model change | results change; the manifest version is in the result card's details |
| Low-memory device | `u2netp-lite` at 320²: faster, coarser edge, labelled as such |

| Limit | Local | Server |
|---|---|---|
| Files | 20 | 20 |
| Pixels | 40 MP | 30 MP |
| File size | 100 MB | 25 MB |
| Timeout | 90 s/batch row | 300 s/job |
| Model download | ≤ 60 MB | — |

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool bg-remove    10 cases

download      progress shown, hash verified, cached on the second run (no transfer)
portrait      IoU ≥ 0.97 vs hand mask; edge band ≤ 2 %
dimensions    output dimensions equal the input exactly
alpha         PNG and WebP keep alpha; JPEG+background is opaque
refine        quality < fast < none in edge band width (strictly ordered)
brush handoff strokes reach 06 and change only the painted region
inversion     bright-subject fixture is corrected, ALPHA_INVERTED emitted
no subject    blank wall → INFERENCE_FAILED with "No subject was found"
low memory    u2netp-lite selected; time under gate
server parity same input, both lanes, matte ΔE ≤ 1.0
consent       dialog precedes any request; declining keeps the job local
```

```text
bun run test:load -- --op bg-remove --sizes 12
bun run test:pixels -- --op bg-remove    alpha coverage within 1 % of the fixture's expected 0.6
```

---

## 9. Related docs

- [`06-BACKGROUND-EDITOR.md`](06-BACKGROUND-EDITOR.md) — what to do with the matte
- [`0-AI-MODELS.md`](0-AI-MODELS.md) — model choice, licensing, runtimes, probes
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) §4.6 — the option schema in full
- [`0-API.md`](0-API.md) §11 — the server-lane walkthrough
