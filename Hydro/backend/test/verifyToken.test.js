// verifyToken behaviour in 'audit' (legacy, logs only) and 'enforce' modes. No database access:
// tokens use the id "ADMIN" fast path or fail before any lookup.
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-token-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';
process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const modulePath = path.join(__dirname, '..', 'src', 'core', 'middleware', 'verifyToken.js');
function load(mode) {
  process.env.AUTH_MODE = mode;
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function run(verifyToken, headers = {}) {
  return new Promise((resolve) => {
    const req = { headers, query: {}, body: {}, method: 'GET', originalUrl: '/api/test', ip: '127.0.0.1' };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body, user: null }); }
    };
    verifyToken(req, res, () => resolve({ status: 'next', user: req.user }));
  });
}

const valid = jwt.sign({ id: 'ADMIN', role: 'ADMIN' }, 'test-secret');
const expired = jwt.sign({ id: 'ADMIN', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) - 3600 }, 'test-secret');
const forged = jwt.sign({ id: 'ADMIN', role: 'ADMIN' }, 'some-other-secret');
const bearer = (t) => ({ authorization: `Bearer ${t}` });

test('enforce mode', async () => {
  const v = load('enforce');
  assert.equal((await run(v)).status, 401, 'no token');
  assert.equal((await run(v, bearer('ADMIN'))).status, 401, 'literal ADMIN token');
  assert.equal((await run(v, bearer(forged))).status, 401, 'forged signature');
  assert.equal((await run(v, bearer('garbage'))).status, 401, 'malformed token');
  assert.equal((await run(v, bearer(valid))).status, 'next', 'valid token');
  assert.equal((await run(v, bearer(expired))).status, 'next', 'expired but genuine token still accepted');
});

test('audit mode keeps legacy behaviour', async () => {
  const v = load('audit');
  const none = await run(v);
  assert.equal(none.status, 'next');
  assert.equal(none.user.role, 'ADMIN');
  assert.equal((await run(v, bearer(forged))).status, 'next');
  assert.equal((await run(v, bearer(valid))).status, 'next');
});

// The temp SQLite file may still be open on Windows; leftover temp folders are harmless.
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
