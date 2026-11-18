// Work lists per work place: AP and UP/Punjab choose from a list (some items fix the time), HP and everyone
// else type the work and pick the time. Run with: npm test. Uses a throwaway SQLite database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'work-lists-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const { Employee, EmployeeActivity } = require(path.join(src, 'shared/models'));
const HolidayCalendar = require(path.join(src, 'shared/models/HolidayCalendar'));
const A = require(path.join(src, 'modules/hrms/activity/services/ActivityService'));
const { regionFor } = require(path.join(src, 'modules/hrms/activity/services/WorkLists'));

const MIN = 60 * 1000;
const NOW = Date.parse('2026-11-03T10:00:00+05:30');

test('work lists', async (t) => {
  await sequelize.sync({ force: true });
  let n = 0;
  const emp = (location) => {
    n++;
    return Employee.create({ id: `EMP${1000 + n}`, empCode: `T${n}`, name: `Test ${n}`, email: `t${n}@t.test`, password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01', role: 'EMPLOYEE', location });
  };
  await HolidayCalendar.create({ id: 'c1', name: 'Vizag Holidays', location: 'Vizag', state: 'Andhra Pradesh', year: 2026 });
  await HolidayCalendar.create({ id: 'c2', name: 'Default', location: 'Headquarters', state: 'Uttar Pradesh', year: 2026, isDefault: true });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'], role: req.headers['x-role'] || 'EMPLOYEE' }; next(); });
  app.use('/api/activities', require(path.join(src, 'modules/hrms/activity/routes/activities')));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/activities`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
  const call = async (method, p, body, user, role = 'EMPLOYEE') => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-user': user, 'x-role': role }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const reset = () => EmployeeActivity.destroy({ where: {} });

  await t.test('the work place decides the region: its own words, or the state of its holiday calendar', async () => {
    const region = async (location) => (await regionFor(await emp(location))).region;
    assert.equal(await region('Andhra Pradesh'), 'AP');
    assert.equal(await region('Hyderabad (AP)'), 'AP');
    assert.equal(await region('Vizag'), 'AP');                 // no state in the name; the calendar's state says AP
    assert.equal(await region('Uttar Pradesh'), 'UP_PUNJAB');
    assert.equal(await region('UP - Noida'), 'UP_PUNJAB');
    assert.equal(await region('Punjab'), 'UP_PUNJAB');
    assert.equal(await region('Himachal Pradesh'), 'HP');
    assert.equal(await region('Shimla, HP'), 'HP');
    assert.equal(await region('Headquarters'), 'UP_PUNJAB');   // its calendar's state is Uttar Pradesh
    assert.equal(await region('Setup Team'), 'OTHER');         // "up" inside a word is not UP
    assert.equal(await region('Mumbai'), 'OTHER');
    assert.equal(await region(null), 'OTHER');
  });

  await t.test('AP: choose from the list; the item fixes the time (installations and T2 service 60 min, T0/T1 service 30)', async () => {
    await reset();
    const ap = await emp('Andhra Pradesh');
    const list = await call('GET', '/work-list', null, ap.id);
    assert.equal(list.status, 200);
    assert.equal(list.body.region, 'AP');
    assert.equal(list.body.mode, 'LIST');
    assert.deepEqual(list.body.items.map((i) => [i.key, i.minutes]), [
      ['new_installation_t0_t1', 60], ['new_installation_t2', 60], ['service_t0_t1', 30], ['service_t2', 60]
    ]);

    // typing the work, or an unknown item, is refused and the reply carries the list
    for (const body of [{ title: 'Anything', plannedMinutes: 20 }, { workKey: 'welding_work', plannedMinutes: 20 }]) {
      const r = await call('POST', '', body, ap.id);
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'WORK_REQUIRED');
      assert.equal(r.body.workList.items.length, 4);
    }
    const svc = await A.start(ap, { workKey: 'service_t0_t1', plannedMinutes: 480, plannedEndAt: NOW + 600 * MIN }, NOW);
    assert.equal(svc.title, 'Service work (T0, T1)');
    assert.equal(svc.plannedEndAt, NOW + 30 * MIN, 'the phone cannot change a fixed time');
    await A.cancel(svc, {}, NOW);
    const inst = await A.start(ap, { workKey: 'new_installation_t2' }, NOW);
    assert.equal(A.present(inst, NOW).plannedMinutes, 60);
  });

  await t.test('UP / Punjab: backwash is 1 hour; every other item uses the time the employee picks', async () => {
    await reset();
    const up = await emp('Punjab');
    const { body } = await call('GET', '/work-list', null, up.id);
    assert.equal(body.region, 'UP_PUNJAB');
    assert.deepEqual(body.items.map((i) => i.title), ['Backwash', 'Leakage', 'Paint works', 'Welding work', 'Assembly work',
      'Material purchase', 'IoT work', 'Repair of chamber and platform', 'Sample collect', 'Excavation work']);
    assert.deepEqual(body.items.filter((i) => i.minutes).map((i) => i.key), ['backwash']);

    const bw = await A.start(up, { workKey: 'backwash', plannedMinutes: 5 }, NOW);
    assert.equal(bw.plannedEndAt, NOW + 60 * MIN);
    await A.cancel(bw, {}, NOW);

    await assert.rejects(A.start(up, { workKey: 'leakage' }, NOW), (e) => e.code === 'PLANNED_END_REQUIRED');
    const leak = await A.start(up, { workKey: 'leakage', plannedMinutes: 90 }, NOW);
    assert.equal(leak.title, 'Leakage');
    assert.equal(leak.plannedEndAt, NOW + 90 * MIN);
  });

  await t.test('HP and other work places: type the work and pick the time', async () => {
    await reset();
    for (const place of ['Himachal Pradesh', 'Mumbai']) {
      const e = await emp(place);
      const list = await call('GET', '/work-list', null, e.id);
      assert.equal(list.body.mode, 'FREE');
      assert.deepEqual(list.body.items, []);
      await assert.rejects(A.start(e, { plannedMinutes: 30 }, NOW), (x) => x.code === 'TITLE_REQUIRED');
      await assert.rejects(A.start(e, { title: 'Pump check' }, NOW), (x) => x.code === 'PLANNED_END_REQUIRED');
      const a = await A.start(e, { title: ' Pump check ', workKey: 'backwash', plannedMinutes: 45 }, NOW);
      assert.equal(a.title, 'Pump check');
      assert.equal(a.plannedEndAt, NOW + 45 * MIN);
      await A.cancel(a, {}, NOW);
    }
  });

  await t.test('a listed item rings when its time is up, like any other activity', async () => {
    await reset();
    const ap = await emp('Andhra Pradesh');
    await A.start(ap, { workKey: 'service_t0_t1' }, NOW);
    const rings = [];
    const ring = async (_e, title, _b, payload) => { rings.push([title, payload.action]); return true; };
    assert.equal((await A.runOverdueReminders(NOW + 29 * MIN, ring)).due, 0);
    assert.equal((await A.runOverdueReminders(NOW + 31 * MIN, ring)).rang, 1);
    assert.deepEqual(rings, [['⏰ Time is up: Service work (T0, T1)', 'activity_extend']]);
  });

  await t.test('staff can read the list of any employee; others only their own', async () => {
    const ap = await emp('Andhra Pradesh');
    const hp = await emp('Himachal Pradesh');
    assert.equal((await call('GET', `/work-list?employeeId=${ap.id}`, null, 'EMP0001', 'ADMIN')).body.region, 'AP');
    assert.equal((await call('GET', `/work-list?employeeId=${ap.id}`, null, hp.id)).body.region, 'HP');
  });
});
