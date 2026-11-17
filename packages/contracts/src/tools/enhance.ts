import { z } from 'zod';
import { ImageFormat, Quality } from './common.ts';

export const EnhanceOptions = z
  .object({
    auto: z
      .object({
        levels: z.boolean().default(true),
        whiteBalance: z.boolean().default(true),
        contrast: z.boolean().default(true),
      })
      .default({ levels: true, whiteBalance: true, contrast: true }),
    exposure: z.number().min(-100).max(100).default(0),
    sharpen: z.number().min(0).max(100).default(0),
    denoise: z.enum(['off', 'classical', 'ai']).default('off'),
    denoiseStrength: z.number().min(0).max(100).default(35),
    strength: z.number().min(0).max(100).default(100),
    format: z.enum(['jpeg', 'png', 'webp']).default('jpeg'),
    quality: Quality.default(90),
  })
  .strict();

export const UpscaleOptions = z
  .object({
    scale: z.union([z.literal(2), z.literal(4)]).default(2),
    model: z.enum(['realesrgan-x2', 'realesrgan-x4']).default('realesrgan-x2'),
    format: ImageFormat.default('png'),
    quality: Quality.default(92),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expected = value.scale === 2 ? 'realesrgan-x2' : 'realesrgan-x4';
    if (value.model !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: `A ${value.scale}× upscale needs ${expected}.`,
      });
    }
  });

export type EnhanceOptionsValue = z.infer<typeof EnhanceOptions>;
export type UpscaleOptionsValue = z.infer<typeof UpscaleOptions>;
