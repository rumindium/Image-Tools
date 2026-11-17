# 0 — Observability

> The browser lane cannot be monitored centrally without becoming surveillance. So lane A is measured on the
> device and reported as aggregates, and lane B is measured normally.
> Last updated: 16 November 2026

---

## 1. What must be answerable

| Question | Answered by |
|---|---|
| Is lane B healthy right now? | `/health/ready`, queue depth, worker heartbeats |
| Is a specific job slow, and where? | `metrics` jsonb on the row + stage timings |
| Are users hitting device limits? | aggregate `lane.escape` counts by reason |
| Did quality regress after a release? | nightly pixel suite + perf baseline |
| Is the sweeper keeping up? | `oldest_file_age_seconds` |
| Is a model failing on real inputs? | `INFERENCE_FAILED` rate + `ALPHA_INVERTED` count |

Nothing here requires a user identifier, a filename or an image.

---

## 2. Lane A instrumentation (on-device only)

The browser records a `SessionTelemetry` object in memory:

```ts
type SessionTelemetry = {
  caps: Capabilities;              // probed once
  jobs: Array<{ tool: ToolId; ms: number; pixels: number; code?: ErrorCode; stage?: Stage }>;
  escapes: Array<{ reason: 'memory' | 'gpu' | 'manual'; pixels: number }>;
  models: Array<{ id: string; loadMs: number; cached: boolean; runtime: 'webgpu' | 'wasm' }>;
};
```

Two consumers:

1. **Settings → Diagnostics** renders it, so a user can see why the app is slow or why AI is off. This is the
   cheapest support tool ever built: a screenshot of that panel answers most performance questions.
2. **An aggregated beacon**, only if the deployment opts in (`NEXT_PUBLIC_TELEMETRY=aggregate`): one POST at
   unload with counts bucketed by tool and duration band. No pixels, no file names, no exact dimensions, no
   session id. If the flag is off — the default for a self-hosted build — nothing is sent at all.

Bucketing is not paranoia for its own sake: `{ tool: 'crop', pixels: 12192768, ms: 4123 }` combined with an IP is
close enough to identify a document. `{ tool: 'crop', bucket: '10-20MP', ms: '4-8s' }` is not.

---

## 3. Lane B metrics (Prometheus, `/metrics` on an internal port)

| Metric | Type | Labels | Why |
|---|---|---|---|
| `ri_jobs_total` | counter | `tool`, `status`, `queue` | volume and outcome |
| `ri_job_duration_seconds` | histogram | `tool`, `queue` | the SLO input |
| `ri_queue_wait_seconds` | histogram | `queue` | separates waiting from working |
| `ri_inference_seconds` | histogram | `model`, `runtime` | model performance on real traffic |
| `ri_queue_depth` | gauge | `queue`, `state` | backpressure |
| `ri_workers_healthy` | gauge | `queue` | a dead pool with an empty queue looks fine otherwise |
| `ri_uploads_total` | counter | `result` | abuse and failure mix |
| `ri_upload_bytes` | histogram | — | cost per job |
| `ri_quota_rejections_total` | counter | `kind` | indicates the free tier is too small (or abuse) |
| `ri_sweep_duration_seconds` | histogram | — | sweeper health |
| `ri_files_swept_total` | counter | — | |
| `ri_oldest_file_age_seconds` | gauge | — | **the** retention alarm |
| `ri_disk_free_bytes` | gauge | — | capacity |
| `ri_model_load_failures_total` | counter | `model` | supply-chain or volume problem |
| `ri_sse_connections` | gauge | — | file descriptor pressure |
| `ri_http_request_duration_seconds` | histogram | `route`, `method`, `status` | the API itself |

Cardinality is bounded on purpose: `route` is the *pattern* (`/jobs/:id`), never the id; `tool` is one of twenty;
there is no `session` label anywhere.

---

## 4. Logs

Structured JSON, one line per request and one per state transition:

```json
{"t":"2026-11-16T10:31:35.520Z","lvl":"info","msg":"job.completed","requestId":"req_01J…",
 "jobId":"0192f3c4-…","tool":"bg-remove","queue":"img-ai","lane":"server",
 "inBytes":4821331,"outBytes":3901220,"pixels":12192768,"queueWaitMs":310,
 "durationMs":5210,"runtime":"webgpu","warnings":[]}
```

| Level | Use |
|---|---|
| `debug` | stage timings, probe outcomes — dev only |
| `info` | job lifecycle, deploys, config summary (names, never values) |
| `warn` | retry, disk guard, fallback encode, inverted matte |
| `error` | failed job with a code, unhandled exception with a stack **in the log only** |

The field allowlist lives in `infra/log.ts` ([0-SECURITY](0-SECURITY.md) §10). A new field requires a code change,
which is the point: redaction fails open, allowlisting fails closed.

---

## 5. Traces

Optional (`OTEL_EXPORTER_OTLP_ENDPOINT`). When enabled:

```text
POST /jobs ──► enqueue ──► worker.claim ──► decode ──► inference ──► encode ──► write
                                            (span per stage, attributes: pixels, model, runtime)
```

No span carries a filename, a path or a payload. A trace without an endpoint configured creates **no** spans —
not a no-op exporter that silently buffers, which is how tracing becomes a memory leak.

---

## 6. Dashboards and alerts

### 6.1 The one dashboard

Six panels, in this order, because this is the order the questions get asked:

1. Requests/s and error rate by route.
2. Queue depth + workers healthy, both queues.
3. Job p50/p95 by tool (queue wait vs work, stacked).
4. Upload bytes and quota rejections.
5. Disk free + oldest file age.
6. Model load failures + `ALPHA_INVERTED` rate.

### 6.2 Alerts

| Alert | Condition | Severity |
|---|---|---|
| Lane B unavailable | `/health/ready` non-200 for 2 min | page |
| Oldest file beyond TTL | `oldest_file_age_seconds > 2 × JOB_TTL` for 10 min | page (retention broken = promise broken) |
| Disk low | `< MIN_FREE_DISK_BYTES` | page |
| Queue backed up | depth > 500 for 10 min | warn |
| Worker down | `workers_healthy == 0` for 5 min with depth > 0 | page |
| Error rate | 5xx > 2 % over 10 min | warn |
| Inference failures | `INFERENCE_FAILED` > 10 % of `img-ai` jobs over 30 min | warn |
| Sweeper slow | `sweep_duration_ms` p95 > 10 s | warn |
| Quota saturated | > 30 % of sessions hitting quota | product signal, not an incident |

`oldest_file_age_seconds` is the alert that matters most for this product: a broken sweeper is invisible until a
user asks why their file is still there, and by then the answer is "it is".

---

## 7. SLOs

| SLO | Target | Measurement |
|---|---|---|
| Lane B job success (excluding user errors) | ≥ 99 % | `ri_jobs_total{status="COMPLETED"}` / all terminal |
| Lane B p95 end-to-end, `bg-remove` at ≤ 12 MP | ≤ 25 s | `ri_job_duration_seconds` + `ri_queue_wait_seconds` |
| API availability | 99.5 % monthly | `/health/ready` probe |
| TTL compliance | 100 % of artifacts deleted ≤ TTL + 2 min | `oldest_file_age_seconds` |
| Page availability (static) | 99.9 % | CDN probe |

The TTL SLO has no error budget in the usual sense: a missed retention target is a trust incident regardless of
percentage. It is stated as 100 % because that is what was promised in the consent dialog.

---

## 8. Incident playbook (short)

| Symptom | Check | First action |
|---|---|---|
| Jobs stuck `QUEUED` | queue depth, worker containers, Redis | restart the pool; the queue is durable |
| Jobs stuck `PROCESSING` | heartbeats, worker logs for OOM | let the stall detector fail them; raise memory only with a measurement |
| Downloads 410 immediately | `expires_at` in the row vs clock | check NTP; a skewed clock shortens TTL |
| Disk filling | oldest file age, sweep logs | run `ops:sweep` manually, then fix the sweeper |
| Inference all failing | model files present? hash match? | reload models; the API exposes `/admin/ops/reload-models` |
| Everything slow | DB latency, Redis latency | lane B degrades first; lane A is unaffected by design |

The last line is the design goal: an outage of this backend should be invisible to a user who never opted into
lane B.

---

## 9. Analytics, and its limits

Product analytics is limited to what helps a user finish a job faster:

| Event | Fields | Never |
|---|---|---|
| `tool.opened` | tool id | referrer, user id |
| `job.start` | tool, lane, files bucket, bytes bucket, device class | filenames, dimensions per file |
| `job.done` | tool, lane, duration band, output bytes band, warning codes | output content |
| `job.fail` | tool, lane, error code, stage | the message (it may contain a filename) |
| `model.load` | model id, duration band, cached | — |
| `lane.escape` | from, to, reason | — |

There is no funnel, no retention cohort, no session replay. The product is a tool; the useful question is "where
does it break", not "who came back".

---

## Related docs

- [`0-CONFIG.md`](0-CONFIG.md) §2.8 — the environment variables above
- [`0-API.md`](0-API.md) §2 — the health endpoints
- [`0-FILE-STORAGE.md`](0-FILE-STORAGE.md) §5 — the sweeper whose age is alerted on
- [`0-UI-DESIGN.md`](0-UI-DESIGN.md) §13 — the client events in §9
