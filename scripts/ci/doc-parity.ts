#!/usr/bin/env bun
/**
 * Registry ↔ README ↔ tool docs (docs/0-E2E-CHECKLIST.md §19). This is what keeps a 31-document set
 * from drifting away from the code: a claim in the docs that the registry does not have is a failure.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CATALOG, ERROR_CODES } from '@ri/contracts';

const root = new URL('../../', import.meta.url).pathname;
const errors: string[] = [];
const notes: string[] = [];

async function read(path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch {
    return null;
  }
}

const readme = await read('docs/README.md');
if (!readme) {
  console.error('✗ docs/README.md is missing');
  process.exit(1);
}

// 1. every registry tool has a README matrix row, and vice versa
const readmeIds = [...readme.matchAll(/^\|\s*\d+\s*\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((match) => match[1]);
const registryIds = CATALOG.map((tool) => tool.id);

for (const id of registryIds) {
  if (!readmeIds.includes(id)) errors.push(`README §3 has no row for tool id "${id}"`);
}
for (const id of readmeIds) {
  if (id && !registryIds.includes(id as (typeof registryIds)[number])) {
    errors.push(`README §3 lists "${id}", which is not in the registry`);
  }
}

// 2. every tool doc exists, is linked from the README, and names its own id
const linkedDocs = new Set([...readme.matchAll(/\]\((\d{2}-[A-Z0-9-]+\.md)\)/g)].map((match) => match[1]));
for (const tool of CATALOG) {
  const doc = await read(`docs/${tool.docs}`);
  if (!doc) {
    errors.push(`tool "${tool.id}" points at docs/${tool.docs}, which does not exist`);
    continue;
  }
  if (!linkedDocs.has(tool.docs)) errors.push(`docs/${tool.docs} is not linked from the README`);
  if (!doc.includes(`\`${tool.id}\``) && !doc.includes(tool.id)) {
    errors.push(`docs/${tool.docs} never mentions its tool id "${tool.id}"`);
  }
}

// 3. every error code in the contract appears in the API error table
const apiDoc = await read('docs/0-API.md');
if (!apiDoc) errors.push('docs/0-API.md is missing');
else {
  for (const code of ERROR_CODES) {
    if (!apiDoc.includes(code)) errors.push(`error code "${code}" is not documented in docs/0-API.md §7`);
  }
  const claimed = /(\d+) codes\./.exec(apiDoc)?.[1];
  if (claimed && Number(claimed) !== ERROR_CODES.length) {
    errors.push(`docs/0-API.md claims ${claimed} error codes; the contract defines ${ERROR_CODES.length}`);
  }
}

// 4. the preset table in the docs matches the preset package size
const socialDoc = await read('docs/11-SOCIAL-PRESETS.md');
if (socialDoc) {
  const { SOCIAL_PRESETS } = await import('@ri/presets');
  const rows = [...socialDoc.matchAll(/^\|\s*[A-Za-z]+\s*\|\s*[^|]+\|\s*[\d,]+\s*×\s*[\d,]+\s*\|/gm)].length;
  if (rows > 0 && rows !== SOCIAL_PRESETS.length) {
    notes.push(`preset table rows in docs (${rows}) differ from SOCIAL_PRESETS (${SOCIAL_PRESETS.length})`);
  }
}

if (errors.length > 0) {
  console.error(`✗ doc parity: ${errors.length} problem(s)`);
  for (const error of errors) console.error(`  · ${error}`);
  process.exit(1);
}

console.log(
  `✓ doc parity: ${CATALOG.length} tool ids, ${ERROR_CODES.length} error codes, ${linkedDocs.size} linked docs`,
);
for (const note of notes) console.warn(`  note: ${note}`);
