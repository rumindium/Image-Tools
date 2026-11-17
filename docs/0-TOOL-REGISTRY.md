# 0 — Tool Registry

> Twenty tool ids, one `ToolDefinition` each, one Zod schema each. The registry is the contract between the
> UI that renders a control, the worker that runs it, and the test that proves it.
> Last updated: 16 November 2026

---

## 1. Why a registry

The naive shape is a component per tool that reads `searchParams`, calls a function, and renders a form. It
works until the third tool, at which point:

- the batch queue needs to know which tools can run over many files,
- the router needs to know which tools may use the server lane,
- the docs need one canonical id to point at,
- the tests need to enumerate "every tool" without importing React.

The registry answers all four from one table of data. `apps/web` imports it to build the sidebar and the tool
index; `apps/api` imports the *same* schemas to validate `POST /jobs`; `0-TESTING`'s matrix test iterates it and
fails when a tool lacks an E2E case.

```text
packages/contracts/src/tools/
  index.ts          ← the catalog array (order = sidebar order)
  common.ts         ← shared fragments: quality, format, background, filename
  convert.ts  compress.ts  edit.ts  resize.ts
  background.ts  enhance.ts  utilities.ts  color.ts
  metadata.ts  presets.ts  batch.ts  export.ts
```

No schema may import from `apps/*` or from `image-browser`. That direction (app → contracts) is enforced by
`bun run boundaries` ([0-FOLDER-STRUCTURE](0-FOLDER-STRUCTURE.md) §6).

---

## 2. Tool definition contract

```ts
type Execution =
  | { kind: 'browser' }
  | { kind: 'hybrid'; requires: Capability[]; serverTool: ToolId }
  | { kind: 'server';  reason: string };

type ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  id: ToolId;
  title: string;                    // "Remove background"
  short: string;                    // sidebar label, ≤ 18 chars
  route: string;                    // "/background"
  category: 'convert' | 'optimize' | 'edit' | 'resize' | 'ai' | 'inspect' | 'compose' | 'system';
  execution: Execution;
  batch: boolean;                   // may appear in the batch queue
  accepts: ReadonlyArray<AcceptedInput>;   // format families, min/max count
  produces: ReadonlyArray<OutputKind>;     // image | zip | text | json | palette | report
  capabilities: ReadonlyArray<Capability>; // needed before the Run button enables
  limits: { maxPixels: number; maxBytes: number; minFiles: number; maxFiles: number };
  options: S;
  defaults: z.infer<S>;
  estimateMs: (input: { pixels: number; files: number }, o: z.infer<S>) => number;
  warnings?: (o: z.infer<S>) => Warning[];
  docs: string;                     // "01-CONVERT.md"
  phase: 1 | 2 | 3 | 4 | 5 | 6;
};
```

### 2.1 Capabilities

| Capability | Meaning | Where probed |
|---|---|---|
| `encode:jpeg` `encode:png` `encode:webp` `encode:avif` | the browser can *encode* this format | [0-PROCESSING-PIPELINE](0-PROCESSING-PIPELINE.md) §7.3 |
| `decode:heic` `decode:tiff` | the lazy WASM decoder loaded and self-tested | same |
| `alpha` | the chosen output format can carry transparency | derived from `encode:*` |
| `gpu` | a working WebGPU adapter and a 256 MB allocation | same |
| `wasmThreads` | `crossOriginIsolated` and `SharedArrayBuffer` | same |
| `cpuPixels` | always true; used to gate expensive CPU passes behind the memory budget | — |

A capability that is absent **disables the control with a reason**, and the reason string is part of the schema
description so the disabled state and the docs cannot disagree.

### 2.2 Estimates are budget inputs, not promises

`estimateMs` is used for three things and nothing else: the batch ETA, the watchdog length
(`max(30 s, 3 × estimate)`), and the progress bar's throttling. It is a piecewise-linear model over pixels with
per-op constants measured once by the harness:

```ts
// packages/contracts/src/tools/cost.ts
const COST = { jpeg: 0.055, png: 0.11, webp: 0.09, avif: 0.28 };  // ms per megapixel per encoder
estimateMs: ({ pixels }, o) =>
  180 + (pixels / 1e6) * (COST[o.format ?? 'jpeg'] + (o.op === 'filter' ? 0.042 : 0.004)) * 8;
```

The constants live in one file so that a slow device affects the *displayed* estimate only, never a decision:
nothing in the product refuses work because an estimate was high, and nothing runs because it was low.

---

## 3. Canonical tool catalog

Order is the sidebar order and the order of the tool index page. `Lane` mirrors README §3; `Out` is what the
exporter receives.

| # | id | Title | Route | Lane | Batch | Out | Phase |
|---|----|-------|-------|------|-------|-----|-------|
| 1 | `convert` | Convert format | `/convert` | browser | ✓ | image[] | P1 |
| 2 | `compress` | Compress | `/compress` | browser | ✓ | image[] | P1 |
| 3 | `resize` | Resize | `/resize` | browser | ✓ | image[] | P1 |
| 4 | `crop` | Crop | `/edit?tab=crop` | browser | ✗ | image | P1 |
| 5 | `rotate-flip` | Rotate & flip | `/edit?tab=transform` | browser | ✓ | image | P1 |
| 6 | `adjust` | Adjust | `/edit?tab=adjust` | browser | ✓ | image | P2 |
| 7 | `filter` | Filters | `/edit?tab=filter` | browser | ✓ | image | P2 |
| 8 | `bg-remove` | Remove background | `/background` | hybrid | ✓ | image (alpha) | P3 |
| 9 | `bg-replace` | Background editor | `/background?tab=replace` | browser | ✓ | image | P3 |
| 10 | `enhance` | Enhance | `/enhance` | hybrid | ✓ | image | P4 |
| 11 | `upscale` | AI upscale | `/enhance?tab=upscale` | server | ✗ | image | P6 |
| 12 | `base64` | Base64 & data URI | `/utilities?tab=base64` | browser | ✓ | text | P2 |
| 13 | `analyze` | Image analyzer | `/utilities?tab=analyze` | browser | ✓ | report | P2 |
| 14 | `metadata` | Metadata viewer | `/metadata` | browser | ✓ | report | P2 |
| 15 | `metadata-clean` | Metadata cleaner | `/metadata?tab=clean` | browser | ✓ | image[] | P2 |
| 16 | `palette` | Color extractor | `/colors` | browser | ✓ | palette | P2 |
| 17 | `pixel-pick` | Pixel picker | `/colors?tab=pick` | browser | ✗ | color | P2 |
| 18 | `social-resize` | Social presets | `/social` | browser | ✓ | image[] | P2 |
| 19 | `batch` | Batch queue | `/batch` | depends | ✓ | image[] / zip | P5 |
| 20 | `export` | Export | (panel) | browser | ✓ | files / zip | P1 |

Two ids are deliberately **not** routed: `batch` is a queue over other ids (it carries `batch: false` itself to
prevent recursion), and `export` is a panel inside every result card rather than a page. `/social` exists in
code but has no sidebar entry in the MVP; the tool is reachable from `resize`'s preset tab and from search
([11](11-SOCIAL-PRESETS.md) §7 explains why it did not earn a nav slot).

---

## 4. Option schemas

Defaults are part of the contract: the UI initialises from `defaults`, the API fills absent keys from the same
object, and a test asserts `schema.parse(defaults)` succeeds for every tool. `describe()` strings become the
control's helper text, so copy lives next to the rule it explains.

### 4.1 Shared fragments (`common.ts`)

```ts
export const ImageFormat = z.enum(['jpeg', 'png', 'webp', 'avif']);

export const Quality = z.number().int().min(1).max(100).describe(
  '1 = smallest, 100 = best. Ignored for PNG.',
);

export const Background = z.string().regex(/^#[0-9a-f]{6}$/i).describe(
  'Used where the output format has no transparency.',
);

export const fileName = z.string()
  .trim().min(1).max(120)
  .regex(/^[\w .()-]+$/u, 'Letters, digits, space, dot, dash, underscore, parentheses only')
  .refine((v) => !v.startsWith('.'), 'Cannot start with a dot');

export const SuffixMode = z.enum(['keep', 'suffix', 'template'])
  .describe('How the output file name is derived from the input name.');
```

`fileName` rejects `/`, `\`, `..`, control characters and a leading dot — a file name that can escape the ZIP
entry or shadow a hidden file is a security problem, not a cosmetic one. The regex is the *only* place a name is
validated; the exporter sanitises again for server-supplied names ([13](13-EXPORT-MANAGER.md) §5).

### 4.2 Convert (`convert.ts`)

```ts
export const ConvertOptions = z.object({
  format: ImageFormat,
  quality: Quality.default(82),
  background: Background.default('#ffffff').describe('Flatten colour when the output has no alpha.'),
  keepMetadata: z.boolean().default(false),
  naming: z.object({
    mode: SuffixMode.default('suffix'),
    suffix: z.string().max(24).default(''),
    template: z.string().max(80).optional(),
  }).default({}),
  overwrite: z.boolean().default(false).describe('Replace the source instead of adding a copy.'),
});
```

Deliberately absent: DPI (canvas cannot write it without a metadata writer; [10](10-METADATA.md) §6 explains the
one case where the value is preserved), colour profile (browsers normalise to sRGB on decode and cannot write
ICC), and SVG output (§2 of the pipeline doc). Each absence is a documented limitation of the browser, not a
missing feature.

### 4.3 Compress (`compress.ts`)

```ts
export const CompressMode = z.enum(['quality', 'target']);

export const CompressOptions = z.object({
  mode: CompressMode.default('quality'),
  quality: Quality.default(80),
  targetBytes: z.number().int().min(10_000).max(50_000_000).optional()
    .describe('Maximum output size. The app searches for the best quality that fits.'),
  format: z.enum(['jpeg', 'webp', 'avif', 'png']).default('webp'),
  maxWidth: z.number().int().min(16).max(20_000).optional(),
  maxHeight: z.number().int().min(16).max(20_000).optional(),
  stripMetadata: z.boolean().default(true),
  background: Background.default('#ffffff'),
}).superRefine((v, ctx) => {
  if (v.mode === 'target' && !v.targetBytes)
    ctx.addIssue({ code: 'custom', path: ['targetBytes'], message: 'A target size is required.' });
});
```

`mode: 'target'` without `targetBytes` is rejected by the schema, not by a `if` in the component — the API gets
the same refusal for free.

### 4.4 Resize (`resize.ts`)

```ts
export const Fit = z.enum(['fit', 'fill', 'stretch', 'contain', 'cover']);

export const ResizeOptions = z.object({
  basis: z.enum(['dimensions', 'percentage', 'preset', 'maxEdge']).default('dimensions'),
  width: z.number().int().min(1).max(20_000).optional(),
  height: z.number().int().min(1).max(20_000).optional(),
  percentage: z.number().min(1).max(400).default(50),
  maxEdge: z.number().int().min(16).max(20_000).optional(),
  lockAspect: z.boolean().default(true),
  fit: Fit.default('fit'),
  allowUpscale: z.boolean().default(false),
  filter: z.enum(['auto', 'nearest']).default('auto')
    .describe('Nearest keeps hard pixel edges (pixel art); auto uses a smooth resample.'),
  background: Background.default('#ffffff'),
  format: ImageFormat.optional().describe('Leave empty to keep the input format.'),
  quality: Quality.default(82),
}).superRefine((v, ctx) => {
  if (v.basis === 'dimensions' && v.width == null && v.height == null)
    ctx.addIssue({ code: 'custom', message: 'Give a width, a height, or both.' });
  if (v.basis === 'percentage' && !v.lockAspect)
    ctx.addIssue({ code: 'custom', path: ['lockAspect'], message: 'Percentage resize always preserves the aspect ratio.' });
});
```

`allowUpscale: false` is a *hard* refusal (`VALIDATION_ERROR` with the target dimensions named), not a silent
clamp. A user who asked for 3000 px and received 800 px without being told is a support ticket, not a
guardrail.

### 4.5 Edit (`edit.ts`)

```ts
export const CropRect = z.object({
  x: z.number().min(0), y: z.number().min(0),
  width: z.number().min(1), height: z.number().min(1),
}).describe('In source pixels, top-left origin.');

export const CropOptions = z.object({
  rect: CropRect,
  aspect: z.union([z.literal('free'), z.literal('1:1'), z.literal('4:3'), z.literal('3:4'),
                   z.literal('16:9'), z.literal('9:16'), z.number().positive()]).default('free'),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  roundCorners: z.number().int().min(0).max(2000).default(0),
});

export const AdjustOptions = z.object({
  brightness: z.number().min(-100).max(100).default(0),
  contrast:   z.number().min(-100).max(100).default(0),
  saturation: z.number().min(-100).max(100).default(0),
  exposure:   z.number().min(-100).max(100).default(0),
  temperature:z.number().min(-100).max(100).default(0),
  tint:       z.number().min(-100).max(100).default(0),
  gamma:      z.number().min(0.2).max(3).default(1),
  hue:        z.number().min(-180).max(180).default(0),
  sharpen:    z.number().min(0).max(100).default(0),
});

export const EditOptions = z.object({
  crop: CropOptions.optional(),
  adjust: AdjustOptions.default({}),
  filter: z.enum(['none','grayscale','sepia','vintage','mono','blur','invert','warm','cool','sharpen'])
    .default('none'),
  scalePercent: z.number().min(10).max(400).default(100),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  format: ImageFormat.default('png'),
  quality: Quality.default(88),
});
```

Nine adjustments rather than a free-form record: an open map would let the UI send `brigthness` and the worker
silently ignore it. Each key is a documented, testable transform ([03](03-EDIT.md) §5).

### 4.6 Background removal and replacement (`background.ts`)

```ts
export const BgRemoveOptions = z.object({
  model: z.enum(['auto', 'portrait', 'product', 'general']).default('auto')
    .describe('auto picks by content heuristic; see 0-AI-MODELS §4.'),
  refine: z.enum(['none', 'fast', 'quality']).default('fast')
    .describe('quality runs a second pass on the alpha edge; roughly 2× the inference cost.'),
  denoiseAlpha: z.boolean().default(true),
  outputFormat: z.enum(['png', 'webp']).default('png'),
  quality: Quality.default(90),
  lane: z.enum(['browser', 'server']).default('browser'),
  consent: z.object({ acceptedAt: z.string().datetime(), version: z.string() }).optional(),
}).superRefine((v, ctx) => {
  if (v.lane === 'server' && !v.consent)
    ctx.addIssue({ code: 'custom', path: ['consent'], message: 'Server processing needs explicit consent.' });
});
```

```ts
export const BgReplaceOptions = z.object({
  background: z.discriminatedUnion('type', [
    z.object({ type: z.literal('transparent') }),
    z.object({ type: z.literal('color'), color: Background.default('#ffffff') }),
    z.object({ type: z.literal('gradient'),
               kind: z.enum(['linear', 'radial']).default('linear'),
               angle: z.number().min(0).max(360).default(135),
               stops: z.array(z.object({ color: Background, at: z.number().min(0).max(1) }))
                        .min(2).max(6) }),
    z.object({ type: z.literal('image'), imageId: z.string().uuid(),
               fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
               blur: z.number().min(0).max(100).default(0),
               scale: z.number().min(0.1).max(4).default(1),
               offsetX: z.number().min(-1).max(1).default(0),
               offsetY: z.number().min(-1).max(1).default(0) }),
  ]),
  shadow: z.object({ enabled: z.boolean().default(false), blur: z.number().min(0).max(80).default(18),
                     opacity: z.number().min(0).max(1).default(0.35),
                     offsetY: z.number().min(-40).max(40).default(12) }).default({}),
  outline: z.object({ enabled: z.boolean().default(false), width: z.number().min(1).max(40).default(2),
                      color: Background.default('#ffffff') }).default({}),
  maskEdits: z.array(z.object({
    op: z.enum(['erase', 'restore']), points: z.array(z.tuple([z.number(), z.number()])),
    radius: z.number().min(1).max(400), hardness: z.number().min(0).max(1).default(0.6),
    opacity: z.number().min(0).max(1).default(1),
  })).default([]).describe('Brush strokes in source-pixel space; replayed non-destructively.'),
  exportFormat: z.enum(['png', 'webp', 'jpeg']).default('png'),
});
```

### 4.7 Utilities, colour, metadata, presets

```ts
export const Base64Options = z.discriminatedUnion('direction', [
  z.object({ direction: z.literal('encode'), includeDataUri: z.boolean().default(true),
             lineWrap: z.number().int().min(0).max(120).default(0),
             format: z.enum(['jpeg','png','webp']).default('png'), quality: Quality.default(85) }),
  z.object({ direction: z.literal('decode'), text: z.string().min(16).max(40_000_000)
             .describe('A base64 string or a full data: URI.') }),
]);

export const AnalyzeOptions = z.object({
  detectTransparency: z.boolean().default(true),
  detectColorProfile: z.boolean().default(true),
  includeAspectName: z.boolean().default(true),
});

export const PaletteOptions = z.object({
  count: z.union([z.literal(3), z.literal(5), z.literal(8), z.literal(10)]).default(5),
  algorithm: z.enum(['median-cut', 'kmeans']).default('median-cut'),
  sampleMaxSide: z.number().int().min(32).max(1024).default(256)
    .describe('Sampling grid. 256 px is the default: quality plateaus above it.'),
  ignoreTransparent: z.boolean().default(true),
  sort: z.enum(['dominance', 'hue', 'lightness']).default('dominance'),
  minSaturation: z.number().min(0).max(1).default(0),
});

export const MetadataOptions = z.object({
  fields: z.array(z.enum(['exif','gps','icc','xmp','iptc','all'])).default(['exif','gps']),
  mode: z.enum(['strip', 'keep-allowed']).default('strip'),
  keep: z.array(z.string()).max(40).default([])
    .describe('EXIF tag names to preserve, e.g. ["Orientation", "ColorSpace"].'),
  outputFormat: ImageFormat.default('jpeg'),
  quality: Quality.default(92),
});

export const SocialPresetOptions = z.object({
  platform: z.enum(['instagram','facebook','youtube','tiktok','linkedin','x','whatsapp','custom']),
  variant: z.string().min(1),
  fit: Fit.default('cover'),
  background: Background.default('#ffffff'),
  format: z.enum(['jpeg','png','webp']).default('jpeg'),
  quality: Quality.default(88),
  safeZone: z.boolean().default(false)
    .describe('Overlay the platform safe margins on the preview (never on the export).'),
});
```

`SocialPresetOptions.variant` is validated against the preset catalog at runtime, not by a static enum: platforms
add sizes faster than this product ships releases ([11](11-SOCIAL-PRESETS.md) §4).

### 4.8 Batch and export

```ts
export const BatchOptions = z.object({
  toolId: z.enum(['convert','compress','resize','rotate-flip','adjust','filter',
                  'bg-remove','bg-replace','enhance','metadata-clean','social-resize','palette']),
  toolOptions: z.record(z.string(), z.unknown()),
  concurrency: z.number().int().min(1).max(3).optional(),
  lane: z.enum(['browser','server']).default('browser'),
  stopOnError: z.boolean().default(false),
  zip: z.boolean().default(true),
  zipName: z.string().max(80).default('rumindium-images.zip'),
});
```

`toolOptions` is `unknown` **on purpose and only here**: the concrete schema is resolved from `toolId` before
`superRefine` runs, and the resolved parse happens inside the queue (`validateBatchOptions(toolId, toolOptions)`)
which is the function the test suite calls. A batch job cannot ship an option the single-file tool would refuse.

```ts
export const ExportOptions = z.object({
  format: ImageFormat.optional().describe('Override the result format at export time.'),
  quality: Quality.optional(),
  naming: z.object({ mode: SuffixMode.default('suffix'), suffix: z.string().max(24).default(''),
                     template: z.string().max(80).optional(),
                     startIndex: z.number().int().min(1).default(1) }).default({}),
  stripMetadata: z.boolean().default(true),
  container: z.enum(['files', 'zip']).default('zip'),
});
```

---

## 5. Routing and escalation

```text
                 ┌──────────────────────────────────────────┐
   Run pressed ─►│ 1. schema.parse(options)                 │  fail → VALIDATION_ERROR
                 │ 2. capabilities ⊇ tool.capabilities      │  fail → control disabled (pre-run)
                 │ 3. budget: pixels·2.5·4 ≤ maxLiveBytes   │  fail → queue as IDLE / offer lane B
                 │ 4. execution.kind                        │
                 └───────┬──────────────────────┬───────────┘
                 browser │                      │ hybrid / server
                         ▼                      ▼
                  runLocal()            serverLaneEnabled && consent? ─no─► runLocal() or NOT_AVAILABLE
                                                │yes
                                                ▼
                                          runServer()
```

| Condition | Escalation | Never |
|---|---|---|
| pixels > device ceiling | offer lane B with the measured pixel count | silently downscale |
| `bg-remove` on a device with no WebGPU and < 4 GB RAM | offer lane B | switch automatically |
| batch > 60 files | offer lane B ("keeps running if you close the tab") | upload without consent |
| `upscale` | lane B only | local fallback at a different algorithm |
| encoder missing (AVIF) | pick the next-best format **only** if `auto` was chosen; otherwise refuse | rename PNG bytes to `.avif` |

`estimateMs` also drives a UX rule: if the estimate exceeds 8 s, the Run button shows the estimate; if it exceeds
45 s, the UI suggests a smaller size or the server lane before starting. A four-minute local job that the user
did not knowingly start is a bug in the product's honesty, not in its performance.

---

## 6. How the frontend consumes it

| Consumer | Reads | Does not read |
|---|---|---|
| Sidebar | `id, short, category, route, phase ≤ shipped` | options |
| Tool index | `title, short, category` | options |
| Tool page | `options` → controls, `defaults`, `capabilities`, `estimateMs` | — |
| Batch form | `batch`, `options`, `defaults` | route |
| Result card | `produces`, `docs` | options |
| Docs matrix test | everything | — |

Control generation rules (so 20 pages do not invent 20 layouts):

| Schema shape | Control |
|---|---|
| `z.enum([...])` ≤ 4 values | segmented control |
| `z.enum([...])` > 4 values | select |
| `z.boolean()` | switch, with `describe()` as the label |
| `z.number().min/max` with a 100-wide range | slider + numeric input |
| `z.number().int()` with a byte/pixel unit | numeric input with unit suffix |
| `z.string().regex(hex)` | colour picker + hex field |
| `z.discriminatedUnion('type', …)` | tabbed card, one tab per variant |
| nested object | collapsible "Advanced" section, collapsed unless a value differs from default |

A tool page that needs a control the table cannot express (the crop board, the brush, the palette strip) owns it
as a custom component and **still writes into the same schema** — the board is the input widget for `rect`, not a
parallel state.

---

## 7. Adding a tool — checklist

```text
[ ] id added to ToolId union + catalog array (order = sidebar)
[ ] schema in packages/contracts/src/tools/<group>.ts, defaults exported
[ ] `schema.parse(defaults)` passes (unit test enumerates all tools)
[ ] capabilities declared; a probe exists for each
[ ] transform in packages/image-browser/src/ops/<id>.ts, pure math in image-core
[ ] registry row: limits, estimate constants, warnings, docs filename
[ ] route + island, lazy imported, `dynamic = 'force-static'` where no params
[ ] option controls bound to schema (generated or custom, never ad-hoc state)
[ ] E2E case in e2e/<id>.e2e.ts + one fixture + one falsification entry
[ ] tool doc in docs/, added to README §3 and traceability
[ ] `bun run doc:parity` green (registry vs docs vs schemas)
```

`doc:parity` is what keeps a 25-document set honest: it parses the registry, parses the README matrix, parses
each tool doc's front-matter block (`tool id`, `lane`, `batch`) and fails on any disagreement. A doc that says
`lane: hybrid` for a tool the registry marks `browser` is a build failure, not a review comment.

---

## 8. Versioning and deprecation

| Surface | Version | Breaking change policy |
|---|---|---|
| Option schema | implicit in `packages/contracts` release | rename a key → accept the old key for one minor release, with a deprecation warning in the UI |
| Tool id | stable forever | never rename; add an alias that redirects the route |
| API | `/api/v1` | additive only; a removed field needs `/api/v2` |
| Preset catalog | `PRESETS_VERSION` (semver, `packages/presets`) | dimensions change → minor bump + changelog entry + doc update |
| Model manifest | `modelId@version` | pinned by hash; a new version is a new entry, never an in-place edit |

A deprecated option is not deleted silently: `parse` fills the new key from the old one and emits
`DEPRECATED_OPTION` as a warning, which the docs matrix lists. The one thing never versioned is the *output
bytes*, because browsers change encoders — which is exactly why the tests assert pixels and structure, not file
hashes ([0-TESTING](0-TESTING.md) §5).

---

## 9. Capability matrix — what each tool needs

| Tool | GPU canvas | CPU pixels | Alpha out | Multi-output | AI | Notes |
|---|---|---|---|---|---|---|
| `convert` | ✓ | — | if png/webp | — | — | format swap only |
| `compress` | ✓ | — | if png/webp | — | — | search loop, ≤6 encodes |
| `resize` | ✓ | — | if png/webp | — | — | halving downscale |
| `crop` | ✓ | — | depending on output | — | — | rotated crop box |
| `rotate-flip` | ✓ | — | depending on output | — | — | 90° multiples are lossless in the canvas |
| `adjust` | ✓ | ✓ full | depending on output | — | — | LUT per channel |
| `filter` | ✓ | ✓ full | depending on output | — | — | separable kernels |
| `bg-remove` | ✓ | alpha compose | ✓ | — | ✓ | needs `gpu` or wasm threads |
| `bg-replace` | ✓ | mask only | ✓ | — | — | composite + brush replay |
| `enhance` | ✓ | ✓ (auto-levels) | depending on output | — | hybrid | basic ops first, AI optional |
| `upscale` | — | — | — | — | ✓ | server lane, `sharp`/ONNX |
| `base64` | ✓ (encode) | — | — | text | — | decode path uses `atob` + blob |
| `analyze` | ✓ | sample | — | report | — | transparency scan is sampled, and says so |
| `metadata` | — | — | — | report | — | `exifr` on the original bytes |
| `metadata-clean` | ✓ | — | ✓ | — | — | strip by re-encode |
| `palette` | ✓ | ✓ sampled | — | palette | — | median-cut or k-means |
| `pixel-pick` | ✓ | ✓ 1 px + n×n | — | colour | — | zoomed loupe |
| `social-resize` | ✓ | — | depending on output | — | — | cover-crop with focal point |
| `batch` | inherits | inherits | inherits | zip | inherits | one lane for the queue |
| `export` | — | — | — | files/zip | — | only module that downloads |

"CPU pixels: sample" means the tool reads a downscaled raster and says so in its report
(`sampledAt: 512px`), because a resolution claim computed from a 512 px grid would be a lie for a 40 MP file's
transparency coverage.

---

## Related docs

- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) — what happens after `schema.parse`
- [`0-API.md`](0-API.md) — the server-lane half of these schemas
- [`0-AI-MODELS.md`](0-AI-MODELS.md) — `bg-remove.model` and `enhance` capabilities
- Each tool doc, `01`–`13`, for the semantics behind an option
