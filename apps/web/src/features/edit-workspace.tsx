'use client';

import { ExportPanel } from '@/features/export-panel';
import { type JobOutcome, LocalRunner, type Progress } from '@/lib/local-runner';
import {
  AdjustOptions,
  type AdjustOptionsValue,
  AppError,
  CropOptions,
  type CropOptionsValue,
  FilterOptions,
  type FilterOptionsValue,
  RotateOptions,
  type RotateOptionsValue,
} from '@ri/contracts';
import { type Sniffed, describeRejection, sniffBlob } from '@ri/image-browser';
import {
  type CropHandle,
  FILTERS,
  type FilterName,
  type History,
  type Rect,
  canRedo,
  canUndo,
  clampRect,
  createHistory,
  current as currentEdit,
  dimensionsAfterRotate,
  dragRect,
  fitRectToRatio,
  formatBytes,
  formatDimensions,
  fullRect,
  record,
  redo,
  undo,
} from '@ri/image-core';
import { Button, Card } from '@ri/ui';
import { Loader2, Redo2, RotateCcw, RotateCw, Undo2, Upload, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

type Tab = 'crop' | 'transform' | 'adjust' | 'filter';

type Aspect = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

type EditSnapshot = {
  rect: Rect;
  cropRotate: CropOptionsValue['rotate'];
  roundCorners: number;
  aspect: Aspect;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  adjust: Omit<AdjustOptionsValue, 'format' | 'quality'>;
  filter: Omit<FilterOptionsValue, 'format' | 'quality'>;
};

const ADJUST_KEYS = [
  'brightness',
  'contrast',
  'saturation',
  'exposure',
  'temperature',
  'tint',
  'gamma',
  'hue',
  'sharpen',
] as const satisfies readonly (keyof EditSnapshot['adjust'])[];

function toneOf(options: AdjustOptionsValue): EditSnapshot['adjust'] {
  return {
    brightness: options.brightness,
    contrast: options.contrast,
    saturation: options.saturation,
    exposure: options.exposure,
    temperature: options.temperature,
    tint: options.tint,
    gamma: options.gamma,
    hue: options.hue,
    sharpen: options.sharpen,
  };
}

function filterOf(options: FilterOptionsValue): EditSnapshot['filter'] {
  return { filter: options.filter, intensity: options.intensity };
}

function sameEdit(a: EditSnapshot, b: EditSnapshot): boolean {
  if (
    a.aspect !== b.aspect ||
    a.roundCorners !== b.roundCorners ||
    a.cropRotate !== b.cropRotate ||
    a.rotate !== b.rotate ||
    a.flipH !== b.flipH ||
    a.flipV !== b.flipV
  ) {
    return false;
  }
  if (
    a.rect.x !== b.rect.x ||
    a.rect.y !== b.rect.y ||
    a.rect.width !== b.rect.width ||
    a.rect.height !== b.rect.height
  ) {
    return false;
  }
  if (a.filter.filter !== b.filter.filter || a.filter.intensity !== b.filter.intensity) return false;
  return ADJUST_KEYS.every((key) => a.adjust[key] === b.adjust[key]);
}

/** A CSS approximation for the live preview; the export always runs the exact pixel pipeline. */
function previewEffects(tab: Tab, adjust: AdjustOptionsValue, filter: FilterOptionsValue): string {
  if (tab === 'adjust') {
    const exposure = 2 ** (adjust.exposure / 100);
    return [
      `brightness(${Math.max(0.1, (1 + adjust.brightness / 100) * exposure)})`,
      `contrast(${Math.max(0.1, 1 + adjust.contrast / 100)})`,
      `saturate(${Math.max(0, 1 + adjust.saturation / 100)})`,
      `hue-rotate(${adjust.hue}deg)`,
    ].join(' ');
  }
  if (tab !== 'filter') return 'none';

  const mix = Math.max(0, Math.min(1, filter.intensity / 100));
  switch (filter.filter) {
    case 'grayscale':
      return `grayscale(${mix})`;
    case 'sepia':
      return `sepia(${mix})`;
    case 'vintage':
      return `sepia(${0.6 * mix}) contrast(${1 - 0.08 * mix}) saturate(${1 - 0.15 * mix})`;
    case 'mono':
      return `grayscale(${mix}) contrast(${1 + 0.15 * mix})`;
    case 'blur':
      return `blur(${3 * mix}px)`;
    case 'invert':
      return `invert(${mix})`;
    case 'warm':
      return `sepia(${0.15 * mix}) saturate(${1 + 0.1 * mix})`;
    case 'cool':
      return `hue-rotate(${-10 * mix}deg) saturate(${1 + 0.05 * mix})`;
    case 'sharpen':
      return `contrast(${1 + 0.05 * mix})`;
    default:
      return 'none';
  }
}

const ASPECT_RATIO: Record<Aspect, number | undefined> = {
  free: undefined,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

const INPUT =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="block space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-text-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * The edit page: a crop board and a transform panel over one base bitmap (docs/03-EDIT.md).
 * The rectangle lives in the rotated frame and is mapped to source pixels by the same
 * `rotatedCropToSource` the worker uses, so the box on screen is the box that is cut.
 */
export function EditWorkspace() {
  const [tab, setTab] = useState<Tab>('crop');
  const [file, setFile] = useState<File | null>(null);
  const [sniffed, setSniffed] = useState<Sniffed | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<JobOutcome | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState<Aspect>('free');
  const [roundCornersRadius, setRoundCornersRadius] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(640);

  const [cropOptions, setCropOptions] = useState<CropOptionsValue>(() =>
    CropOptions.parse({ rect: { x: 0, y: 0, width: 1, height: 1 } }),
  );
  const [rotateOptions, setRotateOptions] = useState<RotateOptionsValue>(() =>
    RotateOptions.parse({ rotate: 90 }),
  );
  const [adjustOptions, setAdjustOptions] = useState<AdjustOptionsValue>(() => AdjustOptions.parse({}));
  const [filterOptions, setFilterOptions] = useState<FilterOptionsValue>(() => FilterOptions.parse({}));

  const snapshotOf = (overrides: Partial<EditSnapshot> = {}): EditSnapshot => ({
    rect: cropOptions.rect,
    cropRotate: cropOptions.rotate,
    roundCorners: roundCornersRadius,
    aspect,
    rotate: rotateOptions.rotate,
    flipH: rotateOptions.flipH,
    flipV: rotateOptions.flipV,
    adjust: toneOf(adjustOptions),
    filter: filterOf(filterOptions),
    ...overrides,
  });

  const [history, setHistory] = useState<History<EditSnapshot>>(() => createHistory(snapshotOf()));
  const [compareHeld, setCompareHeld] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  const snapshotRef = useRef(snapshotOf);
  snapshotRef.current = snapshotOf;
  const historyRef = useRef(history);
  historyRef.current = history;
  const runnerRef = useRef<LocalRunner | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrls = useRef<string[]>([]);
  const rectRef = useRef<Rect>(cropOptions.rect);
  rectRef.current = cropOptions.rect;

  const frame = bitmap
    ? dimensionsAfterRotate({ width: bitmap.width, height: bitmap.height }, cropOptions.rotate)
    : { width: 1, height: 1 };
  const scale = Math.min(1, viewportWidth / frame.width, 420 / frame.height);

  useEffect(() => {
    if (!boardRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setViewportWidth(width);
    });
    observer.observe(boardRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      runnerRef.current?.dispose();
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    return () => {
      bitmap?.close();
    };
  }, [bitmap]);

  const loadFile = useCallback(async (next: File) => {
    setError(null);
    setOutcome(null);
    const meta = await sniffBlob(next);
    setFile(next);
    setSniffed(meta);
    if (meta.format === 'unknown' || meta.animated) {
      setBitmap(null);
      setError(describeRejection(meta));
      return;
    }
    try {
      const decoded = await createImageBitmap(next, { imageOrientation: 'from-image' });
      const rect = fullRect(
        dimensionsAfterRotate(
          { width: decoded.width, height: decoded.height },
          snapshotRef.current().cropRotate,
        ),
      );
      setBitmap(decoded);
      setCropOptions((current) => ({ ...current, rect }));
      setHistory(createHistory(snapshotRef.current({ rect })));
    } catch {
      setBitmap(null);
      setError('This image could not be decoded. It may be corrupt or use a codec this browser lacks.');
    }
  }, []);

  const restore = useCallback((snapshot: EditSnapshot) => {
    setAspect(snapshot.aspect);
    setRoundCornersRadius(snapshot.roundCorners);
    setCropOptions((current) => ({ ...current, rect: snapshot.rect, rotate: snapshot.cropRotate }));
    setRotateOptions((current) => ({
      ...current,
      rotate: snapshot.rotate,
      flipH: snapshot.flipH,
      flipV: snapshot.flipV,
    }));
    setAdjustOptions((current) => ({ ...current, ...snapshot.adjust }));
    setFilterOptions((current) => ({ ...current, ...snapshot.filter }));
    setCompareHeld(false);
  }, []);

  const commit = useCallback((snapshot: EditSnapshot) => {
    setHistory((current) => record(current, snapshot, sameEdit));
  }, []);

  const undoEdit = useCallback(() => {
    const active = historyRef.current;
    if (!canUndo(active)) return;
    const next = undo(active);
    setHistory(next);
    restore(currentEdit(next));
  }, [restore]);

  const redoEdit = useCallback(() => {
    const active = historyRef.current;
    if (!canRedo(active)) return;
    const next = redo(active);
    setHistory(next);
    restore(currentEdit(next));
  }, [restore]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || !bitmap || running) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        target?.isContentEditable ||
        tag === 'TEXTAREA' ||
        (tag === 'INPUT' &&
          !['range', 'checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type));
      if (typing) return;

      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoEdit();
        else undoEdit();
      } else if (key === 'y') {
        event.preventDefault();
        redoEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bitmap, redoEdit, running, undoEdit]);

  // Draw the preview: crop tab follows its rotation, transform tab follows its own angle and flips.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;

    const angle =
      tab === 'crop'
        ? cropOptions.rotate
        : tab === 'transform'
          ? ((Math.round(rotateOptions.rotate) % 360) + 360) % 360
          : 0;
    const flipH = tab === 'transform' && rotateOptions.flipH;
    const flipV = tab === 'transform' && rotateOptions.flipV;
    const radians = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const rotatedWidth = Math.max(1, Math.ceil(bitmap.width * cos + bitmap.height * sin));
    const rotatedHeight = Math.max(1, Math.ceil(bitmap.width * sin + bitmap.height * cos));

    canvas.width = Math.max(1, Math.round(rotatedWidth * scale));
    canvas.height = Math.max(1, Math.round(rotatedHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (angle % 90 !== 0) {
      context.fillStyle = rotateOptions.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(radians);
    context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
    context.restore();
  }, [
    bitmap,
    scale,
    tab,
    cropOptions.rotate,
    rotateOptions.rotate,
    rotateOptions.flipH,
    rotateOptions.flipV,
    rotateOptions.background,
  ]);

  const beginDrag = (handle: CropHandle) => (event: React.PointerEvent) => {
    if (!bitmap) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = rectRef.current;
    const bounds = frame;
    const ratio = ASPECT_RATIO[aspect];

    const onMove = (moveEvent: PointerEvent) => {
      const dx = Math.round((moveEvent.clientX - startX) / scale);
      const dy = Math.round((moveEvent.clientY - startY) / scale);
      setCropOptions((current) => ({
        ...current,
        rect: dragRect(startRect, handle, dx, dy, bounds, ratio),
      }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const keyboardMove = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    setCropOptions((current) => ({
      ...current,
      rect: dragRect(current.rect, 'move', delta[0], delta[1], frame),
    }));
  };

  const rotateBoard = (direction: -1 | 1) => {
    if (tab === 'transform') {
      const rotate = (((Math.round(rotateOptions.rotate) + direction * 90) % 360) + 360) % 360;
      setRotateOptions({ ...rotateOptions, rotate });
      commit(snapshotOf({ rotate }));
      return;
    }
    const cropRotate = (((cropOptions.rotate + direction * 90) % 360) + 360) % 360;
    const rotate = cropRotate as CropOptionsValue['rotate'];
    const rect = fullRect(
      dimensionsAfterRotate({ width: bitmap?.width ?? 1, height: bitmap?.height ?? 1 }, rotate),
    );
    setCropOptions({ ...cropOptions, rotate, rect });
    commit(snapshotOf({ cropRotate: rotate, rect }));
  };

  const setAspectAndClamp = (nextAspect: Aspect) => {
    setAspect(nextAspect);
    const ratio = ASPECT_RATIO[nextAspect];
    if (!ratio) return;
    setCropOptions((current) => ({ ...current, rect: fitRectToRatio(current.rect, ratio, frame) }));
  };

  const setRectField = (key: keyof Rect, value: number) => {
    setCropOptions((current) => ({
      ...current,
      rect: clampRect({ ...current.rect, [key]: value }, frame),
    }));
  };

  const run = async (): Promise<void> => {
    if (!file || running) return;
    // A crop is uncommitted until Apply, as in the documented flow.
    if (tab === 'crop') commit(snapshotOf());
    setError(null);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const options =
        tab === 'crop'
          ? CropOptions.parse({ ...cropOptions, roundCorners: roundCornersRadius })
          : tab === 'transform'
            ? RotateOptions.parse(rotateOptions)
            : tab === 'adjust'
              ? AdjustOptions.parse(adjustOptions)
              : FilterOptions.parse(filterOptions);
      const op =
        tab === 'crop'
          ? 'crop'
          : tab === 'transform'
            ? 'rotate-flip'
            : tab === 'adjust'
              ? 'adjust'
              : 'filter';
      const result = await runner().run(
        { op, file, name: file.name, options },
        (next) => setProgress(next),
        controller.signal,
      );
      const url = URL.createObjectURL(result.blob);
      objectUrls.current.push(url);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      setOutcome(result);
      setProgress({ stage: 'done', pct: 1 });
    } catch (caught) {
      setOutcome(null);
      setError(
        caught instanceof AppError
          ? [caught.message, caught.hint].filter(Boolean).join(' ')
          : 'This image could not be edited.',
      );
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const runner = (): LocalRunner => {
    runnerRef.current ??= new LocalRunner();
    return runnerRef.current;
  };

  const reset = () => {
    const base = historyRef.current.entries[0] ?? snapshotOf();
    setHistory(createHistory(base));
    restore(base);
    setOutcome(null);
    setPreviewUrl(null);
    setError(null);
    setCompareHeld(false);
  };

  const activeFormat =
    tab === 'crop'
      ? cropOptions.format
      : tab === 'transform'
        ? rotateOptions.format
        : tab === 'adjust'
          ? adjustOptions.format
          : filterOptions.format;
  const activeQuality =
    tab === 'crop'
      ? cropOptions.quality
      : tab === 'transform'
        ? rotateOptions.quality
        : tab === 'adjust'
          ? adjustOptions.quality
          : filterOptions.quality;
  const setFormat = (format: CropOptionsValue['format']) => {
    if (tab === 'crop') setCropOptions({ ...cropOptions, format });
    else if (tab === 'transform') setRotateOptions({ ...rotateOptions, format });
    else if (tab === 'adjust') setAdjustOptions({ ...adjustOptions, format });
    else setFilterOptions({ ...filterOptions, format });
  };
  const setQuality = (quality: number) => {
    if (tab === 'crop') setCropOptions({ ...cropOptions, quality });
    else if (tab === 'transform') setRotateOptions({ ...rotateOptions, quality });
    else if (tab === 'adjust') setAdjustOptions({ ...adjustOptions, quality });
    else setFilterOptions({ ...filterOptions, quality });
  };
  const runLabel =
    tab === 'crop'
      ? 'Crop and export'
      : tab === 'transform'
        ? 'Rotate and export'
        : tab === 'adjust'
          ? 'Apply adjustments'
          : 'Apply filter';

  const exportItems =
    outcome && file
      ? [
          {
            id: 'edit-result',
            sourceName: file.name,
            blob: outcome.blob,
            width: outcome.metrics.outputWidth,
            height: outcome.metrics.outputHeight,
            format: outcome.metrics.outputFormat,
            quality: outcome.metrics.quality,
          },
        ]
      : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">edit</p>
        <h1 className="text-[28px] font-[650] leading-tight tracking-tight">
          Crop, rotate, adjust and filter
        </h1>
        <p className="max-w-2xl text-sm text-text-muted">
          A crop rectangle is drawn in the rotated frame and mapped back to source pixels, so the box you see
          is the region that is cut. Adjustments run as one LUT pass; filters are fixed recipes over the same
          primitives. Nothing is uploaded.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-lg border border-border bg-surface-2 p-1 text-sm">
          {(
            [
              ['crop', 'Crop'],
              ['transform', 'Rotate / flip'],
              ['adjust', 'Adjust'],
              ['filter', 'Filter'],
            ] as const
          ).map(([item, label]) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
                tab === item ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={undoEdit}
            disabled={running || !canUndo(history)}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={redoEdit}
            disabled={running || !canRedo(history)}
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={14} />
          </Button>
        </div>
      </div>

      {!bitmap ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files[0];
            if (dropped) void loadFile(dropped);
          }}
          className={`rounded-[var(--radius)] border-2 border-dashed p-10 text-center ${
            dragging ? 'border-accent bg-surface-3' : 'border-border bg-surface-2'
          }`}
        >
          <Upload className="mx-auto mb-2 text-text-muted" size={22} aria-hidden />
          <p className="text-sm font-medium">Drop one image here</p>
          <p className="mt-1 text-xs text-text-muted">
            Editing works on one image at a time; use Batch for many.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
            Browse files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.heic,.tif,.tiff"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void loadFile(chosen);
              event.target.value = '';
            }}
          />
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card
            title={
              tab === 'crop'
                ? 'Crop board'
                : tab === 'transform'
                  ? 'Transformed preview'
                  : tab === 'adjust'
                    ? 'Adjust preview'
                    : 'Filter preview'
            }
            description={
              tab === 'crop'
                ? 'Drag the box, or move it with the arrow keys (Shift = 10 px).'
                : tab === 'transform'
                  ? 'Rotate and flip as one operation; 90° steps are exact copies.'
                  : 'This preview is a CSS approximation; the export runs the exact LUT pipeline.'
            }
          >
            <div ref={boardRef} className="mt-4">
              {tab === 'crop' ? (
                <div
                  className="relative mx-auto"
                  style={{ width: frame.width * scale, height: frame.height * scale }}
                >
                  <canvas ref={canvasRef} className="block rounded border border-border" />
                  <button
                    type="button"
                    aria-label="Crop rectangle — drag to move, arrow keys to nudge, Shift for 10 px"
                    onKeyDown={keyboardMove}
                    onPointerDown={beginDrag('move')}
                    className="absolute cursor-move border-2 border-accent bg-accent/10 p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    style={{
                      left: cropOptions.rect.x * scale,
                      top: cropOptions.rect.y * scale,
                      width: cropOptions.rect.width * scale,
                      height: cropOptions.rect.height * scale,
                    }}
                  >
                    {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                      <span
                        key={handle}
                        aria-hidden
                        onPointerDown={beginDrag(handle)}
                        className="absolute h-3 w-3 rounded-sm border border-accent bg-surface"
                        style={{
                          left: handle.includes('w') ? -6 : undefined,
                          right: handle.includes('e') ? -6 : undefined,
                          top: handle.includes('n') ? -6 : undefined,
                          bottom: handle.includes('s') ? -6 : undefined,
                          cursor: `${handle}-resize`,
                        }}
                      />
                    ))}
                  </button>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="mx-auto block max-h-[420px] rounded border border-border"
                  style={{ filter: previewEffects(tab, adjustOptions, filterOptions) }}
                />
              )}

              {tab === 'crop' || tab === 'transform' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => rotateBoard(-1)}
                    aria-label="Rotate left 90 degrees"
                  >
                    <RotateCcw size={14} /> 90° left
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => rotateBoard(1)}
                    aria-label="Rotate right 90 degrees"
                  >
                    <RotateCw size={14} /> 90° right
                  </Button>
                  <span className="text-xs text-text-muted">
                    {formatDimensions(frame.width, frame.height)} · rotation {cropOptions.rotate}°
                  </span>
                </div>
              ) : null}
            </div>
          </Card>

          <div className="space-y-4">
            <Card title="Options">
              {tab === 'crop' ? (
                <div className="mt-4 space-y-4">
                  <Field label="Aspect">
                    <select
                      className={INPUT}
                      value={aspect}
                      onChange={(event) => setAspectAndClamp(event.target.value as Aspect)}
                    >
                      <option value="free">Free</option>
                      <option value="1:1">1:1</option>
                      <option value="4:3">4:3</option>
                      <option value="3:4">3:4</option>
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                    </select>
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                      <Field key={key} label={key}>
                        <input
                          className={INPUT}
                          type="number"
                          value={cropOptions.rect[key]}
                          onChange={(event) => setRectField(key, Number(event.target.value))}
                        />
                      </Field>
                    ))}
                  </div>

                  <Field label={`Round corners · ${roundCornersRadius} px`}>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={roundCornersRadius}
                      onChange={(event) => setRoundCornersRadius(Number(event.target.value))}
                      className="mt-3 w-full accent-[var(--accent)]"
                    />
                  </Field>
                </div>
              ) : tab === 'transform' ? (
                <div className="mt-4 space-y-4">
                  <Field label="Angle" hint="Multiples of 90° are exact; other angles resample once.">
                    <input
                      className={INPUT}
                      type="number"
                      min={-360}
                      max={360}
                      value={rotateOptions.rotate}
                      onChange={(event) =>
                        setRotateOptions({ ...rotateOptions, rotate: Number(event.target.value) })
                      }
                      onBlur={() => commit(snapshotOf())}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                    />
                  </Field>
                  <div className="flex gap-2">
                    {[90, 180, 270].map((angle) => (
                      <Button
                        key={angle}
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRotateOptions({ ...rotateOptions, rotate: angle });
                          commit(snapshotOf({ rotate: angle }));
                        }}
                      >
                        {angle}°
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm text-text-muted">
                      <input
                        type="checkbox"
                        checked={rotateOptions.flipH}
                        onChange={(event) => {
                          setRotateOptions({ ...rotateOptions, flipH: event.target.checked });
                          commit(snapshotOf({ flipH: event.target.checked }));
                        }}
                      />
                      Flip horizontally
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text-muted">
                      <input
                        type="checkbox"
                        checked={rotateOptions.flipV}
                        onChange={(event) => {
                          setRotateOptions({ ...rotateOptions, flipV: event.target.checked });
                          commit(snapshotOf({ flipV: event.target.checked }));
                        }}
                      />
                      Flip vertically
                    </label>
                  </div>
                </div>
              ) : tab === 'adjust' ? (
                <AdjustPanel
                  value={adjustOptions}
                  onChange={setAdjustOptions}
                  onCommit={(value) => commit(snapshotOf({ adjust: toneOf(value) }))}
                />
              ) : (
                <FilterPanel
                  value={filterOptions}
                  onChange={setFilterOptions}
                  onCommit={(value) => commit(snapshotOf({ filter: filterOf(value) }))}
                />
              )}

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Field label="Format">
                  <select
                    className={INPUT}
                    value={activeFormat}
                    onChange={(event) => setFormat(event.target.value as CropOptionsValue['format'])}
                  >
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                    <option value="jpeg">JPEG</option>
                    <option value="avif">AVIF</option>
                  </select>
                </Field>
                <Field label="Quality">
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={activeQuality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    className="mt-3 w-full accent-[var(--accent)]"
                  />
                </Field>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void run()} disabled={running}>
                  {running ? <Loader2 className="animate-spin" size={15} /> : null}
                  {running ? 'Processing…' : runLabel}
                </Button>
                {running ? (
                  <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={reset} disabled={running}>
                  Reset
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    bitmap?.close();
                    setBitmap(null);
                    setFile(null);
                    setSniffed(null);
                    setOutcome(null);
                    setPreviewUrl(null);
                    setError(null);
                  }}
                  aria-label="Remove this image"
                >
                  <X size={14} /> Remove
                </Button>
              </div>

              {running && progress ? (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full bg-accent" style={{ width: `${progress.pct * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {progress.stage} · {Math.round(progress.pct * 100)} %
                  </p>
                </div>
              ) : null}

              {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            </Card>

            {outcome && previewUrl ? (
              <Card title="Result">
                <img
                  src={compareHeld && originalUrl ? originalUrl : previewUrl}
                  alt={compareHeld ? 'Original image' : 'Edited result'}
                  className="mt-3 max-h-60 w-full rounded border border-border object-contain"
                />
                <p className="mt-3 text-xs text-text-muted">
                  {formatBytes(outcome.metrics.inputBytes)} →{' '}
                  <span className="font-medium text-text">{formatBytes(outcome.metrics.outputBytes)}</span> ·{' '}
                  {formatDimensions(outcome.metrics.outputWidth, outcome.metrics.outputHeight)} ·{' '}
                  {outcome.metrics.outputFormat.toUpperCase()} · {outcome.metrics.durationMs} ms
                </p>
                {outcome.warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-xs text-warning">
                    {warning}
                  </p>
                ))}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onPointerDown={() => {
                      if (!originalUrl && file) {
                        const url = URL.createObjectURL(file);
                        objectUrls.current.push(url);
                        setOriginalUrl(url);
                      }
                      setCompareHeld(true);
                    }}
                    onPointerUp={() => setCompareHeld(false)}
                    onPointerLeave={() => setCompareHeld(false)}
                  >
                    Hold to compare
                  </Button>
                </div>
              </Card>
            ) : null}

            {exportItems.length > 0 ? (
              <ExportPanel items={exportItems} runner={runner} disabled={running} />
            ) : null}

            {sniffed ? (
              <p className="text-xs text-text-muted">
                Source: {sniffed.format.toUpperCase()} · {formatBytes(sniffed.bytes)}
                {file ? ` · ${file.name}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

const ADJUST_CONTROLS = [
  ['brightness', 'Brightness', -100, 100],
  ['contrast', 'Contrast', -100, 100],
  ['saturation', 'Saturation', -100, 100],
  ['exposure', 'Exposure', -100, 100],
  ['temperature', 'Temperature', -100, 100],
  ['tint', 'Tint', -100, 100],
  ['hue', 'Hue', -180, 180],
  ['sharpen', 'Sharpen', 0, 100],
] as const;

function AdjustPanel({
  value,
  onChange,
  onCommit,
}: {
  value: AdjustOptionsValue;
  onChange: (next: AdjustOptionsValue) => void;
  onCommit: (value: AdjustOptionsValue) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      {ADJUST_CONTROLS.map(([key, label, min, max]) => (
        <label key={key} className="block space-y-1">
          <span className="flex justify-between text-xs text-text-muted">
            <span className="font-medium uppercase tracking-wide">{label}</span>
            <span>{value[key]}</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            value={value[key]}
            onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
            onPointerUp={() => onCommit(value)}
            onKeyUp={() => onCommit(value)}
            onBlur={() => onCommit(value)}
            className="w-full accent-[var(--accent)]"
          />
        </label>
      ))}

      <label className="block space-y-1">
        <span className="flex justify-between text-xs text-text-muted">
          <span className="font-medium uppercase tracking-wide">Gamma</span>
          <span>{value.gamma.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.05}
          value={value.gamma}
          onChange={(event) => onChange({ ...value, gamma: Number(event.target.value) })}
          onPointerUp={() => onCommit(value)}
          onKeyUp={() => onCommit(value)}
          onBlur={() => onCommit(value)}
          className="w-full accent-[var(--accent)]"
        />
      </label>

      <p className="text-[11px] text-text-muted">
        The preview approximates brightness/contrast/saturation/hue; exposure, tint, gamma and sharpen are
        applied exactly on export.
      </p>
    </div>
  );
}

const FILTER_LABELS: Record<FilterName, string> = {
  none: 'None',
  grayscale: 'Grayscale',
  sepia: 'Sepia',
  vintage: 'Vintage',
  mono: 'Mono',
  blur: 'Blur',
  invert: 'Invert',
  warm: 'Warm',
  cool: 'Cool',
  sharpen: 'Sharpen',
};

function FilterPanel({
  value,
  onChange,
  onCommit,
}: {
  value: FilterOptionsValue;
  onChange: (next: FilterOptionsValue) => void;
  onCommit: (value: FilterOptionsValue) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => {
              const next = { ...value, filter };
              onChange(next);
              onCommit(next);
            }}
            className={`rounded-lg border px-2 py-1.5 text-sm ${
              value.filter === filter
                ? 'border-accent bg-accent/10 font-medium text-text'
                : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            {FILTER_LABELS[filter]}
          </button>
        ))}
      </div>

      <label className="block space-y-1">
        <span className="flex justify-between text-xs text-text-muted">
          <span className="font-medium uppercase tracking-wide">Intensity</span>
          <span>{value.intensity} %</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={value.intensity}
          onChange={(event) => onChange({ ...value, intensity: Number(event.target.value) })}
          onPointerUp={() => onCommit(value)}
          onKeyUp={() => onCommit(value)}
          onBlur={() => onCommit(value)}
          className="w-full accent-[var(--accent)]"
        />
      </label>

      <p className="text-[11px] text-text-muted">
        Blur and sharpen are approximate in the preview and exact on export.
      </p>
    </div>
  );
}
