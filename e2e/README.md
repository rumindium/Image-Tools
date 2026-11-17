# E2E suites

Browser suites arrive with phase 1 (`docs/0-IMPLEMENTATION-PHASE.md`), one file per tool id, run with
Playwright over real files:

```text
e2e/convert.e2e.ts       e2e/compress.e2e.ts      e2e/edit.e2e.ts
e2e/resize.e2e.ts        e2e/background.e2e.ts    e2e/batch.e2e.ts
e2e/privacy.e2e.ts       e2e/csp.e2e.ts
e2e/fixtures/generated/  produced by `bun run fixtures` (git-ignored)
e2e/fixtures/photos/     committed CC0 photos, with SOURCES.md
```

`bun run fixtures` also writes `exif-rotated-6.jpg` (EXIF orientation 6, 300 DPI, ICC profile),
`metadata-exif.jpg` (camera, capture, GPS and XMP tags) and `analyze-batch/` (50 deterministic PNGs plus
`manifest.json`) for the Analyze tab.

What each suite must assert is written per tool in [`../docs/0-E2E-CHECKLIST.md`](../docs/0-E2E-CHECKLIST.md);
a tool without a passing line there is not shipped, whatever its checkboxes say.
