// Attendance regularization: the employee asks (comment + documents) to be marked present on a past day they forgot
// to clock in; an admin approves (creates the attendance row) or rejects. Run with: npm test.
// Uses a throwaway SQLite database and storage folder; never touches the real ones.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'regularization-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const { Employee, Attendance, Leave, AttendanceRegularization } = require(path.join(src, 'shared/models'));
const R = require(path.join(src, 'modules/hrms/attendance/services/RegularizationService'));
const AttendanceSummaryService = require(path.join(src, 'modules/hrms/attendance/services/AttendanceSummaryService'));

const NOW = Date.parse('2026-11-03T11:00:00+05:30');
const DAY = '2026-11-02';          // a Monday, yesterday
const OLD = '2026-09-01';          // beyond the 31-day reach

test('regularization', async (t) => {
  await sequelize.sync({ force: true });
  const mk = (id, code, name, role = 'EMPLOYEE', over = {}) => Employee.create({ id, empCode: code, name, email: `${id}@t.test`, password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', role, ...over });
  const aman = await mk('EMP0021', 'HMPL113', 'Aman Test');
  const other = await mk('EMP0099', 'HMPL99', 'Other Person');
  await mk('EMP0001', 'HMPL1', 'Boss', 'ADMIN');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'], role: req.headers['x-role'] || 'EMPLOYEE' }; next(); });
  app.use('/api/regularizations', require(path.join(src, 'modules/hrms/attendance/routes/regularization')));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/regularizations`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  const call = async (method, p, body, user = 'EMP0021', role = 'EMPLOYEE') => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-user': user, 'x-role': role }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const send = async (fields, files = [], user = 'EMP0021') => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    files.forEach(([name, type, data]) => form.append('documents', new Blob([data], { type }), name));
    const r = await fetch(base, { method: 'POST', headers: { 'x-user': user }, body: form });
    return { status: r.status, body: await r.json() };
  };
  const reset = async () => { await AttendanceRegularization.destroy({ where: {} }); await Attendance.destroy({ where: {} }); await Leave.destroy({ where: {} }); };

  await t.test('create: a past day within a month, a comment, and sane times are required', async () => {
    await reset();
    const bad = (body, code) => assert.rejects(R.create(aman, body, [], NOW), (e) => e.code === code, JSON.stringify(body));
    await bad({ comment: 'forgot' }, 'INVALID_DATE');
    await bad({ date: '2026/11/02', comment: 'forgot' }, 'INVALID_DATE');
    await bad({ date: '2026-11-03', comment: 'forgot' }, 'DATE_NOT_PAST');
    await bad({ date: '2026-11-09', comment: 'forgot' }, 'DATE_NOT_PAST');
    await bad({ date: OLD, comment: 'forgot' }, 'DATE_TOO_OLD');
    await bad({ date: DAY }, 'COMMENT_REQUIRED');
    await bad({ date: DAY, comment: 'ok' }, 'COMMENT_REQUIRED');
    await bad({ date: DAY, comment: 'forgot', checkIn: 'morning' }, 'INVALID_TIME');
    await bad({ date: DAY, comment: 'forgot', checkIn: '18:00', checkOut: '09:00' }, 'INVALID_TIME');

    const row = await R.create(aman, { date: DAY, comment: '  Phone was dead  ', checkIn: '9:30', checkOut: '6:15 PM' }, [], NOW);
    assert.equal(row.status, 'PENDING');
    assert.equal(row.comment, 'Phone was dead');
    assert.equal(row.employeeId, 'EMP0021');
    assert.equal(row.empCode, 'HMPL113');
    assert.equal(row.employeeName, 'Aman Test');
    assert.equal(row.requestedCheckIn, '09:30:00 AM');
    assert.equal(row.requestedCheckOut, '06:15:00 PM');
  });

  await t.test('create: one pending request per day, and not over existing attendance or approved leave', async () => {
    await reset();
    await R.create(aman, { date: DAY, comment: 'forgot' }, [], NOW);
    await assert.rejects(R.create(aman, { date: DAY, comment: 'again' }, [], NOW), (e) => e.code === 'ALREADY_REQUESTED' && e.status === 409);

    await Attendance.create({ userId: 'HMPL99', userName: 'Other Person', date: '2026-10-30', checkIn: '09:00:00 AM', checkOut: null });
    await assert.rejects(R.create(other, { date: '2026-10-30', comment: 'forgot' }, [], NOW), (e) => e.code === 'ATTENDANCE_EXISTS');

    await Leave.create({ userId: 'EMP0099', userName: 'Other Person', type: 'Casual Leave', appliedAt: Date.now(), startDate: '2026-10-29', endDate: '2026-10-29', status: 'approved', reason: 'x' });
    await assert.rejects(R.create(other, { date: '2026-10-29', comment: 'forgot' }, [], NOW), (e) => e.code === 'ON_LEAVE');
  });

  await t.test('API: the phone sends the comment and documents; they are saved and listed', async () => {
    await reset();
    const r = await send({ date: DAY, comment: 'Phone battery died at the site' }, [
      ['gate-pass.pdf', 'application/pdf', '%PDF-1.4 test'],
      ['site.png', 'image/png', 'png-bytes']
    ]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const req = r.body.request;
    assert.equal(req.status, 'PENDING');
    assert.equal(req.documents.length, 2);
    assert.deepEqual(req.documents.map((d) => d.name), ['gate-pass.pdf', 'site.png']);
    for (const d of req.documents) {
      assert.match(d.url, /^storage\/regularization\/regularization-/);
      assert.ok(fs.existsSync(path.join(TMP, d.url.replace(/^storage\//, ''))), 'the file is on disk');
    }

    const bad = await send({ date: DAY, comment: 'again' }, [['a.pdf', 'application/pdf', 'x']]);
    assert.equal(bad.status, 409);
    assert.equal(bad.body.code, 'ALREADY_REQUESTED');
    assert.equal(fs.readdirSync(path.join(TMP, 'regularization')).length, 2, 'files of a refused request are removed');

    const exe = await send({ date: '2026-11-01', comment: 'forgot' }, [['run.exe', 'application/octet-stream', 'x']]);
    assert.equal(exe.status, 400, 'only images and PDFs');

    const tooMany = await send({ date: '2026-10-31', comment: 'forgot' }, Array.from({ length: 6 }, (_, i) => [`d${i}.pdf`, 'application/pdf', 'x']));
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.code, 'TOO_MANY_DOCUMENTS');
  });

  await t.test('list: staff see everyone, an employee only their own; pending by default', async () => {
    await reset();
    await R.create(aman, { date: DAY, comment: 'forgot' }, [], NOW);
    await R.create(other, { date: '2026-11-01', comment: 'forgot' }, [], NOW);

    const staff = await call('GET', '', null, 'EMP0001', 'ADMIN');
    assert.equal(staff.body.requests.length, 2);
    assert.equal(staff.body.pendingCount, 2);
    assert.deepEqual(staff.body.requests.map((x) => x.date), ['2026-11-01', DAY], 'oldest day first');

    const mine = await call('GET', '', null, 'EMP0021');
    assert.deepEqual(mine.body.requests.map((x) => x.employeeId), ['EMP0021']);
    const peek = await call('GET', '?employeeId=EMP0099', null, 'EMP0021');
    assert.deepEqual(peek.body.requests.map((x) => x.employeeId), ['EMP0021'], 'an employee cannot ask for someone else');

    assert.equal((await call('GET', '?employeeId=EMP0099', null, 'EMP0001', 'ADMIN')).body.requests.length, 1);
    assert.equal((await call('GET', '?status=BOGUS', null, 'EMP0001', 'ADMIN')).body.code, 'INVALID_STATUS');
  });

  await t.test('approve: marks the employee present on that day and tells them', async () => {
    await reset();
    const row = await R.create(aman, { date: DAY, comment: 'forgot' }, [], NOW);
    const before = await AttendanceSummaryService.getDailySummary(DAY);

    assert.equal((await call('POST', `/${row.id}/approve`, {}, 'EMP0021')).status, 403, 'an employee cannot approve');
    assert.equal((await Attendance.count()), 0);

    const pushes = [];
    const notify = async (emp, title, body, payload) => { pushes.push([emp.id, title, payload.status]); };
    const done = await R.approve(await AttendanceRegularization.findByPk(row.id), 'boss@t.test', { note: 'ok' }, NOW, notify);
    assert.equal(done.status, 'APPROVED');
    assert.equal(done.decidedBy, 'boss@t.test');
    assert.equal(done.decidedAt, NOW);
    assert.deepEqual(pushes, [['EMP0021', 'Attendance regularized', 'APPROVED']]);

    const att = await Attendance.findOne({ where: { userId: 'HMPL113', date: DAY } });
    assert.ok(att, 'the attendance row exists');
    assert.equal(att.id, done.attendanceId);
    assert.equal(att.userName, 'Aman Test');
    assert.equal(att.checkIn, '09:00:00 AM', 'defaults to the shift start');
    assert.equal(att.checkOut, '06:00:00 PM', 'and the shift end');
    assert.equal(att.workingHours, '09:00:00');
    assert.equal(att.checkInMethod, 'REGULARIZED');
    assert.equal(att.clockOutMethod, 'REGULARIZED');

    const after = await AttendanceSummaryService.getDailySummary(DAY);
    assert.equal(after.present, before.present + 1, 'the dashboard counts them present');
    assert.equal(after.absent, before.absent - 1);

    await assert.rejects(R.approve(done, 'boss', {}, NOW, notify), (e) => e.code === 'NOT_PENDING');
    assert.equal(await Attendance.count(), 1, 'approving twice does not add a second row');
  });

  await t.test('approve: the times the employee gave are used; attendance that appeared meanwhile blocks it', async () => {
    await reset();
    const a = await R.create(aman, { date: DAY, comment: 'forgot', checkIn: '10:00', checkOut: '16:30' }, [], NOW);
    const none = async () => {};
    await R.approve(a, 'boss', {}, NOW, none);
    const att = await Attendance.findOne({ where: { userId: 'HMPL113', date: DAY } });
    assert.equal(att.checkIn, '10:00:00 AM');
    assert.equal(att.checkOut, '04:30:00 PM');
    assert.equal(att.workingHours, '06:30:00');

    const b = await R.create(other, { date: DAY, comment: 'forgot' }, [], NOW);
    await Attendance.create({ userId: 'HMPL99', userName: 'Other Person', date: DAY, checkIn: '09:10:00 AM', checkOut: '06:00:00 PM' });
    await assert.rejects(R.approve(b, 'boss', {}, NOW, none), (e) => e.code === 'ATTENDANCE_EXISTS');
    assert.equal((await AttendanceRegularization.findByPk(b.id)).status, 'PENDING', 'it stays pending so it can be rejected');
  });

  await t.test('reject needs a reason and leaves the day without attendance', async () => {
    await reset();
    const row = await R.create(aman, { date: DAY, comment: 'forgot' }, [], NOW);
    assert.equal((await call('POST', `/${row.id}/reject`, {}, 'EMP0001', 'ADMIN')).body.code, 'NOTE_REQUIRED');
    assert.equal((await call('POST', `/${row.id}/reject`, { note: 'no proof' }, 'EMP0021')).status, 403);

    const r = await call('POST', `/${row.id}/reject`, { note: 'No proof of work that day' }, 'EMP0001', 'ADMIN');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.request.status, 'REJECTED');
    assert.equal(r.body.request.decisionNote, 'No proof of work that day');
    assert.equal(await Attendance.count(), 0);

    assert.equal((await call('POST', `/${row.id}/approve`, {}, 'EMP0001', 'ADMIN')).body.code, 'NOT_PENDING');
    assert.equal((await call('GET', '', null, 'EMP0001', 'ADMIN')).body.requests.length, 0, 'no longer pending');
    assert.equal((await call('GET', '?status=REJECTED', null, 'EMP0001', 'ADMIN')).body.requests.length, 1);

    // a rejected day can be asked for again
    await R.create(aman, { date: DAY, comment: 'here is the proof' }, [], NOW);
  });

  await t.test('cancel: the employee withdraws their own pending request, nobody else can read it', async () => {
    await reset();
    const row = await R.create(aman, { date: DAY, comment: 'forgot' }, [], NOW);
    assert.equal((await call('GET', `/${row.id}`, null, 'EMP0099')).status, 403);
    assert.equal((await call('POST', `/${row.id}/cancel`, {}, 'EMP0099')).status, 403);
    assert.equal((await call('GET', `/${row.id}`, null, 'EMP0021')).body.request.id, row.id);
    assert.equal((await call('GET', '/nope', null, 'EMP0001', 'ADMIN')).status, 404);

    const c = await call('POST', `/${row.id}/cancel`, {}, 'EMP0021');
    assert.equal(c.body.request.status, 'CANCELLED');
    assert.equal((await call('POST', `/${row.id}/cancel`, {}, 'EMP0021')).body.code, 'NOT_PENDING');
  });
});
