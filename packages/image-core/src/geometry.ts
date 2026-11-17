/**
 * Geometry: the fit-mode table of docs/04-RESIZE.md §4 and the rotated-crop mapping of
 * docs/03-EDIT.md §3.1. Pure — no DOM, no canvas, so both lanes and the tests share it.
 */

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type FitMode = 'fit' | 'fill' | 'stretch' | 'contain' | 'cover';

export type ResizePlan = {
  width: number;
  height: number;
  /** Source region to cut before scaling (fill/cover and explicit crop). */
  crop: Rect | null;
  /** Background offset when the output is padded (contain). */
  pad: { x: number; y: number } | null;
};

export type ResizeIntent = {
  basis: 'dimensions' | 'percentage' | 'preset' | 'maxEdge';
  width?: number | undefined;
  height?: number | undefined;
  percentage?: number | undefined;
  maxEdge?: number | undefined;
  lockAspect: boolean;
  fit: FitMode;
};

const atLeastOne = (value: number): number => Math.max(1, Math.round(value));

/** The target box implied by the intent, before any fit mode is applied. */
export function targetBox(source: Size, intent: ResizeIntent): { width: number; height: number } | null {
  switch (intent.basis) {
    case 'percentage': {
      const pct = (intent.percentage ?? 100) / 100;
      return { width: atLeastOne(source.width * pct), height: atLeastOne(source.height * pct) };
    }
    case 'maxEdge': {
      const edge = intent.maxEdge ?? Math.max(source.width, source.height);
      const scale = edge / Math.max(source.width, source.height);
      return { width: atLeastOne(source.width * scale), height: atLeastOne(source.height * scale) };
    }
    case 'preset':
    case 'dimensions': {
      if (intent.width !== undefined && intent.height !== undefined) {
        return { width: intent.width, height: intent.height };
      }
      if (intent.width !== undefined) {
        return { width: intent.width, height: atLeastOne((source.height * intent.width) / source.width) };
      }
      if (intent.height !== undefined) {
        return { width: atLeastOne((source.width * intent.height) / source.height), height: intent.height };
      }
      return null;
    }
  }
}

/**
 * The canonical resize plan. `dimensions` with one side and the aspect locked returns the derived
 * size exactly, with no crop and no pad — the user typed one number and gets it
 * (docs/04-RESIZE.md §4.1).
 */
export function planResize(source: Size, intent: ResizeIntent): ResizePlan {
  const box = targetBox(source, intent);
  if (!box) throw new Error('Resize needs a width, a height, a percentage, a max edge or a preset.');

  const oneSideTyped =
    intent.basis === 'dimensions' && (intent.width === undefined) !== (intent.height === undefined);

  if (oneSideTyped && intent.lockAspect) {
    return { width: box.width, height: box.height, crop: null, pad: null };
  }

  return planFit(source, box, intent.fit);
}

export function planFit(source: Size, box: Size, fit: FitMode): ResizePlan {
  switch (fit) {
    case 'stretch':
      return { width: atLeastOne(box.width), height: atLeastOne(box.height), crop: null, pad: null };

    case 'fit':
    case 'contain': {
      const scale = Math.min(box.width / source.width, box.height / source.height);
      const width = atLeastOne(source.width * scale);
      const height = atLeastOne(source.height * scale);
      if (fit === 'fit') return { width, height, crop: null, pad: null };
      return {
        width: box.width,
        height: box.height,
        crop: null,
        pad: { x: Math.floor((box.width - width) / 2), y: Math.floor((box.height - height) / 2) },
      };
    }

    case 'fill':
    case 'cover': {
      const scale = Math.max(box.width / source.width, box.height / source.height);
      const cropWidth = Math.min(source.width, box.width / scale);
      const cropHeight = Math.min(source.height, box.height / scale);
      const crop: Rect = {
        x: Math.round((source.width - cropWidth) / 2),
        y: Math.round((source.height - cropHeight) / 2),
        width: atLeastOne(cropWidth),
        height: atLeastOne(cropHeight),
      };
      return { width: atLeastOne(box.width), height: atLeastOne(box.height), crop, pad: null };
    }
  }
}

/**
 * Maps a rectangle drawn in the rotated preview back to source pixels.
 * Only 90° multiples are exact copies; anything else is resampled by the caller.
 */
export function rotatedCropToSource(rect: Rect, source: Size, rotate: 0 | 90 | 180 | 270): Rect {
  switch (rotate) {
    case 0:
      return { ...rect };
    case 90:
      return {
        x: rect.y,
        y: source.height - (rect.x + rect.width),
        width: rect.height,
        height: rect.width,
      };
    case 180:
      return {
        x: source.width - (rect.x + rect.width),
        y: source.height - (rect.y + rect.height),
        width: rect.width,
        height: rect.height,
      };
    case 270:
      return {
        x: source.width - (rect.y + rect.height),
        y: rect.x,
        width: rect.height,
        height: rect.width,
      };
  }
}

export function dimensionsAfterRotate(source: Size, rotate: number): Size {
  const normalized = ((Math.round(rotate) % 360) + 360) % 360;
  return normalized === 90 || normalized === 270
    ? { width: source.height, height: source.width }
    : { ...source };
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

const NAMED_ASPECTS: ReadonlyArray<{ name: string; ratio: number }> = [
  { name: '1:1', ratio: 1 },
  { name: '4:3', ratio: 4 / 3 },
  { name: '3:2', ratio: 3 / 2 },
  { name: '16:10', ratio: 16 / 10 },
  { name: '16:9', ratio: 16 / 9 },
  { name: '21:9', ratio: 21 / 9 },
  { name: '5:4', ratio: 5 / 4 },
];

/** The exact aspect as a reduced fraction, with no common-name substitution. */
export function reducedAspect(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '0:0';
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

/** "4:3" when the ratio is within 0.5 % of a known one, otherwise the reduced fraction. */
export function aspectName(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '0:0';
  const ratio = width / height;
  for (const known of NAMED_ASPECTS) {
    if (Math.abs(ratio - known.ratio) / known.ratio < 0.005) return known.name;
  }
  return reducedAspect(width, height);
}

/** True when the plan changes the pixel count by more than the upscale guard allows. */
export function isUpscale(source: Size, output: Size): boolean {
  return output.width > source.width || output.height > source.height;
}

/** The whole image as a crop rectangle. */
export function fullRect(size: Size): Rect {
  return { x: 0, y: 0, width: size.width, height: size.height };
}

/** Keeps a crop rectangle inside the image with at least one pixel on each side. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const width = Math.max(1, Math.min(Math.round(rect.width), bounds.width));
  const height = Math.max(1, Math.min(Math.round(rect.height), bounds.height));
  const x = Math.max(0, Math.min(Math.round(rect.x), bounds.width - width));
  const y = Math.max(0, Math.min(Math.round(rect.y), bounds.height - height));
  return { x, y, width, height };
}

/** Fits a rectangle to an aspect ratio around its centre, never leaving the image. */
export function fitRectToRatio(rect: Rect, ratio: number, bounds: Size): Rect {
  const safeRatio = Math.max(0.01, ratio);
  let width = rect.width;
  let height = width / safeRatio;

  if (height > bounds.height) {
    height = bounds.height;
    width = height * safeRatio;
  }
  if (width > bounds.width) {
    width = bounds.width;
    height = width / safeRatio;
  }

  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  return clampRect(
    {
      x: Math.round(centreX - width / 2),
      y: Math.round(centreY - height / 2),
      width: Math.round(width),
      height: Math.round(height),
    },
    bounds,
  );
}

export type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'ne', 'sw', 'se', 'move'];

/**
 * One pointer step of the crop board, in image pixels (docs/03-EDIT.md §3.1). The board and the op
 * share this function, so the rectangle the user sees is the region that is cut.
 */
export function dragRect(
  rect: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: Size,
  ratio?: number,
): Rect {
  if (handle === 'move') {
    return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);
  }

  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle === 'nw' || handle === 'sw') left = Math.min(right - 1, left + dx);
  else right = Math.max(left + 1, right + dx);
  if (handle === 'nw' || handle === 'ne') top = Math.min(bottom - 1, top + dy);
  else bottom = Math.max(top + 1, bottom + dy);

  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(bounds.width, right);
  bottom = Math.min(bounds.height, bottom);

  const next = clampRect({ x: left, y: top, width: right - left, height: bottom - top }, bounds);
  return ratio ? fitRectToRatio(next, ratio, bounds) : next;
}

export function insideBounds(source: Size, rect: Rect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= source.width &&
    rect.y + rect.height <= source.height
  );
}
