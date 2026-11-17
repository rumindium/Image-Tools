/**
 * Header metadata for the analyzer (docs/08-UTILITIES.md §3). This is deliberately a small parser:
 * orientation, DPI, ICC presence and bit depth are the only fields Analyze needs. It reads the
 * container and IFD without trusting a filename, and returns null where a format cannot say.
 */

export type OrientationInfo = { tag: number; effect: string };

export type HeaderMetadata = {
  width: number | null;
  height: number | null;
  bitDepth: number | null;
  /** Dots per inch when a unit is present; null is "not available", never a guessed 72. */
  dpi: number | null;
  /** true = present, false = scanned and absent, null = this format cannot tell. */
  icc: boolean | null;
  orientation: OrientationInfo | null;
};

const EMPTY: HeaderMetadata = {
  width: null,
  height: null,
  bitDepth: null,
  dpi: null,
  icc: null,
  orientation: null,
};

const empty = (icc: boolean | null = null): HeaderMetadata => ({ ...EMPTY, icc });

/** The EXIF orientation wording used by the report (docs/08-UTILITIES.md §3.2). */
export function orientationEffect(tag: number): string | null {
  switch (tag) {
    case 1:
      return 'upright';
    case 2:
      return 'mirror horizontally';
    case 3:
      return 'rotate 180°';
    case 4:
      return 'mirror vertically';
    case 5:
      return 'transpose (mirror horizontally, rotate 270° clockwise)';
    case 6:
      return 'rotate 90° clockwise';
    case 7:
      return 'transverse (mirror horizontally, rotate 90° clockwise)';
    case 8:
      return 'rotate 270° clockwise';
    default:
      return null;
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return '';
  let result = '';
  for (let index = 0; index < length; index += 1)
    result += String.fromCharCode(bytes[offset + index] as number);
  return result;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function merge(base: HeaderMetadata, extra: HeaderMetadata): HeaderMetadata {
  const icc =
    base.icc === true || extra.icc === true ? true : base.icc === false || extra.icc === false ? false : null;
  return {
    width: base.width ?? extra.width,
    height: base.height ?? extra.height,
    bitDepth: base.bitDepth ?? extra.bitDepth,
    dpi: base.dpi ?? extra.dpi,
    icc,
    orientation: base.orientation ?? extra.orientation,
  };
}

/**
 * TIFF/EXIF IFD0. Values are read with bounds checks because a corrupt tag offset must not throw out
 * of a report. Rational offsets are relative to the TIFF header, as the format specifies.
 */
export function readTiffMetadata(bytes: Uint8Array, base = 0): HeaderMetadata {
  const meta = empty(false);
  if (base + 8 > bytes.length) return meta;
  const little = bytes[base] === 0x49 && bytes[base + 1] === 0x49;
  const big = bytes[base] === 0x4d && bytes[base + 1] === 0x4d;
  if (!little && !big) return meta;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const can = (offset: number, length = 1): boolean => offset >= 0 && offset + length <= bytes.length;
  const u16 = (offset: number): number => view.getUint16(offset, little);
  const u32 = (offset: number): number => view.getUint32(offset, little);

  if (!can(base + 2, 2) || u16(base + 2) !== 42) return meta;
  if (!can(base + 4, 4)) return meta;
  const ifd = base + u32(base + 4);
  if (!can(ifd, 2)) return meta;

  const count = Math.min(u16(ifd), 4096);
  if (!can(ifd + 2, count * 12)) return meta;

  const tagOffset = (tag: number): number | null => {
    for (let index = 0; index < count; index += 1) {
      const entry = ifd + 2 + index * 12;
      if (u16(entry) === tag) return entry;
    }
    return null;
  };

  const readShort = (entry: number): number | null => {
    if (!can(entry + 12)) return null;
    const type = u16(entry + 2);
    const valueCount = u32(entry + 4);
    if (type !== 3 || valueCount < 1) return null;
    if (valueCount === 1) return u16(entry + 8);
    const offset = base + u32(entry + 8);
    return can(offset, 2) ? u16(offset) : null;
  };

  const readLong = (entry: number): number | null => {
    if (!can(entry + 12)) return null;
    const type = u16(entry + 2);
    const valueCount = u32(entry + 4);
    if (valueCount < 1) return null;
    if (type === 4 && valueCount === 1) return u32(entry + 8);
    if (type === 3) return readShort(entry);
    const offset = base + u32(entry + 8);
    if (type === 4 && can(offset, 4)) return u32(offset);
    if (type === 3 && can(offset, 2)) return u16(offset);
    return null;
  };

  const readRational = (entry: number): number | null => {
    if (!can(entry + 12)) return null;
    if (u16(entry + 2) !== 5 || u32(entry + 4) < 1) return null;
    const offset = base + u32(entry + 8);
    if (!can(offset, 8)) return null;
    const numerator = u32(offset);
    const denominator = u32(offset + 4);
    return denominator === 0 ? null : numerator / denominator;
  };

  const widthEntry = tagOffset(0x0100);
  const heightEntry = tagOffset(0x0101);
  const bitsEntry = tagOffset(0x0102);
  const orientationEntry = tagOffset(0x0112);
  const xResolutionEntry = tagOffset(0x011a);
  const yResolutionEntry = tagOffset(0x011b);
  const resolutionUnitEntry = tagOffset(0x0128);
  const iccEntry = tagOffset(0x8773);

  const width = widthEntry === null ? null : readLong(widthEntry);
  const height = heightEntry === null ? null : readLong(heightEntry);
  const bitDepth = bitsEntry === null ? null : readShort(bitsEntry);
  const orientationTag = orientationEntry === null ? null : readShort(orientationEntry);
  const xResolution = xResolutionEntry === null ? null : readRational(xResolutionEntry);
  const yResolution = yResolutionEntry === null ? null : readRational(yResolutionEntry);
  const resolutionUnit = resolutionUnitEntry === null ? null : readShort(resolutionUnitEntry);

  const resolution = (xResolution ?? yResolution) as number | null;
  const unit = resolutionUnit ?? 2;
  const dpi = resolution === null || unit === 1 ? null : unit === 3 ? resolution * 2.54 : resolution;

  return {
    width: width && width > 0 ? width : null,
    height: height && height > 0 ? height : null,
    bitDepth: bitDepth && bitDepth > 0 ? bitDepth : null,
    dpi: dpi === null ? null : Math.round(dpi * 10) / 10,
    icc: iccEntry !== null,
    orientation:
      orientationTag !== null && orientationEffect(orientationTag)
        ? { tag: orientationTag, effect: orientationEffect(orientationTag) as string }
        : null,
  };
}

function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpegMetadata(bytes: Uint8Array): HeaderMetadata {
  let meta = empty(false);
  let jfifDpi: number | null = null;
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset] as number;
    offset += 1;

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > bytes.length) break;

    const length = (bytes[offset] as number) * 256 + (bytes[offset + 1] as number);
    if (length < 2) break;
    const start = offset + 2;
    const end = offset + length;
    if (end > bytes.length) break;

    if (marker === 0xe1 && ascii(bytes, start, 6) === 'Exif\0\0') {
      meta = merge(meta, readTiffMetadata(bytes, start + 6));
    } else if (marker === 0xe2 && ascii(bytes, start, 12) === 'ICC_PROFILE\0') {
      meta = { ...meta, icc: true };
    } else if (marker === 0xe0 && ascii(bytes, start, 5) === 'JFIF\0' && start + 12 <= end) {
      const units = bytes[start + 7] as number;
      const density = (bytes[start + 8] as number) * 256 + (bytes[start + 9] as number);
      if (density > 0 && units === 1) jfifDpi = density;
      else if (density > 0 && units === 2) jfifDpi = Math.round(density * 2.54 * 10) / 10;
    } else if (isSof(marker) && start + 5 <= end) {
      const precision = bytes[start] as number;
      const height = (bytes[start + 1] as number) * 256 + (bytes[start + 2] as number);
      const width = (bytes[start + 3] as number) * 256 + (bytes[start + 4] as number);
      meta = { ...meta, bitDepth: precision || null, width: width || null, height: height || null };
    }

    offset = end;
  }

  if (meta.dpi === null && jfifDpi !== null) meta = { ...meta, dpi: jfifDpi };
  return meta;
}

function readPngMetadata(bytes: Uint8Array): HeaderMetadata {
  let meta = empty(false);
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length =
      (bytes[offset] as number) * 0x1000000 +
      ((bytes[offset + 1] as number) << 16) +
      ((bytes[offset + 2] as number) << 8) +
      (bytes[offset + 3] as number);
    const type = ascii(bytes, offset + 4, 4);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) break;

    if (type === 'IHDR' && length >= 13) {
      const width =
        ((bytes[start] as number) << 24) +
        ((bytes[start + 1] as number) << 16) +
        ((bytes[start + 2] as number) << 8) +
        (bytes[start + 3] as number);
      const height =
        ((bytes[start + 4] as number) << 24) +
        ((bytes[start + 5] as number) << 16) +
        ((bytes[start + 6] as number) << 8) +
        (bytes[start + 7] as number);
      const bitDepth = bytes[start + 8] as number;
      meta = { ...meta, width: width || null, height: height || null, bitDepth: bitDepth || null };
    } else if (type === 'eXIf') {
      meta = merge(meta, readTiffMetadata(bytes, start));
    } else if (type === 'iCCP') {
      meta = { ...meta, icc: true };
    }

    if (type === 'IDAT' || type === 'IEND') break;
    offset = end + 4;
  }

  return meta;
}

function readWebpMetadata(bytes: Uint8Array): HeaderMetadata {
  let meta = empty(false);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size =
      (bytes[offset + 4] as number) |
      ((bytes[offset + 5] as number) << 8) |
      ((bytes[offset + 6] as number) << 16) |
      ((bytes[offset + 7] as number) << 24);
    const start = offset + 8;
    const end = start + (size >>> 0);
    if (size < 0 || end > bytes.length) break;

    if (type === 'EXIF') {
      const tiffStart = ascii(bytes, start, 6) === 'Exif\0\0' ? start + 6 : start;
      meta = merge(meta, readTiffMetadata(bytes, tiffStart));
    } else if (type === 'ICCP') {
      meta = { ...meta, icc: true };
    }

    offset = end + (size & 1);
  }

  return meta;
}

function readBmpMetadata(bytes: Uint8Array): HeaderMetadata {
  if (bytes.length < 30) return empty(null);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(18, true);
  const height = Math.abs(view.getInt32(22, true));
  const bitDepth = view.getUint16(28, true);
  return {
    ...EMPTY,
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
    bitDepth: bitDepth > 0 ? bitDepth : null,
  };
}

/** Reads only the bytes it was given, so callers can pass a bounded head (≤ 256 KB). */
export function readImageMetadata(bytes: Uint8Array): HeaderMetadata {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return readJpegMetadata(bytes);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return readPngMetadata(bytes);
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') {
    return readWebpMetadata(bytes);
  }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return readTiffMetadata(bytes);
  }
  if (startsWith(bytes, [0x42, 0x4d])) return readBmpMetadata(bytes);
  return empty(null);
}
