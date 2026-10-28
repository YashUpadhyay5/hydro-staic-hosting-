/**
 * Leave credit ledger: which credit every consumed day used.
 *
 * Two kinds of leave are earned: EL (every month) and Sun/Hol (special earned, for working a Sunday or
 * a holiday). Consumption follows "first earned, first used":
 *  - credits queue up in the order they were earned: carry-forward first, then by date. A month's EL
 *    counts as earned at the end of that month (policy EL_EARNED_AT), so Sun/Hol work done during a
 *    month is used before that month's EL;
 *  - each consumed day takes the oldest credit already earned on that day.
 * History is not recalculated: where the previous register recorded what a month's consumed leave used
 * ("Adjusted: 1 Apr EL, 0.5 Feb Sun/Hol, 1 2025 carry"), that record is followed.
 *
 * Pure functions, no database access.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const QUEUE_RANK = { CARRY: 0, SPECIAL: 1, EL: 2 }; // tie-break for credits earned on the same day

const round2 = (n) => Math.round(n * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const monthKey = (year, month) => `${year}-${pad2(month)}`;
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Reads a register note such as "Adjusted: 1 Apr EL, 0.5 Feb Sun/Hol, 1 2025 carry".
 * A month name means the latest such month not after the consumption month (year/month).
 * Returns [{ kind: 'EL'|'SPECIAL'|'CARRY', year, month, days }], or null when the text is not a note.
 */
function parseRegisterNote(reason, year, month) {
  const note = String(reason || '').match(/^\s*Adjusted:\s*(.+)$/i);
  if (!note) return null;
  const parts = [];
  for (const raw of note[1].split(',')) {
    const text = raw.trim();
    const carry = text.match(/^([\d.]+)\s+\d{4}\s+carry$/i);
    if (carry) {
      parts.push({ kind: 'CARRY', year: null, month: null, days: Number(carry[1]) });
      continue;
    }
    const credit = text.match(/^([\d.]+)\s+([a-z]{3})[a-z]*\s+(EL|Sun\/Hol)$/i);
    const m = credit ? MONTHS.indexOf(credit[2].toLowerCase()) + 1 : 0;
    if (!m) return null;
    parts.push({
      kind: credit[3].toUpperCase() === 'EL' ? 'EL' : 'SPECIAL',
      year: m <= month ? year : year - 1,
      month: m,
      days: Number(credit[1])
    });
  }
  return parts.length && parts.every((p) => p.days > 0) ? parts : null;
}

/** The newest register note (entries newest first) whose total equals the month's consumed value. */
function registerAllocation(entries, consumed, year, month) {
  for (const e of entries) {
    const parts = parseRegisterNote(e.reason, year, month);
    if (parts && round2(parts.reduce((s, p) => s + p.days, 0)) === round2(consumed)) return parts;
  }
  return null;
}

/**
 * @param {object}  input
 * @param {number}  input.carry       days carried in before the first month (carry-forward / opening balance)
 * @param {string}  input.carryType   'CARRY_FORWARD' | 'OPENING'
 * @param {number}  input.carryYear   year the carry-forward comes from (for display)
 * @param {Array}   input.months      counted months in order: { year, month, el, undatedSpecial,
 *                                    specials: [{ id, date, days, type, holidayName }],
 *                                    leaveDays: [{ date, days, leaveId, leaveType }],
 *                                    monthConsumed (signed), registerNote: [...]|null }
 * @param {string}  input.elEarnedAt  'MONTH_END' | 'MONTH_START'
 * @returns {{ credits: Array, byMonth: Map, summary: { el, special, total, uncovered } }}
 *   credits: queue order, each { id, kind, type, holidayName, year, month, date, days, used, left, uses[] }
 *   byMonth: 'YYYY-MM' -> { from[], days[], recorded, uncovered, left: { el, special } }
 */
function buildCreditLedger({ carry = 0, carryType = 'OPENING', carryYear = null, months = [], elEarnedAt = 'MONTH_END' }) {
  const credits = [];
  const events = [];

  if (carry > 0) {
    credits.push({ id: 'CARRY', kind: 'CARRY', type: carryType, year: carryYear, month: null, date: null, days: carry, queue: '0000-00-00', availableFrom: '0000-00-00' });
  }

  for (const mo of months) {
    const key = monthKey(mo.year, mo.month);
    const first = `${key}-01`;
    const last = `${key}-${pad2(lastDay(mo.year, mo.month))}`;
    const monthEnd = `${last}~`; // sorts after every date of the month

    // ---- credits earned this month ----
    if (mo.el > 0) {
      credits.push({ id: `EL-${key}`, kind: 'EL', year: mo.year, month: mo.month, date: null, days: mo.el, queue: elEarnedAt === 'MONTH_START' ? first : last, availableFrom: first });
    }
    if (mo.undatedSpecial > 0) {
      credits.push({ id: `SH-${key}`, kind: 'SPECIAL', type: 'UNDATED', year: mo.year, month: mo.month, date: null, days: mo.undatedSpecial, queue: first, availableFrom: first });
    }
    for (const s of mo.specials || []) {
      credits.push({ id: s.id, kind: 'SPECIAL', type: s.type, holidayName: s.holidayName || null, year: mo.year, month: mo.month, date: s.date, days: s.days, queue: s.date, availableFrom: s.date });
    }

    // ---- consumption this month: dated leave days + one month-level value ----
    const days = (mo.leaveDays || []).map((d) => ({ ...d }));
    let net = round2(mo.monthConsumed || 0);
    for (let i = days.length - 1; i >= 0 && net < 0; i--) { // a negative correction cancels the latest leave days
      const cut = Math.min(days[i].days, -net);
      days[i].days = round2(days[i].days - cut);
      net = round2(net + cut);
    }
    for (const d of days) {
      if (d.days > 0) events.push({ key, date: d.date, at: d.date, until: monthEnd, days: d.days, leaveId: d.leaveId, leaveType: d.leaveType || null });
    }
    if (net > 0) events.push({ key, date: null, at: monthEnd, until: monthEnd, days: net, note: mo.registerNote || null });
  }

  // Queue order: earned date, then carry / Sun/Hol / EL on the same day.
  credits.sort((a, b) => (a.queue < b.queue ? -1 : a.queue > b.queue ? 1 : QUEUE_RANK[a.kind] - QUEUE_RANK[b.kind]));
  const groups = new Map(); // 'KIND:YYYY-MM' (or 'CARRY') -> credits, for register notes
  for (const c of credits) {
    c.left = c.days;
    c.used = 0;
    c.uses = [];
    const g = c.kind === 'CARRY' ? 'CARRY' : `${c.kind}:${monthKey(c.year, c.month)}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const use = (c, ev, wanted) => {
    const days = round2(Math.min(c.left, wanted));
    c.left = round2(c.left - days);
    c.used = round2(c.used + days);
    const [y, m] = ev.key.split('-').map(Number);
    c.uses.push({ date: ev.date, year: y, month: m, days, leaveId: ev.leaveId || null });
    ev.from.push({ creditId: c.id, kind: c.kind, type: c.type || null, holidayName: c.holidayName || null, year: c.year, month: c.month, date: c.date, days });
    return days;
  };

  let head = 0; // credits before this index are fully used
  for (const ev of events) {
    ev.from = [];
    let need = ev.days;
    if (ev.note) { // follow the register's record first
      for (const part of ev.note) {
        let wanted = part.days;
        for (const c of groups.get(part.kind === 'CARRY' ? 'CARRY' : `${part.kind}:${monthKey(part.year, part.month)}`) || []) {
          if (wanted <= 0) break;
          if (c.left > 0 && c.availableFrom <= ev.until) {
            const got = use(c, ev, wanted);
            wanted = round2(wanted - got);
            need = round2(need - got);
          }
        }
      }
      ev.recorded = need <= 0;
    }
    // first earned, first used: credits earned by the day itself, then any earned in the same month
    for (const until of [ev.at, ev.until]) {
      for (let i = head; i < credits.length && need > 0; i++) {
        if (credits[i].left > 0 && credits[i].availableFrom <= until) need = round2(need - use(credits[i], ev, need));
      }
    }
    while (head < credits.length && credits[head].left <= 0) head++;
    ev.uncovered = need > 0 ? need : 0;
  }

  // ---- per month: what was used, and what is left at the month end ----
  const byMonth = new Map();
  const earnedByMonth = new Map();
  const usedByMonth = new Map();
  const add = (map, key, kind, days) => {
    const v = map.get(key) || { el: 0, special: 0 };
    v[kind === 'SPECIAL' ? 'special' : 'el'] = round2(v[kind === 'SPECIAL' ? 'special' : 'el'] + days);
    map.set(key, v);
  };
  for (const c of credits) if (c.kind !== 'CARRY') add(earnedByMonth, monthKey(c.year, c.month), c.kind, c.days);
  for (const ev of events) {
    const m = byMonth.get(ev.key) || { from: [], days: [], recorded: null, uncovered: 0 };
    for (const f of ev.from) {
      add(usedByMonth, ev.key, f.kind, f.days);
      const same = m.from.find((x) => x.creditId === f.creditId);
      if (same) same.days = round2(same.days + f.days);
      else m.from.push({ ...f });
    }
    if (ev.date) m.days.push({ date: ev.date, leaveId: ev.leaveId, leaveType: ev.leaveType, days: ev.days, from: ev.from, uncovered: ev.uncovered });
    if (ev.note) m.recorded = ev.recorded;
    m.uncovered = round2(m.uncovered + ev.uncovered);
    byMonth.set(ev.key, m);
  }
  const left = { el: carry > 0 ? carry : 0, special: 0 }; // carry-forward counts as EL
  for (const mo of months) {
    const key = monthKey(mo.year, mo.month);
    const earned = earnedByMonth.get(key) || { el: 0, special: 0 };
    const used = usedByMonth.get(key) || { el: 0, special: 0 };
    left.el = round2(left.el + earned.el - used.el);
    left.special = round2(left.special + earned.special - used.special);
    const m = byMonth.get(key) || { from: [], days: [], recorded: null, uncovered: 0 };
    m.left = { ...left };
    byMonth.set(key, m);
  }

  const summary = { el: 0, special: 0, total: 0, uncovered: 0 };
  for (const c of credits) {
    summary[c.kind === 'SPECIAL' ? 'special' : 'el'] = round2(summary[c.kind === 'SPECIAL' ? 'special' : 'el'] + c.left);
    summary.total = round2(summary.total + c.left);
  }
  for (const ev of events) summary.uncovered = round2(summary.uncovered + ev.uncovered);

  return {
    credits: credits.map(({ queue, availableFrom, ...c }) => c),
    byMonth,
    summary
  };
}

module.exports = { buildCreditLedger, parseRegisterNote, registerAllocation, monthKey };
