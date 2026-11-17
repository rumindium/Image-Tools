import type { ToolId } from '@ri/contracts';
import { adjust, filter } from './adjust.ts';
import { compress } from './compress.ts';
import { convert } from './convert.ts';
import { crop, rotateFlip } from './edit.ts';
import { resize } from './resize.ts';
import type { Op } from './types.ts';

/** Tools whose transform is implemented in this phase; a missing id is refused by the worker. */
export const OPS: Partial<Record<ToolId, Op>> = {
  convert,
  compress,
  resize,
  crop,
  'rotate-flip': rotateFlip,
  adjust,
  filter,
};

export type { Op, OpContext, OpResult } from './types.ts';
export { adjust, compress, convert, crop, filter, resize, rotateFlip };
