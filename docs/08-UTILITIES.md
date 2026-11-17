# 08 — Utilities

> Base64, data URIs, the image analyzer, and the small conversions developers and designers actually need.
> Tool id: `base64`, `analyze` · category: `inspect` · lane: `browser` · batch ✓ · phase 2
> Last updated: 16 November 2026

---

## 1. Overview

The utilities page is a set of small, high-precision tools. None of them is large; all of them are used daily by the
people who use them at all.

| Tab | Tool id | In → Out |
|---|---|---|
| Base64 | `base64` | image ↔ base64 text / data URI |
| Data URI | `base64` (direction `encode`, `includeDataUri`) | image → URI |
| Analyze | `analyze` | image → report |
| Pixel picker | `pixel-pick` | see [09](09-COLOR-TOOLS.md) — moved there because it shares the colour math and the loupe |

The pixel picker lives in 09 for a reason worth stating: its output (HEX/RGB/HSL) is colour data, its neighbours
there are swatches and palettes, and splitting the colour conversion across two documents is how its rounding rules
drift apart.

---

## 2. Base64

### 2.1 Inputs

| Direction | Accepts | Limits |
|---|---|---|
| encode | any image `convert` accepts | 100 MB in; encoded text capped at 40 MB |
| decode | a `data:` URI or a bare base64 string | 40 MB text; validation before allocation |

### 2.2 Options

| Option | Type | Default |
|---|---|---|
| `direction` | `encode \| decode` | `encode` |
| `includeDataUri` | boolean | `true` |
| `lineWrap` | 0–120 | 0 (no wrapping) |
| `format` | `jpeg \| png \| webp` | `png` |
| `quality` | 1–100 | 85 |
| `text` | string | — (decode only) |

### 2.3 Recipe

```ts
// encode: re-encode first so the text matches the chosen format, then base64
const blob = await encode(bitmap, { format: o.format, quality: o.quality });
const b64 = await blobToBase64(blob);           // FileReader, chunked — not String.fromCharCode(...bytes)

// decode: strip the prefix, validate the alphabet and length, then decode
const { mime, payload } = parseDataUri(o.text); // mime falls back to a magic-byte sniff
if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new ValidationError('Invalid base64 at character …');
const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
```

Three details that decide whether this tab is usable:

- **Never `String.fromCharCode(...bytes)`.** Spreading a 4 M-element array into a function call throws
  `RangeError: Maximum call stack size exceeded` at ~100 KB. `FileReader.readAsDataURL` and chunked `btoa` both
  avoid it; the chunked path is used so the encode happens in the worker and the main thread stays responsive.
- **Validation before allocation.** A 40 MB string that is not base64 should fail in 2 ms with the offending
  character position, not after allocating 30 MB.
- **The MIME comes from the bytes when the prefix is absent or wrong.** `data:image/png;base64,<JPEG bytes>` is a
  real thing that people paste; the tool reports the detected type and warns about the mismatch rather than
  producing a PNG-named JPEG.

### 2.4 Output

```text
data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoEAAQAAUAmJaQAA3AA/vuUAAA=
```

Copy puts the exact string on the clipboard; download saves it as `photo.txt` / `photo.base64.txt`; the length in
characters and bytes is shown (they differ by ~33 %, which surprises people, so it is stated).

---

## 3. Analyzer

### 3.1 Inputs and options

| Property | Value |
|---|---|
| Files | 1–50 |
| Options | `detectTransparency` (default ✓), `detectColorProfile` (✓), `includeAspectName` (✓) |
| Output | a report object, copyable as JSON and as a table |

### 3.2 What it reports, and how each value is obtained

| Field | Source | Accuracy |
|---|---|---|
| width / height | decoded bitmap (not the header — they can disagree) | exact |
| megapixels | `w × h / 1e6`, one decimal | exact |
| aspect ratio | reduced fraction + common name (16:9, 4:3, 3:2, 1:1, 5:4, 21:9) | exact |
| orientation | EXIF tag 1–8 + the effect ("rotate 90° CW") | exact |
| file size | blob size | exact |
| MIME / extension | sniffed bytes + the source name | exact / as-given |
| colour mode | decoded `ImageData` channel analysis: RGB, RGBA (any alpha < 255), grayscale (r=g=b for all sampled) | sampled |
| transparency | sampled alpha scan at 512 px + a note | **sampled** |
| DPI | EXIF/JFIF density if present | as-stored, else "not available" |
| colour profile | ICC presence via a header parse of PNG `iCCP` / JPEG `APP2` / WebP `ICCP` | presence only, not the profile name |
| has animation | sniffed | exact |
| bit depth | header where parseable (PNG IHDR, TIFF tags) | exact or "unknown" |

The two "sampled" rows are labelled `sampledAt: 512` in the report. A tool that says "no transparency" after looking
at a 512 px grid of a 40 MP image is guessing, and this product does not print guesses as facts.

### 3.3 JSON shape

```json
{
  "name": "product.jpg", "bytes": 4821331, "format": "jpeg", "mime": "image/jpeg",
  "width": 4032, "height": 3024, "megapixels": 12.2,
  "aspect": { "ratio": "4:3", "value": 1.3333 },
  "orientation": { "tag": 6, "effect": "rotate 90° clockwise" },
  "alpha": { "present": false, "sampledAt": 512 },
  "colorMode": "RGB",
  "dpi": null, "iccProfile": "present", "bitDepth": 8, "animated": false
}
```

`dpi: null` rather than `72` when absent. Defaulting to 72 is a widespread small lie that makes print-size
calculations wrong.

---

## 4. Data URI

The data URI tab is `base64` with `includeDataUri: true` and a dedicated preview:

- shows the MIME, the encoded length, and the decoded dimensions;
- a "paste into CSS" panel with `background-image: url("…")` and a note about the size cost;
- warns above 100 KB with "data URIs bloat HTML; a file is usually better" — the tool still works, it just says the
  true thing.

---

## 5. Flow

```text
base64 encode
  drop → sniff → re-encode to the chosen format (worker) → base64 (worker, chunked)
  → text area (monospace, select-all button, copy) → download .txt

base64 decode
  paste → validate alphabet + prefix → decode → sniff the result → preview + dimensions
  → "Download 482 KB image"

analyze
  drop up to 50 → decode each → report table (sortable) → copy JSON
```

A decode of a 30 MB string is refused *before* decoding, with the limit named: the tab must not freeze while a user
pastes something from a chat log.

---

## 6. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Very large encode | 40 MB text cap; above it, "use a file, not a data URI" |
| Line wrapping | 0, 64, 76, 120 — 76 is the MIME standard and the label says so |
| Base64 with whitespace/newlines | stripped before validation; a `-`/`_` URL-safe alphabet is accepted and reported |
| Data URI with a wrong MIME | detected from the bytes; a warning names both values |
| SVG as base64 | allowed for display, never for execution (rasterised, [0-SECURITY](0-SECURITY.md) §4.1) |
| Analyzer on HEIC | requires the decoder chunk; the format is reported from the header even when decoding fails |
| 50-file analyze | runs at batch concurrency; the report table fills row by row |
| Copy | uses the async clipboard API with a fallback to a selected textarea |

| Limit | Value |
|---|---|
| Encoded text | 40 MB |
| Decoded bytes | 30 MB |
| Analyze batch | 50 files |
| Analysis sample | 512 px longest side (stated in the report) |

---

## 7. Acceptance tests

```text
bun run e2e:tool -- --tool utilities    11 cases

encode      data URI prefix correct; decoding it returns identical bytes
decode      bare base64 works; MIME sniffed from magic bytes
invalid     VALIDATION_ERROR naming the character position, under 5 ms
clipboard   copied string is byte-identical to the displayed one
30 MB cap   refused with a size sentence, tab stays responsive
analyze     dimensions/aspect/orientation/MIME/size match the fixture
alpha       present on the alpha fixture, absent on the opaque one, "sampled" stated
dpi         null when absent (never 72); reported when present
icc         "present" detected on a profile-tagged JPEG
50 files    report table has 50 rows, no leak
wrap        lineWrap 76 produces lines of ≤ 76 characters ending in \n
```

---

## 8. Related docs

- [`09-COLOR-TOOLS.md`](09-COLOR-TOOLS.md) — the pixel picker and its colour conversions
- [`10-METADATA.md`](10-METADATA.md) — the full EXIF view the analyzer summarises
- [`01-CONVERT.md`](01-CONVERT.md) — the encode path used by base64
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §2 — the sniffer behind every "detected" value
