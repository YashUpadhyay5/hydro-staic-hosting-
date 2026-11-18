// Leave counts working days only: a calendar day in [startDate, endDate] that is not a Sunday and not a
// holiday in the employee's own calendar (see shared/services/EmployeeHolidayCalendar.js).
const DAY_MS = 86400000;
const MAX_SPAN_DAYS = 3660; // a longer range is invalid, so a mistyped end date cannot loop for ages
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseISODate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d), c = new Date(t);
  return c.getUTCFullYear() === y && c.getUTCMonth() === mo - 1 && c.getUTCDate() === d ? t : null;
}
function inclusiveDays(a, b) {
  const s = parseISODate(a), e = parseISODate(b);
  return s === null || e === null || e < s ? 0 : Math.round((e - s) / DAY_MS) + 1;
}
function toISO(year, monthIndex, day) {
  const d = new Date(Date.UTC(year, monthIndex, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}
function normalizeHolidayDate(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return toISO(+m[1], +m[2] - 1, +m[3]);
  // DD-MM-YYYY / DD/MM/YYYY (also 1-digit day or month, which `new Date` below would read as US month-first)
  if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s))) return toISO(+m[3], +m[2] - 1, +m[1]);
  if ((m = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(s)) && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    return toISO(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  }
  if ((m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)) && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) {
    return toISO(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : toISO(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}
// holidays: Map of 'YYYY-MM-DD' -> title, built from THIS employee's calendar only
function splitLeaveDays(startISO, endISO, holidays) {
  const out = { all: [], working: [], sundays: [], holidays: [] };
  const total = inclusiveDays(startISO, endISO);
  if (total === 0 || total > MAX_SPAN_DAYS) return out;
  const start = parseISODate(startISO);
  for (let i = 0; i < total; i++) {
    const t = start + i * DAY_MS, iso = new Date(t).toISOString().slice(0, 10);
    out.all.push(iso);
    if (new Date(t).getUTCDay() === 0) out.sundays.push(iso);
    else if (holidays && holidays.has(iso)) out.holidays.push(iso);
    else out.working.push(iso);
  }
  return out;
}

// Holiday Map from a calendar's rows; rows whose date cannot be read are ignored (never guessed).
function holidayMapFromRows(rows) {
  let list = rows;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  const map = new Map();
  for (const row of Array.isArray(list) ? list : []) {
    const iso = row && normalizeHolidayDate(row.date);
    if (iso) map.set(iso, row.title || row.name || 'Holiday');
  }
  return map;
}

module.exports = { MAX_SPAN_DAYS, parseISODate, inclusiveDays, normalizeHolidayDate, splitLeaveDays, holidayMapFromRows };
