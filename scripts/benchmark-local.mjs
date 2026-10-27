// Benchmark actual HTTP apps without requiring storage: seeded profiles have no avatar.
// The real S3 adapter is supplied, but no storage API is used by the measured routes.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { importPKCS8, importSPKI } from 'jose';
import { createGateway } from '../src/gateway/app.mjs';
import { createUserService } from '../src/user/app.mjs';
import { createOrderService } from '../src/order/app.mjs';
import { createStorage } from '../src/user/storage.mjs';
import { required } from '../src/shared/http.mjs';

const privateKey = await importPKCS8(await readFile(required('JWT_PRIVATE_KEY_FILE'), 'utf8'), 'RS256');
const publicKey = await importSPKI(await readFile(required('JWT_PUBLIC_KEY_FILE'), 'utf8'), 'RS256');
const internalKey = required('INTERNAL_API_KEY');
const storage = createStorage({ endpoint: required('MINIO_ENDPOINT'), publicEndpoint: required('MINIO_PUBLIC_ENDPOINT'),
  accessKey: required('MINIO_ROOT_USER'), secretKey: required('MINIO_ROOT_PASSWORD'), bucket: required('MINIO_BUCKET') });
const logger = { info() {} };
const servers = [];
async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return `http://127.0.0.1:${server.address().port}`;
}
try {
  const userUrl = await serve(createUserService({ internalKey, privateKey, password: required('DEMO_PASSWORD'), storage, logger }));
  const orderUrl = await serve(createOrderService({ internalKey, logger }));
  const gatewayUrl = await serve(createGateway({ userUrl, orderUrl, internalKey, publicKey, logger }));
  const child = spawn(process.execPath, ['scripts/benchmark.mjs'], {
    stdio: 'inherit', env: { ...process.env, USER_URL: userUrl, GATEWAY_URL: gatewayUrl,
      BENCHMARK_DIRECT_URL: `${userUrl}/users/me`, BENCHMARK_TOPOLOGY: 'Loopback HTTP; three real apps in one Node process; separate benchmark process; no storage route exercised' },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once('exit', code => resolve(code || 0)); child.once('error', reject); });
} finally {
  await Promise.all(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
}
