// Monthly attendance register: P / EL / A (LOP) / SL / WO / H per employee per day, the month totals, and admin
// edits that write real records (attendance row, 1-day EL or LOP leave, or the day taken out of a leave).
// Run with: npm test. Uses a throwaway SQLite database; never touches the real one.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-register-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const { Employee, Attendance, Leave, HolidayCalendar, PayrollRun, AttendanceRegisterEdit } = require(path.join(src, 'shared/models'));
const LeaveAdjustment = require(path.join(src, 'shared/models/LeaveAdjustment'));
const S = require(path.join(src, 'modules/hrms/attendance/services/AttendanceRegisterService'));
const LeaveBalanceService = require(path.join(src, 'modules/hrms/leave/services/LeaveBalanceService'));
const { lopForMonth } = require(path.join(src, 'modules/hrms/leave/services/LeaveLop'));

const NOW = Date.parse('2026-11-04T11:00:00+05:30');
const M = '2026-10';
const d = (n) => `2026-10-${String(n).padStart(2, '0')}`;

test('attendance register', async (t) => {
  await sequelize.sync({ force: true });
  await HolidayCalendar.create({ id: 'cal-noida', name: 'Noida Holidays', location: 'Noida', state: 'Uttar Pradesh', year: 2026, holidays: [{ date: d(2), name: 'Gandhi Jayanti' }] });
  const mk = (id, code, name, over = {}) => Employee.create({ id, empCode: code, name, email: `${id}@t.test`, password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', role: 'EMPLOYEE', location: 'Noida', ...over });
  const aman = await mk('EMP0021', 'HMPL113', 'Aman Test');
  const neo = await mk('EMP0050', 'HMPL150', 'Neo Joiner', { joiningDate: '2026-10-15' });
  await mk('EMP0001', 'HMPL1', 'Boss', { role: 'ADMIN', isSystemAccount: true });
  await LeaveAdjustment.create({ employeeId: aman.id, empCode: aman.empCode, employeeName: aman.name, adjustmentType: 'OPENING_BALANCE', days: 10, reason: 'Migrated' });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] || 'EMP0001', role: req.headers['x-role'] || 'ADMIN' }; next(); });
  app.use('/api/attendance-register', require(path.join(src, 'modules/hrms/attendance/routes/attendanceRegister')));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/attendance-register`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
  const call = async (method, p, body, role = 'ADMIN') => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-role': role }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };

  const seed = async () => {
    await Attendance.destroy({ where: {} });
    await Leave.destroy({ where: {} });
    await AttendanceRegisterEdit.destroy({ where: {} });
    await PayrollRun.destroy({ where: {} });
    const att = (date, over = {}) => Attendance.create({ userId: 'HMPL113', userName: 'Aman Test', date, checkIn: '09:05:00 AM', checkOut: '06:02:00 PM', ...over });
    await att(d(1));
    await att(d(4));                                   // worked a Sunday
    await att('05-10-2026');                           // stored DD-MM-YYYY
    await att(d(5), { checkIn: '02:00:00 PM' });       // a second session the same day
    const leave = (over) => Leave.create({ userId: 'HMPL113', userName: 'Aman Test', type: 'Earned Leave', reason: 'x', status: 'approved', appliedAt: NOW, ...over });
    const multi = await leave({ startDate: d(6), endDate: d(8), elDays: 2, lopDays: 1, totalDays: 3, workingDates: [d(6), d(7), d(8)] });
    const legacy = await leave({ startDate: d(12), endDate: d(13), elDays: 2, lopDays: 0, totalDays: 2 });   // no working dates
    await leave({ startDate: d(20), endDate: d(21), elDays: 0, lopDays: 0, totalDays: 2, leaveCategory: 'MARRIAGE', type: 'Marriage Leave', workingDates: [d(20), d(21)] });
    await leave({ startDate: d(22), endDate: d(22), elDays: 1, totalDays: 1, status: 'pending', workingDates: [d(22)] });   // pending: not counted
    return { multi, legacy };
  };
  const reg = async (employeeId = 'EMP0021') => (await S.getRegister(M, { employeeId, now: NOW })).employees[0];
  const marks = (row) => Object.fromEntries(row.cells.map((c) => [Number(c.date.slice(8)), c.mark]));

  await t.test('the month: P from attendance, EL / A from leave, A for no record, SL, WO and H, and the totals', async () => {
    await seed();
    const full = await S.getRegister(M, { now: NOW });
    assert.deepEqual(full.employees.map((e) => e.name), ['Aman Test', 'Neo Joiner'], 'active employees, system accounts left out');
    assert.equal(full.days.length, 31);
    assert.equal(full.locked, null);

    const m = marks(await reg());
    assert.equal(m[1], 'P');
    assert.equal(m[2], 'H');
    assert.equal(m[3], 'A', 'a working day with nothing recorded is LOP');
    assert.equal(m[4], 'P', 'worked Sunday');
    assert.equal(m[5], 'P', 'DD-MM-YYYY attendance date');
    assert.deepEqual([m[6], m[7], m[8]], ['EL', 'EL', 'A'], 'EL on the first days, then the leave LOP');
    assert.equal(m[11], 'WO');
    assert.deepEqual([m[12], m[13]], ['EL', 'EL'], 'older leave on calendar days');
    assert.deepEqual([m[20], m[21]], ['SL', 'SL']);
    assert.equal(m[22], 'A', 'a pending leave does not count');

    // 31 days - 4 Sundays - 1 holiday = 26 working days: 2 P, 4 EL, 2 SL, 18 LOP; plus the worked Sunday
    assert.deepEqual((await reg()).totals, { present: 3, el: 4, lop: 18, specialLeave: 2, absent: 24, workingDays: 26 });

    const n = marks(await reg('EMP0050'));
    assert.equal(n[14], null, 'before joining');
    assert.equal(n[15], 'A');
    const nov = (await S.getRegister('2026-11', { employeeId: 'EMP0021', now: NOW })).employees[0];
    assert.equal(nov.cells.find((c) => c.date === '2026-11-05').mark, null, 'future days are blank');
  });

  await t.test('edit EL -> P: the day leaves the leave (EL comes back) and an attendance row is added', async () => {
    const { multi } = await seed();
    const before = (await LeaveBalanceService.getBalanceSnapshots([aman])).get(aman.id).available;
    const r = await S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(7), mark: 'P' }], note: 'Was at the site' }, 'boss@t.test', NOW);
    assert.equal(r.applied, 1);

    const lv = await Leave.findByPk(multi.id);
    assert.deepEqual(lv.workingDates, [d(6), d(8)]);
    assert.equal(lv.elDays, 1);
    assert.equal(lv.lopDays, 1);
    assert.deepEqual(lopForMonth([lv], 2026, 10).leaves[0].dates, [d(8)], 'payroll LOP still the 8th');
    const att = await Attendance.findOne({ where: { userId: 'HMPL113', date: d(7) } });
    assert.equal(att.checkInMethod, 'ADMIN_REGISTER');

    const m = marks(await reg());
    assert.deepEqual([m[6], m[7], m[8]], ['EL', 'P', 'A']);
    assert.equal((await LeaveBalanceService.getBalanceSnapshots([aman])).get(aman.id).available, before + 1, 'one EL refunded');

    const log = await AttendanceRegisterEdit.findAll();
    assert.equal(log.length, 1);
    assert.equal(log[0].fromMark, 'EL');
    assert.equal(log[0].toMark, 'P');
    assert.equal(log[0].editedBy, 'boss@t.test');
    assert.equal(log[0].before.leaves[0].before.elDays, 2, 'the leave as it was is kept');
  });

  await t.test('edit A -> EL charges one EL day; A -> P on a no-record day; P -> A removes the clock-in and adds an LOP day', async () => {
    await seed();
    const before = (await LeaveBalanceService.getBalanceSnapshots([aman])).get(aman.id).available;
    await S.applyEdits({ changes: [
      { employeeId: 'EMP0021', date: d(9), mark: 'EL' },
      { employeeId: 'EMP0021', date: d(14), mark: 'P' },
      { employeeId: 'EMP0021', date: d(5), mark: 'A' }
    ] }, 'boss', NOW);
    const m = marks(await reg());
    assert.deepEqual([m[9], m[14], m[5]], ['EL', 'P', 'A']);
    assert.equal((await LeaveBalanceService.getBalanceSnapshots([aman])).get(aman.id).available, before - 1);
    assert.equal(await Attendance.count({ where: { userId: 'HMPL113', date: { [require('sequelize').Op.in]: [d(5), '05-10-2026'] } } }), 0, 'both sessions removed');

    const lop = lopForMonth(await Leave.findAll(), 2026, 10);
    assert.ok(lop.leaves.some((l) => l.dates.includes(d(5))), 'payroll counts the 5th as LOP');
    const log = await AttendanceRegisterEdit.findOne({ where: { date: d(5) } });
    assert.equal(log.before.attendance.length, 2, 'both removed sessions are kept in the log');
    assert.equal((await reg()).totals.present, 3);
  });

  await t.test('an older leave on calendar days and a whole 1-day leave can be edited too', async () => {
    const { legacy } = await seed();
    await S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(12), mark: 'A' }] }, 'boss', NOW);
    const lv = await Leave.findByPk(legacy.id);
    assert.deepEqual(lv.workingDates, [d(13)]);
    assert.equal(lv.elDays, 1);
    const m = marks(await reg());
    assert.deepEqual([m[12], m[13]], ['A', 'EL']);

    await S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(13), mark: 'P' }] }, 'boss', NOW);
    assert.equal((await Leave.findByPk(legacy.id)).status, 'cancelled', 'nothing left of it');
    assert.equal(marks(await reg())[13], 'P');
  });

  await t.test('Sundays and holidays: P or off; worked Sunday back to off removes the row', async () => {
    await seed();
    await S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(4), mark: 'OFF' }, { employeeId: 'EMP0021', date: d(2), mark: 'P' }] }, 'boss', NOW);
    const m = marks(await reg());
    assert.equal(m[4], 'WO');
    assert.equal(m[2], 'P');
    await assert.rejects(S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(11), mark: 'EL' }] }, 'boss', NOW), (e) => e.extra.errors[0].code === 'MARK_NOT_ALLOWED');
    await assert.rejects(S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(3), mark: 'OFF' }] }, 'boss', NOW), (e) => e.extra.errors[0].code === 'MARK_NOT_ALLOWED');
  });

  await t.test('nothing is written when any change is invalid; each problem is listed', async () => {
    await seed();
    const attendanceBefore = await Attendance.count();
    const leavesBefore = await Leave.count();
    const err = await S.applyEdits({ changes: [
      { employeeId: 'EMP0021', date: d(3), mark: 'P' },            // fine on its own
      { employeeId: 'EMP0021', date: d(20), mark: 'P' },           // special leave
      { employeeId: 'EMP0021', date: '2026-11-10', mark: 'P' },    // future
      { employeeId: 'EMP0050', date: d(10), mark: 'P' },           // before joining
      { employeeId: 'EMP0021', date: d(3), mark: 'A' },            // same day twice
      { employeeId: 'NOPE', date: d(3), mark: 'P' },
      { employeeId: 'EMP0021', date: d(3), mark: 'X' }
    ] }, 'boss', NOW).catch((e) => e);
    assert.equal(err.code, 'INVALID_CHANGES');
    assert.deepEqual(err.extra.errors.map((e) => [e.index, e.code]), [
      [1, 'SPECIAL_LEAVE_DAY'], [2, 'FUTURE_DAY'], [3, 'NOT_JOINED'], [4, 'DUPLICATE_DAY'], [5, 'EMPLOYEE_NOT_FOUND'], [6, 'INVALID_MARK']
    ]);
    assert.equal(await Attendance.count(), attendanceBefore);
    assert.equal(await Leave.count(), leavesBefore);
    assert.equal(await AttendanceRegisterEdit.count(), 0);
  });

  await t.test('EL needs balance; only a paid register-based run locks the month; a same-mark change does nothing', async () => {
    await seed();
    const available = Math.floor((await LeaveBalanceService.getBalanceSnapshots([aman])).get(aman.id).available) - 1;   // the pending 1-day EL holds one
    const aDays = (await reg()).cells.filter((c) => c.mark === 'A' && c.source === 'NO_RECORD').slice(0, available + 1);
    assert.equal(aDays.length, available + 1, 'enough empty days for the check');
    const tooMany = await S.applyEdits({ changes: aDays.map((c) => ({ employeeId: 'EMP0021', date: c.date, mark: 'EL' })) }, 'boss', NOW).catch((e) => e);
    assert.equal(tooMany.extra.errors[0].code, 'NO_EL_BALANCE');
    assert.equal(tooMany.extra.errors.length, aDays.length, 'every EL change in the batch is listed');

    const same = await S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(1), mark: 'P' }] }, 'boss', NOW);
    assert.deepEqual([same.applied, same.unchanged], [0, 1]);

    // a payroll run from before the register keeps its stored LOP, so its month stays editable (and says so)
    const older = await PayrollRun.create({ month: M, status: 'PAID' });
    const withOlder = await S.getRegister(M, { employeeId: 'EMP0021', now: NOW });
    assert.equal(withOlder.locked, null);
    assert.equal(withOlder.olderPayrollRun.status, 'PAID');
    assert.equal((await S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(3), mark: 'P' }] }, 'boss', NOW)).applied, 1);

    // a paid run that takes its LOP from the register locks the month
    await older.destroy();
    await PayrollRun.create({ month: M, status: 'PAID', lopSource: 'REGISTER' });
    assert.deepEqual((await S.getRegister(M, { employeeId: 'EMP0021', now: NOW })).locked.status, 'PAID');
    const locked = await S.applyEdits({ changes: [{ employeeId: 'EMP0021', date: d(9), mark: 'P' }] }, 'boss', NOW).catch((e) => e);
    assert.equal(locked.extra.errors[0].code, 'PAYROLL_LOCKED');
  });

  await t.test('API: HR and admins only; the page reads the month and saves a batch', async () => {
    await seed();
    assert.equal((await call('GET', `?month=${M}`, null, 'EMPLOYEE')).status, 403);
    assert.equal((await call('GET', '?month=2026-13')).body.code, 'INVALID_MONTH');
    const r = await call('GET', `?month=${M}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.employees.every((e) => !('_employee' in e)), 'no internal fields leak');

    const saved = await call('POST', '/edits', { changes: [{ employeeId: 'EMP0021', date: d(3), mark: 'P' }], note: 'Forgot to clock in' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.applied, 1);
    const bad = await call('POST', '/edits', { changes: [{ employeeId: 'EMP0021', date: d(20), mark: 'P' }] });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errors[0].code, 'SPECIAL_LEAVE_DAY');

    const log = await call('GET', `/edits?month=${M}`);
    assert.equal(log.body.edits.length, 1);
    assert.equal(log.body.edits[0].note, 'Forgot to clock in');
  });
});
