// Day activities: start / extra time / finish from the phone, the day list, and ringing the phone when the
// planned time runs out. Run with: npm test. Uses a throwaway SQLite database; never touches the real one.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'day-activities-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const { Employee, Attendance, DeviceToken, EmployeeActivity, Notification, NotificationLog, Geofence } = require(path.join(src, 'shared/models'));
const A = require(path.join(src, 'modules/hrms/activity/services/ActivityService'));
const HeartbeatMonitorService = require(path.join(src, 'shared/services/HeartbeatMonitorService'));

const MIN = 60 * 1000;
const at = (date, hh, mm, ss = 0) => Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+05:30`);
const D = '2026-11-03';

test('day activities', async (t) => {
  await sequelize.sync({ force: true });
  const mk = (id, code, name, role = 'EMPLOYEE', over = {}) => Employee.create({ id, empCode: code, name, email: `${id}@t.test`, password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', role, ...over });
  const aman = await mk('EMP0021', 'HMPL113', 'Aman Test', 'EMPLOYEE', { fcmToken: 'tok-legacy' });
  const other = await mk('EMP0099', 'HMPL99', 'Other Person');
  await mk('EMP0001', 'HMPL1', 'Boss', 'ADMIN');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'], role: req.headers['x-role'] || 'EMPLOYEE' }; next(); });
  app.use('/api/activities', require(path.join(src, 'modules/hrms/activity/routes/activities')));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/activities`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
  const call = async (method, p, body, user = 'EMP0021', role = 'EMPLOYEE') => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-user': user, 'x-role': role }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const reset = () => EmployeeActivity.destroy({ where: {} });

  await t.test('start: title and a planned end are required; the plan must be in the future and at most 16 hours', async () => {
    await reset();
    const now = at(D, 10, 0);
    const bad = async (body, code) => assert.rejects(A.start(aman, body, now), (e) => e.code === code, JSON.stringify(body));
    await bad({ plannedMinutes: 30 }, 'TITLE_REQUIRED');
    await bad({ title: 'Site visit' }, 'PLANNED_END_REQUIRED');
    await bad({ title: 'Site visit', plannedEndAt: at(D, 9, 0) }, 'INVALID_PLANNED_END');
    await bad({ title: 'Site visit', plannedEndAt: 'tomorrow-ish' }, 'INVALID_PLANNED_END');
    await bad({ title: 'Site visit', plannedMinutes: 17 * 60 }, 'INVALID_PLANNED_END');
    await bad({ title: 'Site visit', plannedMinutes: 30, startedAt: now - 13 * 60 * MIN }, 'INVALID_START');

    const a = await A.start(aman, { title: '  Site visit at Noida  ', plannedEndAt: new Date(at(D, 12, 0)).toISOString(), latitude: 28.5, longitude: 77.38 }, now);
    assert.equal(a.title, 'Site visit at Noida');
    assert.equal(a.employeeId, 'EMP0021');
    assert.equal(a.date, D);
    assert.equal(a.startedAt, now);
    assert.equal(a.plannedEndAt, at(D, 12, 0));
    assert.equal(a.deadlineAt, at(D, 12, 0));
    assert.equal(typeof a.startedAt, 'number');
    assert.equal(A.present(a, now).plannedMinutes, 120);

    // a phone that was offline sends when it really started; plannedMinutes counts from then
    await reset();
    const b = await A.start(aman, { title: 'Travel', plannedMinutes: 45, startedAt: now - 30 * MIN }, now);
    assert.equal(b.startedAt, now - 30 * MIN);
    assert.equal(b.plannedEndAt, now + 15 * MIN);
  });

  await t.test('one activity at a time: starting another returns 409 with the current one', async () => {
    await reset();
    await A.start(aman, { title: 'Meeting', plannedMinutes: 60 }, at(D, 10, 0));
    await assert.rejects(A.start(aman, { title: 'Second', plannedMinutes: 30 }, at(D, 10, 10)), (e) => e.status === 409 && e.code === 'ACTIVITY_IN_PROGRESS' && e.extra.current.title === 'Meeting');
    await A.start(other, { title: 'Someone else can start', plannedMinutes: 30 }, at(D, 10, 10));
  });

  await t.test('extra time: a reason is needed; early asks extend the plan, late asks count from now', async () => {
    await reset();
    let a = await A.start(aman, { title: 'Install', plannedMinutes: 60 }, at(D, 10, 0));            // due 11:00
    await assert.rejects(A.extend(a, { extraMinutes: 30, reason: '' }, at(D, 10, 50)), (e) => e.code === 'REASON_REQUIRED');
    await assert.rejects(A.extend(a, { extraMinutes: 2, reason: 'traffic' }, at(D, 10, 50)), (e) => e.code === 'INVALID_EXTRA_MINUTES');
    await assert.rejects(A.extend(a, { extraMinutes: 30.5, reason: 'traffic' }, at(D, 10, 50)), (e) => e.code === 'INVALID_EXTRA_MINUTES');

    a = await A.extend(a, { extraMinutes: 30, reason: 'Client asked for a second panel' }, at(D, 10, 50));
    assert.equal(a.deadlineAt, at(D, 11, 30), 'asked before 11:00: 11:00 + 30');
    a.deadlineReminders = 3; a.lastReminderAt = at(D, 11, 40); await a.save();
    a = await A.extend(a, { extraMinutes: 20, reason: 'Waiting for parts' }, at(D, 11, 45));
    assert.equal(a.deadlineAt, at(D, 12, 5), 'asked at 11:45, after 11:30: 11:45 + 20');
    assert.equal(a.deadlineReminders, 0);
    assert.equal(a.lastReminderAt, null);
    assert.deepEqual(a.extensions.map((e) => [e.extraMinutes, e.reason]), [[30, 'Client asked for a second panel'], [20, 'Waiting for parts']]);
    assert.equal(A.present(a, at(D, 11, 50)).extraMinutesAsked, 50);
    await assert.rejects(A.extend(a, { extraMinutes: 480, reason: 'all day' }, at(D, 22, 0)), (e) => e.code === 'TOO_LONG');
  });

  await t.test('finish: on time needs no reason; past the deadline needs one; cancel stops it', async () => {
    await reset();
    let a = await A.start(aman, { title: 'Delivery', plannedMinutes: 60 }, at(D, 9, 0));
    a = await A.finish(a, { notes: 'Delivered' }, at(D, 9, 50));
    assert.equal(A.present(a).state, 'COMPLETED');
    assert.equal(A.present(a).takenMinutes, 50);
    await assert.rejects(A.extend(a, { extraMinutes: 10, reason: 'late' }, at(D, 10, 0)), (e) => e.code === 'NOT_IN_PROGRESS');

    // finishing even a few seconds after the plan is late, and needs no reason inside the one-minute grace
    const grace = await A.finish(await A.start(aman, { title: 'Quick call', plannedMinutes: 10 }, at(D, 9, 55)), {}, at(D, 10, 5, 17));
    assert.equal(A.present(grace).state, 'COMPLETED_LATE', '17 seconds over the plan is late');
    assert.equal(A.present(grace).overPlanMinutes, 0, 'less than a minute over');
    const exact = await A.finish(await A.start(aman, { title: 'Exact call', plannedMinutes: 10 }, at(D, 9, 30)), {}, at(D, 9, 40));
    assert.equal(A.present(exact).state, 'COMPLETED', 'finishing exactly at the planned end is on time');

    let b = await A.start(aman, { title: 'Survey', plannedMinutes: 30 }, at(D, 10, 0));
    await assert.rejects(A.finish(b, {}, at(D, 10, 45)), (e) => e.code === 'REASON_REQUIRED');
    b = await A.finish(b, { reason: 'Site gate was locked' }, at(D, 10, 45));
    const p = A.present(b);
    assert.equal(p.state, 'COMPLETED_LATE');
    assert.equal(p.overMinutes, 15);
    assert.equal(b.finishReason, 'Site gate was locked');

    // extra time moves the deadline but not the plan: finishing inside the extra time is still late against the plan
    let x = await A.start(aman, { title: 'Wiring', plannedMinutes: 10 }, at(D, 12, 0));
    x = await A.extend(x, { extraMinutes: 30, reason: 'More panels' }, at(D, 12, 8));
    x = await A.finish(x, {}, at(D, 12, 20));
    const px = A.present(x);
    assert.equal(px.state, 'COMPLETED_LATE');
    assert.equal(px.overPlanMinutes, 10);
    assert.equal(px.overMinutes, 0, 'but it did not pass the extended deadline');
    const ontime = await A.finish(await A.start(aman, { title: 'Ping', plannedMinutes: 10 }, at(D, 13, 0)), {}, at(D, 13, 9));
    assert.equal(A.present(ontime).state, 'COMPLETED');

    const c = await A.cancel(await A.start(aman, { title: 'Wrong one', plannedMinutes: 30 }, at(D, 11, 0)), { reason: 'started by mistake' }, at(D, 11, 1));
    assert.equal(A.present(c).state, 'CANCELLED');
  });

  await t.test('state on the page: running over, and not finished on a past day', async () => {
    await reset();
    const a = await A.start(aman, { title: 'Audit', plannedMinutes: 60 }, at(D, 10, 0));
    assert.equal(A.present(a, at(D, 10, 30)).state, 'IN_PROGRESS');
    const late = A.present(a, at(D, 11, 20));
    assert.equal(late.state, 'OVERDUE');
    assert.equal(late.overMinutes, 20);
    assert.equal(A.present(a, at('2026-11-04', 9, 0)).state, 'UNFINISHED');
  });

  await t.test('phone rings when the time is up, every 5 minutes until answered, and stops after extra time is given', async () => {
    await reset();
    await Attendance.destroy({ where: {} });
    const rings = [];
    const ring = async (emp, title, body, payload) => { rings.push({ emp: emp.id, title, body, payload }); return true; };
    const a = await A.start(aman, { title: 'Site visit', plannedMinutes: 60 }, at(D, 10, 0));    // due 11:00

    assert.deepEqual(await A.runOverdueReminders(at(D, 10, 59), ring), { due: 0, rang: 0 });
    assert.equal((await A.runOverdueReminders(at(D, 11, 0), ring)).rang, 1);
    assert.equal(rings[0].emp, 'EMP0021');
    assert.equal(rings[0].title, '⏰ Time is up: Site visit');
    assert.match(rings[0].body, /ended at 11:00 AM\. How much extra time do you need, and why\?/);
    assert.deepEqual({ ...rings[0].payload, activityId: '-' }, { type: 'ALARM', sound: 'alarm_loud', action: 'activity_extend', activityId: '-', activityTitle: 'Site visit', deadlineAt: at(D, 11, 0) });
    assert.equal(rings[0].payload.activityId, a.id);

    for (const m of [1, 2, 3, 4]) assert.equal((await A.runOverdueReminders(at(D, 11, m), ring)).rang, 0, `11:0${m}`);
    assert.equal((await A.runOverdueReminders(at(D, 11, 5), ring)).rang, 1, 'again after 5 minutes');

    await A.extend(await EmployeeActivity.findByPk(a.id), { extraMinutes: 30, reason: 'Traffic' }, at(D, 11, 7)); // due 11:37
    for (const m of [10, 20, 36]) assert.equal((await A.runOverdueReminders(at(D, 11, m), ring)).rang, 0, `quiet at 11:${m}`);
    assert.equal((await A.runOverdueReminders(at(D, 11, 37), ring)).rang, 1, 'rings at the new deadline');
    const saved = await EmployeeActivity.findByPk(a.id);
    assert.equal(saved.remindersSent, 3);
    assert.equal(saved.deadlineReminders, 1);

    await A.finish(saved, { reason: 'done' }, at(D, 11, 40));
    assert.equal((await A.runOverdueReminders(at(D, 11, 45), ring)).due, 0, 'finished: nothing to ring');
  });

  await t.test('no ringing after clock-out, after 12 unanswered rings, without a phone, or for another day', async () => {
    await reset();
    await Attendance.destroy({ where: {} });
    const ring = async () => true;
    let a = await A.start(aman, { title: 'Clocked out later', plannedMinutes: 30 }, at(D, 15, 0));
    await Attendance.create({ userId: 'HMPL113', userName: 'Aman Test', date: D, checkIn: '09:00 AM', checkOut: '06:00 PM' });
    assert.equal((await A.runOverdueReminders(at(D, 18, 5), ring)).rang, 0, 'clocked out (attendance stored under the empCode)');
    await Attendance.destroy({ where: {} });

    for (let i = 0; i < 14; i++) await A.runOverdueReminders(at(D, 15, 30) + i * 5 * MIN, ring);
    a = await EmployeeActivity.findByPk(a.id);
    assert.equal(a.deadlineReminders, A.MAX_RINGS_PER_DEADLINE, 'stops after 12 rings');

    await reset();
    await A.start(aman, { title: 'No phone', plannedMinutes: 30 }, at(D, 10, 0));
    assert.equal((await A.runOverdueReminders(at(D, 10, 30), async () => false)).rang, 0);
    assert.equal((await EmployeeActivity.findOne()).remindersSent, 0, 'an undelivered ring is not counted');

    await reset();
    await A.start(aman, { title: 'Yesterday', plannedMinutes: 30 }, at('2026-11-02', 17, 0));
    assert.equal((await A.runOverdueReminders(at(D, 9, 0), ring)).due, 0);
  });

  await t.test('the ring reaches every phone the employee registered', async () => {
    await reset();
    await DeviceToken.bulkCreate([
      { id: 'd1', employeeId: 'EMP0021', token: 'tok-phone-1' },
      { id: 'd2', employeeId: 'EMP0021', token: 'tok-phone-2' },
      { id: 'd3', employeeId: 'EMP0021', token: 'tok-legacy' },
      { id: 'd4', employeeId: 'EMP0099', token: 'tok-not-theirs' }
    ]);
    const sent = [];
    const original = HeartbeatMonitorService.sendPush;
    HeartbeatMonitorService.sendPush = async (token, title, body, payload) => { sent.push([token, payload.action]); return true; };
    try {
      await A.start(aman, { title: 'Ring test', plannedMinutes: 30 }, at(D, 10, 0));
      assert.equal((await A.runOverdueReminders(at(D, 10, 30))).rang, 1);
    } finally {
      HeartbeatMonitorService.sendPush = original;
    }
    assert.deepEqual(sent.map(([tok]) => tok).sort(), ['tok-legacy', 'tok-phone-1', 'tok-phone-2']);
    assert.ok(sent.every(([, action]) => action === 'activity_extend'));
  });

  await t.test('API: the phone works on its own activities; staff read any employee\'s day', async () => {
    await reset();
    const started = await call('POST', '/', { title: 'Client meeting', plannedMinutes: 90 });
    assert.equal(started.status, 201);
    const id = started.body.activity.id;
    assert.equal(started.body.activity.state, 'IN_PROGRESS');
    assert.equal(started.body.activity.plannedMinutes, 90);

    assert.equal((await call('POST', '/', { title: 'Another', plannedMinutes: 10 })).status, 409);
    assert.equal((await call('GET', '/current')).body.activity.id, id);

    const forged = await call('POST', '/', { title: 'For someone else', plannedMinutes: 10, employeeId: 'EMP0099' });
    assert.equal(forged.status, 409, 'an employee cannot act for someone else: employeeId is ignored, so it is their own 2nd activity');
    assert.equal((await call('POST', `/${id}/extend`, { extraMinutes: 15, reason: 'x' }, 'EMP0099')).status, 403);

    const ext = await call('POST', `/${id}/extend`, { extraMinutes: 15, reason: 'Running late' });
    assert.equal(ext.status, 200);
    assert.equal(ext.body.activity.extensions.length, 1);
    const bad = await call('POST', `/${id}/extend`, { extraMinutes: 15 });
    assert.deepEqual([bad.status, bad.body.code], [400, 'REASON_REQUIRED']);

    const fin = await call('POST', `/${id}/finish`, {});
    assert.equal(fin.status, 200);
    assert.equal(fin.body.activity.state, 'COMPLETED');

    const today = A.istDate();
    const mine = await call('GET', `/?date=${today}`);
    assert.equal(mine.body.employee.empCode, 'HMPL113');
    assert.equal(mine.body.activities.length, 1);
    const asStaff = await call('GET', `/?employeeId=HMPL113&date=${today}`, null, 'EMP0001', 'ADMIN');
    assert.equal(asStaff.body.activities.length, 1, 'staff can name the employee by empCode');
    const peek = await call('GET', `/?employeeId=HMPL113&date=${today}`, null, 'EMP0099');
    assert.equal(peek.body.employee.id, 'EMP0099', 'non-staff always get their own day');
    assert.equal(peek.body.activities.length, 0);

    // every dashboard role reads the named employee's day, not their own
    for (const role of ['HR', 'MANAGER', 'TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER']) {
      const seen = await call('GET', `/?employeeId=HMPL113&date=${today}`, null, 'EMP0001', role);
      assert.equal(seen.body.activities.length, 1, `${role} sees the employee's activities`);
    }

    assert.equal((await call('GET', '/?date=03-11-2026')).status, 400);
    assert.equal((await call('POST', '/no-such-id/finish', {})).status, 404);
    assert.equal((await call('GET', '/', null, 'NOBODY')).status, 404);
  });

  await t.test('notifications: starting, extending, finishing an activity creates notification records', async () => {
    await reset();
    await Notification.destroy({ where: {} });
    await NotificationLog.destroy({ where: {} });

    // Start activity
    const act = await A.start(aman, { title: 'Site Inspection', plannedMinutes: 60 }, at(D, 9, 0));
    // Wait a tick for async dispatch
    await new Promise((r) => setTimeout(r, 60));

    const notifs = await Notification.findAll({ where: { type: 'DAY_ACTIVITY' } });
    assert.ok(notifs.length >= 2, 'at least 2 notifications created: staff broadcast and employee inbox');
    const startNotif = notifs.find((n) => n.target === 'STAFF');
    assert.ok(startNotif);
    assert.match(startNotif.title, /Day Activity Started: Aman Test/);
    assert.match(startNotif.body, /started "Site Inspection"/);

    // Extend activity
    await A.extend(act, { extraMinutes: 30, reason: 'Waiting for keys' }, at(D, 9, 50));
    await new Promise((r) => setTimeout(r, 60));

    const extNotifs = await Notification.findAll({ where: { type: 'DAY_ACTIVITY' } });
    const extNotif = extNotifs.find((n) => n.title.includes('Activity Extended'));
    assert.ok(extNotif);
    assert.match(extNotif.body, /Waiting for keys/);

    // Finish activity
    await A.finish(act, { reason: 'Done successfully' }, at(D, 10, 20));
    await new Promise((r) => setTimeout(r, 60));

    const finNotifs = await Notification.findAll({ where: { type: 'DAY_ACTIVITY' } });
    const finishNotif = finNotifs.find((n) => n.title.includes('Activity Completed'));
    assert.ok(finishNotif);
    assert.match(finishNotif.body, /completed "Site Inspection"/);
  });

  await t.test('site resolution & geofence smart departure check', async () => {
    const SiteResolver = require(path.join(src, 'modules/hrms/activity/services/SiteResolver'));

    // Create office geofence site in SQLite
    await Geofence.create({
      name: 'Lahorimal',
      latitude: 31.611289,
      longitude: 74.676264,
      radius: 200
    });

    // Worker at 31.6121, 74.6777 is 166m away, should resolve to Lahorimal
    const resolved = await SiteResolver.resolveSite(31.6121368, 74.6777061);
    assert.equal(resolved.siteName, 'Lahorimal');
    assert.equal(resolved.siteType, 'OFFICE_GEOFENCE');

    const siteRef = {
      siteName: 'Amritsar Central Plant',
      centerLat: 31.634,
      centerLng: 74.872,
      radius: 500
    };

    // Inside site boundary (within 500m + 50m buffer)
    assert.equal(SiteResolver.isStillInsideGeofence(31.6341, 74.8721, siteRef), true);

    // Outside site boundary (~2.5km away)
    assert.equal(SiteResolver.isStillInsideGeofence(31.655, 74.895, siteRef), false);

    // Starting activity with siteName retains siteName in DB and present()
    const s = await A.start(aman, { title: 'Filter Clean', plannedMinutes: 30, siteName: 'Amritsar Central Plant' }, at(D, 11, 0));
    assert.equal(s.siteName, 'Amritsar Central Plant');
    assert.equal(A.present(s, at(D, 11, 10)).siteName, 'Amritsar Central Plant');

    // Finish activity and verify employee received dispatch instructions
    await A.finish(s, {}, at(D, 11, 25));
    await new Promise((r) => setTimeout(r, 250));

    const empDispatchNotif = await Notification.findOne({
      where: { target: 'EMPLOYEE', targetId: 'EMP0021' },
      order: [['createdAt', 'DESC']]
    });
    assert.ok(empDispatchNotif);
    assert.match(empDispatchNotif.title, /Work Completed at Amritsar Central Plant/);
    assert.match(empDispatchNotif.body, /leave this site and move to your next site/);
  });
});
