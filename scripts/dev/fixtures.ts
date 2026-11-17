/**
 * Deterministic fixture builders (docs/0-TESTING.md §3). Kept separate from the writer so a Bun test
 * can validate the bytes in memory, and `bun run fixtures` can write the same bytes to disk.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A PNG chunk with its length and CRC, so the fixture is valid as well as parseable. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const body = concatBytes([typeBytes, data]);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body), false);
  return out;
}

export type Pixel = (x: number, y: number) => [number, number, number, number];

export function makePng(width: number, height: number, pixel: Pixel): Uint8Array {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return concatBytes([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

/**
 * A tiny valid baseline JPEG generated once from a canvas (40 × 20, red/blue halves). It already
 * carries a valid sRGB ICC APP2 profile, which gives the fixture a real ICC-presence case.
 */
const BASE_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAUACgDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAQF/8QAFxABAAMAAAAAAAAAAAAAAAAAAARCgf/EABYBAQEBAAAAAAAAAAAAAAAAAAcICf/EABsRAAEFAQEAAAAAAAAAAAAAAAACBAc2s4KD/9oADAMBAAIRAxEAPwCQAFFik8ump1Eump1qR3WGneiyA5Rt73zyQACMFZoAM5TVAnl01OC1I7rDTvRZAco29755IABGCs//2Q==';

const BASE_JPEG = new Uint8Array(Buffer.from(BASE_JPEG_BASE64, 'base64'));

function exifTiff(orientation: number, dpi: number): Uint8Array {
  const entries = 4;
  const dataStart = 8 + 2 + entries * 12 + 4;
  const bytes = new Uint8Array(dataStart + 16);
  const view = new DataView(bytes.buffer);

  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entries, true);

  const entry = (index: number, tag: number, type: number, count: number, value: number, inline: boolean) => {
    const offset = 10 + index * 12;
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (inline && type === 3) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
  };

  entry(0, 0x0112, 3, 1, orientation, true);
  entry(1, 0x011a, 5, 1, dataStart, false);
  entry(2, 0x011b, 5, 1, dataStart + 8, false);
  entry(3, 0x0128, 3, 1, 2, true);
  view.setUint32(dataStart, dpi, true);
  view.setUint32(dataStart + 4, 1, true);
  view.setUint32(dataStart + 8, dpi, true);
  view.setUint32(dataStart + 12, 1, true);
  return bytes;
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 4);
  const length = payload.length + 2;
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (length >> 8) & 0xff;
  out[3] = length & 0xff;
  out.set(payload, 4);
  return out;
}

/** 40 × 20 side-by-side JPEG with EXIF orientation 6, 300 DPI and the base file's ICC profile. */
export function makeExifJpeg(): Uint8Array {
  const app1 = jpegSegment(0xe1, concatBytes([ascii('Exif\0\0'), exifTiff(6, 300)]));
  return concatBytes([BASE_JPEG.subarray(0, 2), app1, BASE_JPEG.subarray(2)]);
}

type IfdEntry = { tag: number; type: number; count: number; data: Uint8Array };

const IFD_SIZE = (entries: number): number => 2 + entries * 12 + 4;

function textEntry(tag: number, text: string): IfdEntry {
  const data = concatBytes([ascii(text), new Uint8Array([0])]);
  return { tag, type: 2, count: data.length, data };
}

function byteEntry(tag: number, value: number): IfdEntry {
  return { tag, type: 1, count: 1, data: new Uint8Array([value]) };
}

function shortEntry(tag: number, ...values: number[]): IfdEntry {
  const data = new Uint8Array(values.length * 2);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return { tag, type: 3, count: values.length, data };
}

function longEntry(tag: number, ...values: number[]): IfdEntry {
  const data = new Uint8Array(values.length * 4);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return { tag, type: 4, count: values.length, data };
}

function rationalEntry(tag: number, ...pairs: Array<[number, number]>): IfdEntry {
  const data = new Uint8Array(pairs.length * 8);
  const view = new DataView(data.buffer);
  pairs.forEach(([numerator, denominator], index) => {
    view.setUint32(index * 8, numerator, true);
    view.setUint32(index * 8 + 4, denominator, true);
  });
  return { tag, type: 5, count: pairs.length, data };
}

function richTiff(): Uint8Array {
  const image = [
    textEntry(0x010e, 'A test image for metadata'),
    textEntry(0x010f, 'Canon'),
    textEntry(0x0110, 'EOS R5'),
    shortEntry(0x0112, 6),
    rationalEntry(0x011a, [300, 1]),
    rationalEntry(0x011b, [300, 1]),
    shortEntry(0x0128, 2),
    textEntry(0x0131, 'Rumindium Image 0.1'),
    textEntry(0x0132, '2026:11:17 10:30:00'),
    textEntry(0x013b, 'Rumindium'),
    longEntry(0x0100, 40),
    longEntry(0x0101, 20),
    textEntry(0x8298, '© 2026 Rumindium'),
  ];
  const exif = [
    rationalEntry(0x829a, [1, 250]),
    rationalEntry(0x829d, [28, 10]),
    shortEntry(0x8827, 100),
    textEntry(0x9003, '2026:11:17 10:30:00'),
    textEntry(0x9011, '+07:00'),
    shortEntry(0x9209, 16),
    rationalEntry(0x920a, [50, 1]),
    shortEntry(0xa001, 1),
    longEntry(0xa002, 40),
    longEntry(0xa003, 20),
    textEntry(0xa433, 'Canon'),
    textEntry(0xa434, 'RF 24-70mm F2.8 L IS USM'),
  ];
  const gps = [
    textEntry(0x0001, 'S'),
    rationalEntry(0x0002, [6, 1], [12, 1], [30, 1]),
    textEntry(0x0003, 'E'),
    rationalEntry(0x0004, [106, 1], [49, 1], [0, 1]),
    byteEntry(0x0005, 0),
    rationalEntry(0x0006, [8, 1]),
    rationalEntry(0x0007, [3, 1], [15, 1], [0, 1]),
    textEntry(0x001d, '2026:11:17'),
    textEntry(0x0010, 'T'),
    rationalEntry(0x0011, [45, 1]),
  ];

  const exifOffset = 8 + IFD_SIZE(image.length + 2);
  const gpsOffset = exifOffset + IFD_SIZE(exif.length);
  image.push(longEntry(0x8769, exifOffset), longEntry(0x8825, gpsOffset));

  const dataStart = gpsOffset + IFD_SIZE(gps.length);
  const all = [...image, ...exif, ...gps];
  const dataOffsets = new Map<IfdEntry, number>();
  let cursor = dataStart;
  for (const entry of all) {
    if (entry.data.length > 4) {
      dataOffsets.set(entry, cursor);
      cursor += entry.data.length;
      if (cursor % 2 === 1) cursor += 1;
    }
  }

  const bytes = new Uint8Array(cursor);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  const writeIfd = (offset: number, entries: IfdEntry[]): void => {
    view.setUint16(offset, entries.length, true);
    entries.forEach((entry, index) => {
      const entryOffset = offset + 2 + index * 12;
      view.setUint16(entryOffset, entry.tag, true);
      view.setUint16(entryOffset + 2, entry.type, true);
      view.setUint32(entryOffset + 4, entry.count, true);
      if (entry.data.length <= 4) {
        bytes.set(entry.data, entryOffset + 8);
      } else {
        view.setUint32(entryOffset + 8, dataOffsets.get(entry) ?? 0, true);
      }
    });
  };

  writeIfd(8, image);
  writeIfd(exifOffset, exif);
  writeIfd(gpsOffset, gps);
  for (const entry of all) {
    const offset = dataOffsets.get(entry);
    if (offset !== undefined) bytes.set(entry.data, offset);
  }
  return bytes;
}

const METADATA_XMP = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Rumindium">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
   <dc:creator><rdf:Seq><rdf:li>Rumindium</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2026 Rumindium</rdf:li></rdf:Alt></dc:rights>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Sunset over Jakarta</rdf:li></rdf:Alt></dc:description>
   <dc:subject><rdf:Bag><rdf:li>Jakarta</rdf:li><rdf:li>sunset</rdf:li></rdf:Bag></dc:subject>
   <xmp:CreatorTool>Rumindium Image</xmp:CreatorTool>
   <photoshop:City>Jakarta</photoshop:City>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** Camera, capture, GPS, DPI, ICC, XMP and orientation tags for the metadata viewer. */
export function makeMetadataJpeg(): Uint8Array {
  const app1 = jpegSegment(0xe1, concatBytes([ascii('Exif\0\0'), richTiff()]));
  const xmp = jpegSegment(0xe1, concatBytes([ascii('http://ns.adobe.com/xap/1.0/\0'), ascii(METADATA_XMP)]));
  return concatBytes([BASE_JPEG.subarray(0, 2), app1, xmp, BASE_JPEG.subarray(2)]);
}

export type AnalyzeFixture = {
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  colorMode: 'RGB' | 'RGBA' | 'grayscale';
  alpha: boolean;
};

const BATCH_COLOURS: ReadonlyArray<[number, number, number]> = [
  [194, 69, 45],
  [46, 134, 228],
  [233, 168, 44],
  [53, 158, 123],
  [124, 58, 237],
  [219, 39, 119],
];

/** 50 deterministic PNGs: one third RGBA, one third grayscale, one third opaque RGB. */
export function makeAnalyzeBatch(): AnalyzeFixture[] {
  return Array.from({ length: 50 }, (_, index) => {
    const variant = index % 3;
    const width = 32 + (index % 5) * 8;
    const height = 24 + (index % 4) * 6;
    const [r, g, b] = BATCH_COLOURS[index % BATCH_COLOURS.length] as [number, number, number];
    const bytes = makePng(width, height, (x) => {
      if (variant === 1) return [128, 128, 128, 255];
      if (variant === 0 && x >= Math.floor(width / 2)) return [r, g, b, 0];
      return [r, g, b, 255];
    });

    return {
      name: `batch-${String(index + 1).padStart(2, '0')}.png`,
      bytes,
      width,
      height,
      colorMode: variant === 0 ? 'RGBA' : variant === 1 ? 'grayscale' : 'RGB',
      alpha: variant === 0,
    };
  });
}

export function makeAnalyzeManifest(batch = makeAnalyzeBatch()) {
  return {
    sampledAt: 512,
    format: 'png',
    files: batch.map(({ name, width, height, colorMode, alpha }) => ({
      name,
      width,
      height,
      colorMode,
      alpha,
    })),
  } as const;
}
