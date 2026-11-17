import { z } from 'zod';

const workerSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  TEMP_DIR: z.string().default('/tmp/rumindium-image'),
  MODEL_DIR: z.string().default('./models'),
  JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  IMG_AI_DEVICE: z.enum(['cpu', 'cuda']).default('cpu'),
  IMG_AI_WARMUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  ALLOW_NONCOMMERCIAL_MODELS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type WorkerConfig = z.infer<typeof workerSchema>;

export function loadWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const parsed = workerSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid worker configuration: ${names}`);
  }
  return parsed.data;
}

export const workerConfig = loadWorkerConfig(process.env);
