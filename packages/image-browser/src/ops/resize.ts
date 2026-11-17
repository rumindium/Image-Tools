import { AppError, ResizeOptions } from '@ri/contracts';
import { planResize } from '@ri/image-core';
import { type OutputFormat, outputFormatForSource } from '../formats.ts';
import { cropToCanvas, drawResampled, encodeCanvas, fill, surface } from '../raster.ts';
import type { Op, OpResult } from './types.ts';

const MAX_OUTPUT_PIXELS = 64_000_000;

/**
 * `resize` — the arithmetic lives in image-core (`planResize`), this file only touches pixels
 * (docs/04-RESIZE.md §5). `contain` fills the background *before* the draw so a JPEG never gets
 * black bars from a transparent canvas.
 */
export const resize: Op = async (input, options, ctx): Promise<OpResult> => {
  const parsed = ResizeOptions.parse(options);

  const plan = planResize(
    { width: input.width, height: input.height },
    {
      basis: parsed.basis,
      width: parsed.width,
      height: parsed.height,
      percentage: parsed.percentage,
      maxEdge: parsed.maxEdge,
      lockAspect: parsed.lockAspect,
      fit: parsed.fit,
    },
  );

  const grows = plan.width > input.width || plan.height > input.height;
  if (grows && !parsed.allowUpscale) {
    throw new AppError(
      'VALIDATION_ERROR',
      `This resize would grow the image from ${input.width}×${input.height} to ${plan.width}×${plan.height}.`,
      { hint: 'Enable upscaling, or pick a size at or below the source.' },
    );
  }
  if (plan.width * plan.height > MAX_OUTPUT_PIXELS) {
    throw new AppError('IMAGE_TOO_LARGE', 'The resized output would be larger than 64 MP.');
  }

  const out = surface(plan.width, plan.height);
  if (parsed.fit === 'contain') fill(out, parsed.background);

  const source: ImageBitmap | OffscreenCanvas = plan.crop ? cropToCanvas(input, plan.crop) : input.bitmap;
  const target = { x: 0, y: 0, width: plan.width, height: plan.height };

  if (parsed.fit === 'contain') {
    const scale = Math.min(plan.width / input.width, plan.height / input.height);
    const contentWidth = Math.max(1, Math.round(input.width * scale));
    const contentHeight = Math.max(1, Math.round(input.height * scale));
    target.width = contentWidth;
    target.height = contentHeight;
    target.x = Math.floor((plan.width - contentWidth) / 2);
    target.y = Math.floor((plan.height - contentHeight) / 2);
  }

  ctx.report(0.35);
  drawResampled(source, out, target, parsed.filter !== 'nearest');
  ctx.report(0.85);

  const format: OutputFormat = parsed.format ?? outputFormatForSource(ctx.inputFormat);
  const encoded = await encodeCanvas(out, format, parsed.quality);
  const warnings = encoded.fallback ? (['ENCODER_FALLBACK'] as const) : [];

  return {
    blob: encoded.blob,
    width: out.width,
    height: out.height,
    format: encoded.format,
    quality: encoded.format === 'png' ? null : parsed.quality,
    warnings: [...warnings],
  };
};

/** Used by `compress` for its optional dimension cap: never upscales, never consumes its source. */
export function scaleDownCanvas(
  source: ImageBitmap | OffscreenCanvas,
  width: number,
  height: number,
  maxWidth?: number,
  maxHeight?: number,
): OffscreenCanvas {
  const scale = Math.min(1, (maxWidth ?? width) / width, (maxHeight ?? height) / height);
  const out = surface(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  drawResampled(source, out, { x: 0, y: 0, width: out.width, height: out.height }, true);
  return out;
}
