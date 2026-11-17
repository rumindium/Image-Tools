# 0 — API Contract

> The Elysia tier: everything a browser cannot do itself, and nothing it can. One base path, one error
> envelope, one job shape shared with the local runner.
> Last updated: 16 November 2026

---

## 1. Conventions

| Rule | Value |
|---|---|
| Base path | `/api/v1` |
| Transport | HTTPS only; HSTS with `max-age=31536000; includeSubDomains` |
| Content type | `application/json; charset=utf-8` for everything except upload (multipart) and download (binary/SSE) |
| Auth | `ri_sid` HttpOnly cookie (`SameSite=Lax`, `Secure`, 128-bit) — **no account, no bearer** except ops |
| Session bootstrap | any endpoint that needs one issues the cookie via `Set-Cookie`; there is no `/login` |
| IDs | UUIDv7 for jobs and files (sortable, no counter leak) |
| Timestamps | ISO-8601 UTC with `Z`, millisecond precision |
| Size units | `bytes` is always an integer; `limitMb` values in responses are decimal MB (10⁶) |
| Unknown request keys | rejected with `VALIDATION_ERROR` — strict objects, no silent drop |
| Response envelope | success returns the resource directly; failure returns `{ "error": … }` and a 4xx/5xx status |
| Request id | every response carries `X-Request-Id`; the same value appears in the error body and the logs |

```ts
type ApiError = {
  error: {
    code: ErrorCode;          // §7
    message: string;          // safe to show the user, no path, no stack
    hint?: string;            // one actionable sentence
    requestId: string;
    details?: Array<{ path: string; message: string }>;   // zod issues, path only
  };
};
```

`message` is written for a user, not for a developer: "This file is 31 MB; the server lane accepts up to 25 MB."
A stack trace never reaches the client; `requestId` is the join key to the log line that has it.

---

## 2. Health

### `GET /api/v1/health`

Liveness. Never touches Redis or PostgreSQL; it answers "is this process alive".

```json
{ "status": "ok", "version": "0.1.0", "commit": "9f2c1ab", "uptimeSeconds": 4123 }
```

### `GET /api/v1/health/ready`

Readiness. Touches every dependency, returns 503 when one is down, and names which:

```json
{
  "status": "degraded",
  "checks": {
    "database": { "ok": true, "latencyMs": 3 },
    "redis": { "ok": false, "error": "connect ECONNREFUSED 127.0.0.1:6379" },
    "tempDir": { "ok": true, "freeBytes": 42123456789 },
    "models": { "ok": true, "available": ["isnet-general", "isnet-portrait"] },
    "queueDepth": { "img-ai": 0, "img-heavy": 2 }
  },
  "laneB": "unavailable"
}
```

`laneB` is the single boolean the web app reads to decide whether to show a server-lane button at all. It is
`"unavailable"` unless every dependency lane B needs is healthy — a half-working lane B is worse than none,
because the user has already consented and uploaded by the time it fails.

---

## 3. Files

Lane B receives bytes; lane A never calls this section. Two-step upload exists so that the *job* is created with
metadata the API has validated, not with a client's claim about the image.

### 3.1 Upload

```http
POST /api/v1/files
Content-Type: multipart/form-data
Cookie: ri_sid=…
Idempotency-Key: 5c1f…

file: <binary>
purpose: "job" | "background"     # a background image is also a stored file
```

Validation order — the same order as the browser sniffer, so errors match:

```text
1. body size ≤ SERVER_MAX_FILE_BYTES (25 MB)      → 413 FILE_TOO_LARGE
2. magic bytes in the allowlist                    → 415 UNSUPPORTED_FILE_TYPE
3. header parses                                   → 422 CORRUPT_IMAGE
4. pixels ≤ SERVER_MAX_PIXELS (30 MP)              → 422 IMAGE_TOO_LARGE
5. animated                                        → 422 ANIMATED_NOT_SUPPORTED
6. per-session upload slots available              → 429 RATE_LIMITED
```

```json
// 201
{
  "id": "0192f3c4-5d6e-7f80-9a1b-2c3d4e5f6071",
  "purpose": "job",
  "bytes": 4821331,
  "format": "jpeg",
  "mime": "image/jpeg",
  "width": 4032,
  "height": 3024,
  "hasAlpha": false,
  "orientation": 6,
  "expiresAt": "2026-11-16T10:42:00.000Z"
}
```

The bytes are written to `${TEMP_DIR}/{fileId}/original` with mode `0600`, and the response never contains a path.
`orientation` is reported so the UI can draw a rotated thumbnail without decoding again.

### 3.2 File inspection

```http
GET /api/v1/files/:id
```

Returns the same object as 3.1 and nothing else. Useful for the batch queue to resume after a reload, since the
session cookie survives but the tab's memory does not.

### 3.3 Deleting a file

```http
DELETE /api/v1/files/:id     → 204
```

Deletes the directory recursively. Deleting a file that a queued job references is allowed and makes the job fail
with `CORRUPT_IMAGE` — the queue does not keep a file alive against the user's explicit delete.

---

## 4. Jobs

### 4.1 Create

```http
POST /api/v1/jobs
Content-Type: application/json
Idempotency-Key: 7b2e…        (required)
```

```json
{
  "tool": "bg-remove",
  "files": ["0192f3c4-…"],
  "options": { "model": "auto", "refine": "quality", "outputFormat": "png", "quality": 90 },
  "lane": "server",
  "consent": { "acceptedAt": "2026-11-16T10:31:02.331Z", "version": "2026-11-01" }
}
```

Validation, in order:

| # | Check | Failure |
|---|---|---|
| 1 | `tool` exists, `execution.kind !== 'browser'` | 422 `VALIDATION_ERROR` ("this tool runs in your browser") |
| 2 | options parse against the tool's schema | 422 `VALIDATION_ERROR` + `details[]` |
| 3 | `lane === 'server'` requires `consent` with a current `version` | 422 `SERVER_LANE_CONSENT_REQUIRED` |
| 4 | every `fileId` belongs to this session and is unexpired | 404 `JOB_NOT_FOUND` / 410 `JOB_EXPIRED` |
| 5 | file count ≤ 50, total ≤ 250 MB | 422 `FILE_LIMIT_EXCEEDED` / `JOB_SIZE_EXCEEDED` |
| 6 | daily quota available (transactional) | 429 `QUOTA_EXCEEDED` with `resetAt` |
| 7 | queue reachable | 503 `QUEUE_UNAVAILABLE` (quota refunded) |

```json
// 202
{
  "id": "0192f3c4-77aa-7c31-b8d0-0f1e2d3c4b5a",
  "tool": "bg-remove",
  "status": "QUEUED",
  "lane": "server",
  "queue": "img-ai",
  "files": 1,
  "estimatedSeconds": 6,
  "progress": { "stage": "queued", "pct": 0 },
  "eventsUrl": "/api/v1/jobs/0192f3c4-77aa-7c31-b8d0-0f1e2d3c4b5a/events",
  "expiresAt": "2026-11-16T10:46:30.000Z",
  "createdAt": "2026-11-16T10:31:30.000Z"
}
```

`estimatedSeconds` comes from the same `estimateMs` model the browser uses ([0-TOOL-REGISTRY](0-TOOL-REGISTRY.md)
§2.2), so the two lanes' ETAs are comparable rather than two unrelated guesses.

### 4.2 Read

```http
GET /api/v1/jobs/:id
```

```json
{
  "id": "0192f3c4-77aa-…",
  "tool": "bg-remove",
  "status": "COMPLETED",
  "lane": "server",
  "queue": "img-ai",
  "progress": { "stage": "done", "pct": 1 },
  "input": { "files": 1, "bytes": 4821331, "pixels": 12192768 },
  "output": {
    "files": 1,
    "bytes": 3901220,
    "artifacts": [
      { "index": 0, "name": "product-background-removed.png", "bytes": 3901220,
        "format": "png", "width": 4032, "height": 3024, "hasAlpha": true }
    ]
  },
  "metrics": { "durationMs": 5210, "queueWaitMs": 310, "inferenceMs": 4380 },
  "warnings": [],
  "createdAt": "2026-11-16T10:31:30.000Z",
  "completedAt": "2026-11-16T10:31:35.520Z",
  "expiresAt": "2026-11-16T10:46:35.520Z"
}
```

On `FAILED`, `error` replaces `output`, with the same code vocabulary as lane A:

```json
"error": { "code": "INFERENCE_FAILED", "message": "The model could not segment this image.",
           "hint": "Try the general model, or a smaller image.", "requestId": "req_01J…" }
```

### 4.3 List

```http
GET /api/v1/jobs?status=COMPLETED&limit=20&cursor=0192f3c4-77aa…
```

Returns this session's jobs, newest first, 20 by default (max 100), cursor-paginated by id. No `total`: counting
thousands of rows to render "20 of 341" costs more than the feature is worth, and the UI shows "load more".

### 4.4 Cancel and delete

```http
POST   /api/v1/jobs/:id/cancel   → 200 { status: "CANCELLED" }
DELETE /api/v1/jobs/:id          → 204
```

`cancel` is idempotent: cancelling a `COMPLETED` job returns 409 `VALIDATION_ERROR` ("this job already finished"),
while cancelling an already-`CANCELLED` job returns 200 with the same body. A queued job is removed from the queue;
a running one is flagged and its output discarded on completion — the same late-result rule as lane A.

### 4.5 Download

```http
GET /api/v1/jobs/:id/download?index=0&disposition=attachment
GET /api/v1/jobs/:id/download?index=all&format=zip
```

| Parameter | Values | Default |
|---|---|---|
| `index` | artifact index, `all` | `0` |
| `disposition` | `attachment`, `inline` | `attachment` |
| `format` | `zip` (with `index=all`) | zip for multi, raw bytes for single |

Headers on the response: `Content-Type` from the artifact (never from the request), `Content-Disposition` with an
ASCII-sanitised `filename=` plus RFC 5987 `filename*=` for non-ASCII names, `Content-Length`, `Cache-Control:
private, no-store`, `X-Content-Type-Options: nosniff`. `inline` is what lets the result card open a PNG in a new
tab without downloading it first ([0-UI-DESIGN](0-UI-DESIGN.md) §5.4).

A download after expiry is `410 JOB_EXPIRED`, with `hint: "Results are deleted 15 minutes after processing. Run
it again to get a fresh copy."` — a specific, true sentence, because "not found" would send the user hunting for a
bug that does not exist.

### 4.6 Progress (SSE)

```http
GET /api/v1/jobs/:id/events
Accept: text/event-stream
```

```text
event: progress
id: 7
data: {"jobId":"0192f3c4-77aa-…","status":"PROCESSING","stage":"inference","pct":0.62,"fileIndex":0,"files":1}

event: progress
id: 8
data: {"jobId":"0192f3c4-77aa-…","status":"PROCESSING","stage":"encode","pct":0.88,"fileIndex":0,"files":1}

event: done
id: 9
data: {"jobId":"0192f3c4-77aa-…","status":"COMPLETED","pct":1,"downloadUrl":"/api/v1/jobs/0192f3c4-77aa-…/download?index=all"}
```

Rules that make the stream safe to consume:

- **Monotonic `pct`**, and `id:` strictly increasing — a reconnect can resume with `Last-Event-ID` and receive
  only what it missed (last 32 events buffered in Redis per job).
- **A terminal event always arrives**: `done` or `failed`, followed by the server closing the stream. A client
  therefore never needs a polling fallback, and a watchdog on the client (5 s without a heartbeat → refetch
  `GET /jobs/:id`) covers a dropped proxy.
- **Heartbeat every 15 s** as a comment line (`: ping`), which keeps Caddy and any intermediary from closing an
  idle connection without injecting a fake event.
- The stream is scoped to the session: another session's job is `404`, not `403` — existence is not information
  this product discloses.

Stage vocabulary is the job pipeline's, not a tool's:
`queued → staging → inference|transform → encode → verify → done`, joined by `|` because a tool may use either
middle stage.

---

## 5. Catalog endpoints

### `GET /api/v1/tools`

Only tools that can run on the server, with the limits that apply *now*:

```json
{
  "tools": [
    { "id": "bg-remove", "title": "Remove background", "queue": "img-ai",
      "options": ["model", "refine", "outputFormat", "quality"],
      "limits": { "maxFiles": 20, "maxFileBytes": 26214400, "maxPixels": 30000000 } },
    { "id": "upscale", "title": "AI upscale", "queue": "img-heavy",
      "options": ["scale", "model"], "limits": { "maxFiles": 1, "maxFileBytes": 26214400, "maxPixels": 12000000 } }
  ],
  "laneB": true,
  "consentVersion": "2026-11-01"
}
```

The list is generated from the registry, so a tool cannot exist in the API without existing in the client bundle.

### `GET /api/v1/presets`

```http
GET /api/v1/presets?platform=instagram
If-None-Match: "presets-3.2.0"
→ 304   (or 200 with ETag: "presets-3.2.0", Cache-Control: public, max-age=300, stale-while-revalidate=86400)
```

The web app bundles the same catalog at build time and only fetches this endpoint to discover a newer version. So
presets work offline, and a dimension change ships in hours rather than at the next release
([11](11-SOCIAL-PRESETS.md) §5).

### `GET /api/v1/models`

The manifest the AI worker actually loaded, with hashes — the browser compares it against its own manifest and
warns if they differ, because a server model that is not the model the docs describe is a silent difference in
output quality ([0-AI-MODELS](0-AI-MODELS.md) §8).

```json
{
  "models": [
    { "id": "isnet-general", "version": "1.4.0", "license": "Apache-2.0",
      "bytes": 176000000, "sha256": "9f2c…", "input": [1024, 1024], "dtype": "q8",
      "runtime": ["wasm", "webgpu", "node"] }
  ],
  "manifestVersion": "2026-11-10"
}
```

### `GET /api/v1/usage`

```json
{
  "session": { "jobsToday": 3, "jobsLimit": 200, "bytesToday": 14311803, "bytesLimit": 524288000 },
  "resetAt": "2026-11-17T00:00:00.000Z",
  "laneB": true
}
```

Counters only. No filenames, no tool history, no timestamps per job — `GET /jobs` already exposes this session's
own jobs, and a second endpoint that summarises them would be a second source of truth.

---

## 6. Operational endpoints

```http
POST /api/v1/admin/ops/sweep
Authorization: Bearer $ADMIN_OPS_TOKEN
→ { "deleted": 12, "freedBytes": 88123456, "ranAt": "…" }
```

Also `GET /api/v1/admin/ops/stats` (queue depth, disk, oldest file age, jobs by status) and
`POST /api/v1/admin/ops/reload-models` (re-read the manifest without a restart). All are refused (404, not 403)
when `ADMIN_OPS_TOKEN` is unset, so a production deployment that never configures them exposes no route at all.
`403` would confirm their existence; `404` does not.

---

## 7. Error model

28 codes. Every code maps to exactly one HTTP status; a code that could be two statuses is two codes.

| Code | HTTP | Raised by | User-facing message pattern |
|---|---|---|---|
| `VALIDATION_ERROR` | 422 | API, worker | "… is not a valid value for …" + `details[]` |
| `UNSUPPORTED_FILE_TYPE` | 415 | sniff, API | "That file is not an image we can read (detected: …)." |
| `FILE_TOO_LARGE` | 413 | API, browser | "This file is 31 MB; the limit is 25 MB." |
| `IMAGE_TOO_LARGE` | 422 | sniff, API | "4000 × 3000 is above the … limit for this device." |
| `CORRUPT_IMAGE` | 422 | decode | "The file is damaged and could not be decoded." |
| `DECODE_FAILED` | 415 | decode | "This browser cannot decode HEIC. Try JPEG or PNG." |
| `ENCODE_UNSUPPORTED` | 422 | encode probe | "This browser cannot write AVIF." |
| `ENCODING_FAILED` | 500 | encode | "The browser failed while writing the output." |
| `ANIMATED_NOT_SUPPORTED` | 422 | sniff | "Animated images are not supported; frame 1 only would lose the animation." |
| `SVG_RASTERIZED` | 422 | sniff | "SVG is imported as a raster at … px, so it cannot be exported as SVG." |
| `FILE_LIMIT_EXCEEDED` | 422 | API, batch | "A job accepts up to 50 files; this has 61." |
| `JOB_SIZE_EXCEEDED` | 422 | API | "The job totals 261 MB; the limit is 250 MB." |
| `QUOTA_EXCEEDED` | 429 | API | "You have used 200 of 200 server jobs today. Resets at …" |
| `RATE_LIMITED` | 429 | API | "Too many requests. Try again in 12 s." + `Retry-After` |
| `MEMORY_LIMIT_EXCEEDED` | 507 | worker | "Ran out of memory at 38 MP. Try a smaller size or the server worker." |
| `MODEL_LOAD_FAILED` | 503 | AI session | "The AI model could not be downloaded. Check your connection." |
| `MODEL_UNLICENSED` | 500 | registry | internal — a build that shipped a model without a recorded license |
| `INFERENCE_FAILED` | 500 | AI worker | "The model could not segment this image." |
| `GPU_UNAVAILABLE` | 503 | probe, worker | "GPU acceleration is unavailable; retrying on CPU." |
| `SERVER_LANE_DISABLED` | 503 | router | "Server processing is not available in this deployment." |
| `SERVER_LANE_CONSENT_REQUIRED` | 422 | API | "Server processing needs your consent for this image." |
| `QUEUE_UNAVAILABLE` | 503 | API | "The server queue is unavailable. Your browser can still process this image." |
| `JOB_NOT_FOUND` | 404 | API | "That job does not exist in this session." |
| `JOB_EXPIRED` | 410 | API, download | "Results are deleted 15 minutes after processing." |
| `EXPORT_FAILED` | 500 | exporter | "The file could not be saved." |
| `CANCELLED` | 499 (client-internal) | runner | not shown as an error; the row says "Cancelled" |
| `INTERNAL_ERROR` | 500 | any | "Something went wrong. Reference: …" |
| `UNAUTHORIZED` | 401 | admin ops | "Not authorised." |

Notes that are decisions, not trivia:

- `JOB_EXPIRED` is **410, not 404**: the resource existed and is gone by policy, and the distinction is what lets
  the UI offer "run again" with confidence instead of showing an empty state.
- `CANCELLED` never renders as an error — it is a status. It exists in the code enum because the runner returns it.
- `GPU_UNAVAILABLE` from the probe is a *warning path*: the job retries on WASM before the user sees anything.
  Only the second failure surfaces, and it surfaces as `INFERENCE_FAILED` with `metrics.runtime: "wasm"`.
- `MODEL_UNLICENSED` is a build-time failure surfaced at runtime on purpose: a model whose license is not in the
  manifest must not run, even if it was copied into the image by hand ([0-AI-MODELS](0-AI-MODELS.md) §2).

---

## 8. Rate limits and quotas

| Scope | Limit | Window | Mechanism |
|---|---|---|---|
| `POST /files` | 60 uploads, burst 30 | 60 s | token bucket per session |
| `POST /jobs` | 30 | 60 s | token bucket per session |
| `GET /jobs/:id/events` | 10 concurrent | — | connection count per session |
| `GET /jobs/:id/download` | 120 | 60 s | token bucket |
| Everything else | 300 | 60 s | token bucket |
| Daily server jobs | 200 / session | UTC day | `usage_daily` row, transactional |
| Daily server bytes | 500 MB / session | UTC day | same row |

Limits come from configuration with these defaults ([0-CONFIG](0-CONFIG.md) §5) and are read per request, so a
deployment can tighten them without a release. Every 429 carries `Retry-After` and `X-RateLimit-Remaining`; a
limit that a client cannot see is a limit users experience as a random failure.

Lane A has **no server limit at all**, which is the point: the rate limiter protects the API, not the product.

---

## 9. Idempotency and concurrency

- `Idempotency-Key` is required on `POST /jobs` and `POST /files`. Same key + same body within 10 minutes returns
  the original response (200 with `Idempotent-Replay: true`). Same key + **different** body returns
  `422 VALIDATION_ERROR` — replaying a different request under the same key is a client bug worth surfacing.
- The key is scoped to the session, stored in Redis with a 10-minute TTL, and never contains user data in the
  stored value beyond the response body.
- Concurrent identical jobs are not deduplicated. Two clicks are two jobs; the UI prevents the second click, and
  the API does not pretend to read minds.
- A job is processed by exactly one worker: the queue's claim is atomic, and the worker writes output through a
  temp file plus `rename` so a partially written artifact is never downloadable.

---

## 10. Security headers and CORS

```http
Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:;
  script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none';
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

`'wasm-unsafe-eval'` is required by ONNX Runtime Web and is narrower than `'unsafe-eval'`: it permits
WebAssembly compilation and nothing else. `connect-src 'self'` is deliberate — the page cannot POST a user's
image anywhere even if a dependency tried to, which turns the privacy promise into a browser-enforced fact rather
than a code review ([0-SECURITY](0-SECURITY.md) §3).

CORS: no wildcard, ever. `Access-Control-Allow-Origin` echoes only `APP_ORIGIN`, with
`Access-Control-Allow-Credentials: true`, and a request whose `Origin` is absent or different is refused for any
mutating method. In production Caddy serves both apps on one origin, so a browser preflight only happens in
development — which is precisely where it must be tested.

---

## 11. Worked example — background removal, server lane

```bash
# 1. is lane B even up?
curl -s localhost:4401/api/v1/health/ready | jq '.laneB'          # "available"

# 2. upload (cookie is issued here if this is a new session)
curl -s -c jar -b jar -F file=@product.jpg -F purpose=job \
     localhost:4401/api/v1/files | jq
# { "id": "0192f3c4-…", "width": 4032, "height": 3024, "bytes": 4821331, … }

# 3. create the job — consent is part of the payload
curl -s -c jar -b jar -H 'content-type: application/json' \
     -H 'Idempotency-Key: 7b2e4c1a-…' \
     -d '{"tool":"bg-remove","files":["0192f3c4-…"],
          "options":{"model":"auto","refine":"quality","outputFormat":"png"},
          "lane":"server",
          "consent":{"acceptedAt":"2026-11-16T10:31:02.331Z","version":"2026-11-01"}}' \
     localhost:4401/api/v1/jobs | jq
# 202 { "id": "0192f3c4-77aa-…", "status": "QUEUED", "queue": "img-ai", … }

# 4. follow progress
curl -N -b jar localhost:4401/api/v1/jobs/0192f3c4-77aa-…/events

# 5. download
curl -s -b jar -OJ 'localhost:4401/api/v1/jobs/0192f3c4-77aa-…/download?index=all&format=zip'
```

The same five steps with `lane: "browser"` never leave the tab. That is the contract in one paragraph: the API is
a second implementation of the same job, not the primary one.

---

## 12. Versioning policy

| Change | Allowed in `/v1`? |
|---|---|
| New optional option key with a default | yes |
| New response field | yes (clients ignore unknown keys on *responses*) |
| New error code | yes — clients must map unknown codes to a generic message, and the docs table is the mapping |
| New required request field | **no** → `/v2` |
| Renamed option key | no → accept both for one minor, then `/v2` |
| Removed endpoint | no → `/v2` |
| Changed limit value | yes — limits are advertised in `/tools` and `/usage` precisely so they can move |

The client is generated from the registry, not hand-written per endpoint, so a `/v2` would be a router swap. It
is not planned: the API has one consumer, and versioning for an audience of zero is overhead.

---

## Related docs

- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) — the schemas these endpoints validate
- [`0-BATCH-AND-QUEUE.md`](0-BATCH-AND-QUEUE.md) — queues, retries, claim semantics
- [`0-FILE-STORAGE.md`](0-FILE-STORAGE.md) — where bytes live and when they are deleted
- [`0-SECURITY.md`](0-SECURITY.md) — the headers above, and why each one is there
- [`0-CONFIG.md`](0-CONFIG.md) — every limit in §8 as an environment variable
