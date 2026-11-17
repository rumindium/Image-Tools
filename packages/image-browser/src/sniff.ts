/**
 * File sniffing — docs/0-PROCESSING-PIPELINE.md §2. Extensions are a hint; the bytes decide.
 * Dimensions come from the header so a 12 000 × 12 000 PNG is refused before it is allocated.
 */

export type SniffedFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'avif'
  | 'heic'
  | 'bmp'
  | 'tiff'
  | 'svg'
  | 'unknown';

export type Sniffed = {
  format: SniffedFormat;
  mime: string;
  width: number | null;
  height: number | null;
  animated: boolean;
  bytes: number;
};

const MIME: Record<SniffedFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  unknown: 'application/octet-stream',
};

const u16be = (v: DataView, offset: number): number => v.getUint16(offset, false);
const u32be = (v: DataView, offset: number): number => v.getUint32(offset, false);
const u16le = (v: DataView, offset: number): number => v.getUint16(offset, true);
const u32le = (v: DataView, offset: number): number => v.getUint32(offset, true);

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/** JPEG dimensions: walk the segment list to the first Start-Of-Frame marker. */
function jpegSize(view: DataView): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = u16be(view, offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: u16be(view, offset + 5), width: u16be(view, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

export function sniffBytes(bytes: Uint8Array): Sniffed {
  const none = { width: null, height: null, animated: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = (format: SniffedFormat, extra: Partial<Sniffed> = {}): Sniffed => ({
    format,
    mime: MIME[format],
    ...none,
    bytes: bytes.byteLength,
    ...extra,
  });

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return result('jpeg', jpegSize(view) ?? {});
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const width = bytes.byteLength >= 24 ? u32be(view, 16) : null;
    const height = bytes.byteLength >= 24 ? u32be(view, 20) : null;
    return result('png', { width, height });
  }

  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    const width = bytes.byteLength >= 10 ? u16le(view, 6) : null;
    const height = bytes.byteLength >= 10 ? u16le(view, 8) : null;
    // 0x21 0xF9 0x04 ... 0x00 with a repeat count > 0, or more than one image descriptor.
    const animated = countOccurrences(bytes, [0x21, 0xf9]) > 1;
    return result('gif', { width, height, animated });
  }

  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X' && bytes.byteLength >= 30) {
      const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
      const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
      return result('webp', { width, height, animated: ((bytes[20] ?? 0) & 0x02) !== 0 });
    }
    if (chunk === 'VP8 ' && bytes.byteLength >= 30) {
      return result('webp', {
        width: u16le(view, 26) & 0x3fff,
        height: u16le(view, 28) & 0x3fff,
      });
    }
    return result('webp');
  }

  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand.startsWith('avi')) return result('avif');
    if (brand.startsWith('hei') || brand.startsWith('mif')) return result('heic');
    return result('avif');
  }

  if (startsWith(bytes, [0x42, 0x4d]) && bytes.byteLength >= 26) {
    return result('bmp', { width: u32le(view, 18), height: Math.abs(view.getInt32(22, true)) });
  }

  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return result('tiff');
  }

  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 1024));
  if (head.includes('<svg')) {
    return result('svg');
  }

  return result('unknown');
}

function countOccurrences(bytes: Uint8Array, needle: readonly number[]): number {
  let count = 0;
  outer: for (let i = 0; i + needle.length <= bytes.byteLength; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    count += 1;
  }
  return count;
}

/** Reads at most 64 KiB: enough for every header we parse, cheap for a 100 MB file. */
export async function sniffBlob(blob: Blob): Promise<Sniffed> {
  const head = await blob.slice(0, 65_536).arrayBuffer();
  return sniffBytes(new Uint8Array(head));
}

export function isSupportedFormat(format: SniffedFormat): boolean {
  return format !== 'unknown';
}

/** A user-facing sentence naming what was actually detected. */
export function describeRejection(sniffed: Sniffed): string {
  if (sniffed.format !== 'unknown')
    return `That file is not an image we can read (detected: ${sniffed.format}).`;
  return 'That file is not an image we can read.';
}
