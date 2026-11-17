# 0 — Architecture

> Two lanes, one result shape. The browser is the processing engine; the server is the fallback that has to
> earn its place in every request.
> Last updated: 16 November 2026

---

## 1. Shape of the system

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ apps/web — Next.js 15 App Router                                         │
│                                                                          │
│  RSC shell (static, no pixels)                                           │
│    ├── sidebar, tool header, docs links, theme                           │
│    └── dynamic import per tool route  ──────────────┐                    │
│                                                     ▼                    │
│  Client island (tool UI, Zustand store)                                  │
│    └── jobStore ──► Lane A: worker RPC ──► OffscreenCanvas / ONNX         │
│              └───► Lane B: fetch /api/v1/jobs ──► SSE progress           │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (only when the user opts in)
┌──────────────────────────────────────────────────────────────────────────┐
│ apps/api — Elysia on Bun                                                 │
│  routes: /health /tools /presets /files /jobs /jobs/:id/events /download │
│  concerns: consent, quota, upload slots, job rows, TTL sweep             │
└───────────────┬──────────────────────────────────┬───────────────────────┘
                │ Redis (BullMQ)                   │ PostgreSQL (Drizzle)
                ▼                                  ▼
      ┌──────────────────┐                 ┌──────────────────┐
      │ img-ai           │                 │ jobs             │
      │ onnxruntime-node │                 │ usage_daily      │
      ├──────────────────┤                 │ model_manifest   │
      │ img-heavy        │                 │ presets_version  │
      │ sharp, libvips   │                 └──────────────────┘
      └────────┬─────────┘
               ▼
     ${TEMP_DIR}/{jobId}/{input,work,output}
```

There is no third lane, no public upload bucket, and no CDN in front of user pixels. The only bytes that ever
cross the boundary are: a model file (downloaded **by** the browser, from a static host), a preset catalog
(JSON, no user data), and a server-lane image the user explicitly sent.

### 1.1 Engineering rules the architecture enforces

| Rule | Enforced by | Consequence if broken |
|---|---|---|
| Pixels stay local by default | `JobRunner` interface with two implementations; the browser one has no `fetch` in its module graph | a lint/boundary test fails ([0-FOLDER-STRUCTURE](0-FOLDER-STRUCTURE.md) §6) |
| Heavy work never on the UI thread | every op is a `WorkerRequest`; `image-core` is pure and has no `document` | a 40 MP resize freezes the tab for seconds |
| One option schema | `packages/contracts` Zod, imported by tool UI + API + tests | UI accepts an option the server rejects |
| Every bitmap released | `BitmapScope` (`using`-style dispose) around every stage | a 10-file batch exhausts GPU memory |
| Server work is opt-in | `LANE_B` feature flag + a consent object in the job payload | a privacy claim becomes false |
| No pixel in the database | `jobs` schema has no blob/BYTEA column; review rule | backup size, legal exposure, no benefit |

---

## 2. System context

| Actor / system | Interaction | Trust |
|---|---|---|
| User | drops files, sets options, downloads | untrusted input (files, options, base64 strings) |
| Browser (Chromium, Firefox, Safari) | decode, canvas, workers, GPU | the processing engine; capability varies and is probed |
| Static host / CDN | Next.js shell, JS chunks, model files | public, cacheable, no user data |
| Elysia API | server lane, presets, quota | same-origin, cookie-scoped, rate-limited |
| Redis | queue transport | internal only |
| PostgreSQL | job metadata, counters | internal only, no pixels |
| Object storage | **not used in the MVP** | deferred with share links ([0-FILE-STORAGE](0-FILE-STORAGE.md) §9) |
| Analytics | aggregate events, no image data | never receives a filename or a data URL |

The product works with the API **down**. That is a hard requirement, not a graceful-degradation nicety: the
landing page, every browser-lane tool and the exporter must function with `/api/v1` returning 503. A test
asserts it ([0-TESTING](0-TESTING.md) §7.3).

---

## 3. Topology

### 3.1 Development

```text
bun run dev
  ├── next dev            :4400   apps/web   (HMR)
  ├── elysia --watch      :4401   apps/api
  ├── worker img-ai       —       workers/img-ai (only when testing lane B)
  └── no external services: lane A is zero-config
```

`NEXT_PUBLIC_API_BASE_URL=http://localhost:4401/api/v1` and a CORS allowlist of exactly `http://localhost:4400`.
The web app never proxies through Next rewrites in development, because a proxy hides the preflight and the
cookie `SameSite` behaviour that production depends on.

### 3.2 Production — phase 1 (single host)

```text
            ┌──────────┐
  :443 ────►│  Caddy   │  TLS, security headers, body limit 26 MB
            └────┬─────┘
        ┌────────┴──────────┐
        ▼                   ▼
  next start :4400    elysia :4401
   (2 workers)         (2 workers)
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
              postgres            redis
                                    │
                            ┌───────┴────────┐
                            ▼                ▼
                     img-ai (1)        img-heavy (1)
```

Caddy routes `/api/*` to Elysia and everything else to Next, so the browser sees one origin: cookies are
first-party, SSE needs no CORS, and `isSameOrigin` checks in the API are meaningful.

### 3.3 Production — phase 2 and 3

Phase 2 splits the AI worker onto a GPU host (`IMG_AI_DEVICE=cuda`) and raises its concurrency only after a
load test ([0-OBSERVABILITY](0-OBSERVABILITY.md) §6). Phase 3 adds replicas behind Caddy — the API is
stateless, the queue is the only coordination point. Kubernetes is **not** planned: there is no scheduling
problem that two Compose files and a reverse proxy do not already solve.

---

## 4. Component responsibilities

| Component | Owns | Must not own |
|---|---|---|
| `apps/web` shell | routing, layout, theme, SEO, copy | any pixel operation |
| tool island | option state, preview canvas, lane choice | encoding policy, retries |
| `packages/image-core` | geometry, resize math, target-size search, quantisation, naming, ZIP manifest | DOM, canvas, `fetch` |
| `packages/image-browser` | decode/encode, worker pool, canvas ops, AI session, capability probe | React, routing |
| `apps/api` | consent validation, quota, upload slots, job lifecycle, SSE, TTL sweep | decoding arbitrary formats, model inference |
| `workers/img-ai` | segmentation, enhance, upscale inference | job creation, quota |
| `workers/img-heavy` | sharp-based large resizes, format conversion at scale | AI inference |
| `packages/contracts` | tool ids, option schemas, error codes, envelope types | business rules |
| `packages/presets` | social dimensions, background presets, quality presets | UI copy |
| `packages/ui` | accessible primitives on shadcn/Radix + tokens | data fetching |

`image-core` is the seam that makes the server lane cheap: it is imported unchanged by the worker, so a
resize computed on the server uses the same rounding, the same fit rules and the same file naming as the tab.

---

## 5. Lifecycles

### 5.1 Lane A — the happy path

```text
User            Tool island            Worker                 Store
 │ drop 3 files     │                    │                     │
 ├─────────────────►│ sniff + decode? no — enqueue metadata    │
 │                  ├── createImageBitmap (per file) ──────────►│ rows: PENDING
 │                  │                    │                     │
 │ set options      │                    │                     │
 ├─────────────────►│ zod parse (contracts)                    │
 │                  │                    │                     │
 │ press Run        ├── WorkerRequest{op, bitmap, opts} ───────►│ rows: RUNNING
 │                  │                    ├─ transform ─┐        │
 │                  │◄── progress 0.0→1.0─┤            │        │
 │◄─ preview ───────┤                    ├─ encode ────┘        │
 │                  │◄── ResultEnvelope ─┘                    │ rows: DONE
 │                  │  (Blob + metrics)                        │
 │ download / zip   │                    │                     │
 ├─────────────────►│ ExportManager → <a download>             │
```

Stages, in order, identical for every tool: `sniff → decode → transform → encode → measure → release`. A tool
implements `transform` only; the rest is runtime ([0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) §4).

### 5.2 Lane A — failure paths

| Failure | Where detected | What the user sees | What is released |
|---|---|---|---|
| Not an image (magic bytes) | `sniff` | "That file is not an image we can read (detected: PDF)." | nothing allocated yet |
| Decodable header, broken body | `createImageBitmap` rejects | "The file is damaged and could not be decoded." | the bitmap handle |
| Above the pixel ceiling | `sniff` (dimensions read from header) | "4000 × 3000 is above the 40 MP limit for this device." + lane B offer | nothing |
| Worker out of memory | worker `onerror` / `RangeError` | "Ran out of memory at 38 MP. Try a smaller size or the server worker." | every bitmap in scope |
| Encoder unsupported (AVIF on some Safari) | capability probe before Run | option disabled with a reason, not a failure after the fact | — |
| User cancels | `AbortSignal` | row → `CANCELLED`, no result written | bitmaps + object URLs |

The invariant: **no failure leaves a bitmap alive**, and no failure leaves the row `RUNNING`. A watchdog timer
(§9) catches the case where a worker dies without an error event.

### 5.3 Lane B — the consented path

```text
User                UI                    Elysia                Worker
 │ "Run on server"   │                       │                    │
 ├──────────────────►│ consent dialog         │                    │
 │ accept            ├── POST /files/intent ─►│ quota + slot       │
 │                   │◄─ {uploadUrl, token} ──┤                    │
 │                   ├── PUT image (≤25 MB) ─►│ validates magic    │
 │                   │◄─ {fileId, width,height, bytes}             │
 │                   ├── POST /jobs ─────────►│ row QUEUED         │
 │                   │                       ├── enqueue ────────►│
 │                   │◄─ 202 {id, eventsUrl} ─┤                    │
 │                   ├── GET /jobs/:id/events►│                    │
 │                   │◄─ SSE progress ────────┤◄─ progress ────────┤
 │                   │◄─ SSE completed ───────┤◄─ output written ──┤
 │                   ├── GET /jobs/:id/download►│ stream, then TTL  │
 │◄─ file ───────────┤                       │                    │
```

Consent is a **payload field**, not a UI-only promise: `POST /jobs` rejects `lane: "server"` without
`consent: { acceptedAt, version }`, and the API records the consent version on the job row
([0-SECURITY](0-SECURITY.md) §7). A tool cannot "quietly" escalate: the router throws
`SERVER_LANE_CONSENT_REQUIRED` instead of falling back.

---

## 6. Lane routing

```text
                     ┌──────────────────────────┐
   tool id ─────────►│ registry.execution       │
                     └────┬──────────┬──────────┘
                   browser│          │hybrid/server
                          ▼          ▼
                   ┌──────────┐  ┌───────────────────────────────┐
                   │ runLocal │  │ SERVER_LANE_ENABLED?          │
                   └──────────┘  │  no  → local, or NOT_AVAILABLE│
                                 │  yes → capabilities:          │
                                 │        webgpu? wasm simd?     │
                                 │        ram ≥ needed?          │
                                 │        user consent?          │
                                 └──────────────┬────────────────┘
                                                ▼
                                   local  |  server  |  ask the user
```

Routing rules, in priority order:

1. `server`-only tools (`upscale`) refuse locally with `SERVER_LANE_DISABLED` and a reason string — never a
   silent downgrade to a different algorithm.
2. `hybrid` tools run locally when the capability probe passes. The probe is a real 64×64 inference or resize,
   not a feature-detect alone ([0-AI-MODELS](0-AI-MODELS.md) §5).
3. A local failure that is *memory*, not *correctness*, offers the server lane with the measured pixel count.
4. Batch jobs pick one lane for the whole queue and say so in the queue header; per-file lanes make the
   progress bar and the privacy badge meaningless.
5. The server lane never becomes the default for `bg-remove`, even on a device that would benefit, because the
   product's promise is local processing and a default is a promise.

---

## 7. Failure domains and degradation

| Domain | Failure | Blast radius | Behaviour |
|---|---|---|---|
| Browser tab | OOM, GPU reset | that job | row `FAILED` with `MEMORY_LIMIT_EXCEEDED` / `GPU_UNAVAILABLE`, other rows continue |
| One worker | crash | its in-flight job | supervisor restarts; job retried once if idempotent |
| Elysia API | down | lane B only | lane A unaffected; banner "server worker unavailable", server buttons disabled |
| Redis | down | lane B submission | `503 QUEUE_UNAVAILABLE`; existing jobs still downloadable until TTL |
| PostgreSQL | down | lane B submission + quota | fail closed for lane B (503), never fail open |
| Model CDN | down | AI tools | clear error, no infinite spinner, tools that do not need AI unaffected |
| Clock skew | TTL sweep | stale files | TTL computed from DB `expires_at`, not file mtime |

Fail-closed on quota, fail-open on features. If the API cannot prove a user is under quota, it refuses the
job rather than serving it; if it cannot load the preset catalog, the web app falls back to the bundled copy
shipped at build time (`packages/presets` is a build dependency, not a runtime fetch).

---

## 8. Multi-tenancy model

There is no tenant in the MVP. What exists is a **session**:

| Concept | MVP | Why |
|---|---|---|
| Anonymous session | HttpOnly cookie `ri_sid`, 128-bit random, 30 days | per-session quota for lane B without accounts |
| Account | none | spec §1: "no mandatory account registration" |
| Team / org | none | no shared data exists to scope |
| Admin | env-gated operational endpoints only (`/api/v1/admin/ops/*`) with a bearer token | sweeping and metrics, no user data |

If accounts ever arrive, they add a `user_id` to `jobs` and `usage_daily` and nothing else — because no user
*pixel* or *artifact* is ever stored, there is no per-user content to migrate. That is the payoff of the
no-storage rule and the reason it is listed as an engineering rule rather than a preference.

---

## 9. Watchdogs and invariants

| Invariant | Mechanism | Violation surfaced as |
|---|---|---|
| A job never stays `RUNNING` | per-job watchdog: `max(30 s, 3 × estimatedSeconds)` in lane A; `JOB_TIMEOUT_SECONDS` in lane B | `FAILED` + `INTERNAL_ERROR` with `timeout: true` |
| No bitmap outlives its job | `BitmapScope` counts opens/closes; dev builds warn, CI asserts | test failure in `test:memory` |
| No object URL leaks | `URL.revokeObjectURL` in the scope's dispose | dev warning with the stack that created it |
| Progress is monotonic | runner clamps `pct = max(prev, next)` | E2E assertion on the stream |
| Cancelled stays cancelled | `AbortSignal` checked at every stage boundary; result discarded if it arrives late | test `cancel-late-result` |
| Server jobs are metered first | quota transaction before enqueue, refund on `FAILED` before start | ledger test `quota-refund` |

---

## 10. Integration boundary

Nothing in the browser lane talks to a third party. The server lane talks to Redis and PostgreSQL, and the AI
worker reads model files from local disk (baked into the image), never from a URL at request time. That means
a server-lane job has no egress dependency and cannot be slowed down by someone else's service.

The optional platform integration (auth, usage sync, audit) is described in [`CROSS-MODULE.md`](CROSS-MODULE.md)
§6 and is **not implemented**. It is documented so that the seam is chosen deliberately rather than discovered:
the seam is the session cookie, and behind it a single `resolveActor(request)` function.

---

## 11. Architecture decisions (ADR log)

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| A1 | Browser-first processing, server as opt-in | server-first (simpler code, uniform output) | spec §1 privacy-first + zero-cost scaling; a server-first design also needs upload bandwidth for 40 MP images that a tab can already handle |
| A2 | Elysia on Bun for the API | Next route handlers only | the API must outlive the web build, serve SSE and stream downloads; Elysia's Bun runtime handles all three without a second framework, and it is the same shape as the platform's other services |
| A3 | No object storage in the MVP | S3/R2 for results | no feature needs a durable artifact; adding a bucket creates the retention problem the product avoids |
| A4 | `fflate` for browser ZIP, `archiver` on the server | JSZip everywhere | `fflate` is ~8 KB gzipped and synchronous in a worker; JSZip's API is nicer but 3× the bundle for the same job. The server uses `archiver` because it streams ([13](13-EXPORT-MANAGER.md) §4) |
| A5 | One `ResultEnvelope` for both lanes | per-lane result types | the UI and batch queue must not branch on lane; a union of two envelopes leaks into 20 tools |
| A6 | `image-core` as a pure package | put math inside the web app | the API's `resize` must match the tab's to the pixel; sharing is the only way to test that once |
| A7 | ONNX Runtime Web as the AI substrate | vendor SDK per feature | one runtime, one manifest, swap the model without touching a component (spec §7 requires a modular AI interface) |
| A8 | Default removal model is permissively licensed, `@imgly/background-removal` is an optional adapter | ship `@imgly` as the default | `@imgly` is **AGPL-3.0**; making it the default silently relicenses the app ([0-AI-MODELS](0-AI-MODELS.md) §2) |
| A9 | Stripping metadata is the default on export | preserving it | most users export for the web; a GPS coordinate in a marketplace photo is a harm, a missing camera model is an inconvenience ([10](10-METADATA.md) §5) |
| A10 | Progress reported per file, not per pixel | per-pixel | 20 000 progress messages per batch would cost more than the work; stages × files is ~7 × N events |
| A11 | Web Workers over `requestIdleCallback`/`scheduler.postTask` | main-thread chunking | a 40 MP convolution cannot be chunked usefully; a worker is the only way to keep 60 fps in the UI |
| A12 | Server lane keeps a TTL on disk, no bucket, no signed URL | presigned S3 download | one host, one filesystem, one sweeper; a bucket adds credentials and a second retention policy |

---

## 12. Environments

| Env | Web | API | Workers | Redis/PG | Notes |
|---|---|---|---|---|---|
| `dev` | `next dev` :4400 | `bun --watch` :4401 | on demand | compose | models from `public/models` |
| `test` | built once per CI run | `bun test` server on :3101 | img-ai only | compose, tmpfs | fixtures generated, no network |
| `preview` | `next build && next start` | same image | 1 each | managed | `SERVER_LANE_ENABLED=true` |
| `prod` | 2 replicas | 2 replicas | 1 ai + 1 heavy, GPU later | managed | `SERVER_LANE_ENABLED` per deployment |

---

## 13. Non-goals (architectural)

- A Photoshop replacement: no layers beyond foreground/background, no vector editing, no text tooling.
- Video, animated WebP/GIF re-encoding, or audio.
- Server-side processing for tools that run in 200 ms in a tab.
- Accounts, teams, sharing, or history in the MVP.
- A public API/SDK product: the HTTP contract exists for this UI, and is versioned in case that changes.
- Native apps or an Electron wrapper: the browser *is* the engine.
- Multi-region. One region, one database, one queue.

---

## Related docs

- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) — the worker protocol, stages, memory budget
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) — execution flags that drive §6
- [`0-API.md`](0-API.md) — the contract in §5.3, in full
- [`0-AI-MODELS.md`](0-AI-MODELS.md) — model licensing and capability probing behind A7/A8
- [`0-DATABASE.md`](0-DATABASE.md) — why `jobs` holds no pixels
- [`CROSS-MODULE.md`](CROSS-MODULE.md) — shared state and the platform seam
