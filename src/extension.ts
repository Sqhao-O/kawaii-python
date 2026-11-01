import * as vscode from 'vscode';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Assets, loadAssets, PatchEngine } from './core/engine';

const session = randomUUID();
const stateNames = { original: '未启用', patched: '已启用', outdated: '词库待更新', unsupported: '不兼容', conflict: '不兼容', recovery: '需要恢复' };
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Kawaii Python');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  statusBar.command = 'kawaiiPython.check';
  const log = (message: string) => output.appendLine(`[${new Date().toISOString()}] ${message}`);
  let assets: Assets;
  try { assets = await loadAssets(context.extensionPath); }
  catch (e) { log(String(e)); await vscode.window.showErrorMessage(`Kawaii Python 资源校验失败：${(e as Error).message}`); return; }
  let watchers: fs.FSWatcher[] = [], timer: NodeJS.Timeout | undefined, disposed = false;
  let queue: Promise<void> = Promise.resolve();
  let watchedRoot = '';
  const enqueue = (fn: () => Promise<void>) => {
    const next = queue.then(fn).catch(async e => {
      const message = e instanceof Error ? e.message : String(e);
      log(message); render('操作失败', message, true);
      await vscode.window.showErrorMessage(`Kawaii Python：${message}`, '显示日志').then(choice => { if (choice) output.show(); });
    });
    queue = next;
    return next;
  };
  function render(label: string, detail: string, warning = false) {
    statusBar.text = `${warning ? '$(warning)' : '$(heart)'} Python：${label}`;
    statusBar.tooltip = detail;
    statusBar.show();
  }
  function languageIssue(): string | undefined {
    if (vscode.env.remoteName || vscode.env.uiKind !== vscode.UIKind.Desktop) return '首版仅支持本地桌面 VS Code，远程和浏览器环境尚未验证';
    if (vscode.env.language.toLowerCase() !== 'zh-cn') return '请将 VS Code 显示语言设为简体中文，并重载窗口';
    const scopes = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [undefined];
    if (scopes.some(uri => vscode.workspace.getConfiguration('python.analysis', { uri, languageId: 'python' }).get<boolean>('displayEnglishDiagnostics'))) return '请关闭 python.analysis.displayEnglishDiagnostics，插件不会自动改动设置';
    return undefined;
  }
  async function engine(): Promise<PatchEngine | undefined> {
    const pylance = vscode.extensions.getExtension('ms-python.vscode-pylance');
    if (!pylance) { render('未安装 Pylance', '请先安装官方 Pylance'); return; }
    return PatchEngine.open(pylance.extensionPath, assets);
  }
  function watch(e: PatchEngine) {
    if (watchedRoot === e.root) return;
    watchedRoot = e.root;
    watchers.forEach(w => w.close()); watchers = [];
    // Watch the parent of each bundle, so atomic replacement does not detach the watcher.
    for (const folder of [e.root, `${e.root}/dist`]) {
      try { watchers.push(fs.watch(folder, (_event, filename) => {
        if (!filename || filename === 'package.json' || assets.compatibility.versions[e.version]?.files.some(f => f.path.endsWith('/' + filename))) schedule();
      })); } catch (error) { log(`文件监听不可用；仍将在下次激活或手动检查时检测：${String(error)}`); }
    }
  }
  async function notifyReload() {
    const choice = await vscode.window.showInformationMessage('可爱文案已写入。重载窗口后，Pylance 将使用新文案；其他引用同一安装的窗口也需要重载。', '重载窗口');
    if (choice) await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
  async function refresh(automatic = false, verbose = false): Promise<void> {
    if (disposed) return;
    const issue = languageIssue();
    if (vscode.env.remoteName || vscode.env.uiKind !== vscode.UIKind.Desktop) { render('不支持此环境', issue!, true); return; }
    const e = await engine(); if (!e) return;
    watch(e);
    let inspection = await e.inspect();
    if (inspection.status === 'recovery') { log('恢复未完成的事务'); await e.recover(); inspection = await e.inspect(); }
    if (issue) { render('语言设置待调整', issue, true); if (verbose) await vscode.window.showWarningMessage(issue); return; }
    const enabled = context.globalState.get<boolean>('enabled', false);
    if (automatic && enabled && await e.automationEnabled() && vscode.workspace.getConfiguration('kawaiiPython').get<boolean>('autoApplyUpdates', true) && ['original', 'outdated'].includes(inspection.status)) {
      const result = await e.apply({ automatic: true });
      if (result.changed) {
        await context.globalState.update('pending', { root: e.root, session });
        log(`自动应用：Pylance ${e.version}，词库 ${assets.catalogVersion}，${result.count} 条`);
        inspection = await e.inspect();
        void notifyReload();
      }
    }
    const pending = context.globalState.get<{ root: string; session: string; action?: string }>('pending');
    let label = stateNames[inspection.status];
    if (pending?.root === e.root) {
      if (pending.session !== session) await context.globalState.update('pending', undefined);
      else if (inspection.status === 'patched') label = '已应用待重载';
      else if (inspection.status === 'original' && pending.action === 'restore') label = '原版待重载';
    }
    const detail = `Pylance ${e.version} · 词库 ${assets.catalogVersion}\n${inspection.reason ?? `${inspection.count ?? 0} 条诊断；${label}`}\n安装：${e.root}`;
    render(label, detail, ['unsupported', 'conflict', 'recovery'].includes(inspection.status));
    if (verbose) { log(detail); output.show(true); await vscode.window.showInformationMessage(`Kawaii Python：${label}。Pylance ${e.version}；词库 ${assets.catalogVersion}。${inspection.reason ?? ''}`); }
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (!disposed) void enqueue(() => refresh(true)); }, 1500);
  }
  context.subscriptions.push(output, statusBar,
    vscode.commands.registerCommand('kawaiiPython.enable', () => enqueue(async () => {
      const issue = languageIssue(); if (issue) throw new Error(issue);
      const e = await engine(); if (!e) return;
      const result = await e.apply({ enableAutomation: true });
      await context.globalState.update('enabled', true);
      if (result.changed) await context.globalState.update('pending', { root: e.root, session });
      log(`启用：Pylance ${e.version}，${result.count} 条，changed=${result.changed}`);
      await refresh();
      if (result.changed) void notifyReload();
    })),
    vscode.commands.registerCommand('kawaiiPython.restore', () => enqueue(async () => {
      await context.globalState.update('enabled', false);
      if (vscode.env.remoteName) throw new Error('请在安装了此补丁的本地窗口恢复');
      const e = await engine(); if (!e) return;
      const result = await e.restore();
      await context.globalState.update('pending', result.changed ? { root: e.root, session, action: 'restore' } : undefined);
      log(`恢复原版：Pylance ${e.version}，changed=${result.changed}`);
      await refresh();
      if (result.changed) {
        render('原版待重载', '已恢复原文件并关闭自动应用，重载后生效');
        void vscode.window.showInformationMessage('已恢复 Pylance 原文件并停用自动应用。重载窗口后生效。', '重载窗口').then(choice => {
          if (choice) return vscode.commands.executeCommand('workbench.action.reloadWindow');
        });
      }
    })),
    vscode.commands.registerCommand('kawaiiPython.check', () => enqueue(() => refresh(false, true))),
    vscode.commands.registerCommand('kawaiiPython.showLogs', () => output.show()),
    vscode.commands.registerCommand('kawaiiPython.reload', () => vscode.commands.executeCommand('workbench.action.reloadWindow')),
    vscode.extensions.onDidChange(schedule),
    vscode.workspace.onDidChangeWorkspaceFolders(schedule),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('python.analysis.displayEnglishDiagnostics') || e.affectsConfiguration('kawaiiPython')) schedule(); }),
    { dispose() { disposed = true; if (timer) clearTimeout(timer); watchers.forEach(w => w.close()); } }
  );
  await enqueue(() => refresh(true));
}
