import { constants, access, mkdir, statfs } from 'node:fs/promises';
import { Elysia } from 'elysia';
import { config, laneBConfigured } from '../config.ts';

const startedAt = Date.now();

type Check = { ok: boolean; detail?: string; latencyMs?: number };

async function checkTempDir(): Promise<Check & { freeBytes?: number }> {
  const started = performance.now();
  try {
    await mkdir(config.TEMP_DIR, { recursive: true, mode: 0o700 });
    await access(config.TEMP_DIR, constants.W_OK);
    const stats = await statfs(config.TEMP_DIR);
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      freeBytes: stats.bavail * stats.bsize,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'unavailable' };
  }
}

/**
 * Liveness never touches a dependency. Readiness names what is missing and reports whether lane B
 * can accept work — the single boolean the web app reads (docs/0-API.md §2).
 */
export const healthRoutes = new Elysia()
  .get('/health', () => ({
    status: 'ok' as const,
    version: '0.0.0',
    commit: config.COMMIT_SHA,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }))
  .get('/health/ready', async ({ set }) => {
    const tempDir = await checkTempDir();

    // Phase 0 has no database or queue yet; reporting them as absent is the honest answer and the
    // reason laneB is unavailable (docs/0-ARCHITECTURE.md §7 — fail closed, never fail open).
    const database: Check = config.DATABASE_URL
      ? { ok: false, detail: 'configured but not connected in phase 0' }
      : { ok: false, detail: 'not configured' };
    const redis: Check = config.REDIS_URL
      ? { ok: false, detail: 'configured but not connected in phase 0' }
      : { ok: false, detail: 'not configured' };

    const laneB = laneBConfigured && database.ok && redis.ok;

    // A missing database degrades the product but does not stop the process: lane A never calls it.
    // An unusable TEMP_DIR is a hard failure because lane B could not clean up after itself.
    if (!tempDir.ok) set.status = 503;

    return {
      status: tempDir.ok ? (laneB ? 'ok' : 'degraded') : 'unavailable',
      checks: {
        tempDir,
        database,
        redis,
        models: { ok: true, available: [] as string[] },
        queueDepth: { 'img-ai': 0, 'img-heavy': 0 },
      },
      laneB: laneB ? 'available' : 'unavailable',
    };
  });
