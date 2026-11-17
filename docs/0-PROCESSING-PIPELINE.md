# 0 — Processing Pipeline

> The runtime every browser-lane tool plugs into: one worker protocol, six stages, one memory budget, one
> cancellation contract. A tool supplies a `transform` and nothing else.
> Last updated: 16 November 2026

---

## 1. Why a pipeline instead of 20 implementations

Twenty tools that each call `getImageData` would each get the memory ceiling wrong, each forget `bitmap.close()`
on the error path, and each encode quality differently. The pipeline exists so that the *expensive and easy to
get wrong* parts — decode, memory, cancellation, progress, encode, release — exist once, and the part that is
genuinely different per tool is a small pure-ish function.

```text
        ┌──────────────────────────────────────────────────────────────┐
        │ ToolDefinition (packages/contracts + image-browser registry) │
        │   id, optionsSchema, transform(input, opts, ctx) → output     │
        └───────────────────────────┬──────────────────────────────────┘
                                    │ registered
                                    ▼
   file ──► sniff ──► decode ──► transform ──► encode ──► measure ──► release ──► ResultEnvelope
             │         │           │             │          │           │
             │         │           │             │          │           └─ close bitmaps, revoke URLs
             │         │           │             │          └─ bytes, dims, Δ vs input, duration
             │         │           │             └─ quality, format, capability probe first
             │         │           └─ the only tool-supplied stage (may be a chain)
             │         └─ createImageBitmap with EXIF orientation applied
             └─ magic bytes + header dimensions, before any allocation
```

---

## 2. File sniffing

Extensions are a hint, never a decision (rule 3). The sniffer reads the first 4 KiB and matches magic bytes:

| Format | Signature | Dimensions read from |
|---|---|---|
| JPEG | `FF D8 FF` | SOF0–SOF15 marker scan |
| PNG | `89 50 4E 47 0D 0A 1A 0A` | IHDR (bytes 16–23) |
| GIF | `GIF87a` / `GIF89a` | logical screen descriptor |
| WebP | `RIFF....WEBP` | VP8 / VP8L / VP8X chunk header |
| AVIF / HEIC | `....ftypavif` / `ftypheic` / `ftypmif1` | `ispe` box (full box parse) |
| BMP | `BM` | BITMAPINFOHEADER |
| TIFF | `II*\0` / `MM\0*` | IFD walk, tags 256/257 |
| SVG | text scan for `<svg` in the first 1 KiB | `viewBox` / `width` / `height` |

The sniffer returns:

```ts
type Sniffed = {
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'heic' | 'bmp' | 'tiff' | 'svg' | 'unknown';
  mime: string;
  width: number | null;      // null when the header is unreadable
  height: number | null;
  animated: boolean;
  hasAlpha: 'yes' | 'no' | 'unknown';
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  bytes: number;
};
```

Two decisions live here and nowhere else:

- **Animated inputs are refused with `ANIMATED_NOT_SUPPORTED`**, not silently flattened to frame 1. An animated
  GIF converted to a still is a data-loss bug that looks like success.
- **SVG is accepted only as a rasterisation source.** It decodes through `createImageBitmap(Blob)` at a size
  derived from `viewBox` and a 2× density factor, capped by the pixel ceiling. Exporting "SVG" from a raster
  pipeline is not offered (spec §3 lists SVG output "for applicable vector operations" — there are none in the
  MVP; the registry says so out loud in [0-TOOL-REGISTRY](0-TOOL-REGISTRY.md) §4.2).

Dimensions from the header let the pipeline refuse a 12 000 × 12 000 PNG **before** allocating 576 MB for it —
that ordering is the point of the sniffer, and it is asserted by `sniff-before-decode`.

---

## 3. Decode

```ts
const bitmap = await createImageBitmap(blob, {
  imageOrientation: 'from-image',   // EXIF orientation applied here, once
  premultiplyAlpha: 'default',
  colorSpaceConversion: 'default',
});
```

- EXIF orientation is applied by the decoder so that every downstream transform sees upright pixels. Without
  this, a phone photo's crop box is rotated 90° relative to what the user dragged.
- `premultiplyAlpha: 'default'` keeps the browser's own choice: forcing `'none'` produces dark fringes on the
  first composite in Safari.
- A `createImageBitmap` rejection is `CORRUPT_IMAGE` if the header parsed, `DECODE_FAILED` if the browser simply
  does not support the codec (Safari + AVIF on old versions, Firefox + HEIC everywhere).
- HEIC/HEIF and TIFF have **no guaranteed browser decoder**. The pipeline loads a WASM decoder
  (`libheif-js` / `utif`) lazily, and the UI only offers those inputs when the decoder chunk can be fetched
  ([0-AI-MODELS](0-AI-MODELS.md) §6 has the same lazy-chunk rule for models).

---

## 4. Transform — the tool's only job

```ts
type TransformContext = {
  signal: AbortSignal;
  report: (stage: string, pct: number) => void;   // monotonic, throttled at 100 ms
  caps: Capabilities;
  raster: RasterOps;                              // drawImage, getImageData, filter, convolve, composite
};

type Transform<I = RasterImage, O = RasterImage> =
  (input: I, options: z.infer<typeof Options>, ctx: TransformContext) => Promise<O>;
```

`RasterImage` is `{ bitmap: ImageBitmap; width: number; height: number; alpha: boolean }` — not `ImageData`,
because a 40 MP `ImageData` copy is 160 MB and most tools never need a CPU copy at all.

**When CPU pixels are needed** (adjust, filter, palette, picker) the transform asks for a bounded region:

```ts
const { data } = ctx.raster.readPixels(input, { maxSide: 4096 });  // downsamples for preview math
```

A full-resolution `readPixels` is allowed only by tools whose semantics need it, and each one is listed:
`adjust`, `filter` (convolution), `metadata-clean` (never — it drops metadata at encode), `palette` (samples),
`pixel-pick` (one pixel, plus a neighbourhood). Everything else — crop, rotate, flip, resize, composite,
background replacement — is `drawImage`, which runs on the GPU and copies nothing.

### 4.1 Stage weights for progress

The reported percentage is a weighted sum so the bar moves at a believable rate rather than jumping at encode:

| Stage | Weight | Why |
|---|---|---|
| sniff | 2 % | instant, but proves the file was read |
| decode | 23 % | the first real cost, dominates small images |
| transform | 50 % | the tool's own work |
| encode | 22 % | often as expensive as transform for WebP/AVIF |
| measure + release | 3 % | cheap, but must be visible before `DONE` |

`report()` clamps to `max(previous, next)`. A transform that reports 0.9 and then finishes must not push the bar
back to 0.88 on a later stage. The E2E suite asserts monotonicity per file ([0-TESTING](0-TESTING.md) §7.2).

---

## 5. Encode matrix

One `encode(raster, format, quality)` in `image-browser`, used by every tool. Support is *probed at runtime*,
never assumed, and the result is cached for the session.

| Output | How | Guarantee | Notes |
|---|---|---|---|
| JPEG | `canvas.convertToBlob({type:'image/jpeg', quality})` | always | alpha flattened onto `background` (default `#ffffff`) |
| PNG | `convertToBlob({type:'image/png'})` | always | quality ignored; `png` has no lossy knob |
| WebP | `convertToBlob({type:'image/webp', quality})` | conditional | Safari ≥ 14 encodes; older silently returns PNG, so the result type is **checked**, not trusted |
| AVIF | `convertToBlob({type:'image/avif', quality})` | conditional | Chrome/Edge/Firefox recent; Safari encodes from 17; probe required |
| BMP | hand-written encoder | always | 32-bit BGRA, for the "no compression" use case |
| ICO | hand-written, sizes 16/32/48/256 | always | multi-size container ([08](08-UTILITIES.md) §7) |
| GIF | **not offered** | — | canvas cannot encode GIF; a static GIF is a worse PNG |
| SVG | **not offered** | — | see §2 |

The encoder returns `{ blob, format: actualType, fallback: boolean }`. `fallback: true` (asked for AVIF, got PNG)
is a **warning on the result card**, because a file named `.avif` containing PNG bytes is the single most common
way image tools lie to their users. The export step names the file from the *actual* type
([13](13-EXPORT-MANAGER.md) §3).

### 5.1 Quality defaults and the target-size search

Per-format defaults (canonical, [0-CONFIG](0-CONFIG.md) §6): JPEG 82, WebP 80, AVIF 60, PNG n/a.

`compress` with `targetBytes` runs a bounded search instead of trusting quality:

```text
lo = 1, hi = 100, best = null
for attempt in 1..6:
    q = round((lo + hi) / 2)
    blob = encode(raster, format, q)
    if blob.bytes <= target: best = { q, blob }; lo = q + 1     # try better quality
    else:                     hi = q - 1                        # need smaller
    if target * 0.95 <= blob.bytes <= target: break              # close enough, stop early
    signal.throwIfAborted()
return best ?? { q: 1, blob: encode(raster, format, 1), unreachable: true }
```

Three honest properties, all tested:

1. **Six encodes maximum**, so the cost is `6 × encode` and the progress bar can say "searching quality 62…".
2. **The search assumes quality is monotonic in bytes.** It usually is; VP8/AV1 encoders can invert locally.
   The algorithm therefore keeps the *best fitting* result rather than the last one and never overshoots the
   target by reporting a smaller quality than the one that fit.
3. **An unreachable target is reported, not faked.** `q = 1` still above the target yields
   `TARGET_SIZE_UNREACHABLE` with the smallest achievable size and the suggestion to resize
   ([02-COMPRESS](02-COMPRESS.md) §6). Resizing to hit a byte target silently changes the picture; the user
   chooses that.

---

## 6. Job model and worker protocol

### 6.1 The local job

```ts
type LocalJob = {
  id: string;                 // crypto.randomUUID()
  toolId: ToolId;
  fileId: string;
  lane: 'browser' | 'server';
  status: 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  stage: Stage;
  pct: number;                // 0..1, monotonic
  startedAt: number;
  durationMs?: number;
  input: { name: string; bytes: number; width: number; height: number };
  output?: { blob: Blob; bytes: number; width: number; height: number; format: string };
  warnings: Warning[];
  error?: { code: ErrorCode; message: string; hint?: string };
};
```

`LocalJob` is rendered by the same row component as a server job; the `lane` field is the only thing the
component is allowed to branch on.

### 6.2 Messages

All messages are typed unions in `packages/contracts/src/worker.ts`; no `postMessage(any)`.

```ts
// main → worker
type WorkerRequest =
  | { t: 'init';  caps: Capabilities }
  | { t: 'run';   jobId: string; op: OpName; file: Blob; name: string;
                  options: unknown; budgetBytes: number }       // the worker sniffs + decodes
  | { t: 'cancel'; jobId: string }
  | { t: 'probe'; probeId: string };          // capability probe, §7.1

// worker → main
type WorkerResponse =
  | { t: 'ready' }
  | { t: 'progress'; jobId: string; stage: Stage; pct: number }
  | { t: 'result';   jobId: string; blob: Blob; metrics: Metrics }
  | { t: 'error';    jobId: string; code: ErrorCode; message: string; retryable: boolean }
  | { t: 'probe';    probeId: string; caps: Capabilities }
  | { t: 'memory';   jobId: string; liveBytes: number };
```

`ImageBitmap` is **transferred**, not copied ([`transfer` list]): a 160 MB bitmap moved by structured clone
would double peak memory for no reason. The same applies to `ArrayBuffer` payloads from `readPixels`.

### 6.3 Pool

```text
navigator.hardwareConcurrency: 12   → 3 workers, 2 concurrent jobs
navigator.hardwareConcurrency: 4    → 2 workers, 1 concurrent job
mobile (pointer: coarse) or ≤ 4 GB  → 1 worker,  1 concurrent job
```

Workers are created lazily on the first Run and terminated after 60 s idle, so a landing-page visit costs
nothing. The pool is *budget aware*, not just slot aware:

```ts
const jobBytes = pixels * 4 * 2.5 + pixels;        // source RGBA + canvas copy + output + mask
admit = liveBytes + jobBytes <= maxLiveBytes;
```

`maxLiveBytes` = 512 MB with `deviceMemory ≥ 8`, 320 MB at 4–8, 192 MB below 4 and on coarse pointers. A job
that cannot be admitted waits in `IDLE` with the message "Waiting for memory — 2 of 3 running" rather than
crashing the tab. This is the mechanism behind the canonical 40 MP ceiling: 40 MP costs 400 MB + 40 MB mask,
which fits the 512 MB budget for exactly one job at a time — and the UI says so before the run, not after.

---

## 7. Capabilities and probing

### 7.1 `Capabilities`

```ts
type Capabilities = {
  worker: boolean;                  // OffscreenCanvas in a worker
  createImageBitmap: boolean;
  encode: { jpeg: boolean; png: boolean; webp: boolean; avif: boolean };
  wasmSimd: boolean;
  wasmThreads: boolean;             // requires COOP/COEP, see §7.2
  webgpu: 'yes' | 'no' | 'adapter-failed';
  maxTextureDimension2D: number;    // 4096–16384; caps a single canvas
  deviceMemoryGb: number | null;    // Chromium only
  hardwareConcurrency: number;
  codecs: { heic: boolean; tiff: boolean };  // lazy decoder availability, not built-in support
};
```

`maxTextureDimension2D` is the capability people forget: past it, `createImageBitmap` with resize options and
large canvas draws fail on some GPUs even though the *pixel* budget would allow the image. The pipeline refuses
above `min(pixelCeiling, maxTexture²)` and says which limit applied.

### 7.2 Cross-origin isolation, and what it costs

`wasmThreads` (and therefore ONNX Runtime's multi-threaded WASM path) requires `SharedArrayBuffer`, which
requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Next.js
sets both globally in `next.config.ts`.

The cost is real and is a decision, not an oversight: **no third-party embed, iframe or CDN image can load on
any page of this app** without a CORP header. The MVP has none. If one is ever needed, the options in order of
preference are `credentialless` for the embed route, then a separate origin for tool pages, then dropping
threads for WASM SIMD single-thread (roughly 2–3× slower inference, still usable).

### 7.3 The probe is a measurement

Feature detection alone lies: a device can report WebGPU and fail at the first 512 MB allocation. So the probe
runs a tiny real job once per session and caches the answer:

| Probe | Work | Pass condition |
|---|---|---|
| `webgpu` | `requestAdapter()` + a 256 MB buffer allocation + a 64×64 segmentation tile | completes < 2 s |
| `encode.avif` | `convertToBlob` on a 16×16 canvas, then check `blob.type` | `image/avif` returned |
| `wasmThreads` | `crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'` | true |
| `simd` | ORT's own `env.wasm.simd` after session creation | true |

The result is shown in Settings → Diagnostics, because "why is this slow on my machine" deserves an answer
that is not a guess.

---

## 8. Performance budget

Targets for lane A, per image, on a mid-range laptop (4-core, integrated GPU). These are **budgets to design
against**, not measurements — the harness in [0-TESTING](0-TESTING.md) §8 produces the real numbers and
`0-OBSERVABILITY` §4 stores them.

| Operation | 12 MP | 40 MP | Dominant cost |
|---|---|---|---|
| decode JPEG | ≤ 150 ms | ≤ 450 ms | codec |
| decode PNG | ≤ 400 ms | ≤ 1 400 ms | inflate |
| resize (downscale 2×, Lanczos-ish) | ≤ 120 ms | ≤ 350 ms | GPU filter |
| crop + rotate | ≤ 40 ms | ≤ 90 ms | GPU |
| adjust (LUT, full-res) | ≤ 180 ms | ≤ 600 ms | CPU pass, 4 bytes/px |
| filter (5×5 separable) | ≤ 500 ms | ≤ 1 800 ms | 2 convolutions/px |
| encode JPEG q82 | ≤ 120 ms | ≤ 400 ms | codec |
| encode WebP q80 | ≤ 250 ms | ≤ 900 ms | codec |
| encode AVIF q60 | ≤ 900 ms | ≤ 3 500 ms | codec |
| `bg-remove` (wasm, 12 MP) | ≤ 6 s | ≤ 20 s | inference at 1024² + alpha upsample |
| `bg-remove` (webgpu, 12 MP) | ≤ 1.5 s | ≤ 5 s | inference |

The 40 MP column is why the pixel ceiling is 40 and not "unlimited": encode times dominate and the tab must stay
interactive. If a target is missed by more than 2× in the harness, the tool is not shippable until either the
budget or the implementation changes — and the resolution is written down in the tool doc, not negotiated in a
review.

### 8.1 Three optimisations that are mandatory

1. **Halving downscale.** `drawImage` from 6000 px to 600 px in one step aliases badly. The pipeline halves
   while `target * 2 < current`, then does one final draw. Cost: log2(10) ≈ 4 GPU blits, still cheaper than a
   CPU area-average and visibly better.
2. **LUT for per-channel ops.** Brightness/contrast/exposure/gamma/temperature are per-channel functions; build
   a 256-entry `Uint8ClampedArray` per channel and apply in one pass. 40 MP becomes 40 M table lookups, not
   40 M multiplications.
3. **Separable convolution.** Blur/sharpen kernels are separable (5×5 → two 5-tap passes). 25 multiply-adds
   per pixel becomes 10.

---

## 9. Memory and lifetime rules

| Rule | Implementation | Test |
|---|---|---|
| One `ImageBitmap` alive per file at a time, except when the tool needs before/after | `BitmapScope` throws in dev if `open > 2` | `test:memory` |
| Output bitmaps closed after encode | encode is the last stage that touches the bitmap | `test:memory` |
| Preview uses a downscaled copy, never the full raster | `previewBitmap(≤ 2048 px)` at decode | `canvas-alloc` assertion |
| Object URLs revoked on release and on unmount | `scope.objectUrl(blob)` registers for revoke | leak check in E2E |
| `ImageData` never held across stages | read → transform → discard within the `transform` call | review + heap snapshot |
| Server lane closes nothing (no bitmaps) | n/a | — |

---

## 10. Cancellation

`AbortSignal` is checked at **stage boundaries and inside loops that can exceed 50 ms** (`readPixels` chunks,
convolution rows, target-size search attempts). The worker also receives `{t:'cancel'}`, because `abort()` on
the main side cannot interrupt a synchronous convolution.

```text
main: controller.abort()
  ├── worker receives 'cancel' → sets a flag checked per row
  ├── in-flight encode: not interruptible → result discarded on arrival
  └── job row → CANCELLED, output never written
```

A cancelled job's late result is **discarded by jobId identity**, so a cancel followed by a new run cannot
have the old bytes land in the new row. Test: `cancel-late-result` (queue an 8 s AVIF encode, cancel at 1 s,
assert no blob and no state change).

---

## 11. Metrics and envelope

Every result carries the metrics the UI and the tests need — no separate "stats" call, because a second source
of truth drifts:

```ts
type Metrics = {
  inputBytes: number;  outputBytes: number;
  inputWidth: number;  inputHeight: number;
  outputWidth: number; outputHeight: number;
  inputFormat: string; outputFormat: string;
  durationMs: number;  stages: Record<Stage, number>;
  quality: number | null;
  fallback: boolean;
  pixels: number;
};

type ResultEnvelope = {
  jobId: string; toolId: ToolId; lane: 'browser' | 'server';
  outputs: Array<{ id: string; name: string; blob?: Blob; url?: string; metrics: Metrics }>;
  warnings: Warning[];
};
```

`url` exists only for server-lane outputs (a TTL download URL); `blob` only for lane A. The exporter handles both
without branching ([13](13-EXPORT-MANAGER.md) §2.3).

---

## 12. What a new tool must implement

```text
1. schema      packages/contracts/src/tools/<id>.ts        (zod, with defaults and descriptions)
2. definition  packages/image-browser/src/ops/<id>.ts       (transform + capability requirements)
3. registry    one row in packages/contracts/src/tools/index.ts
4. route       apps/web/src/app/(tools)/<route>/page.tsx    (lazy island)
5. card        option controls bound to the schema, generated where possible
6. tests       unit (pure math) + one E2E case + one fixture
7. docs        this document set: the tool's own page + registry row
```

If step 1 cannot express an option, fix the schema — never pass an unvalidated object through
`options: unknown` and cast it in the transform. The `unknown` in `WorkerRequest.run` is parsed exactly once,
at the worker boundary, with the same schema the UI used.

---

## Related docs

- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) — schemas and capability requirements per tool
- [`0-AI-MODELS.md`](0-AI-MODELS.md) — the AI session that plugs into this pipeline as one op
- [`0-BATCH-AND-QUEUE.md`](0-BATCH-AND-QUEUE.md) — running this pipeline N times without exhausting the device
- [`0-TESTING.md`](0-TESTING.md) — pixel tolerance, harness, and the falsification suite
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — what happens to a `ResultEnvelope`
