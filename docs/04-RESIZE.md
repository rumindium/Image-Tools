# 04 — Resize

> The tool with the most ways to be subtly wrong: five fit modes, aspect rounding, upscaling, and a resample that
> decides whether a photo looks crisp or muddy.
> Tool id: `resize` · category: `resize` · lane: `browser` · batch ✓ · phase 1
> Last updated: 16 November 2026

---

## 1. Overview

**Does:** resize by width, height, both, percentage or a max edge; five fit modes; aspect lock; upscale on request;
optional format change and quality; background colour for padded output; batch with one shared config; presets from
[11](11-SOCIAL-PRESETS.md).

**Does not:** crop interactively (use `crop` for a chosen region — `cover` crops algorithmically, centred or on a
focal point), sharpen after downscale (the resample is already the sharpest sensible result; `enhance` has a
sharpen control), or change DPI metadata (canvas cannot write it, [10](10-METADATA.md) §6).

Resizing is the tool where "it looks blurry" and "it's the wrong size" complaints come from, and both are solved by
doing the arithmetic in one testable place (`image-core/resize.ts`) and the pixels in one place
(`image-browser/raster.ts`).

---

## 2. Inputs

| Property | Value |
|---|---|
| Accepted | any format `convert` accepts |
| Files | 1–200 |
| Max pixels in | 40 MP / 16 MP low-memory |
| Max pixels out | 64 MP (even when `allowUpscale`) |
| Max size | 100 MB per file |

---

## 3. Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `basis` | `dimensions \| percentage \| preset \| maxEdge` | `dimensions` | the four ways a user knows their target |
| `width` / `height` | 1–20 000 | — | at least one required |
| `percentage` | 1–400 | 50 | always preserves aspect |
| `maxEdge` | 16–20 000 | — | the longest side becomes this |
| `lockAspect` | boolean | `true` | unlocking allows stretch (fill/stretch modes need it) |
| `fit` | `fit \| fill \| stretch \| contain \| cover` | `fit` | §4 |
| `allowUpscale` | boolean | `false` | a hard refusal when false |
| `filter` | `auto \| nearest` | `auto` | nearest for pixel art, sprites, QR codes |
| `background` | hex | `#ffffff` | padding in `contain`, letterboxing |
| `format` | optional | input format | an explicit change is allowed but rare |
| `quality` | 1–100 | 82 | used only when re-encoding lossily |

---

## 4. Fit modes — the table that ends the arguments

Given a source `W × H` and a target box `w × h`:

| Mode | Output size | Pixels | Behaviour |
|---|---|---|---|
| `fit` | `w' × h'` where `scale = min(w/W, h/H)`, `w' = round(W·scale)`, `h' = round(H·scale)` | no crop, no pad | the image fits **inside** the box; the box may not be filled |
| `contain` | `w × h` | padded | same scale as `fit`, then centred on `background` |
| `fill` | `w × h` | cropped | scale to fill, then crop the overflow, centred (or on a focal point) |
| `cover` | `w × h` | cropped | alias of `fill` with a focal point; kept as a distinct value because social presets use the word "cover" |
| `stretch` | `w × h` | distorted | ignores the aspect ratio; allowed only when `lockAspect: false` |

`fit` and `contain` differ in the output *dimensions*, which is the only thing that matters to a user pasting into a
form that requires exactly 1080 × 1080. `fill` and `cover` are the same operation; the two names exist because
"cover" is the platform word and "fill" is the one this product's mode list uses, and mapping them in the UI is
cheaper than teaching the user a vocabulary.

### 4.1 Aspect rounding

```ts
const scale = Math.min(w / W, h / H);
let w2 = Math.max(1, Math.round(W * scale));
let h2 = Math.max(1, Math.round(H * scale));
if (lockAspect) {
  // prefer the dimension the user typed exactly
  if (basis === 'dimensions' && width && !height) h2 = Math.max(1, Math.round(H * (width / W)));
  if (basis === 'dimensions' && height && !width) w2 = Math.max(1, Math.round(W * (height / H)));
}
```

Rounding to nearest (not floor) and preferring the dimension the user typed avoids the "I asked for 1080 and got
1079" report. Both branches are unit-tested at 23 awkward source sizes.

---

## 5. Engine recipe

```ts
export const resize: Transform = async (input, o, ctx) => {
  const { w2, h2, crop } = planResize(input.width, input.height, o);   // image-core, pure
  if ((w2 > input.width || h2 > input.height) && !o.allowUpscale) throw new ValidationError('…');

  const out = ctx.raster.canvas(w2, h2);
  const src = crop ? await cropBitmap(input.bitmap, crop) : input.bitmap;

  if (o.filter === 'nearest' || w2 >= input.width) {
    // no benefit from halving on upscale or nearest
    ctx.raster.draw(src, out, { smoothing: o.filter !== 'nearest' });
  } else {
    // halve while target × 2 < current, then one final resample
    let cur = src;
    while (cur.width > w2 * 2) {
      const half = ctx.raster.canvas(Math.max(w2, Math.floor(cur.width / 2)), Math.max(h2, Math.floor(cur.height / 2)));
      ctx.raster.draw(cur, half, { smoothing: true });
      if (cur !== src) cur.close?.();
      cur = half;
      ctx.report('transform', 0.55 + 0.05 * Math.log2(input.width / cur.width));
    }
    ctx.raster.draw(cur, out, { smoothing: true });
  }
  return { bitmap: out };
};
```

### 5.1 Why halving, and what it costs

A 4032 → 400 downscale in one `drawImage` samples 10 source pixels per output pixel badly: browsers use a box-ish
filter that drops thin features and produces aliasing on high-frequency textures (fabric, foliage, fine text). The
halving loop turns one 10× reduction into three 2×-ish reductions, each of which a browser's filter handles well.

- Cost: 4 GPU blits instead of 1 — immeasurable at these sizes.
- Memory: each intermediate is a quarter of the previous; peak is +33 % of the final size, not +100 %.
- The intermediates are closed as they are replaced, which is asserted by `test:memory`.

Above a 1.5× upscale the halving path is skipped entirely: halving an upscale is a no-op that costs a copy.

### 5.2 `nearest`

```ts
ctx.imageSmoothingEnabled = false;
```

Used for pixel art, sprites and QR codes. A 300 × 300 QR enlarged to 900 × 900 with smoothing is unscannable; with
nearest it is perfect. The control is a two-option select labelled "Smooth (photos) / Nearest (pixel art)", not a
checkbox named "filter", because the user knows their content and not the algorithm.

### 5.3 The background in `contain`

The padding is filled **before** the image is drawn, on the same canvas, so the alpha channel is never involved: a
`contain` to JPEG with `#ffffff` produces white bars, not black ones (the classic bug when a canvas starts
transparent and a JPEG encoder flattens onto black).

---

## 6. Flow

```text
drop 4032×3024 → choose width 1080, lock aspect
preview immediately shows "1080 × 810 · −73 % pixels"
Run
  plan → w2 1080, h2 810, no crop
  halve 4032→2016→1008, final draw to 1080
  encode (input format, q82)
result: 4032×3024 → 1080×810, 4.8 MB → 486 KB
badge: This tab
```

The dimension preview updates while typing (debounced 150 ms) and shows the derived side before the run, so a user
never discovers the output size after waiting.

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Upscale refused | `VALIDATION_ERROR` naming the requested and the source dimensions; the control offers "Enable upscaling" |
| Upscale quality | allowed but honestly labelled; above 2× the card says "will look soft — the detail is not in the source" |
| `cover` focal point | defaults to centre; the social preset page exposes a draggable focus dot |
| Mixed aspect in a batch | each file uses the same box; `fit` produces different output sizes per file, `fill` produces the same size for all |
| Percentage + lockAspect false | rejected by the schema |
| Output > 64 MP | refused; a 40 MP source at 200 % is not a resize, it is a problem |
| Nearest on a palette image | preserves index colours visually (canvas still re-encodes) |
| Animated input | refused at sniff |
| 200 files at 1080 px | queued at concurrency 2; the batch header shows the derived per-file size when it is uniform |

| Limit | Value |
|---|---|
| Files | 1–200 |
| In pixels | 40 MP / 16 MP low-memory |
| Out pixels | 64 MP |
| Dimension range | 1–20 000 per side |
| Halving steps | ≤ 8 (log2(20 000/16)) |

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool resize       10 cases

width only        1200×900 → 800 → 800×600 (aspect within 1 px)
height only       1200×900 → 600 → 800×600
both + lock       fits inside the box, no distortion (marker fixture)
percentage 50 %   exact half dimensions
five fit modes    dimensions match §4 for a 1200×900 → 600×600 box
fill crops        overflow removed from both sides equally
contain pads      bars equal the background colour exactly (JPEG corner pixel)
upscale refused   allowUpscale false → VALIDATION_ERROR, no output
nearest           pixel-art fixture has no blended pixels (only source colours present)
batch 12          all outputs correct; no bitmap leak
```

```text
bun run test:pixels -- --op resize      edge-line fixture does not lose its line at 8× downscale
                                        mean ΔE vs a sharp/libvips reference ≤ 2.0
bun run test:load   -- --op resize --sizes 12,40
```

---

## 9. Related docs

- [`11-SOCIAL-PRESETS.md`](11-SOCIAL-PRESETS.md) — the preset basis, built on this tool
- [`03-EDIT.md`](03-EDIT.md) §4 — where scale sits in the edit pipeline
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — re-encoding and naming after a resize
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §8.1 — the halving rule in general
