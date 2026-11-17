import { z } from 'zod';
import { Background, Fit, ImageFormat, Quality } from './common.ts';

export const ResizeOptions = z
  .object({
    basis: z.enum(['dimensions', 'percentage', 'preset', 'maxEdge']).default('dimensions'),
    width: z.number().int().min(1).max(20_000).optional(),
    height: z.number().int().min(1).max(20_000).optional(),
    percentage: z.number().min(1).max(400).default(50),
    maxEdge: z.number().int().min(16).max(20_000).optional(),
    lockAspect: z.boolean().default(true),
    fit: Fit.default('fit'),
    allowUpscale: z.boolean().default(false),
    filter: z
      .enum(['auto', 'nearest'])
      .default('auto')
      .describe('Nearest keeps hard pixel edges (pixel art); auto uses a smooth resample.'),
    background: Background.default('#ffffff'),
    format: ImageFormat.optional(),
    quality: Quality.default(82),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.basis === 'dimensions' && value.width === undefined && value.height === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Give a width, a height, or both.' });
    }
    if (value.basis === 'maxEdge' && value.maxEdge === undefined) {
      ctx.addIssue({ code: 'custom', path: ['maxEdge'], message: 'Give a maximum edge.' });
    }
    if (value.basis === 'percentage' && !value.lockAspect) {
      ctx.addIssue({
        code: 'custom',
        path: ['lockAspect'],
        message: 'Percentage resize always preserves the aspect ratio.',
      });
    }
  });

export const SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'youtube',
  'tiktok',
  'linkedin',
  'x',
  'whatsapp',
  'custom',
] as const;

export const SocialPresetOptions = z
  .object({
    platform: z.enum(SOCIAL_PLATFORMS).default('instagram'),
    variant: z.string().min(1).default('square-post'),
    fit: z.enum(['cover', 'contain']).default('cover'),
    focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.5 }),
    background: Background.default('#ffffff'),
    format: z.enum(['jpeg', 'png', 'webp']).default('jpeg'),
    quality: Quality.default(88),
    safeZone: z.boolean().default(false).describe('Overlay the platform safe margins on the preview only.'),
    maxBytes: z.number().int().min(10_000).max(50_000_000).optional(),
    customName: z.string().max(40).optional(),
    customWidth: z.number().int().min(16).max(20_000).optional(),
    customHeight: z.number().int().min(16).max(20_000).optional(),
  })
  .strict();

export type ResizeOptionsValue = z.infer<typeof ResizeOptions>;
export type SocialPresetOptionsValue = z.infer<typeof SocialPresetOptions>;
