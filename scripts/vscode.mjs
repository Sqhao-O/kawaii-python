import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

export async function testExecutable(version = 'stable') {
  if (process.env.KAWAII_VSCODE_EXECUTABLE) return process.env.KAWAII_VSCODE_EXECUTABLE;
  const executable = await downloadAndUnzipVSCode(version);
  try { await fs.access(executable); return executable; }
  catch {
    // Some recent macOS distributions name the executable Code instead of Electron.
    const alternate = path.join(path.dirname(executable), 'Code');
    if (process.platform === 'darwin') { await fs.access(alternate); return alternate; }
    throw new Error('下载的 VS Code 中找不到可执行文件');
  }
}
export function testCli(executable, platform = process.platform) {
  if (platform === 'win32') {
    // Run the same CLI entry as code.cmd without a shell or string interpolation.
    return { executable, args: [path.win32.join(path.win32.dirname(executable), 'resources/app/out/cli.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
  return { executable: cli, args, env: {} };
}
