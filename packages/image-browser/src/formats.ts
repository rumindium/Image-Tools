/** The output formats the canvas pipeline can actually write (docs/0-PROCESSING-PIPELINE.md §5). */

export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif';

export const MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

export const EXTENSION: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

/** Formats that keep transparency; the rest are flattened onto a background before encode. */
export const HAS_ALPHA: Record<OutputFormat, boolean> = {
  jpeg: false,
  png: true,
  webp: true,
  avif: true,
};

export function formatFromMime(mime: string): OutputFormat | null {
  const normalized = mime.split(';')[0]?.trim().toLowerCase();
  for (const format of Object.keys(MIME) as OutputFormat[]) {
    if (MIME[format] === normalized) return format;
  }
  return null;
}

/** The extension always comes from the bytes the encoder produced, never from the request. */
export function extensionForMime(mime: string): string {
  const format = formatFromMime(mime);
  return format ? EXTENSION[format] : 'bin';
}

/** A source format the encoder matrix can re-encode; anything else becomes PNG. */
export function outputFormatForSource(source: string): OutputFormat {
  return source === 'jpeg' || source === 'png' || source === 'webp' || source === 'avif' ? source : 'png';
}
