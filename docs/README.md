# Rumindium Image — Documentation Set

> Browser-first image toolkit: convert, compress, edit, resize, remove and rebuild backgrounds, enhance,
> inspect metadata, extract palettes, and batch-process — with a Next.js front end and an Elysia.js tier that is
> **optional by design**.
> Product scope source of truth: `IMAGE_TOOLKIT_SPEC.md` (22 sections, supplied with the brief).
> Last updated: 16 November 2026

---

## 1. What this product is

An image toolbox whose default path never leaves the browser:

```text
DROP  →  PROCESS (in a worker, in this tab)  →  DOWNLOAD  →  RELEASE
```

No account, no upload, no retention. The tab owns the pixels; closing it destroys them. The Elysia API exists
for the cases a browser genuinely cannot carry — a device without WebGPU or enough RAM, a batch of 200 files
on a phone, or a job that must keep running after the tab closes — and every one of those paths is **opt-in per
job**, labelled in the UI, and off unless the deployment enables it (`SERVER_LANE_ENABLED`).

That distinction is the whole architecture. The sibling PDF service moves bytes between a browser and a worker
pool; Image moves **nothing** unless the user asks it to.

| Aspect | Decision |
|---|---|
| Web | Next.js 15 (App Router) + React 19 + TypeScript strict (`apps/web`) |
| API | Elysia.js on Bun (`apps/api`) — server lane, presets catalog, quota, SSE |
| Shared contracts | Zod schemas in `packages/contracts` — one schema, both runtimes |
| Pixel engine | `createImageBitmap` + `OffscreenCanvas` + Web Workers, WASM/WebGPU for AI |
| Pure math | `packages/image-core` — DOM-free, importable by the browser, the API and the tests |
| Server AI | `onnxruntime-node` in `workers/img-ai`, same model manifest as the browser |
| Queue | Redis + BullMQ-compatible workers, two pools (`img-ai`, `img-heavy`) |
| Database | PostgreSQL + Drizzle — job metadata and daily counters only, never pixels |
| Storage | Ephemeral NVMe for server-lane jobs (`${TEMP_DIR}/{jobId}/`), TTL 15 min |
| Identity | None required. No accounts in the MVP; the server lane is metered per anonymous session |
| Deployment | `bun start` (builds, then serves Next + Elysia); no container runtime required |
| License posture | MIT application code; **every AI model and library audited before adoption** ([0-AI-MODELS](0-AI-MODELS.md) §2) |

**Status of this set:** these documents specify a product that is not built yet. Unlike a status report, no
section here claims a measurement; where a number is an estimate it says so, and where a number must be
*produced* by a test it says which test produces it. [`0-IMPLEMENTATION-PHASE.md`](0-IMPLEMENTATION-PHASE.md) is
the order to build in; [`0-E2E-CHECKLIST.md`](0-E2E-CHECKLIST.md) is the pass to run before a tool is called done.

---

## 2. How to read this set

```text
START HERE
   │
   ├── README.md                        ← you are here: scope, tool matrix, canonical values
   ├── 0-ARCHITECTURE.md                ← lanes, topology, lifecycle, ADRs, what lives where
   │      ├── 0-TOOL-REGISTRY.md        ← the 20 tool ids + option schemas (canonical catalog)
   │      └── 0-API.md                  ← the HTTP contract the server lane implements
   │
   ├── BUILD                                    ├── RUN
   │   ├── 0-FOLDER-STRUCTURE.md                ├── 0-TESTING.md
   │   ├── 0-CONFIG.md                          ├── 0-OBSERVABILITY.md
   │   ├── 0-PROCESSING-PIPELINE.md             └── 0-IMPLEMENTATION-PHASE.md
   │   ├── 0-AI-MODELS.md
   │   ├── 0-BATCH-AND-QUEUE.md
   │   ├── 0-FILE-STORAGE.md
   │   ├── 0-DATABASE.md
   │   ├── 0-UI-DESIGN.md
   │   ├── 0-SECURITY.md
   │   └── 0-E2E-CHECKLIST.md           ← what "done" means, tool by tool, with the check that proves it
   │
   ├── TOOLS (one doc each)
   │   ├── 01-CONVERT.md
   │   ├── 02-COMPRESS.md
   │   ├── 03-EDIT.md
   │   ├── 04-RESIZE.md
   │   ├── 05-BACKGROUND-REMOVER.md
   │   ├── 06-BACKGROUND-EDITOR.md
   │   ├── 07-ENHANCE.md
   │   ├── 08-UTILITIES.md
   │   ├── 09-COLOR-TOOLS.md
   │   ├── 10-METADATA.md
   │   ├── 11-SOCIAL-PRESETS.md
   │   ├── 12-BATCH-PROCESSING.md
   │   └── 13-EXPORT-MANAGER.md
   │
   └── CROSS-MODULE.md                  ← how the modules share state, and the platform integration boundary
```

Reading order for a new engineer: `README` → `0-ARCHITECTURE` → `0-PROCESSING-PIPELINE` → `0-TOOL-REGISTRY`
→ `0-API` → the tool doc being implemented. Before touching AI, read `0-AI-MODELS` §2: it is a licensing
document as much as a technical one, and the default engine was chosen because of it.

---

## 3. Complete tool matrix

Twenty tool ids. A *module* in the spec may be more than one tool id (`Image Utilities` is five; `Image Editor`
is four), because a tool id is the unit the registry validates, the UI routes to, and the E2E suite names.

Lane column: `browser` = never leaves the tab; `hybrid` = browser by default, server lane when available and
consented; `server` = server lane only. Phase tags map to [`0-IMPLEMENTATION-PHASE.md`](0-IMPLEMENTATION-PHASE.md).

| # | Tool id | Title | Module doc | Lane | Batch | In → Out | Phase |
|---|---------|-------|------------|------|-------|----------|-------|
| 1 | `convert` | Convert format | [01](01-CONVERT.md) | browser | ✓ | Image[] → Image[] | P1 |
| 2 | `compress` | Compress | [02](02-COMPRESS.md) | browser | ✓ | Image[] → Image[] | P1 |
| 3 | `resize` | Resize | [04](04-RESIZE.md) | browser | ✓ | Image[] → Image[] | P1 |
| 4 | `crop` | Crop | [03](03-EDIT.md) | browser | ✗ | Image → Image | P1 |
| 5 | `rotate-flip` | Rotate / flip | [03](03-EDIT.md) | browser | ✓ | Image → Image | P1 |
| 6 | `adjust` | Brightness, contrast, color | [03](03-EDIT.md) | browser | ✓ | Image → Image | P2 |
| 7 | `filter` | Presets (mono, sepia, blur…) | [03](03-EDIT.md) | browser | ✓ | Image → Image | P2 |
| 8 | `bg-remove` | AI background removal | [05](05-BACKGROUND-REMOVER.md) | hybrid | ✓ | Image → Image (alpha) | P3 |
| 9 | `bg-replace` | Background editor | [06](06-BACKGROUND-EDITOR.md) | browser | ✓ | Image + mask → Image | P3 |
| 10 | `enhance` | Auto enhance / sharpen / denoise | [07](07-ENHANCE.md) | hybrid | ✓ | Image → Image | P4 |
| 11 | `upscale` | AI upscale | [07](07-ENHANCE.md) | server | ✗ | Image → Image | P6 |
| 12 | `base64` | Base64 / data URI | [08](08-UTILITIES.md) | browser | ✓ | Image ↔ Text | P2 |
| 13 | `analyze` | Image analyzer | [08](08-UTILITIES.md) | browser | ✓ | Image → Report | P2 |
| 14 | `metadata` | Metadata viewer | [10](10-METADATA.md) | browser | ✓ | Image → Report | P2 |
| 15 | `metadata-clean` | Metadata cleaner | [10](10-METADATA.md) | browser | ✓ | Image[] → Image[] | P2 |
| 16 | `palette` | Color extractor | [09](09-COLOR-TOOLS.md) | browser | ✓ | Image → Palette | P2 |
| 17 | `pixel-pick` | Pixel color picker | [09](09-COLOR-TOOLS.md) | browser | ✗ | Image + point → Color | P2 |
| 18 | `social-resize` | Social media presets | [11](11-SOCIAL-PRESETS.md) | browser | ✓ | Image[] → Image[] | P2 |
| 19 | `batch` | Batch orchestrator | [12](12-BATCH-PROCESSING.md) | depends | ✓ | Job[] → Job[] | P5 |
| 20 | `export` | Export manager | [13](13-EXPORT-MANAGER.md) | browser | ✓ | Results → Files / ZIP | P1 |

`batch` is not a transform: it is the queue that runs any `supportsBatch` tool over N files with one config
([12](12-BATCH-PROCESSING.md) §3). `export` is not a transform either: it is the only component allowed to
produce a `Blob` for the user ([13](13-EXPORT-MANAGER.md) §2).

**Deferred beyond the MVP** (documented, not scheduled): AI upscaling, AI face restoration, AI deblurring,
layer-based editor, custom background library sync, shareable result links, public API product, accounts and
history. See [`0-IMPLEMENTATION-PHASE.md`](0-IMPLEMENTATION-PHASE.md) §"Deliberately deferred".

---

## 4. Architecture at a glance

```text
                              INTERNET
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  Next.js 15 (apps/web)│
                     │  RSC shell + client   │
                     │  tool islands         │
                     └───────────┬───────────┘
                                 │
              ┌──────────────────┴───────────────────────┐
              │ LANE A (default)                         │ LANE B (opt-in)
              ▼                                          ▼
  ┌───────────────────────────┐              ┌────────────────────────────┐
  │ Web Worker(s)             │              │ Elysia API (apps/api)      │
  │ • decode / encode         │              │ • consent + quota check    │
  │ • OffscreenCanvas ops     │              │ • job create + SSE         │
  │ • ONNX (wasm / webgpu)    │              │ • presigned upload (≤25 MB)│
  │ • ZIP (fflate)            │              │ • download + TTL sweep     │
  └───────────┬───────────────┘              └─────────────┬──────────────┘
              │                                            │
              ▼                                            ▼
     ImageBitmap → Canvas                        ┌───────────────────────┐
              │                                  │ Redis: img-ai, heavy  │
              ▼                                  └───────────┬───────────┘
     Blob → <a download> / File System                     ▼
     Access API                                     ┌──────────────┐
                                                    │ img-ai worker│
                                                    │ onnxruntime  │
                                                    │ sharp (heavy)│
                                                    └──────┬───────┘
                                                           ▼
                                                   ${TEMP_DIR}/{jobId}
                                                   TTL 15 min → DELETE
```

Both lanes produce the same `ResultEnvelope` (`packages/contracts`), so a tool's UI, its batch row and its
export card do not know which lane ran it. That is the only reason the server lane is affordable to maintain:
one result shape, two producers.

Full topology, request lifecycles, failure domains and the ADR log: [`0-ARCHITECTURE.md`](0-ARCHITECTURE.md).

---

## 5. Data ownership

| Data | Owner | Location | Retention |
|---|---|---|---|
| Image bytes (lane A) | the user's tab | `ImageBitmap` / canvas / `Blob` | until tab close or explicit release |
| Image bytes (lane B) | Rumindium Image | `${TEMP_DIR}/{jobId}/` | ≤ `JOB_TTL_MINUTES` (default 15) |
| Job metadata (tool, status, bytes in/out, timings) | Rumindium Image | `jobs` table | 30 days |
| Daily counters (quota, abuse) | Rumindium Image | `usage_daily` | 90 days |
| Anonymous session id | the user's browser | HttpOnly cookie, no PII | 30 days |
| Model policy + preset catalog | Rumindium Image | `packages/presets`, `model_manifest` table | versioned in git |
| Product analytics | Rumindium Image | aggregate counters only | 12 months |

No table stores a pixel, a filename, an EXIF field or a palette. Job rows carry counts and durations; a
`file_name` column existed in an early draft and was removed on purpose ([0-DATABASE](0-DATABASE.md) §4).

---

## 6. The two lanes, and the promise each makes

| | Lane A — browser | Lane B — server |
|---|---|---|
| Enabled by | always | `SERVER_LANE_ENABLED=true` **and** a consent dialog per job |
| Bytes uploaded | none | the image, over TLS, to a per-job prefix |
| Latency | decode + op + encode (ms–s) | upload + queue + inference + download |
| Ceiling | device RAM, ~40 MP per image | 30 MP, 25 MB per file |
| Privacy claim | "your image never leaves this tab" | "your image is deleted within 15 minutes" |
| Used for | everything by default | no-WebGPU devices, large batches, `upscale` |
| Metered | not at all | per session, see [0-CONFIG](0-CONFIG.md) §5 |

The UI must never blur the two. A server-lane card carries the lane badge, the retention sentence and the
cancel path; a browser-lane card says "processed in this tab" and nothing else, because a privacy claim that
is merely decorative is worse than no claim ([0-UI-DESIGN](0-UI-DESIGN.md) §8).

---

## 7. Canonical values (single source of truth)

Defined once here; every other document repeats these exact values or links back. Do not invent local
variants.

| Value | Default | Defined in |
|---|---|---|
| API base path | `/api/v1` | [0-API](0-API.md) |
| Tool ids | the 20 in §3 | [0-TOOL-REGISTRY](0-TOOL-REGISTRY.md) |
| Queues | `img-ai`, `img-heavy` | [0-BATCH-AND-QUEUE](0-BATCH-AND-QUEUE.md) |
| Job statuses | `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED` | [0-API](0-API.md) §4 |
| Local job statuses | `IDLE`, `RUNNING`, `DONE`, `FAILED`, `CANCELLED` | [0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) §6 |
| Browser lane limits | 100 MB/file · 40 MP · 200 files/batch · concurrency 2 (desktop) / 1 (mobile) | [0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) §7 |
| Server lane limits | 25 MB/file · 30 MP · 50 files/job · 250 MB/job · 200 jobs/day/session | [0-CONFIG](0-CONFIG.md) §5 |
| Server temp root | `TEMP_DIR=/var/lib/rumindium-image/jobs` (prod), `/tmp/rumindium-image` (dev) | [0-FILE-STORAGE](0-FILE-STORAGE.md) |
| Job TTL | `JOB_TTL_MINUTES=15` | [0-CONFIG](0-CONFIG.md) §3 |
| Default output quality | JPEG 82 · WebP 80 · AVIF 60 (0–100, per format) | [0-CONFIG](0-CONFIG.md) §6 |
| Metadata default | stripped on every export unless "keep metadata" is checked | [10](10-METADATA.md) §5 |
| Model manifest | `packages/contracts/model-manifest.json` (pinned hashes) + `packages/image-browser/src/ai/manifest.ts` (loader) + `model_manifest` table | [0-AI-MODELS](0-AI-MODELS.md) §3 |
| Error codes | 28 codes in [0-API](0-API.md) §7 | [0-API](0-API.md) |
| Route map | `/convert`, `/compress`, `/edit`, `/resize`, `/background`, `/enhance`, `/utilities`, `/colors`, `/metadata`, `/social`, `/batch`, `/settings` | [0-UI-DESIGN](0-UI-DESIGN.md) §2 |
| Pixel tolerance | mean ΔE2000 ≤ 1.0, max ≤ 3.0; dimensions and alpha coverage exact | [0-TESTING](0-TESTING.md) §5 |
| ZIP library | `fflate` (browser) / `archiver` (server lane) | [13](13-EXPORT-MANAGER.md) §4 |

---

## 8. Traceability — spec section → doc

| Spec section | Elaborated by |
|---|---|
| §1 Overview, principles, objectives | README §1, §9; [0-ARCHITECTURE](0-ARCHITECTURE.md) §2 |
| §2 Application modules | README §3, [0-TOOL-REGISTRY](0-TOOL-REGISTRY.md) §3 |
| §3 Image Converter | [01-CONVERT](01-CONVERT.md) |
| §4 Image Compressor | [02-COMPRESS](02-COMPRESS.md) |
| §5 Image Editor (crop/rotate/flip/adjust/filters/history) | [03-EDIT](03-EDIT.md) |
| §6 Image Resizer (fit/fill/stretch/contain/cover) | [04-RESIZE](04-RESIZE.md) |
| §7 AI Background Remover | [05-BACKGROUND-REMOVER](05-BACKGROUND-REMOVER.md), [0-AI-MODELS](0-AI-MODELS.md) |
| §8 Background Editor (color/gradient/image, brush, layers) | [06-BACKGROUND-EDITOR](06-BACKGROUND-EDITOR.md) |
| §9 Image Enhancement | [07-ENHANCE](07-ENHANCE.md) |
| §10 Image Utilities (base64, analyzer, metadata, data URI, pixel picker) | [08-UTILITIES](08-UTILITIES.md), [10-METADATA](10-METADATA.md), [09-COLOR-TOOLS](09-COLOR-TOOLS.md) |
| §11 Color Extractor | [09-COLOR-TOOLS](09-COLOR-TOOLS.md) |
| §12 Social Media Presets | [11-SOCIAL-PRESETS](11-SOCIAL-PRESETS.md) |
| §13 Batch Processing | [12-BATCH-PROCESSING](12-BATCH-PROCESSING.md), [0-BATCH-AND-QUEUE](0-BATCH-AND-QUEUE.md) |
| §14 Export Manager | [13-EXPORT-MANAGER](13-EXPORT-MANAGER.md) |
| §15 UI & UX (layout, sidebar, responsive, theme) | [0-UI-DESIGN](0-UI-DESIGN.md) |
| §16 Technical architecture, processing diagram, privacy | [0-ARCHITECTURE](0-ARCHITECTURE.md), [0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) |
| §16.1 stack (Next.js, Tailwind, shadcn, browsers libs) | [0-CONFIG](0-CONFIG.md) §2, [0-FOLDER-STRUCTURE](0-FOLDER-STRUCTURE.md) §2 |
| §17 Performance & reliability | [0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) §7, [0-OBSERVABILITY](0-OBSERVABILITY.md) |
| §18 Testing (unit/integration/E2E/browsers) | [0-TESTING](0-TESTING.md), [0-E2E-CHECKLIST](0-E2E-CHECKLIST.md) |
| §19 Roadmap phases 1–6 | [0-IMPLEMENTATION-PHASE](0-IMPLEMENTATION-PHASE.md) |
| §20 MVP scope and priorities | [0-IMPLEMENTATION-PHASE](0-IMPLEMENTATION-PHASE.md) §MVP |
| §21 Definition of done | [0-E2E-CHECKLIST](0-E2E-CHECKLIST.md) §2 |
| §22 Vision | README §1, §9 |

Every module in spec §2 appears in §3 above; every tool id in §3 appears in the registry with a schema.

---

## 9. Non-negotiable engineering rules

1. Pixels stay in the tab unless the user consents to the server lane **for that job**.
2. A privacy claim is a testable statement. "Never uploaded" must be provable from the network panel.
3. Never trust a file extension; sniff the bytes, then decode.
4. Never hold more than two full-resolution RGBA buffers per image at once.
5. Every bitmap gets `close()`; every object URL gets `revokeObjectURL`.
6. Every operation has a size ceiling and a timeout, in both lanes.
7. All heavy work runs in a worker — never on the UI thread, not even a "quick" 20 MP resize.
8. One Zod schema per tool option set, imported by the UI, the API and the tests.
9. No `any` in application code; `strict` and `noUncheckedIndexedAccess` on.
10. Pure math lives in `image-core`, where it can be tested without a DOM.
11. The exporter is the only module that creates a download.
12. An AI model is adopted only after its license, size and fallback path are recorded ([0-AI-MODELS](0-AI-MODELS.md) §2).
13. No model download over `MAX_MODEL_BYTES` without an explicit click.
14. Cancelling a job frees its memory; a cancelled job must never finish later and overwrite a result.
15. Every server-lane job is metered before it starts, never after.
16. No permanent storage of user pixels, in either lane, without a product reason in writing.
17. Tailwind tokens only — no ad-hoc hex values in components.
18. Lazy-load every tool route and every model; the first paint ships the shell only.
19. Nothing is "done" until [`0-E2E-CHECKLIST.md`](0-E2E-CHECKLIST.md) has been run for it.
20. If a claim cannot be demonstrated in a test, it does not go in the docs.

---

## Related docs

- [`0-ARCHITECTURE.md`](0-ARCHITECTURE.md) — the two lanes, topology, ADRs
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) — the worker protocol that runs every browser-lane tool
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) — schemas, capability flags, routing
- [`0-E2E-CHECKLIST.md`](0-E2E-CHECKLIST.md) — the definition of done, tool by tool
