import { testExecutable, testCli } from './vscode.mjs';
import spawn from 'cross-spawn';
import path from 'node:path';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('需要精确的稳定版本号');
const vscode = await testExecutable('stable');
const { executable: cli, args, env } = testCli(vscode);
const code = await new Promise((resolve, reject) => {
  const child = spawn(cli, [...args, '--user-data-dir', path.resolve('.cache/candidate/user-data'), '--extensions-dir', path.resolve('.cache/candidate/extensions'), '--install-extension', `ms-python.vscode-pylance@${version}`, '--force'], { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('error', reject); child.on('exit', resolve);
});
if (code !== 0) process.exitCode = 1;
