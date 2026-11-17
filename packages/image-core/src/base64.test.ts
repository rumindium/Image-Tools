import { describe, expect, it } from 'bun:test';
import {
  BASE64_DECODED_LIMIT,
  BASE64_TEXT_LIMIT,
  bytesToBase64,
  decodeBase64,
  wrapBase64,
} from './base64.ts';

const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);

describe('bytesToBase64', () => {
  it('round-trips bytes through decodeBase64', () => {
    const result = decodeBase64(bytesToBase64(bytes));
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
  });

  it('handles a chunk boundary without a call-stack RangeError', () => {
    const large = new Uint8Array(100_000);
    for (let index = 0; index < large.length; index += 1) large[index] = index % 251;
    const encoded = bytesToBase64(large);
    const result = decodeBase64(encoded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.length).toBe(large.length);
      expect(result.bytes[99_999]).toBe(large[99_999]);
    }
  });
});

describe('wrapBase64', () => {
  it('wraps at 76 characters and ends with a newline', () => {
    const wrapped = wrapBase64('a'.repeat(160), 76);
    const lines = wrapped.split('\n');
    expect(lines.at(-1)).toBe('');
    expect(lines.slice(0, -1).every((line) => line.length <= 76)).toBe(true);
    expect(lines.join('')).toHaveLength(160);
  });

  it('does nothing at width 0 or for empty text', () => {
    expect(wrapBase64('abc', 0)).toBe('abc');
    expect(wrapBase64('', 76)).toBe('');
  });
});

describe('decodeBase64', () => {
  it('reads a data URI and keeps the declared MIME', () => {
    const result = decodeBase64(`data:image/png;base64,${bytesToBase64(bytes)}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.declaredMime).toBe('image/png');
      expect(result.urlSafe).toBe(false);
    }
  });

  it('accepts whitespace, missing padding and the URL-safe alphabet', () => {
    const urlSafe = bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const result = decodeBase64(`  ${urlSafe}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
      expect(result.urlSafe).toBe(true);
    }
  });

  it('reports the character position of an invalid symbol', () => {
    const result = decodeBase64('AAAA$AAA');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_BASE64');
      expect(result.position).toBe(5);
      expect(result.message).toContain('character 5');
    }
  });

  it('rejects padding in the middle and a dangling length', () => {
    expect(decodeBase64('AA=A').ok).toBe(false);
    expect(decodeBase64('AAAAA').ok).toBe(false);
  });

  it('rejects an empty payload', () => {
    expect(decodeBase64('   ').ok).toBe(false);
    const empty = decodeBase64('data:image/png;base64,');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('INVALID_BASE64');
  });

  it('checks the text and decoded limits before allocation', () => {
    const textLimited = decodeBase64('A'.repeat(20), { text: 10 });
    expect(textLimited.ok).toBe(false);
    if (!textLimited.ok) expect(textLimited.code).toBe('TEXT_TOO_LARGE');

    const decodedLimited = decodeBase64(bytesToBase64(bytes), { decoded: 4 });
    expect(decodedLimited.ok).toBe(false);
    if (!decodedLimited.ok) expect(decodedLimited.code).toBe('DECODED_TOO_LARGE');
  });

  it('uses the documented default limits', () => {
    expect(BASE64_TEXT_LIMIT).toBe(40_000_000);
    expect(BASE64_DECODED_LIMIT).toBe(30_000_000);
  });
});
