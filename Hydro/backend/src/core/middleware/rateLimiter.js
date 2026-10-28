// Production In-Memory Rate Limiter Middleware with IP + Email Keying Strategy

const attemptsMap = new Map();

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Clean up expired rate limiter entries periodically to prevent memory leaks.
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of attemptsMap.entries()) {
    if (now > data.resetTime) {
      attemptsMap.delete(key);
    }
  }
}, 5 * 60 * 1000); // Cleanup every 5 minutes

/**
 * Middleware to enforce rate limiting on authentication routes (5 failed attempts -> 15 min lock).
 */
const loginRateLimiter = (req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  const email = (req.body && req.body.email) ? String(req.body.email).toLowerCase().trim() : 'anonymous';
  const key = `login_fail:${clientIp}:${email}`;

  const now = Date.now();
  const record = attemptsMap.get(key);

  if (record) {
    if (now < record.resetTime) {
      if (record.count >= MAX_ATTEMPTS) {
        const remainingSeconds = Math.ceil((record.resetTime - now) / 1000);
        const remainingMinutes = Math.ceil(remainingSeconds / 60);

        res.setHeader('Retry-After', remainingSeconds);
        return res.status(429).json({
          status: 'locked',
          error: `Too many failed login attempts. Account temporarily locked for security. Please try again in ${remainingMinutes} minute(s).`,
          retryAfterMinutes: remainingMinutes,
          cooldownRemainingSeconds: remainingSeconds
        });
      }
    } else {
      // Cooldown expired; reset record
      attemptsMap.delete(key);
    }
  }

  // Attach rate limiter tracking helper to request object for auth controller use
  req.rateLimiterKey = key;
  req.recordFailedAttempt = () => {
    const current = attemptsMap.get(key) || { count: 0, resetTime: Date.now() + COOLDOWN_MS };
    current.count += 1;
    current.resetTime = Date.now() + COOLDOWN_MS;
    attemptsMap.set(key, current);
    return current;
  };
  req.clearFailedAttempts = () => {
    attemptsMap.delete(key);
  };

  next();
};

module.exports = {
  loginRateLimiter
};
