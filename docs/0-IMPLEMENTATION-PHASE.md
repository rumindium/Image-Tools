# 0 — Implementation Phases

> The order to build in, with an exit criterion per phase. Each phase ends with something a person can use, not
> with a layer that is "ready for integration".
> Last updated: 16 November 2026

---

## 0. How to use this document

- A phase is done when its **exit criterion** is demonstrated, not when its checkboxes are ticked.
- Phases 1–3 are the MVP (spec §20). Phase 4 onwards ships only if §20's quality gates hold.
- Anything not listed here is not planned; the deferred list at the end says where it went.
- Estimates are engineering days for one developer who knows the stack, and include tests and docs. They are
  planning inputs, not commitments.

---

## Phase 0 — Foundation (3–4 days)

```text
[ ] monorepo: bun workspaces, biome, tsconfig strict + noUncheckedIndexedAccess
[ ] packages/contracts: ToolId union, error codes, worker protocol types, empty registry
[ ] packages/image-core: geometry + units + naming, with unit tests
[ ] apps/web: Next 15 shell, tokens, theme, sidebar from registry, index page
[ ] apps/api: Elysia boot, /health, /health/ready, config schema, error middleware
[ ] boundaries + doc:parity scripts wired into CI (they run on an empty registry)
[ ] dropzone component with magic-byte sniffing (no decode yet)
[ ] CI: typecheck, lint, unit, boundaries, doc:parity, build
```

**Exit:** the index page accepts a file, prints its real format and dimensions, and refuses a PDF with a correct
message. `bun run test` and `bun run boundaries` are green.

The foundation is a real slice through every layer on purpose: a shell with no file handling teaches nothing about
whether the architecture holds.

---

## Phase 1 — Pipeline and the four core tools (7–9 days)

```text
[ ] worker pool + protocol (§6 of 0-PROCESSING-PIPELINE) + watchdog + cancellation
[ ] decode with EXIF orientation; encode matrix with runtime probe; ResultEnvelope
[ ] workspace canvas: zoom, pan, compare-hold, DPR-correct
[ ] 01 convert        (format, quality, background, naming)
[ ] 02 compress       (quality mode + target-size search + before/after)
[ ] 04 resize         (dimensions/percentage/maxEdge, fit modes, halving downscale)
[ ] 03 edit           (crop board, rotate/flip, adjust LUT, filters)
[ ] 13 export         (individual, ZIP, naming, strip metadata)
[ ] fixtures: grid, marker, alpha, exif-rotated, corrupt, huge-header
[ ] e2e per tool + falsification entries for crop-exact, exif, encode-fallback
```

**Exit:** a 12 MP photo can be cropped, resized to 1080 px, converted to WebP at q80 and downloaded as a ZIP, all
in one tab, with the network panel showing no image upload. The perf harness has produced its first table.

This is the phase where the product becomes useful. It is also the longest, because every later tool reuses these
primitives — a bug in `resize` is a bug in `social-resize`, `compress` with `maxWidth`, and the background
editor's export.

---

## Phase 2 — Inspect and utilities (5–6 days)

```text
[ ] 08 base64   (encode/decode, data URI, validation, copy, download)
[ ] 08 analyze  (dimensions, aspect, alpha sampled, MIME, orientation, DPI where present)
[ ] 10 metadata (exifr view: camera, lens, date, GPS, DPI, ICC presence)
[ ] 10 metadata-clean (strip / keep-allowed, batch)
[ ] 09 palette  (median-cut + k-means, 3/5/8/10, sort, copy, JSON/CSS export)
[ ] 09 pixel-pick (loupe, HEX/RGB/HSL, coordinates, copy history)
[ ] 11 social-resize (Instagram/Facebook/YouTube/TikTok/LinkedIn/X/WhatsApp + custom presets)
[ ] GPS warning before exporting an image that still carries location
```

**Exit:** every "read a picture" job works, and the metadata cleaner demonstrably removes GPS from a fixture
(asserted by re-parsing the output, not by trusting the writer).

The GPS warning is not a nicety: it is the one place the product can prevent a real harm with one sentence.

---

## Phase 3 — Background removal (6–9 days)

```text
[ ] manifest + license gate + model cache + download UX
[ ] adapter interface; default ONNX session (WebGPU → WASM threads → WASM)
[ ] capability probe based on a real 64×64 inference
[ ] letterbox preprocess, sigmoid, upsample, guided-filter refine, alpha median
[ ] 05 bg-remove (model auto/portrait/product/general, refine levels, PNG/WebP out)
[ ] 06 bg-replace (transparent / colour / gradient / image; shadow; outline)
[ ] brush: erase/restore with hardness/opacity, stroke replay, undo
[ ] lane B: POST /files, /jobs, SSE, download, TTL sweep, quota
[ ] parity test browser vs server (ΔE ≤ 1.0, IoU ≥ 0.97)
[ ] inverted-matte heuristic + ALPHA_INVERTED warning
```

**Exit:** a portrait on a busy background is removed with a clean edge, composited onto a gradient, exported as
PNG, and the same input on the server lane produces a matte within tolerance. The model download shows real
progress and survives a reload from cache.

Phase 3 is the first phase that can fail for reasons outside the code (a model's license, a device's GPU). The
gates in [0-AI-MODELS](0-AI-MODELS.md) §11 are the exit criterion for that reason.

---

## Phase 4 — Enhancement (4–5 days)

```text
[ ] 07 enhance: auto levels, auto WB, unsharp mask, classical denoise, strength control
[ ] before/after compare with a difference view ("show changes")
[ ] optional AI denoise (small tiled model), clearly labelled, opt-in per file
[ ] batch support for the classical path
```

**Exit:** an underexposed photo is improved with one click, the change is visible in the compare view, and the
classical path never touches a model.

---

## Phase 5 — Batch (4–5 days)

```text
[ ] 12 batch: multi-file queue, shared config, per-row status/progress/retry/cancel
[ ] budget-aware scheduler, `stopOnError`, cancel-all, partial results
[ ] ZIP manifest + download; per-row download
[ ] server-lane batch (N jobs), depth feedback, lane badge per row
[ ] 200-file run without a memory leak (asserted)
```

**Exit:** 100 mixed files convert in one pass on a laptop with the tab responsive throughout, a partial ZIP
downloads after 3 failures, and cancelling at row 40 frees memory immediately.

---

## Phase 6 — Quality, AI upscale, release (5–7 days)

```text
[ ] upscale (server, flagged): Real-ESRGAN 2×/4×, 12 MP cap, metered
[ ] accessibility pass on the pointer tools (crop board keyboard, brush size keys)
[ ] full browser matrix run; `@known` list reconciled with the docs
[ ] perf baseline stored; load test for lane B
[ ] README, screenshots, self-host guide, `bun start` one-command start
[ ] content: tool pages' SEO copy from the registry, JSON-LD, sitemap, robots
[ ] docs: this set brought in line with what was actually built
```

**Exit:** a stranger can clone the repo, run `bun run dev`, and use every MVP tool; and a reader of the docs cannot
find a claim the code does not support.

---

## First ten working days (suggested)

| Day | Work |
|---|---|
| 1 | workspaces, config, contracts skeleton, CI |
| 2 | image-core geometry/naming + tests; sniffing in the dropzone |
| 3 | worker protocol, decode/encode, probe |
| 4 | workspace canvas (zoom/pan/DPR), preview sizing |
| 5 | `resize` end to end + e2e |
| 6 | `convert` end to end + naming |
| 7 | `compress` + target search + comparison UI |
| 8 | `crop` board + rotate/flip |
| 9 | `adjust` LUT + filters; **export** panel + ZIP |
| 10 | falsification entries, perf run, phase 1 review |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Browser encode times make `compress` feel slow on 40 MP | medium | medium | cap the pixel ceiling per device; show the estimate; offer the server lane |
| A chosen model's license blocks a public release | **high** | high | license gate in CI; permissive default; optional adapter (§2.3 of 0-AI-MODELS) |
| AVIF encode quality varies wildly across browsers | high | low | label the encoder in the result, keep PNG/WebP as first-class |
| Safari memory ceiling at 40 MP crashes the tab | medium | high | 16 MP cap on coarse pointers and ≤ 4 GB; refuse before decode |
| COOP/COEP breaks an embed someone adds later | low | medium | documented cost, `credentialless` escape hatch |
| `drawImage` rounding differs by a pixel across browsers | medium | low | exact-copy paths disable smoothing; tolerance tests on resamples |
| Scope creep into a full editor | medium | high | the non-goals list in 0-ARCHITECTURE §13, enforced in review |
| Batch of 200 × 40 MP on a phone | medium | medium | budget admission + refusal with a reason, per-row wait state |

---

## Deliberately deferred

| Item | Why | Revisit when |
|---|---|---|
| AI face restoration / deblur | consumes a large model, produces uncanny results, no honest claim to make | a model with a credible benchmark and a permissive license appears |
| Layer-based editor | the product is a toolkit, not an editor; a layer stack changes the entire data model | never, unless the product changes shape |
| Accounts, history, saved presets | no account in the MVP; syncing a preset is not worth an identity | users ask for cross-device presets |
| Shareable result links | needs durable storage, which contradicts the retention model | a user-research round asks for it |
| Public API / SDK | one consumer (this UI); an API product needs docs, keys, SLAs | someone asks to integrate |
| Animated GIF/WebP re-encoding | needs a frame-by-frame pipeline and an encoder the canvas does not have | an animated toolkit is a different product |
| Colour-managed export (ICC) | browsers cannot write an ICC profile through canvas | the File System Access / WebCodecs path matures |
| PNG palette reduction | "compress PNG" via quantisation is a different quality story; would need its own preview | phase 6 users report PNG size pain |
| Native mobile app | the browser is the engine and the phone browser is good | a real capability gap appears (e.g. background processing) |

---

## Definition of done — MVP

Borrowed verbatim from spec §21, made testable:

```text
[ ] the feature works as intended                     → its E2E suite passes on 3 browsers
[ ] input validation is implemented                   → schema + sniffing tests
[ ] error handling is implemented                     → every error path has a code and a sentence
[ ] loading and processing states are implemented     → progress monotonic, no indefinite spinner
[ ] responsive UI is implemented                      → tested at 390 / 768 / 1440 px
[ ] original files are not modified                   → input blob untouched, asserted
[ ] output files can be downloaded                    → download + ZIP tests
[ ] relevant automated tests pass                     → unit + e2e + falsification
[ ] no unnecessary server upload occurs               → privacy test: zero image requests
[ ] documentation is available                        → tool doc + registry row + checklist entry
```

The tenth line is the one that distinguishes this product from its competitors, and it is the one that is easiest
to break accidentally. That is why it is a test and not a policy.

---

## Related docs

- [`0-E2E-CHECKLIST.md`](0-E2E-CHECKLIST.md) — the per-tool pass each phase must satisfy
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) — the phases in each tool's registry row
- [`0-AI-MODELS.md`](0-AI-MODELS.md) §11 — the gates phase 3 depends on
- [`0-TESTING.md`](0-TESTING.md) — how each exit criterion is demonstrated
