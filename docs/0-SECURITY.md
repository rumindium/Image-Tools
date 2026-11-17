# 0 — Security

> A local-first image tool has a small attack surface and one large promise. This document is about keeping both.
> Last updated: 16 November 2026

---

## 1. Threat model

| Adversary | Capability | What they want |
|---|---|---|
| Malicious file | arbitrary bytes with an image extension | crash the decoder, exploit a codec, exfiltrate via a crafted SVG |
| Malicious client | direct API calls, crafted multipart bodies, huge dimensions | fill the disk, exhaust memory, skip quota |
| Curious third party | network position, browser storage | learn what the user processed |
| Compromised dependency | code in the bundle or the API | read pixels, beacon them out, hold a token |
| Operator mistake | a misconfigured deployment | expose admin routes, logs with filenames, a shared temp dir |

Not in scope: a compromised user device, a hostile browser extension with page access (nothing can defend a page
from an extension that reads its DOM), and server-side multi-tenancy (there is none).

---

## 2. The privacy claim, and how it is enforced

> "Your image never leaves this tab."

The claim is only true if three independent things hold. All three are enforced, and each has a test.

### 2.1 No code path from a lane A job to the network

- `local-runner.ts` statically imports only `image-browser` and the store; `server-runner.ts` is a **dynamic**
  import behind the consent action, and a boundary check forbids the static edge
  ([0-FOLDER-STRUCTURE](0-FOLDER-STRUCTURE.md) §6 rule 7).
- `packages/image-browser` contains no `fetch` to any host except the model cache; the model URLs come from the
  manifest, are `GET`-only, and never include a fragment of user data.
- The e2e privacy test runs a convert job with the network intercepted and **asserts no request body exceeds
  1 KB** and that no request URL contains `blob:`/`data:` content ([0-TESTING](0-TESTING.md) §6.2).

### 2.2 The browser cannot POST it anyway

```
Content-Security-Policy: connect-src 'self'; img-src 'self' blob: data:; form-action 'self'
```

A dependency that tried to beacon a data URL to `https://collector.example` would be blocked by the browser
before any code review could catch it. This is why the CSP is narrow, and why an analytics script is not "just
one line" — it would force a loosening of the one control that makes the promise structural.

### 2.3 Nothing is persisted

No IndexedDB, no Cache Storage entry for a user image, no `localStorage` blob, no service worker cache of a
result. The only caches are the model cache (`ri-models-v1`, bytes only) and the theme preference. A test asserts
that after a job and a reload, `caches.keys()` and `indexedDB.databases()` contain nothing new besides the model
cache.

---

## 3. Content Security Policy

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self';
  connect-src 'self';
  worker-src 'self' blob:;
  media-src 'none';
  object-src 'none';
  frame-src 'none';
  base-uri 'none';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests
```

| Directive | Why it is what it is |
|---|---|
| `'wasm-unsafe-eval'` | ONNX Runtime Web compiles WASM; this is the narrow permission, not `'unsafe-eval'` |
| `style-src 'unsafe-inline'` | Next injects critical CSS inline; the alternative is a nonce and a middleware on every request, which buys little for a page with no user-generated HTML |
| `worker-src 'self' blob:` | the worker is bundled; `blob:` is needed for the ORT proxy worker |
| `frame-src 'none'` | no embeds — also the reason COOP/COEP costs nothing ([pipeline](0-PROCESSING-PIPELINE.md) §7.2) |
| `object-src 'none'` | no Flash-era plugin surface |
| `img-src data:` | the preview of a decoded data URI is legitimate; a data URI *in an `<img>`* is not an exfiltration channel because CSP `connect-src` blocks the fetch that would build a huge one |

`frame-ancestors 'none'` (not `'self'`) — clickjacking a file picker is a real attack, and nothing legitimately
frames this app.

---

## 4. File handling

### 4.1 Lane A

The browser decodes untrusted bytes, which is a browser vendor's problem and not something this product can fix —
but three choices still matter:

1. **Never `innerHTML` an SVG.** SVG inputs are rasterised via `createImageBitmap(Blob)` into a canvas; the SVG
   document is never inserted into the DOM, so its `<script>` and event handlers never run.
2. **Never render an uploaded image in an `<img src=blob:>` on a page with a same-origin document** without a
   canvas round-trip for SVG specifically — a rasterised canvas has no scripting.
3. **Bound the dimensions before decode.** A 100 000 × 100 000 PNG header is a decompression bomb; the sniffer
   reads dimensions first and refuses ([pipeline](0-PROCESSING-PIPELINE.md) §2).

### 4.2 Lane B

| Control | Implementation |
|---|---|
| Body limit | Caddy `request_body max_size 26MB`, then Elysia's own limit (belt and braces: a misrouted request must still be bounded) |
| Filename | never used as a path. Stored as `${TEMP_DIR}/{fileId}/original`; the response carries `fileId` only |
| Directory | `0700`, files `0600`, owner = service user; one directory per file, deleted recursively |
| Magic bytes | validated before the file is written; a mismatch is rejected **without** creating the directory |
| EXIF | passed through to the worker but never logged; a GPS coordinate in a log line is a privacy incident |
| Decompression bombs | `SERVER_MAX_PIXELS` enforced from the header, before decode; the worker re-checks after decode |
| Polyglot files | a valid JPEG with an appended ZIP is stored and decoded as JPEG; it is never executed, and the ZIP is dropped by re-encoding |
| Download name | generated by `image-core/naming` from the sanitised base name + tool suffix; `Content-Disposition` ASCII-sanitised plus RFC 5987 |

The download is served with `X-Content-Type-Options: nosniff` and a `Content-Type` **from the artifact's actual
encoder output**, not from the user's requested format. A file that is really PNG cannot be served as `image/svg+xml`,
which is the only header combination that matters here.

---

## 5. Request security

| Concern | Control |
|---|---|
| CSRF | session cookie `SameSite=Lax` + `Origin` must equal `APP_ORIGIN` for `POST/PUT/DELETE`; a missing `Origin` is refused (not treated as same-origin) |
| SSRF | no endpoint takes a URL. Clipboard paste of a URL does not fetch it |
| Path traversal | no user string reaches a filesystem call; `fileId` is a UUID validated by regex before use |
| Zip-slip (download) | ZIP entries are generated from sanitised names; `..` and absolute paths are impossible by construction ([13](13-EXPORT-MANAGER.md) §5) |
| Header injection | every response header value is a constant or a sanitised token; no user string is interpolated into a header |
| Prototype pollution | zod strict objects; `Object.create(null)` for the option merge; `__proto__` is rejected by the key allowlist |
| JSON bombs | body limit + depth limit (`< 8`) on `POST /jobs` options |
| Timing | session lookup is a constant-time compare on a hash; job ids are UUIDv7, unguessable enough that enumeration is not a concern, but ownership is still checked |

Ownership is checked **for every job and file read**, in one place (`assertOwned(sessionId, jobId)`), because a
check that exists in three endpoints and not the fourth is the classic way this breaks. Another session's id
returns 404, not 403: existence is not disclosed.

---

## 6. Rate limiting and abuse

| Layer | Limit | Purpose |
|---|---|---|
| Caddy | 60 req/s per IP | crude flood protection |
| API token buckets | §8 of [0-API](0-API.md) | per-session fairness |
| Quota | 200 jobs/day, 500 MB/day | cost containment |
| Upload slots | 30 burst, 60/min refill | staging a legitimate 50-file job is possible; the 61st file is refused |
| Concurrent SSE | 10 per session | each connection is a server-side file descriptor |
| Disk guard | refuse new jobs below 5 GB free | a full disk corrupts output instead of failing cleanly |

There is no CAPTCHA and no account requirement. The server lane is a convenience, so abuse degrades it without
degrading the product: when the quota is exhausted, lane A is untouched and still says "processed in this tab".

---

## 7. Consent record

Server processing is a data transfer, and the product treats it like one:

```json
{ "acceptedAt": "2026-11-16T10:31:02.331Z", "version": "2026-11-01" }
```

- The dialog states: what is sent (the image), where it goes (this deployment), how long it is kept (15 minutes),
  and what is stored (counts, not the picture).
- The version is compared to `CONSENT_VERSION`; a stale version is refused, so changing the retention policy
  cannot silently apply to consents given under the old one.
- The consent is stored on the job row (`consent_version`, `consented_at`) — the only audit trail, and it contains
  no personal data beyond a timestamp.
- Withdrawing consent is not a feature, because there is nothing to withdraw: the image is deleted at TTL, and the
  next job asks again.

---

## 8. Secrets and dependencies

| Control | Implementation |
|---|---|
| Secrets | environment only; `secrets:check` greps build output for token patterns; no secret has a default |
| Dependency pinning | exact versions in `bun.lock`, reviewed on update; no `^` drift in app code |
| Supply chain | `bun audit` in CI; a new dependency needs a justification line in the PR (what it replaces, its size, its license) |
| Model supply chain | manifest with sha256; the browser verifies the hash on cache read, the API refuses a model not in the manifest |
| Unmaintained packages | a package with no release in 24 months needs an ADR to be added |
| Postinstall scripts | `--ignore-scripts` in CI install; native deps are allowlisted explicitly |

`@imgly/background-removal` is the one dependency with a license that changes the product's obligations; it is
opt-in and absent from the default bundle ([0-AI-MODELS](0-AI-MODELS.md) §2.3).

---

## 9. AI-specific risks

| Risk | Control |
|---|---|
| Model file substituted | sha256 in the manifest, verified on read; a mismatch deletes the cache entry and re-fetches |
| Model from an untrusted URL | URLs are in the manifest, not in an option; the CSP `connect-src 'self'` blocks any other host |
| Model license violation | build gate (`model:licenses`), runtime `MODEL_UNLICENSED` |
| Prompt/EXIF injection | there is no prompt; metadata is not read by the AI path, only by the metadata tool |
| Output that misrepresents | the UI labels AI and says "adds detail that was not in the original" for upscaling; no face "restoration" claims |
| Denial of service via huge inference | pixel cap before inference; server worker timeout and memory limit |
| GPU side channel | not addressed: WebGPU is the user's own device, and there is no cross-user GPU sharing |

---

## 10. Logging

| Field | Logged? | Why |
|---|---|---|
| `requestId`, route, status, duration | ✓ | diagnosis |
| `toolId`, `lane`, `jobId` | ✓ | the shape of load, no content |
| bytes in/out, pixels, stage timings | ✓ | performance |
| file name | **✗** | it is user content ("passport-scan.jpg") |
| EXIF, GPS, camera | **✗** | a location in a log is a privacy incident |
| image bytes, data URLs, base64 | **✗** | obvious |
| session id | hashed, first 8 chars | correlation without a token in the log |

The logger is constructed with a field allowlist, not a redaction pass: a new field is denied until someone adds
it deliberately. Redaction fails open; an allowlist fails closed.

---

## 11. Verification checklist

```text
[ ] lane A job produces zero requests carrying image bytes            (e2e privacy, network interception)
[ ] CSP blocks a fetch to an external host in a dev build              (e2e csp-block)
[ ] SVG input with <script> renders as pixels and never executes       (e2e svg-script, console assertion)
[ ] 12000×12000 PNG header refused before decode                       (unit sniff-bomb)
[ ] 26 MB upload refused by Caddy and by the API                       (integration body-limit)
[ ] `..%2f` fileId, `__proto__` option key, 2 MB option string         (integration fuzz)
[ ] foreign Origin on POST /jobs → 403                                 (integration cors)
[ ] other session's job id → 404                                       (integration isolation)
[ ] admin routes absent without a token                                (integration admin-absent)
[ ] expired job download → 410, file gone from disk                    (integration ttl)
[ ] build output contains no secret pattern                            (ci secrets:check)
[ ] AGPL adapter absent from the default bundle                        (ci bundle-license)
[ ] model manifest hash verified before inference                      (unit manifest-hash)
```

Every line is a test, not an intention. A security checklist that is not executable is a wish.

---

## Related docs

- [`0-API.md`](0-API.md) §10 — the headers in the response, verbatim
- [`0-FILE-STORAGE.md`](0-FILE-STORAGE.md) — permissions, TTL, atomic writes
- [`0-AI-MODELS.md`](0-AI-MODELS.md) §2 — the license gate
- [`0-TESTING.md`](0-TESTING.md) §6 — the tests above
