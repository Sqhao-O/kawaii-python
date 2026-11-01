import fs from 'node:fs/promises';
import path from 'node:path';
import { loadAssets, PatchEngine } from '../src/core/engine';
import { Catalog, extractBlocks, fingerprint, messages, patchSource, placeholders, sha256 } from '../src/core/messages';

async function main() {
  const command = process.argv[2], assets = await loadAssets(process.cwd());
  if (command === 'validate') {
    console.log(`词库 ${assets.catalogVersion}：${Object.keys(assets.catalog).length} 条，消息键、占位符、换行、链接均通过校验`);
    return;
  }
  if (command === 'upstream') {
    const response = await fetch('https://raw.githubusercontent.com/microsoft/pylance-release/main/CHANGELOG.md');
    if (!response.ok) throw new Error(`上游更新记录请求失败：HTTP ${response.status}`);
    const text = await response.text();
    const latest = [...text.matchAll(/^## (\d+\.\d+\.\d+) \([^\n]+\) Release\s*$/gm)][0]?.[1];
    if (!latest) throw new Error('无法识别上游稳定版本，更新记录格式可能变化');
    const report = { checkedAt: new Date().toISOString(), latest, supported: !!assets.compatibility.versions[latest], testedVersions: Object.keys(assets.compatibility.versions) };
    await fs.mkdir('artifacts', { recursive: true });
    await fs.writeFile('artifacts/upstream.json', JSON.stringify(report, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `latest=${latest}\n`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const root = process.argv[3];
  if (!root) throw new Error('用法：npm run inspect -- <Pylance目录>；或 node --import tsx scripts/maintain.ts extract|diff|dry-run <目录>');
  const engine = await PatchEngine.open(path.resolve(root), assets);
  if (command === 'inspect') { console.log(JSON.stringify(await engine.inspect(), null, 2)); return; }
  const candidates = ['pyright.bundle.js', 'browser.async.bundle.js', 'browser.extension.bundle.js', 'copilot-pyright.bundle.js'];
  const files: { path: string; tableHash: string; sha256: string }[] = [], tables: Catalog[] = [];
  for (const candidate of candidates) {
    const file = path.join(engine.root, 'dist', candidate);
    const source = await fs.readFile(file, 'utf8');
    const blocks = extractBlocks(source).filter(b => {
      const msg = messages(b.table)['Diagnostic.symbolIsUndefined'];
      return msg === assets.original['Diagnostic.symbolIsUndefined'];
    });
    if (blocks.length !== 1) throw new Error(`无法唯一识别中文消息表：${candidate}；需要审查适配器`);
    files.push({ path: `dist/${candidate}`, tableHash: blocks[0].hash, sha256: sha256(source) });
    tables.push(messages(blocks[0].table));
  }
  if (!tables.every(t => fingerprint(t) === fingerprint(tables[0]))) throw new Error('四个包中的消息副本不一致');
  const original = assets.original, candidate = tables[0];
  const added = Object.keys(candidate).filter(k => !(k in original));
  const removed = Object.keys(original).filter(k => !(k in candidate));
  const changed = Object.keys(candidate).filter(k => k in original && candidate[k] !== original[k]);
  const placeholderChanges = changed.filter(k => JSON.stringify(placeholders(candidate[k])) !== JSON.stringify(placeholders(original[k])));
  const report = { version: engine.version, files, messageCount: Object.keys(candidate).length, added, removed, changed, placeholderChanges,
    compatibleMessages: !added.length && !removed.length && !changed.length,
    note: '报告不自动授权新版本；审校差异并完成隔离集成测试后，才更新兼容清单。' };
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/candidate-report.json', JSON.stringify(report, null, 2) + '\n');
  if (command === 'extract') await fs.writeFile('artifacts/candidate-messages.zh-cn.json', JSON.stringify(candidate, null, 2) + '\n');
  else if (command === 'dry-run') {
    const inspection = await engine.inspect();
    if (inspection.status !== 'original') throw new Error(inspection.reason ?? '试运行需要受支持版本的未修改安装');
    const preview = [];
    for (const f of files) {
      const source = await fs.readFile(path.join(engine.root, f.path), 'utf8');
      const result = patchSource(source, f.tableHash, assets.catalog);
      preview.push({ path: f.path, before: sha256(source), after: sha256(result.source), count: result.count });
    }
    await fs.writeFile('artifacts/dry-run.json', JSON.stringify(preview, null, 2) + '\n');
    console.log('补丁已在内存生成和重新解析；未写入 Pylance。');
  }
  else if (!['diff', 'dry-run'].includes(command)) throw new Error(`未知命令：${command}`);
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
