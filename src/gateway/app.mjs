import { jwtVerify } from 'jose';
import { createApp, finishApp, HttpError, jsonBody } from '../shared/http.mjs';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from '../shared/jwt.mjs';
import { rateLimit } from './rate-limit.mjs';

export function createGateway({ userUrl, orderUrl, internalKey, publicKey, timeoutMs = 2000, logger, limiter = {} }) {
  const app = createApp('gateway', { logger });
  app.use(rateLimit(limiter));
  app.use(jsonBody());

  async function upstream(baseUrl, path, { userId, body, method = 'GET' } = {}) {
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'x-internal-key': internalKey, ...(userId ? { 'x-user-id': userId } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      return { status: response.status, data };
    } catch (error) {
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      throw new HttpError(timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', 'Service tạm thời không khả dụng.');
    }
  }

  app.post('/auth/login', async (req, res) => {
    const result = await upstream(userUrl, '/auth/login', { method: 'POST', body: req.body });
    res.status(result.status).json(result.data);
  });

  app.use(async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.get('authorization') || '');
    try {
      if (!match) throw new Error('missing token');
      const { payload } = await jwtVerify(match[1], publicKey, {
        algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
        requiredClaims: ['sub', 'iat', 'exp'], maxTokenAge: '15m',
      });
      if (!/^user-[12]$/.test(payload.sub)) throw new Error('invalid subject');
      req.userId = payload.sub;
      next();
    } catch {
      res.set('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'INVALID_TOKEN', message: 'JWT thiếu, không hợp lệ hoặc đã hết hạn.', requestId: req.requestId });
    }
  });

  app.get('/dashboard', async (req, res) => {
    const results = await Promise.allSettled([
      upstream(userUrl, '/users/me', { userId: req.userId }),
      upstream(orderUrl, '/orders', { userId: req.userId }),
    ]);
    const [user, orders] = results.map(r => r.status === 'fulfilled' && r.value.status === 200 ? r.value.data : null);
    const errors = results.flatMap((result, i) => {
      if (result.status === 'fulfilled' && result.value.status === 200) return [];
      return [{ service: i === 0 ? 'user' : 'order', code: result.status === 'rejected' ? result.reason.code : 'UPSTREAM_ERROR' }];
    });
    res.status(user === null && orders === null ? 503 : 200).json({ user, orders, partial: errors.length > 0, errors });
  });

  // Explicit route allowlist: no arbitrary target URLs or incoming identity headers forwarded.
  const routes = [
    ['get', '/users', userUrl, '/users/me'],
    ['get', '/users/me', userUrl, '/users/me'],
    ['post', '/users/me/avatar/upload-url', userUrl, '/users/me/avatar/upload-url'],
    ['post', '/users/me/avatar/complete', userUrl, '/users/me/avatar/complete'],
    ['get', '/orders', orderUrl, '/orders'],
  ];
  for (const [method, path, baseUrl, target] of routes) app[method](path, async (req, res) => {
    const result = await upstream(baseUrl, target, { userId: req.userId, method: method.toUpperCase(), body: method === 'post' ? req.body : undefined });
    res.status(result.status).json(result.data);
  });
  return finishApp(app);
}
