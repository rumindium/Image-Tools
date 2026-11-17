import { AppError, ConvertOptions, type Warning } from '@ri/contracts';
import { encodeCanvas, flatten, targetIsAlpha, toCanvas } from '../raster.ts';
import type { Op, OpContext, OpResult } from './types.ts';

/**
 * `convert` — re-encode at the same dimensions (docs/01-CONVERT.md §5). Three decisions matter:
 * flatten before encode (never after), check the produced MIME, and say when metadata was dropped.
 */
export const convert: Op = async (input, options, ctx: OpContext): Promise<OpResult> => {
  const parsed = ConvertOptions.parse(options);
  const warnings: Warning[] = [];

  const needsFlatten = !targetIsAlpha(parsed.format) && ctx.inputHasAlpha;
  const canvas = needsFlatten ? flatten(input, parsed.background) : toCanvas(input);
  if (needsFlatten) warnings.push('ALPHA_FLATTENED');
  if (parsed.keepMetadata) {
    // canvas has no API to carry EXIF/ICC; pretending otherwise would be the lie this tool avoids
    warnings.push('METADATA_DROPPED');
  }

  ctx.report(0.7);
  const encoded = await encodeCanvas(canvas, parsed.format, parsed.quality);

  if (encoded.fallback) {
    throw new AppError(
      'ENCODE_UNSUPPORTED',
      `This browser asked for ${parsed.format.toUpperCase()} and produced ${encoded.format.toUpperCase()}. The file was not saved under a misleading name.`,
      { hint: 'Choose PNG or WebP, or update the browser.' },
    );
  }

  if (encoded.format === 'webp' && parsed.format === 'jpeg') {
    // defensive: encodeCanvas already throws on a mismatch, this keeps the intent explicit
    throw new AppError('ENCODING_FAILED', 'The encoder returned a different format than requested.');
  }

  ctx.report(1);
  return {
    blob: encoded.blob,
    width: canvas.width,
    height: canvas.height,
    format: encoded.format,
    quality: parsed.format === 'png' ? null : parsed.quality,
    warnings,
  };
};
