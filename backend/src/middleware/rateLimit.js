function createRateLimiter(options = {}) {
  const {
    windowMs = 10 * 60 * 1000,
    max = 10,
    keyGenerator = (req) => req.ip,
    message = 'Too many requests. Try again later.'
  } = options;

  const hits = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = String(keyGenerator(req) || req.ip || 'unknown');
    const record = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (record.resetAt <= now) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count += 1;
    hits.set(key, record);

    if (record.count > max) {
      return res.status(429).json({ error: message });
    }

    if (hits.size > 5000) {
      for (const [storedKey, storedRecord] of hits.entries()) {
        if (storedRecord.resetAt <= now) hits.delete(storedKey);
      }
    }

    return next();
  };
}

module.exports = { createRateLimiter };
