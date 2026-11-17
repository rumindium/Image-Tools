import { AppError } from '@ri/contracts';
import { HAS_ALPHA, MIME, type OutputFormat, formatFromMime } from './formats.ts';

/**
 * Canvas primitives for the browser lane (docs/0-PROCESSING-PIPELINE.md §3–§5). Everything here runs
 * inside the worker: no DOM, no `document`, only OffscreenCanvas.
 */

export type Raster = { bitmap: ImageBitmap; width: number; height: number };

export function surface(width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const context = canvas.getContext('2d');
  if (!context) throw new AppError('MEMORY_LIMIT_EXCEEDED', 'The browser refused a 2D canvas for this size.');
  return canvas;
}

export async function decode(blob: Blob): Promise<Raster> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // The header parsed on the main thread, so a failure here is a corrupt body or a missing codec.
    throw new AppError(
      'DECODE_FAILED',
      'This image could not be decoded. It may be corrupt or use a codec this browser lacks.',
    );
  }
}

export function release(raster: Raster | null | undefined): void {
  raster?.bitmap.close();
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context)
    throw new AppError('MEMORY_LIMIT_EXCEEDED', 'A 2D context could not be created for this image.');
  return context;
}

export function fill(canvas: OffscreenCanvas, colour: string): void {
  const context = context2d(canvas);
  context.fillStyle = colour;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

/** Composites onto an opaque colour before encoding to a format without alpha. */
export function flatten(raster: Raster, colour: string): OffscreenCanvas {
  const canvas = surface(raster.width, raster.height);
  fill(canvas, colour);
  context2d(canvas).drawImage(raster.bitmap, 0, 0);
  return canvas;
}

export function toCanvas(raster: Raster): OffscreenCanvas {
  const canvas = surface(raster.width, raster.height);
  context2d(canvas).drawImage(raster.bitmap, 0, 0);
  return canvas;
}

export type CropRect = { x: number; y: number; width: number; height: number };

/** Exact copy path: smoothing off, integer source rectangle (docs/03-EDIT.md §5.1). */
export function cropToCanvas(raster: Raster, rect: CropRect): OffscreenCanvas {
  const canvas = surface(rect.width, rect.height);
  const context = context2d(canvas);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    raster.bitmap,
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.width),
    Math.round(rect.height),
    0,
    0,
    Math.round(rect.width),
    Math.round(rect.height),
  );
  return canvas;
}

export type DrawTarget = { x: number; y: number; width: number; height: number };

/**
 * Draws a source into `target` inside `out`, halving first while the target is more than 2× smaller
 * (docs/0-PROCESSING-PIPELINE.md §8.1). A single 10× drawImage aliases; three 2× passes do not.
 */
export function drawResampled(
  source: ImageBitmap | OffscreenCanvas,
  out: OffscreenCanvas,
  target: DrawTarget,
  smoothing: boolean,
): void {
  let current: ImageBitmap | OffscreenCanvas = source;

  if (smoothing) {
    while (current.width > target.width * 2 && current.height > target.height * 2) {
      const half = surface(
        Math.max(target.width, Math.floor(current.width / 2)),
        Math.max(target.height, Math.floor(current.height / 2)),
      );
      const context = context2d(half);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(current, 0, 0, half.width, half.height);
      if (current !== source && 'close' in current) current.close();
      current = half;
    }
  }

  const context = context2d(out);
  context.imageSmoothingEnabled = smoothing;
  context.imageSmoothingQuality = 'high';
  context.drawImage(current, target.x, target.y, target.width, target.height);
  if (current !== source && 'close' in current) current.close();
}

export type Encoded = {
  blob: Blob;
  format: OutputFormat;
  mime: string;
  requested: OutputFormat;
  fallback: boolean;
};

/**
 * The encode matrix. `blob.type` is checked, never trusted: an old Safari returns `image/png` from
 * `convertToBlob({type:'image/webp'})` without an error, and naming those bytes `.webp` is the most
 * common lie in this product category (docs/01-CONVERT.md §5).
 */
export async function encodeCanvas(
  canvas: OffscreenCanvas,
  requested: OutputFormat,
  quality: number,
): Promise<Encoded> {
  const mime = MIME[requested];
  const blob = await canvas.convertToBlob({
    type: mime,
    quality: Math.min(1, Math.max(0.01, quality / 100)),
  });
  const actual = formatFromMime(blob.type);
  if (!actual) {
    throw new AppError(
      'ENCODING_FAILED',
      `The browser produced ${blob.type || 'an unknown type'} instead of ${mime}.`,
    );
  }
  return { blob, format: actual, mime: blob.type, requested, fallback: actual !== requested };
}

export function targetIsAlpha(format: OutputFormat): boolean {
  return HAS_ALPHA[format];
}

/** Exact 90° multiples: one draw with a transform matrix, no resampling (docs/03-EDIT.md §5.1). */
export function rotateCanvasExact(
  source: ImageBitmap | OffscreenCanvas,
  rotate: 0 | 90 | 180 | 270,
): OffscreenCanvas {
  const swaps = rotate === 90 || rotate === 270;
  const out = surface(swaps ? source.height : source.width, swaps ? source.width : source.height);
  const context = context2d(out);
  context.imageSmoothingEnabled = false;

  if (rotate === 90) {
    context.translate(out.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotate === 180) {
    context.translate(out.width, out.height);
    context.rotate(Math.PI);
  } else if (rotate === 270) {
    context.translate(0, out.height);
    context.rotate(-Math.PI / 2);
  }

  context.drawImage(source, 0, 0);
  return out;
}

/** Any other angle resamples once and grows the canvas to the bounding box, filling the corners. */
export function rotateArbitrary(
  source: ImageBitmap | OffscreenCanvas,
  degrees: number,
  background: string,
): OffscreenCanvas {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = Math.max(1, Math.ceil(source.width * cos + source.height * sin));
  const height = Math.max(1, Math.ceil(source.width * sin + source.height * cos));

  const out = surface(width, height);
  fill(out, background);
  const context = context2d(out);
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

export function flipCanvas(
  source: ImageBitmap | OffscreenCanvas,
  flipH: boolean,
  flipV: boolean,
): OffscreenCanvas {
  const out = surface(source.width, source.height);
  const context = context2d(out);
  context.translate(flipH ? out.width : 0, flipV ? out.height : 0);
  context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  context.drawImage(source, 0, 0);
  return out;
}

/** Composites a canvas onto an opaque colour (the flatten path for JPEG/BMP targets). */
export function compositeOn(source: ImageBitmap | OffscreenCanvas, colour: string): OffscreenCanvas {
  const out = surface(source.width, source.height);
  fill(out, colour);
  context2d(out).drawImage(source, 0, 0);
  return out;
}

/**
 * Rounded corners for the crop tool. `background: null` leaves them transparent, which is only
 * honest for a format that keeps alpha.
 */
export function roundCorners(
  source: ImageBitmap | OffscreenCanvas,
  radius: number,
  background: string | null,
): OffscreenCanvas {
  const out = surface(source.width, source.height);
  const context = context2d(out);
  if (background) fill(out, background);
  const clamped = Math.max(0, Math.min(radius, Math.min(source.width, source.height) / 2));
  context.beginPath();
  context.roundRect(0, 0, source.width, source.height, clamped);
  context.clip();
  context.drawImage(source, 0, 0);
  return out;
}

/**
 * Samples a 64 px copy for a single transparent pixel. Reading the full raster to answer this would
 * cost 4 bytes per pixel; a sampled answer is enough to decide whether to warn about flattening.
 */
export function hasTransparency(raster: Raster): boolean {
  const probe = surface(Math.min(64, raster.width), Math.min(64, raster.height));
  const context = context2d(probe);
  context.drawImage(raster.bitmap, 0, 0, probe.width, probe.height);
  const { data } = context.getImageData(0, 0, probe.width, probe.height);
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] as number) < 255) return true;
  }
  return false;
}
