import type { z } from 'zod';

export const TOOL_IDS = [
  'convert',
  'compress',
  'resize',
  'crop',
  'rotate-flip',
  'adjust',
  'filter',
  'bg-remove',
  'bg-replace',
  'enhance',
  'upscale',
  'base64',
  'analyze',
  'metadata',
  'metadata-clean',
  'palette',
  'pixel-pick',
  'social-resize',
  'batch',
  'export',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export type ToolCategory =
  | 'convert'
  | 'optimize'
  | 'edit'
  | 'resize'
  | 'ai'
  | 'inspect'
  | 'compose'
  | 'system';

export type Capability =
  | 'encode:jpeg'
  | 'encode:png'
  | 'encode:webp'
  | 'encode:avif'
  | 'decode:heic'
  | 'decode:tiff'
  | 'alpha'
  | 'gpu'
  | 'wasmThreads'
  | 'cpuPixels';

export type OutputKind = 'image' | 'zip' | 'text' | 'json' | 'palette' | 'report' | 'color';

export type Execution =
  | { kind: 'browser' }
  | { kind: 'hybrid'; requires: readonly Capability[]; serverTool: ToolId }
  | { kind: 'server'; reason: string };

export type ToolLimits = {
  minFiles: number;
  maxFiles: number;
  maxPixels: number;
  maxBytes: number;
};

export type ToolDefinition = {
  id: ToolId;
  title: string;
  short: string;
  route: string;
  category: ToolCategory;
  execution: Execution;
  batch: boolean;
  produces: readonly OutputKind[];
  capabilities: readonly Capability[];
  limits: ToolLimits;
  options: z.ZodTypeAny;
  defaults: Record<string, unknown>;
  estimateMs: (input: { pixels: number; files: number }) => number;
  docs: string;
  phase: 1 | 2 | 3 | 4 | 5 | 6;
};
