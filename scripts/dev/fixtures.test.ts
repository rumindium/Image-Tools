import { describe, expect, it } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { sniffBytes } from '../../packages/image-browser/src/sniff.ts';
import { readImageMetadata } from '../../packages/image-core/src/metadata.ts';
import { makeAnalyzeBatch, makeAnalyzeManifest, makeExifJpeg, makeMetadataJpeg } from './fixtures.ts';

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) << 24) +
    ((bytes[offset + 1] as number) << 16) +
    ((bytes[offset + 2] as number) << 8) +
    (bytes[offset + 3] as number)
  );
}

/** Decodes our filter-0 RGBA PNGs so the manifest is checked against pixels, not just itself. */
function pngPixels(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const length = u32be(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error(`truncated ${type} chunk`);

    if (type === 'IHDR') {
      width = u32be(bytes, start);
      height = u32be(bytes, start + 4);
    } else if (type === 'IDAT') {
      idat.push(bytes.slice(start, end));
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }

  if (!width || !height || idat.length === 0) throw new Error('PNG has no pixels');
  const raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  const stride = width * 4 + 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * stride] !== 0) throw new Error('fixture unexpectedly uses a PNG filter');
    data.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4);
  }
  return { width, height, data };
}

describe('Analyze fixtures', () => {
  it('builds a real JPEG with EXIF orientation 6, 300 DPI and an ICC profile', () => {
    const bytes = makeExifJpeg();
    const sniffed = sniffBytes(bytes);
    expect(sniffed).toMatchObject({ format: 'jpeg', width: 40, height: 20, animated: false });

    const metadata = readImageMetadata(bytes);
    expect(metadata.orientation).toEqual({ tag: 6, effect: 'rotate 90° clockwise' });
    expect(metadata.dpi).toBe(300);
    expect(metadata.icc).toBe(true);
    expect(metadata.bitDepth).toBe(8);
  });

  it('builds a camera/GPS/XMP JPEG for the metadata viewer', () => {
    const bytes = makeMetadataJpeg();
    const sniffed = sniffBytes(bytes);
    expect(sniffed).toMatchObject({ format: 'jpeg', width: 40, height: 20, animated: false });

    const metadata = readImageMetadata(bytes);
    expect(metadata.orientation).toEqual({ tag: 6, effect: 'rotate 90° clockwise' });
    expect(metadata.dpi).toBe(300);
    expect(metadata.icc).toBe(true);
    expect(metadata.bitDepth).toBe(8);
  });

  it('builds 50 unique files whose dimensions and pixel modes match the manifest', () => {
    const batch = makeAnalyzeBatch();
    expect(batch).toHaveLength(50);
    expect(new Set(batch.map((fixture) => fixture.name)).size).toBe(50);

    const manifest = makeAnalyzeManifest(batch);
    expect(manifest.sampledAt).toBe(512);
    expect(manifest.files).toHaveLength(50);

    for (const [index, fixture] of batch.entries()) {
      const sniffed = sniffBytes(fixture.bytes);
      expect(sniffed).toMatchObject({
        format: 'png',
        width: fixture.width,
        height: fixture.height,
        animated: false,
      });

      const metadata = readImageMetadata(fixture.bytes);
      expect(metadata.bitDepth).toBe(8);
      expect(metadata.dpi).toBeNull();
      expect(metadata.orientation).toBeNull();
      expect(metadata.icc).toBe(false);

      const pixels = pngPixels(fixture.bytes);
      expect([pixels.width, pixels.height]).toEqual([fixture.width, fixture.height]);

      let alpha = false;
      let grayscale = true;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const r = pixels.data[offset] as number;
        const g = pixels.data[offset + 1] as number;
        const b = pixels.data[offset + 2] as number;
        if ((pixels.data[offset + 3] as number) < 255) alpha = true;
        if (r !== g || g !== b) grayscale = false;
      }

      const colorMode = grayscale ? 'grayscale' : alpha ? 'RGBA' : 'RGB';
      expect({ alpha, colorMode }).toEqual({ alpha: fixture.alpha, colorMode: fixture.colorMode });
      expect(manifest.files[index]).toEqual({
        name: fixture.name,
        width: fixture.width,
        height: fixture.height,
        colorMode: fixture.colorMode,
        alpha: fixture.alpha,
      });
    }
  });

  it('serializes the batch manifest as stable JSON', () => {
    const manifest = makeAnalyzeManifest();
    const parsed = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    expect(parsed.files[0]?.name).toBe('batch-01.png');
    expect(parsed.files.at(-1)?.name).toBe('batch-50.png');
    expect(parsed.files).toHaveLength(50);
  });
});
