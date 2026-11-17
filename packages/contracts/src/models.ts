import manifest from '../model-manifest.json';

/**
 * The model manifest of docs/0-AI-MODELS.md §3. `commercialUse` must be a recorded verdict, never
 * inferred: the license gate (scripts/ci/model-licenses.ts) fails the build on 'unknown'.
 */
export type ModelEntry = {
  id: string;
  version: string;
  upstream: string;
  spdx: string;
  commercialUse: boolean | 'unknown';
  redistribution: boolean | 'unknown';
  bytes: number;
  sha256: string;
  input: [number, number];
  dtype: 'fp32' | 'fp16' | 'q8';
  outputs: 'alpha-matte' | 'tile-upscale' | 'denoise';
  runtime: Array<'wasm' | 'webgpu' | 'node'>;
  notes?: string;
};

export type ModelManifest = {
  manifestVersion: string;
  models: ModelEntry[];
};

export const MODEL_MANIFEST = manifest as ModelManifest;
