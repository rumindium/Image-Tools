# 0 — UI and Design

> The interface has one job: make the difference between "your image never left this tab" and "your image went to
> a server" impossible to miss, while staying out of the way of the work.
> Last updated: 16 November 2026

---

## 1. Design language

The product is a tool, not a showcase. The visual reference is a good camera app: a dark neutral surface, one
accent, the image always the brightest thing on screen, and controls that read as instruments rather than
decoration.

### 1.1 Tokens

Defined once in `packages/ui/src/tokens.css` as CSS variables, consumed by Tailwind's theme. A component with a
hex literal is a review failure.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surface` | `#ffffff` | `#0b0d10` | page |
| `--surface-2` | `#f6f7f9` | `#12151a` | cards, sidebar |
| `--surface-3` | `#eceef2` | `#1a1f26` | inputs, hover |
| `--border` | `#dfe3e9` | `#262c35` | 1 px dividers |
| `--text` | `#15181d` | `#e8ecf1` | primary text |
| `--text-muted` | `#5b6472` | `#98a2b1` | labels, helper text |
| `--accent` | `#4f46e5` | `#7c78ff` | primary action, focus ring |
| `--accent-contrast` | `#ffffff` | `#0b0d10` | text on accent |
| `--success` | `#0f7b4f` | `#3ddc97` | ✓ result, saved |
| `--warn` | `#a05a00` | `#f5b544` | warning, "server lane" |
| `--danger` | `#b42318` | `#ff6b5e` | errors, destructive |
| `--checker-a` / `--checker-b` | `#e9ecf1` / `#ffffff` | `#1a1f26` / `#232a33` | transparency |
| `--radius` | `10px` | same | cards, inputs |
| `--shadow-card` | `0 1px 2px rgb(16 24 40 / 6 %), 0 4px 12px rgb(16 24 40 / 6 %)` | none | cards only |

The checkerboard is a **token pair**, not an image, so the transparency pattern matches the theme and disappears
at 25 % zoom when it would otherwise alias ([§6.3](#63-transparency)).

### 1.2 Type and spacing

| Role | Size / weight | Notes |
|---|---|---|
| Page title | 28 / 650 | one per page, gradient text only on the index |
| Section title | 16 / 600 | card headers |
| Body | 14 / 400 | 1.55 line-height |
| Label | 13 / 500 | above an input, never a placeholder-only label |
| Numeric readout | 13 / 500, `tabular-nums` | dimensions, bytes, quality, zoom |
| Helper | 12 / 400, `--text-muted` | the schema's `describe()`, verbatim |

Spacing is a 4 px scale: `4 8 12 16 24 32 48 64`. Card padding is 20 px, gap between cards 16 px, workspace
padding 24 px on desktop and 12 px on phones. Two radii exist (`10px` card, `8px` control) — a third needs a
reason.

---

## 2. Layout shell

### 2.1 Desktop (≥ 1280 px)

```text
┌──────────────┬────────────────────────────────────────────────────────────┐
│  ● Rumindium │  Convert images                              [⌘K] [◐] [ⓘ]  │
│  Image       ├────────────────────────────────────────────────────────────┤
│              │                                                            │
│  WORKSPACE   │   ┌───────────────────────────────┐  ┌───────────────────┐ │
│  ○ Convert   │   │                               │  │  Options          │ │
│  ○ Compress  │   │        image preview          │  │  ─────────────    │ │
│  ○ Edit      │   │      (zoom / pan / compare)   │  │  Format  [WebP ▾] │ │
│  ○ Resize    │   │                               │  │  Quality ──●── 80 │ │
│  ● Remove bg │   └───────────────────────────────┘  │  …                │ │
│  ○ Enhance   │   ┌───────────────────────────────┐  │  ┌──────────────┐ │ │
│              │   │ 3 files · 24 MP · 12.4 MB      │  │  │ Run  (⌘↵)    │ │ │
│  INSPECT     │   │ ▸ row · row · row             │  │  └──────────────┘ │ │
│  ○ Utilities │   └───────────────────────────────┘  └───────────────────┘ │
│  ○ Colors    │                                                            │
│  ○ Metadata  │                                                            │
│  ○ Batch     │                                                            │
│              │                                                            │
│  ⚙ Settings  │                                                            │
└──────────────┴────────────────────────────────────────────────────────────┘
```

- Sidebar 240 px, fixed, grouped by intent (`WORKSPACE` = transform a picture; `INSPECT` = read a picture;
  `Batch` and `Settings` sit at the bottom). Groups exist because twenty flat links is a menu, not a structure.
- The workspace column is the flexible one. The options panel is 340 px, scrolls independently, and holds the Run
  button **at its bottom, sticky** — the button never scrolls out of reach on a long option list.
- Header shows the tool title and a one-line description; the `ⓘ` opens the tool's docs section in a sheet, not a
  new tab (a user mid-task should not lose their file).

### 2.2 Tablet (768–1279 px)

Sidebar collapses to a 64 px icon rail with tooltips; labels return at ≥ 1024 px. The options panel becomes a
bottom sheet that can be dragged to 60 % height, because a 700 px-wide tablet has no room for three columns and
forms in a modal are worse than forms in a sheet.

### 2.3 Mobile (< 768 px)

```text
┌──────────────────────────────┐
│ ‹ Convert        [⋯]         │   sticky top bar, back to index
├──────────────────────────────┤
│                              │
│       preview (full width)   │   16:10, pinch zoom, double-tap fit
│                              │
├──────────────────────────────┤
│  1 of 3    ●●○   12.4 MB     │   file strip
├──────────────────────────────┤
│  ╭────────────────────────╮  │
│  │  Format   WebP      ▾  │  │   bottom sheet, 3 snap points
│  │  Quality  ───●───  80  │  │   (peek / half / full)
│  │  [      Run       ]    │  │
│  ╰────────────────────────╯  │
└──────────────────────────────┘
```

Rules that are not negotiable on a phone:

- The Run button is always reachable: either in the sheet's peek state or docked above the safe-area inset.
- Every control target is ≥ 44 × 44 CSS px; sliders get a 32 px-tall invisible hit area.
- Pinch-zoom is on the preview, not on the page (`touch-action: none` on the canvas, page zoom disabled inside
  the workspace only).
- Long option lists do not become tabs within tabs. One scroll, grouped headings.
- The batch queue on mobile shows one row at a time with a pager; a 200-row virtual list on a 390 px screen is
  not a queue, it is a wall.

### 2.4 Theme

`light | dark | system`, stored in `localStorage` (`ri-theme`), applied by a blocking script in `<head>` to avoid
a flash, default `system`. The workspace's preview background follows the theme but the image's own pixels do
not — no colour management is applied to the preview, and Settings says so.

---

## 3. Page templates

### 3.1 Index (`/`)

One screen, no marketing scroll:

```text
Rumindium Image
Everything you need to process images, in one place.
Free, private, and processed in your browser.

┌──────────────────────── drop zone ────────────────────────┐
│  Drop images here, paste from the clipboard, or browse    │
│  JPG · PNG · WebP · AVIF · GIF · BMP · SVG · HEIC · TIFF   │
│  Up to 40 MP · 100 MB per file · nothing is uploaded       │
└───────────────────────────────────────────────────────────┘

Then pick a tool:  [Convert] [Compress] [Resize] [Edit] [Remove bg] …
```

Dropping on the index opens a **tool chooser sheet** with the file already loaded — not a redirect to a guessed
tool. Guessing "you probably wanted to compress" is the kind of helpfulness that loses a user's intent.

Below the fold: a 20-tool grid (icon, name, one line, keyboard shortcut), and a short "Privacy" block stating the
lane A guarantee in one sentence with a link to the docs. No testimonials, no pricing, no cookie banner (there are
no tracking cookies to consent to).

### 3.2 Tool page anatomy

Every tool page is the same five regions, in this order:

| Region | Content | Notes |
|---|---|---|
| Banner | category chip, gradient title, one-line summary, `ⓘ`, illustration | illustration is tool-specific and abstract ([§4](#4-illustrations)) |
| Drop / file area | dropzone, or the file list once files exist | collapses to a single row after the first file |
| Workspace | preview + zoom/pan/compare, or the tool's custom board | crop board, brush canvas, palette strip |
| Options | schema-generated controls, grouped, Advanced collapsed | sticky Run |
| Result | before/after, metrics, warnings, export panel | replaces the workspace's lower half on completion |

The page never scrolls horizontally. The workspace has a fixed aspect container with `object-fit: contain`, so a
300 × 200 icon and a 6000 × 4000 photo occupy the same footprint and the options panel does not jump when the
file changes.

### 3.3 Background editor (`/background`)

The one page with a different shape, because the matte is the subject:

```text
┌─────────────────────────────────────────┬───────────────────────┐
│  ┌───────────────────────────────────┐  │  Background           │
│  │  checkerboard / colour / image    │  │  ( ) Transparent      │
│  │        ┌──────────────┐           │  │  (•) Colour  [#fff]   │
│  │        │   subject    │           │  │  ( ) Gradient  …      │
│  │        └──────────────┘           │  │  ( ) Image     …      │
│  │                                   │  │  ─────────────────    │
│  └───────────────────────────────────┘  │  Refine edges          │
│  [Erase] [Restore] size ──●── hardness  │  Shadow  ○ Outline ○   │
│  zoom 100 %   [fit] [1:1]               │  ┌───────────────────┐ │
│                                         │  │  Export PNG       │ │
│                                         │  └───────────────────┘ │
└─────────────────────────────────────────┴───────────────────────┘
```

The brush toolbar sits **under the canvas**, not in the side panel: a brush is a pointer tool, and pointer tools
live next to the surface they act on. Brush strokes are stored as a list of `{op, points, radius, hardness,
opacity}` and replayed onto the matte — undo is `pop()`, and a 40 MP image costs no extra memory per stroke.

---

## 4. Illustrations

Each tool's banner carries a small vector illustration of *what the tool does to a picture*, drawn with the accent
token so it themes automatically:

| Tool | Shape |
|---|---|
| convert | one square with two format tags and an arrow |
| compress | a stack of squares shrinking, with a byte readout |
| resize | a frame inside a frame, corner handles |
| edit | a crop frame over a slanted photo, one rotated corner |
| remove bg | a subject silhouette with the background peeling off in a checkerboard |
| background | the same silhouette on three stacked backdrops |
| enhance | a split lens, flat half and vivid half |
| colors | five swatches fanned from a corner |
| metadata | a photo with an attached tag sheet |
| batch | a grid of small tiles with one progress ring |
| export | a package with a file and a zip coming out |

Illustrations are inline SVG components in `packages/ui/src/art/`, ≤ 4 KB each, no external requests (CSP
`img-src 'self' blob: data:` would block a CDN anyway — [0-SECURITY](0-SECURITY.md) §3).

---

## 5. Upload interaction

### 5.1 Entry points

| Gesture | Behaviour |
|---|---|
| Drop on window | accepted anywhere on a tool page or the index; a full-page overlay appears on dragenter |
| Paste (`⌘V`) | images from the clipboard; a pasted URL is **not** fetched (SSRF and privacy both) |
| Browse | `<input type="file" multiple accept="image/*,.heic,.tif,.tiff">` |
| Share target (PWA, later) | out of scope for the MVP |

### 5.2 Validation as the user watches

Files are validated **on drop**, before any decode, in this order, and the message names the actual value:

```text
"photo.heic"    → reading header…
"scan.tiff"     → loading TIFF decoder (1 of 1)…
"notes.pdf"     → That file is not an image we can read (detected: PDF).
"screenshot.png"→ 12 000 × 8 000 is above the 40 MP limit for this device. [Use the server worker]
```

A rejected file stays visible for 10 s with its reason and a × — silently dropping it makes the user re-add it
three times.

### 5.3 The file list

One row per file: 40 px thumbnail, name (truncated middle, never the end — the extension matters), dimensions,
size, status chip, and per-row actions. The list is the selection model for the batch queue and the merge-like
order controls where a tool needs order (`convert` does not; `export` respects list order).

A file still being decoded shows a shimmer, not a spinner, and its dimensions read `—` rather than `0 × 0`. A
value the app does not know yet is never rendered as a number.

### 5.4 Preview actions

| Action | Behaviour |
|---|---|
| Zoom | wheel/`⌘+`/pinch; 10 %–800 %; `0` fits, `1` is 100 %, `2` is 200 % |
| Pan | space-drag, middle-drag, or two-finger drag; clamped so the image cannot be lost off-screen |
| Compare | press-and-hold `\` to peek the original, or the slider handle for a split view |
| Open | the result opens in a new tab when the lane can serve `inline` (`?disposition=inline`) |

The compare control is a **held key or a dragged handle**, never a toggle: a toggle makes users compare two
remembered images, which is exactly what human vision is bad at.

---

## 6. Workspace canvas

### 6.1 Sizing

The canvas is sized in **device pixels**: `width = cssWidth * devicePixelRatio`, and the draw call scales by DPR,
so a 2× laptop shows a sharp preview and a zoomed 1:1 view shows real pixels rather than browser-smoothed ones.
At 100 % on a 2× screen the image occupies twice the CSS area — that is correct, and the zoom readout says `100 %
(2×)` so it is not surprising.

### 6.2 Rendering rules

- One `<canvas>` for the image, one overlay `<canvas>` for crop handles, brush cursor and safe-zone guides. The
  overlay is cleared per frame; the image canvas is redrawn only when the bitmap or the view transform changes.
- `imageSmoothingQuality = 'high'` when zoomed out; `'low'`/`false` at ≥ 100 % so pixels are inspectable and the
  user can judge compression artefacts.
- Previews never use the full-resolution raster: the workspace draws a ≤ 2048 px copy, and 1:1 zoom switches to
  the full raster only while zoomed (and releases it on zoom-out past 50 %).

### 6.3 Transparency

The checkerboard is drawn **behind** the image in canvas, at 8 CSS px squares, alpha 1.0, colours from
`--checker-a/b`. It is hidden when the image has no alpha (saves a full-canvas fill per frame) and at zoom < 25 %
(where it aliases into grey noise). A checkerboard that is actually part of the exported image is the single most
common bug in this class of product; the export path composites onto a solid colour and the checkerboard never
exists in a `Blob`.

---

## 7. Progress, long jobs, and the two lanes

### 7.1 The lane badge

Every job row and result card carries exactly one of:

| Badge | Copy | Where |
|---|---|---|
| `This tab` | "processed in this tab" | lane A |
| `Server` (warn colour) | "processed on our server · deleted in 15 min" | lane B |
| `Server` + lock | same, with the retention tooltip | lane B, AI |

The badge is not decorative: it is the only place the privacy model is stated per artifact. A result whose badge
says "This tab" was never uploaded, and the E2E test for the privacy claim asserts that no request carried image
bytes during that job ([0-TESTING](0-TESTING.md) §6.2).

### 7.2 Progress

- A determinate bar per file, weighted by the stage table ([pipeline](0-PROCESSING-PIPELINE.md) §4.1).
- The stage label is a verb in the user's language of intent: "Reading", "Resizing", "Writing WebP", "Checking".
  Never "Processing 62 %" alone — a percentage without a verb tells the user nothing about whether it is stuck.
- A job that exceeds `2 × estimateMs` grows a caption: "This is slower than expected — large images can take a
  minute. You can cancel." A silent bar for 40 s reads as a hang.
- The batch header shows `7 of 12 done · 2 running · 1 failed` and one ETA derived from completed rows, not from
  the estimate of pending ones.

### 7.3 The cancel contract

Cancel is available in every non-terminal state and always does the same thing: stop work, release memory, mark
the row `CANCELLED`, keep the input file. It never deletes the user's file and never asks "are you sure".

---

## 8. States, errors, and honesty

### 8.1 The five states, always distinguishable

| State | Visual | Copy |
|---|---|---|
| Empty | dashed dropzone | "Drop images here" |
| Idle with files | workspace preview | the Run button is enabled or explains why not |
| Running | progress + cancel | stage verb |
| Done | result card | metrics + export |
| Failed | red-edge card | the error message + one hint + retry |

A sixth "partial" state exists for batch: rows complete individually, and the header never says "done" while a
row is `FAILED`. That distinction is why the batch header counts failures separately instead of showing 100 %.

### 8.2 Error copy rules

1. Say what happened in terms of the user's file: "This 4 000 × 3 000 image is above the 16 MP limit on this
   device", not "MAX_PIXELS exceeded".
2. Always offer the next action: resize, use the server, pick another model, retry.
3. Never blame the user, never say "Oops", never show a code without a sentence. The code lives in a `details`
   disclosure for support.
4. A refused action explains itself **before** the click (disabled control + reason), not after.

### 8.3 AI labels

Anything that runs a model says so, in the option card: a small `AI` chip next to the control, plus the model
size and where it runs ("45 MB, downloaded once, runs on your GPU"). Anything that is classical says nothing —
labelling a histogram stretch as AI is the opposite lie and just as corrosive.

---

## 9. Accessibility

| Requirement | Implementation |
|---|---|
| Keyboard first | every action reachable; `⌘↵` runs, `Esc` cancels a drag, `\` peeks the original, `?` opens shortcuts |
| Focus visible | 2 px accent ring at 2 px offset, never removed; the canvas is focusable and shows the ring |
| Labels | every control has a real `<label>`; sliders use `aria-valuetext` with the unit ("80 percent") |
| Live regions | job status changes announce via `aria-live="polite"`, errors via `assertive`, throttled to 1/s per row |
| Contrast | ≥ 4.5:1 for text, ≥ 3:1 for controls, both themes; the checkerboard is not relied on to convey state |
| Motion | `prefers-reduced-motion` removes the shimmer, the sheet spring and the progress pulse |
| Canvas alternatives | dimensions, output bytes and success/failure are always in text; the canvas is never the only source of truth |
| Zoom | 200 % browser zoom keeps the layout usable; no fixed-height panels that clip |

The crop board and the brush are pointer-dependent by nature; both get keyboard alternatives (arrow keys move the
crop box by 1 px / 10 px with `Shift`; `[` `]` change brush size). That work is scheduled with the tool, not as a
later "a11y pass".

---

## 10. Responsive rules

| Breakpoint | Sidebar | Options | Workspace | Notes |
|---|---|---|---|---|
| ≥ 1280 | 240 px fixed | 340 px fixed column | flexible | the reference layout |
| 1024–1279 | 64 px rail | 320 px column | flexible | labels appear on hover |
| 768–1023 | rail | bottom sheet (60 %) | full width | preview height 45 vh |
| < 768 | hidden, top bar | bottom sheet (snap) | full width | one row per queue page |
| < 420 | hidden | full-height sheet | full width | options take over; `Back` returns to preview with values kept |

The one thing that never changes: the preview is visible while an option is being changed on a device wide enough
to show both. Live-but-invisible adjustments (changing quality with no preview) are the most common source of
"it looks different than I expected".

---

## 11. SEO and public pages

Tool pages are statically rendered with real content above the client island, because the island is heavy and the
crawler should not need it:

| Page | Title | Indexed |
|---|---|---|
| `/` | "Rumindium Image — free browser image tools" | ✓ |
| `/convert` | "Convert JPG, PNG, WebP, AVIF in your browser — Rumindium Image" | ✓ |
| `/compress` | "Compress images without uploading them — Rumindium Image" | ✓ |
| `/background` | "Remove image backgrounds in your browser — Rumindium Image" | ✓ |
| others | same pattern | ✓ |
| `/batch`, `/settings` | — | `noindex` |

Each page carries `SoftwareApplication` JSON-LD with `offers: { price: 0 }`, and an FAQ block answering the three
questions the tool actually gets: is it free, is my image uploaded, what formats. Metadata is generated from the
registry (`title`, `short`, `docs`) so a new tool cannot ship without a title.

---

## 12. Copywriting

| Rule | Example |
|---|---|
| Sentence case, not Title Case | "Remove background", not "Remove Background" |
| Numbers with units and a space | "12.4 MB", "40 MP", "4 032 × 3 024" |
| Bytes: one decimal under 100 | "820 KB", "1.2 MB" |
| No exclamation marks | — |
| Buttons are verbs | "Compress", "Export ZIP", "Cancel" |
| Destructive is specific | "Remove 3 files from the queue", not "Clear" |
| Privacy is stated as fact, once | "Nothing is uploaded." — not repeated in five places |
| AI is labelled where it acts | chip on the control, sentence in the card |

The privacy sentence appears in exactly two places: the index dropzone and Settings. A claim repeated everywhere
becomes decoration and stops being read.

---

## 13. Analytics (privacy-safe)

Events carry counts and durations only:

```text
job.start        { tool, lane, files, totalBytes, deviceClass }        // no name, no dimensions per file
job.done         { tool, lane, durationMs, outputBytes, warnings[] }
job.fail         { tool, lane, code, stage }                          // code, never the message
model.load       { modelId, ms, cached }                              // no image reference
lane.escape      { from: 'browser', to: 'server', reason: 'memory' }  // the product's own health metric
```

`totalBytes` is a bucket (`<1MB`, `1-5MB`, `5-20MB`, `>20MB`), not a number, because a precise byte count plus a
tool name is a fingerprint. There is no session recorder, no heatmap, no third-party script — CSP `script-src
'self'` would block one anyway, which is the strongest possible guarantee that the promise holds.

---

## Related docs

- [`0-ARCHITECTURE.md`](0-ARCHITECTURE.md) §6 — the lane routing the badge reflects
- [`0-PROCESSING-PIPELINE.md`](0-PROCESSING-PIPELINE.md) §4 — stage names shown in the progress bar
- [`03-EDIT.md`](03-EDIT.md) — the crop board and adjustment controls in detail
- [`06-BACKGROUND-EDITOR.md`](06-BACKGROUND-EDITOR.md) — the brush and background panel
- [`12-BATCH-PROCESSING.md`](12-BATCH-PROCESSING.md) — the queue rows and header counts
