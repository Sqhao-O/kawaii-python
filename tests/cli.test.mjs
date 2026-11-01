import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testCli } from '../scripts/vscode.mjs';

test('Windows extension installation uses the vendor wrapper rather than a hard-coded internal entry', () => {
  const executable = 'C:\\QA Space\\VS Code\\Code.exe';
  const cli = testCli(executable, 'win32');
  assert.equal(cli.executable, 'C:\\QA Space\\VS Code\\bin\\code.cmd');
  assert.deepEqual(cli.args, []);
  assert.deepEqual(cli.env, {});
  assert.equal('shell' in cli, false);
});
test('Unix CLI helper does not inject default machine or test-profile directories', () => {
  if (process.platform === 'win32') return;
  const executable = process.platform === 'darwin' ? '/Applications/VS Code.app/Contents/MacOS/Code' : '/tmp/qa/code';
  const cli = testCli(executable);
  assert.deepEqual(cli.args, []);
  assert.deepEqual(cli.env, {});
});
