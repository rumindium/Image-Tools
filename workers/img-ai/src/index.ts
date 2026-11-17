import { describePoolStart } from '@ri/worker-shared';

/**
 * The `img-ai` pool: segmentation, enhancement and (later) upscaling, on the same model manifest the
 * browser uses (docs/0-AI-MODELS.md §7). Phase 3 adds the BullMQ consumer and the ORT session cache.
 */
describePoolStart('img-ai', ['bg-remove', 'enhance', 'upscale']);
