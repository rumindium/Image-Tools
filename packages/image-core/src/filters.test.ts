import { describe, expect, test } from 'bun:test';
import { FILTERS, applyAdjustments, applyFilter, buildToneLut } from './filters.ts';

function pixel(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

describe('tone LUT', () => {
  test('is identity with no adjustments', () => {
    const lut = buildToneLut({});
    for (const v of [0, 1, 64, 128, 200, 255]) {
      expect(lut.r[v]).toBe(v);
      expect(lut.g[v]).toBe(v);
      expect(lut.b[v]).toBe(v);
    }
  });

  test('brightness is monotonic and clips at the ends', () => {
    const lut = buildToneLut({ brightness: 40 });
    expect(lut.r[255]).toBe(255);
    for (let v = 1; v < 256; v += 1) {
      expect(lut.r[v] as number).toBeGreaterThanOrEqual(lut.r[v - 1] as number);
    }
    expect(lut.r[128] as number).toBeGreaterThan(128);
  });

  test('temperature warms red and cools blue', () => {
    const lut = buildToneLut({ temperature: 50 });
    expect(lut.r[128] as number).toBeGreaterThan(128);
    expect(lut.b[128] as number).toBeLessThan(128);
  });

  test('gamma above 1 brightens mids, below 1 darkens them', () => {
    // the exponent is 1/gamma, so a larger gamma value lifts the midtones (docs/03-EDIT.md §5.2)
    const brighter = buildToneLut({ gamma: 2 });
    const darker = buildToneLut({ gamma: 0.5 });
    expect(brighter.r[64] as number).toBeGreaterThan(64);
    expect(darker.r[64] as number).toBeLessThan(64);
    expect(brighter.r[255]).toBe(255);
  });
});

describe('adjustments', () => {
  test('saturation 0 removes colour but keeps luma', () => {
    const data = pixel(200, 50, 25);
    const expected = 0.2126 * 200 + 0.7152 * 50 + 0.0722 * 25;
    applyAdjustments(data, { saturation: -100 });
    expect(Math.abs((data[0] as number) - expected)).toBeLessThanOrEqual(1);
    expect(data[0]).toBe(data[1] as number);
    expect(data[1]).toBe(data[2] as number);
  });

  test('alpha is never touched', () => {
    const data = pixel(10, 20, 30, 128);
    applyAdjustments(data, { brightness: 80, hue: 90 });
    expect(data[3]).toBe(128);
  });

  test('hue 180 turns red into cyan-ish', () => {
    const data = pixel(255, 0, 0);
    applyAdjustments(data, { hue: 180 });
    expect(data[0] as number).toBeLessThan(40);
    expect(data[1] as number).toBeGreaterThan(200);
    expect(data[2] as number).toBeGreaterThan(200);
  });
});

describe('filters', () => {
  const white = () => pixel(255, 255, 255);

  test('grayscale makes the channels equal', () => {
    const data = pixel(200, 50, 25);
    applyFilter(data, 1, 1, 'grayscale');
    expect(data[0]).toBe(data[1] as number);
    expect(data[1]).toBe(data[2] as number);
  });

  test('invert is exactly 255 - v', () => {
    const data = pixel(10, 200, 255);
    applyFilter(data, 1, 1, 'invert');
    expect([data[0], data[1], data[2]]).toEqual([245, 55, 0]);
  });

  test('sepia matches the reference matrix on pure red', () => {
    const data = pixel(255, 0, 0);
    applyFilter(data, 1, 1, 'sepia');
    expect([data[0], data[1], data[2]]).toEqual([100, 89, 69]);
  });

  test('none and zero intensity are no-ops', () => {
    const untouched = pixel(12, 34, 56);
    applyFilter(untouched, 1, 1, 'none');
    expect([...untouched]).toEqual([12, 34, 56, 255]);

    const alsoUntouched = pixel(12, 34, 56);
    applyFilter(alsoUntouched, 1, 1, 'sepia', 0);
    expect([...alsoUntouched]).toEqual([12, 34, 56, 255]);
  });

  test('a warm filter pushes red above blue', () => {
    const data = pixel(128, 128, 128);
    applyFilter(data, 1, 1, 'warm');
    expect(data[0] as number).toBeGreaterThan(data[2] as number);
  });

  test('blur spreads a bright pixel without moving the centroid', () => {
    const width = 9;
    const height = 9;
    const data = new Uint8ClampedArray(width * height * 4);
    const centre = (4 * width + 4) * 4;
    data[centre] = 255;
    data[centre + 1] = 255;
    data[centre + 2] = 255;
    for (let i = 3; i < data.length; i += 4) data[i] = 255;

    applyFilter(data, width, height, 'blur');

    let weighted = 0;
    let total = 0;
    let neighbours = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = data[(y * width + x) * 4] as number;
        weighted += value * x;
        total += value;
        if ((x !== 4 || y !== 4) && value > 0) neighbours += 1;
      }
    }
    expect(neighbours).toBeGreaterThan(0);
    expect(Math.abs(weighted / total - 4)).toBeLessThan(0.2);
  });

  test('every documented filter runs without throwing', () => {
    for (const filter of FILTERS) {
      const data = new Uint8ClampedArray(64 * 64 * 4).fill(128);
      applyFilter(data, 64, 64, filter);
      expect(data.length).toBe(64 * 64 * 4);
    }
  });

  test('white stays white through a grayscale pass', () => {
    const data = white();
    applyFilter(data, 1, 1, 'grayscale');
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);
  });
});
