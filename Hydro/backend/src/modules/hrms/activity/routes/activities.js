// Day activities API (mounted at /api/activities). The phone starts / extends / finishes the logged-in
// employee's activities; the tracking page reads a day's list. Spec: DAY_ACTIVITIES_API.md.
const express = require('express');
const router = express.Router();
const EmployeeActivity = require('../../../../shared/models/EmployeeActivity');
const A = require('../services/ActivityService');
const { workListFor } = require('../services/WorkLists');

// Every role that can sign in to the dashboard; EMPLOYEE (the phone) only ever sees its own activities
const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR', 'HR_ADMIN', 'MANAGER', 'TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER'];
const isStaff = (req) => STAFF_ROLES.includes(String((req.user && req.user.role) || '').toUpperCase());

// Whose activities: staff may name anyone (employeeId / userId: internal id, empCode or name);
// everyone else is always the logged-in employee.
async function targetEmployee(req) {
  const named = req.body?.employeeId || req.body?.userId || req.query.employeeId || req.query.userId;
  const who = isStaff(req) && named ? named : (req.user && req.user.id);
  const employee = await A.resolveEmployee(who);
  if (!employee) throw new A.ActivityError('Employee not found.', 404, 'EMPLOYEE_NOT_FOUND');
  return employee;
}

async function ownActivity(req) {
  const activity = await EmployeeActivity.findByPk(req.params.id);
  if (!activity) throw new A.ActivityError('Activity not found.', 404, 'NOT_FOUND');
  if (!isStaff(req) && String(activity.employeeId) !== String(req.user && req.user.id)) {
    throw new A.ActivityError('This activity belongs to someone else.', 403, 'FORBIDDEN');
  }
  return activity;
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof A.ActivityError) {
      return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
    }
    console.error('[Activities] Request failed:', error);
    return res.status(500).json({ error: 'Could not process the activity request.', code: 'SERVER_ERROR' });
  }
};

// GET /api/activities?employeeId=&date=YYYY-MM-DD   (date defaults to today, IST)
router.get('/', handle(async (req, res) => {
  const employee = await targetEmployee(req);
  const date = String(req.query.date || A.istDate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new A.ActivityError('date must be YYYY-MM-DD.', 400, 'INVALID_DATE');
  const now = Date.now();
  const activities = (await A.listForDay(employee, date)).map((a) => A.present(a, now));
  res.json({ employee: { id: employee.id, empCode: employee.empCode, name: employee.name }, date, activities });
}));

// GET /api/activities/current   the activity in progress, or null
router.get('/current', handle(async (req, res) => {
  const employee = await targetEmployee(req);
  const current = await A.currentFor(employee);
  res.json({ activity: current ? A.present(current) : null });
}));

// GET /api/activities/work-list   what this employee can log, from their work place:
// { region, label, mode: 'LIST' | 'FREE', workPlace, items: [{ key, title, minutes|null }] }
router.get('/work-list', handle(async (req, res) => {
  const employee = await targetEmployee(req);
  res.json(await workListFor(employee));
}));

// POST /api/activities   { workKey (LIST work places) | title (FREE), plannedEndAt | plannedMinutes, notes?, latitude?, longitude?, startedAt? }
router.post('/', handle(async (req, res) => {
  const employee = await targetEmployee(req);
  const activity = await A.start(employee, req.body || {});
  res.status(201).json({ activity: A.present(activity) });
}));

// POST /api/activities/:id/extend   { extraMinutes, reason }
router.post('/:id/extend', handle(async (req, res) => {
  const activity = await A.extend(await ownActivity(req), req.body || {});
  res.json({ activity: A.present(activity) });
}));

// POST /api/activities/:id/finish   { reason (required when past the deadline), notes?, latitude?, longitude? }
router.post('/:id/finish', handle(async (req, res) => {
  const activity = await A.finish(await ownActivity(req), req.body || {});
  res.json({ activity: A.present(activity) });
}));

// POST /api/activities/:id/cancel   { reason? }
router.post('/:id/cancel', handle(async (req, res) => {
  const activity = await A.cancel(await ownActivity(req), req.body || {});
  res.json({ activity: A.present(activity) });
}));

module.exports = router;
