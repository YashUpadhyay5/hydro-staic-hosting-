// Leave Balances module tests. Run with: npm test
// Integration tests use a throwaway SQLite database in a temp folder; they never touch the real database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-balances-test-'));
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
const LeaveAdjustment = require(path.join(src, 'shared/models/LeaveAdjustment'));
const HolidayCalendar = require(path.join(src, 'shared/models/HolidayCalendar'));
const Attendance = require(path.join(src, 'shared/models/Attendance'));
const policy = require(path.join(src, 'core/config/leavePolicy'));
const S = require(path.join(src, 'modules/hrms/leave/services/LeaveBalanceService'));

// ---------------------------------------------------------------------------
// Unit tests: pure ledger computation (fixed "today" = 2026-12-15)
// ---------------------------------------------------------------------------
const NOW = new Date(2026, 11, 15);
const emp = (over = {}) => ({ id: 'E1', empCode: 'C1', name: 'Test', joiningDate: '2020-01-01', status: 'ACTIVE', ...over });
const adj = (over) => ({ id: Math.random().toString(36).slice(2), days: 0, status: 'ACTIVE', createdAt: new Date(), ...over });
const leave = (over) => ({ id: Math.random().toString(36).slice(2), status: 'approved', type: 'Earned Leave', ...over });
const month = (l, m) => l.months.find((x) => x.month === m);

test('policy: ledger starts at the configured month with 1 day per eligible month', () => {
  assert.equal(policy.EARNED_LEAVE_PER_MONTH, 1);
  const l = S.computeLedger(emp(), [], [], 2026, { now: NOW });
  assert.equal(l.months.length, 12);
  for (let m = 1; m <= 9; m++) {
    assert.equal(month(l, m).inLedger, false);
    assert.equal(month(l, m).earnedLeave, 0);
    assert.equal(month(l, m).remainingBalance, null);
  }
  assert.deepEqual([10, 11, 12].map((m) => month(l, m).earnedLeave), [1, 1, 1]);
  assert.equal(l.yearSummary.earnedLeave, 3);
  assert.equal(l.yearSummary.remainingBalance, 3);
});

test('joining-date eligibility: no earned leave before the joining month', () => {
  const l = S.computeLedger(emp({ joiningDate: '20-11-2026' }), [], [], 2026, { now: NOW });
  assert.equal(month(l, 10).earnedLeave, 0);
  assert.equal(month(l, 10).ineligibleReason, 'Before joining date');
  assert.equal(month(l, 11).earnedLeave, 1);
  assert.equal(month(l, 12).earnedLeave, 1);
});

test('future months earn nothing; a future year carries the balance forward', () => {
  const l = S.computeLedger(emp(), [], [], 2027, { now: NOW });
  assert.ok(l.months.every((m) => m.earnedLeave === 0 && !m.eligible));
  assert.equal(l.yearSummary.remainingBalance, 3);
});

test('opening balance replays Add Opening Balance rows once (credit, debit, set)', () => {
  const rows = [
    adj({ adjustmentType: 'OPENING_BALANCE', days: 9 }),
    adj({ adjustmentType: 'DEBIT', days: 2 }),
    adj({ adjustmentType: 'CREDIT', days: 1.5 })
  ];
  const l = S.computeLedger(emp(), rows, [], 2026, { now: NOW });
  assert.equal(l.openingBalance, 8.5);
  assert.equal(month(l, 10).remainingBalance, 9.5);
  assert.equal(l.yearSummary.remainingBalance, 11.5);
  const set = S.computeLedger(emp(), [...rows, adj({ adjustmentType: 'SET_BALANCE', days: 4 })], [], 2026, { now: NOW });
  assert.equal(set.openingBalance, 4);
});

test('consumed: EL days split across months by date; pre-ledger leave listed but not deducted', () => {
  const leaves = [
    leave({ startDate: '2026-10-30', endDate: '2026-11-03', elDays: 3, lopDays: 2, totalDays: 5 }),
    leave({ startDate: '2026-08-10', endDate: '2026-08-11', elDays: 2, totalDays: 2 })
  ];
  const l = S.computeLedger(emp(), [], leaves, 2026, { now: NOW });
  assert.equal(month(l, 10).consumedLeave, 2);
  assert.equal(month(l, 11).consumedLeave, 1);
  assert.equal(month(l, 11).consumedRecords[0].elDaysInMonth, 1);
  assert.equal(month(l, 8).consumedLeave, 0);
  assert.equal(month(l, 8).consumedRecords.length, 1);
  assert.equal(month(l, 8).consumedRecords[0].countedInLedger, false);
  assert.equal(l.yearSummary.remainingBalance, 0);
});

test('overrides: latest wins and previous values are derived in order', () => {
  const rows = [
    adj({ adjustmentType: 'EARNED_LEAVE_OVERRIDE', year: 2026, month: 11, days: 0.5, reason: 'a' }),
    adj({ adjustmentType: 'EARNED_LEAVE_OVERRIDE', year: 2026, month: 11, days: 2, reason: 'b' })
  ];
  const l = S.computeLedger(emp(), rows, [], 2026, { now: NOW });
  assert.equal(month(l, 11).earnedLeave, 2);
  assert.deepEqual(month(l, 11).earnedOverrideHistory.map((h) => [h.previousValue, h.newValue]), [[1, 0.5], [0.5, 2]]);
});

test('special earned: reversed credits excluded; corrections are signed', () => {
  const credit = adj({ adjustmentType: 'SPECIAL_EARNED_CREDIT', year: 2026, month: 10, workDate: '2026-10-04', days: 1 });
  const reversed = adj({ adjustmentType: 'SPECIAL_EARNED_CREDIT', year: 2026, month: 10, workDate: '2026-10-11', days: 1, status: 'REVERSED' });
  const corr = adj({ adjustmentType: 'CONSUMED_LEAVE_CORRECTION', year: 2026, month: 10, days: -0.5 });
  const lv = leave({ startDate: '2026-10-20', endDate: '2026-10-20', elDays: 1, totalDays: 1 });
  const l = S.computeLedger(emp(), [credit, reversed, corr], [lv], 2026, {
    now: NOW, describeWorkDate: (d) => ({ isSunday: d === '2026-10-04' })
  });
  const oct = month(l, 10);
  assert.equal(oct.specialEarnedLeave, 1);
  assert.equal(oct.specialEarnedRecords[0].isSunday, true);
  assert.equal(oct.reversedSpecialEarnedRecords.length, 1);
  assert.equal(oct.consumedLeave, 0.5);
  assert.equal(oct.remainingBalance, 1.5);
});

// ---- first earned, first used ----
const sunday = (date, days = 1) => adj({ adjustmentType: 'SPECIAL_EARNED_CREDIT', leaveType: 'Special Earned - Sunday', year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), workDate: date, days });
const hist = (field, mm, days, reason = 'x') => adj({ adjustmentType: `MIGRATION_${field}`, year: 2026, month: mm, days, reason });
// "SPECIAL:2026-10-04=1" / "EL:2026-10=1" / "CARRY=1"
const fromText = (from) => from.map((f) => `${f.kind}${f.date ? `:${f.date}` : f.year && f.month ? `:${f.year}-${String(f.month).padStart(2, '0')}` : ''}=${f.days}`).join(' + ');
const usedByDay = (l, m) => month(l, m).usage.days.map((d) => [d.date, fromText(d.from)]);

test('credits: two Sundays then EL for a 3-day leave (the requested example)', () => {
  const l = S.computeLedger(emp(), [sunday('2026-10-04'), sunday('2026-10-11')],
    [leave({ id: 'L1', startDate: '2026-11-02', endDate: '2026-11-04', elDays: 3, totalDays: 3 })], 2026, { now: NOW });
  assert.deepEqual(usedByDay(l, 11), [
    ['2026-11-02', 'SPECIAL:2026-10-04=1'],
    ['2026-11-03', 'SPECIAL:2026-10-11=1'],
    ['2026-11-04', 'EL:2026-10=1']
  ]);
  assert.equal(month(l, 11).usage.days[0].leaveId, 'L1');
  const octEl = l.credits.find((c) => c.id === 'EL-2026-10');
  assert.equal(octEl.left, 0);
  assert.deepEqual(octEl.uses.map((u) => u.date), ['2026-11-04']);
  // month-end split: Nov EL earned and kept, both Sundays used
  assert.deepEqual(month(l, 11).usage.left, { el: 1, special: 0 });
  assert.equal(l.creditSummary.total, l.yearSummary.remainingBalance, 'credits left always equal the balance');
});

test('credits: older first (carry-forward before a later Sunday)', () => {
  const l = S.computeLedger(emp(), [adj({ adjustmentType: 'OPENING_BALANCE', days: 1 }), sunday('2026-10-04')],
    [leave({ startDate: '2026-10-20', endDate: '2026-10-20', elDays: 1, totalDays: 1 })], 2026, { now: NOW });
  assert.deepEqual(usedByDay(l, 10), [['2026-10-20', 'CARRY=1']]);
  assert.equal(l.creditSummary.special, 1);
});

test('credits: a leave before the Sunday was worked uses EL; a later leave uses the Sunday', () => {
  const l = S.computeLedger(emp(), [sunday('2026-10-11')], [
    leave({ startDate: '2026-10-02', endDate: '2026-10-02', elDays: 1, totalDays: 1 }),
    leave({ startDate: '2026-11-20', endDate: '2026-11-20', elDays: 1, totalDays: 1 })
  ], 2026, { now: NOW });
  assert.deepEqual(usedByDay(l, 10), [['2026-10-02', 'EL:2026-10=1']]);
  assert.deepEqual(usedByDay(l, 11), [['2026-11-20', 'SPECIAL:2026-10-11=1']]);
});

test('credits: a day can be split; corrections use credits too', () => {
  const l = S.computeLedger(emp(), [sunday('2026-10-04', 0.5)],
    [leave({ startDate: '2026-10-20', endDate: '2026-10-20', elDays: 1, totalDays: 1 })], 2026, { now: NOW });
  assert.deepEqual(usedByDay(l, 10), [['2026-10-20', 'SPECIAL:2026-10-04=0.5 + EL:2026-10=0.5']]);

  const corr = S.computeLedger(emp(), [adj({ adjustmentType: 'CONSUMED_LEAVE_CORRECTION', year: 2026, month: 11, days: 1 })], [], 2026, { now: NOW });
  assert.equal(fromText(month(corr, 11).usage.from), 'EL:2026-10=1');
  assert.equal(month(corr, 11).usage.days.length, 0, 'month-level values have no leave days');
});

test('history months follow the register record; without a matching record they use first earned, first used', () => {
  const base = [hist('EARNED', 1, 1), hist('EARNED', 2, 1), hist('SPECIAL', 2, 0.5), hist('EARNED', 4, 1)];
  const recorded = S.computeLedger(emp(), [...base,
    hist('CONSUMED', 4, 1.5, 'Adjusted: 1 Apr EL, 0.5 Feb Sun/Hol'),
    hist('CONSUMED', 4, 1.5, '1st and 2nd Apr 2026') // a later remark with the same value keeps the record
  ], [], 2026, { now: NOW });
  const apr = month(recorded, 4).usage;
  assert.equal(fromText(apr.from), 'EL:2026-04=1 + SPECIAL:2026-02=0.5');
  assert.equal(apr.recorded, true);
  assert.deepEqual(apr.left, { el: 2, special: 0 }, 'Jan and Feb EL are still there');

  const changed = S.computeLedger(emp(), [...base,
    hist('CONSUMED', 4, 1.5, 'Adjusted: 1 Apr EL, 0.5 Feb Sun/Hol'),
    hist('CONSUMED', 4, 2, 'edited later') // value no longer matches the record
  ], [], 2026, { now: NOW });
  const apr2 = month(changed, 4).usage;
  assert.equal(fromText(apr2.from), 'EL:2026-01=1 + SPECIAL:2026-02=0.5 + EL:2026-02=0.5');
  assert.equal(apr2.recorded, null);
});

test('register notes: format, month resolution and rejects', () => {
  const { parseRegisterNote } = require(path.join(src, 'modules/hrms/leave/services/LeaveCreditLedger'));
  assert.deepEqual(parseRegisterNote('Adjusted: 1 2025 carry, 2 Dec EL, 0.5 Feb Sun/Hol', 2026, 1), [
    { kind: 'CARRY', year: null, month: null, days: 1 },
    { kind: 'EL', year: 2025, month: 12, days: 2 },
    { kind: 'SPECIAL', year: 2025, month: 2, days: 0.5 }
  ]);
  assert.equal(parseRegisterNote('23rd Jan 2026', 2026, 1), null);
  assert.equal(parseRegisterNote('Adjusted: 1 Jan EL, something else', 2026, 1), null);
});

test('date parsing handles ISO, DD-MM-YYYY, DD/MM/YYYY and rejects invalid dates', () => {
  assert.deepEqual(S.parseDateParts('2024-03-15'), { year: 2024, month: 3, day: 15 });
  assert.deepEqual(S.parseDateParts('2024-03-15T10:00:00Z'), { year: 2024, month: 3, day: 15 });
  assert.deepEqual(S.parseDateParts('15-03-2024'), { year: 2024, month: 3, day: 15 });
  assert.deepEqual(S.parseDateParts('15/03/2024'), { year: 2024, month: 3, day: 15 });
  assert.equal(S.parseDateParts('2024-02-30'), null);
  assert.equal(S.parseDateParts(''), null);
});

// ---------------------------------------------------------------------------
// Integration tests: real routes + throwaway SQLite database
// ---------------------------------------------------------------------------
const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth() + 1;
const TODAY = `${Y}-${String(M).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
  if (S.monthIndex(Y, M) < S.parseLedgerStart().index) {
    t.skip('today is before the ledger start month');
    return;
  }
  await Promise.all([Employee, Leave, LeaveAdjustment, HolidayCalendar, Attendance].map((m) => m.sync({ force: true })));
  const mk = (id, over) => Employee.create({ id, empCode: id.replace('E', 'C'), name: `Name ${id}`, email: `${id}@t.test`, password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', department: 'Ops', jobTitle: 'Engineer', ...over });
  await mk('E1', { location: 'Noida ' });
  // E1's own calendar (location "Noida", note the trailing space on the employee) and another location's calendar.
  const OTHER_DAY = TODAY.slice(0, 8) + (now.getDate() > 1 ? String(now.getDate() - 1).padStart(2, '0') : '01');
  await HolidayCalendar.create({ id: 'cal-noida', name: 'Noida Calendar', location: 'Noida', year: Y, holidays: [{ date: TODAY, title: 'Test Festival' }] });
  await HolidayCalendar.create({ id: 'cal-chennai', name: 'Chennai Calendar', location: 'Chennai', year: Y, holidays: [{ date: OTHER_DAY, title: 'Chennai Only' }] });
  await mk('E2', { department: 'Accounts' });
  await mk('E3', { status: 'PAST' });
  await LeaveAdjustment.create({ employeeId: 'E1', empCode: 'C1', employeeName: 'Name E1', adjustmentType: 'OPENING_BALANCE', days: 5, reason: 'Migrated' });
  await Leave.bulkCreate([
    { userId: 'C1', userName: 'Name E1', startDate: TODAY, endDate: TODAY, type: 'Earned Leave', reason: 'r', status: 'approved', elDays: 1, lopDays: 0, totalDays: 1, appliedAt: Date.now() },
    { userId: 'C1', userName: 'Name E1', startDate: TODAY, endDate: TODAY, type: 'Earned Leave', reason: 'r', status: 'pending', elDays: 1, lopDays: 0, totalDays: 1, appliedAt: Date.now() },
    { userId: 'C1', userName: 'Name E1', startDate: TODAY, endDate: TODAY, type: 'Earned Leave', reason: 'r', status: 'rejected', elDays: 1, lopDays: 0, totalDays: 1, appliedAt: Date.now() },
    { userId: 'C2', userName: 'Name E2', startDate: TODAY, endDate: TODAY, type: 'Earned Leave', reason: 'r', status: 'approved', elDays: 1, lopDays: 0, totalDays: 1, appliedAt: Date.now() }
  ]);
  await Attendance.create({ userId: 'C1', userName: 'Name E1', date: TODAY });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'], name: 'Tester' }; next(); });
  app.use('/api/leaves', require(path.join(src, 'modules/hrms/leave/routes/leave')));
  app.use('/api/employees', require(path.join(src, 'modules/hrms/employee/routes/employee')));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  const adjCount = () => LeaveAdjustment.count();
  const ledger = async () => (await api('GET', `/api/leaves/balances/E1?year=${Y}`)).body;
  const submit = (body, opts = {}) => api('POST', '/api/leaves/balances/E1/submit', { ...opts, body: { year: Y, idempotencyKey: `k-${Math.random()}`, ...body } });

  await t.test('list: active employees, approved leave only, search/department/pagination', async () => {
    const r = await api('GET', `/api/leaves/balances?year=${Y}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.summary.totalActiveEmployees, 2);
    assert.equal(r.body.summary.totalLeaveConsumed, 2);
    assert.equal(r.body.summary.pendingLeaveRequests, 1);
    const e1 = r.body.data.find((d) => d.employeeId === 'E1');
    assert.equal(e1.consumedLeave, 1);
    assert.equal(e1.designation, 'Engineer');
    assert.equal((await api('GET', `/api/leaves/balances?year=${Y}&search=c2`)).body.total, 1);
    assert.equal((await api('GET', `/api/leaves/balances?year=${Y}&department=Accounts`)).body.data[0].employeeId, 'E2');
    const p2 = (await api('GET', `/api/leaves/balances?year=${Y}&limit=1&page=2`)).body;
    assert.equal(p2.data.length, 1);
    assert.equal(p2.totalPages, 2);
    assert.equal((await api('GET', '/api/leaves/balances?year=1999')).status, 400);
  });

  await t.test('access: employees cannot list balances or read other ledgers', async () => {
    assert.equal((await api('GET', `/api/leaves/balances?year=${Y}`, { role: 'EMPLOYEE', user: 'E2' })).status, 403);
    assert.equal((await api('GET', `/api/leaves/balances/E1?year=${Y}`, { role: 'EMPLOYEE', user: 'E2' })).status, 403);
    const own = await api('GET', `/api/leaves/balances/E2?year=${Y}`, { role: 'EMPLOYEE', user: 'E2' });
    assert.equal(own.status, 200);
    assert.equal(own.body.canEdit, false);
    assert.equal((await api('GET', `/api/leaves/balances/NOPE?year=${Y}`)).status, 404);
  });

  await t.test('ledger: consumed links to the approved request; Sunday/attendance context present', async () => {
    const l = await ledger();
    const cur = l.months.find((m) => m.month === M);
    assert.equal(cur.consumedFromRequests, 1);
    assert.equal(cur.consumedRecords.length, 1);
    assert.equal(cur.consumedRecords[0].status, 'approved');
    assert.ok(l.version);
  });

  await t.test('write access: non-admin roles get 403 and nothing is saved', async () => {
    const before = await adjCount();
    const l = await ledger();
    for (const role of ['EMPLOYEE', 'MANAGER', 'TRACKING_MANAGER']) {
      const r = await submit({ expectedVersion: l.version, changes: [{ kind: 'earned', year: Y, month: M, value: 2 }] }, { role, user: 'E2' });
      assert.equal(r.status, 403);
    }
    assert.equal(await adjCount(), before);
  });

  await t.test('earned override persists with audit data; duplicate submit writes once', async () => {
    const l = await ledger();
    const body = { expectedVersion: l.version, idempotencyKey: 'dup-key-1', changes: [{ kind: 'earned', year: Y, month: M, value: 0.5, comment: 'Half month' }] };
    const before = await adjCount();
    const r1 = await submit(body);
    assert.equal(r1.status, 201);
    const r2 = await submit(body);
    assert.equal(r2.status, 200);
    assert.equal(r2.body.duplicate, true);
    assert.equal(await adjCount(), before + 1);
    const after = await ledger();
    const cur = after.months.find((m) => m.month === M);
    assert.equal(cur.earnedLeave, 0.5);
    assert.equal(cur.earnedLeaveOverride.previousValue, 1);
    assert.equal(cur.earnedLeaveOverride.newValue, 0.5);
    assert.equal(cur.earnedLeaveOverride.reason, 'Half month');
    assert.match(cur.earnedLeaveOverride.adjustedBy, /Tester/);
    assert.equal(after.currentBalance, l.currentBalance - 0.5);
  });

  await t.test('concurrency: a stale expectedVersion is rejected with 409', async () => {
    const before = await adjCount();
    const r = await submit({ expectedVersion: '0-0', changes: [{ kind: 'earned', year: Y, month: M, value: 1 }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'STALE_VERSION');
    assert.equal(await adjCount(), before);
  });

  await t.test('special earned: add, duplicate date rejected, reverse keeps the record', async () => {
    let l = await ledger();
    // Date picker options: Sundays of the month + only E1's own calendar holidays.
    const opts = (await api('GET', `/api/leaves/balances/E1/special-dates?year=${Y}&month=${M}`)).body;
    assert.deepEqual(opts.holidays.map((h) => h.name), ['Test Festival']);
    assert.ok(opts.sundays.every((s) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === 0));
    assert.deepEqual(opts.calendars, ['Noida Calendar']);
    // Another location's holiday and a non-Sunday "Sunday" are refused.
    if (OTHER_DAY !== TODAY) {
      const other = await submit({ expectedVersion: l.version, changes: [{ kind: 'special-add', creditType: 'HOLIDAY', workDate: OTHER_DAY, days: 1, reason: 'x' }] });
      assert.equal(other.status, 400);
    }
    if (now.getDay() !== 0) {
      const notSunday = await submit({ expectedVersion: l.version, changes: [{ kind: 'special-add', creditType: 'SUNDAY', workDate: TODAY, days: 1, reason: 'x' }] });
      assert.equal(notSunday.status, 400);
    }
    assert.equal((await submit({ expectedVersion: l.version, changes: [{ kind: 'special-add', workDate: TODAY, days: 1, reason: 'no type' }] })).status, 400);

    const add = await submit({ expectedVersion: l.version, changes: [{ kind: 'special-add', creditType: 'HOLIDAY', workDate: TODAY, days: 1, reason: 'Worked holiday, gate log #12' }] });
    assert.equal(add.status, 201);
    const cur = add.body.ledger.months.find((m) => m.month === M);
    assert.equal(cur.specialEarnedLeave, 1);
    assert.equal(cur.specialEarnedRecords[0].attendanceFound, true);
    assert.equal(cur.specialEarnedRecords[0].creditType, 'HOLIDAY');
    assert.equal(cur.specialEarnedRecords[0].creditLabel, 'Holiday: Test Festival');
    assert.equal(cur.specialEarnedRecords[0].holidayName, 'Test Festival');
    assert.equal(typeof cur.specialEarnedRecords[0].isSunday, 'boolean');

    l = add.body.ledger;
    const dup = await submit({ expectedVersion: l.version, changes: [{ kind: 'special-add', creditType: 'HOLIDAY', workDate: TODAY, days: 1, reason: 'again' }] });
    assert.equal(dup.status, 400);
    const future = await submit({ expectedVersion: l.version, changes: [{ kind: 'special-add', creditType: 'SUNDAY', workDate: `${Y + 1}-01-03`, days: 1, reason: 'x' }] });
    assert.equal(future.status, 400);
    const noReason = await submit({ expectedVersion: l.version, changes: [{ kind: 'special-add', creditType: 'HOLIDAY', workDate: TODAY, days: 1, reason: ' ' }] });
    assert.equal(noReason.status, 400);

    const creditId = cur.specialEarnedRecords[0].id;
    const rev = await submit({ expectedVersion: l.version, changes: [{ kind: 'special-reverse', adjustmentId: creditId, reason: 'Entered in error' }] });
    assert.equal(rev.status, 201);
    const after = rev.body.ledger.months.find((m) => m.month === M);
    assert.equal(after.specialEarnedLeave, 0);
    assert.equal(after.reversedSpecialEarnedRecords[0].reversal.reason, 'Entered in error');
    const row = await LeaveAdjustment.findByPk(creditId);
    assert.equal(row.status, 'REVERSED');
  });

  await t.test('consumed correction requires a comment; original leave request untouched', async () => {
    const l = await ledger();
    const leavesBefore = JSON.stringify(await Leave.findAll({ order: [['id', 'ASC']], raw: true }));
    const bad = await submit({ expectedVersion: l.version, changes: [{ kind: 'consumed', year: Y, month: M, deltaDays: -1, reason: '' }] });
    assert.equal(bad.status, 400);
    const ok = await submit({ expectedVersion: l.version, changes: [{ kind: 'consumed', year: Y, month: M, deltaDays: -1, reason: 'Leave was cancelled by phone' }] });
    assert.equal(ok.status, 201);
    const cur = ok.body.ledger.months.find((m) => m.month === M);
    assert.equal(cur.consumedFromRequests, 1);
    assert.equal(cur.consumedCorrection, -1);
    assert.equal(cur.consumedLeave, 0);
    assert.equal(JSON.stringify(await Leave.findAll({ order: [['id', 'ASC']], raw: true })), leavesBefore);
    const neg = await submit({ expectedVersion: ok.body.ledger.version, changes: [{ kind: 'consumed', year: Y, month: M, deltaDays: -1, reason: 'x' }] });
    assert.equal(neg.status, 422);
    // 0 days = a remark only; consumed stays the same and the remark becomes the month's latest
    const note = await submit({ expectedVersion: ok.body.ledger.version, changes: [{ kind: 'consumed', year: Y, month: M, deltaDays: 0, reason: 'Checked with the employee, figures correct' }] });
    assert.equal(note.status, 201, JSON.stringify(note.body));
    const noted = note.body.ledger.months.find((m) => m.month === M);
    assert.equal(noted.consumedLeave, 0);
    assert.equal(noted.consumedCorrections[noted.consumedCorrections.length - 1].reason, 'Checked with the employee, figures correct');
  });

  await t.test('atomicity: one invalid change means nothing is saved', async () => {
    const l = await ledger();
    const before = await adjCount();
    const r = await submit({ expectedVersion: l.version, changes: [
      { kind: 'earned', year: Y, month: M, value: 1, comment: 'ok' },
      { kind: 'consumed', year: Y, month: M, deltaDays: 0.3, reason: 'bad step' }
    ] });
    assert.equal(r.status, 400);
    assert.equal(r.body.details[0].index, 1);
    assert.equal(await adjCount(), before);
  });

  await t.test('business rule: a change that makes the balance negative is rolled back', async () => {
    const l = await ledger();
    const before = await adjCount();
    const r = await submit({ expectedVersion: l.version, changes: [
      { kind: 'earned', year: Y, month: M, value: 1, comment: 'restore' },
      { kind: 'consumed', year: Y, month: M, deltaDays: 31, reason: 'too much' }
    ] });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'NEGATIVE_BALANCE');
    assert.equal(await adjCount(), before);
  });

  await t.test('existing leave endpoints still work', async () => {
    assert.equal((await api('GET', '/api/leaves')).status, 200);
    assert.equal((await api('GET', '/api/leaves/adjustments')).status, 200);
    const ob = await api('POST', '/api/leaves/adjust-balance', { body: { employeeId: 'E2', days: 2, reason: 'Opening' } });
    assert.equal(ob.status, 201);
    const l2 = (await api('GET', `/api/leaves/balances/E2?year=${Y}`)).body;
    assert.equal(l2.openingBalance, 2);
    const pending = await Leave.findOne({ where: { status: 'pending' } });
    const ap = await api('PATCH', `/api/leaves/${pending.id}/status`, { body: { status: 'approved' } });
    assert.equal(ap.status, 200);
    const l1 = (await ledger()).months.find((m) => m.month === M);
    assert.equal(l1.consumedFromRequests, 2);
  });

  await t.test('older screens use the same balance as the ledger', async () => {
    const e1 = await ledger();
    const list = (await api('GET', '/api/leaves')).body;
    const row = list.find((l) => l.userId === 'C1');
    assert.equal(row.leavesRemaining, Math.max(0, e1.availableBalance));
    assert.equal(row.leavesConsumed, e1.lifetimeConsumed);

    const emp = await api('GET', '/api/employees/E2');
    assert.equal(emp.status, 200);
    const e2 = (await api('GET', `/api/leaves/balances/E2?year=${Y}`)).body;
    assert.equal(emp.body.availableLeaves, e2.availableBalance);
    assert.equal(emp.body.leaveBalance.opening, 2);
    assert.equal(emp.body.allowedLeaves, 0, 'form field left untouched');
  });

  await t.test('applying for leave splits EL/LOP from the ledger and reserves pending EL', async () => {
    const e2 = (await api('GET', `/api/leaves/balances/E2?year=${Y}`)).body;
    const available = Math.floor(e2.availableBalance);
    assert.ok(available >= 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + available + 1);
    const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const first = await api('POST', '/api/leaves', { body: { userId: 'C2', userName: 'Name E2', startDate: TODAY, endDate: endISO, reason: 'trip' } });
    assert.equal(first.status, 201);
    assert.equal(first.body.elDays, available);
    assert.equal(first.body.lopDays, first.body.totalDays - available);
    const second = await api('POST', '/api/leaves', { body: { userId: 'C2', userName: 'Name E2', startDate: TODAY, endDate: TODAY, reason: 'again' } });
    assert.equal(second.body.elDays, 0, 'EL already reserved by the pending request');
    assert.equal(second.body.lopDays, 1);
  });
});
