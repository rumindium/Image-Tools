import { describe, expect, test } from 'bun:test';
import { searchQuality, suggestDimensions } from './size-search.ts';

/** A deterministic stand-in encoder: bytes fall as quality rises, with a flat spot near q40. */
function fakeEncoder(calls: number[], bytesFor: (quality: number) => number) {
  return async (quality: number): Promise<{ bytes: number; quality: number }> => {
    calls.push(quality);
    return { bytes: bytesFor(quality), quality };
  };
}

const linear = (quality: number): number => 10_000 + quality * 4_000;

describe('searchQuality', () => {
  test('finds the largest quality that fits', async () => {
    const calls: number[] = [];
    const result = await searchQuality({ targetBytes: 100_000, encode: fakeEncoder(calls, linear) });
    expect(result.met).toBe(true);
    expect(result.best?.bytes).toBeLessThanOrEqual(100_000);
    expect(result.quality).toBeGreaterThanOrEqual(20);
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  test('is bounded even when the target is unreachable', async () => {
    const calls: number[] = [];
    const result = await searchQuality({ targetBytes: 500, encode: fakeEncoder(calls, linear) });
    expect(result.met).toBe(false);
    expect(result.quality).toBe(1);
    expect(result.best?.bytes).toBe(14_000);
    expect(calls.length).toBeLessThanOrEqual(7);
  });

  test('keeps the best fitting result when the encoder is not monotonic', async () => {
    const calls: number[] = [];
    const bumpy = (quality: number): number => (quality === 62 ? 90_000 : 40_000 + quality * 500);
    const result = await searchQuality({ targetBytes: 70_000, encode: fakeEncoder(calls, bumpy) });
    expect(result.met).toBe(true);
    expect(result.best?.bytes).toBeLessThanOrEqual(70_000);
  });

  test('honours an abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchQuality({ targetBytes: 1000, encode: fakeEncoder([], linear), signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe('suggestDimensions', () => {
  test('scales both sides by the square root of the byte budget', () => {
    const suggestion = suggestDimensions(300_000, 0.5, { width: 4000, height: 3000 });
    expect(suggestion.width).toBeLessThan(4000);
    expect(suggestion.height).toBeLessThan(3000);
    expect(Math.abs(suggestion.width / suggestion.height - 4 / 3)).toBeLessThan(0.01);
  });
});
