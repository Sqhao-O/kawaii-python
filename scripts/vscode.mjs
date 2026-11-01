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
    // Use the vendor's wrapper: the internal CLI location may change between builds.
    // cross-spawn escapes .cmd invocations on Windows without hand-built shell text.
    const name = path.win32.basename(executable) === 'Code - Insiders.exe' ? 'code-insiders.cmd' : 'code.cmd';
    return { executable: path.win32.join(path.win32.dirname(executable), 'bin', name), args: [], env: {} };
  }
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
  return { executable: cli, args, env: {} };
}
