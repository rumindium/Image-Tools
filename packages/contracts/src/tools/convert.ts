import { z } from 'zod';
import { Background, ImageFormat, NamingOptions, Quality } from './common.ts';

export const ConvertOptions = z
  .object({
    format: ImageFormat.default('webp'),
    quality: Quality.default(82),
    background: Background.default('#ffffff').describe('Flatten colour when the output has no alpha.'),
    keepMetadata: z.boolean().default(false),
    naming: NamingOptions.default({ mode: 'suffix', suffix: '', startIndex: 1 }),
    overwrite: z.boolean().default(false).describe('Replace the source instead of adding a copy.'),
  })
  .strict();

export const CompressOptions = z
  .object({
    mode: z.enum(['quality', 'target']).default('quality'),
    quality: Quality.default(80),
    targetBytes: z
      .number()
      .int()
      .min(10_000)
      .max(50_000_000)
      .optional()
      .describe('Maximum output size. The app searches for the best quality that fits.'),
    format: z.enum(['jpeg', 'webp', 'avif', 'png']).default('webp'),
    maxWidth: z.number().int().min(16).max(20_000).optional(),
    maxHeight: z.number().int().min(16).max(20_000).optional(),
    stripMetadata: z.boolean().default(true),
    background: Background.default('#ffffff'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'target' && value.targetBytes === undefined) {
      ctx.addIssue({ code: 'custom', path: ['targetBytes'], message: 'A target size is required.' });
    }
    if (value.format === 'png') {
      ctx.addIssue({
        code: 'custom',
        path: ['format'],
        message: 'PNG has no quality setting. Use JPEG, WebP or AVIF to reduce size.',
      });
    }
  });

export const ExportOptions = z
  .object({
    format: ImageFormat.optional(),
    quality: Quality.optional(),
    naming: NamingOptions.default({ mode: 'suffix', suffix: '', startIndex: 1 }),
    stripMetadata: z.boolean().default(true),
    container: z.enum(['files', 'zip']).default('zip'),
  })
  .strict();

export type ConvertOptionsValue = z.infer<typeof ConvertOptions>;
export type CompressOptionsValue = z.infer<typeof CompressOptions>;
export type ExportOptionsValue = z.infer<typeof ExportOptions>;
