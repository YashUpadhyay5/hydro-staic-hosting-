const { v5: uuidv5 } = require('uuid');
const sequelize = require('../../../../config/database');
const Employee = require('../../../../shared/models/Employee');
const LeaveAdjustment = require('../../../../shared/models/LeaveAdjustment');
const policy = require('../../../../core/config/leavePolicy');
const LeaveBalanceService = require('./LeaveBalanceService');

const { parseDateParts, parseLedgerStart, monthIndex, toISO } = LeaveBalanceService;

// Fixed namespace so a client idempotency key always maps to the same adjustment row ids.
const IDEMPOTENCY_NAMESPACE = '6f1c3c1e-6a9b-4f43-9a52-2f3d7c1b8e10';
const MAX_CHANGES = 100;
const MAX_TEXT = 500;

class LedgerError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isStep = (n) => Number.isFinite(n) && Math.abs(n / policy.LEAVE_UNIT_STEP - Math.round(n / policy.LEAVE_UNIT_STEP)) < 1e-9;
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

function rowId(employeeId, idempotencyKey, n) {
  return uuidv5(`${employeeId}:${idempotencyKey}:${n}`, IDEMPOTENCY_NAMESPACE);
}

/**
 * Validates every change against the employee's current ledger before anything is written.
 * Returns normalized changes or throws a 400 LedgerError listing every problem found.
 */
async function validateChanges(employee, changes, transaction) {
  const errors = [];
  const fail = (index, message) => errors.push({ index, message });
  if (!Array.isArray(changes) || changes.length === 0) throw new LedgerError(400, 'NO_CHANGES', 'No changes to submit.');
  if (changes.length > MAX_CHANGES) throw new LedgerError(400, 'TOO_MANY_CHANGES', `At most ${MAX_CHANGES} changes can be submitted at once.`);

  const now = new Date();
  const todayIdx = monthIndex(now.getFullYear(), now.getMonth() + 1);
  const todayISO = toISO({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  const ledgerStart = parseLedgerStart();
  const joining = parseDateParts(employee.joiningDate);
  const joiningISO = joining ? toISO(joining) : null;
  const firstEarnIdx = Math.max(ledgerStart.index, joining ? monthIndex(joining.year, joining.month) : ledgerStart.index);

  const existing = await LeaveAdjustment.findAll({ where: { employeeId: employee.id }, transaction });
  const activeCreditDates = new Set(existing.filter((a) => a.adjustmentType === 'SPECIAL_EARNED_CREDIT' && a.status === 'ACTIVE').map((a) => a.workDate));
  const creditsById = new Map(existing.filter((a) => a.adjustmentType === 'SPECIAL_EARNED_CREDIT').map((a) => [a.id, a]));

  const migrationStart = LeaveBalanceService.parseMonthSetting(policy.MIGRATION_START_MONTH);
  const holidayCalendar = changes.some((c) => c && c.kind === 'special-add')
    ? await LeaveBalanceService.employeeHolidayCalendar(employee, { transaction })
    : { holidays: new Map(), calendars: [] };
  const seenMigration = new Set();
  const seenEarnedMonths = new Set();
  const seenReversals = new Set();
  const normalized = [];

  const checkMonth = (i, year, month) => {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) { fail(i, 'A valid year and month (1-12) are required.'); return null; }
    const idx = monthIndex(y, m);
    if (idx < ledgerStart.index) { fail(i, `Months before ${policy.LEDGER_START_MONTH} are covered by the migrated opening balance and cannot be edited.`); return null; }
    if (idx > todayIdx) { fail(i, 'Future months cannot be edited.'); return null; }
    return { year: y, month: m, idx };
  };
  const checkReason = (i, value, label, required) => {
    const r = text(value);
    if (required && !r) fail(i, `${label} is required.`);
    else if (required && !/[a-z0-9]/i.test(r)) fail(i, `${label} must be a few words, not just punctuation.`);
    if (r.length > MAX_TEXT) fail(i, `${label} must be at most ${MAX_TEXT} characters.`);
    return r;
  };

  changes.forEach((c, i) => {
    switch (c && c.kind) {
      case 'earned': {
        const ym = checkMonth(i, c.year, c.month);
        const value = Number(c.value);
        if (c.value === '' || c.value === null || !Number.isFinite(value) || value < 0 || value > 31 || !isStep(value)) {
          fail(i, `Earned leave must be between 0 and 31 in steps of ${policy.LEAVE_UNIT_STEP}.`);
        }
        const comment = checkReason(i, c.comment, 'Comment', false);
        if (ym) {
          if (ym.idx < firstEarnIdx) fail(i, 'The employee had not joined yet in this month.');
          const key = `${ym.year}-${ym.month}`;
          if (seenEarnedMonths.has(key)) fail(i, 'This month appears twice in the submission.');
          seenEarnedMonths.add(key);
        }
        if (ym) normalized.push({ kind: 'earned', ...ym, value, comment });
        break;
      }
      case 'special-add': {
        const p = parseDateParts(c.workDate);
        const days = Number(c.days === undefined ? 1 : c.days);
        const reason = checkReason(i, c.reason, 'Reason / work record reference', true);
        if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(text(c.workDate))) { fail(i, 'Work date must be a valid date (YYYY-MM-DD).'); break; }
        const iso = toISO(p);
        if (iso > todayISO) fail(i, 'Work date cannot be in the future.');
        if (monthIndex(p.year, p.month) < migrationStart.index) fail(i, `Work dates before ${policy.MIGRATION_START_MONTH} are outside the leave ledger.`);
        if (joiningISO && iso < joiningISO) fail(i, 'Work date is before the employee joined.');
        if (!(days > 0 && days <= 1) || !isStep(days)) fail(i, 'Credited duration must be 0.5 or 1 day.');
        if (activeCreditDates.has(iso)) fail(i, `A special-earned credit already exists for ${iso}.`);
        // Sunday credits must be Sundays; holiday credits must be in the employee's own holiday calendar.
        let leaveType = 'Special Earned Leave';
        if (c.creditType === 'SUNDAY') {
          if (new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0) fail(i, `${iso} is not a Sunday.`);
          leaveType = 'Special Earned - Sunday';
        } else if (c.creditType === 'HOLIDAY') {
          const name = holidayCalendar.holidays.get(iso);
          if (!name) fail(i, `${iso} is not a holiday in ${employee.name}'s holiday calendar${holidayCalendar.calendars.length ? ` (${holidayCalendar.calendars.join(', ')})` : ' (no calendar for their location)'}.`);
          leaveType = `Special Earned - Holiday: ${name || ''}`.trim();
        } else {
          fail(i, 'Choose whether the work was on a Sunday or a holiday.');
        }
        activeCreditDates.add(iso);
        normalized.push({ kind: 'special-add', workDate: iso, year: p.year, month: p.month, days, reason, leaveType });
        break;
      }
      case 'special-reverse': {
        const reason = checkReason(i, c.reason, 'Reason for removal', true);
        const credit = creditsById.get(text(c.adjustmentId));
        if (!credit) { fail(i, 'Special-earned credit not found for this employee.'); break; }
        if (credit.status !== 'ACTIVE' || seenReversals.has(credit.id)) { fail(i, 'This special-earned credit is already removed.'); break; }
        seenReversals.add(credit.id);
        activeCreditDates.delete(credit.workDate);
        normalized.push({ kind: 'special-reverse', credit, reason });
        break;
      }
      case 'special-remark': {
        // New remark for an existing Sunday/holiday credit; the credit itself is unchanged.
        const reason = checkReason(i, c.reason, 'Remark for special earned leave', true);
        const credit = creditsById.get(text(c.adjustmentId));
        if (!credit) { fail(i, 'Special-earned credit not found for this employee.'); break; }
        if (credit.status !== 'ACTIVE' || seenReversals.has(credit.id)) { fail(i, 'This special-earned credit is removed; its remark cannot be changed.'); break; }
        normalized.push({ kind: 'special-remark', credit, reason });
        break;
      }
      case 'migration': {
        // One value of a migration-period month (history from the previous platform).
        const y = Number(c.year);
        const m = Number(c.month);
        const idx = Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12 ? monthIndex(y, m) : null;
        if (idx === null) { fail(i, 'A valid year and month (1-12) are required.'); break; }
        if (idx < migrationStart.index || idx >= ledgerStart.index) { fail(i, `Only months from ${policy.MIGRATION_START_MONTH} up to before ${policy.LEDGER_START_MONTH} are migration months.`); break; }
        if (!['earned', 'special', 'consumed'].includes(c.field)) { fail(i, 'Field must be earned, special or consumed.'); break; }
        const value = Number(c.value);
        if (c.value === '' || c.value === null || !Number.isFinite(value) || value < 0 || value > 31 || !isStep(value)) {
          fail(i, `Value must be between 0 and 31 in steps of ${policy.LEAVE_UNIT_STEP}.`);
        }
        // Consumed and special values need a remark; earned gets an automatic comment if left empty.
        const comment = checkReason(i, c.comment, c.field === 'consumed' ? 'Remark for consumed leave' : (c.field === 'special' ? 'Remark for special earned leave' : 'Comment'), c.field !== 'earned');
        const key = `${y}-${m}-${c.field}`;
        if (seenMigration.has(key)) fail(i, 'This month and field appear twice in the submission.');
        seenMigration.add(key);
        normalized.push({ kind: 'migration', year: y, month: m, field: c.field, value, comment });
        break;
      }
      case 'migration-carry': {
        const value = Number(c.value);
        if (c.value === '' || c.value === null || !Number.isFinite(value) || value < 0 || value > 365 || !isStep(value)) {
          fail(i, `Carry-forward must be between 0 and 365 in steps of ${policy.LEAVE_UNIT_STEP}.`);
        }
        const comment = checkReason(i, c.comment, 'Comment', false);
        if (seenMigration.has('carry')) fail(i, 'Carry-forward appears twice in the submission.');
        seenMigration.add('carry');
        normalized.push({ kind: 'migration-carry', value, comment });
        break;
      }
      case 'consumed': {
        const ym = checkMonth(i, c.year, c.month);
        const delta = Number(c.deltaDays);
        // 0 days = a remark only (the consumed total stays the same)
        if (!Number.isFinite(delta) || Math.abs(delta) > 31 || !isStep(delta)) {
          fail(i, `Correction must be a number of days (max 31) in steps of ${policy.LEAVE_UNIT_STEP}.`);
        }
        const reason = checkReason(i, c.reason, 'Comment for the correction', true);
        if (ym) normalized.push({ kind: 'consumed', ...ym, delta, reason });
        break;
      }
      default:
        fail(i, 'Unknown change type.');
    }
  });

  if (errors.length) throw new LedgerError(400, 'VALIDATION_FAILED', errors[0].message, errors);
  return normalized;
}

/**
 * Applies a batch of ledger changes atomically.
 * - Optimistic concurrency: `expectedVersion` must equal the ledger version the client loaded (409 otherwise).
 * - Idempotency: rows get deterministic ids derived from `idempotencyKey`, so a retried or
 *   double-clicked submission is detected and never writes twice.
 * - Business rules are checked on the recomputed ledger before commit (no negative balances).
 */
async function submitChanges(employeeRef, { expectedVersion, idempotencyKey, changes, year }, actor) {
  const key = text(idempotencyKey);
  if (!key || key.length > 100) throw new LedgerError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.');
  if (!text(expectedVersion)) throw new LedgerError(400, 'VERSION_REQUIRED', 'expectedVersion is required. Reload the page and try again.');

  const firstRowId = rowId(employeeRef.id, key, 0);
  if (await LeaveAdjustment.findByPk(firstRowId)) return { duplicate: true };

  try {
    return await sequelize.transaction(async (transaction) => {
      // Serializes concurrent submissions for the same employee (row lock on Postgres).
      const employee = await Employee.findByPk(employeeRef.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!employee) throw new LedgerError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');

      const before = await LeaveBalanceService.getEmployeeMonthlyLedger(employee, year, { transaction, withContext: false });
      if (before.version !== text(expectedVersion)) {
        throw new LedgerError(409, 'STALE_VERSION', 'Someone else changed this employee\'s leave ledger after you opened it. Reload to see the latest data, then re-apply your edits.');
      }

      const normalized = await validateChanges(employee, changes, transaction);
      const base = {
        employeeId: employee.id,
        empCode: employee.empCode || employee.id,
        employeeName: employee.name,
        leaveType: 'Earned Leave',
        adjustedBy: actor
      };
      let n = 0;
      const nextId = () => rowId(employee.id, key, n++);

      for (const c of normalized) {
        if (c.kind === 'earned') {
          const month = before.year === c.year ? before.months.find((mm) => mm.month === c.month) : null;
          const previousValue = month
            ? month.earnedLeave
            : (await LeaveBalanceService.getEmployeeMonthlyLedger(employee, c.year, { transaction, withContext: false })).months.find((mm) => mm.month === c.month).earnedLeave;
          await LeaveAdjustment.create({
            ...base, id: nextId(), adjustmentType: 'EARNED_LEAVE_OVERRIDE', days: c.value, year: c.year, month: c.month,
            previousValue, newValue: c.value,
            reason: c.comment || `Earned leave changed from ${previousValue} to ${c.value}`,
            effectiveDate: `${c.year}-${String(c.month).padStart(2, '0')}-01`
          }, { transaction });
        } else if (c.kind === 'special-add') {
          await LeaveAdjustment.create({
            ...base, id: nextId(), adjustmentType: 'SPECIAL_EARNED_CREDIT', leaveType: c.leaveType, days: c.days, year: c.year, month: c.month,
            workDate: c.workDate, reason: c.reason, effectiveDate: c.workDate, status: 'ACTIVE'
          }, { transaction });
        } else if (c.kind === 'special-reverse') {
          await LeaveAdjustment.update({ status: 'REVERSED' }, { where: { id: c.credit.id, status: 'ACTIVE' }, transaction });
          await LeaveAdjustment.create({
            ...base, id: nextId(), adjustmentType: 'SPECIAL_EARNED_REVERSAL', days: Number(c.credit.days),
            year: c.credit.year, month: c.credit.month, workDate: c.credit.workDate, relatedAdjustmentId: c.credit.id,
            reason: c.reason, effectiveDate: c.credit.workDate, status: 'ACTIVE'
          }, { transaction });
        } else if (c.kind === 'migration') {
          const ledgerForYear = before.year === c.year ? before : await LeaveBalanceService.getEmployeeMonthlyLedger(employee, c.year, { transaction, withContext: false });
          const mv = ledgerForYear.months.find((mm) => mm.month === c.month).migrationValues || {};
          const previousValue = mv[c.field] ?? null;
          const label = { earned: 'Earned leave', special: 'Special earned (Sunday/holiday)', consumed: 'Consumed leave' }[c.field];
          const type = { earned: 'MIGRATION_EARNED', special: 'MIGRATION_SPECIAL', consumed: 'MIGRATION_CONSUMED' }[c.field];
          await LeaveAdjustment.create({
            ...base, id: nextId(), adjustmentType: type, days: c.value, year: c.year, month: c.month,
            leaveType: c.field === 'special' ? 'Special Earned Leave' : 'Earned Leave',
            previousValue, newValue: c.value,
            reason: c.comment || `${label} for ${c.year}-${String(c.month).padStart(2, '0')} set to ${c.value}${previousValue === null ? '' : ` (was ${previousValue})`}`,
            effectiveDate: `${c.year}-${String(c.month).padStart(2, '0')}-01`
          }, { transaction });
        } else if (c.kind === 'migration-carry') {
          const previousValue = before.carryForward;
          await LeaveAdjustment.create({
            ...base, id: nextId(), adjustmentType: 'MIGRATION_CARRY_FORWARD', days: c.value,
            previousValue, newValue: c.value,
            reason: c.comment || `Carry-forward from previous year set to ${c.value}${previousValue === null ? '' : ` (was ${previousValue})`}`
          }, { transaction });
        } else if (c.kind === 'special-remark') {
          await LeaveAdjustment.create({
            ...base, id: nextId(), adjustmentType: 'SPECIAL_EARNED_REMARK', days: 0,
            year: c.credit.year, month: c.credit.month, workDate: c.credit.workDate, relatedAdjustmentId: c.credit.id,
            previousValue: null, newValue: null, reason: c.reason, effectiveDate: c.credit.workDate, status: 'ACTIVE'
          }, { transaction });
        } else if (c.kind === 'consumed') {
          await LeaveAdjustment.create({
            ...base, id: nextId(), adjustmentType: 'CONSUMED_LEAVE_CORRECTION', days: c.delta, year: c.year, month: c.month,
            reason: c.reason, effectiveDate: `${c.year}-${String(c.month).padStart(2, '0')}-01`
          }, { transaction });
        }
      }

      const after = await LeaveBalanceService.getEmployeeMonthlyLedger(employee, year, { transaction, withContext: false });
      if (after.minMonthlyConsumed < 0) {
        throw new LedgerError(422, 'NEGATIVE_CONSUMED', 'A correction would make a month\'s consumed leave negative.');
      }
      if (!policy.ALLOW_NEGATIVE_BALANCE && after.minRemainingBalance < 0 && after.minRemainingBalance < before.minRemainingBalance) {
        throw new LedgerError(422, 'NEGATIVE_BALANCE', `These changes would make the leave balance negative (lowest month: ${after.minRemainingBalance} days).`);
      }
      return { duplicate: false, rowsWritten: n };
    });
  } catch (err) {
    // A concurrent retry with the same idempotency key lost the race on the primary key.
    if (err.name === 'SequelizeUniqueConstraintError' && await LeaveAdjustment.findByPk(firstRowId)) return { duplicate: true };
    throw err;
  }
}

module.exports = { submitChanges, validateChanges, LedgerError };
