/** Browser-lane constants — docs/0-CONFIG.md §4. Constants, not deployment configuration. */

export const MAX_PIXELS_DESKTOP = 40_000_000;
export const MAX_PIXELS_LOW_MEMORY = 16_000_000;
export const MAX_FILE_BYTES = 104_857_600; // 100 MB
export const MAX_BATCH_FILES = 200;
export const MAX_BATCH_BYTES = 1_610_612_736; // 1.5 GB
export const PREVIEW_MAX_SIDE = 2048;
export const PROGRESS_MIN_INTERVAL_MS = 100;
export const WORKER_IDLE_TIMEOUT_MS = 60_000;
export const WORKER_IDLE_TIMEOUT_AI_MS = 300_000;

export type DeviceClass = 'desktop' | 'tablet' | 'phone';

export type LiveBudget = {
  maxLiveBytes: number;
  maxPixels: number;
  concurrency: number;
  workers: number;
};

/**
 * The admission budget of docs/0-PROCESSING-PIPELINE.md §6.3 and the pixel ceiling of §7.
 * A 40 MP job costs 400 MB + a 40 MB matte, which is why 512 MB admits exactly one.
 */
export function budgetForDevice(deviceClass: DeviceClass, deviceMemoryGb: number | null): LiveBudget {
  const lowMemory = deviceMemoryGb !== null && deviceMemoryGb < 4;
  const maxLiveBytes = lowMemory
    ? 192_000_000
    : deviceMemoryGb !== null && deviceMemoryGb >= 8
      ? 512_000_000
      : 320_000_000;
  const maxPixels = deviceClass === 'desktop' && !lowMemory ? MAX_PIXELS_DESKTOP : MAX_PIXELS_LOW_MEMORY;

  return {
    maxLiveBytes,
    maxPixels,
    concurrency: deviceClass === 'desktop' && !lowMemory ? 2 : 1,
    workers: deviceClass === 'desktop' ? 3 : deviceClass === 'tablet' ? 2 : 1,
  };
}

/** Bytes a job needs while running: source RGBA + one canvas copy + output + matte. */
export function estimateJobBytes(pixels: number, withMask = false): number {
  return Math.round(pixels * 4 * 2.5 + (withMask ? pixels : 0));
}

export function deviceClassFromEnvironment(): DeviceClass {
  if (typeof window === 'undefined') return 'desktop';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.innerWidth < 768;
  if (!coarse) return 'desktop';
  return narrow ? 'phone' : 'tablet';
}
