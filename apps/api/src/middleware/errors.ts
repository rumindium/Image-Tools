import { AppError, toApiErrorBody } from '@ri/contracts';
import { Elysia } from 'elysia';

/**
 * Request id + error envelope (docs/0-API.md §1, §7). The stack stays in the log; the client gets a
 * sentence, a code and the requestId that joins them.
 */
export const errors = new Elysia({ name: 'errors' })
  .derive({ as: 'global' }, ({ request }) => ({
    requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
  }))
  .onAfterHandle({ as: 'global' }, ({ set, requestId }) => {
    set.headers['x-request-id'] = requestId ?? crypto.randomUUID();
  })
  .onError({ as: 'global' }, ({ error, set, requestId, code }) => {
    const id = requestId ?? crypto.randomUUID();
    const status = error instanceof AppError ? error.status : 500;
    set.status = status;
    set.headers['x-request-id'] = id;

    if (!(error instanceof AppError)) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'request.failed',
          requestId: id,
          code,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return toApiErrorBody(error, id);
  });
