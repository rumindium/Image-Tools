# 12 — Batch Processing

> One configuration, many files, a queue that survives a failure without losing the good results.
> Tool id: `batch` · category: `system` · lane: depends on the tool · batch ✓ (it is the batch) · phase 5
> Last updated: 16 November 2026

---

## 1. Overview

**Does:** apply any batchable tool to 1–200 files with one config, show per-file progress, isolate failures, allow
cancel-all, download individually or as a ZIP, and continue while the tab stays responsive.

**Does not:** mix tools in one queue (a "convert then compress each file" pipeline is a future feature, and doing it
badly would hide which step failed), keep per-file settings for more than two tools ([04](04-RESIZE.md),
[05](05-BACKGROUND-REMOVER.md)), or run partly on the server and partly locally.

The queue is the feature that turns a toolkit into a workflow. It is also where memory discipline either holds or
collapses: 200 × 12 MP at concurrency 2 is 200 sequential admissions with a budget check on each, and one leaked
bitmap turns the tab into a swap file.

---

## 2. Inputs

| Property | Value |
|---|---|
| Files | 1–200 |
| Total size | ≤ 1.5 GB |
| Per file | the selected tool's limits (pixels, bytes) |
| Mixed formats | allowed; each row uses the tool's normalisation (e.g. `convert` to one output format) |
| Mixed dimensions | allowed; `fit` produces different output sizes, `fill`/`cover` produce one |

Validation happens per file, on drop, before the queue starts. A 300-file drop is refused at the input with
`FILE_LIMIT_EXCEEDED` naming 200, rather than accepting and silently dropping the last 100.

---

## 3. Options

```ts
type BatchOptions = {
  toolId: 'convert' | 'compress' | 'resize' | 'rotate-flip' | 'adjust' | 'filter' |
          'bg-remove' | 'bg-replace' | 'enhance' | 'metadata-clean' | 'social-resize' | 'palette';
  toolOptions: unknown;                 // resolved + parsed by the tool's schema
  overrides?: Record<string, unknown>;  // only resize (preset) and bg-remove (model)
  concurrency?: 1 | 2 | 3;
  lane: 'browser' | 'server';
  stopOnError: boolean;                 // default false
  zip: boolean;                         // default true
  zipName: string;                      // default "rumindium-images.zip"
};
```

`toolId` is a **subset** of the registry: `crop`, `pixel-pick`, `analyze`, `metadata`, `base64`, `batch`, `export`
and `upscale` are excluded. Crop and pick are per-image by nature; analyze/metadata/base64 produce text per file and
a ZIP of reports is not what "batch" means; upscale is one metered server job per file and a 50-file upscale is a
billing incident.

---

## 4. API

```ts
{ t: 'run', jobId, op: 'batch', bitmaps: ImageBitmap[],
  options: { toolId: 'compress', toolOptions: { mode: 'quality', quality: 78, format: 'webp' },
             concurrency: 2, lane: 'browser', stopOnError: false, zip: true } }
```

```ts
{ t: 'progress', jobId, stage: 'transform', pct: 0.42, fileIndex: 84, files: 200 }
{ t: 'result', jobId, outputs: [{ id, name, blob, metrics }], warnings: ['3 failed: 2 corrupt, 1 too large'] }
```

Server lane: N jobs (`POST /jobs` per file) rather than one job with N inputs, so a failure is isolated at the queue
level and BullMQ's retry semantics apply per file. The UI groups them under one batch id (`batchId` = a client-side
uuid, sent as `X-Batch-Id` for correlation and never used for authorisation).

---

## 5. Scheduler

```text
for each row:  PENDING → admit() → RUNNING → DONE | FAILED | CANCELLED
admit():       §2.1 of 0-BATCH-AND-QUEUE — memory budget, then slots
```

| Observation | Behaviour |
|---|---|
| Memory pressure | rows wait with "Waiting for memory (2 of 3 running)", the queue does not fail |
| One huge file | admitted last, alone: the scheduler prefers smaller files first so the visible progress is not stuck on row 1 of 200 |
| One slow file | the ETA uses completed rows' mean, not the estimate, so a single 40 MP AVIF does not stall the header |
| Cancel-all | running rows abort, pending rows drop, done rows keep results |
| Tab backgrounded | workers continue (they are workers, not `requestAnimationFrame`); on return the store has the final state |

The "smaller files first" rule is a real UX decision: processing in the user's order means a 200-row queue appears
frozen if row 1 is the 40 MP file. Sorting by pixel count is stable and predictable, and the display order stays the
user's — only the *admission* order changes.

---

## 6. Rows and status

| Field | Shown | Source |
|---|---|---|
| name | truncated middle | file |
| dimensions | `4032 × 3024` or `—` while decoding | sniff |
| size | `4.8 MB` | file |
| status | chip: Waiting / 62 % / Done / Failed / Cancelled | job |
| output | `812 KB · −83 %` | metrics |
| actions | retry (failed), cancel (running/pending), download (done) | — |

The header aggregates: `84 of 200 done · 2 running · 1 failed · ≈ 40 s left` plus one lane badge for the whole
queue. The lane badge is not per row because a batch uses one lane; a mixed batch was considered and rejected
(§1).

---

## 7. ZIP

```text
manifest = outputs.map(o => ({ name: unique(o.name), blob: o.blob }))
→ fflate.zip(manifest, { level: 0 })     // store-only: the entries are already compressed images
```

- **Store-only.** Deflating a JPEG saves ~1 % and costs 30 % of the time; for 200 files that is minutes for nothing.
- **Streaming.** `fflate`'s async zip yields chunks, so a 1.5 GB archive does not need 1.5 GB of memory; the
  progress bar shows ZIP generation as a distinct final phase.
- **Names** are de-duplicated in the manifest (`photo.webp`, `photo (2).webp`) with the order preserved; no
  directories are created, so no zip-slip is possible ([13](13-EXPORT-MANAGER.md) §5).
- **Failures are excluded** from the ZIP; the result card lists them with their reasons and offers retry.

A batch that produced 197 of 200 outputs is a success with three failures, not a failure. The header says so in
those words.

---

## 8. Quality, limits, and known behaviour

| Concern | Behaviour |
|---|---|
| 200 × 40 MP on a 4 GB phone | admitted one at a time, each row reaches the pixel ceiling and is refused with its own message; the queue completes with 200 failures rather than crashing |
| Memory | `BitmapScope` per row; `test:memory` asserts open == close after 200 rows |
| Object URLs | one per done row, revoked when the row is removed or the ZIP is generated |
| Retry | a failed row can be retried individually; retry-all retries every `FAILED` row |
| Partial ZIP | allowed, with the failure count in the filename dialog |
| Same tool twice | starting a second batch while one runs is refused ("a queue is already running") |
| Switching tool mid-queue | refused; the queue's config is frozen at start (shown in the header) |
| Cancel then download | the ZIP contains what finished before the cancel |
| Browser close | lane A warns via `beforeunload` if a queue is running; lane B does not need to (server keeps going) |

| Limit | Value |
|---|---|
| Files | 200 |
| Total bytes | 1.5 GB |
| Concurrency | 1–3 (default by device class) |
| ZIP | store-only, streamed |
| Per-file settings | resize, bg-remove only |

---

## 9. Acceptance tests

```text
bun run e2e:tool -- --tool batch        11 cases (§13 of 0-E2E-CHECKLIST)

20 files        all done; the UI accepts a click within 100 ms during the run
mixed formats   each row's output format matches its tool config
one corrupt     that row fails, 19 complete
stopOnError     "stopped after 3 of 20", remaining rows CANCELLED
cancel-all      9 done, 10 cancelled, memory returns to baseline
200 files       no bitmap leak, no URL leak, queue completes
zip             exactly the completed rows, names unique, each entry decodes
per-row download one result, correct name and type
overrides       resize preset applies to one row only
lane mixing     switching lane mid-queue is refused with a reason
oversize        a 101 MB file is refused per row; the other rows run
```

```text
bun run test:load -- --op batch --files 200 --size 12
    reports drain time, peak live bytes, and fails if peak > MAX_LIVE_BYTES
```

---

## 10. Related docs

- [`0-BATCH-AND-QUEUE.md`](0-BATCH-AND-QUEUE.md) — admission, statuses, Redis pool, retries
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — ZIP manifest, naming, metadata policy
- [`0-UI-DESIGN.md`](0-UI-DESIGN.md) §7 — progress and the lane badge
- [`0-CONFIG.md`](0-CONFIG.md) §4 — the browser constants behind the limits
