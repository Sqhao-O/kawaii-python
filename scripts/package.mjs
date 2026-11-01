import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
await import('./build.mjs');
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
const require = createRequire(import.meta.url);
const vsceRoot = path.dirname(require.resolve('@vscode/vsce/package.json'));
const vsce = JSON.parse(await fs.readFile(path.join(vsceRoot, 'package.json'), 'utf8'));
const target = path.resolve('artifacts', `${manifest.name}-${manifest.version}.vsix`);
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(vsceRoot, vsce.bin.vsce), 'package', '--no-dependencies', '--pre-release', '--out', target], { stdio: 'inherit' });
  child.on('error', reject); child.on('exit', resolve);
});
if (exitCode !== 0) process.exitCode = typeof exitCode === 'number' ? exitCode : 1;
