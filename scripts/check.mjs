import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const roots = ['server.js', 'server', 'shared', 'public', 'tests'];
let failed = false;
function check(path) {
  if (!path.endsWith('.js')) return;
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); failed = true; }
}
for (const root of roots) {
  if (root.endsWith('.js')) check(root);
  else {
    try { for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) check(join(root, entry.name));
    } } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
if (failed) process.exit(1);
console.log('Sintaxe JavaScript verificada.');
