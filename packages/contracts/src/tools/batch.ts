import { z } from 'zod';

export const BATCHABLE_TOOLS = [
  'convert',
  'compress',
  'resize',
  'rotate-flip',
  'adjust',
  'filter',
  'bg-remove',
  'bg-replace',
  'enhance',
  'metadata-clean',
  'social-resize',
  'palette',
] as const;

export const BatchOptions = z
  .object({
    toolId: z.enum(BATCHABLE_TOOLS).default('convert'),
    toolOptions: z.record(z.string(), z.unknown()).default({}),
    overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    concurrency: z.number().int().min(1).max(3).optional(),
    lane: z.enum(['browser', 'server']).default('browser'),
    stopOnError: z.boolean().default(false),
    zip: z.boolean().default(true),
    zipName: z.string().max(80).default('rumindium-images.zip'),
  })
  .strict();

export type BatchOptionsValue = z.infer<typeof BatchOptions>;
