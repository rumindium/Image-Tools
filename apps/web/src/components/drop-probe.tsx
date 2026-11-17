'use client';

import { type Sniffed, describeRejection, sniffBlob } from '@ri/image-browser';
import { formatBytes, formatDimensions } from '@ri/image-core';
import { Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

type Probe = { id: string; name: string; bytes: number; sniffed: Sniffed; error?: string };

let sequence = 0;

/**
 * Phase 0 dropzone: it reads the header of each file and reports what it actually is.
 * No decode, no processing — the pipeline lands in phase 1 (docs/0-IMPLEMENTATION-PHASE.md).
 */
export function DropProbe() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const inspect = useCallback(async (files: FileList | File[]) => {
    const accepted = Array.from(files).slice(0, 8);
    const next = await Promise.all(
      accepted.map(async (file) => {
        const sniffed = await sniffBlob(file);
        sequence += 1;
        return {
          id: `probe-${sequence}`,
          name: file.name,
          bytes: file.size,
          sniffed,
          ...(sniffed.format === 'unknown' ? { error: describeRejection(sniffed) } : {}),
        } satisfies Probe;
      }),
    );
    setProbes((current) => [...next, ...current].slice(0, 8));
  }, []);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void inspect(event.dataTransfer.files);
        }}
        className={`rounded-[var(--radius)] border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? 'border-accent bg-surface-3' : 'border-border bg-surface-2'
        }`}
      >
        <Upload className="mx-auto mb-3 text-text-muted" size={22} aria-hidden />
        <p className="text-sm font-medium">Drop images here</p>
        <p className="mt-1 text-xs text-text-muted">
          JPG · PNG · WebP · AVIF · GIF · BMP · SVG · HEIC · TIFF — up to 40 MP, 100 MB per file
        </p>
        <p className="mt-1 text-xs text-text-muted">Nothing is uploaded. The header is read locally.</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.heic,.tif,.tiff"
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void inspect(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {probes.length > 0 ? (
        <ul className="divide-y divide-border rounded-[var(--radius)] border border-border bg-surface-2 text-sm">
          {probes.map((probe) => (
            <li key={probe.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-medium">{probe.name}</span>
                <span className="block text-xs text-text-muted">
                  {probe.error ??
                    `${probe.sniffed.format.toUpperCase()} · ${
                      probe.sniffed.width && probe.sniffed.height
                        ? formatDimensions(probe.sniffed.width, probe.sniffed.height)
                        : 'dimensions unreadable'
                    } · ${formatBytes(probe.bytes)}`}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  probe.error ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
                }`}
              >
                {probe.error ? 'rejected' : 'readable'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
