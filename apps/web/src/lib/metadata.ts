import type { Sniffed } from '@ri/image-browser';
import {
  type MetadataRaw,
  type MetadataReport,
  buildMetadataReport,
  readImageMetadata,
} from '@ri/image-core';
import exifr from 'exifr';

/** docs/10-METADATA.md §2: the viewer parses a bounded head, never the whole file. */
export const METADATA_HEADER_BYTES = 256 * 1024;

/**
 * Read-only metadata parse (docs/10-METADATA.md §4). `reviveValues` stays false so EXIF dates keep
 * their original wall-clock text; `translateValues` still turns orientation/flash into words.
 */
export async function parseImageMetadata(
  blob: Blob,
  name: string,
  sniffed: Sniffed,
): Promise<MetadataReport> {
  const head = new Uint8Array(await blob.slice(0, METADATA_HEADER_BYTES).arrayBuffer());
  const header = readImageMetadata(head);
  let raw: MetadataRaw | null = null;

  try {
    const parsed = await exifr.parse(head, {
      tiff: true,
      exif: true,
      gps: true,
      icc: true,
      xmp: true,
      iptc: true,
      translateValues: true,
      reviveValues: false,
      mergeOutput: false,
      sanitize: true,
      multiSegment: false,
    });
    raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as MetadataRaw) : null;
  } catch {
    // The header summary below is still useful for formats exifr cannot parse (for example a HEIC
    // without its decoder); a read failure must not hide the dimensions and orientation.
    raw = null;
  }

  return buildMetadataReport({
    name,
    bytes: blob.size,
    format: sniffed.format,
    mime: sniffed.mime,
    width: sniffed.width,
    height: sniffed.height,
    raw,
    header,
    animated: sniffed.animated,
  });
}
