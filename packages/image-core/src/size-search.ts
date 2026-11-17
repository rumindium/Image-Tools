/**
 * The target-byte search of docs/02-COMPRESS.md §5.2 and docs/0-PROCESSING-PIPELINE.md §5.1.
 * The encoder is injected so the loop is testable without a canvas, and identical on both lanes.
 */

export type EncodeAttempt = { bytes: number };

export type SearchResult<T extends EncodeAttempt> = {
  quality: number;
  best: T | null;
  attempts: number;
  met: boolean;
};

export type SearchOptions<T extends EncodeAttempt> = {
  targetBytes: number;
  encode: (quality: number) => Promise<T>;
  maxAttempts?: number;
  /** Stop once the output is within this fraction of the target from below (default 0.95). */
  closeEnough?: number;
  signal?: AbortSignal;
};

export async function searchQuality<T extends EncodeAttempt>(
  options: SearchOptions<T>,
): Promise<SearchResult<T>> {
  const { targetBytes, encode, signal } = options;
  const maxAttempts = options.maxAttempts ?? 6;
  const closeEnough = options.closeEnough ?? 0.95;

  let lo = 1;
  let hi = 100;
  let attempts = 0;
  let best: { quality: number; blob: T } | null = null;

  while (attempts < maxAttempts && lo <= hi) {
    signal?.throwIfAborted();
    const quality = Math.round((lo + hi) / 2);
    const blob = await encode(quality);
    attempts += 1;

    if (blob.bytes <= targetBytes) {
      if (best === null || blob.bytes > best.blob.bytes) best = { quality, blob };
      lo = quality + 1;
      if (blob.bytes >= targetBytes * closeEnough) break;
    } else {
      hi = quality - 1;
    }
  }

  if (best) return { quality: best.quality, best: best.blob, attempts, met: true };

  const floor = await encode(1);
  return { quality: 1, best: floor, attempts: attempts + 1, met: false };
}

/** Bytes per pixel, used to suggest the dimensions that would reach a target. */
export function suggestDimensions(
  targetBytes: number,
  bytesPerPixelOfSmallest: number,
  source: { width: number; height: number },
): { width: number; height: number } {
  const budgetPixels = targetBytes / Math.max(1e-6, bytesPerPixelOfSmallest);
  const scale = Math.sqrt(budgetPixels / (source.width * source.height));
  return {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale)),
  };
}
