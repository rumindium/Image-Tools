# Rumindium Image

Browser-first image toolkit: convert, compress, resize, edit, enhance, extract palettes, inspect metadata and
remove backgrounds — with a Next.js front end and an Elysia.js tier that is optional by design.

**Status: phase 1 plus Base64, Analyze and the Metadata viewer (phase-2 utilities).** These tools run end to end in a Web Worker —
decode, transform, encode, measure, download, ZIP — with the file never leaving the tab. Edit ships crop, rotate/flip,
the nine LUT adjustments, ten filters and a 50-step undo/redo history (`Ctrl/⌘ Z`, `Shift + Ctrl/⌘ Z`). All four
image tools share one export panel: format/quality override (re-encoded in the worker), keep/suffix/template naming
with a live filename preview, and separate files or a store-only ZIP. `/utilities` encodes through that same worker,
decodes validation-first, and analyzes up to 50 images: decoded dimensions, a 512 px colour/alpha sample, EXIF
orientation and DPI, ICC presence and bit depth, copyable as JSON. Its Data URI tab forces the `data:` prefix,
previews the exact URI, shows its encoded size and dimensions, and copies a ready `background-image` rule. `/metadata` reads EXIF, GPS, XMP/IPTC, ICC,
DPI and orientation from a 256 KB header, flags location data, and exports the grouped report as JSON; the
cleaner remains its own phase-2 tool. The remaining tool ids follow in phases 2–6;
each page reports its own phase from the registry.

The full design lives in [`docs/`](docs/README.md). Start with [`docs/README.md`](docs/README.md) (tool matrix,
canonical values) and [`docs/0-ARCHITECTURE.md`](docs/0-ARCHITECTURE.md).

---

## Layout

```text
apps/web          Next.js 15 App Router — sidebar shell, index, one page per tool route
apps/api          Elysia on Bun — health, tool/preset/model catalogs (lane B arrives in phase 3)
workers/          img-ai + img-heavy pool stubs sharing one handler contract
packages/
  contracts       zod option schemas, the 20 tool ids, 28 error codes, worker protocol
  image-core      pure math: geometry, resize plans, naming, colour, size search, ZIP manifest
  image-browser   magic-byte sniffer, capability probe, browser limits
  presets         social dimensions, background and quality presets
  ui              design tokens + Button/Card
scripts/          ci (boundaries, doc parity, licenses, secrets), dev (fixtures), ops (preflight, sweep)
docs/             the documentation set (31 documents)
```

## Quickstart

```bash
bun install
bun run dev          # web :4400, api :4401
```

No Docker, PostgreSQL, Redis, or other external service is needed. `bun run dev` starts the Next.js web app
and the Bun/Elysia API; the browser tools do not call the API.

For a production-style run, one command builds and starts both:

```bash
bun start
```

Open http://localhost:4400 and drop an image: the header is read locally and reported (format, dimensions,
size), and a non-image is refused by name. That is the phase 0 exit criterion.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | web + API in parallel |
| `bun run build` | production build of the web app |
| `bun start` | build, then start web + API for a production-style run |
| `bun run typecheck` | root project (packages, API, workers, scripts) + the web app |
| `bun run test` | `bun test` — image-core, contracts, image-browser, API |
| `bun run lint` / `format` | Biome |
| `bun run fixtures` | deterministic PNG/JPEG fixtures, plus the 50-file Analyze batch, into `e2e/fixtures/generated` |
| `bun run fixtures:check` | validates EXIF orientation/DPI/ICC, camera/GPS/XMP metadata and all 50 Analyze fixtures |
| `bun run boundaries` | import rules from `docs/0-FOLDER-STRUCTURE.md` §6 |
| `bun run doc:parity` | registry ↔ README ↔ tool docs ↔ error codes |
| `bun run model:licenses` | the model license gate (empty manifest passes) |
| `bun run secrets:check` | no secret literals in source or build output |
| `bun run ops:preflight` | environment check before starting a deployment |
| `bun run ops:sweep` | TTL sweeper (dry run; `--apply` to delete) |

## What is deliberately not here yet

Lane B (job creation, uploads, SSE, TTL sweep against PostgreSQL), the worker consumer, the canvas pipeline, the
AI models and the E2E suites. These are future server-lane pieces, not services started by `bun run dev` or
`bun start`; the current app runs entirely on Bun. Each has a document and a phase; none has a placeholder that
pretends to work.
See `docs/0-IMPLEMENTATION-PHASE.md`.
