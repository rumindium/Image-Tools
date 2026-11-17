import { describe, expect, test } from 'bun:test';
import { buildZip, crc32, zipStore } from './zip-writer.ts';

const encoder = new TextEncoder();

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function text(blob: Blob): Promise<string> {
  return blob.text();
}

describe('crc32', () => {
  test('matches the reference value for "123456789"', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('zipStore', () => {
  test('writes local headers, central directory and the end record', () => {
    const zip = zipStore([
      { name: 'a.png', bytes: encoder.encode('hello') },
      { name: 'b.png', bytes: encoder.encode('world!') },
    ]);

    expect(u32(zip, 0)).toBe(0x04034b50);
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe('a.png');

    const end = zip.length - 22;
    expect(u32(zip, end)).toBe(0x06054b50);
    expect(new DataView(zip.buffer, end, 22).getUint16(8, true)).toBe(2);
  });

  test('writes the CRC of the stored bytes into the archive', () => {
    const bytes = encoder.encode('check me');
    const zip = zipStore([{ name: 'x.txt', bytes }]);
    expect(u32(zip, 14)).toBe(crc32(bytes));
    expect(u32(zip, 18)).toBe(bytes.length);
  });
});

describe('buildZip', () => {
  test('dedupes colliding names so the archive has unique entries', async () => {
    const zip = await buildZip([
      { name: 'photo.webp', blob: new Blob([encoder.encode('one')]) },
      { name: 'photo.webp', blob: new Blob([encoder.encode('two')]) },
    ]);

    const textEntries = new TextDecoder().decode(new Uint8Array(await zip.arrayBuffer()));
    expect(textEntries).toContain('photo.webp');
    expect(textEntries).toContain('photo (2).webp');
  });

  test('a single entry round-trips its bytes', async () => {
    const blob = new Blob([encoder.encode('payload')]);
    const zip = await buildZip([{ name: 'only.txt', blob }]);
    expect(await text(zip)).toContain('payload');
  });
});
