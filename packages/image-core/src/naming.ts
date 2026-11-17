/**
 * Output naming (docs/13-EXPORT-MANAGER.md §3). The extension always comes from the actual encoded
 * type, and the allowlisted character set makes traversal and hidden files impossible by construction.
 */

const ALLOWED = /[^\w .()-]/gu;

export function stripExtension(name: string): string {
  const trimmed = name.trim();
  const lastDot = trimmed.lastIndexOf('.');
  return lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
}

function cleanStem(value: string): string {
  const cleaned = value
    .replace(ALLOWED, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return (cleaned || 'image').slice(0, 100).trim() || 'image';
}

export function sanitizeBase(name: string): string {
  return cleanStem(stripExtension(name));
}

export type NamingMode = 'keep' | 'suffix' | 'template';

export type Naming = {
  mode: NamingMode;
  suffix?: string;
  template?: string;
  startIndex?: number;
};

export type NameContext = {
  sourceName: string;
  format: string;
  width: number;
  height: number;
  index: number;
};

export function applyTemplate(template: string, ctx: NameContext): string {
  return template
    .replace(/\{name\}/g, sanitizeBase(ctx.sourceName))
    .replace(/\{width\}/g, String(ctx.width))
    .replace(/\{height\}/g, String(ctx.height))
    .replace(/\{format\}/g, ctx.format)
    .replace(/\{index\}/g, String(ctx.index));
}

/** Builds one output name. `format` is the actual encoder output, never the requested one. */
export function outputName(naming: Naming, ctx: NameContext): string {
  const base = sanitizeBase(ctx.sourceName);
  const suffix = (naming.suffix ?? '').replace(ALLOWED, '');

  let stem: string;
  if (naming.mode === 'template' && naming.template) {
    // The rendered template is a stem: a dot in "../" must not be mistaken for an extension.
    stem = cleanStem(applyTemplate(naming.template, { ...ctx, sourceName: base }));
  } else if (naming.mode === 'suffix' && suffix.length > 0) {
    stem = `${base}${suffix}`;
  } else {
    stem = base;
  }

  return `${(stem || 'image').slice(0, 100)}.${ctx.format}`;
}

/**
 * Resolves collisions inside one archive: photo.webp, photo (2).webp, photo (3).webp.
 * Case-insensitive so an archive cannot contain two entries a platform will merge.
 */
export function dedupeNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      result.push(name);
      continue;
    }

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';

    let candidate = '';
    for (let n = 2; ; n += 1) {
      candidate = `${stem} (${n})${ext}`;
      if (!used.has(candidate.toLowerCase())) break;
    }

    used.add(candidate.toLowerCase());
    result.push(candidate);
  }

  return result;
}

function hasControlCharacter(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Names you cannot produce: no separators, no leading dot, no control characters. */
export function isSafeName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 124 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.startsWith('.') &&
    !hasControlCharacter(name)
  );
}
