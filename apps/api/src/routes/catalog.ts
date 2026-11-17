import { CATALOG, MODEL_MANIFEST } from '@ri/contracts';
import { PRESETS_VERSION, SOCIAL_PRESETS } from '@ri/presets';
import { Elysia } from 'elysia';
import { config } from '../config.ts';

/**
 * Catalog endpoints (docs/0-API.md §5). These are generated from the same registry and preset data
 * the web app bundles, so a tool cannot exist on the server without existing in the client.
 */
export const catalogRoutes = new Elysia()
  .get('/tools', () => ({
    tools: CATALOG.filter((tool) => tool.execution.kind !== 'browser').map((tool) => ({
      id: tool.id,
      title: tool.title,
      queue: tool.id === 'upscale' ? 'img-heavy' : 'img-ai',
      limits: {
        maxFiles: tool.limits.maxFiles,
        maxFileBytes: Math.min(tool.limits.maxBytes, config.SERVER_MAX_FILE_BYTES),
        maxPixels: Math.min(tool.limits.maxPixels, config.SERVER_MAX_PIXELS),
      },
    })),
    laneB: false,
    consentVersion: config.CONSENT_VERSION,
  }))
  .get('/presets', ({ set, headers }) => {
    const etag = `"presets-${PRESETS_VERSION}"`;
    if (headers['if-none-match'] === etag) {
      set.status = 304;
      return null;
    }
    set.headers.etag = etag;
    set.headers['cache-control'] = 'public, max-age=300, stale-while-revalidate=86400';
    return {
      version: PRESETS_VERSION,
      presets: SOCIAL_PRESETS,
    };
  })
  .get('/models', () => ({
    models: MODEL_MANIFEST.models,
    manifestVersion: MODEL_MANIFEST.manifestVersion,
  }))
  .get('/usage', () => ({
    session: {
      jobsToday: 0,
      jobsLimit: config.QUOTA_JOBS_PER_DAY,
      bytesToday: 0,
      bytesLimit: config.QUOTA_BYTES_PER_DAY,
    },
    resetAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
    laneB: false,
  }));
