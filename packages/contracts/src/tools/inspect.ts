import { z } from 'zod';
import { ImageFormat, Quality } from './common.ts';

export const Base64Options = z.discriminatedUnion('direction', [
  z.object({
    direction: z.literal('encode'),
    includeDataUri: z.boolean().default(true),
    lineWrap: z.number().int().min(0).max(120).default(0),
    format: z.enum(['jpeg', 'png', 'webp']).default('png'),
    quality: Quality.default(85),
  }),
  z.object({
    direction: z.literal('decode'),
    text: z.string().min(16).max(40_000_000).describe('A base64 string or a full data: URI.'),
  }),
]);

export const AnalyzeOptions = z
  .object({
    detectTransparency: z.boolean().default(true),
    detectColorProfile: z.boolean().default(true),
    includeAspectName: z.boolean().default(true),
  })
  .strict();

export const LISTED_FIELDS = ['exif', 'gps', 'icc', 'xmp', 'iptc', 'all'] as const;

export const MetadataOptions = z
  .object({
    fields: z.array(z.enum(LISTED_FIELDS)).min(1).default(['exif', 'gps']),
    mode: z.enum(['strip', 'keep-allowed']).default('strip'),
    keep: z.array(z.string().max(40)).max(40).default([]),
    outputFormat: ImageFormat.default('jpeg'),
    quality: Quality.default(92),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'keep-allowed' && value.outputFormat !== 'jpeg' && value.outputFormat !== 'png') {
      ctx.addIssue({
        code: 'custom',
        path: ['outputFormat'],
        message: 'Keeping tags is supported for JPEG and PNG only.',
      });
    }
  });

export const MetadataReadOptions = z
  .object({
    fields: z.array(z.enum(LISTED_FIELDS)).min(1).default(['all']),
  })
  .strict();

export const PaletteOptions = z
  .object({
    count: z.union([z.literal(3), z.literal(5), z.literal(8), z.literal(10)]).default(5),
    algorithm: z.enum(['median-cut', 'kmeans']).default('median-cut'),
    sampleMaxSide: z
      .number()
      .int()
      .min(32)
      .max(1024)
      .default(256)
      .describe('Sampling grid. 256 px is the default: quality plateaus above it.'),
    ignoreTransparent: z.boolean().default(true),
    sort: z.enum(['dominance', 'hue', 'lightness']).default('dominance'),
    minSaturation: z.number().min(0).max(1).default(0),
  })
  .strict();

export const PixelPickOptions = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    zoom: z.number().int().min(1).max(32).default(8),
  })
  .strict();

export type Base64OptionsValue = z.infer<typeof Base64Options>;
export type AnalyzeOptionsValue = z.infer<typeof AnalyzeOptions>;
export type MetadataOptionsValue = z.infer<typeof MetadataOptions>;
export type PaletteOptionsValue = z.infer<typeof PaletteOptions>;
export type PixelPickOptionsValue = z.infer<typeof PixelPickOptions>;
