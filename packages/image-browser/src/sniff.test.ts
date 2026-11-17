import { describe, expect, test } from 'bun:test';
import { describeRejection, isSupportedFormat, sniffBytes } from './sniff.ts';

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (length 4, no payload), SOF0 with the dimensions.
  const bytes = new Uint8Array(2 + 2 + 4 + 2 + 15 + 2);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], 2);
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 8);
  const view = new DataView(bytes.buffer);
  view.setUint16(13, height, false);
  view.setUint16(15, width, false);
  return bytes;
}

function gif(width: number, height: number, frames: number): Uint8Array {
  const bytes = new Uint8Array(13 + frames * 8);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  for (let i = 0; i < frames; i += 1) {
    bytes.set([0x21, 0xf9], 13 + i * 8);
  }
  return bytes;
}

describe('sniffBytes', () => {
  test('PNG reads IHDR dimensions', () => {
    expect(sniffBytes(png(4032, 3024))).toMatchObject({
      format: 'png',
      mime: 'image/png',
      width: 4032,
      height: 3024,
      animated: false,
    });
  });

  test('JPEG walks to the frame header', () => {
    expect(sniffBytes(jpeg(1200, 900))).toMatchObject({ format: 'jpeg', width: 1200, height: 900 });
  });

  test('GIF reports animation', () => {
    expect(sniffBytes(gif(320, 240, 1)).animated).toBe(false);
    expect(sniffBytes(gif(320, 240, 3)).animated).toBe(true);
  });

  test('WebP VP8X reads canvas dimensions', () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x56, 0x50, 0x38, 0x58], 12);
    bytes[24] = 0x07; // width - 1 = 7
    bytes[27] = 0x03; // height - 1 = 3
    expect(sniffBytes(bytes)).toMatchObject({ format: 'webp', width: 8, height: 4 });
  });

  test('AVIF and HEIC are recognised by brand', () => {
    const avif = new Uint8Array(16);
    avif.set([0x00, 0x00, 0x00, 0x20], 0);
    avif.set([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4);
    expect(sniffBytes(avif).format).toBe('avif');

    const heic = avif.slice();
    heic.set([0x68, 0x65, 0x69, 0x63], 8);
    expect(sniffBytes(heic).format).toBe('heic');
  });

  test('SVG is text, and a PDF is not an image', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffBytes(svg).format).toBe('svg');

    const pdf = new TextEncoder().encode('%PDF-1.7\n...');
    const sniffed = sniffBytes(pdf);
    expect(sniffed.format).toBe('unknown');
    expect(isSupportedFormat(sniffed.format)).toBe(false);
    expect(describeRejection(sniffed)).toContain('not an image');
  });

  test('a PNG header with absurd dimensions is still read, and can be refused by the caller', () => {
    const sniffed = sniffBytes(png(100_000, 100_000));
    expect(sniffed.width).toBe(100_000);
    expect(sniffed.height).toBe(100_000);
  });
});
