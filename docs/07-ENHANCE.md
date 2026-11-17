# 07 — Enhance

> Fix a flat photo with histograms, not with a black box. AI is optional, labelled, and off by default.
> Tool id: `enhance`, `upscale` · category: `enhance` · lane: `hybrid` / `server` · batch ✓ / ✗ · phase 4 (upscale 6)
> Last updated: 16 November 2026

---

## 1. Overview

Two ids, one page, two very different promises:

| Tab | Tool id | Runs | Promise |
|---|---|---|---|
| Enhance | `enhance` | browser (classical), AI denoise optional | "corrects exposure, contrast and colour" |
| Upscale | `upscale` | server only | "adds detail that was not in the original" |

**Does (enhance):** auto levels, auto white balance, exposure correction, unsharp mask, classical bilateral denoise,
optional AI denoise, strength control, before/after and a difference view, batch for the classical path.

**Does not:** deblur, restore faces, remove objects, or "improve" an image without telling the user which operation
ran. Every operation in the result card is named, with its parameters.

The design rule: **a user must be able to predict the result**. Auto levels on a flat scan is a visible, explainable
improvement; a generative model on the same scan is a different photograph. Both can exist here, but never under the
same button and never under the same label ([0-UI-DESIGN](0-UI-DESIGN.md) §8.3).

---

## 2. Inputs

| Property | `enhance` | `upscale` |
|---|---|---|
| Accepted | JPEG, PNG, WebP, AVIF, HEIC, TIFF, BMP | JPEG, PNG, WebP |
| Files | 1–50 | 1 |
| Max pixels | 40 MP | 12 MP in, 192 MP out (4×) |
| Max size | 100 MB | 25 MB |
| Alpha | preserved on PNG/WebP output | preserved on PNG output |

---

## 3. Options

```ts
type EnhanceOptions = {
  auto: { levels: boolean; whiteBalance: boolean; contrast: boolean };  // default all true
  exposure: number;        // -100..100, default 0
  sharpen: number;         // 0..100, default 0
  denoise: 'off' | 'classical' | 'ai';  // default 'off'
  denoiseStrength: number; // 0..100, default 35
  strength: number;        // 0..100, blends processed with original, default 100
  format: 'jpeg' | 'png' | 'webp';
  quality: number;         // default 90
};

type UpscaleOptions = {
  scale: 2 | 4;
  model: 'realesrgan-x2' | 'realesrgan-x4';
  faceRestore: false;      // not offered; the field exists to make its absence explicit
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
};
```

`strength` is a linear blend in linear light: `out = orig + (processed - orig) × strength/100`. It exists because
auto levels on an already-good photo is a small change the user may want to dial back, and re-running with each
checkbox is a worse interaction than one slider.

---

## 4. API

### 4.1 Enhance (lane A)

```ts
{ t: 'run', jobId, op: 'enhance', bitmap,
  options: { auto: { levels: true, whiteBalance: true, contrast: true },
             exposure: 0, sharpen: 25, denoise: 'classical', denoiseStrength: 35,
             strength: 100, format: 'jpeg', quality: 90 } }
```

With `denoise: 'ai'` the op requires the `ai:denoise-small` capability; the schema is the same, the worker loads a
second session, and the UI shows a model-download card exactly like [05](05-BACKGROUND-REMOVER.md) §6.

### 4.2 Upscale (lane B)

```http
POST /api/v1/jobs
{ "tool": "upscale", "files": ["…"],
  "options": { "scale": 2, "model": "realesrgan-x2", "format": "png", "quality": 92 },
  "lane": "server", "consent": { "acceptedAt": "…", "version": "2026-11-01" } }
```

Queue `img-heavy`, timeout 600 s, metered at 1 job per upscale. `POST /jobs` refuses `lane: "browser"` for
`upscale` with `SERVER_LANE_DISABLED` — there is no local fallback, because a 4× local upscale is 192 MP and the
tab would die rather than degrade.

---

## 5. Engine recipe

### 5.1 Auto levels

```ts
// histogram over the sampled luma (≤ 4 M pixels, every 4th on huge images)
const lo = percentile(hist, 0.005);   // clip 0.5 % of shadows
const hi = percentile(hist, 0.995);   // clip 0.5 % of highlights
const scale = 255 / Math.max(1, hi - lo);
lut[v] = clamp((v - lo) * scale);
```

Percentile clipping rather than min/max: a single specular highlight or a dead pixel would otherwise compress the
whole image into the bottom third. 0.5 % is the standard newsroom value; a photo with a large white background
(product shots) is detected by looking at the highlight percentile density, and the clip is raised to 2 % so the
product does not turn grey. That branch is why the tool works on marketplace photos, which is its most common input.

### 5.2 Auto white balance

```ts
// grey-world on the brightest 10 % of pixels (a crude but stable illuminant estimate)
const ref = meanOfTopDecileByLuma(rgb);          // per channel
const gain = { r: mean / ref.r, g: mean / ref.g, b: mean / ref.b };
// clamp gains to [0.75, 1.35] so a genuinely warm sunset is not neutralised
```

The clamp is the difference between "white balance" and "remove all colour casts including the intentional ones".
A sunset is not a bug.

### 5.3 Sharpen

```ts
const blurred = gaussian(luma, radius = 1.2);
const detail = luma - blurred;
out = src + detail * (sharpen / 100) * 1.5;
```

Applied on luma only, so colour noise is not amplified. Above 70 the UI warns about halos and the comparison view
makes them visible.

### 5.4 Denoise

| Mode | Algorithm | Cost at 12 MP |
|---|---|---|
| `classical` | bilateral 5×5, σ_s 2, σ_r from strength | ~700 ms |
| `ai` | small tiled CNN, 256² tiles with 16 px overlap, feathered blend | ~3.5 s |

The tiled AI path blends overlaps with a linear feather; without it, tile seams are visible on flat skies, which is
the single most reported defect in naive tiled upscalers and denoisers.

### 5.5 Upscale

```text
tile 128×128 with 8 px overlap → model → place with feather → seam-free output
input capped at 12 MP, output capped at 192 MP
sharp (libvips) does the final assembly and encode, not the model
```

Real-ESRGAN class models hallucinate plausible texture. The UI says "adds detail that was not in the original" and
the docs repeat it, because a user who believes they have *recovered* detail will use it on forensic material and be
wrong.

---

## 6. Flow

```text
enhance
  drop → analysis pass on a 2048 px preview (histogram, WB estimate) → suggested strength
  [Auto] toggles the three automatic operations on, preview updates in ~120 ms
  strength slider 0–100 blends original and processed live
  Result card lists: "Auto levels · Auto white balance · Sharpen 25 · Denoise classical 35"
  compare: hold `\` for original, or drag for split; "Show changes" shows |difference| × 3

upscale
  drop → warn if input < 1 MP ("upscaling a thumbnail will produce a soft result")
  consent → upload → queue img-heavy → SSE → download
  result: "4032 × 3024 → 8064 × 6048 · 2×"
```

The `|difference| × 3` view is the honest one: it shows exactly what the tool changed, including the parts the user
did not want changed. It is the fastest way to catch an over-aggressive auto-levels on an already-good photo.

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Already-good photo | auto operations are computed but `strength` starts at 60 for such inputs (low histogram spread) and the card says "this photo is already well exposed" |
| HDR / 16-bit | browsers deliver 8-bit; banding may appear after a strong level stretch, and the card warns when the stretch factor exceeds 2.5 |
| Skin tones | auto WB is clamped; a portrait with a warm light keeps warmth |
| AI denoise on text | smears small text; the AI card warns "not for screenshots or text" |
| Upscale of a JPEG | amplifies compression artefacts; the server applies a mild pre-denoise, noted in metrics |
| Upscale of text | produces plausible-looking but wrong glyphs; documented as unsuitable |
| Batch with AI denoise | allowed, but each file pays the model load if not cached (one load per worker session, so effectively once) |
| Colour of `strength` blend | done in linear light (sRGB → linear → blend → sRGB) to avoid the darkening a gamma-space blend produces |
| Server model mismatch | hash compared; a mismatch is `MODEL_LOAD_FAILED`, not a silent quality change |

| Limit | `enhance` | `upscale` |
|---|---|---|
| Files | 50 | 1 |
| Pixels | 40 MP | 12 MP in |
| Timeout | 120 s/file | 600 s |
| Cost | free, local | 1 metered job |

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool enhance      7 cases (§9 of 0-E2E-CHECKLIST)

underexposed    mean luma rises; ≤ 2 % of pixels clip above 250
auto contrast   histogram widens, hue shift ≤ 3°
sharpen 0       pixel-identical to input
sharpen 100     local contrast rises on the edge fixture; halo width ≤ 3 px
denoise         noise σ falls on a synthetic noisy fixture; marker edges blur ≤ 2 px
ai off by default   no model request during a default run
result labels   every executed operation is named in the result card
```

```text
bun run e2e:tool -- --tool upscale      3 cases (server)
2× / 4×         output dimensions exact; decode ok
cap             13 MP input → 422 IMAGE_TOO_LARGE
lane            lane: "browser" → 503 SERVER_LANE_DISABLED
```

---

## 9. Related docs

- [`0-AI-MODELS.md`](0-AI-MODELS.md) §9 — why deblur is not offered and upscale is server-only
- [`03-EDIT.md`](03-EDIT.md) §5.2 — the adjustment math this page shares
- [`02-COMPRESS.md`](02-COMPRESS.md) — the other tool that shows a before/after
- [`0-API.md`](0-API.md) §4 — the lane B job shape
