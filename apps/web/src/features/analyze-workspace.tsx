'use client';

import { type AnalyzeReport, analyzeImage } from '@/lib/analyze';
import { AnalyzeOptions, type AnalyzeOptionsValue, getTool } from '@ri/contracts';
import { type Sniffed, sniffBlob } from '@ri/image-browser';
import { formatBytes, formatDimensions, formatMegapixels, toMegabytes } from '@ri/image-core';
import { Button, Card } from '@ri/ui';
import { Clipboard, Loader2, Trash2, Upload, X } from 'lucide-react';
import { type DragEvent, useMemo, useRef, useState } from 'react';

type RowStatus = 'ready' | 'running' | 'done' | 'failed';

type Row = {
  id: string;
  file: File;
  sniffed: Sniffed;
  status: RowStatus;
  report?: AnalyzeReport;
  error?: string;
};

type SortKey = 'name' | 'format' | 'bytes' | 'megapixels' | 'dimensions';
type SortDirection = 'asc' | 'desc';

const MAX_FILES = 50;
/** Two decodes at once: a 40 MP bitmap is ~160 MB, so a larger pool would break the memory budget. */
const ANALYSIS_CONCURRENCY = 2;

const STATUS_LABEL: Record<RowStatus, string> = {
  ready: 'Queued',
  running: 'Analyzing…',
  done: 'Done',
  failed: 'Failed',
};

function statusTone(status: RowStatus): string {
  if (status === 'failed') return 'text-danger';
  if (status === 'done') return 'text-success';
  if (status === 'running') return 'text-accent';
  return 'text-text-muted';
}

function sortValue(row: Row, key: SortKey): string | number {
  const report = row.report;
  switch (key) {
    case 'name':
      return row.file.name.toLowerCase();
    case 'format':
      return report?.format ?? row.sniffed.format;
    case 'bytes':
      return report?.bytes ?? row.file.size;
    case 'megapixels':
      return report?.megapixels ?? 0;
    case 'dimensions':
      return report ? (report.width ?? 0) * (report.height ?? 0) : 0;
  }
}

function HeaderCell({
  label,
  sortKey,
  active,
  direction,
  onSort,
  hint,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  hint?: string;
}) {
  return (
    <th scope="col" className="whitespace-nowrap px-2 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={hint}
        className="inline-flex items-center gap-1 text-left text-[11px] uppercase tracking-wide text-text-muted hover:text-text"
      >
        {label}
        <span aria-hidden className={active ? 'text-accent' : 'opacity-0'}>
          {direction === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  );
}

/**
 * Analyze (docs/08-UTILITIES.md §3). Header parsing is bounded to 256 KB; dimensions and colour
 * come from the decoded bitmap, and the one pixel pass is capped at 512 px. A failed decode still
 * produces the header report, which is what makes HEIC/TIFF useful without their decoders.
 */
export function AnalyzeWorkspace() {
  const tool = getTool('analyze');
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [options, setOptions] = useState<AnalyzeOptionsValue>(() => AnalyzeOptions.parse({}));
  const inputRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLTextAreaElement>(null);

  const update = (id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addFiles = async (files: FileList | File[]) => {
    if (running) return;
    setError(null);
    const remaining = Math.max(0, MAX_FILES - rows.length);
    const accepted = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      setNotice(`Only ${remaining} more ${remaining === 1 ? 'file' : 'files'} fit in the 50-file limit.`);
    } else {
      setNotice(null);
    }
    if (accepted.length === 0) return;

    const next = await Promise.all(
      accepted.map(async (file) => {
        let sniffed: Sniffed;
        try {
          sniffed = await sniffBlob(file);
        } catch {
          return {
            id: crypto.randomUUID(),
            file,
            sniffed: {
              format: 'unknown' as const,
              mime: 'application/octet-stream',
              width: null,
              height: null,
              animated: false,
              bytes: file.size,
            },
            status: 'failed' as const,
            error: 'That file could not be read.',
          } satisfies Row;
        }

        let message: string | undefined;
        if (file.size > tool.limits.maxBytes) {
          message = `This file is ${formatBytes(file.size)}; the limit is ${toMegabytes(tool.limits.maxBytes)} MB.`;
        } else if (sniffed.format === 'unknown') {
          message = 'That file is not an image we can read.';
        } else if (
          sniffed.width &&
          sniffed.height &&
          sniffed.width * sniffed.height > tool.limits.maxPixels
        ) {
          message = `This image is ${formatDimensions(sniffed.width, sniffed.height)}; the limit is ${formatMegapixels(tool.limits.maxPixels)}.`;
        }
        return {
          id: crypto.randomUUID(),
          file,
          sniffed,
          status: message ? ('failed' as const) : ('ready' as const),
          error: message,
        } satisfies Row;
      }),
    );

    setRows((current) => [...current, ...next].slice(0, MAX_FILES));
  };

  const run = async (): Promise<void> => {
    if (running || rows.length === 0) return;
    const parsed = AnalyzeOptions.safeParse(options);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the analysis options.');
      return;
    }

    const targets = rows.filter((row) => row.status !== 'failed');
    if (targets.length === 0) return;

    setRunning(true);
    setError(null);
    setCopied(null);

    try {
      let cursor = 0;
      const work = async (): Promise<void> => {
        while (cursor < targets.length) {
          const row = targets[cursor];
          cursor += 1;
          if (!row) return;
          update(row.id, { status: 'running', error: undefined, report: undefined });
          try {
            const report = await analyzeImage(row.file, row.sniffed, parsed.data);
            update(row.id, { status: 'done', report });
          } catch (caught) {
            update(row.id, {
              status: 'failed',
              error: caught instanceof Error ? caught.message : 'This image could not be analyzed.',
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, targets.length) }, () => work()));
    } finally {
      setRunning(false);
    }
  };

  const remove = (id: string) => {
    if (running) return;
    setRows((current) => current.filter((row) => row.id !== id));
    setCopied(null);
  };

  const clear = () => {
    if (running) return;
    setRows([]);
    setNotice(null);
    setError(null);
    setCopied(null);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const reports = rows.flatMap((row) => (row.report ? [row.report] : []));
  const json = JSON.stringify(reports, null, 2);
  const finished = rows.filter((row) => row.status === 'done' || row.status === 'failed').length;

  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      const compared =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return sortDirection === 'asc' ? compared : -compared;
    });
    return sorted;
  }, [rows, sortKey, sortDirection]);

  const analyzable = rows.filter((row) => row.status !== 'failed').length;

  const changeSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const copyJson = async () => {
    if (reports.length === 0) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      const node = jsonRef.current;
      if (node) {
        node.focus();
        node.select();
        if (document.execCommand('copy')) {
          setCopied(true);
          return;
        }
      }
      setCopied(false);
      setError('Clipboard access was blocked; select the JSON and copy it manually.');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{tool.category}</p>
        <h1 className="text-[28px] font-[650] leading-tight tracking-tight">Image analyzer</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          Read the dimensions, aspect, MIME, orientation, DPI, colour profile and bit depth of up to 50
          images. Colour mode and transparency are sampled at {512} px; the report says so. Nothing is
          uploaded.
        </p>
      </header>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!running) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-[var(--radius)] border-2 border-dashed p-6 text-center ${
          dragging ? 'border-accent bg-surface-3' : 'border-border bg-surface-2'
        }`}
      >
        <Upload className="mx-auto mb-2 text-text-muted" size={20} aria-hidden />
        <p className="text-sm font-medium">Drop images here, or browse</p>
        <p className="mt-1 text-xs text-text-muted">
          Up to 50 files · {formatMegapixels(tool.limits.maxPixels)} and {toMegabytes(tool.limits.maxBytes)}{' '}
          MB per file · headers are read locally
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={running || rows.length >= MAX_FILES}
          onClick={() => inputRef.current?.click()}
        >
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
        {notice ? <p className="mt-3 text-xs text-warning">{notice}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Options"
          description="The settings apply to the next run; existing reports stay on screen."
        >
          <div className="mt-4 space-y-3">
            <label className="flex items-start gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={options.detectTransparency}
                disabled={running}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, detectTransparency: event.target.checked }))
                }
                className="mt-0.5"
              />
              <span>
                Detect transparency (alpha scan)
                <span className="block text-[11px]">One pass at 512 px; the report labels it sampled.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={options.detectColorProfile}
                disabled={running}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, detectColorProfile: event.target.checked }))
                }
                className="mt-0.5"
              />
              <span>
                Detect colour profile (ICC)
                <span className="block text-[11px]">Presence only: PNG iCCP, JPEG APP2, WebP ICCP.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={options.includeAspectName}
                disabled={running}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, includeAspectName: event.target.checked }))
                }
                className="mt-0.5"
              />
              <span>
                Use common aspect names
                <span className="block text-[11px]">Show 16:9, 4:3 and friends when they match.</span>
              </span>
            </label>
          </div>
        </Card>

        <Card
          title="Run"
          description="The report table fills row by row; a corrupt file does not stop the batch."
        >
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void run()} disabled={running || analyzable === 0}>
              {running ? <Loader2 className="animate-spin" size={15} /> : null}
              {running ? 'Analyzing…' : reports.length > 0 ? 'Analyze again' : 'Analyze images'}
            </Button>
            <Button variant="secondary" onClick={clear} disabled={running || rows.length === 0}>
              <Trash2 size={14} /> Clear
            </Button>
            <Button variant="secondary" onClick={() => void copyJson()} disabled={reports.length === 0}>
              <Clipboard size={14} /> {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>
          {rows.length > 0 ? (
            <div className="mt-4">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                tabIndex={0}
                aria-label="Analysis progress"
                aria-valuenow={Math.round((finished / rows.length) * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${rows.length === 0 ? 0 : (finished / rows.length) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {finished} of {rows.length} finished · {reports.length} report
                {reports.length === 1 ? '' : 's'}
              </p>
            </div>
          ) : null}
          {copied === false ? <p className="mt-2 text-xs text-danger">JSON was not copied.</p> : null}
        </Card>
      </div>

      {rows.length > 0 ? (
        <Card
          title="Report"
          description="Click a column to sort. Header-only dimensions are marked; sampled values say so."
        >
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border">
                  <HeaderCell
                    label="File"
                    sortKey="name"
                    active={sortKey === 'name'}
                    direction={sortDirection}
                    onSort={changeSort}
                  />
                  <HeaderCell
                    label="Format"
                    sortKey="format"
                    active={sortKey === 'format'}
                    direction={sortDirection}
                    onSort={changeSort}
                  />
                  <HeaderCell
                    label="Dimensions"
                    sortKey="dimensions"
                    active={sortKey === 'dimensions'}
                    direction={sortDirection}
                    onSort={changeSort}
                  />
                  <HeaderCell
                    label="MP"
                    sortKey="megapixels"
                    active={sortKey === 'megapixels'}
                    direction={sortDirection}
                    onSort={changeSort}
                  />
                  <th scope="col" className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted">
                    Aspect
                  </th>
                  <HeaderCell
                    label="Size"
                    sortKey="bytes"
                    active={sortKey === 'bytes'}
                    direction={sortDirection}
                    onSort={changeSort}
                  />
                  <th scope="col" className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted">
                    Colour
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted"
                    title="Sampled at 512 px"
                  >
                    Alpha · 512
                  </th>
                  <th scope="col" className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted">
                    DPI
                  </th>
                  <th scope="col" className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted">
                    ICC
                  </th>
                  <th scope="col" className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted">
                    Bit
                  </th>
                  <th scope="col" className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted">
                    Orientation
                  </th>
                  <th scope="col" className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-muted">
                    Status
                  </th>
                  <th scope="col" className="px-2 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const report = row.report;
                  return (
                    <tr key={row.id} className="border-b border-border/70 align-top">
                      <td className="max-w-[220px] px-2 py-2">
                        <p className="truncate font-medium text-text" title={row.file.name}>
                          {row.file.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-muted">{STATUS_LABEL[row.status]}</p>
                        {row.error ? <p className="mt-1 text-[11px] text-danger">{row.error}</p> : null}
                        {report?.warnings.map((warning) => (
                          <p key={warning} className="mt-1 text-[11px] text-warning">
                            {warning}
                          </p>
                        ))}
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px]">{row.sniffed.format.toUpperCase()}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {report?.width && report.height ? (
                          <>
                            {formatDimensions(report.width, report.height)}
                            {report.dimensionsSource === 'header' ? (
                              <span className="ml-1 rounded bg-surface-3 px-1 py-0.5 text-[10px] text-text-muted">
                                header
                              </span>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-2">{report?.megapixels?.toFixed(1) ?? '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2">{report?.aspect?.ratio ?? '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {report ? formatBytes(report.bytes) : formatBytes(row.file.size)}
                      </td>
                      <td className="px-2 py-2">{report?.colorMode ?? '—'}</td>
                      <td className="px-2 py-2" title="Sampled at 512 px">
                        {report?.alpha.present === true
                          ? 'Yes'
                          : report?.alpha.present === false
                            ? 'No'
                            : '—'}
                      </td>
                      <td className="px-2 py-2">{report?.dpi ?? '—'}</td>
                      <td className="px-2 py-2">{report?.iccProfile ?? '—'}</td>
                      <td className="px-2 py-2">{report?.bitDepth ?? '—'}</td>
                      <td
                        className="max-w-[190px] px-2 py-2"
                        title={report?.orientation ? `EXIF tag ${report.orientation.tag}` : undefined}
                      >
                        {report?.orientation?.effect ?? '—'}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2 font-medium ${statusTone(row.status)}`}>
                        {STATUS_LABEL[row.status]}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => remove(row.id)}
                          disabled={running}
                          aria-label={`Remove ${row.file.name}`}
                          className="text-text-muted hover:text-danger disabled:opacity-40"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-text-muted">
            Colour mode and alpha come from one sample at 512 px on the longest side. Dimensions and bit depth
            come from the decoded bitmap and header; the other fields are exact when present.
          </p>

          {reports.length > 0 ? (
            <details className="mt-4 rounded-lg border border-border bg-surface p-3">
              <summary className="cursor-pointer text-xs font-medium text-text-muted">JSON report</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-text">
                {json}
              </pre>
              <textarea
                ref={jsonRef}
                readOnly
                value={json}
                aria-label="JSON report fallback"
                className="sr-only"
              />
            </details>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
