import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.env')) throw new Error('Chạy npm run setup trước.');
const children = ['order', 'user', 'gateway'].map(service =>
  spawn(process.execPath, ['--env-file=.env', `src/${service}/main.mjs`], { stdio: 'inherit' }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => stop(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
