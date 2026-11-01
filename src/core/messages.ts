import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

export type MessageTable = Record<string, Record<string, string | { message: string; comment?: unknown }>>;
export type Catalog = Record<string, string>;
export const groups = ['Diagnostic', 'DiagnosticAddendum'] as const;
export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const fingerprint = (value: unknown): string => sha256(JSON.stringify(canonical(value)));
export function messages(table: MessageTable): Catalog {
  const result: Catalog = {};
  for (const group of groups) {
    if (!table[group] || typeof table[group] !== 'object') throw new Error(`缺少消息分组：${group}`);
    for (const [key, entry] of Object.entries(table[group])) {
      const value = typeof entry === 'string' ? entry : entry?.message;
      if (typeof value !== 'string') throw new Error(`消息不是字符串：${group}.${key}`);
      result[`${group}.${key}`] = value;
    }
  }
  return result;
}
export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z_][A-Za-z_0-9]*)\}/g)].map(m => m[1]).sort();
}
export function validateCatalog(original: Catalog, catalog: Catalog): void {
  const expected = Object.keys(original).sort();
  if (JSON.stringify(expected) !== JSON.stringify(Object.keys(catalog).sort())) throw new Error('词库消息键不完整或包含未知键');
  for (const key of expected) {
    const value = catalog[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`消息为空：${key}`);
    if (JSON.stringify(placeholders(original[key])) !== JSON.stringify(placeholders(value))) throw new Error(`占位符不匹配：${key}`);
    const structure = (s: string) => s.match(/\r\n|\n|\r/g) ?? [];
    if (JSON.stringify(structure(original[key])) !== JSON.stringify(structure(value))) throw new Error(`换行结构不匹配：${key}`);
    const urls = (s: string) => s.match(/https?:\/\/[^\s)\]>]+/g)?.sort() ?? [];
    if (JSON.stringify(urls(original[key])) !== JSON.stringify(urls(value))) throw new Error(`链接不匹配：${key}`);
  }
}
export interface MessageBlock { start: number; end: number; table: MessageTable; hash: string }
export function extractBlocks(source: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  simple(ast, {
    CallExpression(node: any) {
      const c = node.callee, arg = node.arguments[0];
      if (c.type !== 'MemberExpression' || c.computed || c.object.type !== 'Identifier' || c.object.name !== 'JSON' || c.property.name !== 'parse' || node.arguments.length !== 1 || arg?.type !== 'Literal' || typeof arg.value !== 'string') return;
      let table: MessageTable;
      try { table = JSON.parse(arg.value); } catch { return; }
      if (!table || typeof table !== 'object' || !groups.every(g => table[g] && typeof table[g] === 'object')) return;
      messages(table);
      blocks.push({ start: arg.start, end: arg.end, table, hash: fingerprint(table) });
    }
  });
  return blocks;
}
export function replaceTable(table: MessageTable, catalog: Catalog): MessageTable {
  validateCatalog(messages(table), catalog);
  const next = structuredClone(table);
  for (const group of groups) for (const key of Object.keys(next[group])) {
    const entry = next[group][key];
    if (typeof entry === 'string') next[group][key] = catalog[`${group}.${key}`];
    else entry.message = catalog[`${group}.${key}`];
  }
  return next;
}
export function patchSource(source: string, tableHash: string, catalog: Catalog): { source: string; count: number; patchedTableHash: string } {
  const matches = extractBlocks(source).filter(b => b.hash === tableHash);
  if (matches.length !== 1) throw new Error(`预期唯一消息表，实际匹配 ${matches.length} 份`);
  const b = matches[0], table = replaceTable(b.table, catalog);
  // JSON.stringify twice encodes JSON as a JavaScript string literal; no eval or fragile escaping.
  const result = source.slice(0, b.start) + JSON.stringify(JSON.stringify(table)) + source.slice(b.end);
  const newHash = fingerprint(table);
  if (extractBlocks(result).filter(x => x.hash === newHash).length !== 1) throw new Error('补丁后消息表验证失败');
  return { source: result, count: Object.keys(catalog).length, patchedTableHash: newHash };
}
