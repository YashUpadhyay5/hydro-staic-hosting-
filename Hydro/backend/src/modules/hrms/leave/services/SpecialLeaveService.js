const LeaveCategory = require('../../../../shared/models/LeaveCategory');
const { parseISODate, inclusiveDays } = require('./WorkingDays');

// Special leave (Marriage / Paternity / Maternity): a leave request with `leave_category` set.
// It has its own allowance per category, so it never reads or consumes Earned Leave and never becomes LOP.
// The ledger (LeaveBalanceService.loadSources), approve/revoke and payroll LOP all skip these rows.

class SpecialLeaveError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// ---- Duration rule (counted from the start date, both ends included) ----
// Special leave counts calendar days (Sundays and holidays included), unlike ordinary leave.
const DAY_MS = 86400000;
const toISODate = (t) => new Date(t).toISOString().slice(0, 10);
function addMonthsClamped(t, months) {
  const d = new Date(t), target = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(d.getUTCFullYear(), target + 1, 0)).getUTCDate();
  return Date.UTC(d.getUTCFullYear(), target, Math.min(d.getUTCDate(), last));
}
function maxEndDate(startISO, value, unit) {
  const s = parseISODate(startISO), n = Number(value);
  if (s === null || !Number.isInteger(n) || n < 1) return null;
  if (unit === 'days') return toISODate(s + (n - 1) * DAY_MS);
  if (unit === 'months') return toISODate(addMonthsClamped(s, n) - DAY_MS);
  return null;
}

const hasCategory = (value) => value !== undefined && value !== null && String(value).trim() !== '';

// "7 days" / "1 day" / "6 months"
function allowanceLabel(category) {
  const n = Number(category.durationValue);
  const unit = category.durationUnit === 'months' ? 'month' : 'day';
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

async function listActiveCategories() {
  const rows = await LeaveCategory.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  return rows.map((c) => ({ code: c.code, name: c.name, durationValue: c.durationValue, durationUnit: c.durationUnit }));
}

/**
 * Validates a special leave application and returns the fields to save.
 * Any type / elDays / lopDays / totalDays sent by the client is ignored.
 */
async function buildSpecialLeave({ category, startDate, endDate }) {
  const cat = await LeaveCategory.findOne({ where: { code: String(category).trim(), isActive: true } });
  if (!cat) throw new SpecialLeaveError('Unknown leave category.');

  const start = parseISODate(startDate);
  const end = parseISODate(endDate);
  if (start === null || end === null || end < start) throw new SpecialLeaveError('Invalid leave dates.');

  const startISO = toISODate(start);
  const endISO = toISODate(end);
  const lastAllowed = maxEndDate(startISO, cat.durationValue, cat.durationUnit);
  if (!lastAllowed || endISO > lastAllowed) throw new SpecialLeaveError(`${cat.name} allows up to ${allowanceLabel(cat)}.`);

  return {
    startDate: startISO,
    endDate: endISO,
    type: cat.name,
    leaveCategory: cat.code,
    elDays: 0,
    lopDays: 0,
    totalDays: inclusiveDays(startISO, endISO)
  };
}

module.exports = {
  SpecialLeaveError,
  hasCategory,
  listActiveCategories,
  buildSpecialLeave,
  allowanceLabel,
  parseISODate,
  toISODate,
  inclusiveDays,
  maxEndDate
};
