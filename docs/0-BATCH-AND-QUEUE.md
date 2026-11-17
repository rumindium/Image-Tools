# 0 — Batch and Queue

> Two queues with the same contract: the one in the tab, which is budget-aware, and the one in Redis, which is
> claim-aware. Both must survive a cancel, an error and a slow file.
> Last updated: 16 November 2026

---

## 1. The two queues

| | Tab queue (lane A) | Redis queue (lane B) |
|---|---|---|
| Lives in | `apps/web/src/lib/local-runner.ts` + Zustand | `img-ai`, `img-heavy` |
| Unit | a `LocalJob` per file | a BullMQ job per file |
| Admission | memory budget + worker slots | worker concurrency + timeout |
| Survives reload | **no** | yes (results still downloadable) |
| Progress | `postMessage` + throttled store update | Redis pub/sub → SSE |
| Cancel | `AbortSignal` + worker message | queue removal or flag + discard |
| Failure isolation | per row | per job |

The UI renders both with one component: a `JobRow` reads `{ name, bytes, status, pct, stage, lane, error }` and
does not know which queue produced it ([0-UI-DESIGN](0-UI-DESIGN.md) §7).

---

## 2. Tab queue

### 2.1 Admission

```ts
function admit(job: LocalJob, live: Set<LocalJob>): 'run' | 'wait' | 'refuse' {
  const need = job.pixels * 4 * 2.5 + job.pixels;
  if (need > maxLiveBytes) return 'refuse';           // single job cannot fit, ever
  if (liveBytes(live) + need > maxLiveBytes) return 'wait';
  if (running(live) >= concurrency) return 'wait';
  return 'run';
}
```

Three outcomes, three messages: `run` is silent, `wait` shows "Waiting for memory (2 of 3 running)", `refuse`
opens the reason card with the measured pixel count and the server-lane offer. A job that will never fit must be
refused **before** a worker starts, because "it waits forever" is indistinguishable from a hang.

### 2.2 Concurrency

| Device class | Workers | Concurrent jobs |
|---|---|---|
| desktop, ≥ 8 cores | 3 | 2 |
| desktop, 4–7 cores | 2 | 1 |
| ≥ 8 GB, coarse pointer (tablet) | 2 | 1 |
| phone, ≤ 4 GB | 1 | 1 |

Concurrency is capped at 2 even on a 16-core machine: the bottleneck is GPU/codec memory, not cores, and two
40 MP jobs at once would exceed the 512 MB budget anyway. The worker count can exceed the job count so that the
next job's worker is warm (session creation for AI is the expensive part).

### 2.3 Row lifecycle

```text
PENDING ──admit──► RUNNING ──► DONE
   │                  ├──────► FAILED ──retry──► PENDING
   │                  └──────► CANCELLED
   └──cancel────────► CANCELLED
```

`PENDING` includes "waiting for memory", "waiting for a slot" and "queued behind another tool in the batch" — one
visual state, with the reason in the row's subtitle. Adding three more states would produce three more
transitions to test for no user-visible gain.

### 2.4 Fan-out

A batch is **not** one giant transform: it is the same tool applied per file, with the options object shared.

```text
BatchOptions { toolId, toolOptions, concurrency, lane, stopOnError, zip }
   │
   ├── validate each file against the tool's accepts/limits   → per-row error, queue continues
   ├── schedule with §2.1 admission
   └── per row: resolve options (schema.parse once, reuse) → run → result
```

Per-file overrides are allowed by exactly two tools — `resize` (a preset per file) and `bg-remove` (a model per
file) — and they arrive as `overrides: { [fileId]: Partial<Options> }`, merged before `parse`. Everything else
shares one config on purpose: a queue with 200 different quality settings is a spreadsheet, and the product's
promise is "process this set the same way".

### 2.5 Errors

| Failure | Row | Queue |
|---|---|---|
| validation (type, size) | `FAILED`, no retry | continues |
| decode | `FAILED`, no retry | continues |
| memory | `FAILED` + server offer | continues (frees memory first) |
| encoder unsupported | `FAILED` (should have been prevented by the probe) | continues |
| transform exception | `FAILED`, retryable once automatically | continues |
| `stopOnError: true` | `FAILED` | remaining rows go `CANCELLED`, header says "stopped after 3 of 12" |

Automatic retry is limited to one attempt and only for errors marked `retryable` (a transform exception, not a
corrupt file). Retrying a corrupt file 200 times is how a queue turns one bad upload into ten minutes of fan noise.

### 2.6 Cancellation

```text
"Cancel all"  → for each running row: abort() + worker cancel message
                for each pending row: drop from the queue
                header → "Cancelled 7 of 12 · 5 done"
```

Completed rows keep their results — cancelling the queue is not "undo my work", and the ZIP offered afterwards
contains what actually finished. Every cancelled row releases its bitmap and revokes its URL before the row turns
`CANCELLED`, so memory drops immediately rather than at the end of the loop.

### 2.7 The ZIP at the end

The batch produces a `ZIP manifest` (`image-core/zip.ts`), not a ZIP file, until the user downloads:
`{ entries: [{ name, blob }] }`. Names come from the exporter's naming rules and are de-duplicated
(`photo.webp`, `photo (2).webp`). This keeps the queue's memory flat — building a 1.5 GB ZIP in memory would
double the batch's footprint for a file the user may never download.

---

## 3. Redis queue (lane B)

### 3.1 Pools

| Queue | Handlers | Concurrency | Timeout | Why separate |
|---|---|---|---|---|
| `img-ai` | `bg-remove`, `enhance` (AI) | 1 (2 on GPU) | 300 s | inference is the expensive, serialising resource |
| `img-heavy` | `upscale`, large `resize`, ZIP for > 200 artifacts | 2 | 600 s | CPU + `sharp`, no GPU contention with AI |

Two queues, not five: a pool exists to isolate a *resource*, and there are two contended resources. A queue per
tool would multiply the idle capacity without protecting anything.

### 3.2 Claim and heartbeat

```text
worker: BRPOPLPUSH? no — BullMQ's atomic claim
   ├── job → PROCESSING (guarded UPDATE, 0-DATABASE §3.2)
   ├── heartbeat every 10 s → HSET job:{id} heartbeat <ts>, EXPIRE 60
   ├── progress → PUBLISH job:{id}:events {stage,pct}
   └── on complete: write output atomically → UPDATE COMPLETED, expires_at = now + TTL → PUBLISH done
```

A worker that dies stops heartbeating; the API's stall detector ([0-FILE-STORAGE](0-FILE-STORAGE.md) §5 step 4)
turns the row `FAILED` after `3 × timeout`, and BullMQ's own stalled-job handling re-queues it once. Both
mechanisms exist because they cover different failures: BullMQ re-runs, the detector guarantees the row reaches a
terminal state even if the re-run never happens.

### 3.3 Retries

| Error | Retried | Why |
|---|---|---|
| `INFERENCE_FAILED` (runtime error) | once, then `FAILED` | a GPU reset is transient |
| `MEMORY_LIMIT_EXCEEDED` | **no** | the same image will exhaust the same memory |
| `CORRUPT_IMAGE` | no | deterministic |
| `MODEL_LOAD_FAILED` | once after 5 s | a cold volume mount can be slow |
| `JOB_TIMEOUT` | no | a timeout twice is a capacity problem, not a fluke |
| worker crash | yes (BullMQ stall) | the job never ran to a decision |

Retry backoff is exponential with jitter (2 s, 8 s) and the SSE stream emits `retrying` so the UI's bar does not
silently restart from 0 — it shows "retrying (2 of 2)".

### 3.4 Priority and fairness

Lane B is a convenience and stays small, so there is one priority level. Fairness comes from the per-session
quota (200/day), not from a scheduler. A priority queue would need a plan concept, which needs accounts, which the
MVP does not have. If lane B ever becomes the primary path, this section changes first.

### 3.5 Backpressure

`GET /health/ready` reports `queueDepth`. Above `QUEUE_DEPTH_SOFT_LIMIT` (100 waiting), `POST /jobs` still accepts
but the response carries `estimatedSeconds` computed from depth × mean service time, and the UI shows "about 2
minutes in the queue" before the user commits. Above 500, creation returns `503 QUEUE_UNAVAILABLE` with a hint to
use the browser lane — which is still available, and still free.

---

## 4. What the queue guarantees, in testable sentences

| Claim | Test |
|---|---|
| Every submitted job reaches a terminal state | `queue-terminal-state` — submit 50, kill a worker mid-run, assert no row stays `PROCESSING` |
| A cancelled job never publishes a result | `queue-cancel-late` — cancel during inference, assert no `done` event and no artifact |
| A retried job does not duplicate artifacts | `queue-retry-idempotent` — force a retry, assert one artifact |
| Quota is refunded only before a claim | `quota-refund` — fail in queue vs fail in inference |
| FIFO within a session, no starvation across sessions | `queue-fairness` — two sessions, interleaved submission, both progress |
| ZIP of 200 artifacts contains 200 readable images | `zip-200` — count entries, decode each |

---

## Related docs

- [`12-BATCH-PROCESSING.md`](12-BATCH-PROCESSING.md) — the user-facing tool over this queue
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §6 — the worker protocol the tab queue drives
- [`0-API.md`](0-API.md) §4 — creation, SSE, cancel
- [`0-DATABASE.md`](0-DATABASE.md) §3 — the transitions above, in SQL
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) §4 — the ZIP manifest
