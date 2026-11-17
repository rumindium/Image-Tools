import { describe, expect, test } from 'bun:test';
import { applyTemplate, dedupeNames, isSafeName, outputName, sanitizeBase } from './naming.ts';

describe('sanitizeBase', () => {
  test('strips the extension and disallowed characters', () => {
    expect(sanitizeBase('holiday photo.jpg')).toBe('holiday photo');
    expect(sanitizeBase('../../etc/passwd.png')).toBe('etcpasswd');
    expect(sanitizeBase('a:b*c?.webp')).toBe('abc');
  });

  test('never returns an empty stem', () => {
    expect(sanitizeBase('.hidden')).toBe('hidden');
    expect(sanitizeBase('...')).toBe('image');
    expect(sanitizeBase('   ')).toBe('image');
  });
});

describe('outputName', () => {
  const ctx = { sourceName: 'holiday photo.jpg', format: 'webp', width: 1080, height: 810, index: 1 };

  test('suffix mode', () => {
    expect(outputName({ mode: 'suffix', suffix: '-web' }, ctx)).toBe('holiday photo-web.webp');
  });

  test('keep mode', () => {
    expect(outputName({ mode: 'keep' }, ctx)).toBe('holiday photo.webp');
  });

  test('template mode', () => {
    expect(outputName({ mode: 'template', template: '{name}-{width}x{height}' }, ctx)).toBe(
      'holiday photo-1080x810.webp',
    );
  });

  test('the extension is the actual encoded format', () => {
    expect(outputName({ mode: 'keep' }, { ...ctx, format: 'jpeg' })).toBe('holiday photo.jpeg');
  });

  test('a traversal in the template cannot escape and keeps the base name', () => {
    const name = outputName({ mode: 'template', template: '../../{name}' }, ctx);
    expect(name).toBe('holiday photo.webp');
    expect(isSafeName(name)).toBe(true);
    expect(name.includes('/')).toBe(false);
  });
});

describe('applyTemplate', () => {
  test('replaces every known token once', () => {
    expect(
      applyTemplate('{name}_{index}_{format}_{width}x{height}', {
        sourceName: 'shot.png',
        format: 'webp',
        width: 10,
        height: 20,
        index: 3,
      }),
    ).toBe('shot_3_webp_10x20');
  });
});

describe('dedupeNames', () => {
  test('resolves collisions with a numeric suffix', () => {
    expect(dedupeNames(['photo.webp', 'photo.webp', 'photo.webp'])).toEqual([
      'photo.webp',
      'photo (2).webp',
      'photo (3).webp',
    ]);
  });

  test('is case-insensitive', () => {
    expect(dedupeNames(['Photo.webp', 'photo.webp'])).toEqual(['Photo.webp', 'photo (2).webp']);
  });

  test('leaves distinct names alone', () => {
    expect(dedupeNames(['a.webp', 'b.webp'])).toEqual(['a.webp', 'b.webp']);
  });
});
