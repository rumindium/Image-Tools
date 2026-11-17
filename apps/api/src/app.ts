import { AppError } from '@ri/contracts';
import { Elysia } from 'elysia';
import { config } from './config.ts';
import { errors } from './middleware/errors.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { healthRoutes } from './routes/health.ts';

/**
 * The API of docs/0-API.md. Phase 0 exposes health and the catalogs; jobs, files and SSE arrive with
 * lane B (phase 3). `SERVER_LANE_ENABLED=false` keeps the catalog endpoints and the honest `laneB:
 * unavailable` answer rather than a half-working lane.
 */
export function createApp() {
  const app = new Elysia({ prefix: config.API_BASE_PATH })
    .use(errors)
    .onRequest(({ request, set }) => {
      // Foreign origins may read public catalogs, but mutating routes will refuse them once they
      // exist (docs/0-SECURITY.md §5). Health and catalogs are GET-only today.
      const origin = request.headers.get('origin');
      if (origin && origin !== config.APP_ORIGIN) {
        set.headers['access-control-allow-origin'] = config.APP_ORIGIN;
        set.headers.vary = 'Origin';
      }
    })
    .use(healthRoutes)
    .use(catalogRoutes)
    .get('/', () => ({ name: 'rumindium-image-api', base: config.API_BASE_PATH }))
    .all('*', ({ request, path }) => {
      throw new AppError('JOB_NOT_FOUND', `No route for ${request.method} ${config.API_BASE_PATH}${path}.`, {
        hint: 'See docs/0-API.md for the available endpoints.',
      });
    });

  return app;
}

export const app = createApp();
