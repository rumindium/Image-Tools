import { describe, expect, it } from 'bun:test';
import { type HeaderMetadata, orientationEffect, readImageMetadata, readTiffMetadata } from './metadata.ts';

type TiffOptions = {
  little?: boolean;
  width?: number;
  height?: number;
  orientation?: number;
  bitDepth?: number;
  dpi?: number;
  unit?: number;
  icc?: boolean;
};

function tiffBytes(options: TiffOptions = {}): Uint8Array {
  const {
    little = true,
    width = 4032,
    height = 3024,
    orientation = 6,
    bitDepth = 8,
    dpi = 300,
    unit = 2,
    icc = false,
  } = options;

  const entryCount = 8;
  const ifdOffset = 8;
  const entriesStart = ifdOffset + 2;
  const dataStart = entriesStart + entryCount * 12 + 4;
  const bytes = new Uint8Array(dataStart + 16);
  const view = new DataView(bytes.buffer);

  bytes[0] = little ? 0x49 : 0x4d;
  bytes[1] = little ? 0x49 : 0x4d;
  view.setUint16(2, 42, little);
  view.setUint32(4, ifdOffset, little);
  view.setUint16(ifdOffset, entryCount, little);

  const writeEntry = (
    index: number,
    tag: number,
    type: number,
    count: number,
    value: number,
    inline: boolean,
  ) => {
    const entry = entriesStart + index * 12;
    view.setUint16(entry, tag, little);
    view.setUint16(entry + 2, type, little);
    view.setUint32(entry + 4, count, little);
    if (inline) {
      if (type === 3) view.setUint16(entry + 8, value, little);
      else view.setUint32(entry + 8, value, little);
    } else {
      view.setUint32(entry + 8, value, little);
    }
  };

  writeEntry(0, 0x0100, 4, 1, width, true);
  writeEntry(1, 0x0101, 4, 1, height, true);
  writeEntry(2, 0x0102, 3, 1, bitDepth, true);
  writeEntry(3, 0x0112, 3, 1, orientation, true);
  writeEntry(4, 0x011a, 5, 1, dataStart, false);
  writeEntry(5, 0x011b, 5, 1, dataStart + 8, false);
  writeEntry(6, 0x0128, 3, 1, unit, true);
  writeEntry(7, 0x8773, 7, 4, 0, true);

  view.setUint32(dataStart, Math.round(dpi * 1_000_000), little);
  view.setUint32(dataStart + 4, 1_000_000, little);
  view.setUint32(dataStart + 8, Math.round(dpi * 1_000_000), little);
  view.setUint32(dataStart + 12, 1_000_000, little);

  if (!icc) {
    // The parser only needs the tag's presence; clearing the tag makes the negative case explicit.
    const iccEntry = entriesStart + 7 * 12;
    view.setUint16(iccEntry, 0x0000, little);
  }

  return bytes;
}

function segment(marker: number, payload: Uint8Array): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function asciiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function pngChunk(type: string, data: Uint8Array): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...asciiBytes(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

describe('EXIF / TIFF header metadata', () => {
  it('reads orientation, DPI, bit depth and dimensions from a little-endian IFD', () => {
    const meta = readTiffMetadata(tiffBytes());
    expect(meta.width).toBe(4032);
    expect(meta.height).toBe(3024);
    expect(meta.bitDepth).toBe(8);
    expect(meta.dpi).toBe(300);
    expect(meta.icc).toBe(false);
    expect(meta.orientation).toEqual({ tag: 6, effect: 'rotate 90° clockwise' });
  });

  it('reads a big-endian IFD', () => {
    const meta = readTiffMetadata(tiffBytes({ little: false, orientation: 8, dpi: 72 }));
    expect(meta.orientation).toEqual({ tag: 8, effect: 'rotate 270° clockwise' });
    expect(meta.dpi).toBe(72);
  });

  it('converts a centimetre resolution unit and detects ICC presence', () => {
    const meta = readTiffMetadata(tiffBytes({ dpi: 118, unit: 3, icc: true }));
    expect(meta.dpi).toBe(299.7);
    expect(meta.icc).toBe(true);
  });

  it('names every EXIF orientation and rejects an unknown tag', () => {
    expect(orientationEffect(1)).toBe('upright');
    expect(orientationEffect(2)).toBe('mirror horizontally');
    expect(orientationEffect(3)).toBe('rotate 180°');
    expect(orientationEffect(4)).toBe('mirror vertically');
    expect(orientationEffect(5)).toContain('transpose');
    expect(orientationEffect(6)).toBe('rotate 90° clockwise');
    expect(orientationEffect(7)).toContain('transverse');
    expect(orientationEffect(8)).toBe('rotate 270° clockwise');
    expect(orientationEffect(9)).toBeNull();
  });

  it('does not throw on a truncated or corrupt header', () => {
    expect(readTiffMetadata(new Uint8Array([0x49, 0x49]))).toMatchObject({ width: null, dpi: null });
    expect(readTiffMetadata(tiffBytes().slice(0, 20))).toMatchObject({ width: null, dpi: null });
  });
});

describe('container metadata', () => {
  it('reads a JPEG EXIF APP1, ICC APP2 and SOF dimensions', () => {
    const exif = tiffBytes();
    const app1 = segment(0xe1, new Uint8Array([...asciiBytes('Exif\0\0'), ...exif]));
    const app2 = segment(0xe2, new Uint8Array([...asciiBytes('ICC_PROFILE\0'), 1, 1]));
    const sof = segment(
      0xc0,
      new Uint8Array([8, 0x0b, 0xd0, 0x0f, 0xc0, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    );
    const jpeg = new Uint8Array([0xff, 0xd8, ...app1, ...app2, ...sof, 0xff, 0xd9]);
    const meta: HeaderMetadata = readImageMetadata(jpeg);

    expect(meta.width).toBe(4032);
    expect(meta.height).toBe(3024);
    expect(meta.bitDepth).toBe(8);
    expect(meta.icc).toBe(true);
    expect(meta.orientation?.tag).toBe(6);
  });

  it('falls back to JFIF density when EXIF has no DPI', () => {
    const jfifPayload = new Uint8Array([...asciiBytes('JFIF\0'), 1, 1, 1, 1, 44, 1, 44, 0, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, ...segment(0xe0, jfifPayload), 0xff, 0xd9]);
    expect(readImageMetadata(jpeg).dpi).toBe(300);
  });

  it('reads PNG IHDR bit depth, eXIf orientation and iCCP presence', () => {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, 800, false);
    view.setUint32(4, 600, false);
    ihdr[8] = 8;
    ihdr[9] = 6;

    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...pngChunk('IHDR', ihdr),
      ...pngChunk('eXIf', tiffBytes({ orientation: 3, dpi: 144 })),
      ...pngChunk('iCCP', new Uint8Array([1, 2, 3])),
      ...pngChunk('IEND', new Uint8Array()),
    ]);

    const meta = readImageMetadata(png);
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
    expect(meta.bitDepth).toBe(8);
    expect(meta.dpi).toBe(144);
    expect(meta.icc).toBe(true);
    expect(meta.orientation?.tag).toBe(3);
  });

  it('reads WebP EXIF and ICCP chunks', () => {
    const exif = tiffBytes({ orientation: 2 });
    const chunks = [
      ...asciiBytes('EXIF'),
      exif.length & 0xff,
      (exif.length >> 8) & 0xff,
      (exif.length >> 16) & 0xff,
      (exif.length >> 24) & 0xff,
      ...exif,
      ...(exif.length % 2 === 1 ? [0] : []),
      ...asciiBytes('ICCP'),
      1,
      0,
      0,
      0,
      0,
      0,
    ];
    const webp = new Uint8Array([
      ...asciiBytes('RIFF'),
      chunks.length & 0xff,
      (chunks.length >> 8) & 0xff,
      (chunks.length >> 16) & 0xff,
      (chunks.length >> 24) & 0xff,
      ...asciiBytes('WEBP'),
      ...chunks,
    ]);

    const meta = readImageMetadata(webp);
    expect(meta.icc).toBe(true);
    expect(meta.orientation?.tag).toBe(2);
  });

  it('reads BMP dimensions and bit depth, and leaves unsupported metadata unknown', () => {
    const bmp = new Uint8Array(30);
    const view = new DataView(bmp.buffer);
    bmp[0] = 0x42;
    bmp[1] = 0x4d;
    view.setInt32(18, 12, true);
    view.setInt32(22, -8, true);
    view.setUint16(28, 24, true);

    expect(readImageMetadata(bmp)).toMatchObject({
      width: 12,
      height: 8,
      bitDepth: 24,
      dpi: null,
      icc: null,
      orientation: null,
    });
    expect(readImageMetadata(new Uint8Array([1, 2, 3]))).toMatchObject({
      width: null,
      icc: null,
      orientation: null,
    });
  });
});
