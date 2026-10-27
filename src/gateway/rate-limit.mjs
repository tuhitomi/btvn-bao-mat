// Exact sliding window per network peer. Client-supplied X-Forwarded-For is ignored.
export function rateLimit({ limit = 10, windowMs = 1000, now = Date.now, maxClients = 10_000 } = {}) {
  const clients = new Map();
  let lastSweep = 0;
  return (req, res, next) => {
    const time = now();
    if (time - lastSweep >= windowMs) {
      for (const [ip, times] of clients) if (times.at(-1) <= time - windowMs) clients.delete(ip);
      lastSweep = time;
    }
    const ip = req.socket.remoteAddress || 'unknown';
    const recent = (clients.get(ip) || []).filter(t => t > time - windowMs);
    res.set('X-RateLimit-Limit', String(limit));
    if (recent.length >= limit || (!clients.has(ip) && clients.size >= maxClients)) {
      res.set('X-RateLimit-Remaining', '0');
      res.set('Retry-After', String(Math.max(1, Math.ceil(((recent[0] ?? time) + windowMs - time) / 1000))));
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Tối đa 10 request/giây/IP.', requestId: req.requestId });
    }
    recent.push(time);
    clients.set(ip, recent);
    res.set('X-RateLimit-Remaining', String(limit - recent.length));
    next();
  };
}
