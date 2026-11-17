'use client';

import {
  AppError,
  type Metrics,
  type Stage,
  type ToolId,
  type Warning,
  type WorkerResponse,
} from '@ri/contracts';
import { budgetForDevice, deviceClassFromEnvironment, probeCapabilities } from '@ri/image-browser';

/**
 * Main-thread client for the lane A worker. One worker per tab, reused across jobs and terminated on
 * unmount; a job's late result is discarded by id, so cancel-then-run cannot swap blobs.
 */

export type Progress = { stage: Stage; pct: number };

export type JobOutcome = {
  blob: Blob;
  name: string;
  metrics: Metrics;
  warnings: Warning[];
};

type Pending = {
  resolve: (outcome: JobOutcome) => void;
  reject: (error: unknown) => void;
  onProgress: (progress: Progress) => void;
};

const JOB_TIMEOUT_MS = 120_000;

export class LocalRunner {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private watchdog = new Map<string, ReturnType<typeof setTimeout>>();

  private ensure(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    worker.onerror = () => {
      this.failAll(new AppError('INTERNAL_ERROR', 'The image worker stopped unexpectedly.'));
      worker.terminate();
      this.worker = null;
    };

    void probeCapabilities().then((caps) => {
      const budget = budgetForDevice(deviceClassFromEnvironment(), caps.deviceMemoryGb);
      worker.postMessage({ t: 'init', caps });
      this.budgetBytes = budget.maxLiveBytes;
    });

    this.worker = worker;
    return worker;
  }

  private budgetBytes = 320_000_000;

  private receive(message: WorkerResponse): void {
    if (message.t === 'progress') {
      this.pending.get(message.jobId)?.onProgress({ stage: message.stage, pct: message.pct });
      return;
    }
    if (message.t === 'result') {
      const pending = this.pending.get(message.jobId);
      if (!pending) return; // cancelled: the late blob must not land anywhere
      this.settle(message.jobId);
      pending.resolve({
        blob: message.blob,
        name: message.name,
        metrics: message.metrics,
        warnings: message.warnings,
      });
      return;
    }
    if (message.t === 'error') {
      const pending = this.pending.get(message.jobId);
      if (!pending) return;
      this.settle(message.jobId);
      pending.reject(new AppError(message.code, message.message));
      return;
    }
    // 'ready' and 'probe' are informational: the budget it carries is applied in ensure().
  }

  private settle(jobId: string): void {
    this.pending.delete(jobId);
    const timer = this.watchdog.get(jobId);
    if (timer) clearTimeout(timer);
    this.watchdog.delete(jobId);
  }

  private failAll(error: unknown): void {
    for (const [, pending] of this.pending) pending.reject(error);
    for (const timer of this.watchdog.values()) clearTimeout(timer);
    this.pending.clear();
    this.watchdog.clear();
  }

  run(
    request: { op: ToolId; file: File; name: string; options: unknown },
    onProgress: (progress: Progress) => void,
    signal?: AbortSignal,
  ): Promise<JobOutcome> {
    const worker = this.ensure();
    const jobId = crypto.randomUUID();

    return new Promise<JobOutcome>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject, onProgress });

      const timer = setTimeout(() => {
        worker.postMessage({ t: 'cancel', jobId });
        this.settle(jobId);
        reject(new AppError('MEMORY_LIMIT_EXCEEDED', 'This job took longer than 2 minutes and was stopped.'));
      }, JOB_TIMEOUT_MS);
      this.watchdog.set(jobId, timer);

      const onAbort = (): void => {
        worker.postMessage({ t: 'cancel', jobId });
        this.settle(jobId);
        reject(new AppError('CANCELLED', 'Cancelled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      worker.postMessage({
        t: 'run',
        jobId,
        op: request.op,
        file: request.file,
        name: request.name,
        options: request.options,
        budgetBytes: this.budgetBytes,
      });
    });
  }

  dispose(): void {
    this.failAll(new AppError('CANCELLED', 'The workspace was closed.'));
    this.worker?.terminate();
    this.worker = null;
  }
}
