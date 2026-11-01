import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Assets, PatchEngine } from '../src/core/engine';
import { fingerprint, messages, sha256 } from '../src/core/messages';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kawaii-python-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'extensions/pylance');
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ publisher: 'ms-python', name: 'vscode-pylance', version: '1.0.0' }));
  const table = { Diagnostic: { missing: '未定义“{name}”' }, DiagnosticAddendum: { bad: '类型错误' } };
  const source = `/* outside */const x=JSON.parse(${JSON.stringify(JSON.stringify(table))});`;
  const files = ['dist/a.js', 'dist/b.js'];
  for (const f of files) { await fs.writeFile(path.join(root, f), source); await fs.chmod(path.join(root, f), 0o644); }
  const assets: Assets = { catalogVersion: 'v1', original: messages(table), catalog: { 'Diagnostic.missing': '「{name}」未定义啦', 'DiagnosticAddendum.bad': '类型不对嘛' }, compatibility: { schemaVersion: 1, adapter: 'json-parse-v1', versions: { '1.0.0': { messageCount: 2, files: files.map(p => ({ path: p, tableHash: fingerprint(table), sha256: sha256(source) })) } } } };
  const engine = await PatchEngine.open(root, assets);
  return { root, assets, engine, source, files, temp };
}
test('apply is idempotent; restores original bytes and permissions; can enable again', async t => {
  const f = await fixture(t);
  const originalMode = (await fs.stat(path.join(f.root, f.files[0]))).mode & 0o777;
  assert.equal((await f.engine.inspect()).status, 'original');
  assert.equal((await f.engine.apply()).changed, true);
  assert.equal((await f.engine.inspect()).status, 'patched');
  assert.equal((await f.engine.apply()).changed, false);
  assert.equal((await fs.stat(path.join(f.root, f.files[0]))).mode & 0o777, originalMode);
  await f.engine.restore();
  for (const p of f.files) assert.equal(await fs.readFile(path.join(f.root, p), 'utf8'), f.source);
  assert.equal((await f.engine.inspect()).status, 'original');
  assert.equal((await f.engine.restore()).changed, false);
  await f.engine.apply();
  assert.equal((await f.engine.inspect()).status, 'patched');
});
test('vocabulary updates rebuild from original backup and roll back to original', async t => {
  const f = await fixture(t); await f.engine.apply();
  const next = await PatchEngine.open(f.root, { ...f.assets, catalogVersion: 'v2', catalog: { ...f.assets.catalog, 'Diagnostic.missing': '「{name}」没定义，笨蛋' } });
  assert.equal((await next.inspect()).status, 'outdated');
  await next.apply(); assert.equal((await next.inspect()).status, 'patched');
  await next.restore(); assert.equal(await fs.readFile(path.join(f.root, f.files[0]), 'utf8'), f.source);
});
test('write failure restores every file and permits retry', async t => {
  const f = await fixture(t);
  const failing = await PatchEngine.open(f.root, f.assets, { afterWrite: async i => { if (i === 0) throw new Error('模拟写入失败'); } });
  await assert.rejects(failing.apply(), /模拟写入失败/);
  for (const p of f.files) assert.equal(await fs.readFile(path.join(f.root, p), 'utf8'), f.source);
  assert.equal((await f.engine.inspect()).status, 'original');
  await f.engine.apply();
});
test('unknown version, modified source and third-party modifications are refused without overwriting', async t => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.root, f.files[0]), '\n// external change');
  assert.equal((await f.engine.inspect()).status, 'conflict');
  await assert.rejects(f.engine.apply(), /哈希/);
  await fs.writeFile(path.join(f.root, f.files[0]), f.source); await f.engine.apply();
  await fs.appendFile(path.join(f.root, f.files[1]), '\n// patched externally');
  const before = await fs.readFile(path.join(f.root, f.files[0]));
  await assert.rejects(f.engine.restore(), /外部修改/);
  assert.deepEqual(await fs.readFile(path.join(f.root, f.files[0])), before);
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ publisher: 'ms-python', name: 'vscode-pylance', version: '2.0.0' }));
  const newer = await PatchEngine.open(f.root, f.assets);
  assert.equal((await newer.inspect()).status, 'unsupported');
  await assert.rejects(newer.restore(), /其他安装或版本/);
});
test('simultaneous windows cannot both acquire an installation lock', async t => {
  const f = await fixture(t);
  let started!: () => void, resume!: () => void;
  const startedPromise = new Promise<void>(r => started = r), resumePromise = new Promise<void>(r => resume = r);
  const first = await PatchEngine.open(f.root, f.assets, { afterWrite: async i => { if (i === 0) { started(); await resumePromise; } } });
  const applying = first.apply(); await startedPromise;
  await assert.rejects(f.engine.apply(), /另一个窗口/); resume(); await applying;
});
test('process interruption leaves a journal; a new process recovers without overwriting an external change', async t => {
  const f = await fixture(t);
  const assetsFile = path.join(f.temp, 'assets.json'); await fs.writeFile(assetsFile, JSON.stringify(f.assets));
  const childScript = path.resolve('tests/fixtures/crash.ts');
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', childScript, f.root, assetsFile], { cwd: process.cwd(), stdio: 'pipe' });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 73);
  assert.equal((await f.engine.inspect()).status, 'recovery');
  await f.engine.recover();
  assert.equal((await f.engine.inspect()).status, 'original');
  for (const p of f.files) assert.equal(await fs.readFile(path.join(f.root, p), 'utf8'), f.source);
});
test('corrupt original backup cannot be used', async t => {
  const f = await fixture(t); await f.engine.apply();
  const state = JSON.parse(await fs.readFile(path.join(f.engine.storage, 'state.json'), 'utf8'));
  await fs.writeFile(path.join(f.engine.storage, state.files[0].backup), 'damaged');
  assert.equal((await f.engine.inspect()).status, 'conflict');
  await assert.rejects(f.engine.restore(), /备份校验失败/);
});
test('symbolic-link bundles are refused', async t => {
  if (process.platform === 'win32') { t.skip('Windows symlink creation requires Developer Mode or elevation'); return; }
  const f = await fixture(t), file = path.join(f.root, f.files[0]), outside = path.join(f.temp, 'outside.js');
  await fs.writeFile(outside, f.source); await fs.rm(file); await fs.symlink(outside, file);
  assert.equal((await f.engine.inspect()).status, 'conflict');
  await assert.rejects(f.engine.apply(), /符号链接/);
  assert.equal(await fs.readFile(outside, 'utf8'), f.source);
});
test('restore disables automatic reapplication across Profiles, and explicit enable reauthorizes it', async t => {
  const f = await fixture(t);
  assert.equal(await f.engine.automationEnabled(), false);
  await f.engine.apply({ enableAutomation: true });
  const other = await PatchEngine.open(f.root, f.assets);
  assert.equal(await other.automationEnabled(), true);
  await other.restore();
  assert.equal(await f.engine.automationEnabled(), false);
  assert.equal((await f.engine.apply({ automatic: true })).changed, false);
  assert.equal((await f.engine.inspect()).status, 'original');
  await f.engine.apply({ enableAutomation: true });
  assert.equal((await other.inspect()).status, 'patched');
});
test('incomplete expired lock is reclaimed; active owner lock is not', async t => {
  const f = await fixture(t), lock = f.engine.storage + '.lock';
  await fs.mkdir(lock, { recursive: true });
  const old = new Date(Date.now() - 180000); await fs.utimes(lock, old, old);
  await f.engine.apply(); assert.equal((await f.engine.inspect()).status, 'patched');
});
test('external changes during crash recovery leave every unrelated file untouched', async t => {
  const f = await fixture(t), assetsFile = path.join(f.temp, 'assets.json'); await fs.writeFile(assetsFile, JSON.stringify(f.assets));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/crash.ts'), f.root, assetsFile], { cwd: process.cwd(), stdio: 'pipe' });
    child.on('error', reject); child.on('exit', () => resolve());
  });
  await fs.appendFile(path.join(f.root, f.files[0]), '\n// external after crash');
  await assert.rejects(f.engine.recover(), /外部修改/);
  assert.equal(await fs.readFile(path.join(f.root, f.files[1]), 'utf8'), f.source);
  assert.equal((await f.engine.inspect()).status, 'recovery');
});
test('message changes without a vocabulary version bump still require rebuilding', async t => {
  const f = await fixture(t); await f.engine.apply();
  const changed = await PatchEngine.open(f.root, { ...f.assets, catalog: { ...f.assets.catalog, 'Diagnostic.missing': '没定义「{name}」，笨蛋' } });
  assert.equal((await changed.inspect()).status, 'outdated');
  await changed.apply(); assert.equal((await changed.inspect()).status, 'patched');
});
