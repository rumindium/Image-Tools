#!/usr/bin/env bun
/**
 * Preflight: what a deployment needs before it starts serving (docs/0-CONFIG.md, docs/0-FILE-STORAGE.md).
 * Exit code 1 only for a hard failure; a missing optional dependency is a warning.
 */
import { constants, access, mkdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const tempDir = process.env.TEMP_DIR ?? '/tmp/rumindium-image';
const modelDir = process.env.MODEL_DIR ?? './models';
const rows: Array<{ check: string; status: 'ok' | 'warn' | 'fail'; detail: string }> = [];

rows.push({
  check: 'bun',
  status: Bun.version.startsWith('1.') ? 'ok' : 'warn',
  detail: Bun.version,
});

try {
  await mkdir(tempDir, { recursive: true, mode: 0o700 });
  await access(tempDir, constants.W_OK);
  const stats = await statfs(tempDir);
  const freeGb = (stats.bavail * stats.bsize) / 1e9;
  rows.push({
    check: 'temp dir',
    status: freeGb > 5 ? 'ok' : 'warn',
    detail: `${tempDir} · ${freeGb.toFixed(1)} GB free`,
  });
} catch (error) {
  rows.push({
    check: 'temp dir',
    status: 'fail',
    detail: error instanceof Error ? error.message : 'unusable',
  });
}

try {
  await access(join(modelDir, '.'), constants.R_OK);
  rows.push({ check: 'model dir', status: 'ok', detail: modelDir });
} catch {
  rows.push({ check: 'model dir', status: 'warn', detail: `${modelDir} missing (lane B AI will refuse)` });
}

rows.push({
  check: 'database',
  status: process.env.DATABASE_URL ? 'ok' : 'warn',
  detail: process.env.DATABASE_URL ? 'configured' : 'not configured — lane B unavailable',
});
rows.push({
  check: 'redis',
  status: process.env.REDIS_URL ? 'ok' : 'warn',
  detail: process.env.REDIS_URL ? 'configured' : 'not configured — lane B unavailable',
});
rows.push({
  check: 'session secret',
  status: (process.env.SESSION_SECRET?.length ?? 0) >= 32 ? 'ok' : 'warn',
  detail: process.env.SESSION_SECRET ? 'set' : 'missing (required in production)',
});

const width = Math.max(...rows.map((row) => row.check.length));
for (const row of rows) {
  const mark = row.status === 'ok' ? '✓' : row.status === 'warn' ? '·' : '✗';
  console.log(`${mark} ${row.check.padEnd(width)}  ${row.detail}`);
}

if (rows.some((row) => row.status === 'fail')) process.exit(1);
