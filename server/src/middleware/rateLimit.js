/**
 * Minimal in-memory rate limiter (per client IP, fixed window).
 * Protects the free LLM quota in the public demo. Single-instance only, which
 * is fine for one container; use a shared store if you run several.
 */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Forget expired entries now and then so the map can't grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, windowMs);
  sweep.unref();

  return function limiter(req, res, next) {
    if (!max) return next(); // 0 = disabled
    const now = Date.now();
    const ip = req.ip ?? 'unknown';
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count++;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - entry.count));
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: `${message} Try again in ${Math.ceil(retryAfter / 60)} min.` });
    }
    next();
  };
}
