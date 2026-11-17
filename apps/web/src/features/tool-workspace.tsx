'use client';

import { ExportPanel } from '@/features/export-panel';
import { type JobOutcome, LocalRunner } from '@/lib/local-runner';
import {
  AppError,
  CompressOptions,
  type CompressOptionsValue,
  ConvertOptions,
  type ConvertOptionsValue,
  ResizeOptions,
  type ResizeOptionsValue,
  type ToolId,
  type Warning,
  getTool,
} from '@ri/contracts';
import { type Sniffed, describeRejection, sniffBlob } from '@ri/image-browser';
import { formatBytes, formatDimensions, formatMegapixels, toMegabytes } from '@ri/image-core';
import { Button, Card } from '@ri/ui';
import { Loader2, Upload, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

type WorkspaceTool = 'convert' | 'compress' | 'resize';

type RowStatus = 'ready' | 'running' | 'done' | 'failed' | 'cancelled';

type Row = {
  id: string;
  file: File;
  sniffed: Sniffed;
  status: RowStatus;
  pct: number;
  stage: string;
  outcome?: JobOutcome;
  previewUrl?: string;
  originalUrl?: string;
  error?: string;
};

const WARNING_TEXT: Record<Warning, string> = {
  METADATA_DROPPED: 'Metadata was dropped — the canvas encoder cannot carry EXIF or ICC.',
  ALPHA_FLATTENED: 'Transparency was flattened onto the background colour.',
  ENCODER_FALLBACK: 'The browser produced a different format than requested.',
  TARGET_SIZE_UNREACHABLE: 'The target size could not be reached; this is the smallest result.',
  SKIPPED_ALREADY_SMALLER: 'The source was already smaller than the target.',
  ALPHA_INVERTED: 'The alpha channel looks inverted — check the matte.',
  LOW_SUBJECT_COVERAGE: 'The subject covers very little of the frame.',
  DEPRECATED_OPTION: 'An option was ignored because it is deprecated.',
};

const STAGE_LABEL: Record<string, string> = {
  sniff: 'Reading the header',
  decode: 'Decoding',
  transform: 'Processing',
  encode: 'Encoding',
  measure: 'Measuring',
  release: 'Finishing',
  done: 'Done',
};

function delta(inputBytes: number, outputBytes: number): { label: string; grew: boolean } {
  if (inputBytes === 0) return { label: '—', grew: false };
  const pct = ((outputBytes - inputBytes) / inputBytes) * 100;
  return {
    label: `${pct > 0 ? '+' : ''}${pct.toFixed(1)} %`,
    grew: pct > 0,
  };
}

export function ToolWorkspace({ toolId }: { toolId: WorkspaceTool }) {
  const tool = getTool(toolId);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);

  const [convert, setConvert] = useState<ConvertOptionsValue>(() => ConvertOptions.parse({}));
  const [compress, setCompress] = useState<CompressOptionsValue>(() => CompressOptions.parse({}));
  const [resize, setResize] = useState<ResizeOptionsValue>(() => ResizeOptions.parse({ width: 1080 }));

  const runnerRef = useRef<LocalRunner | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      runnerRef.current?.dispose();
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  const runner = (): LocalRunner => {
    runnerRef.current ??= new LocalRunner();
    return runnerRef.current;
  };

  const update = useCallback((id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const accepted = Array.from(files).slice(0, 8);
    const next = await Promise.all(
      accepted.map(async (file) => {
        const sniffed = await sniffBlob(file);
        return {
          id: crypto.randomUUID(),
          file,
          sniffed,
          status: 'ready' as RowStatus,
          pct: 0,
          stage: 'sniff',
        } satisfies Row;
      }),
    );
    setRows((current) => [...current, ...next].slice(0, 8));
  }, []);

  const parseOptions = ():
    | { ok: true; data: ConvertOptionsValue | CompressOptionsValue | ResizeOptionsValue }
    | { ok: false; message: string } => {
    const result =
      toolId === 'convert'
        ? ConvertOptions.safeParse(convert)
        : toolId === 'compress'
          ? CompressOptions.safeParse(compress)
          : ResizeOptions.safeParse(resize);
    if (result.success) return { ok: true, data: result.data };
    const issue = result.error.issues[0];
    return {
      ok: false,
      message: issue ? `${issue.path.join('.') || 'options'}: ${issue.message}` : 'Check the options.',
    };
  };

  const run = async (): Promise<void> => {
    if (rows.length === 0 || running) return;
    const parsed = parseOptions();
    if (!parsed.ok) {
      setFormError(parsed.message);
      return;
    }
    setFormError(null);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for (const row of rows) {
        if (row.status === 'done') continue;
        if (row.sniffed.format === 'unknown' || row.sniffed.animated) {
          update(row.id, { status: 'failed', error: describeRejection(row.sniffed) });
          continue;
        }

        update(row.id, { status: 'running', pct: 0, error: undefined });
        try {
          const outcome = await runner().run(
            { op: toolId as ToolId, file: row.file, name: row.file.name, options: parsed.data },
            (progress) => update(row.id, { pct: progress.pct, stage: progress.stage }),
            controller.signal,
          );
          const previewUrl = URL.createObjectURL(outcome.blob);
          objectUrls.current.push(previewUrl);
          update(row.id, { status: 'done', pct: 1, stage: 'done', outcome, previewUrl });
        } catch (error) {
          if (error instanceof AppError && error.code === 'CANCELLED') {
            update(row.id, { status: 'cancelled', error: 'Cancelled.' });
            break;
          }
          update(row.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'This image could not be processed.',
          });
        }
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  const remove = (id: string): void => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const toggleCompare = (row: Row, pressed: boolean): void => {
    if (pressed) {
      if (!row.originalUrl) {
        const url = URL.createObjectURL(row.file);
        objectUrls.current.push(url);
        update(row.id, { originalUrl: url });
      }
      setCompareId(row.id);
    } else {
      setCompareId(null);
    }
  };

  const exportItems = rows.flatMap((row) => {
    if (!row.outcome) return [];
    return [
      {
        id: row.id,
        sourceName: row.file.name,
        blob: row.outcome.blob,
        width: row.outcome.metrics.outputWidth,
        height: row.outcome.metrics.outputHeight,
        format: row.outcome.metrics.outputFormat,
        quality: row.outcome.metrics.quality,
      },
    ];
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{tool.category}</p>
        <h1 className="text-[28px] font-[650] leading-tight tracking-tight">{tool.title}</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          Runs in this tab · {tool.batch ? 'batch supported' : 'one file at a time'} · up to{' '}
          {formatMegapixels(tool.limits.maxPixels)} and {toMegabytes(tool.limits.maxBytes)} MB per file.
          Nothing is uploaded.
        </p>
      </header>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(event.dataTransfer.files);
        }}
        className={`rounded-[var(--radius)] border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-accent bg-surface-3' : 'border-border bg-surface-2'
        }`}
      >
        <Upload className="mx-auto mb-2 text-text-muted" size={20} aria-hidden />
        <p className="text-sm font-medium">Drop images here, or paste a file</p>
        <p className="mt-1 text-xs text-text-muted">The header is read locally; a PDF is refused by name.</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
          Browse files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.heic,.tif,.tiff"
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {rows.length > 0 ? (
        <Card
          title="Files"
          description="Each row is one job. Processing is sequential so a phone stays usable."
        >
          <ul className="mt-4 divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex items-start gap-3">
                  {row.previewUrl ? (
                    <img
                      src={compareId === row.id && row.originalUrl ? row.originalUrl : row.previewUrl}
                      alt={`${row.file.name} preview`}
                      className="h-12 w-12 shrink-0 rounded border border-border object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded border border-border bg-surface-3" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">{row.file.name}</p>
                      <button
                        type="button"
                        onClick={() => remove(row.id)}
                        aria-label={`Remove ${row.file.name}`}
                        className="text-text-muted hover:text-danger"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    <p className="mt-0.5 text-xs text-text-muted">
                      {row.sniffed.format.toUpperCase()}
                      {row.sniffed.width && row.sniffed.height
                        ? ` · ${formatDimensions(row.sniffed.width, row.sniffed.height)}`
                        : ''}{' '}
                      · {formatBytes(row.file.size)}
                    </p>

                    {row.status === 'running' ? (
                      <div className="mt-2">
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                          role="progressbar"
                          tabIndex={0}
                          aria-label={`${row.file.name} progress`}
                          aria-valuenow={Math.round(row.pct * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full bg-accent transition-[width]"
                            style={{ width: `${row.pct * 100}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          {STAGE_LABEL[row.stage] ?? row.stage} · {Math.round(row.pct * 100)} %
                        </p>
                      </div>
                    ) : null}

                    {row.error ? <p className="mt-1.5 text-xs text-danger">{row.error}</p> : null}

                    {row.outcome ? (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-xs text-text-muted">
                          {formatBytes(row.outcome.metrics.inputBytes)} →{' '}
                          <span className="font-medium text-text">
                            {formatBytes(row.outcome.metrics.outputBytes)}
                          </span>{' '}
                          <span
                            className={
                              delta(row.outcome.metrics.inputBytes, row.outcome.metrics.outputBytes).grew
                                ? 'text-warning'
                                : 'text-success'
                            }
                          >
                            ({delta(row.outcome.metrics.inputBytes, row.outcome.metrics.outputBytes).label})
                          </span>{' '}
                          ·{' '}
                          {formatDimensions(
                            row.outcome.metrics.outputWidth,
                            row.outcome.metrics.outputHeight,
                          )}{' '}
                          · {row.outcome.metrics.outputFormat.toUpperCase()}
                          {row.outcome.metrics.quality ? ` q${row.outcome.metrics.quality}` : ''} ·{' '}
                          {row.outcome.metrics.durationMs} ms
                        </p>
                        {row.outcome.warnings.map((warning) => (
                          <p key={warning} className="text-xs text-warning">
                            {WARNING_TEXT[warning]}
                          </p>
                        ))}
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onPointerDown={() => toggleCompare(row, true)}
                            onPointerUp={() => toggleCompare(row, false)}
                            onPointerLeave={() => toggleCompare(row, false)}
                          >
                            Hold to compare
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void run()} disabled={running || rows.length === 0}>
              {running ? <Loader2 className="animate-spin" size={15} /> : null}
              {running ? 'Processing…' : `Run ${tool.title.toLowerCase()}`}
            </Button>
            {running ? (
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setRows([])} disabled={running || rows.length === 0}>
              Clear
            </Button>
          </div>
        </Card>
      ) : null}

      {exportItems.length > 0 ? <ExportPanel items={exportItems} runner={runner} disabled={running} /> : null}

      <Card title="Options" description="Validated by the same schema the worker parses.">
        {toolId === 'convert' ? <ConvertPanel value={convert} onChange={setConvert} /> : null}
        {toolId === 'compress' ? <CompressPanel value={compress} onChange={setCompress} /> : null}
        {toolId === 'resize' ? <ResizePanel value={resize} onChange={setResize} /> : null}
        {formError ? <p className="mt-3 text-sm text-danger">{formError}</p> : null}
      </Card>
    </div>
  );
}

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

const INPUT =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const SELECT = INPUT;

function numberValue(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ConvertPanel({
  value,
  onChange,
}: { value: ConvertOptionsValue; onChange: (next: ConvertOptionsValue) => void }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Format">
        <select
          className={SELECT}
          value={value.format}
          onChange={(event) =>
            onChange({ ...value, format: event.target.value as ConvertOptionsValue['format'] })
          }
        >
          <option value="webp">WebP</option>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="avif">AVIF</option>
        </select>
      </Field>

      <Field
        label={`Quality · ${value.quality}`}
        hint={value.format === 'png' ? 'PNG ignores quality.' : undefined}
      >
        <input
          type="range"
          min={1}
          max={100}
          value={value.quality}
          onChange={(event) => onChange({ ...value, quality: Number(event.target.value) })}
          className="mt-3 w-full accent-[var(--accent)]"
        />
      </Field>

      <Field label="Background" hint="Used when the target has no alpha and the source does.">
        <input
          type="color"
          value={value.background}
          onChange={(event) => onChange({ ...value, background: event.target.value })}
          className="h-9 w-full rounded-lg border border-border bg-surface"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          checked={value.keepMetadata}
          onChange={(event) => onChange({ ...value, keepMetadata: event.target.checked })}
        />
        Keep metadata (the canvas cannot — a warning is shown)
      </label>
    </div>
  );
}

function CompressPanel({
  value,
  onChange,
}: { value: CompressOptionsValue; onChange: (next: CompressOptionsValue) => void }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Mode">
        <select
          className={SELECT}
          value={value.mode}
          onChange={(event) => onChange({ ...value, mode: event.target.value as 'quality' | 'target' })}
        >
          <option value="quality">Quality</option>
          <option value="target">Target file size</option>
        </select>
      </Field>

      {value.mode === 'quality' ? (
        <Field label={`Quality · ${value.quality}`}>
          <input
            type="range"
            min={1}
            max={100}
            value={value.quality}
            onChange={(event) => onChange({ ...value, quality: Number(event.target.value) })}
            className="mt-3 w-full accent-[var(--accent)]"
          />
        </Field>
      ) : (
        <Field label="Target (KB)" hint="10 KB – 50 MB. The search tries at most six qualities.">
          <input
            className={INPUT}
            type="number"
            min={10}
            value={value.targetBytes ? Math.round(value.targetBytes / 1024) : 300}
            onChange={(event) => {
              const kb = numberValue(event.target.value);
              onChange({
                ...value,
                targetBytes: kb === undefined ? undefined : Math.max(10_000, Math.round(kb * 1024)),
              });
            }}
          />
        </Field>
      )}

      <Field label="Format" hint="PNG is refused: it has no quality knob.">
        <select
          className={SELECT}
          value={value.format}
          onChange={(event) =>
            onChange({ ...value, format: event.target.value as CompressOptionsValue['format'] })
          }
        >
          <option value="webp">WebP</option>
          <option value="jpeg">JPEG</option>
          <option value="avif">AVIF</option>
        </select>
      </Field>

      <Field label="Max width" hint="Optional. Applied before the encode, never upscales.">
        <input
          className={INPUT}
          type="number"
          min={16}
          value={value.maxWidth ?? ''}
          onChange={(event) => onChange({ ...value, maxWidth: numberValue(event.target.value) })}
        />
      </Field>

      <Field label="Max height" hint="Optional.">
        <input
          className={INPUT}
          type="number"
          min={16}
          value={value.maxHeight ?? ''}
          onChange={(event) => onChange({ ...value, maxHeight: numberValue(event.target.value) })}
        />
      </Field>

      <Field label="Background" hint="Flatten colour when the source has alpha and the target does not.">
        <input
          type="color"
          value={value.background}
          onChange={(event) => onChange({ ...value, background: event.target.value })}
          className="h-9 w-full rounded-lg border border-border bg-surface"
        />
      </Field>
    </div>
  );
}

function ResizePanel({
  value,
  onChange,
}: { value: ResizeOptionsValue; onChange: (next: ResizeOptionsValue) => void }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Basis">
        <select
          className={SELECT}
          value={value.basis}
          onChange={(event) =>
            onChange({ ...value, basis: event.target.value as ResizeOptionsValue['basis'] })
          }
        >
          <option value="dimensions">Width / height</option>
          <option value="percentage">Percentage</option>
          <option value="maxEdge">Longest edge</option>
        </select>
      </Field>

      {value.basis === 'dimensions' ? (
        <>
          <Field label="Width (px)">
            <input
              className={INPUT}
              type="number"
              min={1}
              value={value.width ?? ''}
              onChange={(event) => onChange({ ...value, width: numberValue(event.target.value) })}
            />
          </Field>
          <Field label="Height (px)" hint="Leave one empty to derive it from the aspect ratio.">
            <input
              className={INPUT}
              type="number"
              min={1}
              value={value.height ?? ''}
              onChange={(event) => onChange({ ...value, height: numberValue(event.target.value) })}
            />
          </Field>
        </>
      ) : null}

      {value.basis === 'percentage' ? (
        <Field label={`Percentage · ${value.percentage} %`}>
          <input
            type="range"
            min={1}
            max={400}
            value={value.percentage}
            onChange={(event) => onChange({ ...value, percentage: Number(event.target.value) })}
            className="mt-3 w-full accent-[var(--accent)]"
          />
        </Field>
      ) : null}

      {value.basis === 'maxEdge' ? (
        <Field label="Longest edge (px)">
          <input
            className={INPUT}
            type="number"
            min={16}
            value={value.maxEdge ?? ''}
            onChange={(event) => onChange({ ...value, maxEdge: numberValue(event.target.value) })}
          />
        </Field>
      ) : null}

      <Field label="Fit">
        <select
          className={SELECT}
          value={value.fit}
          onChange={(event) => onChange({ ...value, fit: event.target.value as ResizeOptionsValue['fit'] })}
        >
          <option value="fit">Fit inside the box</option>
          <option value="contain">Contain (pad)</option>
          <option value="fill">Fill (crop)</option>
          <option value="cover">Cover (crop)</option>
          <option value="stretch">Stretch</option>
        </select>
      </Field>

      <Field label="Resample">
        <select
          className={SELECT}
          value={value.filter}
          onChange={(event) => onChange({ ...value, filter: event.target.value as 'auto' | 'nearest' })}
        >
          <option value="auto">Smooth (photos)</option>
          <option value="nearest">Nearest (pixel art)</option>
        </select>
      </Field>

      <Field
        label="Output format"
        hint="Auto keeps the source format; anything the canvas cannot write becomes PNG."
      >
        <select
          className={SELECT}
          value={value.format ?? 'auto'}
          onChange={(event) =>
            onChange({
              ...value,
              ...(event.target.value === 'auto'
                ? { format: undefined }
                : { format: event.target.value as 'jpeg' | 'png' | 'webp' | 'avif' }),
            })
          }
        >
          <option value="auto">Auto</option>
          <option value="webp">WebP</option>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="avif">AVIF</option>
        </select>
      </Field>

      <Field label={`Quality · ${value.quality}`}>
        <input
          type="range"
          min={1}
          max={100}
          value={value.quality}
          onChange={(event) => onChange({ ...value, quality: Number(event.target.value) })}
          className="mt-3 w-full accent-[var(--accent)]"
        />
      </Field>

      <Field label="Background" hint="Padding in contain mode.">
        <input
          type="color"
          value={value.background}
          onChange={(event) => onChange({ ...value, background: event.target.value })}
          className="h-9 w-full rounded-lg border border-border bg-surface"
        />
      </Field>

      <div className="flex flex-col gap-2 pt-1">
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={value.lockAspect}
            onChange={(event) => onChange({ ...value, lockAspect: event.target.checked })}
          />
          Lock aspect ratio
        </label>
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={value.allowUpscale}
            onChange={(event) => onChange({ ...value, allowUpscale: event.target.checked })}
          />
          Allow upscaling
        </label>
      </div>
    </div>
  );
}
