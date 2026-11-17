'use client';

import type { Capabilities } from '@ri/contracts';
import { probeCapabilities } from '@ri/image-browser';
import { useEffect, useState } from 'react';

const ROWS: ReadonlyArray<{ label: string; read: (caps: Capabilities) => string }> = [
  { label: 'Worker + OffscreenCanvas', read: (caps) => (caps.worker ? 'yes' : 'no') },
  { label: 'JPEG encode', read: (caps) => yesNo(caps.encode.jpeg) },
  { label: 'PNG encode', read: (caps) => yesNo(caps.encode.png) },
  { label: 'WebP encode', read: (caps) => yesNo(caps.encode.webp) },
  { label: 'AVIF encode', read: (caps) => (caps.encode.avif ? 'yes' : 'no — AVIF is disabled here') },
  { label: 'WebGPU', read: (caps) => caps.webgpu },
  { label: 'WASM threads (COOP/COEP)', read: (caps) => yesNo(caps.wasmThreads) },
  { label: 'Device memory', read: (caps) => (caps.deviceMemoryGb ? `${caps.deviceMemoryGb} GB` : 'unknown') },
  { label: 'Logical cores', read: (caps) => String(caps.hardwareConcurrency) },
  { label: 'Max texture edge', read: (caps) => `${caps.maxTextureDimension2D} px` },
];

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

/**
 * Settings → Diagnostics (docs/0-PROCESSING-PIPELINE.md §7.3): the probe measures, it does not
 * merely feature-detect, so this panel is also the answer to "why is AI off on this machine".
 */
export function Diagnostics() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    probeCapabilities()
      .then(setCaps)
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface-2">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Diagnostics</h2>
        <p className="text-xs text-text-muted">Measured in this browser, cached for the session.</p>
      </div>
      {failed ? (
        <p className="px-4 py-3 text-sm text-danger">The capability probe failed in this browser.</p>
      ) : caps ? (
        <dl className="divide-y divide-border text-sm">
          {ROWS.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-2">
              <dt className="text-text-muted">{row.label}</dt>
              <dd className="font-mono text-[13px]">{row.read(caps)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-4 py-3 text-sm text-text-muted">Probing…</p>
      )}
    </div>
  );
}
