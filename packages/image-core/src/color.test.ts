import { describe, expect, test } from 'bun:test';
import {
  contrastRatio,
  deltaE76,
  deltaE2000,
  foregroundFor,
  hexToRgb,
  hslToRgb,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
} from './color.ts';

const black = { r: 0, g: 0, b: 0 };
const white = { r: 255, g: 255, b: 255 };

describe('hex and rgb', () => {
  test('round trips', () => {
    expect(hexToRgb('#c2452d')).toEqual({ r: 194, g: 69, b: 45 });
    expect(rgbToHex({ r: 194, g: 69, b: 45 })).toBe('#c2452d');
  });

  test('rejects malformed hex rather than guessing', () => {
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('c2452d')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
  });
});

describe('hsl', () => {
  test('primary red is 0/100/50', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
  });

  test('grey has no hue', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50.2 });
  });

  test('round trips within one byte per channel', () => {
    for (const rgb of [
      { r: 194, g: 69, b: 45 },
      { r: 47, g: 52, b: 55 },
      { r: 18, g: 240, b: 200 },
    ]) {
      const back = hslToRgb(rgbToHsl(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });
});

describe('contrast', () => {
  test('white on black is 21:1', () => {
    expect(contrastRatio(white, black)).toBe(21);
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
  });

  test('foregroundFor picks the readable option', () => {
    expect(foregroundFor({ r: 20, g: 20, b: 20 })).toBe('#ffffff');
    expect(foregroundFor({ r: 245, g: 245, b: 245 })).toBe('#15181d');
  });
});

describe('perceptual distance', () => {
  test('identical colours have zero distance', () => {
    expect(deltaE2000(white, white)).toBe(0);
    expect(deltaE76({ r: 12, g: 34, b: 56 }, { r: 12, g: 34, b: 56 })).toBe(0);
  });

  test('black against white is ~100', () => {
    expect(deltaE2000(black, white)).toBeGreaterThan(99);
    expect(deltaE2000(black, white)).toBeLessThan(101);
  });

  test('is symmetric', () => {
    const a = { r: 194, g: 69, b: 45 };
    const b = { r: 232, g: 226, b: 217 };
    expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 9);
  });

  test('a near-identical pair is far below the test tolerance', () => {
    expect(deltaE2000({ r: 200, g: 50, b: 50 }, { r: 201, g: 50, b: 50 })).toBeLessThan(0.5);
  });

  test('CIE76 and CIEDE2000 agree on direction for a large difference', () => {
    const a = { r: 10, g: 200, b: 30 };
    const b = { r: 240, g: 20, b: 190 };
    expect(deltaE76(a, b)).toBeGreaterThan(10);
    expect(deltaE2000(a, b)).toBeGreaterThan(10);
  });
});
