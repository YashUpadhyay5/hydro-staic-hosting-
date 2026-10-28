const jwt = require('jsonwebtoken');
const Employee = require('../../shared/models/Employee');

// Lightweight cache for verified active employees (60s TTL) to prevent repeated DB hits per request
const userStatusCache = new Map();

// AUTH_MODE:
//  'audit'   - legacy behaviour (missing/invalid tokens fall back to ADMIN) but every request that
//              enforcement would reject is logged with an [AUTH-AUDIT] tag, so clients can be fixed first.
//  'enforce' - missing, literal "ADMIN" and wrongly-signed tokens get 401. Expired-but-genuine tokens
//              are still accepted (sessions intentionally never time out).
const AUTH_MODE = String(process.env.AUTH_MODE || 'audit').toLowerCase() === 'enforce' ? 'enforce' : 'audit';

// --- audit logging: first occurrence of each pattern immediately, counts every 10 minutes ---
const auditCounts = new Map();
function clientFamily(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (!ua) return 'no-ua';
  if (ua.includes('okhttp') || ua.includes('dart') || ua.includes('expo') || ua.includes('reactnative') || ua.includes('cfnetwork')) return 'mobile-app';
  if (ua.includes('mozilla')) return 'browser';
  if (ua.includes('node') || ua.includes('axios') || ua.includes('curl')) return 'script/service';
  return 'other';
}
function auditReject(req, reason) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].split('/').slice(0, 4).join('/');
  const key = `${reason} ${req.method} ${path} [${clientFamily(req)}]`;
  const n = (auditCounts.get(key) || 0) + 1;
  auditCounts.set(key, n);
  if (n === 1) console.warn(`[AUTH-AUDIT] would reject: ${key} ip=${req.ip}`);
}
if (AUTH_MODE === 'audit') {
  setInterval(() => {
    if (!auditCounts.size) return;
    console.warn(`[AUTH-AUDIT] summary (since start): ${JSON.stringify(Object.fromEntries(auditCounts))}`);
  }, 10 * 60 * 1000).unref();
}

function reject(res, message) {
  return res.status(401).json({ error: 'UNAUTHORIZED', message });
}

const verifyToken = (req, res, next) => {
  let token = null;
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = authHeader.trim();
    }
  } else if (req.headers['x-access-token']) {
    token = req.headers['x-access-token'];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  const fallbackEmpId = req.query?.userId || req.query?.currentUserId || req.query?.employeeId || req.body?.userId || req.body?.currentUserId || req.body?.employeeId || 'ADMIN';

  if (!token || token === 'null' || token === 'undefined' || token === 'Bearer' || token.toUpperCase() === 'ADMIN') {
    const reason = token && token.toUpperCase() === 'ADMIN' ? 'literal-admin-token' : 'no-token';
    if (AUTH_MODE === 'enforce') return reject(res, 'Authentication required.');
    auditReject(req, reason);
    req.user = { id: String(fallbackEmpId || 'ADMIN'), role: 'ADMIN' };
    return next();
  }

  const secret = process.env.JWT_SECRET || 'super_secret_hrms_token_key_2026';

  // Signature is always checked; expiry is ignored on purpose (no automatic session timeouts).
  jwt.verify(token, secret, { ignoreExpiration: true }, async (err, user) => {
    let decodedUser = user;
    if (err) {
      if (AUTH_MODE === 'enforce') return reject(res, 'Invalid session token. Please log in again.');
      auditReject(req, `bad-token:${err.message}`);
      decodedUser = jwt.decode(token) || { id: String(fallbackEmpId || 'ADMIN') };
    }

    try {
      const uId = decodedUser?.id ? String(decodedUser.id) : String(fallbackEmpId || 'ADMIN');

      // Fast-path for ADMIN tokens
      if (uId.toUpperCase() === 'ADMIN') {
        req.user = { id: 'ADMIN', role: 'ADMIN', email: decodedUser?.email || 'admin@example.com' };
        return next();
      }

      // Check cache first
      const now = Date.now();
      const cached = userStatusCache.get(uId);
      if (cached && (now - cached.ts < 60000)) {
        if (cached.status === 'PAST') {
          return res.status(403).json({ error: 'Your account has been deactivated. Access denied.' });
        }
        decodedUser.role = decodedUser.role || cached.role || 'EMPLOYEE';
        req.user = decodedUser;
        return next();
      }

      const dbUser = await Employee.findByPk(uId);
      if (dbUser) {
        userStatusCache.set(uId, { status: dbUser.status, role: dbUser.role, ts: now });
        if (dbUser.status === 'PAST') {
          return res.status(403).json({ error: 'Your account has been deactivated. Access denied.' });
        }
        if (!decodedUser.role && dbUser.role) {
          decodedUser.role = dbUser.role;
        }
      }

      if (!decodedUser.role) {
        decodedUser.role = 'EMPLOYEE';
      }
      req.user = decodedUser;
      next();
    } catch (dbErr) {
      console.error('Error verifying user status in verifyToken:', dbErr.message);
      if (AUTH_MODE === 'enforce') {
        if (err) return reject(res, 'Invalid session token. Please log in again.');
        req.user = { ...decodedUser, role: decodedUser.role || 'EMPLOYEE' };
        return next();
      }
      req.user = decodedUser || { id: String(fallbackEmpId || 'ADMIN'), role: 'ADMIN' };
      next();
    }
  });
};

module.exports = verifyToken;
