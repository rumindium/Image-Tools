'use client';

import { saveBlob } from '@/lib/download';
import { LocalRunner, type Progress } from '@/lib/local-runner';
import { AppError, ConvertOptions, getTool } from '@ri/contracts';
import { type Sniffed, type SniffedFormat, sniffBlob, sniffBytes } from '@ri/image-browser';
import {
  BASE64_TEXT_LIMIT,
  decodeBase64,
  formatBytes,
  formatDimensions,
  formatMegapixels,
  sanitizeBase,
  toMegabytes,
} from '@ri/image-core';
import { Button, Card } from '@ri/ui';
import { Clipboard, Download, FileText, Loader2, Upload, X } from 'lucide-react';
import { type DragEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

type Direction = 'encode' | 'decode';
type EncodeFormat = 'jpeg' | 'png' | 'webp';

type EncodeResult = {
  text: string;
  name: string;
  format: string;
  mime: string;
  chars: number;
  textBytes: number;
  imageBytes: number;
  durationMs: number;
  dataUri: boolean;
  lineWrap: number;
};

type DecodedResult = {
  blob: Blob;
  url: string;
  sniffed: Sniffed;
  declaredMime: string | null;
  urlSafe: boolean;
  width: number | null;
  height: number | null;
  name: string;
};

const INPUT =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

const LINE_WRAPS = [0, 64, 76, 120] as const;

const EXTENSION: Record<SniffedFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  avif: 'avif',
  heic: 'heic',
  bmp: 'bmp',
  tiff: 'tiff',
  svg: 'svg',
  unknown: 'bin',
};

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

type Base64WorkerResponse = { id: string; text?: string; error?: string };

function encodeBase64InWorker(
  worker: Worker,
  blob: Blob,
  mime: string,
  includeDataUri: boolean,
  lineWrap: number,
  signal: AbortSignal,
): Promise<string> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelled.', 'AbortError'));
      return;
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      signal.removeEventListener('abort', onAbort);
    };
    const onMessage = (event: MessageEvent<Base64WorkerResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.text ?? '');
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Cancelled.', 'AbortError'));
    };

    worker.addEventListener('message', onMessage);
    signal.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ id, blob, mime, includeDataUri, lineWrap });
  });
}

function errorText(caught: unknown): string {
  if (caught instanceof AppError) return [caught.message, caught.hint].filter(Boolean).join(' ');
  return caught instanceof Error ? caught.message : 'The operation failed.';
}

function isMismatch(declared: string | null, actual: string): boolean {
  if (!declared) return false;
  const normalized = declared.toLowerCase();
  return normalized !== actual && !(normalized === 'image/jpg' && actual === 'image/jpeg');
}

/**
 * Base64 and Data URI utility (docs/08-UTILITIES.md §2 and §4). Encode re-encodes through the same
 * worker as Export, so the prefix and bytes agree with what the browser can actually write. Decode
 * validates the alphabet and size before atob, then sniffs the bytes instead of trusting the MIME.
 * The Data URI tab is this same tool with the prefix forced on; it adds a URI preview and CSS panel.
 */
export function Base64Workspace({ mode = 'base64' }: { mode?: 'base64' | 'data-uri' }) {
  const tool = getTool('base64');
  const dataUriMode = mode === 'data-uri';
  const [direction, setDirection] = useState<Direction>('encode');

  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sniffed, setSniffed] = useState<Sniffed | null>(null);
  const [dragging, setDragging] = useState(false);
  const [format, setFormat] = useState<EncodeFormat>('png');
  const [quality, setQuality] = useState(85);
  const [includeDataUri, setIncludeDataUri] = useState(true);
  const [lineWrap, setLineWrap] = useState<(typeof LINE_WRAPS)[number]>(0);
  const [encoding, setEncoding] = useState(false);
  const [encodeProgress, setEncodeProgress] = useState<Progress | null>(null);
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cssCopied, setCssCopied] = useState(false);

  const [decodeInput, setDecodeInput] = useState('');
  const [decoded, setDecoded] = useState<DecodedResult | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);

  const runnerRef = useRef<LocalRunner | null>(null);
  const base64WorkerRef = useRef<Worker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const cssRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!sourceUrl) return;
    return () => URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => {
    if (!decodedUrl) return;
    return () => URL.revokeObjectURL(decodedUrl);
  }, [decodedUrl]);

  useEffect(() => {
    return () => {
      runnerRef.current?.dispose();
      base64WorkerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!dataUriMode) return;
    setDirection('encode');
    setIncludeDataUri(true);
  }, [dataUriMode]);

  // A new option set means the text on screen no longer describes the settings.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the setting is what invalidates the result
  useEffect(() => {
    setEncodeResult(null);
    setCopied(false);
  }, [format, quality, includeDataUri, lineWrap]);

  const runner = (): LocalRunner => {
    runnerRef.current ??= new LocalRunner();
    return runnerRef.current;
  };

  const loadFile = useCallback(
    async (next: File) => {
      setEncodeError(null);
      setEncodeResult(null);
      setEncodeProgress(null);

      if (next.size > tool.limits.maxBytes) {
        setFile(null);
        setSniffed(null);
        setSourceUrl(null);
        setEncodeError(
          `That file is ${formatBytes(next.size)}; this tool accepts up to ${toMegabytes(tool.limits.maxBytes)} MB.`,
        );
        return;
      }

      try {
        const meta = await sniffBlob(next);
        if (meta.format === 'unknown') {
          setFile(null);
          setSniffed(meta);
          setSourceUrl(null);
          setEncodeError('That file is not an image we can read.');
          return;
        }
        if (meta.animated) {
          setFile(null);
          setSniffed(meta);
          setSourceUrl(null);
          setEncodeError('Animated images are not supported here; use a static frame.');
          return;
        }
        if (meta.width && meta.height && meta.width * meta.height > tool.limits.maxPixels) {
          setFile(null);
          setSniffed(meta);
          setSourceUrl(null);
          setEncodeError(
            `That image is ${formatDimensions(meta.width, meta.height)}; the limit is ${formatMegapixels(tool.limits.maxPixels)}.`,
          );
          return;
        }
        setFile(next);
        setSniffed(meta);
        setSourceUrl(URL.createObjectURL(next));
      } catch {
        setEncodeError('That file could not be read.');
      }
    },
    [tool],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void loadFile(dropped);
  };

  const runEncode = async (): Promise<void> => {
    if (!file || encoding) return;
    const withDataUri = dataUriMode || includeDataUri;
    setEncoding(true);
    setEncodeError(null);
    setEncodeResult(null);
    setCopied(false);
    setCssCopied(false);
    setEncodeProgress({ stage: 'sniff', pct: 0 });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const options = ConvertOptions.parse({
        format,
        quality,
        background: '#ffffff',
        keepMetadata: false,
        naming: { mode: 'keep', suffix: '', startIndex: 1 },
      });
      const outcome = await runner().run(
        { op: 'convert', file, name: file.name, options },
        (next) => setEncodeProgress(next),
        controller.signal,
      );

      const encodedChars = Math.ceil(outcome.blob.size / 3) * 4 + (withDataUri ? 96 : 0);
      const estimated = encodedChars + (lineWrap > 0 ? Math.ceil(encodedChars / lineWrap) + 1 : 0);
      if (estimated > BASE64_TEXT_LIMIT) {
        throw new Error(
          `The encoded text would be about ${Math.ceil(estimated / 1_000_000)} MB; the limit is ${Math.round(BASE64_TEXT_LIMIT / 1_000_000)} MB. Use a smaller image, or save the image and skip the text.`,
        );
      }

      const mime = outcome.blob.type || `image/${format}`;
      base64WorkerRef.current ??= new Worker(new URL('../workers/base64.worker.ts', import.meta.url), {
        type: 'module',
      });
      const text = await encodeBase64InWorker(
        base64WorkerRef.current,
        outcome.blob,
        mime,
        withDataUri,
        lineWrap,
        controller.signal,
      );
      const base = sanitizeBase(file.name) || 'image';
      setEncodeResult({
        text,
        name: `${base}${withDataUri ? '.txt' : '.base64.txt'}`,
        format: outcome.metrics.outputFormat,
        mime,
        chars: text.length,
        textBytes: new Blob([text]).size,
        imageBytes: outcome.blob.size,
        durationMs: outcome.metrics.durationMs,
        dataUri: withDataUri,
        lineWrap,
      });
      setEncodeProgress({ stage: 'done', pct: 1 });
    } catch (caught) {
      if (!controller.signal.aborted) setEncodeError(errorText(caught));
    } finally {
      if (controller.signal.aborted) {
        base64WorkerRef.current?.terminate();
        base64WorkerRef.current = null;
      }
      setEncoding(false);
      abortRef.current = null;
    }
  };

  const copyResult = async (): Promise<void> => {
    if (!encodeResult) return;
    try {
      await navigator.clipboard.writeText(encodeResult.text);
      setCopied(true);
    } catch {
      const node = resultRef.current;
      if (node) {
        node.focus();
        node.select();
        if (document.execCommand('copy')) {
          setCopied(true);
          return;
        }
      }
      setEncodeError('Clipboard access was blocked; select the text and copy it manually.');
    }
  };

  const cssSnippet = encodeResult ? `background-image: url("${encodeResult.text}");` : '';

  const copyCss = async (): Promise<void> => {
    if (!cssSnippet) return;
    try {
      await navigator.clipboard.writeText(cssSnippet);
      setCssCopied(true);
    } catch {
      const node = cssRef.current;
      if (node) {
        node.focus();
        node.select();
        if (document.execCommand('copy')) {
          setCssCopied(true);
          return;
        }
      }
      setEncodeError('Clipboard access was blocked; select the CSS and copy it manually.');
    }
  };

  const runDecode = async (): Promise<void> => {
    setDecodeError(null);
    setDecoded(null);
    setDecodedUrl(null);

    const result = decodeBase64(decodeInput);
    if (!result.ok) {
      setDecodeError(result.message);
      return;
    }

    const meta = sniffBytes(result.bytes);
    if (meta.format === 'unknown') {
      setDecodeError('The decoded bytes are not an image we can read.');
      return;
    }
    if (meta.bytes > tool.limits.maxBytes) {
      setDecodeError(
        `The decoded image is ${formatBytes(meta.bytes)}; the limit is ${toMegabytes(tool.limits.maxBytes)} MB.`,
      );
      return;
    }

    const blob = new Blob([result.bytes], { type: meta.mime });
    let width = meta.width;
    let height = meta.height;
    if (!width || !height) {
      try {
        const bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        // The header has no dimensions and the browser cannot decode it; the download still works.
      }
    }

    const url = URL.createObjectURL(blob);
    setDecodedUrl(url);
    setDecoded({
      blob,
      url,
      sniffed: meta,
      declaredMime: result.declaredMime,
      urlSafe: result.urlSafe,
      width,
      height,
      name: `decoded.${EXTENSION[meta.format]}`,
    });
  };

  const removeFile = () => {
    abortRef.current?.abort();
    setFile(null);
    setSniffed(null);
    setSourceUrl(null);
    setEncodeResult(null);
    setEncodeError(null);
    setEncodeProgress(null);
  };

  const previewable = decoded
    ? decoded.sniffed.format !== 'heic' && decoded.sniffed.format !== 'tiff'
    : false;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{tool.category}</p>
        <h1 className="text-[28px] font-[650] leading-tight tracking-tight">
          {dataUriMode ? 'Data URI' : tool.title}
        </h1>
        <p className="max-w-2xl text-sm text-text-muted">
          {dataUriMode
            ? 'Encode an image into one data URI, preview the exact result and copy a CSS background rule. The URI is produced locally; large ones are usually worse than a file.'
            : 'Encode an image to base64 or a data URI, or paste an image data URI back. Encoding re-encodes to the chosen format first; decoding validates the text before allocating the image. Nothing is uploaded.'}
        </p>
      </header>

      {!dataUriMode ? (
        <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 text-sm">
          {(
            [
              ['encode', 'Image → base64'],
              ['decode', 'Base64 → image'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDirection(value)}
              disabled={encoding}
              aria-pressed={direction === value}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium disabled:opacity-50 ${
                direction === value ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {direction === 'encode' ? (
        <>
          {!file ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`rounded-[var(--radius)] border-2 border-dashed p-10 text-center ${
                dragging ? 'border-accent bg-surface-3' : 'border-border bg-surface-2'
              }`}
            >
              <Upload className="mx-auto mb-2 text-text-muted" size={22} aria-hidden />
              <p className="text-sm font-medium">Drop one image here</p>
              <p className="mt-1 text-xs text-text-muted">
                One image at a time · up to {formatMegapixels(tool.limits.maxPixels)} and{' '}
                {toMegabytes(tool.limits.maxBytes)} MB. The header is read locally.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => inputRef.current?.click()}
              >
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
              {encodeError ? <p className="mt-3 text-sm text-danger">{encodeError}</p> : null}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card
                title="Source image"
                description="The preview is the file as chosen; encoding re-writes the bytes."
              >
                {sourceUrl ? (
                  <img
                    src={sourceUrl}
                    alt={`${file.name} preview`}
                    className="mt-4 max-h-72 w-full rounded border border-border object-contain"
                  />
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </p>
                  <button
                    type="button"
                    onClick={removeFile}
                    className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-danger"
                  >
                    <X size={14} /> Remove
                  </button>
                </div>
                {sniffed ? (
                  <p className="mt-1 text-xs text-text-muted">
                    {sniffed.format.toUpperCase()} · {formatBytes(sniffed.bytes)}
                    {sniffed.width && sniffed.height
                      ? ` · ${formatDimensions(sniffed.width, sniffed.height)}`
                      : ''}
                  </p>
                ) : null}
              </Card>

              <div className="space-y-4">
                <Card title="Options">
                  <div className="mt-4 space-y-4">
                    <Field label="Format" hint="The image is re-encoded before base64 is produced.">
                      <select
                        className={INPUT}
                        value={format}
                        disabled={encoding}
                        onChange={(event) => setFormat(event.target.value as EncodeFormat)}
                      >
                        <option value="png">PNG</option>
                        <option value="jpeg">JPEG</option>
                        <option value="webp">WebP</option>
                      </select>
                    </Field>

                    <Field
                      label={format === 'png' ? 'Quality · ignored for PNG' : `Quality · ${quality}`}
                      hint="Only JPEG and WebP use this."
                    >
                      <input
                        type="range"
                        min={1}
                        max={100}
                        value={quality}
                        disabled={encoding || format === 'png'}
                        onChange={(event) => setQuality(Number(event.target.value))}
                        className="mt-3 w-full accent-[var(--accent)] disabled:opacity-50"
                      />
                    </Field>

                    {!dataUriMode ? (
                      <label className="flex items-start gap-2 text-sm text-text-muted">
                        <input
                          type="checkbox"
                          checked={includeDataUri}
                          disabled={encoding}
                          onChange={(event) => setIncludeDataUri(event.target.checked)}
                          className="mt-0.5"
                        />
                        <span>
                          Include the <code className="font-mono text-[12px]">data:</code> URI prefix
                        </span>
                      </label>
                    ) : null}

                    <Field label="Line wrap" hint="Wrap is off by default; wrapped text ends with a newline.">
                      <select
                        className={INPUT}
                        value={lineWrap}
                        disabled={encoding}
                        onChange={(event) =>
                          setLineWrap(Number(event.target.value) as (typeof LINE_WRAPS)[number])
                        }
                      >
                        {LINE_WRAPS.map((width) => (
                          <option key={width} value={width}>
                            {width === 0 ? 'No wrapping' : `${width} characters`}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => void runEncode()} disabled={encoding}>
                      {encoding ? <Loader2 className="animate-spin" size={15} /> : <FileText size={15} />}
                      {encoding ? 'Encoding…' : 'Encode to text'}
                    </Button>
                    {encoding ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          abortRef.current?.abort();
                          setEncodeProgress(null);
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>

                  {encoding && encodeProgress ? (
                    <div className="mt-3">
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                        role="progressbar"
                        tabIndex={0}
                        aria-label="Encode progress"
                        aria-valuenow={Math.round(encodeProgress.pct * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full bg-accent transition-[width]"
                          style={{ width: `${encodeProgress.pct * 100}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        {encodeProgress.stage} · {Math.round(encodeProgress.pct * 100)} %
                      </p>
                    </div>
                  ) : null}

                  {encodeError ? (
                    <p role="alert" className="mt-3 text-sm text-danger">
                      {encodeError}
                    </p>
                  ) : null}
                </Card>

                <p className="text-[11px] text-text-muted">
                  Re-encoding drops EXIF and ICC, and JPEG flattens transparency onto white. Base64 adds about
                  33 % to the file size.
                </p>
              </div>
            </div>
          )}

          {encodeResult ? (
            <>
              <Card
                title={dataUriMode ? 'Data URI' : 'Encoded text'}
                description={
                  dataUriMode
                    ? `${encodeResult.mime} · ${formatBytes(encodeResult.imageBytes)} image → ${formatBytes(encodeResult.textBytes)} URI text`
                    : `${encodeResult.mime} · ${formatBytes(encodeResult.imageBytes)} image → ${formatBytes(encodeResult.textBytes)} text`
                }
              >
                {dataUriMode ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <img
                      src={encodeResult.text}
                      alt="Data URI preview"
                      className="h-40 w-full rounded border border-border bg-surface-3 object-contain"
                    />
                    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                      <dt className="text-text-muted">MIME</dt>
                      <dd className="font-mono text-text">{encodeResult.mime}</dd>
                      <dt className="text-text-muted">Encoded length</dt>
                      <dd className="text-text">
                        {encodeResult.chars.toLocaleString()} chars · {formatBytes(encodeResult.textBytes)}
                      </dd>
                      <dt className="text-text-muted">Decoded dimensions</dt>
                      <dd className="text-text">
                        {sniffed?.width && sniffed.height
                          ? formatDimensions(sniffed.width, sniffed.height)
                          : 'Not available from the header'}
                      </dd>
                      <dt className="text-text-muted">Image size</dt>
                      <dd className="text-text">{formatBytes(encodeResult.imageBytes)}</dd>
                      <dt className="text-text-muted">Output format</dt>
                      <dd className="text-text">{encodeResult.format.toUpperCase()}</dd>
                    </dl>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void copyResult()}>
                    <Clipboard size={14} /> {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      resultRef.current?.focus();
                      resultRef.current?.select();
                    }}
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      saveBlob(
                        new Blob([encodeResult.text], { type: 'text/plain;charset=utf-8' }),
                        encodeResult.name,
                      )
                    }
                  >
                    <Download size={14} /> Download .txt
                  </Button>
                  <span className="text-xs text-text-muted">
                    {encodeResult.chars.toLocaleString()} chars · {encodeResult.format.toUpperCase()}
                    {encodeResult.lineWrap > 0 ? ` · wrap ${encodeResult.lineWrap}` : ''} ·{' '}
                    {encodeResult.durationMs} ms
                  </span>
                </div>

                <textarea
                  ref={resultRef}
                  readOnly
                  value={encodeResult.text}
                  aria-label={dataUriMode ? 'Data URI output' : 'Base64 output'}
                  spellCheck={false}
                  className="mt-3 h-64 w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed text-text"
                />

                {!dataUriMode && encodeResult.dataUri && encodeResult.chars > 100_000 ? (
                  <p className="mt-2 text-xs text-warning">
                    A data URI this large is generally worse than a file: browsers and CSS readers still parse
                    the whole string.
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-text-muted">
                  Saved as <span className="font-mono">{encodeResult.name}</span>. The prefix uses the format
                  the browser actually wrote, not the one requested.
                </p>
              </Card>

              {dataUriMode ? (
                <Card
                  title="Paste into CSS"
                  description="This rule uses the exact URI above. Base64 contains no quote characters, so the url() quotes are safe."
                >
                  <textarea
                    ref={cssRef}
                    readOnly
                    value={cssSnippet}
                    aria-label="CSS background rule"
                    spellCheck={false}
                    className="mt-4 h-28 w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed text-text"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void copyCss()}>
                      <Clipboard size={14} /> {cssCopied ? 'Copied CSS' : 'Copy CSS'}
                    </Button>
                    <span className="text-xs text-text-muted">
                      {encodeResult.chars.toLocaleString()} chars · {formatBytes(encodeResult.textBytes)}{' '}
                      added to the stylesheet
                    </span>
                  </div>
                  <p
                    className={`mt-3 text-xs ${encodeResult.textBytes > 100_000 ? 'text-warning' : 'text-text-muted'}`}
                  >
                    {encodeResult.textBytes > 100_000
                      ? 'Data URIs bloat HTML; a file is usually better. This one is large enough that every HTML or CSS file carrying it pays the cost.'
                      : 'A data URI avoids a request, but makes every HTML or CSS file carrying it larger. Keep it under 100 KB when possible.'}
                  </p>
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <Card
          title="Paste base64 or a data URI"
          description="Whitespace, missing padding and the URL-safe alphabet are accepted. The declared MIME is checked against the bytes."
        >
          <textarea
            value={decodeInput}
            onChange={(event) => {
              setDecodeInput(event.target.value);
              setDecoded(null);
              setDecodedUrl(null);
              setDecodeError(null);
            }}
            aria-label="Base64 input"
            spellCheck={false}
            placeholder="data:image/png;base64,iVBORw0KGgo…"
            className="mt-4 h-48 w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-text"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => void runDecode()} disabled={decodeInput.trim().length === 0}>
              <FileText size={15} /> Decode image
            </Button>
            <span className="text-xs text-text-muted">
              {decodeInput.length.toLocaleString()} chars · limits: 40 MB of text, 30 MB decoded
            </span>
          </div>

          {decodeError ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {decodeError}
            </p>
          ) : null}
        </Card>
      )}

      {direction === 'decode' && decoded ? (
        <Card
          title="Decoded image"
          description={`${decoded.sniffed.format.toUpperCase()} · ${formatBytes(decoded.blob.size)}${
            decoded.width && decoded.height ? ` · ${formatDimensions(decoded.width, decoded.height)}` : ''
          }`}
        >
          {previewable ? (
            <img
              src={decoded.url}
              alt="Decoded preview"
              className="mt-4 max-h-80 w-full rounded border border-border object-contain"
            />
          ) : (
            <p className="mt-4 rounded border border-border bg-surface-3 p-3 text-sm text-text-muted">
              This format has no reliable browser preview here. The decoded bytes are intact and can be
              downloaded.
            </p>
          )}

          {isMismatch(decoded.declaredMime, decoded.sniffed.mime) ? (
            <p className="mt-3 text-sm text-warning">
              The data URI claimed {decoded.declaredMime}, but the bytes are {decoded.sniffed.mime}. The
              actual type wins.
            </p>
          ) : null}
          {decoded.urlSafe ? (
            <p className="mt-2 text-xs text-text-muted">
              The input used the URL-safe alphabet (<span className="font-mono">-</span> and{' '}
              <span className="font-mono">_</span>) and was normalized before decoding.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => saveBlob(decoded.blob, decoded.name)}>
              <Download size={15} /> Download {decoded.name}
            </Button>
            <span className="text-xs text-text-muted">
              The download name comes from the sniffed type, not the declared one.
            </span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
