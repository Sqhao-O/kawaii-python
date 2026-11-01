import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', target: 'node22',
  format: 'cjs', outfile: 'dist/extension.js', external: ['vscode'], sourcemap: true });
