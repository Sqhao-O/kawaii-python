import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlocks, fingerprint, messages, patchSource, replaceTable, validateCatalog } from '../src/core/messages';
import { loadAssets } from '../src/core/engine';

const table = { Diagnostic: { missing: '未定义“{name}”', quote: '换行\n"引号"\\反斜杠 {type}' }, DiagnosticAddendum: { detail: '类型“{type}”' }, Completion: { keep: '保留' } };
const catalog = { 'Diagnostic.missing': '笨蛋！「{name}」还没定义啦', 'Diagnostic.quote': '另一行\n\'引号\'\\ {type}', 'DiagnosticAddendum.detail': '类型为「{type}」哦' };
test('AST replacement preserves everything outside the literal and all unrelated messages', () => {
  const original = `/* 中文 */const a=JSON.parse(${JSON.stringify(JSON.stringify(table))});const unrelated='原样';`;
  const before = extractBlocks(original)[0], result = patchSource(original, fingerprint(table), catalog), after = extractBlocks(result.source)[0];
  assert.equal(result.source.slice(0, after.start), original.slice(0, before.start));
  assert.equal(result.source.slice(after.end), original.slice(before.end));
  assert.deepEqual(after.table.Completion, table.Completion);
  assert.deepEqual(messages(after.table), catalog);
});
test('malformed code, duplicate target tables and incompatible placeholders fail closed', () => {
  assert.throws(() => extractBlocks('const broken = '));
  const source = `JSON.parse(${JSON.stringify(JSON.stringify(table))});`;
  assert.throws(() => patchSource(source + source, fingerprint(table), catalog), /实际匹配 2/);
  assert.throws(() => replaceTable(table, { ...catalog, 'Diagnostic.missing': '{unknown}' }), /占位符/);
  assert.throws(() => replaceTable(table, { ...catalog, 'Diagnostic.missing': '{name} {name}' }), /占位符/);
  assert.throws(() => replaceTable(table, { ...catalog, 'Diagnostic.quote': '{type}' }), /换行/);
  assert.throws(() => validateCatalog(messages(table), { ...catalog, extra: '未知' }), /消息键/);
});
test('multiple locales, comments, dynamic expressions and similarly named calls are not confused', () => {
  const en = { ...table, Diagnostic: { missing: 'not defined {name}', quote: 'English {type}\n' } };
  const source = `// JSON.parse('pretend')\nfoo.JSON.parse('no');JSON['parse']('no');JSON.parse(dynamic);JSON.parse(${JSON.stringify(JSON.stringify(en))});JSON.parse(${JSON.stringify(JSON.stringify(table))});`;
  const result = patchSource(source, fingerprint(table), catalog);
  assert.equal(extractBlocks(result.source)[0].hash, fingerprint(en));
  assert.equal(extractBlocks(result.source)[1].hash, result.patchedTableHash);
});
test('release catalog covers all 838 messages and preserves all placeholders, newlines and links', async () => {
  const a = await loadAssets(process.cwd());
  assert.equal(Object.keys(a.catalog).length, 838);
  assert.equal(Object.keys(a.catalog).filter(k => k.startsWith('Diagnostic.')).length, 665);
  assert.equal(Object.keys(a.catalog).filter(k => k.startsWith('DiagnosticAddendum.')).length, 173);
  assert.equal(Object.keys(a.original).filter(k => a.original[k] === a.catalog[k]).length, 0);
  assert.match(a.catalog['Diagnostic.symbolIsPossiblyUnbound'], /可能/);
  assert.match(a.catalog['Diagnostic.yieldWithinComprehension'], /不允许/);
});
