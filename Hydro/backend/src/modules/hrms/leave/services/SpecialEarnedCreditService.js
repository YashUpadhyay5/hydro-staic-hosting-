const { v5: uuidv5 } = require('uuid');
const { Op, Transaction } = require('sequelize');
const sequelize = require('../../../../config/database');
const WorkdayCalendarService = require('../../../../shared/services/WorkdayCalendarService');
const LeaveAdjustment = require('../../../../shared/models/LeaveAdjustment');
const SpecialShiftVerification = require('../../../../shared/models/SpecialShiftVerification');
const { Employee, Attendance, HolidayCalendar, PayrollRun, Footprint } = require('../../../../shared/models');
const policy = require('../../../../core/config/leavePolicy');
const LeaveBalanceService = require('./LeaveBalanceService');

const { parseDateParts, toISO } = LeaveBalanceService;

// Sunday / holiday shift lifecycle (special earned leave):
//   attendance on a weekly off or holiday -> SPECIAL_EARNED_CREDIT row with status PENDING (0 days, counts nothing)
//   admin approves -> ACTIVE with the approved days (counted by LeaveBalanceService like any other credit)
//   admin rejects  -> REJECTED (0 days, never counted); the attendance itself is untouched
//   an approved credit is reversed through the Leave Balances ledger (REVERSED + SPECIAL_EARNED_REVERSAL row)
// The attendance evidence and the decision audit live in special_shift_verifications.

const SYSTEM_ACTOR = 'System (Attendance Sync)';
// Fixed namespace: one employee + work date always maps to the same credit id, so retries,
// recalculations and concurrent syncs can never create a second credit for the same shift.
const SHIFT_NAMESPACE = 'b8a1f0d2-3c4e-4f6a-9b7d-2e5c8a1f0d3b';
const MAX_BATCH = 100;
const MAX_TEXT = 500;
const SYNC_THROTTLE_MS = 30000;
// SQLite: take the write lock when the transaction starts, so concurrent decisions queue up instead of failing
// with SQLITE_BUSY (the type is ignored on Postgres, where the PENDING-only update is the guard).
const WRITE_TX = { type: Transaction.TYPES.IMMEDIATE };

class ShiftError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const meaningful = (t) => /[a-z0-9]/i.test(text(t));
const isBlankPunch = (v) => v === null || v === undefined || ['', 'null', 'undefined', '-'].includes(String(v).trim().toLowerCase());
const shiftCreditId = (employeeId, workDate) => uuidv5(`special-shift:${employeeId}:${workDate}`, SHIFT_NAMESPACE);

const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const IST_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const IST_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' });
const todayIST = (now = new Date()) => IST_DATE.format(now);

/** Seconds after midnight (IST) of a recorded punch: "09:05:12 AM", "17:40" or a full ISO timestamp; null if unreadable. */
function punchSeconds(value) {
  if (isBlankPunch(value)) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const sec = Number(m[3] || 0);
    const ampm = m[4] ? m[4].toUpperCase() : null;
    if (min > 59 || sec > 59) return null;
    if (ampm) {
      if (h < 1 || h > 12) return null;
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
    } else if (h > 23) {
      return null;
    }
    return h * 3600 + min * 60 + sec;
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const [hh, mm, ss] = IST_TIME.format(d).split(':').map(Number);
    return (hh % 24) * 3600 + mm * 60 + ss;
  }
  return null;
}

/**
 * Working time of one day from its attendance sessions. Every closed session is an interval; a check-out
 * earlier than the check-in only counts as an overnight shift under ShiftEngine's rule (in at/after 19:00,
 * out by 12:00). Overlapping sessions (double taps, merged reconnects) are counted once. Unreadable,
 * zero-length or inverted punches add no time and are reported, never replaced by assumed hours.
 * `isToday`: an unclosed session today is a shift in progress; on an earlier day it is a missing check-out.
 */
function summarizeDay(sessions, { isToday = false } = {}) {
  const intervals = [];
  const issues = new Set();
  let open = false;
  let hasCheckIn = false;
  let autoClockOut = false;
  for (const s of sessions) {
    const inBlank = isBlankPunch(s.checkIn);
    const outBlank = isBlankPunch(s.checkOut);
    if (inBlank && outBlank) continue;
    if (!inBlank) hasCheckIn = true;
    if (inBlank) { issues.add('MISSING_CHECK_IN'); continue; }
    const inSecs = punchSeconds(s.checkIn);
    if (inSecs === null) { issues.add('UNREADABLE_CHECK_IN'); continue; }
    if (outBlank) { open = true; continue; }
    const outSecs = punchSeconds(s.checkOut);
    if (outSecs === null) { issues.add('UNREADABLE_CHECK_OUT'); continue; }
    let duration = outSecs - inSecs;
    if (duration < 0 && inSecs >= 19 * 3600 && outSecs <= 12 * 3600) duration += 86400;
    if (duration === 0) { issues.add('ZERO_DURATION'); continue; }
    if (duration < 0) { issues.add('CHECK_OUT_BEFORE_CHECK_IN'); continue; }
    if (String(s.clockOutMethod || '').toUpperCase().startsWith('AUTO')) autoClockOut = true;
    intervals.push({ id: s.id, start: inSecs, end: inSecs + duration, checkIn: s.checkIn, checkOut: s.checkOut });
  }
  if (open && !isToday) issues.add('MISSING_CHECK_OUT');

  intervals.sort((a, b) => a.start - b.start);
  let totalSecs = 0;
  let curStart = null;
  let curEnd = null;
  for (const iv of intervals) {
    if (curEnd === null || iv.start > curEnd) {
      if (curEnd !== null) totalSecs += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    } else {
      curEnd = Math.max(curEnd, iv.end);
    }
  }
  if (curEnd !== null) totalSecs += curEnd - curStart;
  const last = intervals.reduce((best, iv) => (!best || iv.end > best.end ? iv : best), null);

  return {
    totalSeconds: totalSecs,
    hours: Math.round((totalSecs / 3600) * 10000) / 10000,
    closedSessions: intervals.length,
    hasCheckIn,
    open,
    autoClockOut,
    issues: [...issues],
    checkIn: intervals.length ? intervals[0].checkIn : null,
    checkOut: last ? last.checkOut : null,
    attendanceIds: sessions.map((s) => s.id).filter(Boolean),
    status: open && isToday ? 'OPEN_SESSION' : (issues.size ? 'INVALID_PUNCH' : 'COMPLETE')
  };
}

/** Calculated credit for a shift of `totalSeconds` (exact time, so 5 h 59 m never rounds up to the 6 h rule). */
function eligibleDaysFor(totalSeconds, rules = policy.SPECIAL_SHIFT_CREDIT_RULES) {
  const hours = totalSeconds / 3600;
  const rule = [...rules].sort((a, b) => b.minHours - a.minHours).find((r) => hours >= r.minHours);
  return rule ? Math.min(rule.days, policy.SPECIAL_SHIFT_MAX_DAYS) : 0;
}

const isStep = (n) => Number.isFinite(n) && Math.abs(n / policy.LEAVE_UNIT_STEP - Math.round(n / policy.LEAVE_UNIT_STEP)) < 1e-9;
const monthBeforeAutoStart = (iso) => iso.slice(0, 7) < policy.SPECIAL_SHIFT_AUTO_START_MONTH;

function employeeIdVariants(emp) {
  const ids = new Set();
  for (const v of [emp.id, emp.empCode, emp.emp_code]) {
    if (!v) continue;
    ids.add(String(v));
    ids.add(String(v).toUpperCase());
    ids.add(String(v).toLowerCase());
  }
  return [...ids];
}

function dateVariants(iso) {
  const [y, m, d] = iso.split('-');
  return [iso, `${d}-${m}-${y}`];
}

/** Sunday/weekly off or holiday for this employee (WorkdayCalendarService rules); null for a regular day or approved leave. */
async function classifyDay(emp, iso) {
  const dayEval = await WorkdayCalendarService.evaluateEmployeeDay(emp, iso);
  if (dayEval.reason === 'WEEKLY_OFF') return { dayType: 'SUNDAY', holidayName: null };
  if (dayEval.reason === 'HOLIDAY') return { dayType: 'HOLIDAY', holidayName: dayEval.details || 'Holiday' };
  return null;
}

async function loadDaySessions(emp, iso) {
  return Attendance.findAll({
    where: { userId: { [Op.in]: employeeIdVariants(emp) }, date: { [Op.in]: dateVariants(iso) } },
    order: [['createdAt', 'ASC']]
  });
}

const creditLeaveType = (kind) => (kind.dayType === 'SUNDAY' ? 'Special Earned - Sunday' : `Special Earned - Holiday: ${kind.holidayName || 'Holiday'}`);
const dayLabel = (kind) => (kind.dayType === 'SUNDAY' ? 'Sunday' : `holiday (${kind.holidayName || 'Holiday'})`);
const fmtHours = (h) => {
  const mins = Math.round(Number(h || 0) * 60);
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} m`;
};

function snapshotFields(summary, kind, eligibleDays, now) {
  return {
    dayType: kind.dayType,
    holidayName: kind.holidayName,
    attendanceIds: JSON.stringify(summary.attendanceIds),
    checkIn: summary.checkIn,
    checkOut: summary.checkOut,
    workingHours: summary.hours,
    eligibleDays,
    attendanceStatus: summary.status,
    punchIssues: JSON.stringify(summary.issues),
    autoClockOut: summary.autoClockOut,
    evaluatedAt: now
  };
}

const sameSnapshot = (v, fields) => ['dayType', 'holidayName', 'attendanceIds', 'checkIn', 'checkOut', 'workingHours', 'eligibleDays', 'attendanceStatus', 'punchIssues', 'autoClockOut']
  .every((k) => String(v[k] ?? '') === String(fields[k] ?? ''));

const parseJsonList = (raw) => {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

const syncState = new Map(); // month -> { at, promise }

class SpecialEarnedCreditService {
  /**
   * Records a Sunday/weekly-off or holiday shift as a PENDING special earned credit (it does not change the
   * balance). Called after attendance punches and by the monthly sync; safe to call any number of times:
   *  - one credit per employee and date (deterministic id + unique index);
   *  - a PENDING record is refreshed when the punches change;
   *  - an approved/rejected/reversed decision is never changed here; later attendance changes are only flagged;
   *  - nothing is recorded before a shift has a check-out (or, for an earlier day, at least a check-in).
   *
   * @returns {Promise<{ credited: false, pending?: boolean, reason: string, record?: Object }>}
   */
  static async evaluateAndCredit(record, emp, options = {}) {
    try {
      if (!record || (isBlankPunch(record.checkIn) && isBlankPunch(record.checkOut))) return { credited: false, reason: 'NO_VALID_PUNCH' };
      if (!emp) return { credited: false, reason: 'NO_EMPLOYEE' };
      const parts = parseDateParts(record.date);
      if (!parts) return { credited: false, reason: 'INVALID_DATE' };
      const iso = toISO(parts);
      const today = todayIST(options.now);
      if (iso > today) return { credited: false, reason: 'FUTURE_DATE' };
      if (monthBeforeAutoStart(iso)) return { credited: false, reason: 'BEFORE_AUTO_START' };
      // A clock-in today starts a shift; it is evaluated at clock-out.
      if (iso === today && isBlankPunch(record.checkOut)) return { credited: false, reason: 'SHIFT_IN_PROGRESS' };

      const kind = await classifyDay(emp, iso);
      if (!kind) return { credited: false, reason: 'REGULAR_WORKDAY' };

      const summary = summarizeDay(await loadDaySessions(emp, iso), { isToday: iso === today });
      if (summary.closedSessions === 0 && (iso === today || !summary.hasCheckIn)) return { credited: false, reason: 'SHIFT_NOT_COMPLETE' };
      const eligibleDays = eligibleDaysFor(summary.totalSeconds);
      return await this.recordShift(emp, iso, kind, summary, eligibleDays);
    } catch (error) {
      console.error('[SpecialEarnedCreditService] Error evaluating shift:', error.message);
      return { credited: false, error: error.message };
    }
  }

  static async recordShift(emp, iso, kind, summary, eligibleDays) {
    const now = new Date();
    const fields = snapshotFields(summary, kind, eligibleDays, now);
    const existing = await SpecialShiftVerification.findOne({ where: { employeeId: emp.id, workDate: iso } });
    if (existing) {
      const credit = await LeaveAdjustment.findByPk(existing.adjustmentId);
      if (credit && credit.status === 'PENDING') {
        if (sameSnapshot(existing, fields)) return { credited: false, pending: true, reason: 'PENDING_UNCHANGED', record: credit };
        await existing.update(fields);
        return { credited: false, pending: true, reason: 'PENDING_UPDATED', record: credit };
      }
      // Decided already: keep the decision, flag a later attendance change for the reviewer.
      const changed = round2(Number(existing.workingHours)) !== round2(summary.hours) || existing.attendanceStatus !== summary.status;
      if (changed && (!existing.changedAfterDecision || round2(Number(existing.latestWorkingHours)) !== round2(summary.hours))) {
        await existing.update({ changedAfterDecision: true, latestWorkingHours: summary.hours, evaluatedAt: now });
      }
      return { credited: false, reason: 'ALREADY_DECIDED', record: credit };
    }

    // A credit typed in through Leave Balances (or auto-credited before verification existed) is the decision.
    const other = await LeaveAdjustment.findOne({
      where: { employeeId: emp.id, workDate: iso, adjustmentType: 'SPECIAL_EARNED_CREDIT', status: { [Op.in]: ['ACTIVE', 'REVERSED', 'PENDING'] } }
    });
    if (other) return { credited: false, reason: 'ALREADY_CREDITED', record: other };

    const id = shiftCreditId(emp.id, iso);
    try {
      const credit = await sequelize.transaction(WRITE_TX, async (transaction) => {
        const row = await LeaveAdjustment.create({
          id,
          employeeId: emp.id,
          empCode: emp.empCode || emp.emp_code || emp.id,
          employeeName: emp.name,
          leaveType: creditLeaveType(kind),
          adjustmentType: 'SPECIAL_EARNED_CREDIT',
          days: 0,
          reason: `Awaiting verification: worked on ${dayLabel(kind)} ${iso}`,
          effectiveDate: iso,
          workDate: iso,
          year: Number(iso.slice(0, 4)),
          month: Number(iso.slice(5, 7)),
          adjustedBy: SYSTEM_ACTOR,
          status: 'PENDING'
        }, { transaction });
        await SpecialShiftVerification.create({
          adjustmentId: id,
          employeeId: emp.id,
          empCode: emp.empCode || emp.emp_code || emp.id,
          employeeName: emp.name,
          department: emp.department || null,
          workDate: iso,
          ...fields
        }, { transaction });
        return row;
      });
      console.log(`[SpecialEarnedCreditService] Recorded pending ${kind.dayType} shift for ${emp.name} (${emp.id}) on ${iso}: ${summary.hours} h, calculated credit ${eligibleDays} day(s)`);
      return { credited: false, pending: true, reason: 'PENDING_CREATED', record: credit };
    } catch (err) {
      // Another evaluation of the same shift won the race on the unique keys.
      if (err.name === 'SequelizeUniqueConstraintError') return { credited: false, pending: true, reason: 'ALREADY_EXISTS' };
      throw err;
    }
  }

  /**
   * Evaluates every Sunday/holiday attendance of a month (YYYY-MM) once per employee and date. Idempotent.
   * Calls within a short interval share one run unless `force` is set.
   */
  static async syncCreditsForMonth(monthStr, { force = false } = {}) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthStr || ''))) monthStr = todayIST().slice(0, 7);
    const state = syncState.get(monthStr);
    if (state && (state.promise || (!force && Date.now() - state.at < SYNC_THROTTLE_MS))) {
      return state.promise || { success: true, month: monthStr, skipped: 'RECENTLY_SYNCED' };
    }
    const promise = this.runMonthSync(monthStr).finally(() => syncState.set(monthStr, { at: Date.now(), promise: null }));
    syncState.set(monthStr, { at: Date.now(), promise });
    return promise;
  }

  static async runMonthSync(monthStr) {
    try {
      if (`${monthStr}-31` < `${policy.SPECIAL_SHIFT_AUTO_START_MONTH}-01`) {
        return { success: true, month: monthStr, totalAttendanceRecords: 0, evaluated: 0, newlyPending: 0, skipped: 'BEFORE_AUTO_START' };
      }
      const allEmployees = await Employee.findAll({ where: { status: { [Op.in]: ['ACTIVE', 'active'] } } });
      const empMap = new Map();
      allEmployees.forEach((e) => {
        empMap.set(String(e.id).toLowerCase(), e);
        if (e.empCode) empMap.set(String(e.empCode).toLowerCase(), e);
        if (e.emp_code) empMap.set(String(e.emp_code).toLowerCase(), e);
        if (e.name) empMap.set(String(e.name).toLowerCase(), e);
      });

      const attendanceRecords = await Attendance.findAll({
        where: {
          date: { [Op.like]: `${monthStr}%` },
          [Op.or]: [{ checkIn: { [Op.ne]: null } }, { checkOut: { [Op.ne]: null } }]
        }
      });

      // Cheap pre-filter so only weekly offs and calendar holiday dates reach the per-employee calendar check.
      const holidayDates = new Set();
      for (const cal of await HolidayCalendar.findAll({ raw: true })) {
        let list = cal.holidays;
        if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
        for (const h of Array.isArray(list) ? list : []) {
          const p = h && parseDateParts(h.date);
          if (p) holidayDates.add(toISO(p));
        }
      }

      const groups = new Map();
      for (const rec of attendanceRecords) {
        const emp = empMap.get(String(rec.userId || '').trim().toLowerCase()) || empMap.get(String(rec.userName || '').trim().toLowerCase());
        const parts = parseDateParts(rec.date);
        if (!emp || !parts) continue;
        const iso = toISO(parts);
        const weekday = IST_WEEKDAY.format(new Date(`${iso}T12:00:00+05:30`)).toLowerCase();
        const weeklyOff = String(emp.weeklyOffs || 'Sunday').toLowerCase().includes(weekday);
        if (!weeklyOff && !holidayDates.has(iso)) continue;
        const key = `${emp.id}|${iso}`;
        const group = groups.get(key) || { emp, rec: null };
        // Prefer a closed session as the trigger so a finished shift is never skipped as "in progress".
        if (!group.rec || (isBlankPunch(group.rec.checkOut) && !isBlankPunch(rec.checkOut))) group.rec = rec;
        groups.set(key, group);
      }

      let newlyPending = 0;
      const created = [];
      for (const { emp, rec } of groups.values()) {
        const res = await this.evaluateAndCredit(rec, emp);
        if (res.reason === 'PENDING_CREATED') {
          newlyPending++;
          created.push({ employeeId: emp.id, name: emp.name, date: rec.date, type: res.record?.leaveType });
        }
      }
      return { success: true, month: monthStr, totalAttendanceRecords: attendanceRecords.length, evaluated: groups.size, newlyPending, pending: created };
    } catch (err) {
      console.error('[SpecialEarnedCreditService] syncCreditsForMonth error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Sunday/holiday credits dated in a month or date range, with their attendance evidence and decision.
   * Credits without a verification record (typed in through Leave Balances, or auto-credited before the
   * verification workflow) are included as already decided.
   */
  static async listShifts({ from, to, status, dayType, search, withLocation = false, includeRegister = false } = {}) {
    const where = { adjustmentType: 'SPECIAL_EARNED_CREDIT', workDate: { [Op.between]: [from, to] } };
    if (status) where.status = status;
    const credits = await LeaveAdjustment.findAll({ where, order: [['workDate', 'ASC'], ['employeeName', 'ASC']] });
    const ids = credits.map((c) => c.id);
    const verifications = ids.length ? await SpecialShiftVerification.findAll({ where: { adjustmentId: { [Op.in]: ids } } }) : [];
    const byCredit = new Map(verifications.map((v) => [v.adjustmentId, v]));
    const empIds = [...new Set(credits.map((c) => c.employeeId))];
    const employees = empIds.length ? await Employee.findAll({ where: { id: { [Op.in]: empIds } } }) : [];
    const empById = new Map(employees.map((e) => [e.id, e]));

    let items = credits.map((c) => {
      const v = byCredit.get(c.id);
      const emp = empById.get(c.employeeId);
      const holiday = String(c.leaveType || '').match(/^Special Earned - Holiday:\s*(.*)$/i);
      const type = v ? v.dayType : (holiday ? 'HOLIDAY' : 'SUNDAY');
      const workDate = c.workDate;
      return {
        adjustmentId: c.id,
        status: c.status || 'ACTIVE',
        source: v ? 'ATTENDANCE' : (c.adjustedBy === SYSTEM_ACTOR ? 'LEGACY_AUTO' : 'MANUAL'),
        employeeId: c.employeeId,
        empCode: c.empCode || (emp && emp.empCode) || c.employeeId,
        employeeName: (emp && emp.name) || c.employeeName,
        department: (emp && emp.department) || (v && v.department) || null,
        departmentAtShift: v ? v.department : null,
        employeeStatus: emp ? emp.status : null,
        workDate,
        dayType: type,
        isSunday: new Date(`${workDate}T00:00:00Z`).getUTCDay() === 0,
        holidayName: v ? v.holidayName : (holiday ? holiday[1].trim() || 'Holiday' : null),
        checkIn: v ? v.checkIn : null,
        checkOut: v ? v.checkOut : null,
        workingHours: v ? Number(v.workingHours) : null,
        eligibleDays: v ? Number(v.eligibleDays) : null,
        attendanceStatus: v ? v.attendanceStatus : null,
        punchIssues: v ? parseJsonList(v.punchIssues) : [],
        autoClockOut: v ? !!v.autoClockOut : false,
        attendanceIds: v ? parseJsonList(v.attendanceIds) : [],
        approvedDays: c.status === 'ACTIVE' || c.status === 'REVERSED' ? Number(c.days) : 0,
        verifiedBy: v ? v.verifiedBy : (c.status === 'PENDING' ? null : c.adjustedBy),
        verifiedByName: v ? v.verifiedByName : (c.status === 'PENDING' ? null : c.adjustedBy),
        verifiedAt: v ? v.verifiedAt : (c.status === 'PENDING' ? null : c.createdAt),
        rejectionReason: v ? v.rejectionReason : null,
        overrideApplied: v ? !!v.overrideApplied : false,
        overrideReason: v ? v.overrideReason : null,
        changedAfterDecision: v ? !!v.changedAfterDecision : false,
        latestWorkingHours: v && v.latestWorkingHours !== null ? Number(v.latestWorkingHours) : null,
        reason: c.reason
      };
    });

    if (includeRegister && (!status || status === 'ACTIVE')) items = items.concat(await this.registerShifts({ from, to }));
    if (dayType) items = items.filter((i) => i.dayType === dayType);
    const q = text(search).toLowerCase();
    if (q) {
      items = items.filter((i) => [i.employeeName, i.empCode, i.employeeId, i.department].some((f) => String(f || '').toLowerCase().includes(q)));
    }
    await this.attachAttendance(items.filter((i) => i.source !== 'ATTENDANCE' && i.workDate), empById);
    await this.attachDeciderNames(items);
    if (withLocation) await this.attachLocation(items);
    return items;
  }

  /**
   * Who decided, by employee name. Decisions store the user id (and older ones a label built from the
   * login e-mail, "email (id)"); the name is looked up from the employee record for that id.
   */
  static async attachDeciderNames(items) {
    const idOf = (i) => (i.source === 'ATTENDANCE'
      ? i.verifiedBy
      : ((String(i.verifiedByName || '').match(/\(([^()]+)\)\s*$/) || [])[1] || null));
    const ids = [...new Set(items.map(idOf).filter(Boolean).map(String))];
    if (!ids.length) return;
    const emps = await Employee.findAll({ attributes: ['id', 'empCode', 'name'], where: { [Op.or]: [{ id: { [Op.in]: ids } }, { empCode: { [Op.in]: ids } }] } });
    const names = new Map();
    for (const e of emps) {
      names.set(String(e.id), e.name);
      if (e.empCode) names.set(String(e.empCode), e.name);
    }
    for (const i of items) {
      const id = idOf(i);
      if (!id) continue;
      if (names.has(String(id))) i.verifiedByName = names.get(String(id));
      else if (String(id).toUpperCase() === 'ADMIN') i.verifiedByName = 'Admin';
    }
  }

  /**
   * Sun/Hol month totals without dates from the register (migration months, Excel import or typed in),
   * taken from the Leave Balances ledger itself so both pages always show the same figures.
   */
  static async registerShifts({ from, to }) {
    const rows = await LeaveAdjustment.findAll({ attributes: ['employeeId', 'year'], where: { adjustmentType: 'MIGRATION_SPECIAL' }, raw: true });
    if (!rows.length) return [];
    const employees = await Employee.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((r) => r.employeeId))] } } });
    const years = [...new Set(rows.map((r) => Number(r.year)).filter(Boolean))];
    const items = [];
    for (const year of years) {
      for (const l of await LeaveBalanceService.getLedgersForEmployees(employees, year)) {
        for (const m of l.months) {
          const days = m.migrated && m.migrationValues ? Number(m.migrationValues.special || 0) : 0;
          const period = `${m.year}-${String(m.month).padStart(2, '0')}`;
          if (!(days > 0) || period < from.slice(0, 7) || period > to.slice(0, 7)) continue;
          const latest = m.migrationHistory.find((h) => h.field === 'special') || null; // history is newest first
          items.push({
            adjustmentId: latest ? latest.id : `register-${l.employeeId}-${period}`,
            status: 'ACTIVE', source: 'REGISTER',
            employeeId: l.employeeId, empCode: l.empCode, employeeName: l.name, department: l.department, employeeStatus: l.status,
            workDate: null, period, dayType: null, isSunday: false, holidayName: null,
            checkIn: null, checkOut: null, workingHours: null, eligibleDays: null, attendanceStatus: null,
            punchIssues: [], autoClockOut: false, attendanceIds: [],
            approvedDays: days,
            verifiedBy: latest ? latest.adjustedBy : null, verifiedByName: latest ? latest.adjustedBy : null, verifiedAt: latest ? latest.createdAt : null,
            rejectionReason: null, overrideApplied: false, overrideReason: null, changedAfterDecision: false, latestWorkingHours: null,
            reason: latest ? latest.reason : null
          });
        }
      }
    }
    return items;
  }

  /**
   * Credits made before verification existed (or typed in through Leave Balances) store no punches:
   * show the day's actual attendance for them, read-only. Days without attendance stay empty.
   */
  static async attachAttendance(items, empById) {
    const targets = items.filter((i) => empById.has(i.employeeId));
    if (!targets.length) return;
    const userIds = new Set();
    const dates = new Set();
    for (const i of targets) {
      employeeIdVariants(empById.get(i.employeeId)).forEach((v) => userIds.add(v));
      dateVariants(i.workDate).forEach((d) => dates.add(d));
    }
    const sessions = await Attendance.findAll({
      where: { userId: { [Op.in]: [...userIds] }, date: { [Op.in]: [...dates] } },
      order: [['createdAt', 'ASC']]
    });
    const today = todayIST();
    for (const i of targets) {
      const ids = new Set(employeeIdVariants(empById.get(i.employeeId)));
      const own = sessions.filter((s) => ids.has(String(s.userId)) && (() => { const p = parseDateParts(s.date); return p && toISO(p) === i.workDate; })());
      if (!own.length) continue;
      const day = summarizeDay(own, { isToday: i.workDate === today });
      i.checkIn = day.checkIn || own[0].checkIn || null;
      i.checkOut = day.checkOut || null;
      i.workingHours = day.closedSessions ? day.hours : null;
      i.attendanceIds = day.attendanceIds;
    }
  }

  /** GPS evidence already recorded with the punches: check-in coordinates/address, punch methods and the clock-in/out GPS anchors. */
  static async attachLocation(items) {
    const attendanceIds = [...new Set(items.flatMap((i) => i.attendanceIds))];
    const sessions = attendanceIds.length ? await Attendance.findAll({ where: { id: { [Op.in]: attendanceIds } } }) : [];
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const userIds = [...new Set(sessions.map((s) => String(s.userId)))];
    const dates = [...new Set(items.map((i) => i.workDate))];
    const anchors = userIds.length && dates.length
      ? await Footprint.findAll({
        where: { userId: { [Op.in]: userIds }, date: { [Op.in]: dates }, reason: { [Op.in]: ['CLOCK_IN_START_ANCHOR', 'CLOCK_OUT_END_ANCHOR'] } },
        order: [['timestamp', 'ASC']]
      }).catch(() => [])
      : [];
    for (const item of items) {
      const own = item.attendanceIds.map((id) => sessionById.get(id)).filter(Boolean);
      const users = new Set(own.map((s) => String(s.userId)));
      const mine = anchors.filter((f) => users.has(String(f.userId)) && f.date === item.workDate);
      const pin = (f) => (f ? { latitude: Number(f.latitude), longitude: Number(f.longitude), timestamp: Number(f.timestamp), mockLocation: !!f.isMockLocation } : null);
      let coords = null;
      for (const s of own) {
        if (!s.coords) continue;
        try { coords = typeof s.coords === 'string' ? JSON.parse(s.coords) : s.coords; } catch { coords = null; }
        if (coords) break;
      }
      item.location = {
        checkInCoords: coords && (coords.lat ?? coords.latitude) != null
          ? { latitude: Number(coords.lat ?? coords.latitude), longitude: Number(coords.lon ?? coords.lng ?? coords.longitude) }
          : null,
        address: (own.find((s) => s.address) || {}).address || null,
        checkInMethods: [...new Set(own.map((s) => s.checkInMethod).filter(Boolean))],
        clockOutMethods: [...new Set(own.map((s) => s.clockOutMethod).filter(Boolean))],
        workModes: [...new Set(own.map((s) => s.workMode).filter(Boolean))],
        clockInAnchor: pin(mine.find((f) => f.reason === 'CLOCK_IN_START_ANCHOR')),
        clockOutAnchor: pin(mine.slice().reverse().find((f) => f.reason === 'CLOCK_OUT_END_ANCHOR')),
        mockLocationDetected: mine.some((f) => f.isMockLocation)
      };
    }
  }

  /**
   * Approves or rejects one PENDING shift credit. The attendance is re-read and re-evaluated on the server;
   * nothing the client sends about hours, eligibility, identities or times is trusted.
   * The PENDING -> ACTIVE/REJECTED change is a compare-and-set, so concurrent or repeated submissions
   * decide a shift once and the others get 409.
   */
  static async verifyShift({ adjustmentId, action, days, confirmOverride, overrideReason, rejectionReason }, actor, options = {}) {
    const act = text(action).toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(act)) throw new ShiftError(400, 'INVALID_ACTION', 'Action must be APPROVE or REJECT.');
    const id = text(adjustmentId);
    if (!id || id.length > 64) throw new ShiftError(400, 'INVALID_ID', 'A valid adjustmentId is required.');
    if (!actor || !actor.id) throw new ShiftError(401, 'UNAUTHORIZED', 'Authentication required.');
    const role = String(actor.role || '').toUpperCase();
    if (!['ADMIN', 'SUPER_ADMIN', ...policy.SPECIAL_SHIFT_VERIFY_ROLES].includes(role)) {
      throw new ShiftError(403, 'FORBIDDEN', 'You are not allowed to verify Sunday/holiday shifts.');
    }

    const credit = await LeaveAdjustment.findByPk(id);
    if (!credit) throw new ShiftError(404, 'NOT_FOUND', 'Shift credit not found.');
    const v = credit.adjustmentType === 'SPECIAL_EARNED_CREDIT' ? await SpecialShiftVerification.findOne({ where: { adjustmentId: id } }) : null;
    if (!v) throw new ShiftError(400, 'NOT_A_SPECIAL_SHIFT', 'This is not a Sunday/holiday shift recorded from attendance. Manage it in Leave Balances.');
    if (credit.status !== 'PENDING') {
      throw new ShiftError(409, 'ALREADY_VERIFIED', `This shift was already ${credit.status === 'REJECTED' ? 'rejected' : 'approved'}.`, { status: credit.status });
    }

    const employee = await Employee.findByPk(credit.employeeId);
    const actorId = String(actor.id).toLowerCase();
    const own = [credit.employeeId, credit.empCode, employee && employee.id, employee && employee.empCode].filter(Boolean).map((x) => String(x).toLowerCase());
    if (own.includes(actorId)) throw new ShiftError(403, 'SELF_APPROVAL', 'You cannot verify your own Sunday/holiday shift.');

    const now = new Date();
    const decision = { verifiedBy: String(actor.id), verifiedByName: actor.label || String(actor.id), verifiedAt: now };

    if (act === 'REJECT') {
      const reason = text(rejectionReason);
      if (reason.length > MAX_TEXT) throw new ShiftError(400, 'REASON_TOO_LONG', `Rejection reason must be at most ${MAX_TEXT} characters.`);
      await sequelize.transaction(WRITE_TX, async (transaction) => {
        const [n] = await LeaveAdjustment.update({
          status: 'REJECTED', days: 0, adjustedBy: decision.verifiedByName,
          reason: `Not credited: ${v.dayType === 'SUNDAY' ? 'Sunday' : `holiday (${v.holidayName || 'Holiday'})`} shift on ${v.workDate} rejected${reason ? ` - ${reason}` : ''}`
        }, { where: { id, status: 'PENDING' }, transaction });
        if (n !== 1) throw new ShiftError(409, 'ALREADY_VERIFIED', 'This shift was verified by someone else a moment ago.');
        await v.update({ ...decision, approvedDays: 0, rejectionReason: reason || null, changedAfterDecision: false, latestWorkingHours: null }, { transaction });
      });
      return { adjustmentId: id, action: act, status: 'REJECTED', approvedDays: 0, ...decision, rejectionReason: reason || null };
    }

    // ---- APPROVE ----
    if (!employee) throw new ShiftError(404, 'EMPLOYEE_NOT_FOUND', 'The employee for this shift no longer exists.');
    const lock = await PayrollRun.findOne({ where: { month: v.workDate.slice(0, 7), status: { [Op.in]: policy.SPECIAL_SHIFT_LOCKED_PAYROLL_STATUSES } } });
    if (lock) {
      throw new ShiftError(423, 'PAYROLL_LOCKED', `Payroll for ${v.workDate.slice(0, 7)} is ${String(lock.status).toLowerCase()} and locked, so credits in that month cannot be approved. Reject it, or correct it through Leave Balances in an open month.`);
    }

    const kind = await classifyDay(employee, v.workDate);
    if (!kind) throw new ShiftError(422, 'NOT_A_SPECIAL_DAY', `${v.workDate} is no longer a weekly off or holiday for ${employee.name}. Reject this shift instead.`);
    const summary = summarizeDay(await loadDaySessions(employee, v.workDate), { isToday: v.workDate === todayIST(options.now) });
    if (summary.status === 'OPEN_SESSION') throw new ShiftError(422, 'SHIFT_IN_PROGRESS', `${employee.name} is still clocked in for this shift. Approve it after check-out.`);
    const calculated = eligibleDaysFor(summary.totalSeconds);

    const requested = days === undefined || days === null || days === '' ? null : Number(days);
    if (requested !== null && (!Number.isFinite(requested) || requested <= 0 || requested > policy.SPECIAL_SHIFT_MAX_DAYS || !isStep(requested))) {
      throw new ShiftError(400, 'INVALID_DAYS', `Credited days must be between ${policy.LEAVE_UNIT_STEP} and ${policy.SPECIAL_SHIFT_MAX_DAYS} in steps of ${policy.LEAVE_UNIT_STEP}. To credit nothing, reject the shift.`);
    }
    if (requested === null && calculated === 0) {
      throw new ShiftError(422, 'REVIEW_REQUIRED', `The calculated credit is 0 (${fmtHours(summary.hours)} worked${summary.issues.length ? ', punch data incomplete' : ''}). Enter the days to credit and confirm the override, or reject the shift.`);
    }
    const credited = requested === null ? calculated : requested;
    const override = credited !== calculated || summary.status === 'INVALID_PUNCH';
    if (override && confirmOverride !== true) {
      throw new ShiftError(422, 'OVERRIDE_CONFIRMATION_REQUIRED', summary.status === 'INVALID_PUNCH'
        ? 'The punch data for this shift is incomplete. Crediting it needs an explicit override confirmation.'
        : `The calculated credit is ${calculated} day(s); crediting ${credited} needs an explicit override confirmation.`, { calculatedDays: calculated });
    }
    const why = text(overrideReason);
    if (override && !meaningful(why)) throw new ShiftError(422, 'OVERRIDE_REASON_REQUIRED', 'Give a reason for overriding the calculated credit.');
    if (why.length > MAX_TEXT) throw new ShiftError(400, 'REASON_TOO_LONG', `Override reason must be at most ${MAX_TEXT} characters.`);

    const label = kind.dayType === 'SUNDAY' ? 'Sunday' : `holiday (${kind.holidayName})`;
    await sequelize.transaction(WRITE_TX, async (transaction) => {
      const duplicate = await LeaveAdjustment.count({
        where: { employeeId: credit.employeeId, workDate: v.workDate, adjustmentType: 'SPECIAL_EARNED_CREDIT', status: 'ACTIVE', id: { [Op.ne]: id } },
        transaction
      });
      if (duplicate) throw new ShiftError(409, 'DUPLICATE_CREDIT', `${employee.name} already has a credit for ${v.workDate}.`);
      const [n] = await LeaveAdjustment.update({
        status: 'ACTIVE', days: credited, adjustedBy: decision.verifiedByName, leaveType: creditLeaveType(kind),
        reason: `Verified ${label} shift on ${v.workDate}: ${summary.checkIn || '--'} - ${summary.checkOut || '--'}, ${fmtHours(summary.hours)} worked; credited ${credited} day(s)${override ? ` (override of ${calculated}: ${why})` : ''}`
      }, { where: { id, status: 'PENDING' }, transaction });
      if (n !== 1) throw new ShiftError(409, 'ALREADY_VERIFIED', 'This shift was verified by someone else a moment ago.');
      await v.update({
        ...snapshotFields(summary, kind, calculated, now),
        ...decision,
        approvedDays: credited,
        overrideApplied: override,
        overrideReason: override ? why : null,
        rejectionReason: null,
        changedAfterDecision: false,
        latestWorkingHours: null
      }, { transaction });
    });

    const balance = (await LeaveBalanceService.getBalanceSnapshots([employee])).get(employee.id) || null;
    return {
      adjustmentId: id, action: act, status: 'ACTIVE', approvedDays: credited, calculatedDays: calculated,
      workingHours: summary.hours, overrideApplied: override, ...decision, balance
    };
  }

  /**
   * Moves Sunday/holiday credits that the attendance sync added automatically before verification existed
   * (ACTIVE, adjusted by the system, no verification record) back to PENDING, so they count in the balance
   * only once an admin approves them. Register (Excel) history and credits typed in Leave Balances are not
   * touched. The original credit stays the same row; its remark keeps what was credited, when and by whom.
   * Credits in a payroll-locked month are left as they are. Dry run unless `apply` is set.
   */
  static async requeueAutoCredits({ apply = false, actor = 'Admin' } = {}) {
    const credits = await LeaveAdjustment.findAll({
      where: { adjustmentType: 'SPECIAL_EARNED_CREDIT', status: 'ACTIVE', adjustedBy: SYSTEM_ACTOR },
      order: [['workDate', 'ASC'], ['employeeName', 'ASC']]
    });
    const verified = new Set(credits.length
      ? (await SpecialShiftVerification.findAll({ attributes: ['adjustmentId'], where: { adjustmentId: { [Op.in]: credits.map((c) => c.id) } } })).map((v) => v.adjustmentId)
      : []);
    const lockedMonths = new Set((await PayrollRun.findAll({ attributes: ['month'], where: { status: { [Op.in]: policy.SPECIAL_SHIFT_LOCKED_PAYROLL_STATUSES } }, raw: true })).map((r) => r.month));
    const items = [];
    for (const c of credits) {
      if (verified.has(c.id) || !c.workDate) continue;
      const item = { adjustmentId: c.id, employeeId: c.employeeId, empCode: c.empCode, employeeName: c.employeeName, workDate: c.workDate, days: Number(c.days) };
      if (lockedMonths.has(c.workDate.slice(0, 7))) { items.push({ ...item, moved: false, skipped: 'PAYROLL_LOCKED' }); continue; }
      const emp = await Employee.findByPk(c.employeeId);
      const holiday = String(c.leaveType || '').match(/^Special Earned - Holiday:\s*(.*)$/i);
      const kind = holiday ? { dayType: 'HOLIDAY', holidayName: holiday[1].trim() || 'Holiday' } : { dayType: 'SUNDAY', holidayName: null };
      const summary = summarizeDay(emp ? await loadDaySessions(emp, c.workDate) : [], { isToday: c.workDate === todayIST() });
      const eligibleDays = eligibleDaysFor(summary.totalSeconds);
      Object.assign(item, { workingHours: summary.hours, eligibleDays, attendanceStatus: summary.status });
      if (!apply) { items.push({ ...item, moved: false }); continue; }
      const now = new Date();
      const credited = new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      try {
        await sequelize.transaction(WRITE_TX, async (transaction) => {
          const [n] = await LeaveAdjustment.update({
            status: 'PENDING', days: 0,
            reason: `Awaiting verification: worked on ${dayLabel(kind)} ${c.workDate} (auto-credited ${c.days} day(s) on ${credited} by ${SYSTEM_ACTOR}; moved to review by ${actor} on ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`
          }, { where: { id: c.id, status: 'ACTIVE', adjustedBy: SYSTEM_ACTOR }, transaction });
          if (n !== 1) throw new ShiftError(409, 'CHANGED', 'The credit changed while it was being moved.');
          await SpecialShiftVerification.create({
            adjustmentId: c.id, employeeId: c.employeeId, empCode: c.empCode || (emp && emp.empCode) || c.employeeId,
            employeeName: c.employeeName, department: emp ? emp.department : null, workDate: c.workDate,
            ...snapshotFields(summary, kind, eligibleDays, now)
          }, { transaction });
        });
        items.push({ ...item, moved: true });
      } catch (err) {
        items.push({ ...item, moved: false, skipped: err instanceof ShiftError ? err.code : (err.name === 'SequelizeUniqueConstraintError' ? 'ALREADY_IN_REVIEW' : err.message) });
      }
    }
    return { apply, total: items.length, moved: items.filter((i) => i.moved).length, items };
  }

  /** Verifies several shifts; each one is decided on its own (own transaction) and reported individually. */
  static async batchVerify({ adjustmentIds, action, rejectionReason }, actor) {
    if (!Array.isArray(adjustmentIds) || adjustmentIds.length === 0) throw new ShiftError(400, 'NO_IDS', 'Select at least one shift.');
    if (adjustmentIds.length > MAX_BATCH) throw new ShiftError(400, 'TOO_MANY', `At most ${MAX_BATCH} shifts can be verified at once.`);
    const act = text(action).toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(act)) throw new ShiftError(400, 'INVALID_ACTION', 'Action must be APPROVE or REJECT.');
    const seen = new Set();
    const results = [];
    for (const raw of adjustmentIds) {
      const adjustmentId = text(raw);
      if (seen.has(adjustmentId)) {
        results.push({ adjustmentId, success: false, code: 'DUPLICATE_IN_REQUEST', error: 'Listed twice in this request.' });
        continue;
      }
      seen.add(adjustmentId);
      try {
        // Bulk approval credits the calculated amount only; overrides need an individual review.
        const r = await this.verifyShift({ adjustmentId, action: act, rejectionReason }, actor);
        results.push({ adjustmentId, success: true, status: r.status, approvedDays: r.approvedDays });
      } catch (err) {
        if (!(err instanceof ShiftError)) console.error('[SpecialEarnedCreditService] batch verify error:', err);
        results.push({
          adjustmentId, success: false,
          code: err instanceof ShiftError ? err.code : 'SERVER_ERROR',
          error: err instanceof ShiftError ? err.message : 'Failed to save. Nothing was changed for this shift.'
        });
      }
    }
    const succeeded = results.filter((r) => r.success).length;
    return { success: succeeded === results.length, action: act, summary: { total: results.length, succeeded, failed: results.length - succeeded }, results };
  }
}

module.exports = SpecialEarnedCreditService;
module.exports.ShiftError = ShiftError;
module.exports.summarizeDay = summarizeDay;
module.exports.eligibleDaysFor = eligibleDaysFor;
module.exports.punchSeconds = punchSeconds;
module.exports.shiftCreditId = shiftCreditId;
module.exports.SYSTEM_ACTOR = SYSTEM_ACTOR;
