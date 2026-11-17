import { describe, expect, test } from 'bun:test';
import { clamp, formatBytes, formatDimensions, formatMegapixels, safeInt, toMegabytes } from './units.ts';

describe('formatBytes', () => {
  test('uses decimal units and one decimal under 100', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(820_000)).toBe('820 KB');
    expect(formatBytes(4_821_331)).toBe('4.8 MB');
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB');
  });

  test('never renders a negative or non-finite size as a number', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatDimensions', () => {
  test('groups thousands', () => {
    expect(formatDimensions(4032, 3024)).toBe('4,032 × 3,024');
  });
});

describe('formatMegapixels', () => {
  test('one decimal below 100 MP, whole numbers above', () => {
    expect(formatMegapixels(12_192_768)).toBe('12.2 MP');
    expect(formatMegapixels(192_000_000)).toBe('192 MP');
  });
});

describe('numbers from forms', () => {
  test('safeInt rejects anything that is not digits', () => {
    expect(safeInt('1080')).toBe(1080);
    expect(safeInt('10.5')).toBeNull();
    expect(safeInt('')).toBeNull();
    expect(safeInt('1e3')).toBeNull();
  });

  test('clamp and toMegabytes', () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(toMegabytes(26_214_400)).toBe(26);
  });
});
