# 06 — Background Editor

> After the matte exists: put something behind the subject, fix the edge by hand, and make the composite look like
> it was photographed that way.
> Tool id: `bg-replace` · category: `ai` · lane: `browser` · batch ✓ · phase 3
> Last updated: 16 November 2026

---

## 1. Overview

**Does:** composite a cut-out subject onto transparency, a solid colour, a gradient or an uploaded image; add a
shadow or an outline; adjust the subject's scale and position; paint on the matte with an erase/restore brush;
export PNG/WebP/JPEG.

**Does not:** remove a background (that is [05](05-BACKGROUND-REMOVER.md)), keep layers across sessions, or blend the
subject into the backdrop with colour matching (a real compositing feature that needs research-grade relighting;
pretending to do it with an opacity slider would be worse than not offering it).

The page exists because "remove background" is only half a job. The other half is "and put a white background
behind it for a marketplace listing" or "and a gradient for an Instagram post", and that half is entirely
deterministic — no model, no server, no surprises.

---

## 2. Inputs

| Property | Value |
|---|---|
| Subject | any image; if it has no alpha, `bg-remove` runs first (inline, with the same model UX) |
| Background image | JPEG/PNG/WebP/AVIF up to 40 MP, one per job |
| Files | 1–20 subjects (batch uses one background config) |
| Max pixels | 40 MP |
| Mask edits | stored as strokes, replayed on the matte |

A subject with an existing alpha channel (a PNG from [05](05-BACKGROUND-REMOVER.md), or a designer's asset) skips
removal entirely: the tool detects meaningful alpha (coverage between 1 % and 99 %) and uses it as the matte. That
makes the page useful without any AI at all, which matters because the AI path can be unavailable.

---

## 3. Options

| Option | Values | Default |
|---|---|---|
| `background.type` | `transparent \| color \| gradient \| image` | `transparent` |
| `background.color` | hex | `#ffffff` |
| `background.kind` | `linear \| radial` | `linear` |
| `background.angle` | 0–360 | 135 |
| `background.stops` | 2–6 × `{ color, at }` | white → `#e5e7eb` |
| `background.imageId` | file id | — |
| `background.fit` | `cover \| contain \| stretch` | `cover` |
| `background.blur` | 0–100 | 0 |
| `background.scale` | 0.1–4 | 1 |
| `background.offsetX/Y` | −1..1 | 0 |
| `shadow` | `{ enabled, blur 0–80, opacity 0–1, offsetY −40..40 }` | off |
| `outline` | `{ enabled, width 1–40, color }` | off |
| `maskEdits` | strokes `{ op, points, radius, hardness, opacity }` | `[]` |
| `exportFormat` | `png \| webp \| jpeg` | `png` |

`offsetX/Y` are in **fractions of the canvas**, not pixels: a config that positions a subject at `0.5, 0.5` works
for the same job across 12 files of different sizes, which is exactly what a batch needs.

---

## 4. API

```ts
{ t: 'run', jobId, op: 'bg-replace', bitmap,
  options: { background: { type: 'gradient', kind: 'linear', angle: 135,
                           stops: [{ color: '#ffffff', at: 0 }, { color: '#e5e7eb', at: 1 }] },
             shadow: { enabled: true, blur: 24, opacity: 0.3, offsetY: 14 },
             outline: { enabled: false },
             maskEdits: [{ op: 'restore', points: [[812, 460], [820, 466]], radius: 24,
                           hardness: 0.7, opacity: 0.8 }],
             exportFormat: 'png' },
  aux: { maskBitmap, backgroundBitmap } }
```

`aux` carries two extra bitmaps, both transferred. The matte is a separate transferable because a 40 MP alpha is
40 MB and must not be re-derived inside the worker. Lane B is not offered for this tool: composition is a
`drawImage` and a gradient fill, and uploading a user's image to composite it would be indefensible.

---

## 5. Engine recipe

```text
1. matte      = existing alpha OR model output OR brush-edited matte
2. canvas     = subject dimensions (unless background.image forces another size)
3. paint bg   transparent → checkerboard only in the preview, never in the canvas
             color       → fillRect
             gradient    → createLinearGradient / createRadialGradient, stops sorted by `at`
             image       → drawImage with cover/contain/stretch + blur (ctx.filter = `blur(Npx)`)
4. shadow     = draw the matte offset by (0, offsetY), blurred, in black at `opacity`, behind the subject
5. subject    = drawImage(subject) with globalCompositeOperation = 'source-over' using the matte as mask
6. outline    = stroke the matte's dilated edge (1–40 px) under the subject
7. export     = encode; JPEG flattens onto background.color (or white for transparent)
```

### 5.1 Compositing with alpha, correctly

```ts
// 1. put the subject on its own canvas with the matte applied
subjectCanvas.ctx.drawImage(subject)
subjectCanvas.ctx.globalCompositeOperation = 'destination-in'
subjectCanvas.ctx.drawImage(matteCanvas)          // alpha only

// 2. draw onto the background with source-over — the browser premultiplies for us
out.ctx.drawImage(subjectCanvas, dx, dy, dw, dh)
```

`destination-in` with the matte is the only reliable way to apply a soft mask across browsers: clipping paths do
not accept alpha, and `globalAlpha` applies to the whole image. The double canvas costs one extra full-size buffer,
which the budget already accounts for ([pipeline](0-PROCESSING-PIPELINE.md) §6.3).

Premultiplication matters: drawing a non-premultiplied RGBA over a colour produces a dark fringe at semi-transparent
pixels, which is the halo users blame on the model.

### 5.2 Shadow

```ts
shadowCtx.filter = `blur(${blur}px)`;
shadowCtx.globalAlpha = opacity;
shadowCtx.drawImage(matte, 0, offsetY);     // black silhouette from the alpha
```

Drawing the *matte* rather than the subject's bounding box is what makes the shadow follow the actual outline,
including a gap between an arm and the torso. A rectangle shadow is instantly recognisable as fake.

### 5.3 Brush

```ts
// strokes are data; painting is a replay
for (const s of maskEdits) {
  for (const [x, y] of interpolate(s.points, s.radius / 2)) {
    stamp(matteCtx, x, y, s.radius, s.hardness, s.opacity, s.op === 'erase' ? 'destination-out' : 'source-over');
  }
}
```

- `erase` uses `destination-out` on the matte; `restore` redraws from the **original model matte**, not from white,
  so restoring does not invent alpha where the model said 0.
- Points are interpolated at half-radius spacing, so a fast drag does not produce a dotted line.
- Hardness is a radial gradient stop position (0 = fully feathered, 1 = hard edge).
- A full-resolution 40 MP replay of 200 strokes is ~300 ms; the preview replays on the 2048 px copy at 60 fps.

---

## 6. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| No alpha on the input | runs `bg-remove` inline; if that fails, the page still opens in "use existing alpha only" mode |
| Transparent export of a JPEG source | the alpha from the matte is real; the JPEG option flattens it and says so |
| Gradient correctness | stops are sorted by `at` before the gradient is built; an unsorted stop list is a canvas error, not a warning |
| Background image larger than the subject | cover crops it; the focus is centre unless moved |
| Outline on a soft matte | the outline follows the 0.5 alpha contour, so hair is not outlined strand by strand |
| Shadow + transparent background | the shadow is visible only where it overlaps the subject's own alpha; on transparency it is exported as dark pixels, which is usually not what the user wants — the UI hides `shadow` when `transparent` is selected |
| Subject scaled > 1 | may exceed the canvas and be cropped; the UI clamps the scale to keep the subject's bounding box inside |
| Batch | one background config for all; mask edits are per file and are **not** applied across files (a stroke on photo 1 is meaningless on photo 2) |
| Reset | clears position/scale/mask edits, keeps the background choice |

| Limit | Value |
|---|---|
| Subjects | 1–20 |
| Background image | 1, ≤ 40 MP |
| Mask strokes | 500 per image (older strokes are merged into the base matte, with a notice) |
| Output pixels | 64 MP |
| Timeout | `max(30 s, 3 × estimate)` |

---

## 7. Acceptance tests

```text
bun run e2e:tool -- --tool bg-replace   9 cases

transparent     preview shows the checkerboard; the exported PNG's corner alpha is 0 (no checker pixels)
color           corner pixel equals the hex exactly; HEX and RGB inputs agree
gradient        3 stops at 135°: four corner colours match the stops within ΔE 2
image bg        cover / contain / stretch place the background as documented
blur            blur 40 reduces edge variance of the background (measured), subject unchanged
shadow          subject centre pixel unchanged; the offset region below the subject darkens
outline         ring exists outside the matte at the given width and colour; hair region not outlined
layers          toggling visibility never mutates the matte bytes
reset           offsetX/Y/scale return to 0/0/1, mask edits cleared
```

```text
bun run test:pixels -- --op bg-replace   composite of a 50 % alpha pixel over white equals 50 % blend, not a fringe
bun run test:memory                      two full-size buffers + matte; released after encode
```

---

## 8. Related docs

- [`05-BACKGROUND-REMOVER.md`](05-BACKGROUND-REMOVER.md) — the matte this page consumes
- [`0-AI-MODELS.md`](0-AI-MODELS.md) §6 — preprocessing and edge refinement
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — the final encode and naming
- [`0-UI-DESIGN.md`](0-UI-DESIGN.md) §3.3 — the layout with the canvas and the brush toolbar
