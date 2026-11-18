// Payroll LOP from approved leave (Step 1 auto-fill). Run with: npm test
// Integration tests use a throwaway SQLite database in a temp folder; they never touch the real database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-lop-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const models = require(path.join(src, 'shared/models'));
const { lopDatesOfLeave, lopForMonth } = require(path.join(src, 'modules/hrms/leave/services/LeaveLop'));
const PayCalculator = require(path.join(src, 'modules/payroll/services/PayCalculator'));

const approved = (over) => ({ id: Math.random().toString(36).slice(2), status: 'approved', type: 'Earned Leave', ...over });

// ---------------------------------------------------------------------------
// Unit tests: which dates of a leave are LOP
// ---------------------------------------------------------------------------
test('working-day requests: LOP is the working dates after the EL ones', () => {
  const l = approved({ startDate: '2026-12-21', endDate: '2026-12-27', elDays: 2, lopDays: 2, totalDays: 4, workingDates: JSON.stringify(['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26']) });
  assert.deepEqual(lopDatesOfLeave(l), ['2026-12-24', '2026-12-26']);
  assert.deepEqual(lopDatesOfLeave({ ...l, workingDates: ['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26'] }), ['2026-12-24', '2026-12-26']);
});

test('older requests (no working dates): LOP is the calendar days after the EL days', () => {
  const l = approved({ startDate: '2026-11-02', endDate: '2026-11-14', elDays: 12, lopDays: 1, totalDays: 13 });
  assert.deepEqual(lopDatesOfLeave(l), ['2026-11-14']);
  assert.deepEqual(lopDatesOfLeave(approved({ startDate: '02-11-2026', endDate: '04-11-2026', elDays: 1, lopDays: 2, totalDays: 3 })), ['2026-11-03', '2026-11-04']);
});

test('LOP / unpaid typed leave is LOP on every day; special leave and all-EL leave never', () => {
  assert.deepEqual(lopDatesOfLeave(approved({ type: 'Loss of Pay', startDate: '2026-11-30', endDate: '2026-12-02', elDays: 0, lopDays: 0, totalDays: 3 })), ['2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(lopDatesOfLeave(approved({ type: 'Unpaid Leave', startDate: '2026-11-30', endDate: '2026-12-01' })), ['2026-11-30', '2026-12-01']);
  assert.deepEqual(lopDatesOfLeave(approved({ type: 'Marriage Leave', leaveCategory: 'marriage', startDate: '2026-11-02', endDate: '2026-11-08', elDays: 0, lopDays: 0, totalDays: 7 })), []);
  assert.deepEqual(lopDatesOfLeave(approved({ startDate: '2026-11-02', endDate: '2026-11-03', elDays: 2, lopDays: 0, totalDays: 2 })), []);
});

test('pay month: only approved leave, split by date across months', () => {
  const span = approved({ id: 'span', startDate: '2026-12-29', endDate: '2027-01-02', elDays: 1, lopDays: 3, totalDays: 4, workingDates: ['2026-12-29', '2026-12-30', '2027-01-01', '2027-01-02'] });
  const pending = { ...span, id: 'p', status: 'pending' };
  const rejected = { ...span, id: 'r', status: 'rejected' };
  assert.deepEqual(lopForMonth([span, pending, rejected], 2026, 12), { days: 1, leaves: [{ leaveId: 'span', type: 'Earned Leave', startDate: '2026-12-29', endDate: '2027-01-02', dates: ['2026-12-30'] }] });
  assert.equal(lopForMonth([span], 2027, 1).days, 2);
  assert.equal(lopForMonth([span], 2026, 11).days, 0);
});

// ---------------------------------------------------------------------------
// Integration: PayCalculator and the pay run preview
// ---------------------------------------------------------------------------
test('integration', async (t) => {
  await sequelize.sync({ force: true });
  const { Employee, Leave, PayrollRun } = models;
  const emp = await Employee.create({ id: 'E1', empCode: 'HMPL1', name: 'Pay Test', email: 'e1@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', compensationGross: 31000 });
  await Employee.create({ id: 'E2', empCode: 'HMPL2', name: 'No Leave', email: 'e2@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', compensationGross: 31000 });
  const base = { userName: 'Pay Test', reason: 'r', appliedAt: Date.now() };
  await Leave.bulkCreate([
    { ...base, userId: 'HMPL1', startDate: '2026-12-21', endDate: '2026-12-27', type: 'Earned Leave', status: 'approved', elDays: 2, lopDays: 2, totalDays: 4, workingDates: ['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26'] },
    { ...base, userId: 'HMPL1', startDate: '2026-12-29', endDate: '2027-01-02', type: 'Earned Leave', status: 'approved', elDays: 1, lopDays: 3, totalDays: 4, workingDates: ['2026-12-29', '2026-12-30', '2027-01-01', '2027-01-02'] },
    { ...base, userId: 'HMPL1', startDate: '2026-12-07', endDate: '2026-12-08', type: 'Earned Leave', status: 'pending', elDays: 0, lopDays: 2, totalDays: 2, workingDates: ['2026-12-07', '2026-12-08'] },
    { ...base, userId: 'HMPL1', startDate: '2026-12-14', endDate: '2026-12-20', type: 'Marriage Leave', leaveCategory: 'marriage', status: 'approved', elDays: 0, lopDays: 0, totalDays: 7 }
  ]);
  t.after(async () => { await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  await t.test('no Step 1 edit: LOP comes from approved leave in the month and reduces pay', async () => {
    const r = await PayCalculator.computeEmployeePay({ employee: emp, month: '2026-12', wizardState: {} });
    assert.equal(r.lopDays, 3); // 24 + 26 Dec, plus 30 Dec of the leave running into January
    assert.equal(r.lopSource, 'LEAVES');
    assert.equal(r.leaveLopDays, 3);
    assert.deepEqual(r.leaveLop.map((x) => x.dates), [['2026-12-24', '2026-12-26'], ['2026-12-30']]);
    assert.equal(r.workedDays, 31 - 3);
    const noLop = await PayCalculator.computeEmployeePay({ employee: emp, month: '2026-11', wizardState: {} });
    assert.equal(noLop.lopDays, 0);
    assert.ok(r.grossEarned < noLop.grossEarned);
    const jan = await PayCalculator.computeEmployeePay({ employee: emp, month: '2027-01', wizardState: {} });
    assert.equal(jan.lopDays, 2);
  });

  await t.test('a Step 1 edit still wins (also 0), and the leave figure stays visible', async () => {
    const zero = await PayCalculator.computeEmployeePay({ employee: emp, month: '2026-12', wizardState: { editedLop: { HMPL1: 0 } } });
    assert.equal(zero.lopDays, 0);
    assert.equal(zero.lopSource, 'EDITED');
    assert.equal(zero.leaveLopDays, 3);
    const five = await PayCalculator.computeEmployeePay({ employee: emp, month: '2026-12', wizardState: { editedLop: { E1: 5 } } });
    assert.equal(five.lopDays, 5);
    assert.equal(five.workedDays, 31 - 5);
  });

  await t.test('pay run preview rows carry the leave LOP for Step 1', async () => {
    const run = await PayrollRun.create({ month: '2026-12', status: 'DRAFT', totalGross: 0, totalDeductions: 0, totalNet: 0 });
    const app = express();
    app.use(express.json());
    app.use('/api/payroll', require(path.join(src, 'modules/payroll/routes/payroll')));
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/payroll/run/${run.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(res.status, 200);
      const rows = new Map((await res.json()).rows.map((r) => [r.employeeId, r]));
      assert.equal(rows.get('E1').lopDays, 3);
      assert.equal(rows.get('E1').leaveLopDays, 3);
      assert.equal(rows.get('E2').lopDays, 0);
      assert.equal(rows.get('E2').leaveLopDays, 0);
    } finally {
      server.close();
    }
  });
});
