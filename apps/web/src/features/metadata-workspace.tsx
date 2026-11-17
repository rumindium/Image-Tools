'use client';

import { ToolShell } from '@/features/tool-shell';
import { saveBlob } from '@/lib/download';
import { parseImageMetadata } from '@/lib/metadata';
import { getTool } from '@ri/contracts';
import { type Sniffed, sniffBlob } from '@ri/image-browser';
import {
  type MetadataGroup,
  type MetadataReport,
  formatBytes,
  formatDimensions,
  formatMegapixels,
  toMegabytes,
} from '@ri/image-core';
import { Button, Card } from '@ri/ui';
import { Clipboard, Download, Loader2, MapPin, ShieldAlert, Trash2, Upload, X } from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';

type Tab = 'view' | 'clean';
type RowStatus = 'reading' | 'done' | 'failed';

type Row = {
  id: string;
  file: File;
  sniffed: Sniffed;
  status: RowStatus;
  report?: MetadataReport;
  error?: string;
  previewUrl?: string;
};

const MAX_FILES = 50;
const CONCURRENCY = 2;
const SUPPORTED = new Set(['jpeg', 'png', 'webp', 'tiff', 'heic']);
const ACCEPT = 'image/jpeg,image/png,image/webp,image/tiff,image/heic,.jpg,.jpeg,.png,.webp,.tif,.tiff,.heic';

function formatLabel(format: string): string {
  return format === 'heic' ? 'HEIC' : format.toUpperCase();
}

function Preview({ row }: { row: Row }) {
  const [broken, setBroken] = useState(false);
  if (!row.previewUrl || broken) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border bg-surface-3 text-[10px] text-text-muted">
        {formatLabel(row.sniffed.format)}
      </div>
    );
  }
  return (
    <img
      src={row.previewUrl}
      alt={`${row.file.name} preview`}
      onError={() => setBroken(true)}
      style={{ imageOrientation: 'from-image' }}
      className="h-12 w-12 shrink-0 rounded border border-border object-cover"
    />
  );
}

function SummaryChip({ children, tone = 'normal' }: { children: ReactNode; tone?: 'normal' | 'warning' }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border bg-surface-3 text-text-muted'
      }`}
    >
      {children}
    </span>
  );
}

function GroupTable({ group }: { group: MetadataGroup }) {
  return (
    <section
      className={`rounded-lg border p-3 ${
        group.sensitive ? 'border-warning/40 bg-warning/5' : 'border-border bg-surface'
      }`}
    >
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text">
        {group.sensitive ? <MapPin size={13} aria-hidden /> : null}
        {group.title}
      </h3>
      <dl className="mt-2 divide-y divide-border/60">
        {group.fields.map((field) => (
          <div
            key={`${group.id}-${field.label}`}
            title={`Raw: ${field.raw}`}
            className="grid grid-cols-[104px_minmax(0,1fr)] gap-2 py-1.5 text-[11px]"
          >
            <dt className="text-text-muted">{field.label}</dt>
            <dd className="break-words font-medium text-text">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReportCard({
  row,
  open,
  onRemove,
  canRemove,
}: {
  row: Row;
  open: boolean;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const report = row.report;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Preview row={row} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="truncate text-sm font-medium text-text" title={row.file.name}>
              {row.file.name}
            </p>
            {canRemove ? (
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${row.file.name}`}
                className="shrink-0 text-text-muted hover:text-danger"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {formatLabel(row.sniffed.format)} · {formatBytes(row.file.size)}
            {report?.width && report.height ? ` · ${formatDimensions(report.width, report.height)}` : ''}
            {report?.orientation ? ` · ${report.orientation.effect}` : ''}
          </p>

          {report ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {report.gps.present ? (
                <SummaryChip tone="warning">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={10} aria-hidden /> GPS present
                  </span>
                </SummaryChip>
              ) : null}
              {report.icc.present !== null ? (
                <SummaryChip>
                  ICC {report.icc.present ? (report.icc.description ?? 'present') : 'absent'}
                </SummaryChip>
              ) : null}
              {report.dpi !== null ? <SummaryChip>{report.dpi} dpi</SummaryChip> : null}
              {report.animated ? <SummaryChip>First frame only</SummaryChip> : null}
              {report.groups.length === 0 ? <SummaryChip>No embedded tags</SummaryChip> : null}
            </div>
          ) : null}
        </div>
      </div>

      {row.status === 'reading' ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="animate-spin" size={13} /> Reading metadata from the header…
        </p>
      ) : null}
      {row.error ? <p className="mt-3 text-xs text-danger">{row.error}</p> : null}

      {report ? (
        <>
          {report.gps.present ? (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-[11px] text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <ShieldAlert size={13} aria-hidden /> This file contains location data.
              </p>
              {report.gps.latitude !== null && report.gps.longitude !== null ? (
                <p className="mt-1 font-mono">
                  {report.gps.latitude.toFixed(5)}, {report.gps.longitude.toFixed(5)}
                </p>
              ) : null}
              <p className="mt-1">Publishing this file can publish where it was taken.</p>
            </div>
          ) : null}

          {report.warnings.map((warning) => (
            <p key={warning} className="mt-3 text-[11px] text-warning">
              {warning}
            </p>
          ))}

          {report.groups.length > 0 ? (
            <details open={open} className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
              <summary className="cursor-pointer text-xs font-medium text-text-muted">
                {report.groups.length} tag group{report.groups.length === 1 ? '' : 's'}
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {report.groups.map((group) => (
                  <GroupTable key={group.id} group={group} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/**
 * Metadata viewer (docs/10-METADATA.md §5.1). Parsing is read-only and bounded to 256 KB; a failed
 * parse still leaves the header summary, and a corrupt file never stops the rest of the batch.
 */
function MetadataViewer({ onClean }: { onClean: () => void }) {
  const tool = getTool('metadata');
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLTextAreaElement>(null);
  const objectUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  const update = (id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const startReading = async (targets: Row[]): Promise<void> => {
    let cursor = 0;
    const work = async (): Promise<void> => {
      while (cursor < targets.length) {
        const row = targets[cursor];
        cursor += 1;
        if (!row) return;
        update(row.id, { status: 'reading', error: undefined, report: undefined });
        try {
          const report = await parseImageMetadata(row.file, row.file.name, row.sniffed);
          update(row.id, { status: 'done', report });
        } catch (caught) {
          update(row.id, {
            status: 'failed',
            error: caught instanceof Error ? caught.message : 'This file could not be read.',
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => work()));
    setRunning(false);
  };

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    if (running) return;
    setError(null);
    setCopied(null);
    const remaining = Math.max(0, MAX_FILES - rows.length);
    const accepted = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      setNotice(`Only ${remaining} more ${remaining === 1 ? 'file' : 'files'} fit in the 50-file limit.`);
    } else {
      setNotice(null);
    }
    if (accepted.length === 0) return;

    setRunning(true);
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
        } else if (!SUPPORTED.has(sniffed.format)) {
          message = `${formatLabel(sniffed.format)} is not in the metadata viewer's accepted formats (JPEG, PNG, WebP, TIFF, HEIC).`;
        } else if (
          sniffed.width &&
          sniffed.height &&
          sniffed.width * sniffed.height > tool.limits.maxPixels
        ) {
          message = `This image is ${formatDimensions(sniffed.width, sniffed.height)}; the limit is ${formatMegapixels(tool.limits.maxPixels)}.`;
        }

        if (message) {
          return {
            id: crypto.randomUUID(),
            file,
            sniffed,
            status: 'failed' as const,
            error: message,
          } satisfies Row;
        }

        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.add(previewUrl);
        return {
          id: crypto.randomUUID(),
          file,
          sniffed,
          status: 'reading' as const,
          previewUrl,
        } satisfies Row;
      }),
    );

    setRows((current) => [...current, ...next].slice(0, MAX_FILES));
    const targets = next.filter((row) => row.status === 'reading' && !row.error);
    if (targets.length > 0) await startReading(targets);
    else setRunning(false);
  };

  const remove = (row: Row) => {
    if (running) return;
    if (row.previewUrl) {
      URL.revokeObjectURL(row.previewUrl);
      objectUrls.current.delete(row.previewUrl);
    }
    setRows((current) => current.filter((item) => item.id !== row.id));
    setCopied(null);
  };

  const clear = () => {
    if (running) return;
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
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
  const firstReportId = rows.find((row) => row.report)?.id;

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

  const downloadJson = () => {
    if (reports.length === 0) return;
    saveBlob(new Blob([json], { type: 'application/json' }), 'metadata-report.json');
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{tool.category}</p>
        <h1 className="text-[28px] font-[650] leading-tight tracking-tight">Metadata viewer</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          Read EXIF, GPS, XMP/IPTC, ICC, DPI and orientation from the original bytes. Only the first 256 KB is
          parsed; nothing is decoded, re-encoded or uploaded.
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
          MB per file · GPS is never sent anywhere
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
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {notice ? <p className="mt-3 text-xs text-warning">{notice}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </div>

      {rows.length > 0 ? (
        <Card
          title="Report"
          description="A corrupt file is isolated; the header summary still appears when its pixels cannot be parsed."
        >
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void copyJson()} disabled={reports.length === 0}>
              <Clipboard size={14} /> {copied ? 'Copied' : 'Copy JSON'}
            </Button>
            <Button variant="secondary" onClick={downloadJson} disabled={reports.length === 0}>
              <Download size={14} /> Download report.json
            </Button>
            <Button variant="secondary" onClick={onClean}>
              Remove all metadata →
            </Button>
            <Button variant="ghost" onClick={clear} disabled={running}>
              <Trash2 size={14} /> Clear
            </Button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {reports.length} report{reports.length === 1 ? '' : 's'} ·{' '}
            {rows.filter((row) => row.status === 'reading').length} reading ·{' '}
            {rows.filter((row) => row.status === 'failed').length} failed
          </p>
          {copied === false ? <p className="mt-2 text-xs text-danger">JSON was not copied.</p> : null}
          <textarea
            ref={jsonRef}
            readOnly
            value={json}
            aria-label="JSON report fallback"
            className="sr-only"
          />
        </Card>
      ) : null}

      {rows.map((row) => (
        <ReportCard
          key={row.id}
          row={row}
          open={row.id === firstReportId}
          onRemove={() => remove(row)}
          canRemove={!running}
        />
      ))}
    </div>
  );
}

/** `/metadata?tab=clean` keeps the cleaner's route alive until its workspace lands. */
export function MetadataWorkspace({ initialTab = 'view' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'view') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 text-sm">
        <button
          type="button"
          onClick={() => select('view')}
          aria-pressed={tab === 'view'}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
            tab === 'view' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          Viewer
        </button>
        <button
          type="button"
          onClick={() => select('clean')}
          aria-pressed={tab === 'clean'}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
            tab === 'clean' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          Cleaner
        </button>
      </div>

      <div hidden={tab !== 'view'}>
        <MetadataViewer onClean={() => select('clean')} />
      </div>
      {tab === 'clean' ? <ToolShell toolId="metadata-clean" /> : null}
    </div>
  );
}
