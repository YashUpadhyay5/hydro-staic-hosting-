// Special leave (Marriage / Paternity / Maternity) tests. Run with: npm test
// Integration tests use a throwaway SQLite database in a temp folder; they never touch the real database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'special-leave-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const Employee = require(path.join(src, 'shared/models/Employee'));
const Leave = require(path.join(src, 'shared/models/Leave'));
const LeaveCategory = require(path.join(src, 'shared/models/LeaveCategory'));
const LeaveAdjustment = require(path.join(src, 'shared/models/LeaveAdjustment'));
const HolidayCalendar = require(path.join(src, 'shared/models/HolidayCalendar'));
const Attendance = require(path.join(src, 'shared/models/Attendance'));
const SL = require(path.join(src, 'modules/hrms/leave/services/SpecialLeaveService'));

// ---------------------------------------------------------------------------
// Unit tests: duration rule
// ---------------------------------------------------------------------------
test('duration rule: days and months counted from the start date, both ends included', () => {
  assert.equal(SL.maxEndDate('2026-10-20', 7, 'days'), '2026-10-26');
  assert.equal(SL.maxEndDate('2026-11-01', 6, 'months'), '2027-04-30');
  assert.equal(SL.maxEndDate('2026-08-31', 6, 'months'), '2027-02-27');
  assert.equal(SL.maxEndDate('2026-10-20', 1, 'days'), '2026-10-20');
  assert.equal(SL.maxEndDate('2026-10-20', 0, 'days'), null);
  assert.equal(SL.maxEndDate('2026-10-20', 7, 'weeks'), null);
  assert.equal(SL.inclusiveDays('2026-11-01', '2027-04-30'), 181);
  assert.equal(SL.inclusiveDays('2026-11-02', '2026-11-08'), 7);
  assert.equal(SL.inclusiveDays('2026-11-08', '2026-11-02'), 0);
  assert.equal(SL.parseISODate('2026-02-31'), null);
  assert.equal(SL.parseISODate('02-11-2026'), null);
  assert.equal(SL.allowanceLabel({ durationValue: 1, durationUnit: 'days' }), '1 day');
  assert.equal(SL.allowanceLabel({ durationValue: 6, durationUnit: 'months' }), '6 months');
});

// ---------------------------------------------------------------------------
// Integration tests: real routes + throwaway SQLite database
// ---------------------------------------------------------------------------
const now = new Date();
const Y = now.getFullYear();
const TODAY = `${Y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
let base;
let server;

async function api(method, url, { role = 'ADMIN', user = 'ADMIN', body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-role': role, 'x-test-user': user },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

test('integration', async (t) => {
  await Promise.all([Employee, Leave, LeaveCategory, LeaveAdjustment, HolidayCalendar, Attendance].map((m) => m.sync({ force: true })));
  await LeaveCategory.bulkCreate([
    { code: 'maternity', name: 'Maternity Leave', durationValue: 6, durationUnit: 'months', sortOrder: 3 },
    { code: 'marriage', name: 'Marriage Leave', durationValue: 7, durationUnit: 'days', sortOrder: 1 },
    { code: 'paternity', name: 'Paternity Leave', durationValue: 7, durationUnit: 'days', sortOrder: 2 },
    { code: 'retired', name: 'Retired Leave', durationValue: 3, durationUnit: 'days', sortOrder: 0, isActive: false }
  ]);
  await Employee.create({ id: 'E1', empCode: 'C1', name: 'Test Employee', email: 'e1@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', department: 'Ops', jobTitle: 'Engineer' });
  await LeaveAdjustment.create({ employeeId: 'E1', empCode: 'C1', employeeName: 'Test Employee', adjustmentType: 'OPENING_BALANCE', days: 5, reason: 'Migrated' });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'], name: 'Tester' }; next(); });
  app.use('/api/leaves', require(path.join(src, 'modules/hrms/leave/routes/leave')));
  app.use('/api/employees', require(path.join(src, 'modules/hrms/employee/routes/employee')));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  const apply = (body) => api('POST', '/api/leaves', { role: 'EMPLOYEE', user: 'E1', body: { userId: 'C1', userName: 'Test Employee', reason: 'r', ...body } });
  const setStatus = (id, status) => api('PATCH', `/api/leaves/${id}/status`, { body: { status } });

  // Everything that is computed from approved leave requests or holds EL, for before/after comparisons.
  const elState = async () => {
    const emp = (await Employee.findByPk('E1', { raw: true }));
    const profile = (await api('GET', '/api/employees/E1')).body;
    const list = (await api('GET', `/api/leaves/balances?year=${Y}`)).body;
    return {
      employee: { consumedLeaves: emp.consumedLeaves, allowedLeaves: emp.allowedLeaves, openingLeaveBalance: emp.openingLeaveBalance, earnedLeaves: emp.earnedLeaves, updatedAt: String(emp.updatedAt) },
      profile: { availableLeaves: profile.availableLeaves, totalEarnedLeaves: profile.totalEarnedLeaves, consumedLeaves: profile.consumedLeaves, leaveBalance: profile.leaveBalance },
      adjustmentRows: await LeaveAdjustment.count(),
      adjustments: (await api('GET', '/api/leaves/adjustments?employeeId=E1')).body,
      ledgerThisYear: (await api('GET', `/api/leaves/balances/E1?year=${Y}`)).body,
      ledgerNextYear: (await api('GET', `/api/leaves/balances/E1?year=${Y + 1}`)).body,
      listRow: list.data.find((d) => d.employeeId === 'E1'),
      listSummary: list.summary
    };
  };

  let before;
  let marriage;

  await t.test('1. GET /categories: active categories ordered by sort order, four fields', async () => {
    const r = await api('GET', '/api/leaves/categories', { role: 'EMPLOYEE', user: 'E1' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, [
      { code: 'marriage', name: 'Marriage Leave', durationValue: 7, durationUnit: 'days' },
      { code: 'paternity', name: 'Paternity Leave', durationValue: 7, durationUnit: 'days' },
      { code: 'maternity', name: 'Maternity Leave', durationValue: 6, durationUnit: 'months' }
    ]);
    before = await elState();
  });

  await t.test('2. marriage 7 days: 201, no EL, no LOP, client EL fields ignored', async () => {
    const r = await apply({ category: 'marriage', startDate: '2026-11-02', endDate: '2026-11-08', type: 'Earned Leave', elDays: 7, lopDays: 3, totalDays: 99 });
    assert.equal(r.status, 201);
    marriage = r.body;
    assert.equal(marriage.type, 'Marriage Leave');
    assert.equal(marriage.category, 'marriage');
    assert.equal(marriage.elDays, 0);
    assert.equal(marriage.lopDays, 0);
    assert.equal(marriage.totalDays, 7);
    assert.equal(marriage.status, 'pending');
    assert.equal(marriage.userId, 'C1');
  });

  await t.test('3. marriage 8 days: 400 with the allowance', async () => {
    const r = await apply({ category: 'marriage', startDate: '2026-11-02', endDate: '2026-11-09' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'Marriage Leave allows up to 7 days.' });
  });

  await t.test('4. maternity: 6 months is 181 days from 2026-11-01; one day more is refused', async () => {
    const ok = await apply({ category: 'maternity', startDate: '2026-11-01', endDate: '2027-04-30' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.totalDays, 181);
    assert.equal(ok.body.type, 'Maternity Leave');
    const tooLong = await apply({ category: 'maternity', startDate: '2026-11-01', endDate: '2027-05-01' });
    assert.equal(tooLong.status, 400);
    assert.deepEqual(tooLong.body, { error: 'Maternity Leave allows up to 6 months.' });
  });

  await t.test('5. paternity 3 days: 201', async () => {
    const r = await apply({ category: 'paternity', startDate: '2026-12-01', endDate: '2026-12-03' });
    assert.equal(r.status, 201);
    assert.equal(r.body.totalDays, 3);
    assert.equal(r.body.category, 'paternity');
  });

  await t.test('6. unknown / inactive category, end before start, impossible date: 400, nothing saved', async () => {
    const count = await Leave.count();
    const cases = [
      [{ category: 'sabbatical', startDate: '2026-11-02', endDate: '2026-11-03' }, 'Unknown leave category.'],
      [{ category: 'retired', startDate: '2026-11-02', endDate: '2026-11-03' }, 'Unknown leave category.'],
      [{ category: 'marriage', startDate: '2026-11-08', endDate: '2026-11-02' }, 'Invalid leave dates.'],
      [{ category: 'marriage', startDate: '2026-02-31', endDate: '2026-03-02' }, 'Invalid leave dates.'],
      [{ category: 'marriage', startDate: '2026-11-02', endDate: 'soon' }, 'Invalid leave dates.']
    ];
    for (const [body, error] of cases) {
      const r = await apply(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.deepEqual(r.body, { error });
    }
    assert.equal(await Leave.count(), count);
  });

  await t.test('pending special leave changes nothing that holds EL', async () => {
    const now2 = await elState();
    assert.deepEqual(now2, before);
    assert.equal(now2.listSummary.pendingLeaveRequests, 0);
  });

  await t.test('7. approve, then reject the marriage request: EL, ledger, register untouched', async () => {
    const approved = await setStatus(marriage.id, 'approved');
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'approved');
    assert.deepEqual(await elState(), before);

    const rejected = await setStatus(marriage.id, 'rejected');
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'rejected');
    assert.deepEqual(await elState(), before);

    // Approved again (rejected -> approved) and back to pending: still nothing.
    await setStatus(marriage.id, 'approved');
    await setStatus(marriage.id, 'pending');
    assert.deepEqual(await elState(), before);
  });

  await t.test('approved special leave never appears in the ledger or its credit usage', async () => {
    await setStatus(marriage.id, 'approved');
    const l = (await api('GET', `/api/leaves/balances/E1?year=${Y}`)).body;
    const records = l.months.flatMap((m) => m.consumedRecords);
    assert.ok(!records.some((r) => r.id === marriage.id));
    assert.ok(!l.credits.some((c) => (c.uses || []).some((u) => u.leaveId === marriage.id)));
  });

  let ordinary;
  await t.test('8. an ordinary request still splits EL/LOP, consumes EL and shows in the ledger', async () => {
    const available = Math.floor(before.ledgerThisYear.availableBalance);
    assert.ok(available > 0);
    const total = available + 2; // working days (no calendars here, so only Sundays are skipped)
    let end = addDays(TODAY, -1);
    for (let n = 0; n < total;) { end = addDays(end, 1); if (new Date(`${end}T00:00:00Z`).getUTCDay() !== 0) n++; }
    const r = await apply({ startDate: TODAY, endDate: end });
    assert.equal(r.status, 201);
    ordinary = r.body;
    assert.equal(ordinary.type, 'Earned Leave');
    assert.equal('category' in ordinary, false); // response unchanged for ordinary requests
    assert.equal((await Leave.findByPk(ordinary.id)).leaveCategory, null);
    assert.equal(ordinary.totalDays, total);
    assert.equal(ordinary.elDays, available); // pending special leave does not reduce the EL on offer
    assert.equal(ordinary.lopDays, 2);

    const ok = await setStatus(ordinary.id, 'approved');
    assert.equal(ok.status, 200);
    const emp = await Employee.findByPk('E1');
    assert.equal(emp.consumedLeaves, before.employee.consumedLeaves + available);
    const l = (await api('GET', `/api/leaves/balances/E1?year=${Y}`)).body;
    const records = l.months.flatMap((m) => m.consumedRecords);
    assert.ok(records.some((x) => x.id === ordinary.id));
    assert.equal(l.lifetimeConsumed, before.ledgerThisYear.lifetimeConsumed + available);
    assert.ok(l.credits.some((c) => (c.uses || []).some((u) => u.leaveId === ordinary.id)));
  });

  await t.test('9. GET /api/leaves?userId: category on every request', async () => {
    const r = await api('GET', '/api/leaves?userId=C1', { role: 'EMPLOYEE', user: 'E1' });
    assert.equal(r.status, 200);
    const byId = new Map(r.body.map((x) => [x.id, x]));
    assert.equal(byId.get(marriage.id).category, 'marriage');
    assert.equal(byId.get(marriage.id).type, 'Marriage Leave');
    assert.equal(byId.get(ordinary.id).category, null);
    assert.equal(byId.get(ordinary.id).type, 'Earned Leave');
    assert.ok(r.body.every((x) => 'category' in x));
  });
});
