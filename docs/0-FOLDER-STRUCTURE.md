# 0 — Folder Structure

> A monorepo with one rule: the browser lane cannot import the server, and the server cannot import React.
> Last updated: 16 November 2026

---

## 1. Repository root

```text
rumindium-image/
├── apps/
│   ├── web/                     Next.js 15 — the product surface
│   └── api/                     Elysia (Bun) — lane B, presets, quota
├── workers/
│   ├── img-ai/                  onnxruntime-node segmentation / enhance
│   ├── img-heavy/               sharp — large resizes, upscales
│   └── shared/                  job claim, progress, handler contract, config
├── packages/
│   ├── contracts/               zod schemas, tool ids, error codes, worker protocol
│   ├── image-core/              pure math: geometry, resize, palette, naming, ZIP manifest
│   ├── image-browser/           canvas, workers, encoders, AI sessions (browser only)
│   ├── presets/                 social dimensions, backgrounds, quality presets
│   └── ui/                      shadcn-based primitives, tokens, icons
├── e2e/                         one Playwright/Bun suite per tool + fixtures
├── scripts/
│   ├── dev/                     fixtures, seed, local model fetch
│   ├── ci/                      parity, licenses, limits, pixels, memory, load
│   └── ops/                     sweep, preflight, smoke
├── docs/                        this set
├── models/                      git-ignored; fetched by scripts/dev/fetch-models.ts
├── package.json                 bun workspaces
├── tsconfig.base.json
└── biome.json
```

`bun` workspaces, one lockfile, no Turborepo. Five packages and two apps do not need a build graph engine; a
`bun run --filter` per script is enough and leaves one less thing to configure.

---

## 2. `apps/web`

```text
apps/web/
├── next.config.ts               COOP/COEP, headers, image config, build id
├── src/
│   ├── app/
│   │   ├── layout.tsx           shell: sidebar, theme provider, toaster
│   │   ├── page.tsx             tool index (RSC, static)
│   │   ├── (tools)/
│   │   │   ├── convert/page.tsx
│   │   │   ├── compress/page.tsx
│   │   │   ├── edit/page.tsx
│   │   │   ├── resize/page.tsx
│   │   │   ├── background/page.tsx
│   │   │   ├── enhance/page.tsx
│   │   │   ├── colors/page.tsx
│   │   │   ├── metadata/page.tsx
│   │   │   ├── social/page.tsx
│   │   │   └── batch/page.tsx
│   │   ├── settings/page.tsx
│   │   └── api/health/route.ts   only for the container health check
│   ├── features/
│   │   ├── dropzone/            drag, paste, file picker, validation messages
│   │   ├── workspace/           preview canvas, zoom/pan, compare slider
│   │   ├── controls/            schema-driven controls (select, slider, colour, tabs)
│   │   ├── queue/               batch rows, status chips, retry, cancel
│   │   ├── result/              result card, metrics, warnings, export panel
│   │   ├── crop-board/          the crop rectangle *is* the option
│   │   ├── brush/               erase/restore brush over the matte
│   │   └── palette/             swatches, copy, export
│   ├── lib/
│   │   ├── job-runner.ts        picks lane, owns the store transition
│   │   ├── local-runner.ts      worker pool + job ids + watchdog
│   │   ├── server-runner.ts     fetch/SSE client for lane B
│   │   ├── store.ts             zustand: files, jobs, options, lane
│   │   └── download.ts          thin wrapper over the exporter
│   └── styles/
│       └── globals.css          tokens, base layer, no component CSS
```

The `(tools)` route group exists so that every tool page shares one layout (banner, workspace, side panel) while
staying URL-flat. `page.tsx` files are **server components that render a client island**:

```tsx
// apps/web/src/app/(tools)/convert/page.tsx
import { ConvertTool } from '@/features/tools/convert-tool';   // 'use client'
export const metadata = { title: 'Convert images — Rumindium Image' };
export default function Page() { return <ConvertTool />; }
```

Nothing in `app/` imports `image-browser` directly; the island does, so the heavy chunk is never in the shell's
graph.

---

## 3. `apps/api`

```text
apps/api/
├── src/
│   ├── index.ts                 Bun.serve wrapper + graceful shutdown
│   ├── app.ts                   Elysia instance, plugins, route mount
│   ├── config.ts                zod env schema
│   ├── routes/
│   │   ├── health.ts
│   │   ├── files.ts
│   │   ├── jobs.ts
│   │   ├── events.ts            SSE
│   │   ├── download.ts
│   │   ├── catalog.ts           /tools, /presets, /models, /usage
│   │   └── admin.ts             mounted only when ADMIN_OPS_TOKEN is set
│   ├── domain/
│   │   ├── job-service.ts       create, transition, cancel, expire
│   │   ├── file-service.ts      validate, store, delete
│   │   ├── quota.ts             transactional counters
│   │   └── consent.ts           version check
│   ├── infra/
│   │   ├── db/                  drizzle schema + repositories
│   │   ├── queue/               BullMQ producers, SSE pub/sub
│   │   ├── storage/             temp dir, atomic write, TTL sweep
│   │   └── log.ts               structured, scrubbed
│   └── middleware/
│       ├── session.ts           cookie issue/read
│       ├── rate-limit.ts        token buckets
│       ├── errors.ts            ApiError mapping
│       └── security.ts          headers, same-origin check
└── test/                        bun test: routes, quota, sweep
```

Three rules in this app:

1. **A route file contains no business logic.** It parses (zod), calls one service function, maps the result. That
   is why `job-service.ts` can be tested without an HTTP server and why the same transition function is used by
   the SSE publisher, the cancel endpoint and the sweeper.
2. **No image decoding here.** The API sniffs headers (magic bytes, dimensions) and nothing more; decoding lives
   in `workers/*`. If the API imported `sharp`, a 30 MP decode would run in the request process and one slow
   upload would stall every other request.
3. **No `process.env` outside `config.ts`.** A stray `Bun.env.X` in a route is a config value nobody documented,
   and it will drift from [0-CONFIG](0-CONFIG.md).

---

## 4. `workers/*`

```text
workers/shared/src/
├── handler.ts                   JobHandler contract: (ctx) => Promise<JobResult>
├── runner.ts                    claim → read config → run → heartbeat → complete/fail
├── progress.ts                  throttled reporter → Redis pub/sub
├── storage.ts                   per-job paths, atomic output write
└── config.ts

workers/img-ai/src/
├── index.ts                     queue consumer for img-ai
├── handlers/
│   ├── bg-remove.ts
│   ├── enhance.ts
│   └── upscale.ts               (phase 6, behind a flag)
├── ort.ts                       session cache, device selection, warmup
└── preprocess.ts                re-export from image-core + node image I/O
```

The handler contract is intentionally tiny, mirroring the browser's `Transform`:

```ts
type JobHandler = (ctx: {
  job: JobRecord;
  options: unknown;                 // parsed by the registry schema before the handler runs
  input: (index: number) => Promise<{ path: string; width: number; height: number }>;
  output: (name: string, data: Buffer | string) => Promise<void>;
  report: (stage: string, pct: number) => void;
  signal: AbortSignal;
  log: Logger;
}) => Promise<{ metrics: Record<string, number>; warnings: string[] }>;
```

A worker never writes to the database directly except through `completeJob()`/`failJob()` in `worker/shared`,
which is where the "cancelled beats late result" rule lives for lane B.

---

## 5. `packages/*`

| Package | Runtime | May import | May **not** import |
|---|---|---|---|
| `contracts` | any | zod only | React, `image-browser`, `apps/*`, `node:fs` |
| `image-core` | any | `contracts`, pure TS | DOM, canvas, node built-ins, React |
| `image-browser` | browser | `contracts`, `image-core`, `onnxruntime-web` | React, `apps/*`, node built-ins |
| `presets` | any | `contracts` | anything else |
| `ui` | browser | `contracts`, Radix, Tailwind | `image-browser`, `image-core` |

`image-core` is where the interesting tests live because it is the only place with no environment:

```text
src/
├── geometry.ts        fit/fill/cover/contain rects, crop with rotation, aspect helpers
├── resize.ts          target dimensions, halving steps, aspect rounding
├── palette.ts         median-cut, k-means, colour distance, sorting
├── color.ts           hex/rgb/hsl, ΔE2000, contrast ratio
├── naming.ts          output names, collision suffixes, sanitising
├── zip.ts             entry manifest (names, order, dedupe) — not the zip writer
├── size-search.ts     the target-byte search loop, encoder injected
├── metadata-rules.ts  which tags are stripped/preserved
├── ai/preprocess.ts   letterbox, normalise, sigmoid, upsample plan
└── units.ts           bytes/MB formatting, safe integer parsing
```

The ZIP *writer* is not here: `fflate` in the browser and `archiver` on the server are environment-specific. The
*manifest* is here, so both produce identical entry names and order ([13](13-EXPORT-MANAGER.md) §4).

---

## 6. Import boundaries (enforced in CI)

```text
scripts/ci/check-boundaries.ts

rule 1  apps/web/** may not import workers/**            (a browser bundle importing node code)
rule 2  apps/api/** may not import packages/image-browser (DOM dependency in a request process)
rule 3  packages/image-core/** may not import 'react', 'node:*', or reference 'document'
rule 4  packages/contracts/** may not import from 'packages/*' except 'presets/types' (cycle)
rule 5  packages/ui/** may not import 'image-core' or 'image-browser'
rule 6  workers/** may not import 'apps/**'
rule 7  apps/web/**/localhost-runner may not import server-runner statically  (lane A must not pull lane B code)
```

Rule 7 is the subtle one: if `local-runner.ts` statically imported the SSE client, every user would download the
lane B code — and, worse, the privacy claim would be *architecturally* unfounded even though it was functionally
true. The server runner is a dynamic `import()` behind the consent action.

---

## 7. Naming conventions

| Kind | Convention | Example |
|---|---|---|
| React component | `PascalCase.tsx` | `ResultCard.tsx` |
| Hook | `useThing.ts` | `useDropzone.ts` |
| Pure module | `kebab-case.ts` | `size-search.ts` |
| Zod schema | `PascalCase` + `Options` | `CompressOptions` |
| Tool id | kebab-case, stable | `bg-remove` |
| Queue | `img-<pool>` | `img-ai` |
| Error code | `SCREAMING_SNAKE` | `IMAGE_TOO_LARGE` |
| Doc | `NN-NAME.md` or `0-NAME.md` | `05-BACKGROUND-REMOVER.md` |
| Test | `<unit>.test.ts` / `<tool>.e2e.ts` | `resize.test.ts`, `compress.e2e.ts` |
| Fixture | `<subject>-<variant>.<ext>` | `portrait-1024.jpg` |

Migration files are timestamped and never edited after merge. Model files are `models/<id>-<version>.<dtype>.onnx`
and are git-ignored; the manifest pins the hash.

---

## 8. Root scripts

```json
{
  "scripts": {
    "dev": "bun run --parallel dev:web dev:api",
    "dev:web": "bun run --filter @ri/web dev",
    "dev:api": "bun run --filter @ri/api dev",
    "dev:worker": "bun run --filter @ri/worker-ai dev",
    "build": "bun run --filter @ri/web build",
    "typecheck": "tsc -p tsconfig.json --pretty false",
    "lint": "biome check .",
    "test": "bun test",
    "fixtures": "bun run scripts/dev/make-fixtures.ts",
    "models:fetch": "bun run scripts/dev/fetch-models.ts",
    "boundaries": "bun run scripts/ci/check-boundaries.ts",
    "doc:parity": "bun run scripts/ci/doc-parity.ts",
    "model:licenses": "bun run scripts/ci/model-licenses.ts",
    "test:pixels": "bun run scripts/ci/pixels.ts",
    "test:memory": "bun run scripts/ci/memory.ts",
    "test:load": "bun run scripts/ci/load.ts",
    "test:browser": "playwright test",
    "e2e:tool": "bun run e2e/tool.e2e.ts",
    "db:migrate": "bun run scripts/ops/migrate.ts",
    "ops:preflight": "bun run scripts/ops/preflight.ts",
    "ops:sweep": "bun run scripts/ops/sweep.ts",
    "secrets:check": "bun run scripts/ci/secrets-check.ts"
  }
}
```

`test:pixels` and `test:memory` are separated because they answer different questions and fail for different
reasons: one is "did the image change", the other is "did we leak a bitmap".

---

## 9. What deliberately does **not** exist

| Absent | Why |
|---|---|
| `apps/desktop`, Electron | the browser is the engine; a wrapper adds nothing and removes the sandbox |
| A `lib/` directory at the root | shared code is a package, or it is not shared |
| `utils/` | anything generic enough for that name belongs in `image-core` or `ui` with a real name |
| A component library fork | `ui` wraps shadcn primitives; it does not reimplement them |
| `store/` with slices per tool | one `jobStore` plus local component state; nine stores for nine tools is nine bugs |
| A `shared/` at the app root | boundaries (§6) make "shared" meaningless across apps |
| Server-side rendering of tool pages with pixel work | RSC cannot hold an `ImageBitmap`, and a server-side preview would upload the image |
| A `workers/img-light` | nothing in lane B is light; light work runs in the tab |

---

## Related docs

- [`0-ARCHITECTURE.md`](0-ARCHITECTURE.md) — why `apps/api` is separate from Next
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) — the worker protocol `image-browser` implements
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — the split between the ZIP manifest and the ZIP writer
- [`0-TESTING.md`](0-TESTING.md) — how the scripts above are used
