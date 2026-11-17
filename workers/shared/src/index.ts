import { workerConfig } from './config.ts';

export * from './config.ts';
export * from './handler.ts';

/**
 * Phase 0 has no queue consumer: Redis + BullMQ arrive with lane B (phase 3,
 * docs/0-IMPLEMENTATION-PHASE.md). The stub states what the pool will consume instead of pretending
 * to be idle-but-ready.
 */
export function describePoolStart(queue: string, tools: readonly string[]): void {
  const config = workerConfig;
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'worker.not_implemented',
      queue,
      tools,
      device: queue === 'img-ai' ? config.IMG_AI_DEVICE : 'cpu',
      redis: config.REDIS_URL,
      note: 'Lane B lands in phase 3: Redis + BullMQ consumer, then the onnxruntime-node handler.',
    }),
  );
}
