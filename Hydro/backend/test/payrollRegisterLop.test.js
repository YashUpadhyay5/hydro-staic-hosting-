// Pay run Step 1 LOP from the monthly attendance register, for runs created since the register exists.
// Runs made before it keep their figures: leave LOP, or the LOP they stored when processed.
// Run with: npm test. Uses a throwaway SQLite database; never touches the real one.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-register-lop-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const { Employee, Attendance, Leave, PayrollRun } = require(path.join(src, 'shared/models'));
const PayCalculator = require(path.join(src, 'modules/payroll/services/PayCalculator'));
const Register = require(path.join(src, 'modules/hrms/attendance/services/AttendanceRegisterService'));

const M = '2026-10';   // a past month: every day of it counts
const d = (n) => `2026-10-${String(n).padStart(2, '0')}`;
const NO_CLOCK_IN = [5, 6, 7];      // working days with nothing recorded
const LOP_LEAVE_DAY = 8;            // a day of approved leave that is LOP

test('payroll LOP from the attendance register', async (t) => {
  await sequelize.sync({ force: true });
  const emp = await Employee.create({ id: 'E1', empCode: 'HMPL1', name: 'Pay Test', email: 'e1@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', compensationGross: 31000 });
  const idle = await Employee.create({ id: 'E2', empCode: 'HMPL2', name: 'No Clock-ins', email: 'e2@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', compensationGross: 31000 });

  for (let n = 1; n <= 31; n++) {
    const date = d(n);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 || NO_CLOCK_IN.includes(n) || n === LOP_LEAVE_DAY) continue;
    await Attendance.create({ userId: 'HMPL1', userName: 'Pay Test', date, checkIn: '09:00:00 AM', checkOut: '06:00:00 PM' });
  }
  await Leave.create({ userId: 'HMPL1', userName: 'Pay Test', type: 'Earned Leave', reason: 'r', status: 'approved', appliedAt: Date.now(),
    startDate: d(LOP_LEAVE_DAY), endDate: d(LOP_LEAVE_DAY), elDays: 0, lopDays: 1, totalDays: 1, workingDates: [d(LOP_LEAVE_DAY)] });
  t.after(async () => { await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  const pay = (employee, run, extra = {}) => PayCalculator.computeEmployeePay({ employee, month: M, wizardState: {}, payrollRunId: run.id, ...extra });

  await t.test('a run made before the register keeps leave LOP, and a processed one keeps the LOP it stored', async () => {
    const older = await PayrollRun.create({ month: M, status: 'APPROVED' });
    const live = await pay(emp, older);
    assert.equal(live.lopSource, 'LEAVES');
    assert.equal(live.lopDays, 1, 'only the LOP leave day, as before');
    assert.equal(live.registerLopNote, 'OLDER_RUN');

    const stored = await pay(emp, older, { mode: 'RECALC', existingItem: { id: 'stored-item', lopDays: 0 } });
    assert.equal(stored.lopSource, 'STORED');
    assert.equal(stored.lopDays, 0, 'attendance corrections cannot change a payroll that was already run');
    await older.destroy();
  });

  await t.test('a new run takes LOP from the register: no-clock-in working days plus LOP leave days', async () => {
    const run = await PayrollRun.create({ month: M, status: 'DRAFT', lopSource: 'REGISTER' });
    const r = await pay(emp, run);
    assert.equal(r.lopSource, 'REGISTER');
    assert.equal(r.lopDays, 4);
    assert.equal(r.registerLopDays, 4);
    assert.deepEqual(r.registerLopDates, [...NO_CLOCK_IN, LOP_LEAVE_DAY].map(d));
    assert.equal(r.leaveLopDays, 1, 'the leave figure is still shown');
    assert.equal(r.workedDays, 31 - 4);

    const edited = await pay(emp, run, { wizardState: { editedLop: { HMPL1: 2 } } });
    assert.equal(edited.lopSource, 'EDITED');
    assert.equal(edited.lopDays, 2, 'a Step 1 edit still wins');
    assert.equal(edited.registerLopDays, 4);

    // an employee with no clock-in at all that month is not given a whole month of LOP
    const none = await pay(idle, run);
    assert.equal(none.lopSource, 'LEAVES');
    assert.equal(none.lopDays, 0);
    assert.equal(none.registerLopNote, 'NO_ATTENDANCE');

    // correcting the register changes the new run's LOP
    await Register.applyEdits({ changes: [{ employeeId: 'E1', date: d(5), mark: 'P' }] }, 'boss');
    assert.equal((await pay(emp, run)).lopDays, 3);

    // once approved, it still follows the register (whose edits are then locked)
    run.status = 'APPROVED';
    await run.save();
    assert.equal((await pay(emp, run)).lopSource, 'REGISTER');
    const lockedEdit = await Register.applyEdits({ changes: [{ employeeId: 'E1', date: d(6), mark: 'P' }] }, 'boss').catch((e) => e);
    assert.equal(lockedEdit.extra.errors[0].code, 'PAYROLL_LOCKED');
    await run.destroy();
  });

  await t.test('creating a pay run marks it to use the register; the preview carries the register figures', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/payroll', require(path.join(src, 'modules/payroll/routes/payroll')));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/payroll`;
    try {
      const created = await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: M }) });
      assert.equal(created.status, 201);
      const run = await created.json();
      assert.equal(run.lopSource, 'REGISTER');

      const res = await fetch(`${base}/run/${run.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const rows = new Map((await res.json()).rows.map((r) => [r.employeeId, r]));
      assert.equal(rows.get('E1').lopSource, 'REGISTER');
      assert.equal(rows.get('E1').lopDays, 3);
      assert.equal(rows.get('E2').registerLopNote, 'NO_ATTENDANCE');
    } finally {
      server.close();
    }
  });
});
