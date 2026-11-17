import { AdjustOptions, FilterOptions, type Warning } from '@ri/contracts';
import { applyAdjustments, applyFilter, unsharpMask } from '@ri/image-core';
import { compositeOn, encodeCanvas, targetIsAlpha, toCanvas } from '../raster.ts';
import type { Op, OpResult } from './types.ts';

/**
 * `adjust` and `filter` — the one CPU pass over full-resolution pixels that the pipeline allows
 * (docs/0-PROCESSING-PIPELINE.md §4). Each is a LUT/recipe composition, not a bespoke pipeline, so
 * the reference tests in image-core cover the maths.
 */

const FLATTEN_BACKGROUND = '#ffffff';

export const adjust: Op = async (input, options, ctx): Promise<OpResult> => {
  const parsed = AdjustOptions.parse(options);
  let canvas = toCanvas(input);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D context was not available for this image.');

  ctx.report(0.25);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  applyAdjustments(image.data, parsed);
  if (parsed.sharpen > 0) {
    unsharpMask(image.data, canvas.width, canvas.height, (parsed.sharpen / 100) * 1.5);
  }
  context.putImageData(image, 0, 0);
  ctx.report(0.8);

  if (!targetIsAlpha(parsed.format)) canvas = compositeOn(canvas, FLATTEN_BACKGROUND);
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

export const filter: Op = async (input, options, ctx): Promise<OpResult> => {
  const parsed = FilterOptions.parse(options);
  let canvas = toCanvas(input);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D context was not available for this image.');

  ctx.report(0.25);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  applyFilter(image.data, canvas.width, canvas.height, parsed.filter, parsed.intensity);
  context.putImageData(image, 0, 0);
  ctx.report(0.8);

  if (!targetIsAlpha(parsed.format)) canvas = compositeOn(canvas, FLATTEN_BACKGROUND);
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
