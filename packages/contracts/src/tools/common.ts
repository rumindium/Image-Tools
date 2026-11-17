import { z } from 'zod';

export const ImageFormat = z.enum(['jpeg', 'png', 'webp', 'avif']);
export type ImageFormatValue = z.infer<typeof ImageFormat>;

export const Quality = z
  .number()
  .int()
  .min(1)
  .max(100)
  .describe('1 = smallest, 100 = best. Ignored for PNG.');

export const Background = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .describe('Used where the output format has no transparency.');

export const fileName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\w .()-]+$/u, 'Letters, digits, space, dot, dash, underscore, parentheses only')
  .refine((value) => !value.startsWith('.'), 'Cannot start with a dot');

export const SuffixMode = z.enum(['keep', 'suffix', 'template']).describe('How the output name is derived.');

export const NamingOptions = z.object({
  mode: SuffixMode.default('suffix'),
  suffix: z.string().max(24).default(''),
  template: z.string().max(80).optional(),
  startIndex: z.number().int().min(1).default(1),
});

export const Fit = z.enum(['fit', 'fill', 'stretch', 'contain', 'cover']);
export type FitValue = z.infer<typeof Fit>;

export const Rect = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().min(1),
    height: z.number().min(1),
  })
  .describe('In source pixels, top-left origin.');
