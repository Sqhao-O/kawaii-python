import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import spawn from 'cross-spawn';
import assert from 'node:assert/strict';
import { testExecutable, testCli } from './vscode.mjs';
import { build } from 'esbuild';

const project = process.cwd();
const extensionManifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
const extensionId = `${extensionManifest.publisher}.${extensionManifest.name}`;
const root = path.resolve(process.env.KAWAII_TEST_ROOT || '.cache/e2e');
const extensions = path.join(root, 'extensions'), userData = path.join(root, 'user-data');
const version = process.env.KAWAII_PYLANCE_VERSION || '2026.4.1';
const vscode = await testExecutable(process.env.KAWAII_VSCODE_VERSION || 'stable');
await fs.mkdir(extensions, { recursive: true });
await fs.mkdir(path.join(userData, 'User'), { recursive: true });
await fs.mkdir(path.join(root, 'workspace/.vscode'), { recursive: true });
const cliSpec = testCli(vscode), cli = cliSpec.executable, cliArgs = cliSpec.args;
let developmentPath = project;
async function run(executable, args, env = {}, log) {
  const chunks = [];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('VS Code 集成测试超时')); }, 180000);
    child.stdout.on('data', d => chunks.push(d)); child.stderr.on('data', d => chunks.push(d));
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timeout); resolve(code); });
  });
  const output = Buffer.concat(chunks).toString();
  if (log) await fs.writeFile(log, output);
  if (result !== 0) {
    let diagnostic = '';
    if (process.platform === 'win32' && executable === cli) {
      try { diagnostic = '\nOfficial wrapper:\n' + await fs.readFile(cli, 'utf8'); } catch { /* original error remains authoritative */ }
    }
    throw new Error(`执行失败（${result}）：${output.slice(-5000)}${diagnostic}`);
  }
}
// A developer can provide an existing extension directory; it is copied, never patched in place.
if (process.env.KAWAII_LOCAL_EXTENSIONS) {
  for (const entry of await fs.readdir(process.env.KAWAII_LOCAL_EXTENSIONS)) {
    if (/^(ms-python\.(vscode-pylance|python-|vscode-python-envs)|ms-ceintl\.vscode-language-pack-zh-hans|usernamehw\.errorlens)/.test(entry)) {
      await fs.cp(path.join(process.env.KAWAII_LOCAL_EXTENSIONS, entry), path.join(extensions, entry), { recursive: true, force: true });
    }
  }
} else {
  for (const id of [`ms-python.vscode-pylance@${version}`, 'ms-python.python', 'ms-ceintl.vscode-language-pack-zh-hans', 'usernamehw.errorlens']) {
    await run(cli, [...cliArgs, '--user-data-dir', userData, '--extensions-dir', extensions, '--install-extension', id, '--force'], cliSpec.env);
  }
}
if (process.env.KAWAII_REQUIRE_ERRORLENS === '1' && !(await fs.readdir(extensions)).some(n => n.startsWith('usernamehw.errorlens'))) {
  await run(cli, [...cliArgs, '--user-data-dir', userData, '--extensions-dir', extensions, '--install-extension', 'usernamehw.errorlens', '--force'], cliSpec.env);
}
if (process.env.KAWAII_VSIX) {
  await run(cli, [...cliArgs, '--user-data-dir', userData, '--extensions-dir', extensions, '--install-extension', path.resolve(process.env.KAWAII_VSIX), '--force'], cliSpec.env);
  developmentPath = path.join(root, 'test-host');
  await fs.mkdir(developmentPath, { recursive: true });
  await fs.writeFile(path.join(developmentPath, 'package.json'), JSON.stringify({ name: 'kawaii-test-host', publisher: 'test', version: '0.0.1', engines: { vscode: '^1.107.0' } }));
}
await fs.writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'extensions.autoUpdate': false, 'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none', 'chat.disableAIFeatures': true }));
await fs.writeFile(path.join(root, 'workspace/.vscode/settings.json'), JSON.stringify({ 'python.analysis.typeCheckingMode': 'basic', 'python.analysis.displayEnglishDiagnostics': false, 'python.defaultInterpreterPath': process.env.KAWAII_PYTHON || (process.platform === 'win32' ? 'python' : '/usr/bin/python3'), 'errorLens.enabledDiagnosticLevels': ['error', 'warning', 'info', 'hint'] }));
await fs.writeFile(path.join(root, 'workspace/sample.py'), 'import os\nimport kawaii_missing_module\n\ndef greet(age: int) -> int:\n    return age\n\ngreet("hello")\ngreet()\nprint(kawaii_missing)\nanswer: int = "oops"\n');
await fs.writeFile(path.join(root, 'workspace/syntax.py'), 'if True\n    print("missing colon")\n');
await fs.writeFile(path.join(root, 'workspace/indent.py'), 'if True:\nprint("indent me")\n');
await fs.writeFile(path.join(root, 'workspace/bracket.py'), 'items = [1, 2\n');
await fs.writeFile(path.join(root, 'workspace/version.py'), 'def f[T](value: T) -> T:\n    return value\n');
await fs.writeFile(path.join(root, 'workspace/pyrightconfig.json'), JSON.stringify({ pythonVersion: '3.11', typeCheckingMode: 'basic' }));
await build({ entryPoints: ['src/core/engine.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'engine.cjs') });
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url), { loadAssets, PatchEngine } = require(path.join(root, 'engine.cjs'));
const assets = await loadAssets(project);
const installed = [];
for (const dir of await fs.readdir(extensions)) {
  try { const pkg = JSON.parse(await fs.readFile(path.join(extensions, dir, 'package.json'), 'utf8')); if (pkg.publisher === 'ms-python' && pkg.name === 'vscode-pylance' && pkg.version === version) installed.push(path.join(extensions, dir)); } catch { /* not an extension */ }
}
assert.equal(installed.length, 1, `预期唯一 Pylance ${version}`);
const engine = await PatchEngine.open(installed[0], assets);
if ((await engine.inspect()).status !== 'original') await engine.restore();
async function phase(name) {
  console.log(`集成测试：${name}`);
  const launch = ['--user-data-dir', userData, '--extensions-dir', extensions, `--extensionDevelopmentPath=${developmentPath}`, `--extensionTestsPath=${path.join(project, 'tests/integration/suite.cjs')}`, '--locale=zh-cn', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'];
  if (process.platform === 'linux') launch.push('--no-sandbox', '--disable-gpu');
  launch.push(path.join(root, 'workspace'));
  await run(vscode, launch, { KAWAII_E2E_ROOT: root, KAWAII_E2E_PHASE: name, KAWAII_E2E_EXTENSION_ID: extensionId }, path.join(root, `${name}.log`));
}
await phase('warmup'); // A language pack's first startup can still initialize in English.
await phase('reset');
await phase('baseline');
await phase('enable');
assert.equal((await engine.inspect()).status, 'patched');
await phase('patched');
await phase('restore');
assert.equal((await engine.inspect()).status, 'original');
await phase('restored');
const snapshots = {};
for (const p of ['baseline', 'patched', 'restored']) snapshots[p] = JSON.parse(await fs.readFile(path.join(root, p + '.json'), 'utf8'));
const metadata = s => Object.fromEntries(Object.entries(s.documents).map(([file, ds]) => [file, ds.map(({ message, ...rest }) => rest)]));
assert.deepEqual(metadata(snapshots.baseline), metadata(snapshots.patched));
assert.deepEqual(snapshots.baseline.documents, snapshots.restored.documents);
assert.deepEqual(snapshots.baseline.actions, snapshots.patched.actions);
assert.deepEqual(snapshots.baseline.completions, snapshots.patched.completions);
assert.deepEqual(snapshots.baseline.definitions, snapshots.patched.definitions);
assert.deepEqual(snapshots.baseline.rename, snapshots.patched.rename);
assert.ok(snapshots.patched.documents['sample.py'].every((d, i) => d.message !== snapshots.baseline.documents['sample.py'][i].message));
assert.equal(snapshots.patched.fixedErrors, 0);
if (process.env.KAWAII_REQUIRE_ERRORLENS === '1') assert.equal(snapshots.patched.errorLensActive, true);
const report = { platform: os.platform(), arch: os.arch(), pylance: version, vscode, catalogVersion: assets.catalogVersion, packageUnderTest: process.env.KAWAII_VSIX || null, passed: true, scenarios: Object.keys(snapshots.patched.documents), nativeUiManuallyVerified: false, errorLensActive: snapshots.patched.errorLensActive, snapshots };
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile(`artifacts/${process.env.KAWAII_VSIX ? 'package-' : ''}integration-${process.platform}.json`, JSON.stringify(report, null, 2) + '\n');
console.log('PASS：原生诊断文本已替换，位置/规则/Quick Fix/补全/跳转/重命名保持一致；恢复后诊断完全一致。');
