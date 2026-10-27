import { generateKeyPair } from 'jose';
import { createGateway } from '../src/gateway/app.mjs';
import { createOrderService } from '../src/order/app.mjs';
import { createUserService } from '../src/user/app.mjs';

export const keys = await generateKeyPair('RS256', { extractable: true });
export const internalKey = 'test-only-internal-key-with-at-least-32-characters';
export const password = 'test-only-password-123456';
export const logger = { info() {} };

export async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

export async function cluster(t, options = {}) {
  const finalized = [];
  const storage = {
    uploadUrl: async key => `http://localhost:9000/avatars/${key}?X-Amz-Expires=300`,
    readUrl: async key => `http://localhost:9000/avatars/${key}?read=true`,
    finalize: async (key, userId, type) => { finalized.push({ key, userId, type }); return `approved/${userId}/test.png`; },
    ...options.storage,
  };
  const userUrl = await serve(t, createUserService({ internalKey, privateKey: keys.privateKey, password, storage, logger, now: options.now }));
  const orderUrl = await serve(t, createOrderService({ internalKey, logger }));
  const gatewayUrl = await serve(t, createGateway({ userUrl, orderUrl, internalKey, publicKey: keys.publicKey,
    logger, limiter: { limit: options.limit || 1000 } }));
  async function request(path, { token, body, method = 'GET', headers = {} } = {}) {
    const response = await fetch(gatewayUrl + path, { method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function login(email = 'alice@example.test') {
    const result = await request('/auth/login', { method: 'POST', body: { email, password } });
    if (result.status !== 200) throw new Error(`Unexpected login status ${result.status}`);
    return result.data.accessToken;
  }
  return { userUrl, orderUrl, gatewayUrl, request, login, finalized };
}
