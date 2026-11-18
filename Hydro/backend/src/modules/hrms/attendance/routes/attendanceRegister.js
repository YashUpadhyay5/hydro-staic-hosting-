// Monthly attendance register API (mounted at /api/attendance-register), for HR and admins only.
// Spec: ATTENDANCE_REGISTER_API.md.
const express = require('express');
const router = express.Router();
const S = require('../services/AttendanceRegisterService');

const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR', 'HR_ADMIN'];
const isStaff = (req) => STAFF_ROLES.includes(String((req.user && req.user.role) || '').toUpperCase());
const actorOf = (req) => String((req.user && (req.user.email || req.user.id)) || 'admin');

const handle = (fn) => async (req, res) => {
  try {
    if (!isStaff(req)) throw new S.RegisterError('Only HR or an admin can use the attendance register.', 403, 'FORBIDDEN');
    await fn(req, res);
  } catch (error) {
    if (error instanceof S.RegisterError) {
      return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
    }
    console.error('[AttendanceRegister] Request failed:', error);
    return res.status(500).json({ error: 'Could not process the attendance register request.', code: 'SERVER_ERROR' });
  }
};

// GET /api/attendance-register?month=YYYY-MM&employeeId=
router.get('/', handle(async (req, res) => {
  res.json(await S.getRegister(String(req.query.month || ''), { employeeId: req.query.employeeId || null }));
}));

// GET /api/attendance-register/edits?month=YYYY-MM&employeeId=   the edit log, newest first
router.get('/edits', handle(async (req, res) => {
  res.json({ edits: await S.editsFor({ month: req.query.month || null, employeeId: req.query.employeeId || null }) });
}));

// POST /api/attendance-register/edits   { changes: [{ employeeId, date, mark: P | EL | A | OFF }], note? }
router.post('/edits', handle(async (req, res) => {
  res.json(await S.applyEdits(req.body || {}, actorOf(req)));
}));

module.exports = router;
