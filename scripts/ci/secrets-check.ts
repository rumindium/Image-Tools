#!/usr/bin/env bun
/**
 * Secrets must not reach a build output or a committed file (docs/0-CONFIG.md §8).
 * Redaction fails open; this check fails closed on patterns that are never legitimate in source.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.next', '.git', '.freebuff', 'docs', 'models', 'dist', 'coverage']);

const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'postgres-url-with-password', pattern: /postgres(?:ql)?:\/\/[^\s"'@]+:[^\s"'@]+@/ },
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'bearer-literal', pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/ },
];

const ALLOWED_FILES = new Set(['.env.example', 'scripts/ci/secrets-check.ts']);

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      await walk(join(dir, entry.name), files);
    } else if (/\.(ts|tsx|js|mjs|json|yml|yaml|md|css)$/.test(entry.name)) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

const findings: string[] = [];
for (const file of await walk(root)) {
  const path = relative(root, file).replaceAll('\\', '/');
  if (ALLOWED_FILES.has(path)) continue;
  const source = await readFile(file, 'utf8');
  for (const { name, pattern } of PATTERNS) {
    if (pattern.test(source)) findings.push(`${path}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error(`✗ secrets check: ${findings.length} suspicious literal(s)`);
  for (const finding of findings) console.error(`  · ${finding}`);
  process.exit(1);
}

console.log('✓ secrets check: no secret patterns in source or build output');
