# 09 — Color Tools

> A palette a designer can paste, and a pixel picker accurate to the byte. Both run on sampled pixels, and both say
> so.
> Tool id: `palette`, `pixel-pick` · category: `inspect` · lane: `browser` · batch ✓ / ✗ · phase 2
> Last updated: 16 November 2026

---

## 1. Overview

| Tab | Tool id | Input | Output |
|---|---|---|---|
| Palette | `palette` | image | 3–10 swatches with proportions |
| Picker | `pixel-pick` | image + point | HEX / RGB / HSL / coordinates |

The spec puts the pixel picker under "Image Utilities" (§10.6). It lives here because its conversions
(`rgbToHsl`, `contrastRatio`, `deltaE`) are the same functions the palette tool uses, and those functions are exactly
where rounding disagreements appear. One document, one set of rules.

---

## 2. Palette

### 2.1 Inputs and options

| Property | Value |
|---|---|
| Files | 1–50 (batch produces one palette per file) |
| Max pixels | 40 MP (sampled) |
| `count` | 3, 5, 8, 10 |
| `algorithm` | `median-cut` (default) or `kmeans` |
| `sampleMaxSide` | 32–1024, default 256 |
| `ignoreTransparent` | default ✓ (alpha < 16 excluded) |
| `sort` | `dominance` (default) \| `hue` \| `lightness` |
| `minSaturation` | 0–1, default 0 |

### 2.2 Sampling

```ts
const scale = Math.min(1, o.sampleMaxSide / Math.max(w, h));
const grid = await raster.readPixels(input, { maxSide: o.sampleMaxSide });  // 256² = 65 536 pixels
```

256 px is the default because the palette stops changing above it: a 12 MP photo downsampled to 256² still contains
every large colour region, and the extra 190× pixels do not change a 5-colour median cut. The sample size is
configurable down to 32 for a deliberate "only the dominant colour" behaviour, and up to 1024 for images with many
small regions (a logo sheet).

Downsampling for the *palette* is safe; downsampling for the *proportions* is not, and that is why proportions are
computed on the sample and labelled as sample proportions ([§2.5](#25-what-proportions-mean)).

### 2.3 Median cut

```text
1. collect sampled pixels (RGB, optionally filtered by alpha and saturation)
2. put all pixels in one box
3. repeat until `count` boxes:
     pick the box with the largest range on any channel
     sort its pixels by that channel
     split at the median
4. each box's colour = the mean of its pixels (not the median: mean is closer to perceived)
```

A fixed seed is not needed — median cut is deterministic. Quantising to 5 bits per channel before bucketing (a
32×32×32 histogram) makes the sort cheap and merges near-identical pixels, which is what stops a photo of a sky from
producing five blues.

### 2.4 k-means

```text
init:    k-means++ over the sample (deterministic seed derived from a hash of the bytes)
iterate: 8 passes or until the assignment stops changing
recolour: each cluster = mean of its members in linear light
```

Done in linear light, then converted back to sRGB, because averaging sRGB values directly makes dark clusters too
dark and saturated clusters desaturated.

The two algorithms differ by design: median cut favours area (what covers the image), k-means favours perceptual
clusters (what looks distinct). On a photo with a large beige wall and a small red bag, median cut gives three beiges
and one red at 3 %, k-means gives beige, red, and two mid-tones. The UI offers both and the test asserts they differ
by ΔE ≤ 3 per swatch only on *simple* fixtures — on complex ones they are allowed to disagree, because that is the
point of having two.

### 2.5 What proportions mean

`share` is the fraction of **sampled** pixels nearest that swatch, rounded to one decimal and normalised so the
total is exactly 100.0 (the remainder goes to the largest swatch). The report prints `sampledAt`, because a
proportion measured on a 256 px grid is not a claim about the full-resolution pixel count.

### 2.6 Output and exports

```json
{
  "colors": [
    { "hex": "#2f3437", "rgb": [47,52,55], "hsl": [200,7.8,20], "share": 34.2, "role": "background" },
    { "hex": "#e8e2d9", "rgb": [232,226,217], "hsl": [36,25.7,88], "share": 22.9, "role": "neutral" },
    { "hex": "#c2452d", "rgb": [194,69,45], "hsl": [10,62.7,46.9], "share": 11.4, "role": "accent" }
  ],
  "algorithm": "median-cut", "count": 5, "sampledAt": 256
}
```

```css
:root {
  --palette-1: #2f3437;  /* 34.2% */
  --palette-2: #e8e2d9;  /* 22.9% */
  --palette-3: #c2452d;  /* 11.4% */
}
```

`role` is derived, not invented: the darkest swatch with the largest share is `background`, the most saturated is
`accent`, low-saturation mid-tones are `neutral`. The result card offers a **foreground suggestion** for the
background colour chosen, computed by WCAG contrast ratio (≥ 4.5:1 → white or near-black) — the one "smart" thing
this tool does, and it is arithmetic, not a model.

Imports: JSON, CSS variables, Tailwind config snippet, and a plain hex list. Download names the file
`palette-<name>-<count>.json` / `.css`.

---

## 3. Pixel picker

### 3.1 Interaction

```text
click / drag on the canvas → crosshair + loupe (nearest-neighbour, 8×–32×)
readouts: HEX · RGB · HSL · coordinates · alpha
[Copy HEX] [Copy RGB] [Copy CSS]  → adds to a session history (last 10)
```

The loupe renders a 21 × 21 pixel neighbourhood scaled to 168 px with `imageSmoothingEnabled = false`, so the user
sees actual pixels rather than a blur — the difference between picking `#c2452d` and picking a blend of it and its
neighbour.

### 3.2 Conversion rules

| Value | Rule |
|---|---|
| HEX | lowercase 6-digit; alpha reported separately as `#rrggbbaa` when `< 255` |
| RGB | integers 0–255 |
| HSL | H 0–359.9 (one decimal), S/L 0–100 (one decimal) |
| Alpha | displayed as a percentage and as a byte |
| Coordinates | source pixels, top-left origin, **after** EXIF orientation |

The coordinate frame is the upright one, matching the crop board ([03](03-EDIT.md) §3.1). A coordinate that refers to
the stored frame rather than the displayed frame is the second most common bug in this class of tool.

### 3.3 Eyedropper from the OS

Where `EyeDropper` exists (Chromium), a "Pick from screen" button opens it and fills the swatch. It is additive: the
canvas picker always works, and the OS picker is a convenience that returns a colour with no image context.

---

## 4. API

```ts
{ t: 'run', jobId, op: 'palette', bitmap,
  options: { count: 5, algorithm: 'median-cut', sampleMaxSide: 256,
             ignoreTransparent: true, sort: 'dominance', minSaturation: 0 } }
```

```ts
{ t: 'result', data: { colors: [...], sampledAt: 256 }, metrics: { durationMs: 46 } }
```

`pixel-pick` does not enqueue a job: it is a synchronous read on the preview raster (`getImageData(x, y, 1, 1)`),
because a job row for a click would be absurd. It uses the same `image-core/color.ts` conversions that the palette
tool and the tests use.

Lane B: neither tool is server-capable. There is no reason to upload an image to read five colours from it.

---

## 5. Flow

```text
palette
  drop 4 images → batch → 4 palettes (one card each, or a comparison strip)
  choose count 5, algorithm median-cut, sort hue
  preview updates live (46 ms for a 12 MP sample)
  [Copy CSS] [Download JSON]

picker
  drop → click → readouts appear under the loupe
  drag → readouts follow continuously, throttled to 60 Hz
  history → 10 recent colours, each copyable
```

---

## 6. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| A photo with one dominant colour | returns duplicates merged, then fewer than `count` swatches; the card says "3 distinct colours found" rather than padding with near-duplicates |
| Near-duplicate swatches | merged at ΔE < 2 and the freed slot is refilled by the next box |
| `minSaturation` | filters low-saturation pixels before clustering; useful for "what is the accent colour" |
| Transparency | ignored by default; a fully transparent image reports "no opaque pixels" |
| Grayscale image | palette is grey; `sort: hue` falls back to lightness with a note |
| Batch of 50 | one palette per file; the comparison strip virtualises above 12 |
| Colour accuracy | sRGB as decoded by the browser; a wide-gamut source is converted and the report says so |
| Picker on a JPEG | reports the decoded pixel, which includes compression artefacts — that is the truth of the file |
| Picker at 800 % zoom | coordinates still map to source pixels, not screen pixels |
| CSS export naming | `--palette-N`, stable order matching the visible list |

| Limit | Value |
|---|---|
| Palette files per batch | 50 |
| Palette sample | 32–1024 px longest side |
| Swatch count | 3, 5, 8, 10 |
| Picker history | 10 |
| Picker loupe | 8×–32× nearest |

---

## 7. Acceptance tests

```text
bun run e2e:tool -- --tool colors       8 cases

counts        3/5/8/10 produce that many distinct swatches on a 6-colour fixture
algorithms    median-cut vs k-means differ ≤ ΔE 3 on a simple fixture, and both are stable across runs
proportions   sum to 100.0 exactly; the largest swatch carries the rounding remainder
css export    valid CSS, pastes into a stylesheet, names match the JSON order
json export   parses; each entry has hex, rgb, hsl, share
sort hue      hue is non-decreasing; lightness sort is non-decreasing
picker hex    click at (10,10) on the grid fixture returns the exact expected hex
picker alpha  a 50 % alpha pixel reports 50 % / #rrggbb80
coordinates   after EXIF rotate 6, the reported coordinate matches the upright frame
loupe         at 32×, only source colours appear (no interpolation)
```

```text
bun run test:pixels -- --op palette      proportion of a half-red/half-blue fixture is 50/50 ± 0.5
```

---

## 8. Related docs

- [`08-UTILITIES.md`](08-UTILITIES.md) — the analyzer that reports the same colour mode
- [`03-EDIT.md`](03-EDIT.md) §3.1 — the coordinate frame the picker shares
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) §6 — downloading a non-image artifact
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) §4.7 — the `PaletteOptions` schema
