import { z } from 'zod';

/**
 * Configuration — docs/0-CONFIG.md §1–§3. One reader per value, no `process.env` anywhere else,
 * and boot fails with the list of missing names rather than a TypeError at the first request.
 */

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ORIGIN: z.string().url().default('http://localhost:4400'),
    API_PORT: z.coerce.number().int().positive().default(4401),
    API_BASE_PATH: z.string().startsWith('/').default('/api/v1'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    COMMIT_SHA: z.string().default('dev'),

    SERVER_LANE_ENABLED: bool(true),
    TEMP_DIR: z.string().default('/tmp/rumindium-image'),
    SERVER_MAX_FILE_BYTES: z.coerce.number().int().positive().default(26_214_400),
    SERVER_MAX_PIXELS: z.coerce.number().int().positive().default(30_000_000),
    JOB_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    MIN_FREE_DISK_BYTES: z.coerce.number().int().nonnegative().default(5_368_709_120),

    QUOTA_JOBS_PER_DAY: z.coerce.number().int().positive().default(200),
    QUOTA_BYTES_PER_DAY: z.coerce.number().int().positive().default(524_288_000),
    CONSENT_VERSION: z.string().default('2026-11-01'),

    DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url().optional(),
    SESSION_SECRET: z.string().min(32).optional(),
    ADMIN_OPS_TOKEN: z.string().min(16).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.SESSION_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET is required in production (32+ characters).',
      });
    }
    if (value.NODE_ENV === 'production' && value.APP_ORIGIN.startsWith('http://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN must be https in production.',
      });
    }
  });

export type ApiConfig = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Invalid API configuration:\n  ${names}`);
  }
  return parsed.data;
}

export const config: ApiConfig = loadConfig(process.env);

export const laneBConfigured = Boolean(config.DATABASE_URL && config.REDIS_URL && config.SERVER_LANE_ENABLED);
