# 0 — AI Models

> Segmentation, enhancement and upscaling: what runs, where, under which license, and what happens when the
> device cannot run it.
> Last updated: 16 November 2026

---

## 1. What "AI" means in this product

Three capabilities, in order of importance:

| Capability | Tool | Where it runs | Model family |
|---|---|---|---|
| Foreground segmentation (alpha matte) | `bg-remove` | browser (WebGPU → WASM), or server lane | U²-Net / IS-Net class salient-object models |
| Parametric enhancement | `enhance` | browser (classical) + optional AI denoise | small CNN denoisers |
| Super-resolution | `upscale` | **server only** | Real-ESRGAN-class |

Everything else that a user might call "AI" — auto brightness, auto contrast, auto white balance, sharpen,
denoise — is **classical image processing** and ships in phase 1 without a model. That boundary is deliberate:
histogram-based auto-levels run in 40 ms on a 40 MP image and are explainable, while a learned enhancement model
costs 20 MB of download and produces results nobody can predict. The product calls the first group "Auto" and the
second group "AI", and never mixes the two labels in one card ([0-UI-DESIGN](0-UI-DESIGN.md) §8.3).

---

## 2. License audit — the constraint that decides the default

An image toolkit that ships a model it may not redistribute is not open source, whatever its `LICENSE` file says.
So the audit is a build gate, not a review note.

### 2.1 Libraries

| Library | License (verified) | Use | Verdict |
|---|---|---|---|
| `onnxruntime-web` | MIT | the one inference runtime for the browser | **accepted** — the substrate |
| `onnxruntime-node` | MIT | the same models on the server lane | **accepted** |
| `@huggingface/transformers` (Transformers.js v3+) | Apache-2.0 | model loading + pre/post helpers, WebGPU device selection | **accepted** |
| `@imgly/background-removal` | **AGPL-3.0** | end-to-end background removal in the browser, hosted assets | **not the default**; optional adapter only, see §2.3 |
| MediaPipe Tasks (selfie/image segmenter) | Apache-2.0 | an alternative segmenter | evaluated, not adopted (see §2.4) |

### 2.2 Weights are licensed separately from the code that loads them

This is the trap. `transformers.js` being Apache-2.0 says nothing about the model it downloads. Every entry in the
manifest therefore carries:

```ts
type ModelEntry = {
  id: string;                 // "isnet-general"
  version: string;            // "1.4.0" — ours, bumped when bytes change
  upstream: string;           // "https://github.com/xuebinqin/DIS"
  spdx: string;               // "Apache-2.0" — taken from the upstream LICENSE text, never inferred
  commercialUse: true | false | 'unknown';
  redistribution: true | false | 'unknown';
  bytes: number;
  sha256: string;
  input: [number, number];    // [1024, 1024]
  dtype: 'fp32' | 'fp16' | 'q8';
  outputs: 'alpha-matte';
  runtime: Array<'wasm' | 'webgpu' | 'node'>;
  notes?: string;
};
```

Build-time rule (`scripts/ci/model-licenses.ts`):

```text
every model in the manifest has a spdx id, an upstream URL and a commercialUse verdict
commercialUse === false  → the model may be bundled only if the build sets ALLOW_NONCOMMERCIAL_MODELS=true
                           (a self-hosted, non-commercial deployment may; the public build may not)
commercialUse === 'unknown' → build fails, always
```

The check runs in CI and again in the API at startup (`MODEL_UNLICENSED` is the runtime symptom of someone
copying a file into the image by hand). A model with an unrecorded license is the one class of bug that cannot
be fixed by a later release, because the bytes have already been distributed.

### 2.3 Why `@imgly/background-removal` is not the default

It is the best-documented option, it runs client-side, and it handles the hosted-asset problem elegantly. It is
also **AGPL-3.0**, and this product's application code is MIT. Bundling it into the web build would make the
combined work subject to AGPL — which contradicts the product's own stated license and surprises every downstream
user who forked it. Two honest options existed:

1. Switch the whole product to AGPL. Rejected: the toolkit is meant to be embeddable.
2. Keep it as an **optional, self-hosted adapter** behind a documented flag, and ship a permissive default.

Option 2 is what the manifest and registry implement:

```json
// packages/image-browser/src/ai/adapters/index.ts
"imgly": {
  "license": "AGPL-3.0",
  "requiresFlag": "ENABLE_IMGLY_ADAPTER",
  "bundled": false,          // fetched as a separate chunk only when the flag is on
  "default": false
}
```

With the flag off, the module is not in the graph at all — not tree-shaken "probably", but absent from the
bundle, asserted by a build-size test that fails if an AGPL string appears in `apps/web/.next` output. A
self-hoster who accepts AGPL can enable it and gets its hosted-asset convenience; the public build does not.

### 2.4 MediaPipe: evaluated, not adopted

`@mediapipe/tasks-vision` has an Apache-2.0 image segmenter and excellent mobile performance, but its model
output is a category mask (person / background / hair with coarse edges), not a soft alpha matte, and the
`bg-replace` feature needs a soft matte: a hard 0/1 edge produces a visible halo on every composite. It stays
documented as an alternative, with the reason it lost: **output quality for the product's flagship feature**, not
bundle size. If a future version exposes alpha, this decision is revisitable — that is what the ADR is for.

---

## 3. The default models

| Manifest id | Purpose | Input | dtype | Browser bytes | Server bytes |
|---|---|---|---|---|---|
| `isnet-general` | default salient-object segmentation | 1024² | q8 | ~45 MB | ~45 MB |
| `isnet-portrait` | people, hair detail | 1024² | q8 | ~45 MB | ~45 MB |
| `u2netp-lite` | low-RAM fallback (< 4 GB devices) | 320² | q8 | ~4.7 MB | ~4.7 MB |
| `denoise-small` | optional AI denoise in `enhance` | 256² tiles | fp16 | ~8 MB | ~8 MB |
| `realesrgan-x2` | `upscale` | 128² tiles | fp16 | not offered | ~64 MB |

Byte counts are **approximate and pinned by hash at adoption time**; the manifest is the source of truth, and
`GET /api/v1/models` reports what a deployment actually loaded. `auto` in `BgRemoveOptions.model` resolves as:

```text
face/portrait heuristic (skin-tone coverage in the central third > 6 %)  → isnet-portrait
single centred object on a plain background (edge density low, bg variance low) → isnet-general
deviceMemory < 4 or maxTexture < 4096                                    → u2netp-lite
otherwise                                                                 → isnet-general
```

The heuristic runs on a 256 px thumbnail and costs < 5 ms. It is allowed to be wrong — the user can override the
model in the card, and the override is remembered per session. A heuristic that silently produced a worse matte
with no escape hatch would be a different matter.

---

## 4. Runtime selection

```text
                    ┌── navigator.gpu && probe passes ──► webgpu (fp16 where supported)
capabilities ───────┤
                    ├── crossOriginIsolated && SAB ─────► wasm + threads (n = min(4, cores-1))
                    └── otherwise ──────────────────────► wasm single-thread
```

| Runtime | Session options that matter | Why |
|---|---|---|
| WebGPU | `executionProviders: ['webgpu']`, `freeDimensionOverrides` disabled | resizing the input graph costs a re-compile per image |
| WASM threads | `env.wasm.numThreads = min(4, cores - 1)`, `simd = true` | more threads than cores thrashes; 4 is the plateau |
| WASM single | `numThreads = 1` | works without COOP/COEP ([pipeline](0-PROCESSING-PIPELINE.md) §7.2) |

Session creation is the expensive part (200–900 ms WebGPU, 400–1 200 ms WASM), so:

1. Sessions are created **once per worker** and kept in a module-level `Map<modelId, InferenceSession>`.
2. The worker is not terminated while an AI tool page is open (the idle timeout is raised to 5 minutes for AI
   workers, versus 60 s for classical ones).
3. A warmup inference at 64×64 runs immediately after creation, because the first real inference otherwise pays
   shader compilation and reports a time that is 3× the steady state.
4. The model bytes are cached in the **Cache API** under `ri-models-v1` with an integrity check against the
   manifest hash on read. IndexedDB was considered and rejected: it stores the same bytes but requires manual
   eviction and is slower to stream from.

Model download is a **user-visible, cancellable fetch** with a progress bar, never a background surprise:

```text
"Remove background needs a 45 MB model. It is downloaded once and cached in this browser."
[ Download and continue ]  [ Use the server instead ]  [ Cancel ]
```

`MAX_MODEL_BYTES` (default 60 MB) caps a single download; a manifest entry above it requires an explicit
`ALLOW_LARGE_MODELS` deployment flag. On a metered connection, 45 MB is somebody's data plan.

---

## 5. The probe is an inference

The capability probe defined in [0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) §7.3 runs the smallest model
(`u2netp-lite`) on a synthetic 64×64 image:

| Outcome | Meaning | Action |
|---|---|---|
| completes < 2 s, matte non-empty | GPU path healthy | enable `bg-remove` locally, remember `webgpu` |
| completes > 2 s or throws `GPU_UNAVAILABLE` | adapter exists, allocation or shader fails | recreate session on WASM, re-probe once |
| WASM probe fails | not enough memory for the runtime at all | hide the local AI card, offer lane B |

A `Feature-Detect only` probe was rejected after reasoning about the failure mode: `navigator.gpu` is present on
machines where a 512 MB allocation fails, so feature detection would enable a button that reliably dies — the
worst UX shape, because the user waits 45 MB for it.

---

## 6. Inference pipeline (segmentation)

```text
original (W×H)
   │
   ├─ 1. letterbox to 1024×1024 (aspect preserved, pad with edge pixels, record scale + offset)
   ├─ 2. normalise: /255, mean [0.485,0.456,0.406], std [0.229,0.224,0.225]   (per manifest)
   ├─ 3. session.run → logits, shape [1,1,1024,1024]
   ├─ 4. sigmoid → alpha 0..1
   ├─ 5. crop the letterbox padding away
   ├─ 6. upsample to W×H (bilinear on the GPU)
   ├─ 7. refine (optional): guided filter r=8, eps=1e-4 using the original as guide
   ├─ 8. alpha denoise: 3×3 median on the matte only (never on colour)
   ├─ 9. composite: RGBA = (RGB, alpha·255)
   └─ 10. encode PNG/WebP
```

Four details that decide whether the output looks professional:

- **Edge-aware refinement is what removes halos.** Bilinear-upsampled mattes have 2–3 px of grey at every edge;
  a guided filter using the original image as guide snaps the matte to the real edge without the cost of a
  second network pass. `refine: 'quality'` runs it, `'fast'` skips it, `'none'` ships the raw matte for users who
  will mask manually.
- **Hair needs the portrait model and a soft matte.** Morphological erosion (the cheap trick) turns fine hair into
  a hard silhouette; the docs say so, and `06-BACKGROUND-EDITOR` §6 gives the restore brush as the fix.
- **Median on alpha, never on RGB.** Filtering colour alters the subject; filtering the matte does not.
- **Premultiply before compositing** onto a background, or the semi-transparent halo picks up the old background
  colour.

---

## 7. Server-lane parity

The server lane exists so that a user gets the *same* result, not a different product. Parity is enforced:

| Aspect | Mechanism |
|---|---|
| Same weights | manifest hash compared at startup; `/api/v1/models` exposes it and the web app warns on mismatch |
| Same preprocessing | `packages/image-core/src/ai/preprocess.ts` imported by both `image-browser` and `workers/img-ai` |
| Same postprocessing | same, plus `sharp` only for file I/O, never for the matte |
| Same option schema | `BgRemoveOptions` parsed in both places |
| Documented difference | runtime (`webgpu`/`wasm` vs `node`/`cuda`) and time, nothing else |

The one legitimate difference is *speed* and, on CUDA with fp16, marginal numeric variance. The tolerance in
[0-TESTING](0-TESTING.md) §5.3 (mean ΔE ≤ 1.0 between lanes) encodes exactly that expectation; a bigger gap is a
bug in one of the pipelines, not a fact of life.

---

## 8. Failure handling

| Failure | Detected | Recovery | User sees |
|---|---|---|---|
| Model download interrupted | fetch rejects / hash mismatch | resume once from the same URL, then `MODEL_LOAD_FAILED` | "The AI model could not be downloaded." + retry |
| Hash mismatch | manifest check | delete cache entry, re-download once | same, with "cached copy was corrupt" |
| WebGPU device lost | `device.lost` promise | rebuild session on WASM | nothing, unless the retry fails |
| Out of memory at allocation | `RangeError` / ORT error | `u2netp-lite` at 320², then lane B | "Not enough memory at 40 MP. Try a smaller image or the server." |
| Matte empty (all < 0.02) | postprocess check | — | `INFERENCE_FAILED`, "No subject was found. Try a different model or crop to the subject first." |
| Matte inverted (subject/background flipped) | heuristic: mean alpha of border > 0.8 | invert once, log the count | correct result, `ALPHA_INVERTED` warning |
| Session creation timeout (> 20 s) | watchdog | WASM fallback | "AI is unavailable in this browser right now." |

The inverted-matte case is worth the heuristic: some salient-object models flip on product photography with a
bright subject on a dark background. Shipping the inverted matte as "your background" is the kind of error users
report as "the AI removed my product". Inverting on a border-alpha check fixes the common case in one line, and
the warning keeps it honest.

---

## 9. `enhance` and `upscale`, honestly scoped

`enhance` (phase 4) is **classical first**:

| Operation | Method | Cost (12 MP) |
|---|---|---|
| auto brightness/contrast | histogram percentile stretch (0.5 % / 99.5 %) | ~90 ms |
| auto white balance | grey-world on the brightest 10 % | ~60 ms |
| sharpen | unsharp mask, radius 1.2, amount from strength | ~300 ms |
| denoise | 3×3 bilateral (classical) or AI tile model (optional) | 400 ms / 2.5 s |
| deblur | **not offered** locally — deconvolution needs an estimate of the PSF and produces ringing | — |

`upscale` (phase 6) is server-only because a 4× super-resolution of a 12 MP image is 192 MP, which no browser
tab should attempt: 768 MB of RGBA before the model even allocates its tensors. It is metered, capped at 12 MP
input, and documented as *enhancement, not recovery* — Real-ESRGAN hallucinates plausible detail, and the UI says
"adds detail that was not in the original" rather than "restores".

---

## 10. Adding or replacing a model

```text
[ ] upstream license text read, spdx id recorded verbatim
[ ] commercialUse / redistribution verdict recorded with a link
[ ] convert to ONNX, quantise (q8 default), verify parity against the reference output (ΔE ≤ 2)
[ ] input size, normalisation constants, output shape added to the manifest
[ ] sha256 + byte count pinned; size under MAX_MODEL_BYTES or behind a flag
[ ] browser probe run on: Chrome (Windows, macOS, Android), Safari (macOS, iOS), Firefox
[ ] server parity test: same input, both lanes, ΔE ≤ 1.0
[ ] benchmark recorded (§11) and a fallback defined for each runtime
[ ] `doc:parity` updated: 0-AI-MODELS §3 table and `GET /models` example
```

A model swap that changes output is a **minor version** of the manifest and a note in the tool doc, because users
who built a workflow around `refine: quality` deserve to know when the matte changed. It is never a silent
dependency bump.

---

## 11. What must be measured before shipping AI

Numbers below are the *harness's* responsibility, not this document's — §8 of [0-TESTING](0-TESTING.md) runs them
and `0-OBSERVABILITY` §4 stores the result. The release gate is:

| Metric | Gate |
|---|---|
| model download, 4G (12 Mbps) | p50 ≤ 35 s for 45 MB, with accurate progress |
| session creation, WebGPU | p50 ≤ 900 ms, p95 ≤ 2 000 ms |
| inference, 12 MP source, WebGPU | p50 ≤ 1.5 s |
| inference, 12 MP source, WASM 4-thread | p50 ≤ 6 s |
| peak memory, 12 MP, 1 job | ≤ 420 MB (matte + source + output) |
| edge quality | ≤ 2 % of alpha pixels in the 0.05–0.95 band on the portrait fixture set |
| server/browser parity | mean ΔE ≤ 1.0 on the same input |

"No AI in the MVP if it cannot meet these on a mid-range laptop and a 2021 phone" is the rule from spec §20, and
it is why `bg-remove` is phase 3 rather than phase 1.

---

## Related docs

- [`05-BACKGROUND-REMOVER.md`](05-BACKGROUND-REMOVER.md) — the tool that consumes this pipeline
- [`06-BACKGROUND-EDITOR.md`](06-BACKGROUND-EDITOR.md) — what happens to the matte afterwards
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) — `BgRemoveOptions`, capability flags
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §7 — probing and COOP/COEP
- [`0-SECURITY.md`](0-SECURITY.md) §9 — why the model allowlist is a security control
