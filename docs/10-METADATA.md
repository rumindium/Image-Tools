# 10 — Metadata

> Read what a photo says about you, then decide what leaves with it.
> Tool id: `metadata`, `metadata-clean` · category: `inspect` · lane: `browser` · batch ✓ · phase 2
> Last updated: 16 November 2026

---

## 1. Overview

**Does (view):** parse EXIF, GPS, IPTC/XMP where present, ICC presence, DPI and orientation from the original bytes
— no re-encode, no loss — and show it in a table with the privacy-relevant fields marked.

**Does (clean):** remove everything, or keep a chosen allowlist, and export a new file. Includes the pre-export
warning when GPS is still present, and a batch mode.

**Does not:** edit metadata values, geotag, write XMP sidecars, or claim to keep metadata that the browser's encoder
drops.

The interesting part is not parsing — `exifr` does that well. It is that *re-encoding through a canvas drops every
tag*, so "keep the camera model" is a feature that requires writing EXIF back into the output. That is possible for
JPEG and PNG, impossible for WebP/AVIF through canvas, and this document is explicit about which is which.

---

## 2. Inputs

| Property | Value |
|---|---|
| Accepted | JPEG (APP1/APP2), PNG (`eXIf`, `iCCP`, `tEXt`), WebP (`EXIF`, `ICCP`), TIFF, HEIC (with decoder) |
| Files | 1–50 view, 1–200 clean |
| Max size | 100 MB |
| Animated | refused for clean; view works on the first frame's tags only, with a note |

Parsing reads only the **head of the file** where possible (`exifr` with `{ chunked: true }`), so a 90 MB TIFF does
not need a full read to show its camera model.

---

## 3. Options

```ts
type MetadataOptions = {
  fields: ('exif' | 'gps' | 'icc' | 'xmp' | 'iptc' | 'all')[];   // what to strip; default ['exif','gps']
  mode: 'strip' | 'keep-allowed';
  keep: string[];              // EXIF tag names, max 40, only in keep-allowed mode
  outputFormat: 'jpeg' | 'png' | 'webp' | 'avif';
  quality: number;             // 1..100, default 92
};
```

`outputFormat` defaults to the *input* format when the format can carry the preserved tags, otherwise the export
panel warns before starting: "WebP cannot keep EXIF from this tool; use JPEG or PNG to preserve the selected tags."

---

## 4. API

```ts
// view — no worker job; a parse on the main thread is < 20 ms for a 40 MB file's header
const report = await exifr.parse(blob, { chunked: true, gps: true, icc: true, xmp: true, iptc: true,
                                        translateValues: true, reviveValues: true });
```

```ts
// clean
{ t: 'run', jobId, op: 'metadata-clean', bitmap,
  options: { fields: ['exif','gps'], mode: 'keep-allowed', keep: ['Orientation','ColorSpace'],
             outputFormat: 'jpeg', quality: 92 },
  aux: { originalBytes } }        // transferred; needed to re-inject the kept tags
```

`aux.originalBytes` is the only op that needs the *original file*, not just the bitmap — because the kept tags come
from the bytes that will be discarded. It is transferred (zero-copy) and released after the encode.

Lane B: `metadata` and `metadata-clean` are browser-only. Reading tags from an image on a server would be the exact
opposite of the tool's purpose.

---

## 5. Engine recipe

### 5.1 View

```text
read head (≤ 256 KB) → exifr.parse → normalise into groups:
  camera:   Make, Model, LensModel, LensInfo, FNumber, ExposureTime, ISO, FocalLength, Flash
  capture:  DateTimeOriginal, OffsetTime, SubSecTime, Software, Artist, Copyright
  image:    Orientation, XResolution/YResolution/ResolutionUnit (DPI), ColorSpace, BitsPerSample
  gps:      GPSLatitude/Longitude (+ ref), Altitude, GPSTimeStamp, GPSSpeed, GPSImgDirection
  icc:      presence + description if parseable
  xmp/iptc: caption, keywords, creator, rights
```

Values are humanised, and the original is available on hover: `1/250 s` from `0.004`, `f/2.8` from `2.8`, `12.4 m`
from a rational. A metadata table that shows raw rationals is a developer tool, not this one.

### 5.2 Clean — strip

```ts
const blob = await encode(bitmap, { format, quality });
// canvas output carries no EXIF at all; nothing else to do
```

Stripping is free: the pipeline already re-encodes. The only subtlety is **orientation** — the bitmap was decoded
with EXIF orientation applied, so the output is upright and no orientation tag is needed. A stripped portrait is
upright, not sideways, which is the bug this ordering prevents.

### 5.3 Clean — keep-allowed (JPEG and PNG only)

```ts
// 1. encode (no tags)
// 2. build a minimal TIFF-format IFD containing only the allowed tags
// 3. inject it: JPEG → APP1 "Exif\0\0" after SOI; PNG → eXIf chunk before IDAT
// 4. fix lengths/CRC; leave the rest of the file untouched
```

Supported tags in the allowlist (a deliberate, small set):

| Tag | Why it is allowed |
|---|---|
| `Orientation` | always normalised to 1 on write (the pixels are already upright) |
| `Make`, `Model`, `LensModel` | photographers want attribution |
| `DateTimeOriginal` | archival value |
| `Artist`, `Copyright` | attribution and rights |
| `ColorSpace` | sRGB marker |
| `XResolution`, `YResolution`, `ResolutionUnit` | DPI for print workflows |
| `Software` | set to `Rumindium Image` |

Anything else is refused with a warning naming the tag, rather than silently dropped. A user who ticks "ImageDescription"
and gets nothing deserves to know before they export 200 files.

**What cannot be kept:** WebP/AVIF output, or any tag outside the table. The export panel disables the mode for those
formats with the reason. This is the honest version of "allow users to choose which metadata to preserve" (spec §10.3)
inside a browser pipeline.

### 5.4 The GPS warning

```text
"3 files still contain location data (GPS).
 Posting these to a marketplace or a social network publishes where they were taken.
 [Remove location]  [Export anyway]"
```

It appears before the export, not after, and it is the only modal in the product that blocks a download. Removing
location is one click: `fields: ['gps']` with `mode: 'strip'`.

---

## 6. Flow

```text
view
  drop 3 photos → table per file, grouped, GPS rows flagged amber
  [Copy JSON] [Download report.json] [Remove all metadata →]

clean
  choose fields / keep-list → preview shows which tags will survive (from the plan, not a guess)
  Run → new file → re-parse the OUTPUT and show "verified: 0 tags" or "verified: 3 tags"
```

The verification step is the one that makes this tool trustworthy: the result card re-parses the file it just
produced. "Metadata removed" that is not verified is a claim, not a fact.

---

## 7. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| Orientation | applied at decode and normalised on write; no danger of a double rotation |
| GPS in PNG | `eXIf` chunk parsed; stripped by re-encode |
| HEIC metadata | readable only with the decoder chunk; if absent, the view says "metadata not readable without the HEIC decoder" |
| Maker notes | shown as opaque bytes count, not parsed — vendor-specific and not worth a dependency |
| XMP in WebP | parsed for view; always stripped on clean |
| Thumbnail in EXIF | stripped with everything else; keeping it would leak the original framing of a crop |
| Colour profile | cannot be written; stripped, and the export says "colour profile removed (sRGB assumed)" |
| DPI | written only in keep-allowed JPEG/PNG mode; otherwise lost ([§5.3](#53-clean--keep-allowed-jpeg-and-png-only)) |
| Batch of 200 | one output per file, verified individually, failures isolated |
| Time zone | `OffsetTime` shown when present, guessed never |

| Limit | Value |
|---|---|
| View files | 50 |
| Clean files | 200 |
| Keep tags | 40 names, 8 supported |
| Header read | ≤ 256 KB for view |
| Output format | JPEG/PNG for keep-allowed; any for strip |

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool metadata     9 cases

view        make/model/lens/ISO/shutter/aperture/date from the EXIF fixture
gps         coordinates shown, amber flag, "location" wording present
orientation tag shown AND preview upright
dpi         reported when present, "not available" when absent
strip gps   output re-parsed: no GPS tags, camera tags gone too (fields: ['exif','gps'])
strip all   output re-parsed: 0 EXIF tags
keep        keep ['Model','DateTimeOriginal'] → exactly those survive, verified
refuse      keep ['ImageDescription'] → warning naming the unsupported tag, no silent drop
warning     exporting with GPS present shows the blocking modal
batch 5     five outputs, each verified, one corrupt file isolated
```

```text
bun run test:pixels -- --op metadata-clean   output dimensions equal input; orientation upright
bun run test:falsify --only metadata-verify
    mutation: skip the re-parse verification → the keep/strip cases must fail
```

---

## 9. Related docs

- [`08-UTILITIES.md`](08-UTILITIES.md) — the analyzer's summary of these fields
- [`01-CONVERT.md`](01-CONVERT.md) §7 — why `keepMetadata` there is mostly a warning
- [`0-SECURITY.md`](0-SECURITY.md) §10 — GPS never reaches a log
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) §5 — the default strip policy on export
