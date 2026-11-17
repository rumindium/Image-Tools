import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES, ERROR_STATUS } from '../errors.ts';
import { CATALOG, TOOL_IDS, getTool } from './index.ts';

const docsDir = join(import.meta.dir, '..', '..', '..', '..', 'docs');

describe('catalog', () => {
  test('has the 20 documented tool ids, unique', () => {
    expect(CATALOG.length).toBe(20);
    expect(new Set(CATALOG.map((tool) => tool.id)).size).toBe(20);
    expect(new Set(TOOL_IDS).size).toBe(TOOL_IDS.length);
  });

  test('every tool parses its own defaults — the UI initialises from them', () => {
    for (const tool of CATALOG) {
      const parsed = tool.options.safeParse(tool.defaults);
      if (!parsed.success) {
        throw new Error(`${tool.id} defaults do not parse: ${parsed.error.issues[0]?.message}`);
      }
    }
  });

  test('limits are within the global ceiling', () => {
    for (const tool of CATALOG) {
      expect(tool.limits.minFiles).toBeGreaterThanOrEqual(1);
      expect(tool.limits.maxFiles).toBeGreaterThanOrEqual(tool.limits.minFiles);
      expect(tool.limits.maxPixels).toBeLessThanOrEqual(40_000_000);
      expect(tool.limits.maxBytes).toBeLessThanOrEqual(1_610_612_736);
    }
  });

  test('batch tools exclude the per-image and metered ones', () => {
    const batchable = CATALOG.filter((tool) => tool.batch).map((tool) => tool.id);
    expect(batchable).not.toContain('crop');
    expect(batchable).not.toContain('pixel-pick');
    expect(batchable).not.toContain('upscale');
    expect(batchable).toContain('convert');
  });

  test('every tool names a docs file that exists', () => {
    for (const tool of CATALOG) {
      expect(existsSync(join(docsDir, tool.docs))).toBe(true);
    }
  });

  test('estimates are finite and positive at 1 MP and 40 MP', () => {
    for (const tool of CATALOG) {
      expect(tool.estimateMs({ pixels: 1_000_000, files: 1 })).toBeGreaterThan(0);
      expect(tool.estimateMs({ pixels: 40_000_000, files: 5 })).toBeGreaterThan(0);
      expect(Number.isFinite(tool.estimateMs({ pixels: 40_000_000, files: 200 }))).toBe(true);
    }
  });

  test('getTool refuses an unknown id instead of returning undefined', () => {
    expect(() => getTool('nope')).toThrow(/Unknown tool id/);
    expect(getTool('convert').title).toBe('Convert format');
  });
});

describe('error codes', () => {
  test('there are 28, each with exactly one status', () => {
    expect(ERROR_CODES.length).toBe(28);
    expect(new Set(ERROR_CODES).size).toBe(28);
    for (const code of ERROR_CODES) {
      expect(Number.isInteger(ERROR_STATUS[code])).toBe(true);
    }
  });

  test('the statuses match the documented contract', () => {
    expect(ERROR_STATUS.CANCELLED).toBe(499);
    expect(ERROR_STATUS.JOB_EXPIRED).toBe(410);
    expect(ERROR_STATUS.SERVER_LANE_CONSENT_REQUIRED).toBe(422);
    expect(ERROR_STATUS.MEMORY_LIMIT_EXCEEDED).toBe(507);
  });
});
