// Leave counts working days only (no Sundays, no holidays of the employee's own calendar). Run with: npm test
// Integration tests use a throwaway SQLite database in a temp folder; they never touch the real database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'working-days-test-'));
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
const WD = require(path.join(src, 'modules/hrms/leave/services/WorkingDays'));
const S = require(path.join(src, 'modules/hrms/leave/services/LeaveBalanceService'));

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------
test('holiday dates: accepted formats, unreadable and impossible dates ignored', () => {
  for (const v of ['2026-08-15', '15-08-2026', '15/08/2026', '15 Aug 2026', 'Aug 15, 2026', '15 August 2026', '15-8-2026']) {
    assert.equal(WD.normalizeHolidayDate(v), '2026-08-15', v);
  }
  assert.equal(WD.normalizeHolidayDate('5-8-2026'), '2026-08-05'); // day first, never read as May 8
  assert.equal(WD.normalizeHolidayDate('2026-02-31'), null);
  assert.equal(WD.normalizeHolidayDate('31/02/2026'), null);
  assert.equal(WD.normalizeHolidayDate('someday'), null);
  assert.equal(WD.normalizeHolidayDate(undefined), null);
});

test('splitLeaveDays: Sundays and holidays skipped, a holiday on a Sunday counts once as Sunday', () => {
  const h = new Map([['2026-12-23', 'A'], ['2026-12-25', 'B'], ['2026-12-27', 'On a Sunday']]);
  const d = WD.splitLeaveDays('2026-12-21', '2026-12-27', h);
  assert.deepEqual(d.working, ['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26']);
  assert.deepEqual(d.sundays, ['2026-12-27']);
  assert.deepEqual(d.holidays, ['2026-12-23', '2026-12-25']);
  assert.equal(d.all.length, 7);
  assert.equal(WD.splitLeaveDays('2026-12-27', '2026-12-21', h).all.length, 0);
  assert.equal(WD.splitLeaveDays('2026-01-01', '2036-12-31', h).all.length, 0); // longer than MAX_SPAN_DAYS
});

test('ledger: EL goes to stored working dates; older requests keep their calendar days', () => {
  const emp = { id: 'E1', empCode: 'C1', name: 'T', joiningDate: '2020-01-01', status: 'ACTIVE' };
  const now = new Date(2026, 11, 28);
  const opening = [{ id: 'o', adjustmentType: 'OPENING_BALANCE', days: 10, status: 'ACTIVE', createdAt: new Date(2026, 0, 1) }];
  const uses = (leave) => {
    const l = S.computeLedger(emp, opening, [leave], 2026, { now });
    return l.credits.flatMap((c) => c.uses).filter((u) => u.leaveId === leave.id).map((u) => u.date).sort();
  };
  const base = { status: 'approved', type: 'Earned Leave', startDate: '2026-12-21', endDate: '2026-12-27' };
  assert.deepEqual(uses({ ...base, id: 'new', elDays: 3, lopDays: 1, totalDays: 4, workingDates: JSON.stringify(['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26']) }),
    ['2026-12-21', '2026-12-22', '2026-12-24']);
  assert.deepEqual(uses({ ...base, id: 'old', elDays: 7, lopDays: 0, totalDays: 7 }),
    ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27']);
});

// ---------------------------------------------------------------------------
// Integration tests: real routes + throwaway SQLite database
// ---------------------------------------------------------------------------
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
  await HolidayCalendar.create({ id: 'cal-a', name: 'City A Calendar', location: 'CityA', year: 2026, holidays: [
    { id: 'a1', date: '2026-12-23', title: 'A Festival' },
    { id: 'a2', date: '25 Dec 2026', title: 'A Christmas' },
    { id: 'a3', date: 'someday', title: 'Unreadable' },
    { id: 'a4', date: '2026-02-31', title: 'Impossible' }
  ] });
  await HolidayCalendar.create({ id: 'cal-b', name: 'City B Calendar', location: 'CityB', year: 2026, holidays: [{ id: 'b1', date: '2026-12-24', title: 'B Day' }] });
  await LeaveCategory.create({ code: 'marriage', name: 'Marriage Leave', durationValue: 7, durationUnit: 'days', sortOrder: 1 });
  const now = new Date();
  const nextMonth = `${new Date(now.getFullYear(), now.getMonth() + 1, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 1).getMonth() + 1).padStart(2, '0')}-01`;
  const mk = (id, code, location, over = {}) => Employee.create({ id, empCode: code, name: `Name ${id}`, email: `${id}@t.test`, password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', location, ...over });
  await mk('EA', 'HMPLA', 'CityA');
  await mk('EB', 'HMPLB', 'CityB');
  await mk('EZ', 'HMPLZ', 'CityA', { joiningDate: nextMonth }); // joins next month, so no EL yet
  for (const [id, code] of [['EA', 'HMPLA'], ['EB', 'HMPLB']]) {
    await LeaveAdjustment.create({ employeeId: id, empCode: code, employeeName: `Name ${id}`, adjustmentType: 'OPENING_BALANCE', days: 20, reason: 'Migrated' });
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'], name: 'Tester' }; next(); });
  app.use('/api/leaves', require(path.join(src, 'modules/hrms/leave/routes/leave')));
  app.use('/api/employees', require(path.join(src, 'modules/hrms/employee/routes/employee')));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  const apply = (userId, startDate, endDate, extra = {}) => api('POST', '/api/leaves', { role: 'EMPLOYEE', user: userId, body: { userId, userName: 'x', startDate, endDate, reason: 'r', ...extra } });
  const setStatus = (id, status) => api('PATCH', `/api/leaves/${id}/status`, { body: { status } });
  const ledger2026 = async (id) => (await api('GET', `/api/leaves/balances/${id}?year=2026`)).body;
  const usedDates = (l, leaveId) => l.credits.flatMap((c) => c.uses).filter((u) => u.leaveId === leaveId).map((u) => u.date).sort();
  const consumed = async (id) => (await Employee.findByPk(id)).consumedLeaves || 0;

  let reqA;
  let reqB;
  await t.test('1 + 4. A (holidays 23, 25 Dec) 21 -> 27 Dec: 4 working days; client counts ignored', async () => {
    const r = await apply('EA', '2026-12-21', '2026-12-27', { totalDays: 99, elDays: 99, lopDays: 99 });
    assert.equal(r.status, 201);
    reqA = r.body;
    assert.equal(reqA.totalDays, 4);
    assert.equal(reqA.elDays, 4);
    assert.equal(reqA.lopDays, 0);
    assert.deepEqual(reqA.workingDates, ['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26']);
    assert.equal(reqA.userId, 'HMPLA');
  });

  await t.test('2. B (holiday 24 Dec) same dates: 5 working days', async () => {
    const r = await apply('EB', '2026-12-21', '2026-12-27');
    assert.equal(r.status, 201);
    reqB = r.body;
    assert.equal(reqB.totalDays, 5);
    assert.deepEqual(reqB.workingDates, ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-25', '2026-12-26']);
  });

  await t.test('3. applying with the employee code counts the same and is listed under the code', async () => {
    const r = await apply('HMPLA', '2026-12-21', '2026-12-27');
    assert.equal(r.status, 201);
    assert.equal(r.body.totalDays, 4);
    const list = await api('GET', '/api/leaves?userId=HMPLA', { role: 'EMPLOYEE', user: 'EA' });
    assert.ok(list.body.some((x) => x.id === r.body.id));
    assert.ok(list.body.some((x) => x.id === reqA.id));
    assert.deepEqual(list.body.find((x) => x.id === r.body.id).workingDates, reqA.workingDates);
  });

  await t.test('5. only Sundays/holidays: 400 and nothing saved; the same date is a working day for B', async () => {
    const count = await Leave.count();
    for (const [from, to] of [['2026-12-27', '2026-12-27'], ['2026-12-23', '2026-12-23'], ['2026-12-25', '2026-12-25']]) {
      const r = await apply('EA', from, to);
      assert.equal(r.status, 400);
      assert.deepEqual(r.body, { error: 'The selected dates are all Sundays or holidays, so no leave is needed.' });
    }
    assert.equal(await Leave.count(), count);
    const b = await apply('EB', '2026-12-23', '2026-12-23');
    assert.equal(b.status, 201);
    assert.equal(b.body.totalDays, 1);
  });

  await t.test('invalid dates: 400 and nothing saved', async () => {
    const count = await Leave.count();
    for (const [from, to] of [['2026-12-27', '2026-12-21'], ['2026-02-31', '2026-03-02'], ['soon', '2026-12-21'], ['2026-01-01', '2036-12-31']]) {
      const r = await apply('EA', from, to);
      assert.equal(r.status, 400, `${from} -> ${to}`);
      assert.deepEqual(r.body, { error: 'Invalid leave dates.' });
    }
    assert.equal(await Leave.count(), count);
  });

  await t.test('6. A 23 -> 24 Dec: 1 day (23 is a holiday)', async () => {
    const r = await apply('EA', '2026-12-23', '2026-12-24');
    assert.equal(r.status, 201);
    assert.equal(r.body.totalDays, 1);
    assert.deepEqual(r.body.workingDates, ['2026-12-24']);
  });

  await t.test('7. 0 EL, 2 working days: all LOP; approving consumes no EL', async () => {
    const r = await apply('EZ', '2026-12-21', '2026-12-22');
    assert.equal(r.status, 201);
    assert.equal(r.body.elDays, 0);
    assert.equal(r.body.lopDays, 2);
    assert.equal(r.body.totalDays, 2);
    const ledgerBefore = await ledger2026('EZ');
    assert.equal((await setStatus(r.body.id, 'approved')).status, 200);
    assert.equal(await consumed('EZ'), 0);
    const l = await ledger2026('EZ');
    assert.equal(l.lifetimeConsumed, ledgerBefore.lifetimeConsumed);
    assert.deepEqual(usedDates(l, r.body.id), []);
  });

  await t.test('8. approve: EL +4 on A\'s working dates only (B on its own); revoke restores', async () => {
    const startA = await consumed('EA');
    const ledgerBefore = await ledger2026('EA');
    assert.equal((await setStatus(reqA.id, 'approved')).status, 200);
    assert.equal(await consumed('EA'), startA + 4);
    const l = await ledger2026('EA');
    assert.deepEqual(usedDates(l, reqA.id), ['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26']);
    assert.equal(l.months.find((m) => m.month === 12).consumedFromRequests, 4);
    assert.equal(l.lifetimeConsumed, ledgerBefore.lifetimeConsumed + 4);

    assert.equal((await setStatus(reqB.id, 'approved')).status, 200);
    assert.deepEqual(usedDates(await ledger2026('EB'), reqB.id), ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-25', '2026-12-26']);

    assert.equal((await setStatus(reqA.id, 'rejected')).status, 200);
    assert.equal(await consumed('EA'), startA);
    const after = await ledger2026('EA');
    assert.deepEqual(usedDates(after, reqA.id), []);
    assert.equal(after.lifetimeConsumed, ledgerBefore.lifetimeConsumed);
  });

  await t.test('9. special leave over the same week still counts 7 calendar days', async () => {
    const r = await apply('EA', '2026-12-21', '2026-12-27', { category: 'marriage' });
    assert.equal(r.status, 201);
    assert.equal(r.body.totalDays, 7);
    assert.equal(r.body.workingDates ?? null, null);
  });

  await t.test('10. the employee\'s own holiday list is the calendar leave counting uses', async () => {
    const mine = await api('GET', '/api/employees/my-holidays?employeeId=EA');
    assert.equal(mine.status, 200);
    assert.equal(mine.body.calendar.id, 'cal-a');
    assert.deepEqual(mine.body.holidays.map((h) => h.date).sort(), ['2026-02-31', '2026-12-23', '25 Dec 2026', 'someday'].sort());
    assert.deepEqual(Object.keys(mine.body).sort(), ['calendar', 'employee', 'holidays', 'success']);
    const byId = await api('GET', '/api/employees/EB/holidays');
    assert.equal(byId.body.calendar.id, 'cal-b');
    assert.deepEqual(byId.body.holidays.map((h) => h.title), ['B Day']);
  });
});
