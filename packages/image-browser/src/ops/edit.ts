import { CropOptions, RotateOptions, type Warning } from '@ri/contracts';
import { clampRect, dimensionsAfterRotate, rotatedCropToSource } from '@ri/image-core';
import {
  compositeOn,
  cropToCanvas,
  encodeCanvas,
  flipCanvas,
  rotateArbitrary,
  rotateCanvasExact,
  roundCorners,
  targetIsAlpha,
} from '../raster.ts';
import type { Op, OpResult } from './types.ts';

/**
 * `crop` — the rectangle is drawn in the *rotated* frame and mapped back to source pixels with the
 * same function the board uses, then the cropped region is rotated into that frame
 * (docs/03-EDIT.md §3.1, §5.1). 90° multiples are exact copies; nothing is resampled.
 */
export const crop: Op = async (input, options, ctx): Promise<OpResult> => {
  const parsed = CropOptions.parse(options);
  const source = { width: input.width, height: input.height };
  const rotatedFrame = dimensionsAfterRotate(source, parsed.rotate);

  const rect = clampRect(parsed.rect, rotatedFrame);
  const sourceRect = rotatedCropToSource(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    source,
    parsed.rotate,
  );

  const cropped = cropToCanvas(input, sourceRect);
  let canvas = rotateCanvasExact(cropped, parsed.rotate);

  if (parsed.roundCorners > 0) {
    canvas = roundCorners(
      canvas,
      parsed.roundCorners,
      targetIsAlpha(parsed.format) ? null : parsed.background,
    );
  }
  if (!targetIsAlpha(parsed.format)) {
    canvas = compositeOn(canvas, parsed.background);
  }

  ctx.report(0.75);
  const encoded = await encodeCanvas(canvas, parsed.format, parsed.quality);
  const warnings: Warning[] = encoded.fallback ? ['ENCODER_FALLBACK'] : [];

  return {
    blob: encoded.blob,
    width: canvas.width,
    height: canvas.height,
    format: encoded.format,
    quality: encoded.format === 'png' ? null : parsed.quality,
    warnings,
  };
};

/**
 * `rotate-flip` — rotate first, then flip horizontal, then vertical (docs/03-EDIT.md §4). A multiple
 * of 90° is an exact copy; any other angle resamples once and fills the new corners.
 */
export const rotateFlip: Op = async (input, options, ctx): Promise<OpResult> => {
  const parsed = RotateOptions.parse(options);
  const degrees = ((Math.round(parsed.rotate) % 360) + 360) % 360;

  let canvas =
    degrees % 90 === 0
      ? rotateCanvasExact(input.bitmap, degrees as 0 | 90 | 180 | 270)
      : rotateArbitrary(input.bitmap, degrees, parsed.background);

  if (parsed.flipH || parsed.flipV) {
    canvas = flipCanvas(canvas, parsed.flipH, parsed.flipV);
  }
  if (!targetIsAlpha(parsed.format)) {
    canvas = compositeOn(canvas, parsed.background);
  }

  ctx.report(0.75);
  const encoded = await encodeCanvas(canvas, parsed.format, parsed.quality);
  const warnings: Warning[] = encoded.fallback ? ['ENCODER_FALLBACK'] : [];

  return {
    blob: encoded.blob,
    width: canvas.width,
    height: canvas.height,
    format: encoded.format,
    quality: encoded.format === 'png' ? null : parsed.quality,
    warnings,
  };
};
