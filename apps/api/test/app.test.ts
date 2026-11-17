import { describe, expect, test } from 'bun:test';
import { app } from '../src/app.ts';
import { config } from '../src/config.ts';

const base = `http://localhost${config.API_BASE_PATH}`;

async function get(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`${base}${path}`, init));
}

describe('health', () => {
  test('liveness is ok and never touches a dependency', async () => {
    const response = await get('/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
  });

  test('readiness reports lane B as unavailable without a database or queue', async () => {
    const response = await get('/health/ready');
    const body = (await response.json()) as {
      status: string;
      laneB: string;
      checks: Record<string, { ok: boolean; detail?: string }>;
    };

    expect(body.laneB).toBe('unavailable');
    expect(body.checks.tempDir?.ok).toBe(true);
    expect(body.checks.database?.ok).toBe(false);
    expect(body.checks.redis?.ok).toBe(false);
    expect(['degraded', 'ok']).toContain(body.status);
  });

  test('every response carries a request id', async () => {
    const response = await get('/health');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('catalog', () => {
  test('/tools lists only server-capable tools, with limits clamped by config', async () => {
    const response = await get('/tools');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tools: Array<{ id: string; limits: { maxFileBytes: number; maxPixels: number } }>;
      laneB: boolean;
    };

    expect(body.tools.map((tool) => tool.id).sort()).toEqual(['bg-remove', 'enhance', 'upscale']);
    for (const tool of body.tools) {
      expect(tool.limits.maxFileBytes).toBeLessThanOrEqual(config.SERVER_MAX_FILE_BYTES);
      expect(tool.limits.maxPixels).toBeLessThanOrEqual(config.SERVER_MAX_PIXELS);
    }
    expect(body.laneB).toBe(false);
  });

  test('/presets is cacheable and answers 304 on a matching ETag', async () => {
    const first = await get('/presets');
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toContain('presets-');

    const second = await get('/presets', { headers: { 'if-none-match': etag as string } });
    expect(second.status).toBe(304);
  });

  test('/models reports an empty manifest until a model passes the license audit', async () => {
    const response = await get('/models');
    const body = (await response.json()) as { models: unknown[]; manifestVersion: string };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBe(0);
    expect(body.manifestVersion).toBeTruthy();
  });

  test('an unknown route is a JSON error, not an HTML page', async () => {
    const response = await get('/nope');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('JOB_NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });
});
