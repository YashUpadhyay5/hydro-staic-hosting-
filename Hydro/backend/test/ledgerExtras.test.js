// Expenses Excel report: GET /api/ledger/employee/:employeeId/ledger-extras and the fuel-claim km behind it.
// Run with: npm test. Uses a throwaway SQLite database in a temp folder; never touches the real database.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-extras-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const { Employee, Footprint } = require(path.join(src, 'shared/models'));
const Ledger = require(path.join(src, 'shared/models/Ledger'));
require(path.join(src, 'shared/models/Expense')); // the statement route reads it; load before sync
const R = require(path.join(src, 'modules/hrms/attendance/services/RouteReplayService'));

const BASE = { lat: 28.5, lon: 77.38 };
const at = (northM) => ({ latitude: BASE.lat + northM / 111320, longitude: BASE.lon });
const ist = (date, hh, mm) => Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
let seq = 0;
const fp = (userId, date, ts, northM, over = {}) => ({ id: `fp${seq++}`, userId, date, timestamp: ts, trackingMethod: 'GPS', accuracy: 10, ...at(northM), ...over });

test('ledger-extras', async (t) => {
  await sequelize.sync({ force: true });
  await Employee.create({ id: 'EMP0021', empCode: 'HMPL113', name: 'Km Test', email: 'k@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01' });
  await Employee.create({ id: 'EMP0099', empCode: 'HMPL99', name: 'Other', email: 'o@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01' });

  await Ledger.bulkCreate([
    { employeeId: 'EMP0021', date: new Date('2026-10-05T00:00:00Z'), amount: 2000, description: 'NEFT advance', type: 'payment' },
    { employeeId: 'EMP0021', date: new Date('2026-09-01T00:00:00Z'), amount: 500, description: null, source: 'Bank Statement Upload', type: 'payment' },
    { employeeId: 'EMP0099', date: new Date('2026-09-02T00:00:00Z'), amount: 999, description: 'not theirs', type: 'payment' }
  ]);

  await Footprint.bulkCreate([
    // 1 Oct, stored under the internal id: 0 -> 1 km -> 3 km north in 15-minute steps = 3 km
    fp('EMP0021', '2026-10-01', ist('2026-10-01', 10, 0), 0),
    fp('EMP0021', '2026-10-01', ist('2026-10-01', 10, 15), 1000),
    fp('EMP0021', '2026-10-01', ist('2026-10-01', 10, 30), 3000),
    // 2 Oct, stored under the empCode: 2 km, plus fixes that must be skipped
    fp('HMPL113', '2026-10-02', ist('2026-10-02', 9, 0), 0),
    fp('HMPL113', '2026-10-02', ist('2026-10-02', 9, 5), 9000, { trackingMethod: 'CELLULAR' }),
    fp('HMPL113', '2026-10-02', ist('2026-10-02', 9, 6), 9000, { isMockLocation: true }),
    fp('HMPL113', '2026-10-02', ist('2026-10-02', 9, 7), 9000, { accuracy: 800 }),
    fp('HMPL113', '2026-10-02', ist('2026-10-02', 9, 30), 2000),
    fp('HMPL113', '2026-10-02', ist('2026-10-02', 9, 31), 12000), // 10 km in a minute: skipped hop
    // 3 Oct, older rows with a full timestamp in `date`: 1.5 km
    fp('EMP0021', '2026-10-03T04:00:00.000Z', ist('2026-10-03', 9, 30), 0),
    fp('EMP0021', '2026-10-03T04:30:00.000Z', ist('2026-10-03', 10, 0), 1500),
    // Someone else's movement never counts
    fp('HMPL99', '2026-10-01', ist('2026-10-01', 10, 0), 0),
    fp('HMPL99', '2026-10-01', ist('2026-10-01', 11, 0), 50000)
  ]);

  const app = express();
  app.use('/api/ledger', require(path.join(src, 'modules/hrms/expense/routes/ledger')));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/ledger`;
  t.after(async () => { server.close(); await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

  await t.test('payments: only that employee\'s ledger rows, oldest first, description falling back to source', async () => {
    const { status, body } = await get('/employee/HMPL113/ledger-extras');
    assert.equal(status, 200);
    assert.equal(body.employeeResolved, true);
    assert.deepEqual(body.payments.map((p) => [p.amount, p.description]), [[500, 'Bank Statement Upload'], [2000, 'NEFT advance']]);
    assert.deepEqual(body.hrmsKm, []);
  });

  await t.test('km per fuel claim: first is null, then the distance since the previous claim, both footprint ids', async () => {
    const { body } = await get('/employee/HMPL113/ledger-extras?petrolDates=2026-10-01,2026-10-01,2026-10-02,2026-10-03');
    assert.deepEqual(body.hrmsKm, [null, 3, 5, 3.5], '1 Oct = 3 km; 1-2 Oct = 3 + 2 km; 2-3 Oct = 2 + 1.5 km');
  });

  await t.test('the employee can be given as internal id, empCode or name; unknown names resolve to nothing', async () => {
    for (const who of ['EMP0021', 'HMPL113', encodeURIComponent('Km Test')]) {
      const { body } = await get(`/employee/${who}/ledger-extras?petrolDates=2026-10-01,2026-10-03`);
      assert.deepEqual(body.hrmsKm, [null, 6.5], who);
      assert.equal(body.payments.length, 2, who);
    }
    const { status, body } = await get('/employee/NOBODY/ledger-extras?petrolDates=2026-10-01,2026-10-02');
    assert.equal(status, 200);
    assert.deepEqual(body, { employeeResolved: false, payments: [], hrmsKm: [null, null] });
  });

  await t.test('the existing statement route still answers on /employee/:employeeId', async () => {
    const { status, body } = await get('/employee/EMP0021');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);
  });

  await t.test('computeGroundDistanceKm: guards and single id', async () => {
    assert.equal(await R.computeGroundDistanceKm(null, '2026-10-01', '2026-10-03'), 0);
    assert.equal(await R.computeGroundDistanceKm('EMP0021', '2026-10-01', '2026-10-03'), 4.5, 'internal-id rows only');
    assert.equal(await R.computeGroundDistanceKm('HMPL113', '2026-10-01', '2026-10-03'), 2, 'empCode rows only');
    assert.equal(await R.computeGroundDistanceKm(['EMP0021'], '2026-10-04', '2026-10-09'), 0, 'no fixes');
  });
});
