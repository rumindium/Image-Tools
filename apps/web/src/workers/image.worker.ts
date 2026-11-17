import {
  AppError,
  type Capabilities,
  ConvertOptions,
  type ErrorCode,
  type Metrics,
  type Stage,
  type WorkerRequest,
  type WorkerResponse,
  getTool,
} from '@ri/contracts';
import {
  EXTENSION,
  OPS,
  decode,
  describeRejection,
  estimateJobBytes,
  hasTransparency,
  release,
  sniffBlob,
} from '@ri/image-browser';
import { outputName, sanitizeBase } from '@ri/image-core';

/**
 * Lane A worker (docs/0-PROCESSING-PIPELINE.md §6). The file arrives as bytes, so the decode and the
 * encode both happen off the main thread; progress is monotonic and weighted per stage.
 */

type WorkerScope = {
  postMessage: (message: WorkerResponse) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const scope = self as unknown as WorkerScope;
const jobs = new Map<string, AbortController>();
let caps: Capabilities | null = null;

const send = (message: WorkerResponse): void => scope.postMessage(message);

scope.onmessage = (event) => {
  const message = event.data;
  if (message.t === 'init') {
    caps = message.caps;
    send({ t: 'ready' });
    return;
  }
  if (message.t === 'cancel') {
    jobs.get(message.jobId)?.abort();
    return;
  }
  if (message.t === 'run') {
    void run(message);
  }
};

function errorFor(error: unknown, stage: Stage): { code: ErrorCode; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  const named = error as { name?: string; issues?: Array<{ message: string }> };
  if (named?.name === 'ZodError' && named.issues?.[0]) {
    return { code: 'VALIDATION_ERROR', message: named.issues[0].message };
  }
  const code: ErrorCode = stage === 'decode' ? 'DECODE_FAILED' : 'ENCODING_FAILED';
  return { code, message: 'This image could not be processed.' };
}

function outputNameFor(
  op: WorkerRequest & { t: 'run' },
  format: string,
  width: number,
  height: number,
): string {
  if (op.op === 'convert') {
    try {
      const parsed = ConvertOptions.parse(op.options);
      return outputName(parsed.naming, {
        sourceName: op.name,
        format: EXTENSION[format as keyof typeof EXTENSION] ?? format,
        width,
        height,
        index: 1,
      });
    } catch {
      // fall through to the plain name; a naming error must not lose a finished encode
    }
  }
  return `${sanitizeBase(op.name)}.${EXTENSION[format as keyof typeof EXTENSION] ?? 'bin'}`;
}

async function run(request: WorkerRequest & { t: 'run' }): Promise<void> {
  const { jobId } = request;
  const controller = new AbortController();
  jobs.set(jobId, controller);

  const started = performance.now();
  const stages: Partial<Record<Stage, number>> = {};
  let stage: Stage = 'sniff';
  let reportPct = 0;

  const report = (next: Stage, pct: number): void => {
    stage = next;
    const clamped = Math.max(reportPct, Math.min(1, pct));
    if (clamped - reportPct < 0.01 && clamped < 1) return;
    reportPct = clamped;
    send({ t: 'progress', jobId, stage, pct: clamped });
  };

  let raster: Awaited<ReturnType<typeof decode>> | null = null;

  try {
    const tool = getTool(request.op);
    const op = OPS[request.op];
    if (!op) {
      throw new AppError('VALIDATION_ERROR', `${tool.title} is not available in this build yet.`, {
        hint: `Scheduled for phase ${tool.phase}.`,
      });
    }

    report('sniff', 0.02);
    const sniffed = await sniffBlob(request.file);
    if (sniffed.format === 'unknown') {
      throw new AppError('UNSUPPORTED_FILE_TYPE', describeRejection(sniffed));
    }
    if (sniffed.animated) {
      throw new AppError(
        'ANIMATED_NOT_SUPPORTED',
        'This is an animated image. Converting it would silently drop every frame but the first.',
      );
    }
    if (request.file.size > tool.limits.maxBytes) {
      throw new AppError('FILE_TOO_LARGE', `This file is ${Math.round(request.file.size / 1e6)} MB.`);
    }

    const pixels = (sniffed.width ?? 0) * (sniffed.height ?? 0);
    if (pixels > tool.limits.maxPixels) {
      throw new AppError(
        'IMAGE_TOO_LARGE',
        `${sniffed.width ?? '?'}×${sniffed.height ?? '?'} is above the ${Math.round(tool.limits.maxPixels / 1e6)} MP limit for this device.`,
      );
    }
    if (pixels > 0 && estimateJobBytes(pixels) > request.budgetBytes) {
      throw new AppError(
        'MEMORY_LIMIT_EXCEEDED',
        'This image does not fit the memory budget of this device.',
        {
          hint: 'Close other tabs, or use a smaller image.',
        },
      );
    }

    const decodeStart = performance.now();
    report('decode', 0.05);
    raster = await decode(request.file);
    stages.decode = Math.round(performance.now() - decodeStart);
    report('transform', 0.25);

    const transformStart = performance.now();
    const result = await op(raster, request.options, {
      signal: controller.signal,
      report: (pct) => report('transform', 0.25 + pct * 0.5),
      caps: caps ?? ({} as Capabilities),
      inputFormat: sniffed.format,
      inputHasAlpha: hasTransparency(raster),
    });
    stages.transform = Math.round(performance.now() - transformStart);
    controller.signal.throwIfAborted();

    report('measure', 0.97);
    const metrics: Metrics = {
      inputBytes: request.file.size,
      outputBytes: result.blob.size,
      inputWidth: raster.width,
      inputHeight: raster.height,
      outputWidth: result.width,
      outputHeight: result.height,
      inputFormat: sniffed.format,
      outputFormat: result.format,
      durationMs: Math.round(performance.now() - started),
      stages,
      quality: result.quality,
      pixels: raster.width * raster.height,
      fallback: result.warnings.includes('ENCODER_FALLBACK'),
    };

    report('release', 1);
    send({
      t: 'result',
      jobId,
      blob: result.blob,
      name: outputNameFor(request, result.format, result.width, result.height),
      metrics,
      warnings: result.warnings,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      send({ t: 'error', jobId, code: 'CANCELLED', message: 'Cancelled.', retryable: false });
      return;
    }
    const mapped = errorFor(error, stage);
    const hint = error instanceof AppError ? error.hint : undefined;
    send({
      t: 'error',
      jobId,
      code: mapped.code,
      message: hint ? `${mapped.message} ${hint}` : mapped.message,
      retryable: false,
    });
  } finally {
    jobs.delete(jobId);
    release(raster);
  }
}
