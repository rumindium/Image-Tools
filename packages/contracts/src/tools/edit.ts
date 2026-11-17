import { z } from 'zod';
import { Background, ImageFormat, Quality, Rect } from './common.ts';

export const CropOptions = z
  .object({
    rect: Rect,
    aspect: z
      .union([
        z.literal('free'),
        z.literal('1:1'),
        z.literal('4:3'),
        z.literal('3:4'),
        z.literal('16:9'),
        z.literal('9:16'),
        z.number().positive(),
      ])
      .default('free'),
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    roundCorners: z.number().int().min(0).max(2000).default(0),
    background: Background.default('#ffffff'),
    format: ImageFormat.default('png'),
    quality: Quality.default(88),
  })
  .strict();

export const RotateOptions = z
  .object({
    rotate: z
      .number()
      .min(-360)
      .max(360)
      .default(90)
      .describe('Degrees clockwise. Multiples of 90 are lossless copies.'),
    flipH: z.boolean().default(false),
    flipV: z.boolean().default(false),
    background: Background.default('#ffffff'),
    format: ImageFormat.default('png'),
    quality: Quality.default(88),
  })
  .strict();

export const AdjustOptions = z
  .object({
    brightness: z.number().min(-100).max(100).default(0),
    contrast: z.number().min(-100).max(100).default(0),
    saturation: z.number().min(-100).max(100).default(0),
    exposure: z.number().min(-100).max(100).default(0),
    temperature: z.number().min(-100).max(100).default(0),
    tint: z.number().min(-100).max(100).default(0),
    gamma: z.number().min(0.2).max(3).default(1),
    hue: z.number().min(-180).max(180).default(0),
    sharpen: z.number().min(0).max(100).default(0),
    format: ImageFormat.default('png'),
    quality: Quality.default(88),
  })
  .strict();

export const FILTER_NAMES = [
  'none',
  'grayscale',
  'sepia',
  'vintage',
  'mono',
  'blur',
  'invert',
  'warm',
  'cool',
  'sharpen',
] as const;

export const FilterOptions = z
  .object({
    filter: z.enum(FILTER_NAMES).default('none'),
    intensity: z.number().min(0).max(100).default(100),
    format: ImageFormat.default('png'),
    quality: Quality.default(88),
  })
  .strict();

export type CropOptionsValue = z.infer<typeof CropOptions>;
export type RotateOptionsValue = z.infer<typeof RotateOptions>;
export type AdjustOptionsValue = z.infer<typeof AdjustOptions>;
export type FilterOptionsValue = z.infer<typeof FilterOptions>;
