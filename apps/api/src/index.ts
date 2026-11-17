import { app } from './app.ts';
import { config } from './config.ts';

/**
 * Bun.serve wrapper with a graceful shutdown. Lane B jobs are durable in Redis once phase 3 lands;
 * until then the only state is the process itself.
 */
const server = Bun.serve({
  port: config.API_PORT,
  fetch: app.handle,
});

console.log(
  JSON.stringify({
    level: 'info',
    msg: 'api.listening',
    url: `http://localhost:${server.port}${config.API_BASE_PATH}`,
    env: config.NODE_ENV,
    laneBConfigured: Boolean(config.DATABASE_URL && config.REDIS_URL && config.SERVER_LANE_ENABLED),
  }),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: 'info', msg: 'api.shutdown', signal }));
    void server.stop();
    process.exit(0);
  });
}
