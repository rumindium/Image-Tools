# 03 — Edit

> Crop, turn, flip, adjust, filter. One page, one stack of operations, one undo history — and a definition of the
> order they apply in that does not change under the user.
> Tool id: `crop`, `rotate-flip`, `adjust`, `filter` (four ids, one page) · category: `edit` · lane: `browser`
> batch: `crop` ✗, the rest ✓ · phase 1–2
> Last updated: 16 November 2026

---

## 1. Overview

The editor is four tool ids sharing one workspace, because a user does not think "now I will enter the adjust
module": they drag a crop box, nudge the contrast, and leave.

| Tab | Tool id | Batch | Phase |
|---|---|---|---|
| Crop | `crop` | ✗ | 1 |
| Transform (rotate / flip / scale) | `rotate-flip` | ✓ | 1 |
| Adjust | `adjust` | ✓ | 2 |
| Filter | `filter` | ✓ | 2 |

**Does:** free and locked-aspect crop with a rotated bounding box, 90° and arbitrary rotation, horizontal/vertical
flip, nine adjustments, ten filters, undo/redo, reset, hold-to-compare, zoom/pan, export.

**Does not:** layers, masks, text, brush retouching (the brush exists only for alpha in [06](06-BACKGROUND-EDITOR.md)),
curves, selective colour, or non-destructive sidecar files. Edits live in the tab's memory and produce a new image
on Apply.

The single most important decision in this document is §4: **the order of operations is fixed and displayed**.
Every "why does my crop look different" bug in image editors comes from an order that changed between the preview
and the export.

---

## 2. Inputs

| Property | Value |
|---|---|
| Accepted | any format `convert` accepts |
| Files | exactly 1 (editing is a per-image activity; use `batch` for many) |
| Max pixels | 40 MP / 16 MP low-memory |
| Max size | 100 MB |
| EXIF orientation | applied at decode; the crop box is in *upright* pixels |
| Animated | refused |

`crop` is the one tool that is not batchable, because a crop rectangle is meaningful for one image. The other
three are batchable with one shared setting — "rotate 40 scans 90°" is a real job.

---

## 3. Options

```ts
type EditOptions = {
  crop?: { rect: Rect; aspect: 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | number;
           rotate: 0 | 90 | 180 | 270; roundCorners: number };
  adjust: { brightness: number; contrast: number; saturation: number; exposure: number;
            temperature: number; tint: number; gamma: number; hue: number; sharpen: number };
  filter: 'none' | 'grayscale' | 'sepia' | 'vintage' | 'mono' | 'blur' | 'invert' | 'warm' | 'cool' | 'sharpen';
  scalePercent: number;          // 10–400
  flipH: boolean; flipV: boolean;
  format: 'jpeg' | 'png' | 'webp' | 'avif';
  quality: number;
};
```

Defaults: all adjustments `0`, `gamma 1`, `filter 'none'`, `scalePercent 100`, `format 'png'`, `quality 88`.

Why PNG by default here and WebP elsewhere: a user who has just edited an image is usually mid-workflow (a
screenshot, a product photo for a listing), and PNG avoids a second generation of lossy artefacts. The export
panel still offers WebP in one click, and the file-size hint shows both.

### 3.1 The crop rectangle is in source pixels

```text
source 4032 × 3024, rotate 90 selected
  → the preview shows 3024 × 4032
  → dragging a box reports coordinates in the ROTATED frame
  → the op maps them back: (x, y, w, h) in rotated → (H - y - h, x, h, w) in source
```

The board and the op share one function (`image-core/geometry.ts: rotatedCropToSource`) so the box the user sees is
the box that is cut. This is the classic off-by-90° bug, and it is asserted by `crop-after-rotate`.

---

## 4. Order of operations (fixed)

```text
1. crop            source pixels, rotated frame mapped back
2. rotate          arbitrary angle, with alpha/background fill at the corners
3. flip            horizontal, then vertical
4. adjust          LUT per channel (brightness, contrast, exposure, gamma, temp, tint, hue, saturation)
5. sharpen         unsharp mask (after adjust: sharpening noise you brightened is wrong)
6. filter          preset applied last (it may itself warm/cool/desaturate)
7. scale           scalePercent, smooth resample
8. encode          format + quality + metadata policy
```

Rules that follow from this order, and are shown in the UI as a small "order" line under the tabs:

- Crop before rotate means a 90° rotation does not need to re-map an already-rotated crop twice.
- Adjust before filter means a vintage filter darkens the *adjusted* image, which is what the preview shows.
- Scale last means adjusting a 40 MP image then shrinking is slow but correct; scaling first would lose detail
  before the adjustments saw it. The UI offers "scale first (faster)" as an explicit checkbox for batch work,
  labelled as changing the result.
- Sharpen before filter: a `blur` filter after a sharpen is not "sharpened then blurred", it is a blur; the order
  makes that visible rather than surprising.

---

## 5. Engine recipe

### 5.1 Crop and rotate

```ts
// exact copy path — no interpolation, no colour conversion
ctx.raster.draw(input.bitmap, out, { sx, sy, sw, sh, smoothing: false });

// 90° multiples use the same path with a transform matrix
ctx.raster.transformed(input.bitmap, out, { rotate: 90 });

// arbitrary angle (rotate 7.5°) resamples once, and fills the corners
ctx.raster.transformed(input.bitmap, out, { rotate: deg, background: o.background, smoothing: true });
```

Rotating by a non-multiple of 90 grows the canvas to the bounding box
(`w' = |w·cosθ| + |h·sinθ|`, rounded), because clipping the corners of a rotated photo is data loss the user did
not ask for. The crop board shows the new bounds before Apply.

### 5.2 Adjustments — one LUT, one pass

Per-channel operations are composed into three 256-entry tables, then applied in a single pass over `ImageData`:

```ts
const b = brightness * 2.55;                    // -100..100 → -255..255
const c = (259 * (contrast + 255)) / (255 * (259 - contrast));
const e = Math.pow(2, exposure / 50);           // 1 stop per 50 units
const g = 1 / gamma;

for (let v = 0; v < 256; v++) {
  let x = v * e;                                  // exposure (linear light, approximated)
  x = c * (x - 128) + 128;                        // contrast around mid-grey
  x += b;                                         // brightness
  x = 255 * Math.pow(Math.max(0, x) / 255, g);    // gamma
  lut[v] = clamp(x);
}
// temperature / tint are channel multipliers on top of the same lut:
//   R × (1 + t·0.0012), B × (1 − t·0.0012), G × (1 − tint·0.0008)
// saturation and hue happen after, in HSL, because they are not separable per channel.
```

Saturation is a lerp toward luma in linear RGB:

```ts
const y = 0.2126*r + 0.7152*g + 0.0722*b;
r = y + (r - y) * s;  // s = 1 + saturation/100, clamped to 0..2
```

Hue rotation converts to HSL, adds `hue` degrees, converts back. That is slower (a full HSL round trip) and it is
why `hue` is a slider the user drags deliberately rather than a default-on control.

### 5.3 Sharpen and blur

```ts
// gaussian, separable, 5-tap σ = radius/3
// sharpen = unsharp mask: out = src + amount × (src − blur(src))
const amount = sharpen / 100 * 1.5;      // 100 → a strong but non-haloing mask
```

A 5×5 kernel applied separably is 10 multiply-adds per pixel instead of 25 ([pipeline](0-PROCESSING-PIPELINE.md)
§8.1). At 40 MP that is the difference between 1.8 s and 4 s.

### 5.4 Filters

| Filter | Recipe |
|---|---|
| `grayscale` | luma, exact Rec.709 weights |
| `sepia` | the standard 3×3 matrix, values rounded, exact per reference |
| `mono` | grayscale + contrast 15 % + slight lift |
| `vintage` | sepia 60 % + contrast −8 + warm 12 + vignette 15 % |
| `blur` | gaussian σ = 3 |
| `invert` | 255 − v per channel |
| `warm` | temperature +18 |
| `cool` | temperature −18 |
| `sharpen` | unsharp mask amount 0.8 |

Each is a named recipe of the primitives above, not a bespoke pipeline: that is why the reference test can assert
`sepia` exactly and `vintage` within ΔE 2.

---

## 6. Flow and history

```text
        ┌─────────── committed history (immutable) ───────────┐
base ──►│ crop(rect) ──► adjust(b15,c-5) ──► filter(sepia)    │──► preview
        └─────────────────────────────────────────────────────┘
                                   │
                        drag a slider (uncommitted)
                                   ▼
                          live preview only
                                   │ Apply / Run
                                   ▼
                        appended to history → export
```

| Action | History effect |
|---|---|
| crop drag | uncommitted; preview updates; **Apply** appends |
| slider drag | uncommitted while dragging; on release, one entry (debounced 250 ms) |
| filter click | immediate entry |
| rotate/flip | immediate entry |
| Reset | clears history back to the base bitmap |
| Undo / Redo | moves the pointer; never re-decodes |
| Tool switch | history is kept in memory for the session; leaving the page warns once if unexported |

`Ctrl/⌘ Z` and `Shift + Ctrl/⌘ Z` are bound; the history is capped at 50 entries, and the 51st drops the oldest
*after* the base, which is still the original bitmap — so reset always returns to the true original.

Memory: each history entry stores **the operation**, not the resulting bitmap. Re-rendering the preview replays at
most 50 cheap ops over the base, on the preview-sized copy (≤ 2048 px). The export replays them on the full raster
once. This is what keeps a 40 MP edit under 400 MB instead of 400 MB × 50.

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Crop at a fractional pixel | rect is rounded to integers; the box in the UI snaps to whole pixels at zoom ≥ 100 % |
| Rotate 90° + crop | crop is applied to the rotated frame; exported dimensions match the preview |
| Arbitrary rotate | corners filled with the background colour (PNG: transparent if `background` is unset and the format has alpha) |
| Round corners | radius is clamped to `min(w,h)/2`; on JPEG the corners are background-coloured |
| Blur at the edges | the kernel is clamped (edge pixels repeated), so no dark border appears |
| Sharpen halos | amount capped at 1.5; the strength slider warns above 70 |
| Double encode | editing always re-encodes once (PNG default avoids visible loss, JPEG at q88 does not) |
| Zoom | 10–800 %; 1:1 shows real pixels (DPR-aware), `imageSmoothingEnabled` off above 100 % |
| Pan | clamped so at least 20 % of the image remains visible |
| Colour management | none; the preview shows sRGB as the browser decodes it |
| 40 MP + 5 ops | re-render of the preview is ≤ 250 ms; the export is ≤ 3 s |

| Limit | Value |
|---|---|
| Files | 1 |
| History | 50 ops |
| Pixels | 40 MP / 16 MP |
| Rotation | any angle; 90° multiples are lossless copies |
| Scale | 10–400 % (output pixels still capped at 64 MP) |

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool edit         14 cases (§6 of 0-E2E-CHECKLIST)

exact crop        pixel at (0,0) and (w-1,h-1) equals the source at the rect corners
aspect locks      1:1 / 4:3 / 16:9 clamp at the image edges without distorting
crop after rotate the board's box equals the exported region (marker fixture)
round corners     PNG corners have alpha 0; JPEG corners equal the background
keyboard crop     arrows move 1 px, Shift+arrows 10 px, box stays inside
rotate 90/180/270 corner mapping is exact
flip H then V     equals rotate 180, pixel-identical
adjust reset      returns to the base within ΔE 1.0
adjust isolate    saturation +50 leaves luminance within ΔE 2 on a grey ramp
gamma 0.2 / 3.0   no premature clipping in the histogram tails
undo/redo         10 steps forward and back restore identical previews
filters           sepia and mono exact; blur centroid stable; invert exact
compare-hold      shows the original while held, edited state on release
order of ops      adjust then vintage equals the documented pipeline (ΔE 2 vs reference)
```

```text
bun run test:memory -- --op edit        one base bitmap + previews; history adds no bitmaps
bun run test:falsify --only crop-exact
    mutation: enable smoothing on the copy path → exact-crop case must fail
```

---

## 9. Related docs

- [`04-RESIZE.md`](04-RESIZE.md) — the scale step, shared with this page
- [`06-BACKGROUND-EDITOR.md`](06-BACKGROUND-EDITOR.md) — the only brush in the product, and why
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — what Apply hands to the exporter
- [`0-UI-DESIGN.md`](0-UI-DESIGN.md) §6 — canvas, zoom, compare controls
