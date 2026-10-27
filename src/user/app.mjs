import { randomBytes, randomUUID, scryptSync, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT } from 'jose';
import { createApp, finishApp, HttpError, internalAuth, jsonBody, requireIdentity } from '../shared/http.mjs';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from '../shared/jwt.mjs';
import { AVATAR_TYPES, MAX_AVATAR_BYTES, UPLOAD_TTL_SECONDS } from './storage.mjs';

const deriveKey = promisify(scrypt);

export function createUserService({ internalKey, privateKey, password, storage, logger, now = Date.now }) {
  if (!password || password.length < 12) throw new Error('DEMO_PASSWORD phải có ít nhất 12 ký tự.');
  const salt = randomBytes(16);
  // Store a salted password hash, never the supplied password in a user record.
  const passwordHash = scryptSync(password, salt, 64);
  const users = new Map([
    ['user-1', { id: 'user-1', email: 'alice@example.test', name: 'Alice', avatarKey: null }],
    ['user-2', { id: 'user-2', email: 'bob@example.test', name: 'Bob', avatarKey: null }],
  ]);
  const pending = new Map();
  const app = createApp('user-service', { logger });
  app.use(internalAuth(internalKey), jsonBody());

  async function profile(user) {
    return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarKey ? await storage.readUrl(user.avatarKey) : null };
  }

  app.post('/auth/login', async (req, res) => {
    const { email, password: candidate } = req.body || {};
    if (typeof email !== 'string' || typeof candidate !== 'string' || email.length > 254 || candidate.length > 256) {
      throw new HttpError(400, 'INVALID_LOGIN', 'Cần email và mật khẩu hợp lệ.');
    }
    const user = [...users.values()].find(u => u.email === email.toLowerCase());
    const candidateHash = await deriveKey(candidate, salt, 64);
    if (!timingSafeEqual(candidateHash, passwordHash) || !user) throw new HttpError(401, 'BAD_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
    const accessToken = await new SignJWT({}).setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(user.id).setIssuer(JWT_ISSUER).setAudience(JWT_AUDIENCE)
      .setIssuedAt().setExpirationTime('15m').sign(privateKey);
    res.json({ accessToken, tokenType: 'Bearer', expiresIn: 900, user: await profile(user) });
  });

  app.use(requireIdentity);
  app.get('/users/me', async (req, res) => res.json(await profile(users.get(req.userId))));
  app.post('/users/me/avatar/upload-url', async (req, res) => {
    const { contentType } = req.body || {};
    if (!Object.hasOwn(AVATAR_TYPES, contentType || '')) throw new HttpError(400, 'INVALID_CONTENT_TYPE', 'Chỉ nhận image/png hoặc image/jpeg.');
    const time = now();
    for (const [key, ticket] of pending) if (ticket.expiresAt <= time) pending.delete(key);
    if ([...pending.values()].filter(t => t.userId === req.userId).length >= 10) {
      throw new HttpError(429, 'TOO_MANY_UPLOADS', 'Hoàn tất các upload đang chờ trước khi tạo mới.');
    }
    const key = `pending/${req.userId}/${randomUUID()}.${AVATAR_TYPES[contentType]}`;
    const url = await storage.uploadUrl(key);
    pending.set(key, { userId: req.userId, contentType, expiresAt: time + UPLOAD_TTL_SECONDS * 1000, processing: false });
    res.status(201).json({ uploadUrl: url, objectKey: key, method: 'PUT', expiresIn: UPLOAD_TTL_SECONDS,
      headers: { 'Content-Type': contentType }, maxBytes: MAX_AVATAR_BYTES });
  });

  app.post('/users/me/avatar/complete', async (req, res) => {
    const key = req.body?.objectKey;
    const ticket = typeof key === 'string' ? pending.get(key) : undefined;
    if (!ticket || ticket.userId !== req.userId || ticket.expiresAt <= now()) {
      throw new HttpError(400, 'INVALID_UPLOAD', 'Upload không thuộc user hoặc đã hết hạn.');
    }
    if (ticket.processing) throw new HttpError(409, 'UPLOAD_IN_PROGRESS', 'Upload đang được xác nhận.');
    ticket.processing = true;
    try {
      users.get(req.userId).avatarKey = await storage.finalize(key, req.userId, ticket.contentType);
      pending.delete(key);
      res.json(await profile(users.get(req.userId)));
    } catch (error) {
      ticket.processing = false;
      throw error;
    }
  });
  return finishApp(app);
}
