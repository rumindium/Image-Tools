# 0 — Testing

> An image tool cannot prove its output byte-for-byte, because every browser's encoder differs. It can prove
> dimensions, alpha coverage, colour within a tolerance, and — most importantly — that no pixels left the tab.
> Last updated: 16 November 2026

---

## 1. What "tested" means for a browser image pipeline

| Claim | Provable how | Not provable |
|---|---|---|
| dimensions and aspect | exact integers | — |
| crop region | pixel sampling at known coordinates | — |
| rotation and flip | pixel sampling, orientation fixture with an asymmetric marker | — |
| colour adjustment | ΔE2000 against a reference implementation in `image-core` | exact RGB after a browser's colour management |
| file size | range assertion (encoder version, quality curve) | exact bytes |
| alpha | coverage ratio + edge band width | exact matte values |
| no upload | network interception: zero requests carrying bytes | — |
| memory not leaked | bitmap open/close counter + `performance.memory` trend | OS-level RSS |
| AI quality | fixture set with expected matte IoU ≥ threshold | "looks good" |

Two consequences shape the whole suite:

1. **Byte hashes of encoded output are forbidden as assertions.** A WebP q80 from Chrome 132 and Chrome 140
   differ. A suite built on hashes breaks on every browser update and gets deleted within a month — the classic
   way image projects lose their tests.
2. **Reference pixels come from `image-core`, not from the browser.** The math is pure, so the expected crop
   rectangle, the expected resize dimensions and the expected LUT output are computed by the same package the app
   uses — and separately re-derived by a small independent implementation in the test for the three most
   error-prone functions (§5.4).

---

## 2. The pyramid

```text
                    ┌──────────────────────────┐
                    │ E2E (Playwright)         │  20 tools × 3–6 cases
                    │ real browser, real files │  ~90 cases, 6 browser profiles
                    └────────────┬─────────────┘
              ┌──────────────────┴───────────────────┐
              │ Integration (Bun + Playwright)       │  API routes, SSE, sweep,
              │ API ↔ worker ↔ disk ↔ SSE            │  lane B end to end, quota
              └──────────────────┬───────────────────┘
        ┌────────────────────────┴────────────────────────┐
        │ Worker/unit (Bun + Vitest browser mode)        │  transforms in a real
        │ pure math, schemas, ops in a headless browser   │  OffscreenCanvas, no UI
        └────────────────────────┬───────────────────────┘
   ┌─────────────────────────────┴──────────────────────────────┐
   │ Contract (Bun, no DOM)                                     │  every tool: parse,
   │ schemas, registry, naming, zip manifest, size search       │  defaults, errors
   └────────────────────────────────────────────────────────────┘
```

The unusual layer is "worker/unit in browser mode": a crop is a five-line `drawImage` call, but its *correctness*
depends on how a real browser handles EXIF orientation, premultiplied alpha and `drawImage` rounding. Testing that
in Node with a canvas shim tests the shim. `vitest --browser` (Chromium, WebKit, Firefox) runs the op against a
real canvas and asserts the pixels.

---

## 3. Fixtures

Generated, committed only when generation is non-deterministic (photos).

```text
e2e/fixtures/
├── generated/                     created by scripts/dev/make-fixtures.ts at test time
│   ├── grid-800x600.png           8×6 colour grid — proves crop/rotate geometry exactly
│   ├── marker-1200x900.jpg        asymmetric corner marker — proves orientation and flip
│   ├── alpha-600x400.png          known 40 % transparent region — proves alpha handling
│   ├── exif-rotated-6.jpg         orientation tag 6, 300 DPI, ICC — Analyze tests
│   ├── metadata-exif.jpg          camera/capture/GPS/XMP/ICC — metadata viewer tests
│   ├── analyze-batch/             50 deterministic PNGs + manifest.json for the Analyze table
│   ├── gps.jpg                    GPS + camera tags — metadata tests
│   ├── progressive.jpg
│   ├── tiny-1x1.png  huge-header.png (12000×12000 header, 200 B body)
│   ├── animated.gif               refused, by design
│   ├── not-an-image.pdf
│   ├── corrupt-truncated.jpg
│   └── svg-script.svg             <script>alert(1)</script> inside — must never execute
└── photos/                        committed, CC0, for perceptual tests only
    ├── portrait-1024.jpg
    ├── product-white-1024.jpg
    └── landscape-2048.jpg
```

Synthetic fixtures are generated deterministically (seeded PRNG) so a pixel assertion is stable across machines.
Photos are used only where a synthetic image cannot answer the question — AI mattes, palette extraction, auto
levels — and their assertions are tolerances, never hashes.

---

## 4. Contract tests — every tool, automatically

One parametrised suite iterates the registry and asserts, for all 20 tools:

```text
schema.parse(defaults) succeeds
every option key has a describe()      (the UI needs the copy)
every capability referenced exists in the probe table
limits are within the global ceiling
estimateMs is finite and > 0 for 1 MP and 40 MP
docs file named in the registry exists
README §3 row matches the registry row            (doc:parity)
tool doc front-matter matches execution + batch   (doc:parity)
```

This is the suite that keeps a 20-tool product honest as it grows, and it is the cheapest one to run. It catches
the class of bug where the docs say a tool is hybrid and the code says browser.

---

## 5. Pixel assertions

### 5.1 Geometry (exact)

```ts
// crop
const rect = { x: 100, y: 50, width: 400, height: 300 };
const out = await crop(bitmap, rect);
expect([out.width, out.height]).toEqual([400, 300]);
expect(pixelAt(out, 0, 0)).toEqual(pixelAt(bitmap, 100, 50));      // exact, no resampling
expect(pixelAt(out, 399, 299)).toEqual(pixelAt(bitmap, 499, 349));

// rotate 90
expect(pixelAt(rotated, 0, 0)).toEqual(pixelAt(bitmap, 0, h - 1)); // top-left ← bottom-left
```

Exact equality is legitimate here: an integer crop and a 90° rotation copy bytes, they do not interpolate (and the
op uses `drawImage` with `imageSmoothingEnabled = false` for these paths, asserted by a test).

### 5.2 Colour (tolerance)

```ts
const expected = applyLut(referencePixels, lut);         // image-core, pure
const actual   = await adjust(bitmap, { brightness: 20, contrast: -10 });
expect(meanDeltaE2000(actual, expected)).toBeLessThanOrEqual(1.0);
expect(maxDeltaE2000(actual, expected)).toBeLessThanOrEqual(3.0);
```

ΔE2000 rather than per-channel `|Δ|` because a per-channel threshold of 2 is invisible in blue and obvious in
skin tones. The tolerance exists because canvas colour management may convert through a display profile even
with `colorSpaceConversion: 'default'`.

### 5.3 Resize

| Assertion | Kind |
|---|---|
| target dimensions for fit/fill/cover/contain, 12 cases | exact |
| aspect ratio preserved within 1 px | exact |
| upscale refused when `allowUpscale: false` | error code |
| halving path chosen when scale < 0.5 (spy on the op plan) | structural |
| downscaled edge fixture: no single-pixel line at the boundary (aliasing check) | perceptual |
| mean ΔE vs `sharp` reference on the same resize | ≤ 2.0 |

The aliasing check is a real test: a 1 px black line on white, downscaled 8×, must produce a grey band rather than
disappearing entirely in one row. Aliasing bugs in browser resizes are common and invisible in a thumbnail.

### 5.4 Alpha

```ts
const coverage = alphaCoverage(out);                     // pixels with a > 8/255
expect(coverage).toBeCloseTo(0.6, 2);                    // fixture is 40 % transparent
const edgeBand = pixelsBetween(out, 0.05, 0.95) / total; // soft edge width
expect(edgeBand).toBeLessThan(0.02);                     // ≤ 2 % of pixels are partially transparent
```

For `bg-remove`, alpha is compared against a hand-masked fixture with IoU:

```ts
expect(iou(alphaFromModel, alphaFromFixture)).toBeGreaterThanOrEqual(0.97);
```

IoU on the binarised matte at 0.5, plus the soft-band statistic — IoU alone hides a halo, and the halo is what
users complain about.

---

## 6. Security and privacy tests

### 6.1 CSP

`e2e/csp.e2e.ts` evaluates a `fetch('https://example.com/x.png')` from the page and asserts it is blocked with a
`securitypolicyviolation` event. This is the test that would fail if someone added an analytics script or a CDN
font — the two most common ways a private tool stops being private.

### 6.2 The privacy claim

```ts
// e2e/privacy.e2e.ts
await page.route('**/*', (route) => {
  const body = route.request().postDataBuffer();
  if (body && body.length > 1024) requestsWithBodies.push(route.request().url());
  return route.continue();
});
await runConvertJob(page, ['photo.jpg']);
expect(requestsWithBodies).toEqual([]);                    // zero bytes uploaded
expect(await page.evaluate(() => caches.keys())).toEqual(expect.not.arrayContaining(['user']));
```

A 1 KB threshold ignores the JSON option payload and catches any image. It is a blunt instrument on purpose: the
test should fail loudly for any upload-shaped request during a lane A job.

### 6.3 File handling

| Test | Asserts |
|---|---|
| `svg-script` | no `alert`, no console error from the SVG, output is pixels |
| `huge-header` | refused before allocation, message names the dimensions |
| `animated-refused` | `ANIMATED_NOT_SUPPORTED`, not a flattened first frame |
| `pdf-rejected` | `UNSUPPORTED_FILE_TYPE` naming the detected type |
| `zip-slip` | a file named `../../evil.png` exports as `evil.png` and the ZIP entry has no `..` |
| `api-forwarded-for` | a spoofed `X-Forwarded-For` does not reset the token bucket when `TRUST_PROXY=false` |

---

## 7. Integration tests

### 7.1 Lane B, one pass

```text
health/ready → laneB available
POST /files  → 201, dimensions match the fixture
POST /jobs   → 202, queue img-ai
GET /events  → monotonic pct, terminal done
GET /download→ bytes decode to the expected dimensions
GET /jobs/:id (after TTL) → EXPIRED, download → 410
```

### 7.2 Progress monotonicity

Consume the SSE stream and assert `pct[i] >= pct[i-1]` and that exactly one terminal event was emitted. Also run
the same assertion on a lane A job through the store's event log, because the two runners share the contract but
not the transport.

### 7.3 API down

```ts
await page.route('**/api/v1/**', (r) => r.abort());
await runConvertJob(page, ['photo.jpg']);
expect(status).toBe('DONE');            // lane A does not need the API
expect(page.locator('[data-lane-b]')).toBeDisabled();
```

This is the test that proves the architectural claim in [0-ARCHITECTURE](0-ARCHITECTURE.md) §2. Without it,
"the product works without a server" is a sentence in a document.

### 7.4 Sweeper and TTL

With `JOB_TTL_MINUTES=5` and `SWEEP_INTERVAL_SECONDS=1` in the test env: complete a job, assert the directory
exists, advance time (fake timers in the service test; a real 6 s wait in the integration test), assert the
directory is gone, the row is `EXPIRED` and the download is 410.

---

## 8. Performance harness

`bun run test:load` produces the numbers that [0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) §8 budgets
against. It is not a pass/fail gate on absolute times (a CI runner is not a laptop); it stores results and fails
on **regressions** against a baseline:

```text
per op: 12 MP and 40 MP fixtures, 5 runs, drop the first (JIT), report p50/p95
stores: e2e/artifacts/perf-<commit>.json
fails when: p50 > baseline × 1.5 for the same browser and machine class
```

The load test for lane B (`--lanes 8`, 40 files) reports queue wait p50/p95 and worker time p50/p95, mirroring the
shape used by the PDF service so the two projects' numbers are comparable.

---

## 9. Browser matrix

| Browser | Versions | Priority |
|---|---|---|
| Chrome desktop | current, current − 1 | full suite |
| Edge desktop | current | full suite |
| Firefox desktop | current, current − 1 | full suite, AI on WASM only |
| Safari desktop | 17, 18 | full suite minus AVIF encode assertions (probe-dependent) |
| Chrome Android | current | core suite (upload, convert, compress, resize, bg-remove) |
| Safari iOS | 17, 18 | core suite; memory ceiling lowered to 16 MP asserted |

`playwright.config.ts` runs Chromium, Firefox and WebKit; the mobile projects run the `@core` tag only. A test
whose failure is a known browser limitation is tagged `@known`, with the limitation in the tool doc — never
silently skipped. `grep -r "@known"` must return a set that matches the docs' "known behaviour" tables; a
mismatch fails `doc:parity`.

---

## 10. Falsification

Passing tests prove little unless they can fail. `scripts/ci/falsify.ts` mutates one line of source per claim and
runs the specific test that is supposed to catch it:

| Mutation | Test that must fail |
|---|---|
| remove `imageOrientation: 'from-image'` | `exif-rotated` |
| set `imageSmoothingEnabled = true` on the exact-copy path | `crop-exact` |
| skip `bitmap.close()` in the success path | `memory.open-close` |
| drop the `pct = max(prev, next)` clamp | `progress-monotonic` |
| return the PNG blob when AVIF was requested | `encode-fallback-warning` |
| remove the consent check in `POST /jobs` | `api-consent-required` |
| skip the magic-byte check | `pdf-rejected` |
| make the sweeper use `mtime` | `ttl-from-row` |

A mutation that leaves the suite green means the test is decorative. The script runs in CI nightly, not on every
push, because it rewrites source and takes minutes.

---

## 11. Coverage and gates

| Gate | Threshold |
|---|---|
| `image-core` line coverage | ≥ 90 % |
| `contracts` line coverage | ≥ 95 % (schemas are cheap to cover) |
| `apps/api` line coverage | ≥ 80 % |
| `image-browser` | ≥ 70 % — canvas paths are exercised through the browser suite, not unit tests |
| E2E | every tool id has ≥ 1 case; `doc:parity` fails otherwise |
| No test may be skipped without a `@known` tag and a doc line | enforced by a lint rule on `test.skip` |
| Flake budget | a test that fails twice in 20 runs is quarantined with an issue, not retried into oblivion |

---

## 12. Test data hygiene

- Fixtures contain no real person's photo, no real GPS coordinate, no real document.
- The AI fixture set is CC0 or generated; provenance is recorded in `e2e/fixtures/photos/SOURCES.md`.
- Generated artifacts (`e2e/artifacts/`) are git-ignored; a failing test's artifacts are uploaded in CI for 7 days.
- No test calls a third-party API. The model files are fetched once by `models:fetch` and cached in CI.

---

## Related docs

- [`0-E2E-CHECKLIST.md`](0-E2E-CHECKLIST.md) — the per-tool pass these suites implement
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §8 — the budgets the harness measures
- [`0-AI-MODELS.md`](0-AI-MODELS.md) §11 — AI quality gates
- [`0-SECURITY.md`](0-SECURITY.md) §11 — the security tests referenced above
