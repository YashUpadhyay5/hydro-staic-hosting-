// Loss of pay from approved leave requests, by date, for payroll.
// Mirrored for the pay run wizard's fallback display in frontend/.../PayrollView/leaveLop.js.
const { parseDateParts, toISO } = require('./LeaveBalanceService');

const DAY_MS = 86400000;
const isLopType = (type) => {
  const t = String(type || '').toLowerCase();
  return t.includes('lop') || t.includes('unpaid') || t.includes('loss of pay');
};
const count = (v) => Math.max(0, Math.round(Number(v) || 0));

function workingDatesOf(leave) {
  let dates = leave.workingDates;
  if (typeof dates === 'string') { try { dates = JSON.parse(dates); } catch { dates = null; } }
  if (!Array.isArray(dates) || !dates.length) return null;
  const parts = dates.map(parseDateParts);
  return parts.every(Boolean) ? parts.map(toISO) : null;
}

// `n` consecutive calendar days starting `offset` days after the leave's start date
function calendarDates(leave, offset, n) {
  const s = parseDateParts(leave.startDate);
  if (!s || !(n > 0)) return [];
  const t0 = Date.UTC(s.year, s.month - 1, s.day);
  return Array.from({ length: n }, (_, i) => new Date(t0 + (offset + i) * DAY_MS).toISOString().slice(0, 10));
}

/**
 * The dates of one leave request that are loss of pay.
 *  - Special leave (Marriage / Paternity / Maternity) is never LOP.
 *  - A leave typed LOP / unpaid is LOP on every day.
 *  - Otherwise EL covers the first elDays and the next lopDays are LOP: on the request's stored working
 *    dates (Sundays/holidays skipped), or on calendar days for older requests saved without them,
 *    the same days the Leave Balances ledger and the attendance export use.
 */
function lopDatesOfLeave(leave) {
  if (leave.leaveCategory) return [];
  const working = workingDatesOf(leave);
  if (isLopType(leave.type)) {
    if (working) return working;
    const s = parseDateParts(leave.startDate);
    const e = parseDateParts(leave.endDate) || s;
    const span = s && e ? Math.max(1, Math.round((Date.UTC(e.year, e.month - 1, e.day) - Date.UTC(s.year, s.month - 1, s.day)) / DAY_MS) + 1) : 1;
    return calendarDates(leave, 0, count(leave.lopDays) || count(leave.totalDays) || span);
  }
  const el = count(leave.elDays);
  const lop = count(leave.lopDays);
  if (!lop) return [];
  if (working && working.length >= el + lop) return working.slice(el, el + lop);
  return calendarDates(leave, el, lop);
}

/**
 * LOP days of approved leave requests falling in a pay month (year, month 1-12).
 * Returns { days, leaves: [{ leaveId, type, startDate, endDate, dates }] }.
 */
function lopForMonth(leaves, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const out = { days: 0, leaves: [] };
  for (const l of leaves) {
    if (String(l.status || '').toLowerCase() !== 'approved') continue;
    const dates = lopDatesOfLeave(l).filter((d) => d.startsWith(prefix));
    if (!dates.length) continue;
    out.days += dates.length;
    out.leaves.push({ leaveId: l.id, type: l.type, startDate: l.startDate, endDate: l.endDate, dates });
  }
  return out;
}

module.exports = { lopDatesOfLeave, lopForMonth, isLopType };
