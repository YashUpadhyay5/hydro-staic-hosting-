// Sunday / holiday shift verification tests. Run with: npm test
// Integration tests use a throwaway SQLite database in a temp folder; they never touch the real database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'special-shifts-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const models = require(path.join(src, 'shared/models'));
const { Employee, Leave, Attendance, HolidayCalendar, PayrollRun, Footprint, SpecialShiftVerification } = models;
const LeaveAdjustment = require(path.join(src, 'shared/models/LeaveAdjustment'));
const policy = require(path.join(src, 'core/config/leavePolicy'));
const S = require(path.join(src, 'modules/hrms/leave/services/LeaveBalanceService'));
const Shift = require(path.join(src, 'modules/hrms/leave/services/SpecialEarnedCreditService'));

// ---------------------------------------------------------------------------
// Unit tests: punch parsing, working hours and the credit rules
// ---------------------------------------------------------------------------
const sess = (checkIn, checkOut, over = {}) => ({ id: Math.random().toString(36).slice(2), checkIn, checkOut, ...over });
const HOUR = 3600;

test('punch times: 12-hour, 24-hour and ISO timestamps; garbage is unreadable', () => {
  assert.equal(Shift.punchSeconds('09:05:30 AM'), 9 * HOUR + 5 * 60 + 30);
  assert.equal(Shift.punchSeconds('12:00 AM'), 0);
  assert.equal(Shift.punchSeconds('12:15 PM'), 12 * HOUR + 15 * 60);
  assert.equal(Shift.punchSeconds('17:40'), 17 * HOUR + 40 * 60);
  assert.equal(Shift.punchSeconds('2026-10-04T04:00:00.000Z'), 9 * HOUR + 30 * 60, 'UTC timestamps are read in IST');
  for (const bad of ['', null, 'null', '-', 'later', '25:00', '13:00 PM', '09:61']) assert.equal(Shift.punchSeconds(bad), null, String(bad));
});

test('working hours: sessions added, overlaps counted once, overnight shifts, invalid punches add nothing', () => {
  const day = Shift.summarizeDay([sess('09:00 AM', '01:00 PM'), sess('02:00 PM', '04:30 PM')]);
  assert.equal(day.hours, 6.5);
  assert.equal(day.status, 'COMPLETE');
  assert.equal(day.checkIn, '09:00 AM');
  assert.equal(day.checkOut, '04:30 PM');

  const overlap = Shift.summarizeDay([sess('09:00', '13:00'), sess('12:00', '15:00')]);
  assert.equal(overlap.hours, 6, 'double-tap / merged sessions are not double counted');

  assert.equal(Shift.summarizeDay([sess('10:00 PM', '06:00 AM')]).hours, 8, 'overnight shift');

  const inverted = Shift.summarizeDay([sess('05:00 PM', '09:00 AM')]);
  assert.equal(inverted.hours, 0);
  assert.equal(inverted.status, 'INVALID_PUNCH');
  assert.deepEqual(inverted.issues, ['CHECK_OUT_BEFORE_CHECK_IN']);

  assert.deepEqual(Shift.summarizeDay([sess('09:00', '09:00')]).issues, ['ZERO_DURATION']);
  assert.deepEqual(Shift.summarizeDay([sess('09:00', 'soon')]).issues, ['UNREADABLE_CHECK_OUT']);

  const missingOut = Shift.summarizeDay([sess('09:00', null)], { isToday: false });
  assert.equal(missingOut.status, 'INVALID_PUNCH');
  assert.deepEqual(missingOut.issues, ['MISSING_CHECK_OUT']);
  assert.equal(missingOut.hours, 0, 'no hours are assumed for a missing check-out');
  assert.equal(Shift.summarizeDay([sess('09:00', null)], { isToday: true }).status, 'OPEN_SESSION');

  assert.equal(Shift.summarizeDay([sess('09:00', '17:00', { clockOutMethod: 'AUTO_SHIFT_END' })]).autoClockOut, true);
});

test('credit rules: 6 h or more = 1 day, 4 h to under 6 h = 0.5 day, under 4 h = 0 (admin review)', () => {
  assert.deepEqual(policy.SPECIAL_SHIFT_CREDIT_RULES, [{ minHours: 6, days: 1 }, { minHours: 4, days: 0.5 }]);
  assert.equal(Shift.eligibleDaysFor(9 * HOUR), 1);
  assert.equal(Shift.eligibleDaysFor(6 * HOUR), 1);
  assert.equal(Shift.eligibleDaysFor(6 * HOUR - 1), 0.5, '5 h 59 m 59 s does not round up');
  assert.equal(Shift.eligibleDaysFor(4 * HOUR), 0.5);
  assert.equal(Shift.eligibleDaysFor(4 * HOUR - 1), 0);
  assert.equal(Shift.eligibleDaysFor(0), 0);
});

test('ledger: PENDING and REJECTED Sunday credits never count; ACTIVE does; REVERSED is listed as reversed', () => {
  const now = new Date(2026, 11, 15);
  const credit = (status, workDate, days) => ({ id: `${status}-${workDate}`, adjustmentType: 'SPECIAL_EARNED_CREDIT', leaveType: 'Special Earned - Sunday', status, days, year: 2026, month: 11, workDate, createdAt: new Date() });
  const l = S.computeLedger({ id: 'E', empCode: 'C', name: 'T', joiningDate: '2020-01-01', status: 'ACTIVE' }, [
    credit('PENDING', '2026-11-01', 1), credit('REJECTED', '2026-11-08', 1), credit('ACTIVE', '2026-11-15', 1), credit('REVERSED', '2026-11-22', 1)
  ], [], 2026, { now });
  const nov = l.months.find((m) => m.month === 11);
  assert.equal(nov.specialEarnedLeave, 1);
  assert.deepEqual(nov.specialEarnedRecords.map((r) => r.workDate), ['2026-11-15']);
  assert.deepEqual(nov.reversedSpecialEarnedRecords.map((r) => r.workDate), ['2026-11-22']);
});

// ---------------------------------------------------------------------------
// Integration tests: real routes + throwaway SQLite database
// Fixed dates in October 2026 (inside the ledger and the automatic evaluation period):
//   Sundays 4, 11, 18, 25; Friday 2 Oct is a holiday in the Pune calendar; Monday 5 Oct is a regular day.
// ---------------------------------------------------------------------------
const SUN1 = '2026-10-04';
const SUN2 = '2026-10-11';
const SUN3 = '2026-10-18';
const SUN4 = '2026-10-25';
const HOLIDAY = '2026-10-02';
const MONDAY = '2026-10-05';
let base;
let server;

async function api(method, url, { role = 'ADMIN', user = 'E9', body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-role': role, 'x-test-user': user },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

test('integration', async (t) => {
  if (new Date() < new Date('2026-10-26T00:00:00+05:30')) {
    t.skip('needs a date after the October 2026 test shifts');
    return;
  }
  await sequelize.sync({ force: true });
  const mk = (id, over) => Employee.create({ id, empCode: id.replace('E', 'C'), name: `Name ${id}`, email: `${id}@t.test`, password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', department: 'Ops', jobTitle: 'Engineer', location: 'Pune', ...over });
  await mk('E1');
  await mk('E2', { department: 'Field' });
  await mk('E9', { role: 'ADMIN', department: 'HR' });
  await HolidayCalendar.create({ id: 'cal-pune', name: 'Pune Calendar', location: 'Pune', year: 2026, holidays: [{ date: HOLIDAY, title: 'Gandhi Jayanti' }] });
  const punch = (user, date, checkIn, checkOut, over = {}) => Attendance.create({ userId: user, userName: `Name ${user.replace('C', 'E')}`, date, checkIn, checkOut, ...over });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'], name: 'Tester' }; next(); });
  app.use('/api/v1/attendance', require(path.join(src, 'modules/hrms/attendance/routes/attendance')));
  app.use('/api/leaves', require(path.join(src, 'modules/hrms/leave/routes/leave')));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  const e1 = () => Employee.findByPk('E1');
  const special = async (id = 'E1') => S.computeLedger(await Employee.findByPk(id), await LeaveAdjustment.findAll({ where: { employeeId: id }, order: [['createdAt', 'ASC']] }), [], 2026)
    .months.find((m) => m.month === 10).specialEarnedLeave;
  const creditFor = (id, date) => LeaveAdjustment.findOne({ where: { employeeId: id, workDate: date, adjustmentType: 'SPECIAL_EARNED_CREDIT' } });
  const evaluate = async (user, date) => Shift.evaluateAndCredit((await Attendance.findAll({ where: { userId: user, date } }))[0], await Employee.findByPk(user.replace('C', 'E')));
  const verify = (body, opts) => api('POST', '/api/v1/attendance/special-shifts/verify', { ...opts, body });

  await t.test('a Sunday shift creates one PENDING credit that does not change the balance', async () => {
    await punch('C1', SUN1, '09:00:00 AM', '05:30:00 PM');
    const res = await evaluate('C1', SUN1);
    assert.equal(res.reason, 'PENDING_CREATED');
    const credit = await creditFor('E1', SUN1);
    assert.equal(credit.status, 'PENDING');
    assert.equal(Number(credit.days), 0);
    assert.equal(credit.id, Shift.shiftCreditId('E1', SUN1));
    const v = await SpecialShiftVerification.findOne({ where: { adjustmentId: credit.id } });
    assert.equal(v.dayType, 'SUNDAY');
    assert.equal(Number(v.workingHours), 8.5);
    assert.equal(Number(v.eligibleDays), 1);
    assert.equal(v.attendanceStatus, 'COMPLETE');
    assert.equal(await special(), 0, 'pending credit is not in the balance');
  });

  await t.test('re-processing the same shift (retries, recalculation, sync) never duplicates it', async () => {
    await evaluate('C1', SUN1);
    await evaluate('C1', SUN1);
    await Shift.syncCreditsForMonth('2026-10', { force: true });
    await Promise.all([evaluate('C1', SUN1), evaluate('C1', SUN1)]);
    assert.equal(await LeaveAdjustment.count({ where: { employeeId: 'E1', workDate: SUN1 } }), 1);
    assert.equal(await SpecialShiftVerification.count({ where: { employeeId: 'E1', workDate: SUN1 } }), 1);
  });

  await t.test('an official holiday shift creates a PENDING holiday credit; a regular day creates nothing', async () => {
    await punch('C1', HOLIDAY, '10:00 AM', '03:00 PM');
    assert.equal((await evaluate('C1', HOLIDAY)).reason, 'PENDING_CREATED');
    const v = await SpecialShiftVerification.findOne({ where: { employeeId: 'E1', workDate: HOLIDAY } });
    assert.equal(v.dayType, 'HOLIDAY');
    assert.equal(v.holidayName, 'Gandhi Jayanti');
    assert.equal(Number(v.eligibleDays), 0.5, '5 hours = half a day');
    assert.equal((await creditFor('E1', HOLIDAY)).leaveType, 'Special Earned - Holiday: Gandhi Jayanti');

    await punch('C1', MONDAY, '09:00 AM', '06:00 PM');
    assert.equal((await evaluate('C1', MONDAY)).reason, 'REGULAR_WORKDAY');
    assert.equal(await creditFor('E1', MONDAY), null);
  });

  await t.test('a check-in alone (shift in progress today) or missing/invalid punches never give an automatic credit', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const open = await Shift.evaluateAndCredit({ date: today, checkIn: '09:00 AM', checkOut: null }, await e1());
    assert.ok(['SHIFT_IN_PROGRESS', 'REGULAR_WORKDAY'].includes(open.reason));

    await punch('C2', SUN2, '09:00 AM', null); // never clocked out
    await evaluate('C2', SUN2);
    const v = await SpecialShiftVerification.findOne({ where: { employeeId: 'E2', workDate: SUN2 } });
    assert.equal(v.attendanceStatus, 'INVALID_PUNCH');
    assert.deepEqual(JSON.parse(v.punchIssues), ['MISSING_CHECK_OUT']);
    assert.equal(Number(v.workingHours), 0);
    assert.equal(Number(v.eligibleDays), 0);

    const noOverride = await verify({ adjustmentId: v.adjustmentId, action: 'APPROVE' });
    assert.equal(noOverride.status, 422);
    assert.equal(noOverride.body.code, 'REVIEW_REQUIRED');
    const withDays = await verify({ adjustmentId: v.adjustmentId, action: 'APPROVE', days: 1 });
    assert.equal(withDays.body.code, 'OVERRIDE_CONFIRMATION_REQUIRED');
    assert.equal(await special('E2'), 0);
  });

  await t.test('attendance corrected while pending updates the calculated credit', async () => {
    const row = await Attendance.findOne({ where: { userId: 'C2', date: SUN2 } });
    await row.update({ checkOut: '01:30 PM' });
    assert.equal((await evaluate('C2', SUN2)).reason, 'PENDING_UPDATED');
    const v = await SpecialShiftVerification.findOne({ where: { employeeId: 'E2', workDate: SUN2 } });
    assert.equal(v.attendanceStatus, 'COMPLETE');
    assert.equal(Number(v.workingHours), 4.5);
    assert.equal(Number(v.eligibleDays), 0.5);
  });

  await t.test('only verifier roles may approve, and nobody may approve their own shift', async () => {
    const id = Shift.shiftCreditId('E1', SUN1);
    const employee = await verify({ adjustmentId: id, action: 'APPROVE' }, { role: 'EMPLOYEE', user: 'E2' });
    assert.equal(employee.status, 403);
    const manager = await verify({ adjustmentId: id, action: 'APPROVE' }, { role: 'TRACKING_MANAGER', user: 'E2' });
    assert.equal(manager.status, 403);
    const self = await verify({ adjustmentId: id, action: 'APPROVE' }, { role: 'ADMIN', user: 'e1' });
    assert.equal(self.status, 403);
    assert.equal(self.body.code, 'SELF_APPROVAL');
    const selfByCode = await verify({ adjustmentId: id, action: 'APPROVE' }, { role: 'ADMIN', user: 'C1' });
    assert.equal(selfByCode.body.code, 'SELF_APPROVAL');
    assert.equal((await creditFor('E1', SUN1)).status, 'PENDING');
  });

  await t.test('invalid credited amounts are rejected', async () => {
    const id = Shift.shiftCreditId('E1', SUN1);
    for (const days of [0, -1, 0.3, 1.5, 2, 'abc']) {
      const r = await verify({ adjustmentId: id, action: 'APPROVE', days });
      assert.equal(r.status, 400, `days=${days}`);
      assert.equal(r.body.code, 'INVALID_DAYS');
    }
    const badAction = await verify({ adjustmentId: id, action: 'MAYBE' });
    assert.equal(badAction.body.code, 'INVALID_ACTION');
    const notFound = await verify({ adjustmentId: '00000000-0000-4000-8000-000000000000', action: 'APPROVE' });
    assert.equal(notFound.status, 404);
  });

  await t.test('arbitrary leave adjustments cannot be approved through this endpoint', async () => {
    const opening = await LeaveAdjustment.create({ employeeId: 'E1', empCode: 'C1', employeeName: 'Name E1', adjustmentType: 'OPENING_BALANCE', days: 3, reason: 'Migrated' });
    const r = await verify({ adjustmentId: opening.id, action: 'APPROVE' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'NOT_A_SPECIAL_SHIFT');
  });

  await t.test('concurrent and repeated approvals credit the shift exactly once', async () => {
    const id = Shift.shiftCreditId('E1', SUN1);
    const [a, b] = await Promise.all([verify({ adjustmentId: id, action: 'APPROVE' }), verify({ adjustmentId: id, action: 'APPROVE' })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const ok = a.status === 200 ? a : b;
    assert.equal(ok.body.result.status, 'ACTIVE');
    assert.equal(ok.body.result.approvedDays, 1);
    assert.equal(ok.body.result.verifiedBy, 'E9', 'approver comes from the authenticated user');
    assert.ok(ok.body.result.balance, 'balance returned');
    const again = await verify({ adjustmentId: id, action: 'APPROVE' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ALREADY_VERIFIED');
    assert.equal(await special(), 1, 'approved once = exactly one day');
    const v = await SpecialShiftVerification.findOne({ where: { adjustmentId: id } });
    assert.equal(v.verifiedBy, 'E9');
    assert.ok(v.verifiedAt instanceof Date);
    assert.equal(Number(v.approvedDays), 1);
    assert.equal(v.overrideApplied, false);
  });

  await t.test('an override needs confirmation and a reason, and is recorded', async () => {
    const id = Shift.shiftCreditId('E1', HOLIDAY); // 5 h -> calculated 0.5
    const noConfirm = await verify({ adjustmentId: id, action: 'APPROVE', days: 1 });
    assert.equal(noConfirm.body.code, 'OVERRIDE_CONFIRMATION_REQUIRED');
    const noReason = await verify({ adjustmentId: id, action: 'APPROVE', days: 1, confirmOverride: true });
    assert.equal(noReason.body.code, 'OVERRIDE_REASON_REQUIRED');
    const ok = await verify({ adjustmentId: id, action: 'APPROVE', days: 1, confirmOverride: true, overrideReason: 'Travel time to site approved by manager' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.result.calculatedDays, 0.5);
    assert.equal(ok.body.result.approvedDays, 1);
    const v = await SpecialShiftVerification.findOne({ where: { adjustmentId: id } });
    assert.equal(v.overrideApplied, true);
    assert.equal(Number(v.eligibleDays), 0.5, 'calculated credit kept next to the approved one');
    assert.equal(Number(v.approvedDays), 1);
    assert.equal(await special(), 2);
  });

  await t.test('a rejected shift keeps its attendance, gives no credit and cannot be decided again', async () => {
    await punch('C1', SUN2, '08:00 AM', '04:00 PM');
    await evaluate('C1', SUN2);
    const id = Shift.shiftCreditId('E1', SUN2);
    const r = await verify({ adjustmentId: id, action: 'REJECT', rejectionReason: 'Not scheduled to work' });
    assert.equal(r.status, 200);
    assert.equal(r.body.result.status, 'REJECTED');
    assert.equal((await creditFor('E1', SUN2)).status, 'REJECTED');
    assert.equal(Number((await creditFor('E1', SUN2)).days), 0);
    assert.equal((await SpecialShiftVerification.findOne({ where: { adjustmentId: id } })).rejectionReason, 'Not scheduled to work');
    assert.equal(await Attendance.count({ where: { userId: 'C1', date: SUN2 } }), 1, 'attendance untouched');
    assert.equal(await special(), 2, 'balance unchanged');
    const approveAfter = await verify({ adjustmentId: id, action: 'APPROVE' });
    assert.equal(approveAfter.status, 409);
  });

  await t.test('attendance changed after a decision is flagged, never silently re-decided', async () => {
    const row = await Attendance.findOne({ where: { userId: 'C1', date: SUN1 } });
    await row.update({ checkOut: '11:00:00 AM' });
    assert.equal((await evaluate('C1', SUN1)).reason, 'ALREADY_DECIDED');
    const credit = await creditFor('E1', SUN1);
    assert.equal(credit.status, 'ACTIVE');
    assert.equal(Number(credit.days), 1);
    const v = await SpecialShiftVerification.findOne({ where: { adjustmentId: credit.id } });
    assert.equal(v.changedAfterDecision, true);
    assert.equal(Number(v.latestWorkingHours), 2);
    await row.update({ checkOut: '05:30:00 PM' });
  });

  await t.test('pending list: month filter, Sunday/holiday filter, search, location evidence and permissions', async () => {
    await punch('C2', SUN3, '09:00 AM', '04:00 PM', { coords: JSON.stringify({ lat: 18.52, lon: 73.85 }), address: 'Site A', checkInMethod: 'MANUAL_APP' });
    await Footprint.create({ userId: 'C2', latitude: 18.52, longitude: 73.85, timestamp: Date.parse(`${SUN3}T03:30:00Z`), date: SUN3, trackingMethod: 'GPS', reason: 'CLOCK_IN_START_ANCHOR', locationEnabled: true, isMockLocation: false });
    await evaluate('C2', SUN3);
    const list = await api('GET', '/api/v1/attendance/special-shifts/pending?month=2026-10');
    assert.equal(list.status, 200);
    assert.equal(list.body.canVerify, true);
    assert.ok(list.body.data.every((i) => i.status === 'PENDING'));
    const e2Sun3 = list.body.data.find((i) => i.employeeId === 'E2' && i.workDate === SUN3);
    assert.equal(e2Sun3.workingHours, 7);
    assert.equal(e2Sun3.eligibleDays, 1);
    assert.equal(e2Sun3.department, 'Field');
    assert.equal(e2Sun3.isSunday, true);
    assert.deepEqual(e2Sun3.location.checkInCoords, { latitude: 18.52, longitude: 73.85 });
    assert.equal(e2Sun3.location.address, 'Site A');
    assert.ok(e2Sun3.location.clockInAnchor);
    assert.equal(e2Sun3.location.clockOutAnchor, null, 'missing evidence is reported as missing');
    assert.equal(list.body.policy.creditRules[0].minHours, 6);

    const holidays = await api('GET', '/api/v1/attendance/special-shifts/pending?month=2026-10&dayType=HOLIDAY');
    assert.ok(holidays.body.data.every((i) => i.dayType === 'HOLIDAY'));
    const search = await api('GET', '/api/v1/attendance/special-shifts/pending?month=2026-10&search=field');
    assert.ok(search.body.data.length >= 1 && search.body.data.every((i) => i.employeeId === 'E2'));
    const bad = await api('GET', '/api/v1/attendance/special-shifts/pending?month=2026-13');
    assert.equal(bad.status, 400);
    const employee = await api('GET', '/api/v1/attendance/special-shifts/pending?month=2026-10', { role: 'EMPLOYEE', user: 'E2' });
    assert.equal(employee.status, 403);
    const viewer = await api('GET', '/api/v1/attendance/special-shifts?month=2026-10', { role: 'TRACKING_MANAGER', user: 'E2' });
    assert.equal(viewer.status, 200);
    assert.equal(viewer.body.canVerify, false);
    const statuses = new Set(viewer.body.data.map((i) => i.status));
    assert.ok(statuses.has('ACTIVE') && statuses.has('REJECTED') && statuses.has('PENDING'));
    assert.equal(viewer.body.summary.approved, 2);
    assert.equal(viewer.body.summary.rejected, 1);
    // The approver is shown by name (looked up from their employee record), not the login e-mail.
    const decided = viewer.body.data.find((i) => i.adjustmentId === Shift.shiftCreditId('E1', SUN1));
    assert.equal(decided.verifiedByName, 'Name E9');
    assert.match((await creditFor('E1', SUN1)).adjustedBy, /^Name E9 \(E9\)$/);
    // Older decisions stored "email (id)": still shown by name.
    const v = await SpecialShiftVerification.findOne({ where: { adjustmentId: Shift.shiftCreditId('E1', SUN2) } });
    await v.update({ verifiedByName: 'E9@t.test (E9)' });
    const again = (await api('GET', '/api/v1/attendance/special-shifts?month=2026-10')).body.data.find((i) => i.adjustmentId === v.adjustmentId);
    assert.equal(again.verifiedByName, 'Name E9');
  });

  await t.test('batch verification reports every shift; failures are not hidden', async () => {
    await punch('C2', SUN4, '09:00 AM', '11:00 AM'); // 2 h -> needs individual review
    await evaluate('C2', SUN4);
    const good = Shift.shiftCreditId('E2', SUN3);
    const lowHours = Shift.shiftCreditId('E2', SUN4);
    const decided = Shift.shiftCreditId('E1', SUN1);
    const r = await api('POST', '/api/v1/attendance/special-shifts/batch-verify', {
      body: { action: 'APPROVE', adjustmentIds: [good, lowHours, decided, 'missing-id', good] }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, false);
    assert.deepEqual(r.body.summary, { total: 5, succeeded: 1, failed: 4 });
    const byCode = r.body.results.map((x) => x.success ? 'OK' : x.code);
    assert.deepEqual(byCode, ['OK', 'REVIEW_REQUIRED', 'ALREADY_VERIFIED', 'NOT_FOUND', 'DUPLICATE_IN_REQUEST']);
    assert.equal(await special('E2'), 1);

    const rejectAll = await api('POST', '/api/v1/attendance/special-shifts/batch-verify', { body: { action: 'REJECT', adjustmentIds: [lowHours], rejectionReason: 'Too short' } });
    assert.deepEqual(rejectAll.body.summary, { total: 1, succeeded: 1, failed: 0 });
    const tooMany = await api('POST', '/api/v1/attendance/special-shifts/batch-verify', { body: { action: 'APPROVE', adjustmentIds: Array.from({ length: 101 }, (_, i) => `id-${i}`) } });
    assert.equal(tooMany.status, 400);
    const forbidden = await api('POST', '/api/v1/attendance/special-shifts/batch-verify', { role: 'EMPLOYEE', user: 'E2', body: { action: 'APPROVE', adjustmentIds: [good] } });
    assert.equal(forbidden.status, 403);
  });

  await t.test('existing leave ledger: no second credit for a pending date; manual credits, reversals and legacy credits still work', async () => {
    // E2's 11 Oct shift is still pending.
    const ledger = (await api('GET', '/api/leaves/balances/E2?year=2026')).body;
    const blocked = await api('POST', '/api/leaves/balances/E2/submit', { body: { year: 2026, idempotencyKey: 'k-pending', expectedVersion: ledger.version, changes: [{ kind: 'special-add', workDate: SUN2, days: 1, creditType: 'SUNDAY', reason: 'manual' }] } });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /awaiting verification/);

    // A manual credit for another Sunday counts; the evaluation then treats that date as already decided.
    const manual = await api('POST', '/api/leaves/balances/E2/submit', { body: { year: 2026, idempotencyKey: 'k-manual', expectedVersion: ledger.version, changes: [{ kind: 'special-add', workDate: '2026-09-27', days: 1, creditType: 'SUNDAY', reason: 'Register entry' }] } });
    assert.equal(manual.status, 201);

    // Legacy auto-credits (ACTIVE, made before verification existed) keep counting and are not re-queued.
    await LeaveAdjustment.create({ employeeId: 'E1', empCode: 'C1', employeeName: 'Name E1', adjustmentType: 'SPECIAL_EARNED_CREDIT', leaveType: 'Special Earned - Sunday', days: 1, reason: 'Auto-credit: Worked on Sunday (2026-10-25)', workDate: SUN4, year: 2026, month: 10, adjustedBy: Shift.SYSTEM_ACTOR, status: 'ACTIVE' });
    await punch('C1', SUN4, '09:00 AM', '06:00 PM');
    assert.equal((await evaluate('C1', SUN4)).reason, 'ALREADY_CREDITED');
    assert.equal(await special(), 3);
    const listed = (await api('GET', '/api/v1/attendance/special-shifts?month=2026-10')).body.data.find((i) => i.employeeId === 'E1' && i.workDate === SUN4);
    assert.equal(listed.source, 'LEGACY_AUTO');
    assert.equal(listed.status, 'ACTIVE');
    assert.equal(listed.checkIn, '09:00 AM', 'real punches shown for credits made before verification');
    assert.equal(listed.checkOut, '06:00 PM');
    assert.equal(listed.workingHours, 9);

    // all=1 lists every saved credit, not one month (the manual September credit included).
    const all = await api('GET', '/api/v1/attendance/special-shifts?all=1');
    assert.equal(all.status, 200);
    const sept = all.body.data.find((i) => i.employeeId === 'E2' && i.workDate === '2026-09-27');
    assert.ok(sept, 'credit outside the current month listed');
    assert.equal(sept.source, 'MANUAL');
    assert.equal(sept.checkIn, null, 'no attendance that day: nothing invented');
    assert.ok(all.body.data.length > (await api('GET', '/api/v1/attendance/special-shifts?month=2026-10')).body.data.length);

    // register=1 adds the register's Sun/Hol month totals (no dates) exactly as the Leave Balances ledger counts them.
    const reg = (days, reason, createdAt) => LeaveAdjustment.create({ employeeId: 'E2', empCode: 'C2', employeeName: 'Name E2', adjustmentType: 'MIGRATION_SPECIAL', leaveType: 'Special Earned Leave', days, year: 2026, month: 5, reason, createdAt });
    await reg(2, 'Imported from Excel', new Date('2026-10-01T00:00:00Z'));
    await reg(1.5, 'Corrected after register check', new Date('2026-10-02T00:00:00Z')); // latest value wins
    const withRegister = (await api('GET', '/api/v1/attendance/special-shifts?all=1&register=1')).body.data;
    const may = withRegister.filter((i) => i.source === 'REGISTER' && i.employeeId === 'E2' && i.period === '2026-05');
    assert.equal(may.length, 1);
    assert.equal(may[0].approvedDays, 1.5);
    assert.equal(may[0].status, 'ACTIVE');
    assert.equal(may[0].workDate, null);
    const e2Ledger = (await api('GET', '/api/leaves/balances/E2?year=2026')).body;
    assert.equal(e2Ledger.months.find((m) => m.month === 5).migrationValues.special, 1.5, 'same figure as Leave Balances');
    assert.ok(!all.body.data.some((i) => i.source === 'REGISTER'), 'register months only when asked for');
    const mayOnly = (await api('GET', '/api/v1/attendance/special-shifts?month=2026-05&register=1')).body.data;
    assert.ok(mayOnly.some((i) => i.source === 'REGISTER' && i.period === '2026-05'));
    const juneOnly = (await api('GET', '/api/v1/attendance/special-shifts?month=2026-06&register=1')).body.data;
    assert.ok(!juneOnly.some((i) => i.source === 'REGISTER'));

    // An approved credit is reversed through the ledger, keeping its history.
    const l1 = (await api('GET', '/api/leaves/balances/E1?year=2026')).body;
    const reverse = await api('POST', '/api/leaves/balances/E1/submit', { body: { year: 2026, idempotencyKey: 'k-reverse', expectedVersion: l1.version, changes: [{ kind: 'special-reverse', adjustmentId: Shift.shiftCreditId('E1', HOLIDAY), reason: 'Credited by mistake' }] } });
    assert.equal(reverse.status, 201);
    assert.equal(await special(), 2);
    const reversed = (await api('GET', '/api/v1/attendance/special-shifts?month=2026-10')).body.data.find((i) => i.adjustmentId === Shift.shiftCreditId('E1', HOLIDAY));
    assert.equal(reversed.status, 'REVERSED');
    assert.equal(reversed.overrideApplied, true, 'decision history kept');
  });

  await t.test('automatic credits from before verification move to Pending; register and Leave Balances entries stay', async () => {
    // E1's 25 Oct credit was auto-credited by the old sync (created in the previous test).
    const before = await special();
    const manualBefore = await LeaveAdjustment.count({ where: { employeeId: 'E2', workDate: '2026-09-27', status: 'ACTIVE' } });
    const dry = await Shift.requeueAutoCredits();
    assert.equal(dry.apply, false);
    assert.deepEqual(dry.items.map((i) => [i.employeeId, i.workDate, i.moved]), [['E1', SUN4, false]]);
    assert.equal(dry.items[0].workingHours, 9);
    assert.equal(await special(), before, 'dry run changes nothing');

    const run = await Shift.requeueAutoCredits({ apply: true, actor: 'Tester' });
    assert.equal(run.moved, 1);
    const credit = await creditFor('E1', SUN4);
    assert.equal(credit.status, 'PENDING');
    assert.equal(Number(credit.days), 0);
    assert.match(credit.reason, /auto-credited 1 day\(s\).*moved to review by Tester/);
    const v = await SpecialShiftVerification.findOne({ where: { adjustmentId: credit.id } });
    assert.equal(Number(v.eligibleDays), 1);
    assert.equal(await special(), before - 1, 'no longer counted in the balance');
    assert.equal(await LeaveAdjustment.count({ where: { employeeId: 'E2', workDate: '2026-09-27', status: 'ACTIVE' } }), manualBefore, 'manual entries untouched');
    const e2 = (await api('GET', '/api/leaves/balances/E2?year=2026')).body;
    assert.equal(e2.months.find((m) => m.month === 5).migrationValues.special, 1.5, 'register untouched');

    const listed = (await api('GET', '/api/v1/attendance/special-shifts/pending?month=2026-10')).body.data.find((i) => i.adjustmentId === credit.id);
    assert.ok(listed, 'now waiting on the review page');
    assert.equal((await Shift.requeueAutoCredits({ apply: true })).total, 0, 'running again finds nothing');

    // Approving it puts the day back, exactly once.
    const ok = await verify({ adjustmentId: credit.id, action: 'APPROVE' });
    assert.equal(ok.status, 200);
    assert.equal(await special(), before);
  });

  await t.test('a released (PAID) payroll month blocks approvals but still allows rejections', async () => {
    await Employee.create({ id: 'E3', empCode: 'C3', name: 'Name E3', email: 'E3@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', department: 'Ops', location: 'Pune' });
    await punch('C3', SUN1, '09:00 AM', '05:00 PM');
    await punch('C3', SUN3, '09:00 AM', '05:00 PM');
    await evaluate('C3', SUN1);
    await evaluate('C3', SUN3);
    await PayrollRun.create({ month: '2026-10', status: 'PAID' });
    const approve = await verify({ adjustmentId: Shift.shiftCreditId('E3', SUN1), action: 'APPROVE' });
    assert.equal(approve.status, 423);
    assert.equal(approve.body.code, 'PAYROLL_LOCKED');
    assert.equal((await creditFor('E3', SUN1)).status, 'PENDING');
    const reject = await verify({ adjustmentId: Shift.shiftCreditId('E3', SUN3), action: 'REJECT' });
    assert.equal(reject.status, 200);
    assert.equal(await special('E3'), 0);
  });

  await t.test('approved leave on the day is not treated as a Sunday/holiday shift', async () => {
    await Leave.create({ userId: 'C2', userName: 'Name E2', startDate: HOLIDAY, endDate: HOLIDAY, type: 'Earned Leave', reason: 'r', status: 'approved', elDays: 1, lopDays: 0, totalDays: 1, appliedAt: Date.now() });
    await punch('C2', HOLIDAY, '09:00 AM', '05:00 PM');
    assert.equal((await evaluate('C2', HOLIDAY)).reason, 'REGULAR_WORKDAY');
  });
});
