#!/usr/bin/env bun
/**
 * Import boundaries — docs/0-FOLDER-STRUCTURE.md §6. Runs in CI and costs seconds.
 * A violation is a layering bug that would otherwise surface as a bundle failure much later.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;

type Rule = { name: string; applies: (file: string) => boolean; forbids: RegExp[]; why: string };

const RULES: Rule[] = [
  {
    name: 'web-does-not-import-workers',
    applies: (file) => file.startsWith('apps/web/'),
    forbids: [/from ['"][^'"]*workers\//, /@ri\/worker-/],
    why: 'a browser bundle must not pull in Node worker code',
  },
  {
    name: 'api-does-not-import-browser-package',
    applies: (file) => file.startsWith('apps/api/'),
    forbids: [/@ri\/image-browser/],
    why: 'the request process must not depend on the DOM',
  },
  {
    name: 'image-core-is-pure',
    applies: (file) => file.startsWith('packages/image-core/'),
    forbids: [/from ['"]react['"]/, /from ['"]node:/, /\bdocument\./, /\bwindow\./],
    why: 'image-core must run unchanged in the browser, the API and the tests',
  },
  {
    name: 'contracts-does-not-import-apps',
    applies: (file) => file.startsWith('packages/contracts/'),
    forbids: [/@ri\/image-browser/, /@ri\/ui/, /apps\//],
    why: 'contracts is imported by everything and may only depend on zod',
  },
  {
    name: 'ui-is-presentational',
    applies: (file) => file.startsWith('packages/ui/'),
    forbids: [/@ri\/image-core/, /@ri\/image-browser/],
    why: 'a design primitive must not know how an image is processed',
  },
  {
    name: 'workers-do-not-import-apps',
    applies: (file) => file.startsWith('workers/'),
    forbids: [/from ['"][^'"]*apps\//],
    why: 'workers are deployed independently of the web and API apps',
  },
  {
    name: 'lane-a-does-not-statically-import-lane-b',
    applies: (file) => file.startsWith('apps/web/src/lib/local-runner'),
    forbids: [/from ['"]\.\/server-runner/],
    why: 'a static edge would ship lane B code to every user and weaken the privacy claim',
  },
];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.freebuff', 'docs', 'models', 'dist']);

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

async function main(): Promise<void> {
  const files = (await walk(root)).map((file) => relative(root, file).replaceAll('\\', '/'));
  const violations: string[] = [];
  let checked = 0;

  for (const file of files) {
    const rule = RULES.find((candidate) => candidate.applies(file));
    if (!rule) continue;
    checked += 1;
    const source = await readFile(join(root, file), 'utf8');

    for (const pattern of rule.forbids) {
      if (pattern.test(source)) {
        violations.push(`${file}: ${rule.name} (${pattern}) — ${rule.why}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} boundary violation(s):`);
    for (const violation of violations) console.error(`  · ${violation}`);
    process.exit(1);
  }

  console.log(`✓ boundaries: ${checked} file(s) checked against ${RULES.length} rules`);
}

await main();
