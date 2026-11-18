// Loss of pay from approved leave requests, by date. Mirrors backend/src/modules/hrms/leave/services/LeaveLop.js,
// which decides the pay; the wizard uses this only until the server preview arrives.
const DAY_MS = 86400000;

const isLopType = (type) => {
    const t = String(type || '').toLowerCase();
    return t.includes('lop') || t.includes('unpaid') || t.includes('loss of pay');
};
const count = (v) => Math.max(0, Math.round(Number(v) || 0));

// ISO `YYYY-MM-DD` (optionally with a time part) or `DD-MM-YYYY` / `DD/MM/YYYY` -> UTC ms, or null
function parseDay(value) {
    const s = String(value || '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    let y, mo, d;
    if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s))) [y, mo, d] = [+m[3], +m[2], +m[1]];
    else return null;
    const t = Date.UTC(y, mo - 1, d), c = new Date(t);
    return c.getUTCFullYear() === y && c.getUTCMonth() === mo - 1 && c.getUTCDate() === d ? t : null;
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function workingDatesOf(leave) {
    let dates = leave.workingDates;
    if (typeof dates === 'string') { try { dates = JSON.parse(dates); } catch { dates = null; } }
    if (!Array.isArray(dates) || !dates.length) return null;
    const days = dates.map(parseDay);
    return days.every((t) => t !== null) ? days.map(iso) : null;
}

function calendarDates(leave, offset, n) {
    const t0 = parseDay(leave.startDate || leave.start_date);
    if (t0 === null || !(n > 0)) return [];
    return Array.from({ length: n }, (_, i) => iso(t0 + (offset + i) * DAY_MS));
}

/** The dates of one leave request that are loss of pay (see the backend file for the rules). */
export function lopDatesOfLeave(leave) {
    if (leave.leaveCategory || leave.category) return [];
    const working = workingDatesOf(leave);
    if (isLopType(leave.type)) {
        if (working) return working;
        const s = parseDay(leave.startDate || leave.start_date);
        const e = parseDay(leave.endDate || leave.end_date) ?? s;
        const span = s !== null && e !== null ? Math.max(1, Math.round((e - s) / DAY_MS) + 1) : 1;
        return calendarDates(leave, 0, count(leave.lopDays ?? leave.lop_days) || count(leave.totalDays ?? leave.total_days) || span);
    }
    const el = count(leave.elDays ?? leave.el_days);
    const lop = count(leave.lopDays ?? leave.lop_days);
    if (!lop) return [];
    if (working && working.length >= el + lop) return working.slice(el, el + lop);
    return calendarDates(leave, el, lop);
}

/** LOP days of approved leave requests in a pay month: { days, dates }. */
export function lopForMonth(leaves, year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const dates = [];
    for (const l of leaves || []) {
        if (String(l.status || '').toLowerCase() !== 'approved') continue;
        for (const d of lopDatesOfLeave(l)) if (d.startsWith(prefix)) dates.push(d);
    }
    dates.sort();
    return { days: dates.length, dates };
}
