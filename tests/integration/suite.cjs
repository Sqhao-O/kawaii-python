const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function stableDiagnostics(uri, requireErrors = true) {
  const deadline = Date.now() + 90000;
  let last = '', same = 0;
  while (Date.now() < deadline) {
    const ds = vscode.languages.getDiagnostics(uri).filter(d => /Pylance|Pyright/i.test(d.source || ''));
    const next = JSON.stringify(ds);
    if (next === last && (!requireErrors || ds.length > 0)) same++; else same = 0;
    if (same >= 4) return ds;
    last = next; await delay(400);
  }
  throw new Error('等待 Pylance 诊断超时：' + uri.fsPath);
}
exports.run = async function () {
  const root = process.env.KAWAII_E2E_ROOT, phase = process.env.KAWAII_E2E_PHASE;
  const doc = await vscode.workspace.openTextDocument(path.join(root, 'workspace/sample.py'));
  await vscode.window.showTextDocument(doc);
  await stableDiagnostics(doc.uri);
  if (phase === 'warmup') return;
  assert.equal(vscode.env.language.toLowerCase(), 'zh-cn');
  await vscode.extensions.getExtension('kawaii-python.kawaii-python-diagnostics').activate();
  if (phase === 'enable' || phase === 'restore' || phase === 'reset') {
    await vscode.commands.executeCommand(phase === 'enable' ? 'kawaiiPython.enable' : 'kawaiiPython.restore');
    return;
  }
  const documents = {};
  for (const filename of ['sample.py', 'syntax.py', 'indent.py', 'bracket.py', 'version.py']) {
    const d = await vscode.workspace.openTextDocument(path.join(root, 'workspace', filename));
    await vscode.window.showTextDocument(d);
    const diagnostics = await stableDiagnostics(d.uri);
    documents[filename] = diagnostics.map(d => ({ message: d.message, range: d.range, severity: d.severity, code: d.code, source: d.source, tags: d.tags, relatedInformation: d.relatedInformation?.map(x => ({ location: x.location })) }));
  }
  await vscode.window.showTextDocument(doc);
  const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', doc.uri, new vscode.Range(0, 0, doc.lineCount - 1, 0));
  const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 3));
  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, new vscode.Position(6, 2));
  const rename = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', doc.uri, new vscode.Position(3, 6), 'renamed_greet');
  await vscode.commands.executeCommand('workbench.actions.view.problems');
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes('notifications.clearAll')) await vscode.commands.executeCommand('notifications.clearAll');
  if (process.env.KAWAII_E2E_VISUAL === '1' && phase === 'patched') {
    await fs.writeFile(path.join(root, 'visual-ready'), 'ready');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) { try { await fs.access(path.join(root, 'visual-continue')); break; } catch { await delay(500); } }
  }
  const editor = await vscode.window.showTextDocument(doc);
  await editor.edit(edit => edit.replace(new vscode.Range(0, 0, doc.lineCount, 0), 'print("ok")\n'));
  await delay(1000);
  const fixed = await stableDiagnostics(doc.uri, false);
  const snapshot = { language: vscode.env.language, documents, actions: (actions || []).map(a => a.title).sort(), completions: (completions?.items || []).map(c => typeof c.label === 'string' ? c.label : c.label.label).sort(), definitions,
    rename: rename?.entries(), fixedErrors: fixed.filter(d => d.severity === 0).length,
    errorLensActive: vscode.extensions.getExtension('usernamehw.errorlens')?.isActive || false };
  await fs.writeFile(path.join(root, phase + '.json'), JSON.stringify(snapshot, null, 2));
};
