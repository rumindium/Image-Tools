import { describePoolStart } from '@ri/worker-shared';

/**
 * The `img-heavy` pool: large resizes, format conversion at scale and the ZIP for a big batch, using
 * sharp rather than a canvas. Phase 3 adds the consumer; phase 6 adds upscaling behind its flag.
 */
describePoolStart('img-heavy', ['resize (large)', 'convert (large)', 'zip (server lane)']);
