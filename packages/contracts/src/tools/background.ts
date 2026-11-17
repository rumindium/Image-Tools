import { z } from 'zod';
import { Background, Quality } from './common.ts';

export const BG_MODELS = ['auto', 'portrait', 'product', 'general'] as const;

export const BgRemoveOptions = z
  .object({
    model: z
      .enum(BG_MODELS)
      .default('auto')
      .describe('auto picks by content heuristic; see docs/0-AI-MODELS.md §3.'),
    refine: z
      .enum(['none', 'fast', 'quality'])
      .default('fast')
      .describe('quality runs a second pass on the alpha edge; roughly 2× the inference cost.'),
    denoiseAlpha: z.boolean().default(true),
    outputFormat: z.enum(['png', 'webp']).default('png'),
    quality: Quality.default(90),
    lane: z.enum(['browser', 'server']).default('browser'),
    consent: z.object({ acceptedAt: z.string().datetime(), version: z.string().min(1) }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.lane === 'server' && value.consent === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['consent'],
        message: 'Server processing needs explicit consent.',
      });
    }
  });

export const GradientStops = z
  .array(z.object({ color: Background, at: z.number().min(0).max(1) }))
  .min(2)
  .max(6);

export const BackgroundLayer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('transparent') }),
  z.object({ type: z.literal('color'), color: Background.default('#ffffff') }),
  z.object({
    type: z.literal('gradient'),
    kind: z.enum(['linear', 'radial']).default('linear'),
    angle: z.number().min(0).max(360).default(135),
    stops: GradientStops,
  }),
  z.object({
    type: z.literal('image'),
    imageId: z.string().min(1),
    fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
    blur: z.number().min(0).max(100).default(0),
    scale: z.number().min(0.1).max(4).default(1),
    offsetX: z.number().min(-1).max(1).default(0),
    offsetY: z.number().min(-1).max(1).default(0),
  }),
]);

export const MaskStroke = z.object({
  op: z.enum(['erase', 'restore']),
  points: z.array(z.tuple([z.number(), z.number()])).min(1),
  radius: z.number().min(1).max(400),
  hardness: z.number().min(0).max(1).default(0.6),
  opacity: z.number().min(0).max(1).default(1),
});

export const BgReplaceOptions = z
  .object({
    background: BackgroundLayer.default({ type: 'transparent' }),
    shadow: z
      .object({
        enabled: z.boolean().default(false),
        blur: z.number().min(0).max(80).default(18),
        opacity: z.number().min(0).max(1).default(0.35),
        offsetY: z.number().min(-40).max(40).default(12),
      })
      .default({ enabled: false, blur: 18, opacity: 0.35, offsetY: 12 }),
    outline: z
      .object({
        enabled: z.boolean().default(false),
        width: z.number().min(1).max(40).default(2),
        color: Background.default('#ffffff'),
      })
      .default({ enabled: false, width: 2, color: '#ffffff' }),
    maskEdits: z.array(MaskStroke).max(500).default([]),
    exportFormat: z.enum(['png', 'webp', 'jpeg']).default('png'),
    quality: Quality.default(92),
  })
  .strict();

export type BgRemoveOptionsValue = z.infer<typeof BgRemoveOptions>;
export type BgReplaceOptionsValue = z.infer<typeof BgReplaceOptions>;
export type BackgroundLayerValue = z.infer<typeof BackgroundLayer>;
