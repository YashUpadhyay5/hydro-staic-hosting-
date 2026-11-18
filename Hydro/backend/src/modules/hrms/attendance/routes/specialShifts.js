const express = require('express');
const router = express.Router();
const policy = require('../../../../core/config/leavePolicy');
const requireRole = require('../../../../core/middleware/requireRole');
const Employee = require('../../../../shared/models/Employee');
const SpecialEarnedCreditService = require('../../leave/services/SpecialEarnedCreditService');

const { ShiftError } = SpecialEarnedCreditService;

// Sunday / holiday shift verification (mounted at /attendance/special-shifts).

const userRole = (req) => String(req.user?.role || 'EMPLOYEE').toUpperCase();
const canVerify = (req) => ['ADMIN', 'SUPER_ADMIN', ...policy.SPECIAL_SHIFT_VERIFY_ROLES].includes(userRole(req));
// Identity always comes from the authenticated token, never from the request body. The token carries no
// name, so the approver's name is taken from their employee record.
const actorOf = async (req) => {
  const id = req.user?.id ? String(req.user.id) : '';
  const emp = id ? await Employee.findByPk(id, { attributes: ['name'] }).catch(() => null) : null;
  const name = (emp && emp.name) || req.user?.name || req.user?.email || 'Admin';
  return { id, role: userRole(req), label: id && id !== String(name) ? `${name} (${id})` : String(name) };
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const lastDayOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

const monthsBack = (n) => {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

/** { from, to, months } from ?all=1, ?month=YYYY-MM or ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most 62 days). */
function parsePeriod(query) {
  // Every saved credit; only the last two months are re-evaluated from attendance (older ones are settled).
  if (String(query.all || '') === '1') return { from: '0000-01-01', to: '9999-12-31', months: monthsBack(2) };
  const month = String(query.month || '').trim();
  if (month) {
    if (!MONTH_RE.test(month)) throw new ShiftError(400, 'INVALID_MONTH', 'month must be YYYY-MM.');
    return { from: `${month}-01`, to: lastDayOf(month), months: [month] };
  }
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new ShiftError(400, 'INVALID_PERIOD', 'Give month=YYYY-MM, or from and to as YYYY-MM-DD.');
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 62) {
    throw new ShiftError(400, 'PERIOD_TOO_LONG', 'The period can be at most 62 days.');
  }
  const months = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
    months.push(m);
    const [y, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  return { from, to, months };
}

const parseDayType = (value) => {
  const t = String(value || '').trim().toUpperCase();
  if (!t || t === 'ALL') return null;
  if (t !== 'SUNDAY' && t !== 'HOLIDAY') throw new ShiftError(400, 'INVALID_DAY_TYPE', 'dayType must be SUNDAY or HOLIDAY.');
  return t;
};

function sendError(res, error, label) {
  if (error instanceof ShiftError) return res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  console.error(label, error);
  return res.status(500).json({ error: 'Something went wrong. Nothing was changed.' });
}

const policyInfo = () => ({
  creditRules: policy.SPECIAL_SHIFT_CREDIT_RULES,
  maxDays: policy.SPECIAL_SHIFT_MAX_DAYS,
  leaveUnitStep: policy.LEAVE_UNIT_STEP,
  autoStartMonth: policy.SPECIAL_SHIFT_AUTO_START_MONTH
});

const summarize = (items) => ({
  pending: items.filter((i) => i.status === 'PENDING').length,
  approved: items.filter((i) => i.status === 'ACTIVE').length,
  rejected: items.filter((i) => i.status === 'REJECTED').length,
  reversed: items.filter((i) => i.status === 'REVERSED').length
});

async function syncPeriod(months) {
  // Make sure shifts not yet evaluated (e.g. sessions closed automatically) are listed.
  for (const m of months) await SpecialEarnedCreditService.syncCreditsForMonth(m);
}

// GET /attendance/special-shifts?all=1 | month=YYYY-MM | from&to [&register=1] - every Sunday/holiday credit in the
// period, any status (Weekend/Holiday Shifts page, attendance grid badges and Excel export).
router.get('/', requireRole(policy.SPECIAL_SHIFT_VIEW_ROLES), async (req, res) => {
  try {
    const period = parsePeriod(req.query);
    await syncPeriod(period.months);
    // register=1 adds the register's Sun/Hol month totals (no dates), as shown in Leave Balances.
    const items = await SpecialEarnedCreditService.listShifts({
      from: period.from, to: period.to, dayType: parseDayType(req.query.dayType), includeRegister: String(req.query.register || '') === '1'
    });
    return res.status(200).json({ from: period.from, to: period.to, canVerify: canVerify(req), policy: policyInfo(), summary: summarize(items), data: items });
  } catch (error) {
    return sendError(res, error, 'Error listing special shifts:');
  }
});

// GET /attendance/special-shifts/pending?month=YYYY-MM&search&dayType&adjustmentId&page&limit - shifts awaiting verification
router.get('/pending', requireRole(policy.SPECIAL_SHIFT_VIEW_ROLES), async (req, res) => {
  try {
    const period = parsePeriod(req.query);
    await syncPeriod(period.months);
    let items = await SpecialEarnedCreditService.listShifts({
      from: period.from, to: period.to, status: 'PENDING',
      dayType: parseDayType(req.query.dayType), search: String(req.query.search || '').slice(0, 100)
    });
    if (req.query.adjustmentId) items = items.filter((i) => i.adjustmentId === String(req.query.adjustmentId));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const totalPages = Math.max(1, Math.ceil(items.length / limit));
    const page = Math.min(totalPages, Math.max(1, parseInt(req.query.page, 10) || 1));
    const data = items.slice((page - 1) * limit, page * limit);
    await SpecialEarnedCreditService.attachLocation(data);
    return res.status(200).json({
      month: period.months.length === 1 ? period.months[0] : null,
      from: period.from, to: period.to,
      canVerify: canVerify(req), policy: policyInfo(),
      total: items.length, page, limit, totalPages, data
    });
  } catch (error) {
    return sendError(res, error, 'Error listing pending special shifts:');
  }
});

// POST /attendance/special-shifts/verify
// Body: { adjustmentId, action: 'APPROVE'|'REJECT', days?, confirmOverride?, overrideReason?, rejectionReason? }
router.post('/verify', requireRole(policy.SPECIAL_SHIFT_VERIFY_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const result = await SpecialEarnedCreditService.verifyShift({
      adjustmentId: b.adjustmentId, action: b.action, days: b.days,
      confirmOverride: b.confirmOverride === true, overrideReason: b.overrideReason, rejectionReason: b.rejectionReason
    }, await actorOf(req));
    return res.status(200).json({ success: true, result });
  } catch (error) {
    return sendError(res, error, 'Error verifying special shift:');
  }
});

// POST /attendance/special-shifts/batch-verify
// Body: { adjustmentIds: [...], action: 'APPROVE'|'REJECT', rejectionReason? } - per-shift results, partial success reported
router.post('/batch-verify', requireRole(policy.SPECIAL_SHIFT_VERIFY_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const result = await SpecialEarnedCreditService.batchVerify({ adjustmentIds: b.adjustmentIds, action: b.action, rejectionReason: b.rejectionReason }, await actorOf(req));
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'Error batch verifying special shifts:');
  }
});

module.exports = router;
