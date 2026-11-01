import fs from 'node:fs/promises';
import { PatchEngine } from '../../src/core/engine';
async function main() {
  const engine = await PatchEngine.open(process.argv[2], JSON.parse(await fs.readFile(process.argv[3], 'utf8')), {
    afterWrite: async i => { if (i === 0) process.exit(73); }
  });
  await engine.apply();
}
void main();
