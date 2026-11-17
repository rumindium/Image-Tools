# 0 — Configuration

> Every limit, path and switch in one table. A number that appears in code but not here is a bug.
> Last updated: 16 November 2026

---

## 1. Config loading

Three runtimes, one schema each, no shared "config object" leaking across the boundary:

| Runtime | Loader | Schema | Fails when |
|---|---|---|---|
| `apps/api` (Bun) | `Bun.env` → `apiConfigSchema` | `apps/api/src/config.ts` (zod) | any required var missing, on boot, with the list of missing names |
| `workers/*` (Bun) | same pattern | `workers/shared/src/config.ts` | same |
| `apps/web` (Next) | only `NEXT_PUBLIC_*`, inlined at build | `apps/web/src/env.ts` (zod, `client:` prefix) | at build, so a missing var cannot ship |

Rules:

1. **The server never reads a `NEXT_PUBLIC_*` var; the client never reads a secret.** The Next client schema
   rejects anything not prefixed `NEXT_PUBLIC_`, and the API schema has no `NEXT_PUBLIC_` keys at all.
2. **Boot fails fast and loudly.** A missing `DATABASE_URL` produces one line naming every missing variable, not
   a `TypeError` at the first request. A production process that starts half-configured runs until someone
   sends an image.
3. **Numbers are parsed as numbers.** `z.coerce.number().int().positive()` — a string `"25"` compared with `>`
   silently works, a string `"25mb"` silently produces `NaN` and every check becomes false.
4. **No default for a secret.** `ADMIN_OPS_TOKEN` has no fallback; unset means the route is not mounted
   ([0-API](0-API.md) §6).
5. **Every value below has exactly one reader.** `SERVER_MAX_PIXELS` is read in `apps/api/src/limits.ts`; the
   worker receives the resolved value on the job payload so the two cannot disagree.

---

## 2. Environment variables

### 2.1 Core

| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables fail-closed quota and disables stack traces |
| `APP_ORIGIN` | `http://localhost:4400` | the only allowed CORS origin, and the cookie's `Origin` check |
| `API_PORT` | `4401` | |
| `API_BASE_PATH` | `/api/v1` | changing this breaks the client's generated URLs by design |
| `LOG_LEVEL` | `info` | `debug` in dev; `silent` is refused in production |
| `COMMIT_SHA` | `dev` | returned by `/health`, used by the deploy smoke test |
| `TZ` | `UTC` | quota day boundary depends on it; never a local zone |

### 2.2 Web

| Var | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4401/api/v1` | absolute in dev (different ports), relative in prod |
| `NEXT_PUBLIC_LANE_B` | `true` | hide the server-lane UI entirely when false; the API's `laneB` still wins |
| `NEXT_PUBLIC_BUILD_ID` | `dev` | cache-busting for the model cache key |
| `NEXT_PUBLIC_TELEMETRY` | `off` | `aggregate` sends one bucketed beacon ([0-OBSERVABILITY](0-OBSERVABILITY.md) §2); anything else is refused at build |

`NEXT_PUBLIC_LANE_B=false` is for a static-only deployment (a pure CDN export of the app, no API). In that mode
the app is a single-page tool suite with no server at all — a legitimate, documented mode, and the reason lane A
has zero runtime dependency on the API.

### 2.3 Server lane — storage

| Var | Default | Notes |
|---|---|---|
| `TEMP_DIR` | `/var/lib/rumindium-image/jobs` | must be on a local disk, not NFS (rename semantics) |
| `SERVER_MAX_FILE_BYTES` | `26214400` (25 MB) | upload limit, enforced by Caddy **and** the API |
| `SERVER_MAX_PIXELS` | `30000000` | 30 MP; header-read before decode |
| `JOB_TTL_MINUTES` | `15` | from `completed_at`, not from upload |
| `SWEEP_INTERVAL_SECONDS` | `60` | cron inside the API (single leader) |
| `MIN_FREE_DISK_BYTES` | `5368709120` (5 GB) | below this, lane B refuses new jobs (`503`) |

`MIN_FREE_DISK_BYTES` is the guard that keeps a full disk from becoming a corrupt-download incident: refusing a
job is recoverable, a truncated PNG in a ZIP is not.

### 2.4 Server lane — limits and quota

| Var | Default | Notes |
|---|---|---|
| `SERVER_LANE_ENABLED` | `true` | the master switch; `false` unmounts job creation |
| `SERVER_MAX_FILES_PER_JOB` | `50` | |
| `SERVER_MAX_JOB_BYTES` | `262144000` (250 MB) | |
| `QUOTA_JOBS_PER_DAY` | `200` | per session, UTC day |
| `QUOTA_BYTES_PER_DAY` | `524288000` (500 MB) | per session |
| `RATE_UPLOADS_PER_MIN` | `60` | plus a burst bucket of 30 |
| `RATE_JOBS_PER_MIN` | `30` | |
| `RATE_DOWNLOADS_PER_MIN` | `120` | |
| `RATE_SSE_CONCURRENT` | `10` | per session |
| `CONSENT_VERSION` | `2026-11-01` | bumped when the consent text changes; old consents are refused |

### 2.5 Queue and jobs

| Var | Default | Notes |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | |
| `QUEUE_AI` | `img-ai` | |
| `QUEUE_HEAVY` | `img-heavy` | |
| `JOB_TIMEOUT_SECONDS` | `300` (ai), `600` (heavy) | per queue |
| `JOB_MAX_ATTEMPTS` | `2` | retries only idempotent ops; a segmentation retry is safe |
| `WORKER_CONCURRENCY` | `1` (ai), `2` (heavy) | raise only after a load test |
| `WORKER_CPU_LIMIT` | `2` | read by Compose for the container's `cpus` |
| `WORKER_MEM_LIMIT` | `4g` | ORT + sharp peak |

### 2.6 AI

| Var | Default | Notes |
|---|---|---|
| `MODEL_DIR` | `/opt/rumindium-image/models` | read-only mount; no network fetch at request time |
| `MODEL_MANIFEST_PATH` | `packages/contracts/model-manifest.json` | the same file the web build uses |
| `MAX_MODEL_BYTES` | `62914560` (60 MB) | a larger model needs `ALLOW_LARGE_MODELS` |
| `ALLOW_NONCOMMERCIAL_MODELS` | `false` | must stay false for any public deployment |
| `ENABLE_IMGLY_ADAPTER` | `false` | AGPL adapter, see [0-AI-MODELS](0-AI-MODELS.md) §2.3 |
| `IMG_AI_DEVICE` | `cpu` | `cuda` on a GPU host |
| `IMG_AI_WARMUP` | `true` | one 64×64 inference at boot; makes the first user job honest |
| `MODEL_CACHE_NAME` | `ri-models-v1` | Cache API bucket in the browser |

### 2.7 Security and abuse

| Var | Default | Notes |
|---|---|---|
| `SESSION_SECRET` | — (required) | 32 bytes; signs the session id cookie |
| `COOKIE_DOMAIN` | unset | host-only by default |
| `ADMIN_OPS_TOKEN` | unset | unset ⇒ routes not mounted |
| `CORS_ALLOWED_ORIGINS` | `APP_ORIGIN` | list, exact match, no wildcards |
| `MAX_BODY_BYTES` | `26214400` | enforced by Caddy, then by the API |
| `TRUST_PROXY` | `true` | Caddy sets `X-Forwarded-For`; anything else must be false |
| `DISABLE_STACK_TRACES` | `true` in prod | a stack trace in an error body is an information leak |

### 2.8 Observability

| Var | Default | Notes |
|---|---|---|
| `METRICS_ENABLED` | `true` | `/metrics` (Prometheus text) on the API's internal port |
| `METRICS_PORT` | `9464` | not exposed through Caddy |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | traces are optional; unset means none, never a silent drop |
| `SLOW_JOB_MS` | `30000` | a job above this logs a warning with metrics, no user data |
| `LOG_PIXELS` | `false` | logs byte counts and dimensions, never a filename or a data URL |

---

## 3. `.env.example` (excerpt)

```dotenv
# ── core ────────────────────────────────────────────────────────────────
NODE_ENV=development
APP_ORIGIN=http://localhost:4400
API_PORT=4401
API_BASE_PATH=/api/v1
LOG_LEVEL=debug

# ── web (build-time, public) ────────────────────────────────────────────
NEXT_PUBLIC_API_BASE_URL=http://localhost:4401/api/v1
NEXT_PUBLIC_LANE_B=true

# ── server lane ─────────────────────────────────────────────────────────
SERVER_LANE_ENABLED=true
TEMP_DIR=/tmp/rumindium-image
SERVER_MAX_FILE_BYTES=26214400
SERVER_MAX_PIXELS=30000000
JOB_TTL_MINUTES=15
MIN_FREE_DISK_BYTES=5368709120

# ── quota ───────────────────────────────────────────────────────────────
QUOTA_JOBS_PER_DAY=200
QUOTA_BYTES_PER_DAY=524288000
CONSENT_VERSION=2026-11-01

# ── infra ───────────────────────────────────────────────────────────────
DATABASE_URL=postgres://rumindium:rumindium@localhost:5432/rumindium_image
REDIS_URL=redis://localhost:6379
SESSION_SECRET=dev-only-not-a-real-secret-change-me

# ── ai ──────────────────────────────────────────────────────────────────
MODEL_DIR=./models
MODEL_MANIFEST_PATH=packages/contracts/model-manifest.json
ALLOW_NONCOMMERCIAL_MODELS=false
ENABLE_IMGLY_ADAPTER=false
IMG_AI_DEVICE=cpu
```

`SESSION_SECRET` in the example is obviously fake on purpose: a plausible-looking placeholder gets copied to
production. The API refuses any secret shorter than 32 characters and logs exactly one warning naming it.

---

## 4. Browser-side constants

Some values are not deploy configuration but product constants, compiled into the client and therefore documented
here rather than discovered in a file:

| Constant | Value | Where |
|---|---|---|
| `MAX_PIXELS` (desktop) | `40_000_000` | `image-browser/src/limits.ts` |
| `MAX_PIXELS` (mobile / ≤ 4 GB) | `16_000_000` | same |
| `MAX_FILE_BYTES` | `104_857_600` (100 MB) | same |
| `MAX_BATCH_FILES` | `200` | same |
| `MAX_BATCH_BYTES` | `1_610_612_736` (1.5 GB) | same |
| `MAX_LIVE_BYTES` | 512 / 320 / 192 MB by device class | [pipeline](0-PROCESSING-PIPELINE.md) §6.3 |
| `PREVIEW_MAX_SIDE` | `2048` | `raster.ts` |
| `PROGRESS_MIN_INTERVAL_MS` | `100` | runner |
| `WORKER_IDLE_TIMEOUT_MS` | `60_000` classical, `300_000` AI | pool |
| `DOWNLOAD_MAX_AGE_MS` | `0` (never cached) | exporter |
| `ZIP_STORE_ABOVE_BYTES` | `268_435_456` (256 MB) | exporter — store-only past this size |

These are constants, not configuration, because changing them changes what the product *means* ("supports 40 MP
photos"), and a deployment should not be able to redefine a claim silently. A self-hoster who edits them gets a
warning at build time from `scripts/ci/limits.ts`, which prints every overridden constant for the release notes.

---

## 5. Per-tool limits

The registry carries limits per tool; these are the values it must use. A tool may be *stricter*, never looser.

| Tool | maxFiles | maxPixels | Extra |
|---|---|---|---|
| `convert` | 200 | 40 MP | output format must be encodable, else the control is disabled |
| `compress` | 200 | 40 MP | target search capped at 6 encodes |
| `resize` | 200 | 40 MP | output pixels ≤ 64 MP even when upscaling is allowed |
| `crop` | 1 | 40 MP | min 8 × 8 output |
| `rotate-flip` | 200 | 40 MP | — |
| `adjust` | 200 | 40 MP | CPU pass; admitted only if the budget allows a full read |
| `filter` | 200 | 40 MP | convolution; 32 MP above 4 GB is refused with a reason |
| `bg-remove` | 20 local / 20 server | 40 MP local / 30 MP server | server also caps 25 MB/file |
| `bg-replace` | 20 | 40 MP | one background image ≤ 40 MP |
| `enhance` | 50 | 40 MP | AI denoise is opt-in per file |
| `upscale` | 1 | 12 MP (server) | 4× output cap 192 MP |
| `base64` | 20 | 40 MP | encoded text hard cap 40 MB |
| `analyze` | 50 | 40 MP | sampled at 512 px, labelled in the report |
| `metadata` | 50 | — | reads the original bytes; no decode |
| `metadata-clean` | 200 | 40 MP | — |
| `palette` | 50 | 40 MP | samples at 256 px |
| `pixel-pick` | 1 | 40 MP | zoom 1×–32× |
| `social-resize` | 100 | 40 MP | output from the preset table |
| `batch` | 200 | inherited | 1.5 GB total |
| `export` | 200 | — | ZIP store-only above 256 MB |

The two entries that say "sampled" are the honest ones: a transparency-coverage claim computed from a 512 px
sample is accurate for the *sample*, and the report prints `sampledAt` so nobody reads it as a full-resolution
count.

---

## 6. Quality defaults

| Format | Default quality | Range | Notes |
|---|---|---|---|
| JPEG | 82 | 40–95 in the UI | below 40 the UI warns about visible blocking |
| WebP | 80 | 30–95 | best size/quality trade at 80 for photos, 90 for UI screenshots |
| AVIF | 60 | 20–90 | AVIF at 60 ≈ JPEG at 82 at ~55 % of the bytes, when the encoder is good |
| PNG | — | — | no quality knob; `compress` reaches PNG only via palette reduction, which is *not* offered in the MVP |
| BMP | — | — | uncompressed by definition |

`compress` in `quality` mode applies the format's default when `quality` is absent; in `target` mode it ignores
the caller's quality and searches.

---

## 7. Per-environment overrides

| Var | dev | test | preview | prod |
|---|---|---|---|---|
| `SERVER_LANE_ENABLED` | `true` | `true` | `true` | per deployment |
| `LOG_LEVEL` | `debug` | `error` | `info` | `info` |
| `JOB_TTL_MINUTES` | `30` | `5` | `15` | `15` |
| `QUOTA_JOBS_PER_DAY` | `1000` | `10000` | `200` | `200` |
| `SWEEP_INTERVAL_SECONDS` | `10` | `1` | `60` | `60` |
| `MODEL_DIR` | `./models` | `./models` | mounted | mounted |
| `ALLOW_NONCOMMERCIAL_MODELS` | `false` | `false` | `false` | **must be false** |

Test overrides exist so the sweeper and the TTL can be exercised in seconds rather than in fifteen minutes. They
are not a separate code path: the same function reads a smaller number.

---

## 8. Secrets

| Secret | Where it lives | Never |
|---|---|---|
| `SESSION_SECRET` | deployment secret store / `.env` (git-ignored) | in the repo, in a log, in an image layer |
| `ADMIN_OPS_TOKEN` | same | printed by `/health`, echoed in an error |
| `DATABASE_URL` | same | sent to the client |
| model files | image build or mounted volume | fetched from a third-party URL at request time |

Checks:

- `bun run secrets:check` greps the build output for `session_secret`, bearer patterns and `postgres://` — and
  fails the build if any appear in `.next/static` or in the API bundle.
- The API's error handler scrubs `password=`, `token=`, `secret=` and any `Authorization` value before logging.
- `.env` is git-ignored and `.env.example` contains only the fake values above. A commit that adds a real value to
  `.env.example` is caught by a pattern check, because that file is the one people paste from.

---

## Related docs

- [`0-API.md`](0-API.md) §8 — the limits in §2.4 as the client sees them
- [`0-FILE-STORAGE.md`](0-FILE-STORAGE.md) — `TEMP_DIR`, TTL and the sweeper
- [`0-BATCH-AND-QUEUE.md`](0-BATCH-AND-QUEUE.md) — queue names, timeouts, retries
- [`0-AI-MODELS.md`](0-AI-MODELS.md) §2 — the flags in §2.6 and what they license
