import { describe, expect, test } from 'bun:test';
import { EXTENSION, MIME, extensionForMime, formatFromMime, outputFormatForSource } from './formats.ts';

describe('formats', () => {
  test('maps every output format to a MIME type and an extension', () => {
    expect(MIME.jpeg).toBe('image/jpeg');
    expect(EXTENSION.jpeg).toBe('jpg');
    expect(EXTENSION.avif).toBe('avif');
  });

  test('reads the actual blob type, not the requested one', () => {
    expect(formatFromMime('image/webp')).toBe('webp');
    expect(formatFromMime('image/png; charset=binary')).toBe('png');
    expect(formatFromMime('image/gif')).toBeNull();
  });

  test('names the file from the produced MIME type', () => {
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('application/octet-stream')).toBe('bin');
  });

  test('a source the canvas cannot write falls back to PNG', () => {
    expect(outputFormatForSource('jpeg')).toBe('jpeg');
    expect(outputFormatForSource('gif')).toBe('png');
    expect(outputFormatForSource('heic')).toBe('png');
  });
});
