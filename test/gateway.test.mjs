import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { SignJWT, generateKeyPair } from 'jose';
import { cluster, keys, internalKey, logger, password, serve } from './helpers.mjs';
import { createGateway } from '../src/gateway/app.mjs';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/shared/jwt.mjs';

test('login -> routing -> dashboard; incoming user identity and userId query cannot impersonate Bob', async t => {
  const { login, request } = await cluster(t);
  const token = await login();
  const user = await request('/users', { token, headers: { 'x-user-id': 'user-2', 'x-internal-key': 'attacker' } });
  assert.equal(user.status, 200);
  assert.equal(user.data.id, 'user-1');
  assert.equal('password' in user.data, false);
  const orders = await request('/orders?userId=user-2', { token, headers: { 'x-user-id': 'user-2' } });
  assert.equal(orders.data.length, 2);
  assert(orders.data.every(order => order.userId === 'user-1'));
  const dashboard = await request('/dashboard', { token });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.user.id, 'user-1');
  assert.deepEqual(dashboard.data.orders, orders.data);
  assert.equal(dashboard.data.partial, false);
  assert.deepEqual(dashboard.data.errors, []);
  const bob = await request('/dashboard', { token: await login('bob@example.test') });
  assert.equal(bob.data.user.id, 'user-2');
  assert.equal(bob.data.orders.length, 1);
  assert.equal(bob.data.orders[0].userId, 'user-2');
  assert.equal((await request('/users/user-2', { token })).status, 404);
});

test('JWT validation rejects absent, malformed, expired, wrong issuer/audience/key/algorithm and missing expiry', async t => {
  const { request } = await cluster(t);
  assert.equal((await request('/orders')).status, 401);
  assert.equal((await request('/orders', { token: 'not-a-jwt' })).status, 401);
  const wrongKeys = await generateKeyPair('RS256');
  const variants = [
    { expiry: '-1s' }, { issuer: 'attacker' }, { audience: 'other-app' }, { key: wrongKeys.privateKey },
    { alg: 'HS256', key: new TextEncoder().encode('test-secret') }, { noExpiry: true }, { subject: 'admin' },
  ];
  for (const variant of variants) {
    let jwt = new SignJWT({}).setProtectedHeader({ alg: variant.alg || 'RS256' })
      .setSubject(variant.subject || 'user-1').setIssuer(variant.issuer || JWT_ISSUER)
      .setAudience(variant.audience || JWT_AUDIENCE).setIssuedAt();
    if (!variant.noExpiry) jwt = jwt.setExpirationTime(variant.expiry || '15m');
    const token = await jwt.sign(variant.key || keys.privateKey);
    assert.equal((await request('/orders', { token })).status, 401, JSON.stringify(variant));
  }
});

test('services reject direct calls without internal credentials or without identity', async t => {
  const { userUrl, orderUrl } = await cluster(t);
  for (const url of [userUrl + '/users/me', orderUrl + '/orders']) {
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { 'x-user-id': 'user-1' } })).status, 403);
    assert.equal((await fetch(url, { headers: { 'x-internal-key': internalKey } })).status, 403);
    assert.equal((await fetch(url, { headers: { 'x-internal-key': internalKey, 'x-user-id': 'user-1' } })).status, 200);
  }
});

test('login rejects wrong credentials, unknown user and malformed bodies', async t => {
  const { request } = await cluster(t);
  for (const body of [{ email: 'alice@example.test', password: 'bad' }, { email: 'unknown@example.test', password }]) {
    assert.equal((await request('/auth/login', { method: 'POST', body })).status, 401);
  }
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'alice@example.test' } })).status, 400);
});

test('dashboard returns partial data when one service fails, 503 when both fail, and requests have a timeout', async t => {
  const { userUrl, login } = await cluster(t);
  const token = await login();
  const broken = express();
  broken.use((_req, res) => res.status(500).json({ error: 'broken' }));
  const brokenUrl = await serve(t, broken);
  const partialUrl = await serve(t, createGateway({ userUrl, orderUrl: brokenUrl, internalKey, publicKey: keys.publicKey, logger }));
  const partial = await fetch(partialUrl + '/dashboard', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(partial.status, 200);
  const data = await partial.json();
  assert.equal(data.user.id, 'user-1');
  assert.equal(data.orders, null);
  assert.equal(data.partial, true);
  assert.equal(data.errors[0].service, 'order');
  const bothUrl = await serve(t, createGateway({ userUrl: brokenUrl, orderUrl: brokenUrl, internalKey, publicKey: keys.publicKey, logger }));
  assert.equal((await fetch(bothUrl + '/dashboard', { headers: { authorization: `Bearer ${token}` } })).status, 503);
  const hanging = express();
  hanging.use(() => {});
  const hangUrl = await serve(t, hanging);
  const timeoutUrl = await serve(t, createGateway({ userUrl, orderUrl: hangUrl, internalKey, publicKey: keys.publicKey, timeoutMs: 50, logger }));
  assert.equal((await fetch(timeoutUrl + '/orders', { headers: { authorization: `Bearer ${token}` } })).status, 504);
});

test('dashboard starts both upstream requests concurrently', async t => {
  const { login } = await cluster(t);
  const token = await login();
  const waiting = [];
  function upstream(value) {
    const app = express();
    app.use((_req, res) => {
      waiting.push(() => res.json(value));
      if (waiting.length === 2) for (const respond of waiting) respond();
    });
    return app;
  }
  const userUrl = await serve(t, upstream({ id: 'user-1' }));
  const orderUrl = await serve(t, upstream([]));
  const gatewayUrl = await serve(t, createGateway({ userUrl, orderUrl, internalKey, publicKey: keys.publicKey, timeoutMs: 500, logger }));
  const response = await fetch(gatewayUrl + '/dashboard', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).partial, false);
  assert.equal(waiting.length, 2);
});

test('real HTTP burst accepts 10 and rejects the 11th at default limit, even with spoofed X-Forwarded-For', async t => {
  const { request } = await cluster(t, { limit: 10 });
  // Missing JWT responses count toward the rate limit, too.
  const results = await Promise.all(Array.from({ length: 11 }, (_, i) => request('/orders', { headers: { 'x-forwarded-for': `198.51.100.${i}` } })));
  assert.equal(results.filter(r => r.status === 401).length, 10);
  assert.equal(results.filter(r => r.status === 429).length, 1);
  assert.equal(results.find(r => r.status === 429).headers.get('retry-after'), '1');
});
