# 0 — E2E Checklist

> What "done" means for each tool, and the command that proves it. One pass per tool, in order, before it is
> called shipped.
> Last updated: 16 November 2026

---

## 1. How to run a pass

```text
bun run dev                       # web :4400, api :4401
bun run fixtures                  # deterministic fixtures into e2e/fixtures/generated
bun run e2e:tool -- --tool <id>   # one tool's suite, real browser, real files
bun run test:pixels               # geometry/colour/alpha assertions
bun run test:memory               # bitmap + URL leak check
bun run doc:parity                # registry ↔ README ↔ tool doc
```

Each section below is a **pass**, not a wish: every line is a command or an assertion that exists. When a line
cannot pass, it is recorded in the tool's doc under "known behaviour" and in the `@known` tag list — never deleted
quietly ([0-TESTING](0-TESTING.md) §9).

A pass is recorded at the bottom in §21 with the date, the browser(s) and the outcome.

---

## 2. The universal 12 (every tool)

These apply to all twenty tools and are asserted by a parametrised suite, so no tool doc repeats them.

```text
[ ] 1  accepts its documented formats and refuses others with UNSUPPORTED_FILE_TYPE naming the detected type
[ ] 2  refuses an animated input with ANIMATED_NOT_SUPPORTED (no silent first-frame flatten)
[ ] 3  refuses a corrupt file with CORRUPT_IMAGE and leaves no RUNNING row
[ ] 4  refuses above the device pixel ceiling BEFORE decode, naming the dimensions and the limit
[ ] 5  `schema.parse(defaults)` succeeds; an unknown option key is rejected
[ ] 6  progress is monotonic and ends at 100 % on success
[ ] 7  cancel releases memory and leaves the row CANCELLED with no output
[ ] 8  a lane A job issues zero requests carrying image bytes (privacy test)
[ ] 9  the output is downloadable, named per the naming rules, and decodes to the reported dimensions
[ ] 10 input blob is unchanged after the run (hash before == hash after)
[ ] 11 the row states its lane badge; a lane B row states the 15-minute retention
[ ] 12 works at 390 / 768 / 1440 px with the Run control reachable
```

---

## 3. `convert`

```text
bun run e2e:tool -- --tool convert        (8 cases)

[ ] JPG → PNG, PNG → WebP, WebP → JPEG, PNG → AVIF (probe-dependent)
[ ] dimensions unchanged for all four conversions
[ ] JPEG output of a transparent PNG is flattened onto the chosen background (corner pixel exact)
[ ] WebP output of a transparent PNG keeps alpha (alpha coverage matches within 1 %)
[ ] quality affects bytes monotonically-ish: q40 < q82 < q95 for the same input
[ ] AVIF requested on an encoder-less browser → control disabled with a reason, or ENCODE_UNSUPPORTED (never a
    PNG blob named .avif); on a capable browser the actual type is image/avif
[ ] custom name "holiday photo.jpg" → "holiday photo.webp"; a name with "/" is refused by the schema
[ ] 5 files at once → 5 outputs, ZIP contains 5 entries with unique names
```

---

## 4. `compress`

```text
bun run e2e:tool -- --tool compress       (9 cases)

[ ] quality mode: 4.5 MB JPEG at q60 → smaller than at q90; both decode
[ ] target mode: target 300 KB on a 4.5 MB photo → output ≤ 300 KB, ≥ 1 attempt logged per search step
[ ] target unreachable at q1 → TARGET_SIZE_UNREACHABLE with the smallest achievable size, no silent resize
[ ] before/after comparison renders both images at the same zoom
[ ] reduction percentage matches (1 - out/in) within 0.1
[ ] maxWidth honoured; dimensions reported in the result card
[ ] stripMetadata default removes EXIF (re-parsed output has no GPS tag)
[ ] 6 encodes maximum per target search (instrumented counter)
[ ] PNG input to JPEG output with alpha → flattened, no black fringe at the edge
```

---

## 5. `resize`

```text
bun run e2e:tool -- --tool resize         (10 cases)

[ ] width only → height derived, aspect within 1 px
[ ] height only → width derived
[ ] both, lockAspect → the box is fit, not distorted (no stretched marker)
[ ] percentage 50 % on 1200×900 → 600×450 exact
[ ] fit / fill / stretch / contain / cover each produce the documented dimensions
[ ] fill crops the overflow, centred, background visible on the padded side
[ ] upscale refused with allowUpscale:false (VALIDATION_ERROR naming the target)
[ ] halving path used for a 4000→400 downscale (plan spy), edge line does not disappear
[ ] nearest filter preserves hard pixel edges on a pixel-art fixture (no grey blending)
[ ] 12 targets × 3 fit modes in one run → no bitmap leak (open == close)
```

---

## 6. `crop`, `rotate-flip`, `adjust`, `filter`

```text
bun run e2e:tool -- --tool edit           (14 cases)

crop
[ ] free crop copies exact source pixels at (x,y) and (x+w-1, y+h-1)
[ ] 1:1 / 4:3 / 16:9 lock the box and clamp at the image edge
[ ] crop after rotate 90 uses rotated coordinates (the board agrees with the output)
[ ] roundCorners produces transparent corners on PNG and background-coloured corners on JPEG
[ ] arrow keys move the box 1 px, Shift+arrow 10 px, box stays inside the image

rotate / flip
[ ] 90/180/270 map corners correctly (marker fixture: top-left ← expected corner)
[ ] flip H then flip V equals rotate 180 (pixel-identical)
[ ] rotate then export preserves EXIF orientation applied exactly once (not twice)

adjust
[ ] each of the eight controls at +50 / -50 changes only what it should (saturation leaves luminance ~equal)
[ ] reset returns to the original within ΔE 1.0
[ ] undo/redo restores intermediate states (history of 10 steps)
[ ] gamma 0.2 and 3.0 stay in range and do not clip to black/white prematurely

filter
[ ] all nine presets render; sepia and mono are exact per the reference LUT
[ ] blur radius 5 does not shift the image (centroid stable)
[ ] invert is exact 255-v per channel
[ ] compare-hold shows the original, release shows the edited state
```

---

## 7. `bg-remove`

```text
bun run e2e:tool -- --tool bg-remove      (10 cases)

[ ] model download shows progress, completes, and is cached on the second run (no second network transfer)
[ ] portrait fixture: IoU ≥ 0.97 against the hand mask; soft band ≤ 2 % of pixels
[ ] the matte is applied to the original, not to a resized copy (dimensions equal the input)
[ ] output PNG has alpha; output WebP has alpha; output "JPEG with background" is opaque
[ ] refine none / fast / quality produce increasing edge quality (soft-band width decreases)
[ ] erase + restore strokes change only the painted region (mask edit replay)
[ ] inverted-matte heuristic fixes a bright-subject fixture and emits ALPHA_INVERTED
[ ] no-subject fixture (blank wall) → INFERENCE_FAILED "No subject was found", not an empty PNG sold as success
[ ] 4 GB device class → u2netp-lite chosen, time under the harness gate
[ ] server lane on the same input: matte within ΔE ≤ 1.0 of the browser matte
[ ] the consent dialog appears before any upload; declining leaves the job local
```

---

## 8. `bg-replace`

```text
bun run e2e:tool -- --tool bg-replace     (9 cases)

[ ] transparent: checkerboard in the preview, real alpha in the export (preview pixels are not in the file)
[ ] colour: exact hex at a corner pixel; HEX/RGB inputs agree
[ ] gradient: 3 stops, angle 135°, corner colours match the stops within ΔE 2
[ ] image background: cover/contain/stretch place the background as expected; blur 40 is visibly blurred
[ ] shadow: appears behind the subject only, not over it (subject centre pixel unchanged)
[ ] outline: 2 px, drawn outside the matte, colour exact
[ ] layer visibility toggles do not change the matte data
[ ] reset position restores offsetX/Y/scale to 0/0/1
[ ] export at 2× the source is refused (no silent upscale)
```

---

## 9. `enhance`

```text
bun run e2e:tool -- --tool enhance        (7 cases)

[ ] underexposed fixture: mean luminance rises, no channel clips above 250 in more than 2 % of pixels
[ ] auto contrast widens the histogram without changing hue (ΔH ≤ 3°)
[ ] sharpen strength 0 is a no-op (pixel-identical); strength 100 raises local contrast on the edge fixture
[ ] classical denoise reduces noise σ on a synthetic noisy fixture without blurring the marker edges past 2 px
[ ] AI denoise is off by default; enabling it shows the model download card first
[ ] compare slider shows the original on the left, processed on the right
[ ] the result card states which operations ran (no hidden AI)
```

---

## 10. Utilities and colour

```text
bun run e2e:tool -- --tool utilities,color (11 cases)

base64
[ ] encode → text starts with "data:image/png;base64," and decodes back to identical bytes
[ ] decode a bare base64 string (no prefix) with the MIME guessed from magic bytes
[ ] invalid base64 → VALIDATION_ERROR mentioning the character position
[ ] copy button puts the exact string on the clipboard
[ ] a 30 MB encoded string is refused with a size message, not a frozen tab

analyze
[ ] dimensions, aspect ratio, orientation, MIME, extension, file size all match the fixture
[ ] alpha detected on the alpha fixture, reported "no" on the opaque one
[ ] DPI reported when present, "not available" (not 72) when absent
[ ] sampled transparency scan says "sampled at 512 px" in the report

pixel-pick
[ ] click at a known coordinate returns the exact HEX/RGB of the grid fixture
[ ] HSL conversion matches the reference implementation within 1 unit
[ ] loupe zoom 1×–32× shows nearest-neighbour pixels at high zoom
[ ] copying a colour adds it to a session history (max 10)

palette
[ ] 3/5/8/10 swatches produce that many distinct colours on a 6-colour fixture
[ ] median-cut and k-means differ by ≤ ΔE 3 per swatch on the same input
[ ] proportions sum to 100 % (rounded, with the remainder assigned to the largest swatch)
[ ] CSS export is valid and pastes into a stylesheet; JSON export parses with hex + rgb + hsl
[ ] sort by hue is ordered; sort by dominance is descending by share
```

---

## 11. `metadata` and `metadata-clean`

```text
bun run e2e:tool -- --tool metadata       (9 cases)

[ ] camera make/model, lens, ISO, shutter, aperture, date read from the EXIF fixture
[ ] GPS tags shown with a warning chip; coordinates never sent anywhere
[ ] orientation shown as a value AND reflected in the preview
[ ] DPI and colour profile presence reported
[ ] "Remove GPS only" strips GPS, keeps the camera tags (re-parsed)
[ ] "Remove all" strips every tag the browser can write (re-parsed output is empty of EXIF)
[ ] keep-allowed with ["Orientation","ColorSpace"] preserves exactly those
[ ] exporting an image that still has GPS shows the pre-export warning
[ ] batch clean over 5 files removes GPS from all 5 (each re-parsed)
```

---

## 12. `social-resize`

```text
bun run e2e:tool -- --tool social-resize  (8 cases)

[ ] every preset in the catalog produces exactly its documented dimensions
[ ] cover fit crops rather than distorts (marker fixture: no stretch)
[ ] safeZone overlay draws guides in the preview and is absent from the export (pixel check at the guide line)
[ ] Instagram Story 1080×1920 from a 4032×3024 photo is centred on the subject (focal point default = centre)
[ ] custom preset with a name is stored for the session and selectable again
[ ] a catalog fetch failure falls back to the bundled preset list (the tool still works offline)
[ ] preset dimensions are integers and even where the platform documents even sizes
[ ] batch 6 files × 3 presets → 18 outputs, unique names
```

---

## 13. `batch`

```text
bun run e2e:tool -- --tool batch          (11 cases)

[ ] 20 files convert in one pass; the tab stays interactive (a click during the run registers < 100 ms)
[ ] rows show queued / running / done / failed with per-row progress
[ ] one corrupt file fails alone; the other 19 complete
[ ] stopOnError stops after the first failure and says "stopped after 3 of 20"
[ ] cancel-all at row 10 → 9 done, 10 cancelled, memory drops back to baseline
[ ] a 200-file run leaks no bitmap (open == close) and no object URL
[ ] ZIP contains exactly the completed results, names de-duplicated
[ ] per-row download works for a single result
[ ] shared options apply to all rows; a resize preset override applies to one row only
[ ] switching to lane B mid-queue is refused with a reason (one lane per queue)
[ ] a 100 MB file in a 1.5 GB batch is admitted; a 101 MB file is refused per row
```

---

## 14. `export`

```text
bun run e2e:tool -- --tool export         (8 cases)

[ ] single download uses the naming rules and the actual output MIME/extension
[ ] ZIP of 30 results is streamed (progress shown) and every entry decodes
[ ] duplicate names become "photo.webp", "photo (2).webp" — no overwrite in the archive
[ ] a name with "../" exports as a flat sanitised name; the archive has no path separator
[ ] format override re-encodes and renames consistently
[ ] stripMetadata default removes EXIF on export
[ ] a 1.2 GB batch offers ZIP (store-only) and warns about size before starting
[ ] export failure (quota / disk) shows a sentence and keeps results in the queue
```

---

## 15. Cross-tool flows

```text
bun run e2e:tool -- --tool flows          (10 cases)

[ ] remove background → edit (crop) → export PNG keeps the alpha at the cropped edge
[ ] compress → palette shows the compressed file's colours (result is the input, not the original)
[ ] resize → social-resize uses the resized result without touching disk
[ ] convert → metadata shows no EXIF when the convert stripped it
[ ] batch of resize → ZIP → open the ZIP's first entry in the metadata tool (round trip)
[ ] switching tool with an unsaved edited image asks once, then keeps the edit in memory
[ ] reloading the page drops lane A results (with a warning before unload if a queue is running)
[ ] a lane B result downloaded, then re-opened in a lane A tool works (blob from fetch)
[ ] two tabs open: each has an independent queue (no shared store via storage events)
[ ] the index → tool chooser keeps the dropped files (no re-upload request)
```

---

## 16. Failure and recovery

```text
[ ] worker crash mid-job → row FAILED, other rows continue, no orphan progress
[ ] 40 MP on a 16 MP device class → refused with the exact limit and a lane B offer
[ ] GPU device lost during inference → automatic WASM retry (or a clear failure, no hang)
[ ] model cache cleared mid-session → re-download prompt, not a silent failure
[ ] API 503 during a lane B submit → QUEUE_UNAVAILABLE sentence, lane A still works
[ ] offline (airplane mode) for a lane A job → completes normally
[ ] browser tab backgrounded during a long job → completion event still delivered on focus
[ ] clock change (manual) → TTL read from row, not from a client timer
```

---

## 17. Accessibility pass (per tool, once)

```text
[ ] tab order reaches every control and the canvas
[ ] focus ring visible on a dark and a light workspace
[ ] slider `aria-valuetext` reads "80 percent" / "1080 pixels"
[ ] status changes announced politely; an error announced assertively once
[ ] 200 % browser zoom keeps the Run button visible
[ ] reduced motion disables shimmer and sheet spring
[ ] crop and brush usable without a pointer (arrow keys, [ and ])
```

---

## 18. Perf gate (recorded, not asserted per run)

```bash
bun run test:load --op convert --sizes 12,40
bun run test:load --op compress --sizes 12,40
bun run test:load --op bg-remove --sizes 12
```

Compare with [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §8. A tool that exceeds its budget by 2× blocks
the release; the resolution (raise the budget or fix the op) is written in the tool doc.

---

## 19. The machine check — `doc:parity`

The checklist is not only prose. `scripts/ci/doc-parity.ts` reads:

```text
1. the registry            → ids, routes, execution kind, batch flag, limits, docs filename
2. README §3               → the tool matrix rows
3. every tool doc          → the front-matter block (id, lane, batch, phase, options count)
4. every error code in 0-API §7 → the code table
5. `@known` tags in e2e    → the "known behaviour" tables in the tool docs
```

and fails on: a tool in the registry without a README row, a README row whose lane disagrees with the registry, a
tool doc naming a different id, an error code used in code but absent from the table, or a `@known` tag with no
doc line. This is what keeps a 25-document set from decaying into fiction.

---

## 20. Sign-off format

Recorded in the release notes, one line per tool:

```text
convert      2026-11-20  chromium-132, firefox-133, webkit-18  PASS   8/8   0 known
compress     2026-11-20  chromium-132, firefox-133              PASS   9/9   1 known (avif q-curve varies)
bg-remove    2026-11-22  chromium-132 (webgpu), firefox-133 (wasm) PASS  10/10 0 known
```

A tool with no line is not shipped, whatever its checkboxes say.

---

## Related docs

- [`0-TESTING.md`](0-TESTING.md) — the suites these passes run
- [`0-TOOL-REGISTRY.md`](0-TOOL-REGISTRY.md) — the registry this checklist is checked against
- [`0-IMPLEMENTATION-PHASE.md`](0-IMPLEMENTATION-PHASE.md) — which tools belong to which phase
- Each tool doc, `01`–`13`, for the semantics behind a check
