// Attendance regularization API (mounted at /api/regularizations). The phone sends a request for a past day with a
// comment and supporting documents; staff approve (marks the employee present) or reject it on the dashboard.
// Spec: REGULARIZATION_API.md.
const fs = require('fs');
const express = require('express');
const router = express.Router();
const { regularizationUpload } = require('../../../../core/middleware/upload');
const AttendanceRegularization = require('../../../../shared/models/AttendanceRegularization');
const R = require('../services/RegularizationService');

const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR', 'HR_ADMIN', 'MANAGER'];
const isStaff = (req) => STAFF_ROLES.includes(String((req.user && req.user.role) || '').toUpperCase());
const actorOf = (req) => String((req.user && (req.user.email || req.user.id)) || 'system');

const requireStaff = (req) => {
  if (!isStaff(req)) throw new R.RegularizationError('Only HR or an admin can decide a request.', 403, 'FORBIDDEN');
};

// Staff may act for a named employee; everyone else is always the logged-in employee
async function targetEmployee(req) {
  const named = req.body?.employeeId || req.query.employeeId;
  const who = isStaff(req) && named ? named : (req.user && req.user.id);
  const employee = await R.resolveEmployee(who);
  if (!employee) throw new R.RegularizationError('Employee not found.', 404, 'EMPLOYEE_NOT_FOUND');
  return employee;
}

async function requestFor(req) {
  const row = await AttendanceRegularization.findByPk(req.params.id);
  if (!row) throw new R.RegularizationError('Request not found.', 404, 'NOT_FOUND');
  if (!isStaff(req) && String(row.employeeId) !== String(req.user && req.user.id)) {
    throw new R.RegularizationError('This request belongs to someone else.', 403, 'FORBIDDEN');
  }
  return row;
}

const removeFiles = (files = []) => files.forEach((f) => fs.unlink(f.path, () => {}));

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    removeFiles(req.files);
    if (error instanceof R.RegularizationError) {
      return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
    }
    console.error('[Regularization] Request failed:', error);
    return res.status(500).json({ error: 'Could not process the regularization request.', code: 'SERVER_ERROR' });
  }
};

// Up to MAX_DOCUMENTS images or PDFs in the `documents` field
const takeDocuments = (req, res, next) => {
  regularizationUpload.array('documents', R.MAX_DOCUMENTS)(req, res, (error) => {
    if (error) {
      removeFiles(req.files);
      const tooMany = error.code === 'LIMIT_UNEXPECTED_FILE';
      return res.status(400).json({
        error: tooMany ? `Attach at most ${R.MAX_DOCUMENTS} documents.` : error.message,
        code: tooMany ? 'TOO_MANY_DOCUMENTS' : 'INVALID_DOCUMENT'
      });
    }
    next();
  });
};

// GET /api/regularizations?status=PENDING|APPROVED|REJECTED|CANCELLED|ALL&employeeId=&from=&to=
// Staff see everyone's (default PENDING); an employee sees only their own.
router.get('/', handle(async (req, res) => {
  const filters = { status: req.query.status, from: req.query.from, to: req.query.to };
  if (isStaff(req)) {
    if (req.query.employeeId) filters.employeeId = (await targetEmployee(req)).id;
  } else {
    filters.employeeId = (await targetEmployee(req)).id;
  }
  res.json(await R.list(filters));
}));

// POST /api/regularizations   multipart/form-data: date, comment, checkIn?, checkOut?, documents[] (images / PDF)
router.post('/', takeDocuments, handle(async (req, res) => {
  const employee = await targetEmployee(req);
  const row = await R.create(employee, req.body || {}, req.files || []);
  res.status(201).json({ request: R.present(row) });
}));

// GET /api/regularizations/:id
router.get('/:id', handle(async (req, res) => {
  res.json({ request: R.present(await requestFor(req)) });
}));

// POST /api/regularizations/:id/approve   { note? }   staff: marks the employee present on that day
router.post('/:id/approve', handle(async (req, res) => {
  requireStaff(req);
  const row = await R.approve(await requestFor(req), actorOf(req), req.body || {});
  res.json({ request: R.present(row) });
}));

// POST /api/regularizations/:id/reject   { note }   staff
router.post('/:id/reject', handle(async (req, res) => {
  requireStaff(req);
  const row = await R.reject(await requestFor(req), actorOf(req), req.body || {});
  res.json({ request: R.present(row) });
}));

// POST /api/regularizations/:id/cancel   the employee withdraws a pending request
router.post('/:id/cancel', handle(async (req, res) => {
  const row = await R.cancel(await requestFor(req));
  res.json({ request: R.present(row) });
}));

module.exports = router;
