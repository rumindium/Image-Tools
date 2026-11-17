# CROSS-MODULE — Shared State and the Platform Boundary

> Tools in this product are not separate apps. They share one file set, one job store and one exporter — and they
> deliberately share nothing else.
> Last updated: 16 November 2026

---

## 1. The three things that are shared

```text
                 ┌──────────────────────────────────────────────┐
                 │  fileStore      files, bitmaps, previews     │
                 │  jobStore       jobs, status, results        │
                 │  optionStore    per-tool options, last used  │
                 └───────────────┬──────────────────────────────┘
                                 │
        ┌────────────┬───────────┼────────────┬────────────┐
        ▼            ▼           ▼            ▼            ▼
     Convert     Compress     Resize       Background    Batch
        │            │           │            │            │
        └────────────┴─────┬─────┴────────────┴────────────┘
                           ▼
                    ExportManager  (the only writer of a download)
```

Each tool reads `fileStore` for its input and writes a `ResultEnvelope` back into `jobStore`. A tool never keeps a
bitmap of its own beyond the render, and never caches a result privately.

### 1.1 Store shape (Zustand, one store, three slices)

```ts
type Store = {
  files: Map<string, FileEntry>;       // id → { blob, name, bytes, sniffed, preview?, bitmap? }
  jobs: Map<string, LocalJob | ServerJob>;
  order: string[];                     // display order = export order
  options: Partial<Record<ToolId, unknown>>;
  lane: 'browser' | 'server';
  consent: Record<string, { acceptedAt: string; version: string }>;  // per file id
};
```

Why one store rather than a store per tool: the *content* is shared. A result from `compress` is an input to
`palette`; a cropped image goes to `bg-remove`; the batch queue is a list of the same jobs the single tools
create. Nine stores would mean nine ways to hold the same bitmap alive.

Actions are explicit and few:

| Action | Effect |
|---|---|
| `addFiles(files)` | sniff, create previews, row `PENDING` |
| `runJob(toolId, fileIds, options)` | validate, pick lane, create rows, drive the runner |
| `resolveJob(id, envelope)` | store the result, offer export |
| `failJob(id, error)` | store the code and the sentence |
| `cancelJob(id)` / `cancelAll()` | abort + release |
| `releaseFile(id)` | close bitmaps, revoke URLs, drop the entry |
| `adoptResult(jobId, asFile)` | make a result the input of the next tool |

`adoptResult` is the cross-tool flow: it clones the blob into a new `FileEntry` (with a name like
`photo-removed.png`) so the original is still available for comparison. No tool mutates another tool's input.

---

## 2. Rules between modules

| Rule | Why |
|---|---|
| A tool never reads another tool's result directly | it reads `files`, which is the canonical input list |
| A result is immutable once created | comparison, undo and "run again with different options" all depend on it |
| Only the exporter creates downloads | one place for naming, ZIP, metadata policy |
| Options are per tool and persisted in memory only | a page reload loses them; the docs say so rather than surprising the user |
| An option that changes the *input* (crop) produces a new file on "Apply", not on every drag | live preview of a crop box, edited file only on intent |
| Every result records its lane | the badge must be derivable from the artifact, not from the current setting |

The last rule is subtle and was a bug in an early sketch: if the badge read `store.lane`, a user who switched to
lane B after a lane A job would see a result labelled "Server" that was in fact processed locally. The lane is
copied onto the `ResultEnvelope` at creation and never re-read from settings.

---

## 3. Cross-tool flows that must work

```text
photo.jpg ──bg-remove──► photo-removed.png ──bg-replace──► photo-newbg.png ──export──► ZIP
    │                          │
    │                          └──edit(crop)──► cropped.png
    └──compress──► photo-small.webp ──palette──► palette.json
```

Five of these are E2E cases ([0-E2E-CHECKLIST](0-E2E-CHECKLIST.md) §15). They are the flows users invent without
being told, and they break first when the store's ownership rules are violated.

---

## 4. Event bus (in-tab)

The runners publish to a tiny typed emitter rather than to React state directly, because progress arrives at
100 ms intervals and a store write per event would re-render the tree:

```ts
type JobEvent =
  | { t: 'job:progress'; id: string; stage: Stage; pct: number }
  | { t: 'job:done';     id: string; envelope: ResultEnvelope }
  | { t: 'job:failed';   id: string; error: AppError }
  | { t: 'pool:memory';  liveBytes: number };

bus.on('job:progress', throttle100ms(updateRow));
```

React components subscribe per row (`useJob(id)`), so a batch of 200 rows re-renders one row per event, not two
hundred. This is the only reason a 200-row queue stays at 60 fps.

---

## 5. Shared UI contracts

| Component | Contract | Used by |
|---|---|---|
| `Dropzone` | `onFiles(File[])`, validation messages | index, every tool |
| `FileRow` | `FileEntry` + optional actions | tool pages, batch |
| `WorkspaceCanvas` | bitmap, view transform, overlay renderer | convert, compress, resize, edit, background |
| `CompareHandle` | original + result bitmaps, split position | compress, enhance, edit |
| `OptionCard` | generated from a schema | all tools |
| `ResultCard` | `ResultEnvelope` + export panel | all tools |
| `LaneBadge` | `lane` from the envelope | all jobs |

A tool that needs a different layout composes these; it does not clone them. The crop board and the brush are the
two custom surfaces, and both write into the shared schema instead of holding state.

---

## 6. Platform integration boundary

The ecosystem this product belongs to has an Auth Platform (identity, apps, roles, entitlements). **Rumindium
Image does not integrate with it in the MVP**, because the product requires no account. This section records the
seam so that a future integration is a change in one file rather than a redesign.

### 6.1 The seam

```ts
// apps/api/src/middleware/session.ts
export type Actor =
  | { kind: 'anonymous'; sessionHash: Buffer }
  | { kind: 'user'; userId: string; sessionHash: Buffer; entitlements: Entitlement[] };

export async function resolveActor(req: Request): Promise<Actor> { … }
```

Everything downstream — quota, job ownership, usage — takes an `Actor`. Today only the anonymous branch is
implemented; the type exists so that adding `user` is not a refactor of every route.

### 6.2 What an integration would add

| Concern | Change |
|---|---|
| Identity | `resolveActor` reads the platform session/SSO handoff instead of minting `ri_sid` |
| Quota | `Entitlement` from the platform subscription replaces the fixed daily numbers |
| History | a `user_id` on `jobs`, and a history page that lists counts (there are still no stored artifacts) |
| Audit | job lifecycle events posted to the platform audit trail (tool, status, bytes — never content) |
| Admin | the `image.admin.read` / `image.admin.operate` permission codes gate `/admin/ops/*` instead of a bearer token |
| Sign-out | the session cookie is cleared when the platform session ends |

### 6.3 What an integration must not change

- **No artifact storage on the platform.** A shared history that kept the outputs would contradict the retention
  promise the consent dialog makes; a history of *jobs* is compatible, a library of *images* is not.
- **No mandatory login.** The platform's anonymous switch, not this app's default, would decide whether an
  anonymous session is allowed — but lane A must remain usable signed-out forever, because it needs no server.
- **No new outbound host from the browser.** CSP `connect-src 'self'` stays; SSO is a redirect, not a fetch.

### 6.4 Why this is documented but not built

An integration that nobody asked for would add a cookie domain, a CORS origin, a redirect URI and a failure mode
(identity provider down ⇒ quota unknowable ⇒ lane B down) to a product whose entire value is that it works
without any of that. The docs say where it goes so the decision stays deliberate, and the code keeps the seam so
it stays cheap.

---

## 7. Versioning across modules

| Shared thing | Versioned by | A change requires |
|---|---|---|
| `ResultEnvelope` | `packages/contracts` version | all consumers are in-repo; a breaking change is one PR |
| Tool ids | never renamed | an alias for the old route + a redirect |
| Presets | `PRESETS_VERSION` | a changelog entry and a doc update |
| Model manifest | `modelId@version` | a new entry, a parity test, a doc line |
| `LocalJob`/server job | internal only | no external consumer, no version |

---

## Related docs

- [`0-ARCHITECTURE.md`](0-ARCHITECTURE.md) §10 — the boundary in context
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) §6 — what a tool page reads from the registry
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — the one writer of downloads
- [`12-BATCH-PROCESSING.md`](12-BATCH-PROCESSING.md) — the queue over the same store
