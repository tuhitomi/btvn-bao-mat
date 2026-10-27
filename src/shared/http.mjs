import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApp(name, { logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set({ 'X-Request-Id': req.requestId, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    const started = performance.now();
    res.on('finish', () => logger.info?.(JSON.stringify({
      service: name, requestId: req.requestId, method: req.method,
      // Query strings can contain bearer capabilities. Never log them or headers/bodies.
      path: req.path, status: res.statusCode, durationMs: +(performance.now() - started).toFixed(2),
    })));
    next();
  });
  app.get('/health', (_req, res) => res.json({ service: name, status: 'ok' }));
  return app;
}

export const jsonBody = () => express.json({ limit: '16kb', strict: true });

export function finishApp(app) {
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Endpoint không tồn tại.')));
  app.use((error, req, res, _next) => {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 500;
    res.status(status).json({ error: error.code || (status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
      message: status < 500 ? error.message : 'Không thể xử lý yêu cầu lúc này.', requestId: req.requestId });
  });
  return app;
}

export function internalAuth(key) {
  if (!key || key.length < 32) throw new Error('INTERNAL_API_KEY phải có ít nhất 32 ký tự.');
  const expected = Buffer.from(key);
  return (req, _res, next) => {
    const provided = Buffer.from(req.get('x-internal-key') || '');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new HttpError(403, 'INTERNAL_ONLY', 'Service chỉ chấp nhận lời gọi nội bộ.');
    }
    next();
  };
}

export function requireIdentity(req, _res, next) {
  const id = req.get('x-user-id');
  if (!/^user-[12]$/.test(id || '')) throw new HttpError(403, 'INVALID_IDENTITY', 'Danh tính nội bộ không hợp lệ.');
  req.userId = id;
  next();
}

export function listen(app, port, host = '127.0.0.1') {
  const server = app.listen(port, host, () => console.info(`Listening on ${host}:${port}`));
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
  return server;
}

export function required(name) {
  const value = process.env[name];
  if (!value || value.includes('GENERATE_WITH')) throw new Error(`Thiếu ${name}; chạy npm run setup.`);
  return value;
}
