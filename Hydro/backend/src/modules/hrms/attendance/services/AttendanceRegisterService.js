// Monthly attendance register: every employee x every day of a month, built from the real records:
//   P   an attendance row (clock-in, regularization or an admin edit)        green
//   EL  a day an approved leave charges to Earned Leave                       yellow
//   A   a working day with no attendance and no EL: loss of pay (LOP)         red
//   SL  special leave (Marriage / Paternity / Maternity), paid, not EL         blue
//   WO / H  Sunday / a holiday in the employee's own calendar (not counted)   grey
// Absent = EL + LOP (+ SL). An admin edit writes real records (attendance row, 1-day EL or LOP leave, or the day
// taken out of an existing leave) so Leave Balances and the pay run follow, and logs what the day held before.
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const sequelize = require('../../../../config/database');
const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const Leave = require('../../../../shared/models/Leave');
const PayrollRun = require('../../../../shared/models/PayrollRun');
const SpecialShiftVerification = require('../../../../shared/models/SpecialShiftVerification');
const AttendanceRegisterEdit = require('../../../../shared/models/AttendanceRegisterEdit');
const { getEmployeeHolidayMap } = require('../../../../shared/services/EmployeeHolidayCalendar');
const LeaveBalanceService = require('../../leave/services/LeaveBalanceService');
const { lopDatesOfLeave, isLopType } = require('../../leave/services/LeaveLop');
const { createPresentDay } = require('./RegularizationService');

const { parseDateParts, toISO, elDaysByDate } = LeaveBalanceService;

const MARKS = ['P', 'EL', 'A', 'OFF'];        // what an admin can set (OFF = back to Sunday / holiday)
const LOCKED_RUN_STATUSES = ['APPROVED', 'PAID'];
const METHOD = 'ADMIN_REGISTER';               // checkInMethod / clockOutMethod of rows an edit creates
const MAX_CHANGES = 200;
const DAY_MS = 86400000;

class RegisterError extends Error {
  constructor(message, status = 400, code = 'INVALID', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const istDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms));
const isoOf = (v) => {
  const p = parseDateParts(v);
  return p ? toISO(p) : null;
};
const text = (v, max) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const lower = (v) => String(v || '').trim().toLowerCase();

function parseMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RegisterError('month must be YYYY-MM.', 400, 'INVALID_MONTH');
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, i) => `${m[1]}-${m[2]}-${String(i + 1).padStart(2, '0')}`);
  return { month: `${m[1]}-${m[2]}`, year, mon, days };
}

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

async function activeEmployees(employeeId) {
  const where = {
    [Op.and]: [
      { [Op.or]: [{ status: { [Op.in]: ['ACTIVE', 'Active', 'active'] } }, { status: null }] },
      { [Op.or]: [{ isSystemAccount: false }, { isSystemAccount: null }] }
    ]
  };
  if (employeeId) where[Op.and].push({ [Op.or]: [{ id: employeeId }, { empCode: employeeId }] });
  return Employee.findAll({ where, order: [['name', 'ASC']] });
}

// Matches a record's userId (internal id or code; else the name) to one of `employees`
function ownerIndex(employees) {
  const byKey = new Map();
  const byName = new Map();
  for (const e of employees) {
    byKey.set(lower(e.id), e.id);
    if (e.empCode) byKey.set(lower(e.empCode), e.id);
    if (e.name) byName.set(lower(e.name), e.id);
  }
  return (userId, userName) => byKey.get(lower(userId)) || byName.get(lower(userName)) || null;
}

// employeeId -> Map(date -> [attendance rows]) for the month (dates stored as YYYY-MM-DD or DD-MM-YYYY)
async function attendanceByDay(owner, { year, mon }, transaction) {
  const mm = String(mon).padStart(2, '0');
  const rows = await Attendance.findAll({
    where: { [Op.or]: [{ date: { [Op.like]: `${year}-${mm}-%` } }, { date: { [Op.like]: `%-${mm}-${year}` } }] },
    transaction
  });
  const out = new Map();
  for (const row of rows) {
    const id = owner(row.userId, row.userName);
    const date = isoOf(row.date);
    if (!id || !date) continue;
    if (!out.has(id)) out.set(id, new Map());
    const days = out.get(id);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(row);
  }
  return out;
}

// The days one approved leave covers: date -> { kind: 'EL' | 'A' | 'SL', days }
function leaveDays(leave) {
  const out = new Map();
  if (leave.leaveCategory) {
    let dates = Array.isArray(leave.workingDates) ? leave.workingDates.map(isoOf).filter(Boolean) : null;
    if (!dates || !dates.length) {
      const s = isoOf(leave.startDate);
      const e = isoOf(leave.endDate) || s;
      dates = [];
      for (let t = Date.parse(`${s}T00:00:00Z`); s && t <= Date.parse(`${e}T00:00:00Z`); t += DAY_MS) dates.push(new Date(t).toISOString().slice(0, 10));
    }
    for (const d of dates) out.set(d, { kind: 'SL', days: 1 });
    return out;
  }
  for (const d of elDaysByDate(leave)) out.set(d.date, { kind: 'EL', days: d.days });
  for (const d of lopDatesOfLeave(leave)) if (!out.has(d)) out.set(d, { kind: 'A', days: 1 });
  return out;
}

// employeeId -> [{ leave, days: Map }] of approved leaves
async function leavesByEmployee(owner, transaction) {
  const out = new Map();
  for (const leave of await Leave.findAll({ where: { status: 'approved' }, transaction })) {
    const id = owner(leave.userId, leave.userName);
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ leave, days: leaveDays(leave) });
  }
  return out;
}

function cellFor(date, { attendance, leaves, holidays, joining, today }) {
  const dow = weekday(date);
  const off = dow === 0 ? 'WO' : (holidays.has(date) ? 'H' : null);
  const cell = { date, off, holiday: off === 'H' ? holidays.get(date) : null, mark: null, source: null, editable: false };
  if (date > today) return { ...cell, source: 'FUTURE' };
  if (joining && date < joining) return { ...cell, source: 'NOT_JOINED' };

  const covering = leaves.map((l) => ({ leave: l.leave, day: l.days.get(date) })).filter((l) => l.day);
  if (attendance && attendance.length) {
    return { ...cell, mark: 'P', source: 'ATTENDANCE', attendanceIds: attendance.map((a) => a.id), editable: true, alsoOnLeave: covering.length > 0 };
  }
  const special = covering.find((l) => l.day.kind === 'SL');
  if (special) return { ...cell, mark: 'SL', source: 'SPECIAL_LEAVE', leaveId: special.leave.id };
  const el = covering.find((l) => l.day.kind === 'EL');
  if (el) {
    const part = el.day.days < 1 ? el.day.days : null;
    return { ...cell, mark: 'EL', source: 'LEAVE', leaveId: el.leave.id, part, editable: !part };
  }
  const lop = covering.find((l) => l.day.kind === 'A');
  if (lop) return { ...cell, mark: 'A', source: 'LOP_LEAVE', leaveId: lop.leave.id, editable: true };
  if (off) return { ...cell, mark: off, source: 'OFF', editable: true };
  return { ...cell, mark: 'A', source: 'NO_RECORD', editable: true };
}

function totalsOf(cells) {
  const t = { present: 0, el: 0, lop: 0, specialLeave: 0, absent: 0, workingDays: 0 };
  for (const c of cells) {
    if (!c.mark) continue;
    if (!c.off) t.workingDays++;
    if (c.mark === 'P') t.present++;
    else if (c.mark === 'EL') {
      t.el += c.part || 1;
      if (c.part) t.lop += 1 - c.part;
    } else if (c.mark === 'A') t.lop++;
    else if (c.mark === 'SL') t.specialLeave++;
  }
  t.el = Math.round(t.el * 100) / 100;
  t.lop = Math.round(t.lop * 100) / 100;
  t.absent = Math.round((t.el + t.lop + t.specialLeave) * 100) / 100;
  return t;
}

// Edits are locked only where they would change paid-out pay: an approved / paid run that takes its LOP from this
// register. A run from before the register (lopSource NULL) keeps the LOP it stored, so its month stays editable.
async function lockFor(month, transaction) {
  const runs = await PayrollRun.findAll({ where: { month }, attributes: ['id', 'status', 'lopSource'], transaction });
  const locking = runs.find((r) => r.lopSource === 'REGISTER' && LOCKED_RUN_STATUSES.includes(r.status));
  return locking ? { runId: locking.id, status: locking.status } : null;
}

// A pay run of this month that does not follow the register (made before it existed), for the page to mention
async function olderRunFor(month, transaction) {
  const run = await PayrollRun.findOne({ where: { month, lopSource: null }, attributes: ['id', 'status'], transaction });
  return run ? { runId: run.id, status: run.status } : null;
}

// { month, today, locked, days: [{ date, day, weekday }], employees: [{ id, empCode, name, department, location, cells, totals }] }
async function getRegister(month, { employeeId = null, now = Date.now(), transaction } = {}) {
  const span = parseMonth(month);
  const employees = await activeEmployees(employeeId);
  const owner = ownerIndex(employees);
  const [attendance, leaves, locked, olderPayrollRun] = await Promise.all([
    attendanceByDay(owner, span, transaction),
    leavesByEmployee(owner, transaction),
    lockFor(span.month, transaction),
    olderRunFor(span.month, transaction)
  ]);
  const today = istDate(now);

  const rows = [];
  for (const e of employees) {
    const holidays = await getEmployeeHolidayMap(e);
    const ctx = { holidays, joining: isoOf(e.joiningDate), today, leaves: leaves.get(e.id) || [] };
    const mine = attendance.get(e.id) || new Map();
    const cells = span.days.map((d) => cellFor(d, { ...ctx, attendance: mine.get(d) }));
    rows.push({
      id: e.id, empCode: e.empCode || null, name: e.name, department: e.department || null, location: e.location || null,
      cells, totals: totalsOf(cells), _employee: e, _attendance: mine, _leaves: ctx.leaves
    });
  }
  return {
    month: span.month,
    today,
    locked,
    olderPayrollRun,
    days: span.days.map((d) => ({ date: d, day: Number(d.slice(8)), weekday: weekday(d) })),
    employees: rows
  };
}

const publicRegister = (reg) => ({ ...reg, employees: reg.employees.map(({ _employee, _attendance, _leaves, ...r }) => r) });

// Takes one date out of an approved leave, keeping "EL is charged to the earliest days" true for the rest.
function removeDateFromLeave(leave, date) {
  const el = Number(leave.elDays || 0);
  const lop = Number(leave.lopDays || 0);
  const elDates = elDaysByDate(leave).map((d) => d.date);
  const lopDates = lopDatesOfLeave(leave);
  const stored = Array.isArray(leave.workingDates) ? leave.workingDates.map(isoOf).filter(Boolean) : null;
  const all = isLopType(leave.type)
    ? lopDates
    : (stored && stored.length >= Math.ceil(el + lop) ? stored : [...new Set([...elDates, ...lopDates])].sort());
  const rest = all.filter((d) => d !== date);

  if (isLopType(leave.type)) leave.lopDays = rest.length;
  else if (elDates.includes(date)) leave.elDays = Math.max(0, el - 1);
  else if (lopDates.includes(date)) leave.lopDays = Math.max(0, lop - 1);

  if (!rest.length || (Number(leave.elDays || 0) + Number(leave.lopDays || 0) === 0 && !isLopType(leave.type))) {
    leave.status = 'cancelled';
    return leave;
  }
  leave.workingDates = rest;
  leave.totalDays = rest.length;
  leave.startDate = rest[0];
  leave.endDate = rest[rest.length - 1];
  return leave;
}

const plainOf = (row) => (row.get ? row.get({ plain: true }) : { ...row });

/**
 * Applies a batch of admin edits after the page confirmed them: [{ employeeId, date, mark: P | EL | A | OFF }].
 * All are checked first; nothing is written unless every one is valid. Returns { batchId, applied, unchanged }.
 */
async function applyEdits({ changes, note } = {}, actor = 'admin', now = Date.now()) {
  if (!Array.isArray(changes) || !changes.length) throw new RegisterError('No changes to save.', 400, 'NO_CHANGES');
  if (changes.length > MAX_CHANGES) throw new RegisterError(`At most ${MAX_CHANGES} changes can be saved at once.`, 400, 'TOO_MANY_CHANGES');
  const cleanNote = text(note, 500) || null;

  const errors = [];
  const fail = (index, code, message) => errors.push({ index, code, message });
  const seen = new Set();
  const registers = new Map();   // `${employeeId}|${month}` -> employee row of that month's register
  const plan = [];

  for (let index = 0; index < changes.length; index++) {
    const c = changes[index] || {};
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || '')) ? isoOf(c.date) : null;
    const mark = String(c.mark || '').toUpperCase();
    if (!c.employeeId || !date) { fail(index, 'INVALID_CHANGE', 'Each change needs an employeeId and a date (YYYY-MM-DD).'); continue; }
    if (!MARKS.includes(mark)) { fail(index, 'INVALID_MARK', `mark must be one of ${MARKS.join(', ')}.`); continue; }
    const key = `${c.employeeId}|${date.slice(0, 7)}`;
    if (!registers.has(key)) {
      const reg = await getRegister(date.slice(0, 7), { employeeId: c.employeeId, now });
      registers.set(key, { row: reg.employees[0] || null, locked: reg.locked });
    }
    const { row, locked } = registers.get(key);
    if (!row) { fail(index, 'EMPLOYEE_NOT_FOUND', 'Employee not found or not active.'); continue; }
    if (seen.has(`${row.id}|${date}`)) { fail(index, 'DUPLICATE_DAY', 'The same day is changed twice.'); continue; }
    seen.add(`${row.id}|${date}`);
    if (locked) { fail(index, 'PAYROLL_LOCKED', `Payroll for ${date.slice(0, 7)} is already ${locked.status.toLowerCase()}; its attendance cannot change.`); continue; }

    const cell = row.cells.find((x) => x.date === date);
    if (cell.source === 'FUTURE') { fail(index, 'FUTURE_DAY', 'A day in the future cannot be marked.'); continue; }
    if (cell.source === 'NOT_JOINED') { fail(index, 'NOT_JOINED', 'The employee had not joined yet on that day.'); continue; }
    if (cell.mark === 'SL') { fail(index, 'SPECIAL_LEAVE_DAY', 'This day is special leave; change it from the Leaves page.'); continue; }
    if (cell.part) { fail(index, 'PART_DAY_LEAVE', 'This day is part EL; change that leave from the Leaves page.'); continue; }
    const allowed = cell.off ? ['P', 'OFF'] : ['P', 'EL', 'A'];
    if (!allowed.includes(mark)) {
      fail(index, 'MARK_NOT_ALLOWED', cell.off ? 'A Sunday or holiday can only be P or off.' : 'A working day can be P, EL or A.');
      continue;
    }
    const target = mark === 'OFF' ? cell.off : mark;
    if (target === cell.mark) continue;
    if (cell.off && cell.mark === 'P') {
      const credited = await SpecialShiftVerification.findOne({ where: { employeeId: row.id, workDate: date } });
      if (credited) { fail(index, 'SPECIAL_SHIFT_RECORDED', 'This Sunday/holiday shift has a special credit; handle it in Review Weekend/Holiday Shifts.'); continue; }
    }
    plan.push({ index, row, date, cell, mark, target });
  }

  // Enough EL for the days marked EL (days taken off EL in the same batch come back first)
  const byEmployee = new Map();
  for (const p of plan) {
    if (!byEmployee.has(p.row.id)) byEmployee.set(p.row.id, { row: p.row, add: [], refund: 0 });
    const e = byEmployee.get(p.row.id);
    if (p.target === 'EL') e.add.push(p.index);
    if (p.cell.mark === 'EL') e.refund += 1;
  }
  for (const { row, add, refund } of byEmployee.values()) {
    if (!add.length) continue;
    const snapshot = (await LeaveBalanceService.getBalanceSnapshots([row._employee])).get(row.id);
    const pendingEl = await Leave.sum('elDays', {
      where: { status: 'pending', leaveCategory: null, userId: { [Op.in]: [row.id, row.empCode].filter(Boolean) } }
    }) || 0;
    const available = Math.floor((snapshot ? snapshot.available : 0) - pendingEl + refund);
    if (add.length > available) {
      add.forEach((i) => fail(i, 'NO_EL_BALANCE', `${row.name} has ${Math.max(0, available)} EL available, not enough for ${add.length} EL day(s).`));
    }
  }
  if (errors.length) {
    throw new RegisterError('Some changes cannot be saved. Nothing was changed.', 400, 'INVALID_CHANGES', { errors: errors.sort((a, b) => a.index - b.index) });
  }

  const batchId = uuidv4();
  await sequelize.transaction(async (transaction) => {
    for (const p of plan) {
      const employee = p.row._employee;
      const before = { attendance: [], leaves: [] };
      const after = { leaveUpdates: [] };

      const rows = p.row._attendance.get(p.date) || [];
      if (p.target !== 'P' && rows.length) {
        before.attendance = rows.map(plainOf);
        await Attendance.destroy({ where: { id: { [Op.in]: rows.map((r) => r.id) } }, transaction });
      }
      for (const { leave, days } of p.row._leaves) {
        const day = days.get(p.date);
        if (!day || day.kind === 'SL' || leave.status !== 'approved') continue;
        before.leaves.push({ id: leave.id, before: plainOf(leave) });
        removeDateFromLeave(leave, p.date);
        await leave.save({ transaction });
        after.leaveUpdates.push({ id: leave.id, status: leave.status, elDays: leave.elDays, lopDays: leave.lopDays, workingDates: leave.workingDates });
      }

      if (p.target === 'P' && !rows.length) {
        after.attendanceId = (await createPresentDay(employee, p.date, { method: METHOD, transaction })).id;
      } else if (p.target === 'EL' || p.target === 'A') {
        const leave = await Leave.create({
          userId: employee.empCode || employee.id,
          userName: employee.name,
          startDate: p.date,
          endDate: p.date,
          type: p.target === 'EL' ? 'Earned Leave' : 'Loss of Pay',
          reason: `Attendance register edit${cleanNote ? `: ${cleanNote}` : ''}`,
          status: 'approved',
          appliedAt: now,
          actionBy: text(actor, 200) || null,
          elDays: p.target === 'EL' ? 1 : 0,
          lopDays: p.target === 'A' ? 1 : 0,
          totalDays: 1,
          workingDates: [p.date]
        }, { transaction });
        after.leaveId = leave.id;
      }

      await AttendanceRegisterEdit.create({
        batchId, employeeId: p.row.id, date: p.date, fromMark: p.cell.mark, toMark: p.target,
        note: cleanNote, editedBy: text(actor, 200) || null, before, after
      }, { transaction });
    }
  });
  return { batchId, applied: plan.length, unchanged: changes.length - plan.length };
}

async function editsFor({ employeeId, month } = {}) {
  const where = {};
  if (employeeId) where.employeeId = employeeId;
  if (month) where.date = { [Op.like]: `${parseMonth(month).month}-%` };
  const rows = await AttendanceRegisterEdit.findAll({ where, order: [['createdAt', 'DESC']], limit: 500 });
  return rows.map((r) => {
    const { before, after, ...rest } = r.get({ plain: true });
    return rest;
  });
}

module.exports = {
  RegisterError,
  MARKS,
  METHOD,
  parseMonth,
  getRegister: async (month, opts) => publicRegister(await getRegister(month, opts)),
  applyEdits,
  editsFor,
  removeDateFromLeave
};
