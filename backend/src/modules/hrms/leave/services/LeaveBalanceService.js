const { Op } = require('sequelize');
const Leave = require('../../../../shared/models/Leave');
const Employee = require('../../../../shared/models/Employee');
const LeaveAdjustment = require('../../../../shared/models/LeaveAdjustment');
const HolidayCalendar = require('../../../../shared/models/HolidayCalendar');
const Attendance = require('../../../../shared/models/Attendance');
const policy = require('../../../../core/config/leavePolicy');
const { buildCreditLedger, registerAllocation, monthKey } = require('./LeaveCreditLedger');

// Legacy, employee-level rows written by "Add Opening Balance". They form the carry-in at ledger start.
const OPENING_TYPES = ['OPENING_BALANCE', 'CREDIT', 'DEBIT', 'SET_BALANCE'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad2 = (n) => String(n).padStart(2, '0');
const round2 = (n) => Math.round(n * 100) / 100;
// Months are handled as a single integer index (year * 12 + month - 1) to make ranges trivial.
const monthIndex = (year, month) => year * 12 + (month - 1);
const fromIndex = (idx) => ({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });

/**
 * Parses the date formats found in this database (ISO `YYYY-MM-DD`, optionally with a time part)
 * plus `DD-MM-YYYY` / `DD/MM/YYYY`, without going through `new Date()` (which rejects DD-MM-YYYY
 * and shifts dates across time zones). Returns { year, month, day } or null.
 */
function parseDateParts(input) {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : { year: input.getFullYear(), month: input.getMonth() + 1, day: input.getDate() };
  }
  const s = String(input).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let parts = m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  if (!parts) {
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) parts = { year: +m[3], month: +m[2], day: +m[1] };
  }
  if (!parts) return null;
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) return null;
  return parts;
}

const toISO = (p) => `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;

function parseLedgerStart() {
  const [y, m] = policy.LEDGER_START_MONTH.split('-').map(Number);
  return { year: y, month: m, index: monthIndex(y, m), isoDate: `${y}-${pad2(m)}-01` };
}

function todayParts(now = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * Splits an approved leave's EL days across calendar months: EL is assigned to the leave's
 * earliest calendar days (the remainder of a long leave is LOP), so a leave spanning two months
 * is charged to the month(s) its EL days actually fall in.
 */
function elDaysByDate(leave) {
  const start = parseDateParts(leave.startDate);
  let remaining = Number(leave.elDays || 0);
  const out = [];
  if (!start || !(remaining > 0)) return out;
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  while (remaining > 0) {
    const share = Math.min(1, remaining);
    out.push({ date: toISO({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() }), idx: monthIndex(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1), days: share });
    remaining = round2(remaining - share);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function allocateElDaysByMonth(leave) {
  const out = new Map();
  for (const d of elDaysByDate(leave)) out.set(d.idx, round2((out.get(d.idx) || 0) + d.days));
  return out;
}

/**
 * Sunday/holiday credits store their kind in leaveType: "Special Earned - Sunday" or
 * "Special Earned - Holiday: <name>" (older credits have neither).
 */
function specialKind(leaveType) {
  const t = String(leaveType || '');
  const holiday = t.match(/^Special Earned - Holiday:\s*(.*)$/i);
  if (holiday) return { type: 'HOLIDAY', holidayName: holiday[1].trim() || null };
  if (/^Special Earned - Sunday$/i.test(t)) return { type: 'SUNDAY', holidayName: null };
  return { type: 'OTHER', holidayName: null };
}

function leaveMonthSpan(leave) {
  const s = parseDateParts(leave.startDate);
  const e = parseDateParts(leave.endDate) || s;
  if (!s) return [];
  const a = monthIndex(s.year, s.month);
  const b = Math.max(a, monthIndex(e.year, e.month));
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/**
 * Migration-period history (months between MIGRATION_START_MONTH and LEDGER_START_MONTH), written by the
 * Excel import or typed in by an admin. Each row sets one value; the latest row per (field, month) wins,
 * whatever its source. Once an employee has any migration row, "Add Opening Balance" rows created before
 * the first migration row are superseded (kept for audit, not counted), since the history replaces them.
 */
const MIGRATION_FIELDS = { MIGRATION_EARNED: 'earned', MIGRATION_SPECIAL: 'special', MIGRATION_CONSUMED: 'consumed' };
const MIGRATION_TYPES = ['MIGRATION_CARRY_FORWARD', ...Object.keys(MIGRATION_FIELDS)];

function parseMonthSetting(value) {
  const [y, m] = value.split('-').map(Number);
  return { year: y, month: m, index: monthIndex(y, m) };
}

function migrationState(adjustments) {
  const rows = adjustments.filter((a) => MIGRATION_TYPES.includes(a.adjustmentType));
  if (!rows.length) return null;
  const state = {
    firstTime: Math.min(...rows.map((a) => new Date(a.createdAt).getTime())),
    carry: null, carryHistory: [], months: new Map(),
    hasImport: rows.some((a) => a.relatedAdjustmentId), // the register (Excel import) is known for this employee
    importedCarry: null
  };
  let prevCarry = 0;
  const prevByKey = new Map();
  for (const a of rows) {
    const entry = { id: a.id, value: Number(a.days), reason: a.reason, adjustedBy: a.adjustedBy, createdAt: a.createdAt, fromImport: !!a.relatedAdjustmentId };
    if (a.adjustmentType === 'MIGRATION_CARRY_FORWARD') {
      entry.previousValue = a.previousValue ?? prevCarry;
      prevCarry = entry.value;
      state.carry = entry.value;
      if (entry.fromImport) state.importedCarry = entry.value;
      state.carryHistory.push(entry);
      continue;
    }
    if (!a.year || !a.month) continue;
    const idx = monthIndex(a.year, a.month);
    const field = MIGRATION_FIELDS[a.adjustmentType];
    const key = `${idx}:${field}`;
    entry.field = field;
    entry.previousValue = a.previousValue ?? prevByKey.get(key) ?? null;
    prevByKey.set(key, entry.value);
    const month = state.months.get(idx) || { earned: null, special: null, consumed: null, history: [], imported: {} };
    month[field] = entry.value;
    if (entry.fromImport) month.imported[field] = entry.value; // what the register said
    month.history.push(entry);
    state.months.set(idx, month);
  }
  return state;
}

const REGISTER_FIELDS = ['earned', 'special', 'consumed'];

/**
 * A history month compared with the register it was imported from. Sun/Hol is compared as the month's
 * total (register days without dates vs. now: days without dates + dated Sunday/holiday entries).
 * Returns { earned, special, consumed, differences: [{ field, register, now }] }.
 */
function registerComparison(mv, specialNow) {
  const imported = mv.imported || {};
  const register = { earned: Number(imported.earned ?? 0), special: Number(imported.special ?? 0), consumed: Number(imported.consumed ?? 0) };
  const now = { earned: Number(mv.earned || 0), special: round2(specialNow), consumed: Number(mv.consumed || 0) };
  const differences = REGISTER_FIELDS
    .filter((f) => round2(now[f]) !== round2(register[f]))
    .map((f) => ({ field: f, register: register[f], now: now[f] }));
  return { ...register, differences };
}

/**
 * Carry-in at the start of the ledger: the migration carry-forward (if any) followed by the
 * "Add Opening Balance" audit rows replayed in order (only rows made after migration history began).
 */
function computeOpeningBalance(adjustments, migration = null) {
  let balance = 0;
  const entries = [];
  if (migration && migration.carry !== null) {
    balance += migration.carry;
    const last = migration.carryHistory[migration.carryHistory.length - 1];
    entries.push({ id: last.id, adjustmentType: 'MIGRATION_CARRY_FORWARD', days: migration.carry, reason: last.reason, adjustedBy: last.adjustedBy, createdAt: last.createdAt });
  }
  for (const a of adjustments) {
    if (!OPENING_TYPES.includes(a.adjustmentType)) continue;
    const d = Number(a.days || 0);
    if (migration && new Date(a.createdAt).getTime() < migration.firstTime) {
      entries.push({ id: a.id, adjustmentType: a.adjustmentType, days: d, reason: a.reason, effectiveDate: a.effectiveDate, adjustedBy: a.adjustedBy, createdAt: a.createdAt, superseded: true });
      continue;
    }
    if (a.adjustmentType === 'DEBIT') balance = Math.max(0, balance - d);
    else if (a.adjustmentType === 'SET_BALANCE') balance = Math.max(0, d);
    else balance += d;
    entries.push({
      id: a.id, adjustmentType: a.adjustmentType, days: d, reason: a.reason,
      effectiveDate: a.effectiveDate, adjustedBy: a.adjustedBy, createdAt: a.createdAt
    });
  }
  return { openingBalance: round2(balance), openingEntries: entries };
}

function adjustmentVersion(adjustments) {
  let max = 0;
  for (const a of adjustments) {
    const t = new Date(a.updatedAt || a.createdAt || 0).getTime();
    if (t > max) max = t;
  }
  return `${adjustments.length}-${max}`;
}

/**
 * Pure ledger computation: no database access, so it can be unit-tested directly.
 * `adjustments` must be this employee's LeaveAdjustment rows ordered by createdAt ASC and
 * `leaves` this employee's APPROVED leave requests.
 *
 * Rules (see leavePolicy.js):
 *  - The ledger starts at LEDGER_START_MONTH with the migrated opening balance as carry-in.
 *  - Earned leave: EARNED_LEAVE_PER_MONTH for each month from max(ledger start, joining month)
 *    through the current month, unless an EARNED_LEAVE_OVERRIDE exists (latest override wins).
 *  - Special earned: sum of ACTIVE SPECIAL_EARNED_CREDIT rows dated in the month.
 *  - Consumed: EL days of approved requests falling in the month + signed CONSUMED_LEAVE_CORRECTIONs.
 *  - remaining(month) = opening + Σ(earned + special - consumed) up to and including that month.
 */
function computeLedger(employee, adjustments, leaves, year, options = {}) {
  const now = options.now || new Date();
  const today = todayParts(now);
  const currentIdx = monthIndex(today.year, today.month);
  const ledgerStart = parseLedgerStart();
  const joining = parseDateParts(employee.joiningDate);
  const joinIdx = joining ? monthIndex(joining.year, joining.month) : null;
  const firstEarnIdx = Math.max(ledgerStart.index, joinIdx === null ? ledgerStart.index : joinIdx);

  const migrationStart = parseMonthSetting(policy.MIGRATION_START_MONTH);
  let migration = migrationState(adjustments);
  // Dated Sunday/holiday credits inside the migration period are migration history too.
  const migrationCredits = adjustments.filter((a) => a.adjustmentType === 'SPECIAL_EARNED_CREDIT' && a.year && a.month
    && monthIndex(a.year, a.month) >= migrationStart.index && monthIndex(a.year, a.month) < ledgerStart.index);
  if (migrationCredits.length) {
    const creditTime = Math.min(...migrationCredits.map((a) => new Date(a.createdAt).getTime()));
    if (!migration) migration = { firstTime: creditTime, carry: null, carryHistory: [], months: new Map() };
    else migration.firstTime = Math.min(migration.firstTime, creditTime);
  }
  const { openingBalance, openingEntries } = computeOpeningBalance(adjustments, migration);
  // With migration history the running balance starts at the migration start; otherwise at the ledger start.
  const countFromIdx = migration ? migrationStart.index : ledgerStart.index;

  // --- bucket manual ledger rows by month ---
  const overridesByMonth = new Map();
  const specialByMonth = new Map();
  const reversedByMonth = new Map();
  const correctionsByMonth = new Map();
  const reversalByCredit = new Map();
  const defaultEarned = policy.EARNED_LEAVE_PER_MONTH;
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

  const remarkByCredit = new Map(); // latest edited remark of a Sunday/holiday credit
  for (const a of adjustments) {
    if (a.adjustmentType === 'SPECIAL_EARNED_REVERSAL' && a.relatedAdjustmentId) reversalByCredit.set(a.relatedAdjustmentId, a);
    if (a.adjustmentType === 'SPECIAL_EARNED_REMARK' && a.relatedAdjustmentId) remarkByCredit.set(a.relatedAdjustmentId, a);
  }
  for (const a of adjustments) {
    if (!a.year || !a.month) continue;
    const idx = monthIndex(a.year, a.month);
    if (a.adjustmentType === 'EARNED_LEAVE_OVERRIDE') push(overridesByMonth, idx, a);
    else if (a.adjustmentType === 'SPECIAL_EARNED_CREDIT') push(a.status === 'REVERSED' ? reversedByMonth : specialByMonth, idx, a);
    else if (a.adjustmentType === 'CONSUMED_LEAVE_CORRECTION') push(correctionsByMonth, idx, a);
  }

  // --- allocate approved leave EL days to months ---
  const consumedByMonth = new Map();
  const recordsByMonth = new Map();
  const leaveDaysByMonth = new Map(); // idx -> [{ date, days, leave }] EL days of approved requests
  for (const lv of leaves) {
    const alloc = allocateElDaysByMonth(lv);
    for (const [idx, days] of alloc) consumedByMonth.set(idx, round2((consumedByMonth.get(idx) || 0) + days));
    for (const d of elDaysByDate(lv)) push(leaveDaysByMonth, d.idx, { date: d.date, days: d.days, leave: lv });
    for (const idx of leaveMonthSpan(lv)) {
      push(recordsByMonth, idx, {
        id: lv.id, startDate: lv.startDate, endDate: lv.endDate, type: lv.type, reason: lv.reason,
        status: lv.status, totalDays: Number(lv.totalDays || 0), elDays: Number(lv.elDays || 0),
        lopDays: Number(lv.lopDays || 0), elDaysInMonth: alloc.get(idx) || 0,
        appliedAt: lv.appliedAt, actionBy: lv.actionBy || null,
        countedInLedger: idx >= ledgerStart.index
      });
    }
  }

  const describeSpecial = options.describeWorkDate || (() => ({}));
  const yearStartIdx = monthIndex(year, 1);
  const yearEndIdx = monthIndex(year, 12);
  const lastDataIdx = Math.max(yearEndIdx, monthIndex(today.year, 12), ...consumedByMonth.keys(), ...correctionsByMonth.keys());

  const months = [];
  let cumulative = openingBalance;
  let minRemaining = openingBalance;
  let minConsumed = 0;
  let balanceToday = openingBalance;
  let availableBalance = null; // lowest balance from the current month onward (approved future leave is committed)
  let lifetimeCredited = 0;
  let lifetimeConsumed = 0;

  let balanceAtLedgerStart = null;
  const creditMonths = []; // per counted month, input for the credit ledger (which credit each day used)

  for (let idx = Math.min(countFromIdx, yearStartIdx); idx <= lastDataIdx; idx++) {
    const { year: y, month: m } = fromIndex(idx);
    if (idx === ledgerStart.index) balanceAtLedgerStart = cumulative;
    const live = idx >= ledgerStart.index; // calculated by the portal
    const migrationMonth = !live && idx >= migrationStart.index; // history from the previous platform (editable)
    const migrated = migrationMonth && !!migration; // counted in the running balance
    const inLedger = live || migrated;
    const mv = migrated ? (migration.months.get(idx) || { earned: null, special: null, consumed: null, history: [], imported: {} }) : null;
    const eligible = live && idx >= firstEarnIdx && idx <= currentIdx;

    const overrides = live ? (overridesByMonth.get(idx) || []) : [];
    const latestOverride = overrides[overrides.length - 1] || null;
    const earnedLeave = migrated
      ? Number(mv.earned || 0)
      : (eligible ? Number(latestOverride ? latestOverride.days : defaultEarned) : 0);

    // Dated credits count in live and migrated months; migrated months add the undated imported/typed value.
    const specials = live || migrated ? (specialByMonth.get(idx) || []) : [];
    const datedSpecial = round2(specials.reduce((s, a) => s + Number(a.days), 0));
    const specialEarnedLeave = migrated ? round2(Number(mv.special || 0) + datedSpecial) : datedSpecial;

    const corrections = live ? (correctionsByMonth.get(idx) || []) : [];
    const consumedFromRequests = live ? (consumedByMonth.get(idx) || 0) : 0;
    const consumedCorrection = round2(corrections.reduce((s, a) => s + Number(a.days), 0));
    const consumedLeave = migrated ? Number(mv.consumed || 0) : round2(consumedFromRequests + consumedCorrection);

    if (inLedger) {
      cumulative = round2(cumulative + earnedLeave + specialEarnedLeave - consumedLeave);
      minRemaining = Math.min(minRemaining, cumulative);
      minConsumed = Math.min(minConsumed, consumedLeave);
      if (idx <= currentIdx) balanceToday = cumulative;
      if (idx >= currentIdx) availableBalance = availableBalance === null ? cumulative : Math.min(availableBalance, cumulative);
      lifetimeCredited = round2(lifetimeCredited + earnedLeave + specialEarnedLeave);
      lifetimeConsumed = round2(lifetimeConsumed + consumedLeave);

      creditMonths.push({
        year: y,
        month: m,
        el: earnedLeave,
        undatedSpecial: migrated ? Number(mv.special || 0) : 0,
        specials: specials.map((a) => ({ id: a.id, date: a.workDate, days: Number(a.days), ...specialKind(a.leaveType) })),
        leaveDays: live ? (leaveDaysByMonth.get(idx) || []).map((d) => ({ date: d.date, days: d.days, leaveId: d.leave.id, leaveType: d.leave.type })) : [],
        monthConsumed: live ? consumedCorrection : Number(mv.consumed || 0),
        // history months follow what the previous register recorded, when it recorded it
        registerNote: migrated && mv.consumed > 0
          ? registerAllocation(mv.history.filter((h) => h.field === 'consumed').reverse(), mv.consumed, y, m)
          : null
      });
    }

    if (idx < yearStartIdx || idx > yearEndIdx) continue;

    // Previous/new value for every override of this month: what the month showed before it was set.
    let prevValue = eligible ? defaultEarned : 0;
    const overrideHistory = overrides.map((o) => {
      const entry = {
        id: o.id,
        previousValue: o.previousValue !== undefined && o.previousValue !== null ? Number(o.previousValue) : prevValue,
        newValue: Number(o.days),
        reason: o.reason, adjustedBy: o.adjustedBy, createdAt: o.createdAt
      };
      prevValue = Number(o.days);
      return entry;
    });

    const mapSpecial = (a) => {
      const kind = specialKind(a.leaveType);
      const described = describeSpecial(a.workDate);
      const remark = remarkByCredit.get(a.id); // an edited remark replaces the original one
      return {
        id: a.id, workDate: a.workDate, days: Number(a.days), status: a.status,
        reason: remark ? remark.reason : a.reason,
        adjustedBy: remark ? remark.adjustedBy : a.adjustedBy,
        createdAt: remark ? remark.createdAt : a.createdAt,
        creditedBy: a.adjustedBy, creditedAt: a.createdAt,
        creditType: kind.type === 'OTHER' ? null : kind.type,
        creditLabel: kind.type === 'SUNDAY' ? 'Sunday' : kind.type === 'HOLIDAY' ? `Holiday: ${kind.holidayName || ''}`.trim() : null,
        reversal: reversalByCredit.has(a.id) ? {
          id: reversalByCredit.get(a.id).id, reason: reversalByCredit.get(a.id).reason,
          adjustedBy: reversalByCredit.get(a.id).adjustedBy, createdAt: reversalByCredit.get(a.id).createdAt
        } : null,
        ...described,
        holidayName: kind.holidayName || described.holidayName || null
      };
    };

    let ineligibleReason = null;
    if (migrated) ineligibleReason = 'Migration month: history from the previous platform';
    else if (migrationMonth) ineligibleReason = `Migration month: currently covered by the opening balance (${openingBalance} days). Entering monthly history replaces it.`;
    else if (!inLedger) ineligibleReason = 'Before the migration period';
    else if (joinIdx !== null && idx < joinIdx) ineligibleReason = 'Before joining date';
    else if (idx > currentIdx) ineligibleReason = 'Month not reached yet';

    const monthObj = {
      year: y,
      month: m,
      monthName: MONTH_NAMES[m - 1],
      inLedger,
      migrationMonth, // editable history month (earned / special / consumed typed in or imported)
      migrated, // migration history exists for this employee, so the month counts in the balance
      migrationValues: migrationMonth ? {
        earned: mv ? mv.earned : null,
        special: mv ? mv.special : null,
        consumed: mv ? mv.consumed : null
      } : null,
      migrationHistory: mv ? mv.history.slice().reverse() : [],
      // history month vs. the register it was imported from (null when there is no import)
      register: mv && migration.hasImport ? registerComparison(mv, specialEarnedLeave) : null,
      eligible,
      editable: eligible,
      ineligibleReason,
      earnedLeave,
      defaultEarnedLeave: eligible ? defaultEarned : 0,
      earnedLeaveOverride: overrideHistory.length ? overrideHistory[overrideHistory.length - 1] : null,
      earnedOverrideHistory: overrideHistory,
      specialEarnedLeave,
      specialEarnedRecords: specials.map(mapSpecial),
      reversedSpecialEarnedRecords: (live || migrationMonth ? (reversedByMonth.get(idx) || []) : []).map(mapSpecial),
      consumedLeave,
      consumedFromRequests,
      consumedCorrection,
      consumedCorrections: corrections.map((a) => ({
        id: a.id, deltaDays: Number(a.days), reason: a.reason, adjustedBy: a.adjustedBy, createdAt: a.createdAt
      })),
      consumedRecords: (recordsByMonth.get(idx) || []).map((r) => ({ ...r })),
      remainingBalance: inLedger ? cumulative : null
    };
    months.push(monthObj);
  }

  // ---- which credit every consumed day used (first earned, first used; register records for history) ----
  const creditLedger = buildCreditLedger({
    carry: openingBalance,
    carryType: migration ? 'CARRY_FORWARD' : 'OPENING',
    carryYear: (migration ? migrationStart.year : ledgerStart.year) - 1,
    months: creditMonths,
    elEarnedAt: policy.EL_EARNED_AT
  });
  for (const mo of months) mo.usage = mo.inLedger ? (creditLedger.byMonth.get(monthKey(mo.year, mo.month)) || null) : null;

  const ledgerMonths = months.filter((mm) => mm.inLedger);
  const lastOfYear = ledgerMonths[ledgerMonths.length - 1];

  return {
    employeeId: employee.id,
    empCode: employee.empCode || employee.id,
    name: employee.name,
    designation: employee.jobTitle || employee.designation || null,
    department: employee.department || null,
    status: employee.status,
    joiningDate: employee.joiningDate || null,
    joiningDateValid: !!joining,
    location: employee.location || null,
    profilePhoto: employee.profilePhotoUrl || employee.avatar || null,
    year,
    policy: {
      earnedLeavePerMonth: defaultEarned,
      ledgerStartMonth: policy.LEDGER_START_MONTH,
      migrationStartMonth: policy.MIGRATION_START_MONTH,
      leaveUnitStep: policy.LEAVE_UNIT_STEP,
      allowNegativeBalance: policy.ALLOW_NEGATIVE_BALANCE
    },
    openingBalance,
    openingEntries,
    migrationActive: !!migration,
    carryForward: migration ? migration.carry : null,
    carryForwardHistory: migration ? migration.carryHistory.slice().reverse() : [],
    // Everything in this year's history that no longer matches the imported register.
    registerChanges: [
      ...(migration && migration.hasImport && migration.importedCarry !== null && round2(migration.carry ?? 0) !== round2(migration.importedCarry)
        ? [{ month: null, field: 'carry', register: migration.importedCarry, now: migration.carry }] : []),
      ...months.filter((mo) => mo.register && mo.register.differences.length)
        .flatMap((mo) => mo.register.differences.map((d) => ({ month: mo.month, monthName: mo.monthName, ...d })))
    ],
    balanceAtLedgerStart: balanceAtLedgerStart === null ? openingBalance : balanceAtLedgerStart,
    months,
    // This year's credits (plus the carry-forward) in the order they are used, with what used each one.
    credits: creditLedger.credits.filter((c) => c.kind === 'CARRY' || c.year === year),
    // Days left by kind after all known consumption (EL includes the carry-forward).
    creditSummary: creditLedger.summary,
    yearSummary: {
      earnedLeave: round2(months.reduce((s, mm) => s + mm.earnedLeave, 0)),
      specialEarnedLeave: round2(months.reduce((s, mm) => s + mm.specialEarnedLeave, 0)),
      consumedLeave: round2(months.reduce((s, mm) => s + mm.consumedLeave, 0)),
      remainingBalance: lastOfYear ? lastOfYear.remainingBalance : null
    },
    currentBalance: balanceToday,
    availableBalance: availableBalance === null ? balanceToday : availableBalance,
    lifetimeCredited: round2(openingBalance + lifetimeCredited),
    lifetimeConsumed,
    minRemainingBalance: minRemaining,
    minMonthlyConsumed: minConsumed,
    version: adjustmentVersion(adjustments)
  };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Loads adjustments and approved leaves for a set of employees in two queries and attributes each
 * leave to exactly one employee: by user_id = employee id / emp code, falling back to the user name
 * only when the user_id matches no employee at all (old records), so names never double-match.
 */
async function loadSources(employees, { transaction } = {}) {
  const ids = employees.map((e) => e.id);
  const [adjustments, leaves, allEmployees] = await Promise.all([
    LeaveAdjustment.findAll({ where: { employeeId: { [Op.in]: ids } }, order: [['createdAt', 'ASC'], ['id', 'ASC']], transaction }),
    Leave.findAll({ where: { status: 'approved' }, transaction }),
    Employee.findAll({ attributes: ['id', 'empCode', 'name'], transaction })
  ]);

  const knownIds = new Set();
  for (const e of allEmployees) {
    knownIds.add(String(e.id).toLowerCase());
    if (e.empCode) knownIds.add(String(e.empCode).toLowerCase());
  }
  const byKey = new Map();
  const byName = new Map();
  for (const e of employees) {
    byKey.set(String(e.id).toLowerCase(), e.id);
    if (e.empCode) byKey.set(String(e.empCode).toLowerCase(), e.id);
    if (e.name) byName.set(String(e.name).trim().toLowerCase(), e.id);
  }

  const result = new Map(ids.map((id) => [id, { adjustments: [], leaves: [] }]));
  for (const a of adjustments) result.get(a.employeeId)?.adjustments.push(a);
  for (const lv of leaves) {
    const uid = String(lv.userId || '').toLowerCase();
    const owner = byKey.get(uid) || (!knownIds.has(uid) ? byName.get(String(lv.userName || '').trim().toLowerCase()) : undefined);
    if (owner) result.get(owner).leaves.push(lv);
  }
  return result;
}

/**
 * The employee's own holiday calendar(s): matched by work location (calendar location or name), falling
 * back only to a calendar marked as default, never to another location's calendar.
 * Returns { location, calendars: [names], holidays: Map(YYYY-MM-DD -> holiday name) }.
 */
async function employeeHolidayCalendar(employee, { transaction } = {}) {
  const location = String(employee.location || employee.holidayDetails || '').trim();
  const loc = location.toLowerCase();
  const calendars = await HolidayCalendar.findAll({ transaction });
  let usable = loc
    ? calendars.filter((c) => String(c.location || '').trim().toLowerCase() === loc || String(c.name || '').trim().toLowerCase().includes(loc))
    : [];
  if (!usable.length) usable = calendars.filter((c) => c.isDefault);
  const holidays = new Map();
  for (const c of usable) {
    let list = c.holidays;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
    for (const h of Array.isArray(list) ? list : []) {
      const p = h && parseDateParts(h.date);
      if (p) holidays.set(toISO(p), String(h.title || h.name || 'Holiday').trim());
    }
  }
  return { location: location || null, calendars: usable.map((c) => c.name), holidays };
}

/** Sundays and the employee's calendar holidays in one month, for the special-earned date picker. */
async function getSpecialEarnedDateOptions(employee, year, month, { transaction } = {}) {
  const { location, calendars, holidays } = await employeeHolidayCalendar(employee, { transaction });
  const now = new Date();
  const today = toISO({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  const joining = parseDateParts(employee.joiningDate);
  const joiningISO = joining ? toISO(joining) : null;
  const credited = new Set((await LeaveAdjustment.findAll({
    attributes: ['workDate'],
    where: { employeeId: employee.id, adjustmentType: 'SPECIAL_EARNED_CREDIT', status: 'ACTIVE' },
    transaction
  })).map((a) => a.workDate));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const option = (iso, extra) => ({
    date: iso,
    ...extra,
    alreadyCredited: credited.has(iso),
    disabledReason: iso > today ? 'Future date' : (joiningISO && iso < joiningISO ? 'Before joining' : (credited.has(iso) ? 'Already credited' : null))
  });
  const sundays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toISO({ year, month, day: d });
    if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === 0) sundays.push(option(iso, { holidayName: holidays.get(iso) || null }));
  }
  const monthHolidays = [...holidays.entries()]
    .filter(([iso]) => iso.startsWith(`${year}-${pad2(month)}-`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, name]) => option(iso, { name, isSunday: new Date(`${iso}T00:00:00Z`).getUTCDay() === 0 }));
  return { location, calendars, sundays, holidays: monthHolidays };
}

/** Holiday/Sunday/attendance context for special-earned work dates (display/verification only). */
async function buildWorkDateDescriber(employee, workDates, { transaction } = {}) {
  const { holidays } = await employeeHolidayCalendar(employee, { transaction });

  const dates = [...new Set(workDates.filter(Boolean))];
  const attended = new Set();
  if (dates.length) {
    const rows = await Attendance.findAll({
      attributes: ['date'],
      where: { userId: { [Op.in]: [employee.empCode, employee.id].filter(Boolean) }, date: { [Op.in]: dates } },
      transaction
    });
    for (const r of rows) attended.add(String(r.date).slice(0, 10));
  }

  return (workDate) => {
    const p = parseDateParts(workDate);
    if (!p) return { isSunday: false, holidayName: null, attendanceFound: false, dayName: null };
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    const iso = toISO(p);
    return {
      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow],
      isSunday: dow === 0,
      holidayName: holidays.get(iso) || null,
      attendanceFound: attended.has(iso)
    };
  };
}

async function getEmployeeMonthlyLedger(employee, year, { transaction, withContext = true } = {}) {
  const sources = (await loadSources([employee], { transaction })).get(employee.id);
  let describeWorkDate;
  if (withContext) {
    const workDates = sources.adjustments.filter((a) => a.adjustmentType === 'SPECIAL_EARNED_CREDIT').map((a) => a.workDate);
    describeWorkDate = await buildWorkDateDescriber(employee, workDates, { transaction });
  }
  const ledger = computeLedger(employee, sources.adjustments, sources.leaves, year, { describeWorkDate });
  ledger.history = sources.adjustments.slice().reverse().map((a) => ({
    id: a.id, adjustmentType: a.adjustmentType, year: a.year, month: a.month, workDate: a.workDate,
    days: Number(a.days), status: a.status, reason: a.reason, adjustedBy: a.adjustedBy,
    relatedAdjustmentId: a.relatedAdjustmentId, createdAt: a.createdAt
  }));
  return ledger;
}

/** One ledger per employee for list/summary pages, using the same computation (never approximated). */
async function getLedgersForEmployees(employees, year) {
  const sources = await loadSources(employees);
  return employees.map((e) => {
    const s = sources.get(e.id);
    return computeLedger(e, s.adjustments, s.leaves, year);
  });
}

/**
 * Balance figures for the older screens/APIs (leave requests list, employee profile, leave apply),
 * so every screen shows the same numbers as the Leave Balances ledger.
 * Returns Map(employeeId -> { available, credited, consumed }).
 */
async function getBalanceSnapshots(employees) {
  if (!employees.length) return new Map();
  const ledgers = await getLedgersForEmployees(employees, new Date().getFullYear());
  return new Map(ledgers.map((l) => [l.employeeId, {
    opening: l.openingBalance,
    elLeft: l.creditSummary.el,
    specialLeft: l.creditSummary.special,
    ledgerStartMonth: l.policy.ledgerStartMonth,
    available: Math.max(0, l.availableBalance),
    credited: l.lifetimeCredited,
    consumed: l.lifetimeConsumed
  }]));
}

module.exports = {
  computeLedger,
  employeeHolidayCalendar,
  getSpecialEarnedDateOptions,
  getBalanceSnapshots,
  getEmployeeMonthlyLedger,
  getLedgersForEmployees,
  buildWorkDateDescriber,
  parseDateParts,
  parseLedgerStart,
  allocateElDaysByMonth,
  monthIndex,
  toISO,
  OPENING_TYPES,
  MIGRATION_TYPES,
  parseMonthSetting
};
