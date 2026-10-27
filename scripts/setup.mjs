import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

await mkdir('.secrets', { recursive: true });
await mkdir('reports', { recursive: true });
const privateExists = existsSync('.secrets/private.pem');
const publicExists = existsSync('.secrets/public.pem');
if (privateExists !== publicExists) throw new Error('Cặp khóa bị thiếu một file. Khôi phục cặp khóa trước khi chạy setup.');
if (!privateExists) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  await writeFile('.secrets/private.pem', privateKey, { flag: 'wx', mode: 0o600 });
  await writeFile('.secrets/public.pem', publicKey, { flag: 'wx' });
}
if (!existsSync('.env')) {
  const secret = () => randomBytes(32).toString('base64url');
  await writeFile('.env', [
    'GATEWAY_PORT=8080', 'USER_PORT=3001', 'ORDER_PORT=3002',
    'USER_URL=http://127.0.0.1:3001', 'ORDER_URL=http://127.0.0.1:3002',
    'JWT_PRIVATE_KEY_FILE=.secrets/private.pem', 'JWT_PUBLIC_KEY_FILE=.secrets/public.pem',
    `INTERNAL_API_KEY=${secret()}`, `DEMO_PASSWORD=${secret()}`,
    'MINIO_ROOT_USER=labstorage', `MINIO_ROOT_PASSWORD=${secret()}`,
    'MINIO_ENDPOINT=http://127.0.0.1:9000', 'MINIO_PUBLIC_ENDPOINT=http://localhost:9000', 'MINIO_BUCKET=avatars', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
}
console.info('Đã sẵn sàng .env và cặp khóa RSA; không ghi đè cấu hình có sẵn.');
console.info('Mật khẩu hai tài khoản demo nằm trong DEMO_PASSWORD của .env (không commit file này).');
