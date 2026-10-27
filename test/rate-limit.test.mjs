import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../src/gateway/rate-limit.mjs';

test('sliding window has no fixed-window boundary burst and recovers at exact expiry', () => {
  let clock = 999;
  const middleware = rateLimit({ now: () => clock });
  const request = ip => {
    let status = 200;
    const res = { set() {}, status(code) { status = code; return this; }, json() {} };
    middleware({ socket: { remoteAddress: ip }, requestId: 'test' }, res, () => {});
    return status;
  };
  for (let i = 0; i < 10; i++) assert.equal(request('client-a'), 200);
  clock = 1001;
  assert.equal(request('client-a'), 429);
  assert.equal(request('client-b'), 200);
  clock = 1998;
  assert.equal(request('client-a'), 429);
  clock = 1999;
  assert.equal(request('client-a'), 200);
});
