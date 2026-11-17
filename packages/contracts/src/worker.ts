import type { ErrorCode } from './errors.ts';
import type { ToolId } from './tools/types.ts';

/** Stages of one browser-lane job, in order (docs/0-PROCESSING-PIPELINE.md §4.1). */
export const STAGES = ['sniff', 'decode', 'transform', 'encode', 'measure', 'release'] as const;
export type Stage = (typeof STAGES)[number] | 'done';

export type Warning =
  | 'METADATA_DROPPED'
  | 'ALPHA_FLATTENED'
  | 'ENCODER_FALLBACK'
  | 'TARGET_SIZE_UNREACHABLE'
  | 'SKIPPED_ALREADY_SMALLER'
  | 'ALPHA_INVERTED'
  | 'LOW_SUBJECT_COVERAGE'
  | 'DEPRECATED_OPTION';

export type Capabilities = {
  worker: boolean;
  createImageBitmap: boolean;
  encode: { jpeg: boolean; png: boolean; webp: boolean; avif: boolean };
  wasmSimd: boolean;
  wasmThreads: boolean;
  webgpu: 'yes' | 'no' | 'adapter-failed';
  maxTextureDimension2D: number;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  codecs: { heic: boolean; tiff: boolean };
};

export type Metrics = {
  inputBytes: number;
  outputBytes: number;
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  inputFormat: string;
  outputFormat: string;
  durationMs: number;
  stages: Partial<Record<Stage, number>>;
  quality: number | null;
  pixels: number;
  fallback: boolean;
};

export type ResultEnvelope = {
  jobId: string;
  toolId: ToolId;
  lane: 'browser' | 'server';
  outputs: Array<{
    id: string;
    name: string;
    blob?: Blob;
    url?: string;
    metrics: Metrics;
  }>;
  warnings: Warning[];
};

/** Main thread → worker (docs/0-PROCESSING-PIPELINE.md §6.2). */
export type WorkerRequest =
  | { t: 'init'; caps: Capabilities }
  | {
      t: 'run';
      jobId: string;
      op: ToolId;
      /** The file itself: the worker sniffs and decodes, so the main thread never blocks on a 40 MP
       * decode and the original bytes stay available for the "already smaller" path. */
      file: Blob;
      name: string;
      options: unknown;
      budgetBytes: number;
      aux?: { maskBitmap?: ImageBitmap; backgroundBitmap?: ImageBitmap; originalBytes?: ArrayBuffer };
    }
  | { t: 'cancel'; jobId: string }
  | { t: 'probe'; probeId: string };

/** Worker → main thread. */
export type WorkerResponse =
  | { t: 'ready' }
  | { t: 'progress'; jobId: string; stage: Stage; pct: number }
  | {
      t: 'result';
      jobId: string;
      blob: Blob;
      name: string;
      metrics: Metrics;
      warnings: Warning[];
    }
  | { t: 'error'; jobId: string; code: ErrorCode; message: string; retryable: boolean }
  | { t: 'probe'; probeId: string; caps: Capabilities }
  | { t: 'memory'; jobId: string; liveBytes: number };

/** A browser-lane job as the UI renders it (docs/0-PROCESSING-PIPELINE.md §6.1). */
export type LocalJobStatus = 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

export type LocalJob = {
  id: string;
  toolId: ToolId;
  fileId: string;
  lane: 'browser' | 'server';
  status: LocalJobStatus;
  stage: Stage;
  pct: number;
  startedAt: number;
  durationMs?: number;
  input: { name: string; bytes: number; width: number; height: number };
  output?: { blob: Blob; bytes: number; width: number; height: number; format: string };
  warnings: Warning[];
  error?: { code: ErrorCode; message: string; hint?: string };
};
