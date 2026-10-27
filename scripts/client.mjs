import { setTimeout } from 'node:timers/promises';

export const gatewayUrl = process.env.GATEWAY_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`;
export async function request(path, { token, body, method = 'GET', headers = {} } = {}) {
  const response = await fetch(new URL(path, gatewayUrl), { method,
    signal: AbortSignal.timeout(5000),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
export async function login(email = 'alice@example.test') {
  const result = await request('/auth/login', { method: 'POST', body: { email, password: process.env.DEMO_PASSWORD } });
  if (result.status !== 200) throw new Error(`Login failed: HTTP ${result.status}`);
  return result.data.accessToken;
}
export const pauseForRateLimit = () => setTimeout(1100);
