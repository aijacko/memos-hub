/** Bundle the node tests with esbuild (obsidian stubbed) and run `node --test`. */

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const testsDir = path.join(root, 'tests');
const outDir = path.join(root, '.tmp_test', 'tests');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const entries = (await readdir(testsDir)).filter(name => name.endsWith('.test.mjs'));
if (entries.length === 0) {
  console.error('No test files found in tests/');
  process.exit(1);
}

for (const entry of entries) {
  await build({
    entryPoints: [path.join(testsDir, entry)],
    outfile: path.join(outDir, entry),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    // Modules use `window.setTimeout` for Obsidian popout compatibility.
    banner: { js: 'globalThis.window = globalThis;' },
    external: ['node:*'],
    alias: {
      obsidian: path.join(testsDir, 'stubs', 'obsidian.ts'),
    },
    logLevel: 'warning',
  });
}

const result = spawnSync(
  process.execPath,
  ['--test', ...entries.map(entry => path.join(outDir, entry))],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
