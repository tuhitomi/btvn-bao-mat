import test from 'node:test';
import assert from 'node:assert/strict';
import { cluster } from './helpers.mjs';
import { createStorage, validImage, UPLOAD_TTL_SECONDS } from '../src/user/storage.mjs';

test('real S3 SDK generates a MinIO-compatible signed PUT URL for the public hostname with exactly 300s expiry', async () => {
  const storage = createStorage({ endpoint: 'http://minio:9000', publicEndpoint: 'http://localhost:9000',
    accessKey: 'test-access', secretKey: 'test-only-secret-key', bucket: 'avatars' });
  const url = new URL(await storage.uploadUrl('pending/user-1/test.png'));
  assert.equal(url.host, 'localhost:9000');
  assert.equal(url.pathname, '/avatars/pending/user-1/test.png');
  assert.equal(url.searchParams.get('X-Amz-Expires'), String(UPLOAD_TTL_SECONDS));
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
});

test('upload tickets belong to authenticated user, expire in five minutes, and cannot be completed twice', async t => {
  let clock = Date.now();
  const { request, login, finalized } = await cluster(t, { now: () => clock });
  const alice = await login(), bob = await login('bob@example.test');
  assert.equal((await request('/users/me/avatar/upload-url', { token: alice, method: 'POST', body: { contentType: 'image/svg+xml' } })).status, 400);
  const upload = await request('/users/me/avatar/upload-url', { token: alice, method: 'POST', body: { contentType: 'image/png', objectKey: '../user-2/file.png' } });
  assert.equal(upload.status, 201);
  assert.match(upload.data.objectKey, /^pending\/user-1\/[0-9a-f-]+\.png$/);
  assert.equal(upload.data.expiresIn, 300);
  assert.equal((await request('/users/me/avatar/complete', { token: bob, method: 'POST', body: { objectKey: upload.data.objectKey } })).status, 400);
  const completed = await request('/users/me/avatar/complete', { token: alice, method: 'POST', body: { objectKey: upload.data.objectKey } });
  assert.equal(completed.status, 200);
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].userId, 'user-1');
  assert.equal((await request('/users/me/avatar/complete', { token: alice, method: 'POST', body: { objectKey: upload.data.objectKey } })).status, 400);
  const expired = await request('/users/me/avatar/upload-url', { token: alice, method: 'POST', body: { contentType: 'image/jpeg' } });
  clock += 300000;
  assert.equal((await request('/users/me/avatar/complete', { token: alice, method: 'POST', body: { objectKey: expired.data.objectKey } })).status, 400);
});

test('avatar upload rejects non-image file signatures', () => {
  assert.equal(validImage(Buffer.from('<script>alert(1)</script>'), 'image/png'), false);
  assert.equal(validImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'), true);
  assert.equal(validImage(Buffer.from([255, 216, 255, 224]), 'image/jpeg'), true);
  assert.equal(validImage(Buffer.from([255, 216, 255, 224]), 'image/png'), false);
});

test('only one concurrent completion can approve a ticket', async t => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const { login, request } = await cluster(t, { storage: { finalize: async () => { await barrier; return 'approved/user-1/avatar.png'; } } });
  const token = await login();
  const upload = await request('/users/me/avatar/upload-url', { token, method: 'POST', body: { contentType: 'image/png' } });
  const first = request('/users/me/avatar/complete', { token, method: 'POST', body: { objectKey: upload.data.objectKey } });
  const second = request('/users/me/avatar/complete', { token, method: 'POST', body: { objectKey: upload.data.objectKey } });
  const result = await Promise.race([first, second]);
  assert.equal(result.status, 409);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
