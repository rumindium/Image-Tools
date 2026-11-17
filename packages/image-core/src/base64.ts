/**
 * Base64 and data-URI rules (docs/08-UTILITIES.md §2). Pure, so validation order, limits and
 * wrapping are testable without a browser: a 40 MB string must fail on the character, not after
 * allocating the decoded bytes.
 */

export const BASE64_TEXT_LIMIT = 40_000_000;
export const BASE64_DECODED_LIMIT = 30_000_000;

export type Base64ErrorCode = 'EMPTY_INPUT' | 'INVALID_BASE64' | 'TEXT_TOO_LARGE' | 'DECODED_TOO_LARGE';

export type Base64DecodeResult =
  | {
      ok: true;
      bytes: Uint8Array<ArrayBuffer>;
      declaredMime: string | null;
      urlSafe: boolean;
    }
  | {
      ok: false;
      code: Base64ErrorCode;
      message: string;
      position?: number;
    };

const fail = (code: Base64ErrorCode, message: string, position?: number): Base64DecodeResult => ({
  ok: false,
  code,
  message,
  ...(position === undefined ? {} : { position }),
});

/** Wraps text at `width` characters and ends with a newline, as MIME encoders do. Width 0 is off. */
export function wrapBase64(text: string, width: number): string {
  if (width <= 0 || text.length === 0) return text;
  const lines: string[] = [];
  for (let offset = 0; offset < text.length; offset += width) {
    lines.push(text.slice(offset, offset + width));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Chunked bytes → base64. The naive `String.fromCharCode(...bytes)` throws at ~100 KB, and a single
 * `btoa` over a 40 MB string doubles the peak allocation; each chunk is a multiple of three bytes so
 * the padded result concatenates correctly.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkBytes = 3 * 8192;
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const chunk = bytes.subarray(offset, offset + chunkBytes);
    let binary = '';
    for (let index = 0; index < chunk.length; index += 4096) {
      binary += String.fromCharCode(...chunk.subarray(index, index + 4096));
    }
    encoded += btoa(binary);
  }
  return encoded;
}

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}

/**
 * Accepts a bare string or a base64 data URI. Whitespace and a URL-safe alphabet are accepted and
 * reported. The declared MIME is not trusted; the caller sniffs the bytes and compares.
 */
export function decodeBase64(
  input: string,
  limits: { text?: number; decoded?: number } = {},
): Base64DecodeResult {
  const textLimit = limits.text ?? BASE64_TEXT_LIMIT;
  const decodedLimit = limits.decoded ?? BASE64_DECODED_LIMIT;

  if (input.trim().length === 0) {
    return fail('EMPTY_INPUT', 'Paste a base64 string or a data URI.');
  }
  if (input.length > textLimit) {
    return fail(
      'TEXT_TOO_LARGE',
      `That text is ${Math.ceil(input.length / 1_000_000)} MB; the limit is ${Math.round(textLimit / 1_000_000)} MB.`,
    );
  }

  let declaredMime: string | null = null;
  let payload = input;
  const trimmed = input.trim();
  if (/^data:/i.test(trimmed)) {
    const comma = trimmed.indexOf(',');
    if (comma < 0) return fail('INVALID_BASE64', 'That data URI has no comma.');
    const header = trimmed.slice(5, comma);
    const parts = header.split(';');
    if (!parts.some((part) => part.toLowerCase() === 'base64')) {
      return fail('INVALID_BASE64', 'Only base64 data URIs are supported.');
    }
    declaredMime = parts[0]?.trim() || null;
    payload = trimmed.slice(comma + 1);
  }

  let padding = 0;
  let dataLength = 0;
  let urlSafe = false;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index] as string;
    if (isWhitespace(character)) continue;
    if (character === '=') {
      padding += 1;
      if (padding > 2) return fail('INVALID_BASE64', 'Too much padding.', index + 1);
      continue;
    }
    if (padding > 0) {
      return fail('INVALID_BASE64', 'Padding must be at the end.', index + 1);
    }
    if (character === '-' || character === '_') urlSafe = true;
    if (!/[A-Za-z0-9+/_-]/.test(character)) {
      return fail('INVALID_BASE64', `Invalid base64 at character ${index + 1}.`, index + 1);
    }
    dataLength += 1;
  }

  if (dataLength === 0) return fail('INVALID_BASE64', 'The base64 payload is empty.');
  if (dataLength % 4 === 1) return fail('INVALID_BASE64', 'Base64 length leaves a dangling character.');
  const expectedPadding = (4 - (dataLength % 4)) % 4;
  if (padding > 0 && padding !== expectedPadding) {
    return fail('INVALID_BASE64', 'The base64 padding does not match the payload.');
  }

  const estimated = Math.floor(((dataLength + padding) * 3) / 4) - padding;
  if (estimated > decodedLimit) {
    return fail(
      'DECODED_TOO_LARGE',
      `That decodes to about ${Math.ceil(estimated / 1_000_000)} MB; the limit is ${Math.round(decodedLimit / 1_000_000)} MB.`,
    );
  }

  const compact = payload.replace(/\s+/g, '').replaceAll('-', '+').replaceAll('_', '/').replaceAll('=', '');
  const normalized = compact + '='.repeat((4 - (compact.length % 4)) % 4);

  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    return fail('INVALID_BASE64', 'That is not valid base64.');
  }

  if (binary.length > decodedLimit) {
    return fail(
      'DECODED_TOO_LARGE',
      `That decodes to ${Math.ceil(binary.length / 1_000_000)} MB; the limit is ${Math.round(decodedLimit / 1_000_000)} MB.`,
    );
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return { ok: true, bytes, declaredMime, urlSafe };
}
