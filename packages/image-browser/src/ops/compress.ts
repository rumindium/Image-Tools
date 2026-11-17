import { CompressOptions, type Warning } from '@ri/contracts';
import { searchQuality } from '@ri/image-core';
import { type Encoded, encodeCanvas, flatten, toCanvas } from '../raster.ts';
import { scaleDownCanvas } from './resize.ts';
import type { Op, OpResult } from './types.ts';

type Attempt = { bytes: number; blob: Blob; encoded: Encoded; quality: number };

/**
 * `compress` — quality mode is one encode; target mode is the bounded six-attempt search of
 * docs/02-COMPRESS.md §5.2. The search keeps the largest blob that still fits, not the last one.
 */
export const compress: Op = async (input, options, ctx): Promise<OpResult> => {
  const parsed = CompressOptions.parse(options);
  const warnings: Warning[] = [];

  const needsFlatten = parsed.format === 'jpeg' && ctx.inputHasAlpha;
  let base = needsFlatten ? flatten(input, parsed.background) : toCanvas(input);
  if (needsFlatten) warnings.push('ALPHA_FLATTENED');

  if (parsed.maxWidth !== undefined || parsed.maxHeight !== undefined) {
    base = scaleDownCanvas(base, base.width, base.height, parsed.maxWidth, parsed.maxHeight);
  }
  ctx.report(0.15);

  if (parsed.mode === 'quality' || parsed.targetBytes === undefined) {
    const encoded = await encodeCanvas(base, parsed.format, parsed.quality);
    ctx.report(1);
    if (encoded.fallback) warnings.push('ENCODER_FALLBACK');
    return {
      blob: encoded.blob,
      width: base.width,
      height: base.height,
      format: encoded.format,
      quality: parsed.quality,
      warnings,
    };
  }

  let attempts = 0;
  const result = await searchQuality<Attempt>({
    targetBytes: parsed.targetBytes,
    signal: ctx.signal,
    encode: async (quality) => {
      ctx.signal.throwIfAborted();
      attempts += 1;
      // the bar explains itself: six encodes at most, never an indefinite spinner
      ctx.report(Math.min(0.9, 0.2 + attempts * 0.12));
      const encoded = await encodeCanvas(base, parsed.format, quality);
      if (encoded.fallback) warnings.push('ENCODER_FALLBACK');
      return { bytes: encoded.blob.size, blob: encoded.blob, encoded, quality };
    },
  });

  const best = result.best;
  if (!best) throw new Error('The target search produced no result.');

  if (!result.met) {
    // q1 is still above the target: report it, suggest dimensions, never resize silently
    warnings.push('TARGET_SIZE_UNREACHABLE');
  }

  return {
    blob: best.blob,
    width: base.width,
    height: base.height,
    format: best.encoded.format,
    quality: best.quality,
    warnings,
  };
};
