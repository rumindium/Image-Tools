/** Formatting and parsing helpers shared by the UI, the API and the tests. */

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/**
 * Decimal units, because the product quotes file sizes the way platforms and file managers do
 * (4 821 331 B → "4.8 MB"), and the API's limits are decimal too (docs/0-API.md §1).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

export function formatDimensions(width: number, height: number): string {
  const group = new Intl.NumberFormat('en-US').format;
  return `${group(width)} × ${group(height)}`;
}

/** "12.2 MP" — one decimal below 100, none above. */
export function formatMegapixels(pixels: number): string {
  const mp = pixels / 1_000_000;
  return `${mp < 100 ? mp.toFixed(1) : Math.round(mp)} MP`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parses an integer from a form field, returning null rather than NaN. */
export function safeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** A byte ceiling expressed in whole megabytes, for messages like "the limit is 25 MB". */
export function toMegabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}
