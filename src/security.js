// Lightweight, dependency-free security middleware.
// Kept in-house on purpose: fewer third-party packages = smaller supply-chain
// attack surface, and every line here is auditable.

/**
 * Security response headers (a focused subset of what `helmet` would set).
 * CSP allows our own assets + Google Fonts, and inline styles used by the
 * server-rendered itinerary page. No third-party scripts are allowed.
 */
export function securityHeaders(_req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');                 // no embedding in iframes
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.removeHeader('X-Powered-By');                          // hide Express fingerprint
  next();
}

/**
 * Simple fixed-window in-memory rate limiter, keyed by client IP.
 * Good enough for a single-instance app; swap for Redis if you scale out.
 */
export function rateLimit({ windowMs = 60_000, max = 60, message = 'Too many requests, please slow down.' } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Periodically purge expired buckets so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) if (rec.resetAt <= now) hits.delete(ip);
  }, windowMs);
  sweep.unref?.();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count += 1;

    const remaining = Math.max(0, max - rec.count);
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', Math.ceil((rec.resetAt - now) / 1000));

    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((rec.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

/** Coerce/trim a query or body value to a bounded string (defeats huge inputs). */
export function cleanStr(value, maxLen = 120) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen).trim();
}

/** Validate a YYYY-MM-DD date string; returns the string or null. */
export function cleanDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : value;
}
