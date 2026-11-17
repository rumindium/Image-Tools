# 02 — Compress

> Smaller files, with the number the user actually cares about shown twice: what it was, and what it is now.
> Tool id: `compress` · category: `optimize` · lane: `browser` · batch ✓ · phase 1
> Last updated: 16 November 2026

---

## 1. Overview

`compress` reduces bytes in one of two ways: by quality (an encoder setting the user understands) or by target size
(a number the user was given, usually by a form field on someone else's website).

**Does:** re-encode to JPEG/WebP/AVIF at a chosen quality, or search for the best quality under a byte target,
optionally cap the dimensions first, strip metadata, show a before/after comparison with exact byte counts, and
batch the whole thing.

**Does not:** remove metadata only (that is `metadata-clean`), change the format silently, resize to hit a target
without saying so, or claim a lossless PNG optimisation — which is not available in a canvas pipeline
([13](13-EXPORT-MANAGER.md) §7).

The interesting engineering is the target search: a byte target is a one-dimensional problem with a non-monotonic
function, and most tools solve it by binary-searching quality until they feel lucky. This one is bounded, reports
what it found, and refuses to pretend.

---

## 2. Inputs

| Property | Value |
|---|---|
| Accepted | JPEG, PNG, WebP, AVIF, GIF (static), BMP, HEIC, TIFF |
| Min / max files | 1 / 200 |
| Max size | 100 MB per file, 1.5 GB per batch |
| Max pixels | 40 MP, reduced to 16 MP on low-memory devices |
| Already small | a file below 3 KB is accepted and usually grows; the result says so |

Compressing a 2 KB icon is legitimate (the user may be normalising a folder), so it is not refused — it is simply
likely to grow, and the result card's red percentage is the honest answer.

---

## 3. Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `mode` | `quality \| target` | `quality` | |
| `quality` | 1–100 | 80 | used in `quality` mode |
| `targetBytes` | 10 000–50 000 000 | — | required in `target` mode |
| `format` | `jpeg \| webp \| avif \| png` | `webp` | PNG cannot be compressed by quality |
| `maxWidth` | 16–20 000 | — | applied before encode |
| `maxHeight` | 16–20 000 | — | |
| `stripMetadata` | boolean | `true` | |
| `background` | hex | `#ffffff` | alpha flattening |

`format: 'png'` with `mode: 'quality'` is rejected by `superRefine`: PNG has no quality knob, and silently ignoring
the slider is worse than refusing the combination. PNG in target mode is also refused — reaching a byte target on
PNG requires palette quantisation, which is deliberately not in the MVP (it changes the picture in a way this UI
cannot preview honestly).

---

## 4. API

```ts
{ t: 'run', jobId, op: 'compress', bitmap,
  options: { mode: 'target', targetBytes: 307200, format: 'webp',
             stripMetadata: true, background: '#ffffff' } }
```

```ts
{ t: 'result', blob, metrics: {
    inputBytes: 4718592, outputBytes: 298114,
    quality: 74, attempts: 6, targetBytes: 307200, targetMet: true,
    inputFormat: 'jpeg', outputFormat: 'webp',
    durationMs: 2180, stages: { decode: 260, transform: 0, encode: 1860, measure: 12 } } }
```

Server lane: `tool: "compress"` is **not** server-capable. Compressing a 40 MP image in the tab takes seconds and
sends nothing; offering a server path for it would break the privacy claim for the most common use case in the
product. The registry marks it `{ kind: 'browser' }`, and `POST /jobs` refuses it with a `VALIDATION_ERROR` that
says so.

Errors: `VALIDATION_ERROR` (target missing, PNG + quality), `TARGET_SIZE_UNREACHABLE` (warning-shaped failure of
the *target*, not of the job), `ENCODING_FAILED`, `MEMORY_LIMIT_EXCEEDED`.

---

## 5. Engine recipe

### 5.1 Quality mode

```ts
const blob = await encode(input, encoder, o.quality);
```

Nothing else. If `maxWidth`/`maxHeight` are set, the resize runs first through the same `resize` op
([04](04-RESIZE.md) §5) so that the fit rules are identical to the resize tool's.

### 5.2 Target mode — a bounded search

```ts
export async function searchQuality(
  input: RasterImage, encoder: Encoder, target: number,
  ctx: { signal: AbortSignal; report: (pct: number) => void },
): Promise<{ blob: Blob; quality: number; attempts: number; met: boolean }> {
  let lo = 1, hi = 100, best: { blob: Blob; quality: number } | null = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    ctx.signal.throwIfAborted();
    const q = Math.round((lo + hi) / 2);
    ctx.report(0.4 + attempt * 0.09);
    const blob = await encode(input, encoder, q);
    if (blob.size <= target) {
      if (!best || blob.size > best.blob.size) best = { blob, quality: q };   // best quality that fits
      lo = q + 1;
    } else {
      hi = q - 1;
    }
    if (blob.size >= target * 0.95 && blob.size <= target) break;              // close enough
  }
  return best
    ? { ...best, attempts, met: true }
    : { blob: await encode(input, encoder, 1), quality: 1, attempts, met: false };
}
```

Why exactly this shape:

- **Six attempts, not "until it converges".** Each attempt is a full encode of a possibly 40 MP image. Six is
  ~2 s on a photo and bounded on the slowest device; a while-loop with a 1 KB tolerance can run 30 encodes chasing
  a target between two adjacent quality steps.
- **`best` is "the largest blob that still fits", not "the last one".** Quality is not monotonic in bytes for
  VP8/AV1 locally; keeping the largest fitting result means a lucky inversion does not cost the user quality.
- **The early exit is 95–100 % of the target**, because landing at 60 % of an allowed budget is a visible quality
  loss for no reason. The result card shows the achieved size anyway.
- **Unreachable is a result, not an error.** `met: false` yields a warning, the smallest achievable size, and the
  suggestion to reduce dimensions — a resize the user can accept or decline ([§7](#7-quality-limits-and-known-behaviour)).

### 5.3 Estimated size before running

The card shows an estimate from a cached calibration: one encode at q50 on a 512 px preview, then a linear model
of `bytes ≈ k(format) × pixels × f(quality)`. It is labelled "≈" and is allowed to be 30 % off. A precise-looking
number the tool cannot deliver is worse than none.

---

## 6. Flow

```text
UI                                    Worker
 │ drop 3.4 MB jpeg                    │
 │ mode: target 300 KB, WebP           │
 │ [est. ≈ 280 KB]                     │
 │ Run                                 │
 ├────────────────────────────────────►│ decode
 │◄── "searching quality 62…" 0.49 ────┤ encode q62 → 341 KB (> target)
 │◄── "searching quality 43…" 0.58 ────┤ encode q43 → 268 KB (fits, best)
 │◄── "searching quality 52…" 0.67 ────┤ encode q52 → 305 KB (> target)
 │◄── "searching quality 47…" 0.76 ────┤ encode q47 → 286 KB (fits, best)
 │◄── "searching quality 49…" 0.85 ────┤ 295 KB, within 95 % → stop
 │◄── result 295 KB, q49, 5 attempts ──┤
 │ 3.4 MB → 295 KB (−91.3 %)           │
 │ [Compare] [Download] [Try smaller]  │
```

The progress bar carries the attempt count, because "searching quality 62…" explains why the bar is slow while a
bare percentage does not.

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Target unreachable at q1 | warning `TARGET_SIZE_UNREACHABLE`; the smallest blob is offered with "reduce dimensions to X px to reach 300 KB" computed from the byte-per-pixel ratio |
| Target already met by the source | the source is **not** re-encoded; the result is the original blob with `SKIPPED_ALREADY_SMALLER` and zero quality loss |
| PNG chosen | rejected in both modes with a sentence naming the two formats that work |
| Alpha source → JPEG | flattened onto `background`; `ALPHA_FLATTENED` |
| Metadata | stripped by default because that is where 30–200 KB of a phone photo lives; `stripMetadata: false` keeps what the encoder keeps (usually nothing) |
| Very low quality | allowed down to 1; the card warns below 40 with "visible blocking" and shows the comparison |
| Grow case | reported with a red percentage and a suggestion; never silently retried at another quality |
| AVIF | often the smallest, and the slowest to encode; the estimate says "≈" plus a time warning above 20 MP |
| EXIF orientation | applied at decode, so a rotated phone photo is not compressed sideways |

| Limit | Value |
|---|---|
| Files | 1–200 |
| Pixels | 40 MP / 16 MP low-memory |
| Target range | 10 KB–50 MB |
| Encodes per file | 1 (quality) or ≤ 6 (target) |
| Watchdog | `max(30 s, 3 × estimate)`; the target search's estimate accounts for all six attempts |

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool compress     9 cases

quality mode     q60 < q90 bytes; both decode; reduction % matches metrics
target mode      target 300 KB on a 4.5 MB photo → ≤ 300 KB, ≥ 4 attempts, met: true
early exit       a target of 95 % of the q80 output stops at ≤ 6 attempts
unreachable      target 5 KB on a 4.5 MB photo → met: false, q1 blob, warning + suggested dimensions
no search        a 200 KB source with a 300 KB target → skipped, bytes unchanged
png refused      format png + quality mode → VALIDATION_ERROR (not a silent JPEG)
maxWidth         capped dimensions in the result and the comparison
binary search    instrumented: max quality that fits is returned, not the last attempted
batch 10         ten files, ten results, one lane badge, no leak (bitmap open == close)
```

```text
bun run test:pixels -- --op compress    q95 of a PNG fixture retains ≥ 45 dB PSNR
bun run test:falsify --only compress-best-fitting
    mutation: return the last attempt instead of the best fitting one → target-met case must fail
```

---

## 9. Related docs

- [`01-CONVERT.md`](01-CONVERT.md) — the same encode path without a target
- [`04-RESIZE.md`](04-RESIZE.md) — and why resizing to hit a byte target is offered, never automatic
- [`10-METADATA.md`](10-METADATA.md) — how much of a photo's size is EXIF
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §5.1 — the canonical version of the search loop
