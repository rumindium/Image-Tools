#!/usr/bin/env bun
/**
 * Deterministic fixtures — docs/0-TESTING.md §3. Synthetic images are generated (not committed) so a
 * pixel assertion is stable across machines; photos are committed separately, with provenance.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeAnalyzeBatch,
  makeAnalyzeManifest,
  makeExifJpeg,
  makeMetadataJpeg,
  makePng,
  pngChunk,
} from './fixtures.ts';

const root = new URL('../../', import.meta.url).pathname;
const outDir = join(root, 'e2e/fixtures/generated');

const PALETTE: ReadonlyArray<[number, number, number]> = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
  [0, 0, 0],
  [128, 128, 128],
  [194, 69, 45],
];

await mkdir(outDir, { recursive: true });

const grid = makePng(800, 600, (x, y) => {
  const index = (Math.floor(y / 100) * 8 + Math.floor(x / 100)) % PALETTE.length;
  const colour = PALETTE[index] as [number, number, number];
  return [colour[0], colour[1], colour[2], 255];
});
await writeFile(join(outDir, 'grid-800x600.png'), grid);

const alpha = makePng(600, 400, (x) => (x < 360 ? [194, 69, 45, 255] : [194, 69, 45, 0]));
await writeFile(join(outDir, 'alpha-600x400.png'), alpha);

const marker = makePng(1200, 900, (x, y) => {
  if (x < 100 && y < 100) return [255, 0, 0, 255];
  if (x >= 1100 && y < 100) return [0, 255, 0, 255];
  if (x < 100 && y >= 800) return [0, 0, 255, 255];
  return [240, 240, 240, 255];
});
await writeFile(join(outDir, 'marker-1200x900.png'), marker);

// Header only: the dimensions are real, the pixel data is not. Used to prove the sniffer refuses a
// 144 MP file before anything is allocated (docs/0-SECURITY.md §4.1).
const hugeHeader = (() => {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 12_000, false);
  view.setUint32(4, 12_000, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', ihdr),
    ...pngChunk('IEND', new Uint8Array()),
  ]);
})();
await writeFile(join(outDir, 'huge-header.png'), hugeHeader);

// Analyze fixtures: one real JPEG with EXIF orientation 6, 300 DPI and an ICC APP2 profile.
await writeFile(join(outDir, 'exif-rotated-6.jpg'), makeExifJpeg());
await writeFile(join(outDir, 'metadata-exif.jpg'), makeMetadataJpeg());

// 50 files for the Analyze table: a deterministic mix of RGBA, grayscale and opaque RGB PNGs.
const batch = makeAnalyzeBatch();
const batchDir = join(outDir, 'analyze-batch');
await mkdir(batchDir, { recursive: true });
for (const fixture of batch) {
  await writeFile(join(batchDir, fixture.name), fixture.bytes);
}
await writeFile(join(batchDir, 'manifest.json'), `${JSON.stringify(makeAnalyzeManifest(batch), null, 2)}\n`);

// A non-image and a truncated JPEG, for the rejection paths.
await writeFile(
  join(outDir, 'not-an-image.pdf'),
  new TextEncoder().encode('%PDF-1.7\n% fixture, not an image\n'),
);
await writeFile(
  join(outDir, 'corrupt-truncated.jpg'),
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
);

console.log(
  '✓ fixtures written to e2e/fixtures/generated (4 png, 2 exif jpeg, 50 analyze batch png, 1 truncated jpeg, 1 pdf)',
);
