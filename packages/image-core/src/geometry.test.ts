import { describe, expect, test } from 'bun:test';
import { clampRect, dragRect, fitRectToRatio } from './geometry.ts';
import {
  type ResizeIntent,
  aspectName,
  dimensionsAfterRotate,
  insideBounds,
  planFit,
  planResize,
  reducedAspect,
  rotatedCropToSource,
} from './geometry.ts';

const source = { width: 1200, height: 900 };

describe('planFit — the table in docs/04-RESIZE.md §4', () => {
  test('fit puts the image inside the box and leaves the box unfilled', () => {
    expect(planFit(source, { width: 600, height: 600 }, 'fit')).toEqual({
      width: 600,
      height: 450,
      crop: null,
      pad: null,
    });
  });

  test('contain fills the box and pads the remainder', () => {
    expect(planFit(source, { width: 600, height: 600 }, 'contain')).toEqual({
      width: 600,
      height: 600,
      crop: null,
      pad: { x: 0, y: 75 },
    });
  });

  test('fill covers the box and crops the overflow, centred', () => {
    const plan = planFit(source, { width: 600, height: 600 }, 'fill');
    expect([plan.width, plan.height]).toEqual([600, 600]);
    expect(plan.crop).toEqual({ x: 150, y: 0, width: 900, height: 900 });
  });

  test('cover is fill', () => {
    expect(planFit(source, { width: 400, height: 400 }, 'cover')).toEqual(
      planFit(source, { width: 400, height: 400 }, 'fill'),
    );
  });

  test('stretch ignores the aspect ratio', () => {
    expect(planFit(source, { width: 200, height: 800 }, 'stretch')).toEqual({
      width: 200,
      height: 800,
      crop: null,
      pad: null,
    });
  });
});

describe('planResize — intent to plan', () => {
  const base: ResizeIntent = { basis: 'dimensions', lockAspect: true, fit: 'fit' };

  test('width only derives the height exactly', () => {
    const plan = planResize(source, { ...base, width: 1080 });
    expect([plan.width, plan.height]).toEqual([1080, 810]);
    expect(plan.crop).toBeNull();
  });

  test('height only derives the width exactly', () => {
    const plan = planResize(source, { ...base, height: 600 });
    expect([plan.width, plan.height]).toEqual([800, 600]);
  });

  test('both sides with the aspect locked fit inside the box', () => {
    const plan = planResize(source, { ...base, width: 600, height: 600 });
    expect([plan.width, plan.height]).toEqual([600, 450]);
  });

  test('percentage is exact halves', () => {
    const plan = planResize(source, { basis: 'percentage', percentage: 50, lockAspect: true, fit: 'fit' });
    expect([plan.width, plan.height]).toEqual([600, 450]);
  });

  test('maxEdge targets the longest side', () => {
    const plan = planResize(source, { basis: 'maxEdge', maxEdge: 600, lockAspect: true, fit: 'fit' });
    expect([plan.width, plan.height]).toEqual([600, 450]);
  });

  test('a missing target is refused rather than guessed', () => {
    expect(() => planResize(source, { ...base, fit: 'fit' })).toThrow(/needs a width/);
  });
});

describe('rotatedCropToSource', () => {
  const portrait = { width: 4032, height: 3024 };

  test('0° is identity', () => {
    expect(rotatedCropToSource({ x: 10, y: 20, width: 30, height: 40 }, portrait, 0)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  test('90° maps a full-frame crop back to the full source', () => {
    expect(rotatedCropToSource({ x: 0, y: 0, width: 3024, height: 4032 }, portrait, 90)).toEqual({
      x: 0,
      y: 0,
      width: 4032,
      height: 3024,
    });
  });

  test('90° moves the top-left of the rotated frame to the top-right of the source', () => {
    const mapped = rotatedCropToSource({ x: 0, y: 0, width: 100, height: 100 }, portrait, 90);
    expect(mapped).toEqual({ x: 0, y: 3024 - 100, width: 100, height: 100 });
    expect(insideBounds(portrait, mapped)).toBe(true);
  });

  test('180° mirrors both axes', () => {
    expect(rotatedCropToSource({ x: 0, y: 0, width: 100, height: 50 }, portrait, 180)).toEqual({
      x: 3932,
      y: 2974,
      width: 100,
      height: 50,
    });
  });

  test('270° swaps the axes', () => {
    const mapped = rotatedCropToSource({ x: 10, y: 20, width: 30, height: 40 }, portrait, 270);
    expect(mapped.width).toBe(40);
    expect(mapped.height).toBe(30);
    expect(insideBounds(portrait, mapped)).toBe(true);
  });

  test('dimensions swap for quarter turns only', () => {
    expect(dimensionsAfterRotate(portrait, 90)).toEqual({ width: 3024, height: 4032 });
    expect(dimensionsAfterRotate(portrait, 180)).toEqual(portrait);
    expect(dimensionsAfterRotate(portrait, 7.5)).toEqual(portrait);
  });
});

describe('crop board math', () => {
  const bounds = { width: 400, height: 300 };

  test('clampRect keeps a rectangle inside with at least one pixel', () => {
    expect(clampRect({ x: -20, y: 290, width: 500, height: 50 }, bounds)).toEqual({
      x: 0,
      y: 250,
      width: 400,
      height: 50,
    });
    expect(clampRect({ x: 10, y: 10, width: 0, height: -5 }, bounds)).toEqual({
      x: 10,
      y: 10,
      width: 1,
      height: 1,
    });
  });

  test('fitRectToRatio keeps the centre and never exceeds the image', () => {
    const square = fitRectToRatio({ x: 100, y: 50, width: 200, height: 100 }, 1, bounds);
    expect(square.width).toBe(square.height);
    expect(square.x + square.width / 2).toBeCloseTo(200, 0);
    expect(square.width).toBeLessThanOrEqual(bounds.width);

    const wide = fitRectToRatio({ x: 0, y: 0, width: 400, height: 40 }, 16 / 9, bounds);
    expect(wide.width).toBeLessThanOrEqual(400);
    expect(wide.height).toBeLessThanOrEqual(300);
  });

  test('dragRect moves without leaving the image', () => {
    expect(dragRect({ x: 10, y: 10, width: 100, height: 100 }, 'move', 500, -50, bounds)).toEqual({
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  test('dragRect resizes from a corner and keeps a positive size', () => {
    const grown = dragRect({ x: 50, y: 50, width: 100, height: 100 }, 'se', 40, 20, bounds);
    expect(grown).toEqual({ x: 50, y: 50, width: 140, height: 120 });

    const collapsed = dragRect({ x: 50, y: 50, width: 100, height: 100 }, 'se', -500, -500, bounds);
    expect(collapsed.width).toBeGreaterThanOrEqual(1);
    expect(collapsed.height).toBeGreaterThanOrEqual(1);
  });

  test('dragRect with a ratio returns that ratio', () => {
    const rect = dragRect({ x: 20, y: 20, width: 100, height: 100 }, 'se', 80, 0, bounds, 1);
    expect(Math.abs(rect.width - rect.height)).toBeLessThanOrEqual(1);
  });
});

describe('aspectName', () => {
  test('names common ratios and reduces the rest', () => {
    expect(aspectName(1920, 1080)).toBe('16:9');
    expect(aspectName(4000, 3000)).toBe('4:3');
    expect(aspectName(1000, 1000)).toBe('1:1');
    expect(aspectName(1200, 777)).toBe('400:259');
  });

  test('reducedAspect never substitutes a common name', () => {
    expect(reducedAspect(4000, 3000)).toBe('4:3');
    expect(reducedAspect(1920, 1080)).toBe('16:9');
    expect(reducedAspect(1200, 777)).toBe('400:259');
    expect(reducedAspect(0, 777)).toBe('0:0');
  });
});
