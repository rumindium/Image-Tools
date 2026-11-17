# 13 — Export Manager

> The only module allowed to hand a file to the user. One place for naming, one place for metadata policy, one place
> for the ZIP.
> Tool id: `export` · category: `system` · lane: `browser` · phase 1
> Last updated: 16 November 2026

---

## 1. Overview

Every tool produces a `ResultEnvelope`. The exporter turns that into a download — that is its entire job, and it is
centralised because the four things that go wrong at the last step all live here:

1. **The name lies about the type.** Asked for AVIF, got PNG, file named `.avif`.
2. **The name escapes the archive.** A template produces `../x.png`.
3. **Metadata leaves with the file.** The tool stripped it; a re-encode at export put it back (or never removed it).
4. **The archive eats memory.** A 1 GB ZIP built in RAM.

**Does:** single download, batch ZIP (streamed), format/quality override at export, naming modes with collision
handling, metadata policy, validation of what is about to be written, and a preview of the exact filename.

**Does not:** convert a format the encoder cannot produce, write a file larger than the browser can hold, or start a
download without a user gesture.

---

## 2. The exporter's inputs

### 2.1 `ResultEnvelope` (both lanes)

```ts
type Exportable = {
  jobId: string; toolId: ToolId; lane: 'browser' | 'server';
  outputs: Array<{
    id: string;
    name: string;                // proposed name from the tool
    blob?: Blob;                 // lane A
    url?: string;                // lane B: TTL download URL
    metrics: Metrics;
  }>;
  warnings: Warning[];
};
```

`blob` and `url` are mutually exclusive; the exporter normalises a `url` to a `Blob` through `fetch` only when a ZIP
needs it, so a single server-lane download stays a plain link (the browser's own download manager is better at large
files than a `blob:` URL).

### 2.2 `ExportOptions`

| Option | Type | Default | Notes |
|---|---|---|---|
| `format` | image format | from the result | overriding re-encodes |
| `quality` | 1–100 | from the result | |
| `naming.mode` | `keep \| suffix \| template` | `suffix` | |
| `naming.suffix` | ≤ 24 chars | `''` | |
| `naming.template` | ≤ 80 chars | — | `{name}{width}{height}{format}{index}` |
| `naming.startIndex` | ≥ 1 | 1 | |
| `stripMetadata` | boolean | `true` | |
| `container` | `files \| zip` | `zip` when > 1 output | |

---

## 3. Naming rules

```text
source name        "holiday photo.jpg"
base               "holiday photo"                  (last extension removed, sanitised)
sanitise           [\w .()-] only; collapse spaces; trim dots and spaces at the ends
suffix mode        "holiday photo-web.webp"
template mode      "{name}-{width}x{height}" → "holiday photo-1080x810.webp"
extension          from the ACTUAL blob type, not the requested one
collision          "photo.webp" → "photo (2).webp" → "photo (3).webp"
empty base         "image" (never an empty stem)
length             base truncated to 100 chars, extension kept
```

Rules with a reason:

- **The extension comes from `blob.type`.** This is the single most important line in the module. A downstream
  system that trusts the extension will mis-handle the file, and the user will blame the platform they uploaded to.
- **The sanitise character set is an allowlist.** `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, control characters and
  a leading `.` are removed, which makes zip-slip and hidden-file creation impossible by construction rather than by
  a later check.
- **Truncation is on the stem, not the whole name.** Truncating `long-name...webp` to 120 characters from the right
  drops the extension and produces a file with no type.
- **Collisions are resolved per archive, not per file.** Two files named `photo.jpg` in one batch both export; the
  second becomes `photo (2).jpg`. Overwriting silently is data loss, and refusing is a support ticket.

---

## 4. ZIP

```ts
const manifest = zipManifest(outputs, o);           // image-core: names, order, dedupe
const stream = zip(manifest, { level: 0 }, (err, chunk) => { … });   // fflate, async, store-only
```

| Decision | Why |
|---|---|
| `level: 0` (store) | the entries are JPEG/PNG/WebP — already compressed. Deflate saves ~1 % and costs 30 % CPU |
| streaming | a 1.5 GB archive must not exist in memory before it is saved |
| one flat directory | no nested paths, so no traversal and no confusing `convert/photo.webp` structure for 5 files |
| ZIP64 when needed | fflate handles > 4 GB archives; the browser's download still needs a blob or a stream |
| generation progress | a distinct phase ("Building archive 62 %") after processing, so the bar does not appear stuck |
| cancellation | building the archive can be cancelled; a partial archive is discarded |

The server lane uses `archiver` for the same manifest, streamed into the response
([0-API](0-API.md) §4.5). Two writers, one manifest: that is why the naming rules live in `image-core`.

---

## 5. Metadata policy

| Situation | Policy |
|---|---|
| default | strip (tool output is already re-encoded and tagless) |
| `stripMetadata: false` | **no-op for lane A**: the browser cannot re-inject tags, so the UI hides the toggle when it cannot be honoured |
| lane B with `keep` | the API writes the kept tags server-side (JPEG/PNG only) and the response says which |
| GPS present in a server-lane output | a warning in the result card before the download starts |
| server-supplied name | sanitised again by the exporter — the server is trusted for bytes, not for names |

The hidden toggle is a deliberate UI choice: a checkbox that does nothing is worse than no checkbox. Where metadata
preservation is genuinely possible ([10](10-METADATA.md) §5.3), it is offered in that tool, not here.

---

## 6. Downloads

```ts
// single, lane A
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), { href: url, download: name });
a.click();
setTimeout(() => URL.revokeObjectURL(url), 30_000);   // 30 s: long enough for a big file to start
```

| Concern | Behaviour |
|---|---|
| User gesture | required; the button is a click, never a timer or an auto-download |
| Large file | `blob:` download works to ~2 GB in Chromium; above that the UI suggests the server lane ZIP |
| Revocation | after 30 s, and immediately if the result is discarded |
| Filename | the `download` attribute, already sanitised |
| Open instead of save | `?disposition=inline` on the server lane; `window.open(blobUrl)` on lane A |
| Non-image artifacts | palette JSON/CSS, analysis JSON, base64 `.txt` — same naming rules, `text/json` types |
| Failure | `EXPORT_FAILED` with "the file could not be saved" and a retry; the result is kept |

---

## 7. Why lossless PNG optimisation is not offered

A tempting fourth feature: "shrink PNG losslessly". Through a canvas it is impossible — the browser re-encodes with
fixed settings and no way to request a different filter or an indexed palette. A WASM encoder (`oxipng` compiled to
WASM) could do it, at ~600 KB of bundle and seconds per megapixel, for a 10–25 % saving on some images. It is
deferred ([0-IMPLEMENTATION-PHASE](0-IMPLEMENTATION-PHASE.md) §"Deliberately deferred"), and until then the product
does not claim it.

---

## 8. Acceptance tests

```text
bun run e2e:tool -- --tool export       8 cases (§14 of 0-E2E-CHECKLIST)

single        name follows the rules; type matches the blob
zip 30        streamed, 30 decodable entries
collisions    "photo.webp", "photo (2).webp", no overwrite
traversal     template "../{name}" exports "name.webp"; the archive has no "/"
override      format/quality override re-encodes and renames consistently
metadata      default strips (re-parsed output has no EXIF)
1.2 GB batch  store-only ZIP, size warning shown before starting
failure       simulated disk/quota failure → EXPORT_FAILED, result retained
```

```text
bun run test:memory -- --op export        URL revoked after download; no blob retained after row removal
```

---

## 9. Related docs

- [`01-CONVERT.md`](01-CONVERT.md) §5 — the actual-type check this module relies on
- [`10-METADATA.md`](10-METADATA.md) §5 — where metadata preservation is possible
- [`12-BATCH-PROCESSING.md`](12-BATCH-PROCESSING.md) §7 — the manifest this module builds
- [`0-FILE-STORAGE.md`](0-FILE-STORAGE.md) §6 — the server-lane download path
