'use client';

import { saveBlob } from '@/lib/download';
import type { LocalRunner } from '@/lib/local-runner';
import { AppError, ConvertOptions } from '@ri/contracts';
import { EXTENSION, type OutputFormat, buildZip, formatFromMime } from '@ri/image-browser';
import { type Naming, type NamingMode, dedupeNames, formatBytes, outputName } from '@ri/image-core';
import { Button, Card } from '@ri/ui';
import { Download, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export type ExportItem = {
  id: string;
  sourceName: string;
  blob: Blob;
  width: number;
  height: number;
  /** The format the tool reported; the blob's MIME type remains authoritative. */
  format: string;
  quality: number | null;
};

type FormatChoice = 'original' | OutputFormat;
type Container = 'files' | 'zip';

const OUTPUT_FORMATS: readonly OutputFormat[] = ['jpeg', 'png', 'webp', 'avif'];

const FORMAT_LABEL: Record<OutputFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
};

const ZIP_NAME = 'rumindium-images.zip';
const ZIP_MEMORY_WARNING_BYTES = 268_435_456;

const INPUT =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

function formatOf(item: ExportItem): OutputFormat {
  return formatFromMime(item.blob.type) ?? (isOutputFormat(item.format) ? item.format : 'png');
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

type ProgressState = { done: number; total: number; pct: number; label: string };

/**
 * The one export surface (docs/13-EXPORT-MANAGER.md). Naming comes from image-core, the extension
 * comes from the encoded MIME type, and a format/quality override re-encodes through the worker
 * before anything is named or saved.
 */
export function ExportPanel({
  items,
  runner,
  disabled = false,
}: {
  items: ExportItem[];
  runner: () => LocalRunner;
  disabled?: boolean;
}) {
  const [format, setFormat] = useState<FormatChoice>('original');
  const [quality, setQuality] = useState(() => items[0]?.quality ?? 82);
  const [overrideQuality, setOverrideQuality] = useState(false);
  const [mode, setMode] = useState<NamingMode>('suffix');
  const [suffix, setSuffix] = useState('');
  const [template, setTemplate] = useState('{name}-{width}x{height}');
  const [startIndex, setStartIndex] = useState(1);
  const [container, setContainer] = useState<Container>('zip');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const plans = useMemo(
    () =>
      items.map((item) => ({
        item,
        format: format === 'original' ? formatOf(item) : format,
      })),
    [items, format],
  );

  const naming: Naming = { mode, suffix, template, startIndex };
  const names = dedupeNames(
    plans.map((plan, index) =>
      outputName(naming, {
        sourceName: plan.item.sourceName,
        format: EXTENSION[plan.format],
        width: plan.item.width,
        height: plan.item.height,
        index: startIndex + index,
      }),
    ),
  );

  const totalBytes = items.reduce((sum, item) => sum + item.blob.size, 0);
  const pngOnly = plans.length > 0 && plans.every((plan) => plan.format === 'png');
  const reencode = format !== 'original' || (overrideQuality && !pngOnly);
  const effectiveContainer: Container = items.length > 1 ? container : 'files';
  const qualityActive = reencode && !pngOnly;
  const qualityLabel = pngOnly
    ? 'Quality · ignored for PNG'
    : reencode
      ? `Quality · ${quality}`
      : 'Quality · from each result';
  const actionLabel =
    effectiveContainer === 'zip'
      ? `Download ZIP (${items.length})`
      : items.length === 1
        ? 'Download'
        : `Download ${items.length} files`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing a setting clears the previous export's status
  useEffect(() => {
    setSaved(null);
    setError(null);
  }, [format, quality, overrideQuality, mode, suffix, template, startIndex, container]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  const exportNow = async (): Promise<void> => {
    if (items.length === 0 || exporting || disabled) return;

    setExporting(true);
    setError(null);
    setSaved(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const total = plans.length;

    try {
      const outputs: Array<{ name: string; blob: Blob }> = [];

      for (const [index, plan] of plans.entries()) {
        if (controller.signal.aborted) throw new AppError('CANCELLED', 'Cancelled.');
        const name = names[index];
        if (!name) throw new AppError('EXPORT_FAILED', 'The output could not be named.');
        if (name.includes('/') || name.includes('\\')) {
          throw new AppError('EXPORT_FAILED', 'The output name is not safe to save.');
        }

        setProgress({
          done: index,
          total,
          pct: 0,
          label: reencode ? `Re-encoding ${index + 1} of ${total}` : 'Preparing the download',
        });

        let blob = plan.item.blob;
        if (reencode) {
          const options = ConvertOptions.parse({
            format: plan.format,
            quality: qualityActive ? quality : 88,
            background: '#ffffff',
            keepMetadata: false,
            naming: { mode: 'keep', suffix: '', startIndex: 1 },
          });
          const file = new File([plan.item.blob], plan.item.sourceName, { type: plan.item.blob.type });
          const outcome = await runner().run(
            { op: 'convert', file, name: plan.item.sourceName, options },
            (next) =>
              setProgress({
                done: index,
                total,
                pct: next.pct,
                label: `${next.stage[0]?.toUpperCase() ?? ''}${next.stage.slice(1)}`,
              }),
            controller.signal,
          );
          blob = outcome.blob;
        }

        const actual = formatFromMime(blob.type);
        if (actual !== plan.format) {
          throw new AppError(
            'ENCODING_FAILED',
            `The encoder produced ${blob.type || 'an unknown type'} instead of ${FORMAT_LABEL[plan.format]}. The file was not saved under a misleading name.`,
          );
        }

        outputs.push({ name, blob });
      }

      if (effectiveContainer === 'zip') {
        setProgress({ done: total, total, pct: 1, label: 'Building the archive' });
        const zip = await buildZip(outputs);
        saveBlob(zip, ZIP_NAME);
        setSaved(`Saved ${ZIP_NAME} · ${outputs.length} files · ${formatBytes(zip.size)}`);
      } else {
        for (const output of outputs) saveBlob(output.blob, output.name);
        const first = outputs[0];
        setSaved(
          outputs.length === 1 && first
            ? `Saved ${first.name} · ${formatBytes(first.blob.size)}`
            : `Saved ${outputs.length} files`,
        );
      }
    } catch (caught) {
      if (caught instanceof AppError && caught.code === 'CANCELLED') {
        setError('Export cancelled. Your results are still here.');
      } else {
        setError(
          caught instanceof AppError
            ? [caught.message, caught.hint].filter(Boolean).join(' ')
            : 'The file could not be saved. Your results are still here.',
        );
      }
    } finally {
      setExporting(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const progressPct = progress ? Math.min(1, (progress.done + progress.pct) / progress.total) : 0;

  return (
    <Card
      title="Export"
      description="Naming and overrides apply to every result; the extension follows the encoded type."
    >
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="Format"
          hint={
            format === 'original'
              ? 'Each result keeps the format the tool produced.'
              : 'The override re-encodes every result once.'
          }
        >
          <select
            className={INPUT}
            value={format}
            disabled={exporting}
            onChange={(event) => setFormat(event.target.value as FormatChoice)}
          >
            <option value="original">Original (per result)</option>
            {OUTPUT_FORMATS.map((option) => (
              <option key={option} value={option}>
                {FORMAT_LABEL[option]}
              </option>
            ))}
          </select>
        </Field>

        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{qualityLabel}</span>
          <input
            type="range"
            min={1}
            max={100}
            value={quality}
            disabled={exporting || !qualityActive}
            onChange={(event) => setQuality(Number(event.target.value))}
            className="mt-3 w-full accent-[var(--accent)] disabled:opacity-50"
          />
          {format === 'original' ? (
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={overrideQuality}
                disabled={exporting || pngOnly}
                onChange={(event) => setOverrideQuality(event.target.checked)}
              />
              Re-encode at this quality
            </label>
          ) : (
            <p className="text-[11px] text-text-muted">A format override re-encodes each result once.</p>
          )}
        </div>

        <Field label="Naming">
          <select
            className={INPUT}
            value={mode}
            disabled={exporting}
            onChange={(event) => setMode(event.target.value as NamingMode)}
          >
            <option value="suffix">Suffix</option>
            <option value="keep">Keep the name</option>
            <option value="template">Template</option>
          </select>
        </Field>

        {mode === 'suffix' ? (
          <Field label="Suffix" hint="Appended to the base name; empty keeps the name.">
            <input
              className={INPUT}
              value={suffix}
              maxLength={24}
              disabled={exporting}
              placeholder="-web"
              onChange={(event) => setSuffix(event.target.value)}
            />
          </Field>
        ) : null}

        {mode === 'template' ? (
          <>
            <Field label="Template" hint="{name} {width} {height} {format} {index}">
              <input
                className={INPUT}
                value={template}
                maxLength={80}
                disabled={exporting}
                onChange={(event) => setTemplate(event.target.value)}
              />
            </Field>
            <Field label="Start index" hint="Used by {index}; collisions still get a numeric suffix.">
              <input
                className={INPUT}
                type="number"
                min={1}
                max={9999}
                value={startIndex}
                disabled={exporting}
                onChange={(event) =>
                  setStartIndex(Math.max(1, Math.min(9999, Number(event.target.value) || 1)))
                }
              />
            </Field>
          </>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            File names
          </span>
          <span className="text-[11px] text-text-muted">
            {items.length} {items.length === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}
          </span>
        </div>
        <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto font-mono text-xs text-text">
          {names.map((name) => (
            <li key={name} className="truncate" title={name}>
              {name}
            </li>
          ))}
        </ul>
      </div>

      {items.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Container</span>
          <button
            type="button"
            aria-pressed={container === 'files'}
            disabled={exporting}
            onClick={() => setContainer('files')}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
              container === 'files'
                ? 'border-accent bg-accent/10 text-text'
                : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            Separate files
          </button>
          <button
            type="button"
            aria-pressed={container === 'zip'}
            disabled={exporting}
            onClick={() => setContainer('zip')}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
              container === 'zip'
                ? 'border-accent bg-accent/10 text-text'
                : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            ZIP archive
          </button>
        </div>
      ) : null}

      {effectiveContainer === 'zip' && totalBytes > ZIP_MEMORY_WARNING_BYTES ? (
        <p className="mt-2 text-xs text-warning">
          This archive is over 256 MB and is built in memory; close other tabs before starting.
        </p>
      ) : null}

      <p className="mt-3 text-[11px] text-text-muted">
        Metadata is stripped on export: the canvas encoder cannot re-attach EXIF or ICC.
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? <p className="mt-2 text-sm text-success">{saved}</p> : null}

      {exporting && progress ? (
        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            tabIndex={0}
            aria-label="Export progress"
            aria-valuenow={Math.round(progressPct * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-accent transition-[width]" style={{ width: `${progressPct * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {progress.label} · {Math.round(progressPct * 100)} %
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void exportNow()} disabled={exporting || disabled || items.length === 0}>
          {exporting ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
          {exporting ? 'Preparing…' : actionLabel}
        </Button>
        {exporting ? (
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
