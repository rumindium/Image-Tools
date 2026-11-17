#!/usr/bin/env bun
/**
 * Model license gate — docs/0-AI-MODELS.md §2.2. A model with an unrecorded license must not ship:
 * the bytes cannot be un-distributed by a later release.
 */
import { MODEL_MANIFEST } from '@ri/contracts';

const allowNonCommercial = process.env.ALLOW_NONCOMMERCIAL_MODELS === 'true';
const problems: string[] = [];

for (const model of MODEL_MANIFEST.models) {
  const where = `${model.id}@${model.version}`;
  if (!model.spdx) problems.push(`${where}: missing spdx id`);
  if (!model.upstream?.startsWith('http')) problems.push(`${where}: missing upstream URL`);
  if (!/^[0-9a-f]{64}$/.test(model.sha256)) problems.push(`${where}: sha256 must be 64 hex characters`);
  if (!Number.isInteger(model.bytes) || model.bytes <= 0) problems.push(`${where}: bytes must be positive`);
  if (model.commercialUse === 'unknown')
    problems.push(`${where}: commercialUse is unknown — read the license`);
  if (model.redistribution === 'unknown') problems.push(`${where}: redistribution is unknown`);
  if (model.commercialUse === false && !allowNonCommercial) {
    problems.push(`${where}: non-commercial weights require ALLOW_NONCOMMERCIAL_MODELS=true`);
  }
}

if (problems.length > 0) {
  console.error(`✗ model license gate: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  MODEL_MANIFEST.models.length === 0
    ? '✓ model license gate: no models adopted yet (manifest empty)'
    : `✓ model license gate: ${MODEL_MANIFEST.models.length} model(s) documented`,
);
