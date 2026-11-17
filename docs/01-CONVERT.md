# 01 — Convert

> Change the container without touching the picture. The simplest tool in the product and the one that proves the
> whole pipeline.
> Tool id: `convert` · category: `convert` · lane: `browser` · batch ✓ · phase 1
> Last updated: 16 November 2026

---

## 1. Overview

`convert` re-encodes an image into another format at the same dimensions. It is the first tool built because it
exercises every stage — sniff, decode, encode, measure, name, export — without needing an interesting transform.

**Does:** JPEG ⇄ PNG ⇄ WebP ⇄ AVIF (encoder permitting), BMP and ICO output, alpha flattening onto a chosen colour
when the target has no alpha, per-format quality, naming rules, batch conversion with a ZIP.

**Does not:** resize (use `resize`), compress toward a byte target (use `compress`), write ICC profiles or DPI
metadata (the browser cannot), produce SVG (no vector path exists in this pipeline), or re-encode animations
([pipeline](0-PROCESSING-PIPELINE.md) §2).

The tool is deliberately boring. Its value is that "convert 12 photos to WebP" is the most common job in this
category, and a conversion that silently loses the alpha channel or renames the file wrongly poisons every later
tool in the chain.

---

## 2. Inputs

| Property | Value |
|---|---|
| Accepted | JPEG, PNG, WebP, AVIF, GIF (static), BMP, SVG, HEIC/HEIF, TIFF |
| Detected by | magic bytes, never the extension ([pipeline](0-PROCESSING-PIPELINE.md) §2) |
| Min / max files | 1 / 200 |
| Max size | 100 MB per file, 1.5 GB per batch |
| Max pixels | 40 MP desktop, 16 MP mobile/≤ 4 GB |
| Animated | refused with `ANIMATED_NOT_SUPPORTED` |
| SVG | accepted as a raster source at `viewBox × 2` density, capped by the pixel limit |

HEIC and TIFF are accepted only when their lazy decoder chunk can load (1.2 MB and 0.4 MB respectively). The
option to *choose* them as input is hidden, not disabled, when the chunk fails: a format the device cannot read
should not appear in a list of formats it can.

---

## 3. Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `format` | `jpeg \| png \| webp \| avif` | `webp` | options whose encoder is missing are disabled with the probe's reason |
| `quality` | 1–100 | 82 | ignored for PNG; per-format defaults exist ([0-CONFIG](0-CONFIG.md) §6) |
| `background` | hex | `#ffffff` | used only when the target has no alpha |
| `keepMetadata` | boolean | `false` | see §7 — mostly it cannot be honoured, and the UI says so |
| `naming.mode` | `keep \| suffix \| template` | `suffix` | |
| `naming.suffix` | string ≤ 24 | `''` | appended to the base name, e.g. `-web` |
| `naming.template` | string ≤ 80 | — | `{name}`, `{width}`, `{height}`, `{format}`, `{index}` |
| `overwrite` | boolean | `false` | affects the exported name, never the source file |

Deliberately absent: colour profile, DPI, chroma subsampling, progressive/interlaced. All four are encoder-level
settings a canvas does not expose ([10-METADATA](10-METADATA.md) §6 lists the one DPI exception).

---

## 4. API

Lane A has no HTTP call; the job is a worker message. The shape is shown because the registry, the batch queue and
the tests all use it.

```ts
// main → worker
{ t: 'run', jobId, op: 'convert',
  bitmap, options: { format: 'webp', quality: 80, background: '#ffffff',
                     keepMetadata: false, naming: { mode: 'suffix', suffix: '-web' }, overwrite: false } }
```

```ts
// worker → main (result)
{ t: 'result', jobId,
  blob,                        // image/webp
  metrics: { inputBytes: 4821331, outputBytes: 812004,
             inputWidth: 4032, inputHeight: 3024, outputWidth: 4032, outputHeight: 3024,
             inputFormat: 'jpeg', outputFormat: 'webp', quality: 80,
             durationMs: 640, fallback: false } }
```

On the server lane (only reachable for a batch over the limit, not for a single convert):

```http
POST /api/v1/jobs
{ "tool": "convert", "files": ["…"], "options": { "format": "webp", "quality": 80 },
  "lane": "server", "consent": { "acceptedAt": "…", "version": "2026-11-01" } }
```

Errors: `UNSUPPORTED_FILE_TYPE`, `ANIMATED_NOT_SUPPORTED`, `ENCODE_UNSUPPORTED` (probe says no, and the UI should
have prevented it), `ENCODING_FAILED`, `IMAGE_TOO_LARGE`, `MEMORY_LIMIT_EXCEEDED`.

Warnings: `METADATA_DROPPED` (always, when `keepMetadata` was requested and the encoder ignored it),
`ALPHA_FLATTENED` (transparent source → opaque target), `ENCODER_FALLBACK` (asked for AVIF, got another type).

---

## 5. Engine recipe

```ts
// packages/image-browser/src/ops/convert.ts
export const convert: Transform = async (input, o, ctx) => {
  const target = pickEncoder(o.format, ctx.caps);            // probe-backed, throws ENCODE_UNSUPPORTED
  ctx.report('encode', 0.55);

  const flat = target.alpha ? input
                            : await flatten(input, o.background);   // composite onto colour
  const blob = await encode(flat, target, o.quality);

  if (blob.type !== target.mime) {                            // Safari's WebP → PNG surprise
    if (!o.formatAuto) throw new EncodeFallback(blob.type);   // refuse rather than mislabel
    return { blob, warnings: ['ENCODER_FALLBACK'] };
  }
  return { blob };
};
```

Three implementation notes that are the whole tool:

1. **`blob.type` is checked, not trusted.** `canvas.convertToBlob({ type: 'image/webp' })` on an old Safari
   returns `image/png` with no error. Naming that file `.webp` is the most common lie in this product category,
   so the exporter names the file from `blob.type` and the result card warns.
2. **Flattening happens before encode, once.** The alternative — passing a background to the encoder — does not
   exist in the canvas API; compositing onto an offscreen canvas filled with the colour is the only correct path,
   and it must happen *before* the encode so that the alpha is actually gone.
3. **No re-decode per format.** A batch of 12 files converts each once; the encoder is chosen per job, not per
   file, so the probe result is reused. A per-file encoder choice would re-probe the browser 12 times.

### 5.1 Naming

```text
keep      photo.jpg            → photo.webp
suffix    photo.jpg  "-web"    → photo-web.webp
template  "{name}-{width}x{height}" → photo-4032x3024.webp
collision photo.webp exists    → photo (2).webp          (in a ZIP, not on disk)
```

Names are sanitised by `image-core/naming` before the suffix is applied: `my/photo.jpg` cannot exist as an input
name, but a template can produce one, and the exporter must never emit a path separator
([13](13-EXPORT-MANAGER.md) §5).

---

## 6. Flow

```text
UI                                  Worker
 │ drop photo.jpg                     │
 ├─ sniff → jpeg, 4032×3024, 4.8 MB   │
 │  (row shows dimensions immediately)│
 │ choose WebP q80                    │
 ├─ schema.parse                      │
 │ press Run                          │
 ├── run {op:'convert'} ─────────────►│ decode (EXIF applied)
 │◄── progress 0.25 decode ───────────┤
 │◄── progress 0.55 encode ───────────┤
 │                                    ├─ flatten? no (webp has alpha)
 │                                    ├─ encode webp q80
 │◄── result 812 KB, 640 ms ──────────┤
 │ result card: 4.8 MB → 812 KB (−83 %)
 │ badge: This tab
 │ [Download] [Add to batch] [Open]
```

The result card's "−83 %" is computed from `metrics`, never estimated. A conversion that grows a file (PNG → JPEG
at q100) shows a **positive** percentage in the warn colour with the sentence "The JPEG is larger than the PNG —
try a lower quality." Growing a file is not an error; hiding it would be.

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Transparency | preserved for WebP/AVIF/PNG; flattened for JPEG/BMP with `ALPHA_FLATTENED` |
| Metadata | dropped by default. `keepMetadata` cannot be honoured through canvas ⇒ `METADATA_DROPPED` warning, documented rather than faked |
| Colour profile | browsers normalise to sRGB on decode; a wide-gamut source is converted without warning because the conversion is usually desired and cannot be avoided |
| DPI | not preserved, not written. A 300 DPI scan becomes 72 DPI in metadata while its pixels are unchanged; the tool doc says so and [10](10-METADATA.md) §6 explains the workaround |
| GIF | static only; an animated GIF is refused rather than losing frames |
| SVG in | rasterised; the output has no vectors |
| SVG out | not offered |
| BMP/ICO | hand-written encoders; BMP is 32-bit BGRA, ICO supports 16/32/48/256 |
| Quality curve | q95 on a PNG source can be *larger* than the source; shown, not hidden |
| Very large output | a 40 MP PNG can exceed 100 MB; the download still works, the ZIP warns above 1 GB |

| Limit | Value |
|---|---|
| Files | 1–200 |
| Pixels | 40 MP (16 MP on low-memory devices) |
| Timeout (watchdog) | `max(30 s, 3 × estimate)` |
| Encodes per job | 1 (no search — that is `compress`) |

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool convert      8 cases

JPG → PNG            dimensions unchanged, output type image/png, bytes reported
PNG(alpha) → WebP    alpha coverage within 1 % of the source
PNG(alpha) → JPEG    corner pixel equals the chosen background exactly; ALPHA_FLATTENED warning
PNG → AVIF           output type image/avif on a capable browser; control disabled otherwise
quality sweep        q40 < q82 < q95 bytes on the same source
fallback             simulate convertToBlob returning image/png; assert ENCODER_FALLBACK and a .png name
naming               "holiday photo.jpg" + suffix "-web" → "holiday photo-web.webp"; "/" refused by schema
batch 5              ZIP has 5 entries, all decode, names unique
```

```text
bun run test:pixels -- --op convert      PNG→PNG round trip is pixel-identical (lossless path)
bun run test:falsify --only convert-type-check
    mutation: trust the requested type instead of blob.type → the fallback case must fail
```

---

## 9. Related docs

- [`02-COMPRESS.md`](02-COMPRESS.md) — the same pipeline with a byte target and a search
- [`04-RESIZE.md`](04-RESIZE.md) — the usual second step after a conversion
- [`10-METADATA.md`](10-METADATA.md) — why `keepMetadata` is mostly a warning
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — naming, ZIP, and the actual MIME
