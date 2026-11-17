#!/usr/bin/env bun
/**
 * TTL sweeper. In production the authority is `jobs.expires_at` in PostgreSQL (docs/0-FILE-STORAGE.md
 * §5); this script is the development equivalent and is deliberately a dry run unless --apply is
 * passed, because deleting a directory is not undoable.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const tempDir = resolve(process.env.TEMP_DIR ?? '/tmp/rumindium-image');
const ttlMinutes = Number(process.env.JOB_TTL_MINUTES ?? 15);
const apply = process.argv.includes('--apply');

const entries = await readdir(tempDir, { withFileTypes: true }).catch(() => []);
const now = Date.now();
const expired: Array<{ path: string; ageMinutes: number }> = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const path = join(tempDir, entry.name);
  const stats = await stat(path);
  const ageMinutes = (now - stats.mtimeMs) / 60_000;
  if (ageMinutes > ttlMinutes) expired.push({ path, ageMinutes: Math.round(ageMinutes) });
}

if (expired.length === 0) {
  console.log(`✓ sweep: nothing older than ${ttlMinutes} min in ${tempDir}`);
  process.exit(0);
}

for (const item of expired) {
  console.log(`${apply ? 'deleting' : 'would delete'} ${item.path} (${item.ageMinutes} min old)`);
  if (apply) {
    // Never delete outside TEMP_DIR, even if a symlink points there.
    if (!resolve(item.path).startsWith(tempDir)) {
      console.error(`✗ refusing to delete outside TEMP_DIR: ${item.path}`);
      process.exit(1);
    }
    await rm(item.path, { recursive: true, force: true });
  }
}

console.log(
  apply
    ? `✓ sweep: deleted ${expired.length} director${expired.length === 1 ? 'y' : 'ies'}`
    : `· sweep: ${expired.length} director${expired.length === 1 ? 'y' : 'ies'} would be deleted (pass --apply)`,
);
