import type { Capabilities, Warning } from '@ri/contracts';
import type { Raster } from '../raster.ts';

/** What a tool implements: one transform, no decode, no encode policy of its own beyond its format. */

export type OpContext = {
  signal: AbortSignal;
  /** Progress inside the transform stage, 0..1. The pipeline maps it onto 25–75 %. */
  report: (pct: number) => void;
  caps: Capabilities;
  inputFormat: string;
  inputHasAlpha: boolean;
};

export type OpResult = {
  blob: Blob;
  width: number;
  height: number;
  /** The format the encoder actually produced. */
  format: string;
  quality: number | null;
  warnings: Warning[];
};

export type Op = (input: Raster, options: unknown, ctx: OpContext) => Promise<OpResult>;
