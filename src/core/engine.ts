import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Catalog, extractBlocks, fingerprint, messages, patchSource, replaceTable, sha256, validateCatalog } from './messages';

export interface VersionSpec { messageCount: number; files: { path: string; tableHash: string; sha256: string }[] }
export interface Compatibility { schemaVersion: number; adapter: string; versions: Record<string, VersionSpec> }
export interface Assets { compatibility: Compatibility; original: Catalog; catalog: Catalog; catalogVersion: string }
export interface FileRecord { path: string; originalHash: string; patchedHash: string; backup: string }
interface State { schemaVersion: 1; root: string; version: string; catalogVersion: string; catalogHash: string; files: FileRecord[] }
interface Transaction { state: State; previousState: State | null; before: { path: string; hash: string; copy: string }[] }
export type Inspection = { status: 'original' | 'patched' | 'outdated' | 'unsupported' | 'conflict' | 'recovery'; version: string; reason?: string; count?: number };
export interface EngineHooks { afterWrite?: (index: number) => Promise<void> }
const exists = async (file: string) => { try { await fs.access(file); return true; } catch (e: any) { if (e.code === 'ENOENT') return false; throw e; } };
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, 'utf8'));

export async function loadAssets(root: string): Promise<Assets> {
  const [compatibility, original, lexicon] = await Promise.all([
    readJson<Compatibility>(path.join(root, 'resources/compatibility.json')),
    readJson<Catalog>(path.join(root, 'resources/original.zh-cn.json')),
    readJson<{ version: string; messages: Catalog }>(path.join(root, 'resources/catalog.zh-cn.json'))
  ]);
  if (compatibility.schemaVersion !== 1 || compatibility.adapter !== 'json-parse-v1') throw new Error('不支持的兼容清单格式');
  validateCatalog(original, lexicon.messages);
  for (const spec of Object.values(compatibility.versions)) {
    if (spec.messageCount !== Object.keys(original).length || !spec.files.length || new Set(spec.files.map(f => f.path)).size !== spec.files.length) throw new Error('兼容清单消息数量或文件集合无效');
  }
  return { compatibility, original, catalog: lexicon.messages, catalogVersion: lexicon.version };
}

// Atomic at one-file granularity. The journal provides recovery across multiple files.
export async function atomicWrite(file: string, data: string | Buffer, mode?: number): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', mode ?? 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    if (mode !== undefined) await fs.chmod(temporary, mode);
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

export class PatchEngine {
  private constructor(readonly root: string, readonly version: string, readonly storage: string, readonly assets: Assets, private hooks: EngineHooks) {}
  static async open(root: string, assets: Assets, hooks: EngineHooks = {}): Promise<PatchEngine> {
    const realRoot = await fs.realpath(root);
    const pkg = await readJson<{ name: string; publisher: string; version: string }>(path.join(realRoot, 'package.json'));
    if (pkg.name !== 'vscode-pylance' || pkg.publisher !== 'ms-python') throw new Error('目标不是官方 Pylance 扩展目录');
    const storage = path.join(path.dirname(realRoot), '.kawaii-python-diagnostics', sha256(realRoot));
    return new PatchEngine(realRoot, pkg.version, storage, assets, hooks);
  }
  private get stateFile() { return path.join(this.storage, 'state.json'); }
  private get journalFile() { return path.join(this.storage, 'transaction.json'); }
  private get lockPath() { return this.storage + '.lock'; }
  private get controlFile() { return path.join(path.dirname(this.storage), 'control.json'); }
  async automationEnabled(): Promise<boolean> {
    if (!await exists(this.controlFile)) return false;
    const control = await readJson<{ enabled: boolean }>(this.controlFile);
    return control.enabled === true;
  }
  private async target(relative: string): Promise<string> {
    if (!relative.startsWith('dist/') || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..') || !relative.endsWith('.js')) throw new Error('目标文件路径无效');
    const file = path.join(this.root, relative);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file) throw new Error(`拒绝非普通文件或符号链接：${relative}`);
    return file;
  }
  private async identity(): Promise<void> {
    const pkg = await readJson<{ name: string; publisher: string; version: string }>(path.join(this.root, 'package.json'));
    if (pkg.version !== this.version || pkg.publisher !== 'ms-python' || pkg.name !== 'vscode-pylance') throw new Error('Pylance 安装正在变化，请稍后重试');
  }
  private async state(): Promise<State | undefined> {
    if (!await exists(this.stateFile)) return;
    const state = await readJson<State>(this.stateFile);
    if (state.schemaVersion !== 1 || state.root !== this.root || state.version !== this.version) throw new Error('备份属于其他安装或版本，请重新安装当前 Pylance 后再启用');
    const spec = this.assets.compatibility.versions[this.version];
    if (!spec || JSON.stringify(state.files.map(f => f.path).sort()) !== JSON.stringify(spec.files.map(f => f.path).sort())) throw new Error('备份文件集合不匹配');
    for (const f of state.files) {
      if (!/^[a-f0-9]{64}$/.test(f.originalHash) || !/^[a-f0-9]{64}$/.test(f.patchedHash) || f.backup !== `${f.originalHash}.original`) throw new Error('备份记录无效');
    }
    return state;
  }
  private async original(record: FileRecord): Promise<Buffer> {
    const data = await fs.readFile(path.join(this.storage, record.backup));
    if (sha256(data) !== record.originalHash) throw new Error(`原始备份校验失败：${record.path}`);
    return data;
  }
  async inspect(): Promise<Inspection> {
    const spec = this.assets.compatibility.versions[this.version];
    if (!spec) return { status: 'unsupported', version: this.version, reason: '此 Pylance 版本尚未验证，未修改任何文件' };
    try {
      await this.identity();
      if (await exists(this.journalFile)) return { status: 'recovery', version: this.version, reason: '检测到未完成事务，需要先恢复' };
      const state = await this.state();
      let originalCount = 0, patchedCount = 0;
      for (const f of spec.files) {
        const data = await fs.readFile(await this.target(f.path));
        const record = state?.files.find(r => r.path === f.path);
        if (record && sha256(data) === record.patchedHash) {
          await this.original(record);
          patchedCount++;
        } else {
          if (record && sha256(data) !== record.originalHash) throw new Error(`文件被其他工具修改：${f.path}`);
          if (sha256(data) !== f.sha256) throw new Error(`原文件哈希不匹配（未知构建或外部修改）：${f.path}`);
          const blocks = extractBlocks(data.toString('utf8')).filter(b => b.hash === f.tableHash);
          if (blocks.length !== 1 || fingerprint(messages(blocks[0].table)) !== fingerprint(this.assets.original)) throw new Error(`消息表结构或指纹不匹配：${f.path}`);
          originalCount++;
        }
      }
      if (originalCount === spec.files.length) return { status: 'original', version: this.version, count: spec.messageCount };
      if (patchedCount === spec.files.length) return { status: state?.catalogVersion === this.assets.catalogVersion && state.catalogHash === fingerprint(this.assets.catalog) ? 'patched' : 'outdated', version: this.version, count: spec.messageCount };
      throw new Error('文件处于部分修改状态，请先恢复或重新安装 Pylance');
    } catch (error) { return { status: 'conflict', version: this.version, reason: String((error as Error).message) }; }
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    await fs.mkdir(path.dirname(this.storage), { recursive: true });
    const token = randomUUID();
    try { await fs.mkdir(this.lockPath); }
    catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      const observedStat = await fs.stat(this.lockPath);
      // Never steal a lock held by a live process. Dead owners are recoverable immediately.
      let stale = false, observedToken: string | undefined;
      try {
        const owner = await readJson<{ pid: number; token: string }>(path.join(this.lockPath, 'owner.json'));
        observedToken = owner.token;
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid owner');
        try { process.kill(owner.pid, 0); } catch (err: any) { if (err.code === 'ESRCH') stale = true; }
      } catch { stale = Date.now() - observedStat.mtimeMs > 120000; }
      if (!stale) throw new Error('另一个窗口正在处理此 Pylance 安装，请稍后重试');
      // Only one contender may reclaim this particular lock; recheck its identity
      // after acquiring the claim, since another owner may have replaced it.
      const claimPath = path.join(this.lockPath, 'recovery-claim');
      let claim;
      try { claim = await fs.open(claimPath, 'wx'); } catch { throw new Error('锁恢复正在进行，请稍后重试'); }
      let sameOwner = false;
      try {
        const currentStat = await fs.stat(this.lockPath);
        if (currentStat.ino !== observedStat.ino || currentStat.dev !== observedStat.dev) throw new Error('锁目录已经变化');
        try {
          const current = await readJson<{ token: string }>(path.join(this.lockPath, 'owner.json'));
          sameOwner = current.token === observedToken;
        } catch { sameOwner = observedToken === undefined && stale; }
      } finally { await claim.close(); }
      if (!sameOwner) { await fs.rm(claimPath, { force: true }); throw new Error('锁持有者发生变化，请重试'); }
      const abandoned = this.lockPath + '.' + token;
      try { await fs.rename(this.lockPath, abandoned); } catch { throw new Error('锁状态变化，请重试'); }
      await fs.rm(abandoned, { recursive: true, force: true });
      await fs.mkdir(this.lockPath);
    }
    try {
      await fs.writeFile(path.join(this.lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
      await fs.mkdir(this.storage, { recursive: true });
      await this.identity();
      return await operation();
    } finally {
      let owner: { token: string } | undefined;
      try { owner = await readJson(path.join(this.lockPath, 'owner.json')); } catch { /* retain incomplete lock for stale handling */ }
      if (owner?.token === token) await fs.rm(this.lockPath, { recursive: true, force: true });
    }
  }
  private async recoverUnlocked(): Promise<boolean> {
    if (!await exists(this.journalFile)) return false;
    const transaction = await readJson<Transaction>(this.journalFile);
    if (transaction.state.root !== this.root || transaction.state.version !== this.version || transaction.state.schemaVersion !== 1) throw new Error('事务版本不符，拒绝将旧备份写入新安装');
    const spec = this.assets.compatibility.versions[this.version];
    if (!spec || transaction.before.length !== spec.files.length || transaction.state.files.length !== spec.files.length || new Set(transaction.before.map(f => f.path)).size !== spec.files.length) throw new Error('事务文件集合不匹配');
    const rollback: { file: string; data: Buffer; currentHash: string }[] = [];
    for (const entry of transaction.before) {
      if (!spec.files.some(f => f.path === entry.path) || !/^[a-f0-9]{64}$/.test(entry.hash) || entry.copy !== `${entry.hash}.rollback`) throw new Error('事务路径或哈希无效');
      const record = transaction.state.files.find(f => f.path === entry.path);
      if (!record) throw new Error('事务缺少文件记录');
      const file = await this.target(entry.path), current = await fs.readFile(file), hash = sha256(current);
      const allowed = [entry.hash, record.originalHash, record.patchedHash];
      if (!allowed.includes(hash)) throw new Error(`恢复被阻止：${entry.path} 已被外部修改，请重新安装 Pylance`);
      const data = await fs.readFile(path.join(this.storage, entry.copy));
      if (sha256(data) !== entry.hash) throw new Error('事务备份校验失败');
      rollback.push({ file, data, currentHash: hash });
    }
    for (const r of rollback) {
      await this.identity();
      if (sha256(await fs.readFile(r.file)) !== r.currentHash) throw new Error('恢复期间文件发生变化');
      if (r.currentHash !== sha256(r.data)) await atomicWrite(r.file, r.data, (await fs.stat(r.file)).mode);
    }
    if (transaction.previousState) {
      if (transaction.previousState.root !== this.root || transaction.previousState.version !== this.version) throw new Error('旧事务状态不匹配');
      await atomicWrite(this.stateFile, JSON.stringify(transaction.previousState, null, 2));
    } else await fs.rm(this.stateFile, { force: true });
    await fs.rm(this.journalFile);
    return true;
  }
  async recover(): Promise<boolean> { return this.locked(() => this.recoverUnlocked()); }
  async apply(options: { automatic?: boolean; enableAutomation?: boolean } = {}): Promise<{ changed: boolean; count: number }> {
    return this.locked(async () => {
      await this.recoverUnlocked();
      if (options.automatic && !await this.automationEnabled()) return { changed: false, count: 0 };
      const status = await this.inspect();
      if (status.status === 'patched') {
        if (options.enableAutomation) await atomicWrite(this.controlFile, JSON.stringify({ enabled: true }));
        return { changed: false, count: status.count! };
      }
      if (!['original', 'outdated'].includes(status.status)) throw new Error(status.reason ?? '当前状态不能应用补丁');
      const spec = this.assets.compatibility.versions[this.version], old = await this.state();
      const prepared: { file: string; before: Buffer; after: Buffer; record: FileRecord }[] = [];
      for (const f of spec.files) {
        const file = await this.target(f.path), before = await fs.readFile(file), prior = old?.files.find(r => r.path === f.path);
        const original = prior ? await this.original(prior) : before;
        const result = patchSource(original.toString('utf8'), f.tableHash, this.assets.catalog);
        const after = Buffer.from(result.source);
        const originalHash = sha256(original), backup = `${originalHash}.original`;
        const backupFile = path.join(this.storage, backup);
        if (!await exists(backupFile)) await atomicWrite(backupFile, original);
        else if (sha256(await fs.readFile(backupFile)) !== originalHash) throw new Error('已有备份损坏');
        prepared.push({ file, before, after, record: { path: f.path, originalHash, patchedHash: sha256(after), backup } });
      }
      const state: State = { schemaVersion: 1, root: this.root, version: this.version, catalogVersion: this.assets.catalogVersion, catalogHash: fingerprint(this.assets.catalog), files: prepared.map(p => p.record) };
      await this.commit(state, prepared);
      if (options.enableAutomation) await atomicWrite(this.controlFile, JSON.stringify({ enabled: true }));
      return { changed: true, count: spec.messageCount };
    });
  }
  async restore(): Promise<{ changed: boolean }> {
    return this.locked(async () => {
      // Shared across Profiles and versions in this extension directory: another
      // enabled window must not immediately undo the user's restore command.
      await atomicWrite(this.controlFile, JSON.stringify({ enabled: false }));
      await this.recoverUnlocked();
      const state = await this.state();
      if (!state) {
        const status = await this.inspect();
        if (status.status !== 'original') throw new Error(status.reason ?? '没有可用的原始备份');
        return { changed: false };
      }
      const prepared = [];
      for (const record of state.files) {
        const file = await this.target(record.path), before = await fs.readFile(file), hash = sha256(before);
        if (hash !== record.patchedHash && hash !== record.originalHash) throw new Error(`拒绝恢复外部修改文件：${record.path}`);
        prepared.push({ file, before, after: await this.original(record), record });
      }
      await this.commit(state, prepared, true);
      return { changed: prepared.some(p => !p.before.equals(p.after)) };
    });
  }
  private async commit(state: State, prepared: { file: string; before: Buffer; after: Buffer; record: FileRecord }[], restoring = false): Promise<void> {
    const before = [];
    for (const p of prepared) {
      const hash = sha256(p.before), copy = `${hash}.rollback`;
      await atomicWrite(path.join(this.storage, copy), p.before);
      before.push({ path: p.record.path, hash, copy });
    }
    const previousState = await this.state() ?? null;
    await atomicWrite(this.journalFile, JSON.stringify({ state, before, previousState } satisfies Transaction));
    try {
      for (const [index, p] of prepared.entries()) {
        await this.identity();
        await this.target(p.record.path);
        if (sha256(await fs.readFile(p.file)) !== sha256(p.before)) throw new Error(`写入前文件发生变化：${p.record.path}`);
        if (!p.before.equals(p.after)) await atomicWrite(p.file, p.after, (await fs.stat(p.file)).mode);
        if (sha256(await fs.readFile(p.file)) !== sha256(p.after)) throw new Error('写入后文件校验失败');
        await this.hooks.afterWrite?.(index);
      }
      if (!restoring) await atomicWrite(this.stateFile, JSON.stringify(state, null, 2));
      await fs.rm(this.journalFile);
    } catch (error) {
      try { await this.recoverUnlocked(); } catch (recoveryError) { throw new Error(`${(error as Error).message}；需恢复：${(recoveryError as Error).message}`); }
      throw error;
    }
  }
}
