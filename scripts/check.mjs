import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function check(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (path.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const dir of ['src', 'scripts', 'test']) await check(dir);
console.info('Syntax check passed.');
