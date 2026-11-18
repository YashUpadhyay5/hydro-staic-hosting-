// Route replay distance tests. Run with: npm test
// Integration tests use a throwaway SQLite database in a temp folder and a local stand-in for the OSRM server;
// they never touch the real database or the internet.
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'route-replay-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const models = require(path.join(src, 'shared/models'));
const { Employee, Footprint, Setting, SettingAuditLog } = models;
const R = require(path.join(src, 'modules/hrms/attendance/services/RouteReplayService'));

// ---------------------------------------------------------------------------
// Helpers: points a given number of metres from a base, at IST clock times
// ---------------------------------------------------------------------------
const BASE = { lat: 28.509864, lon: 77.380751 };
const at = (northM, eastM) => ({
  latitude: BASE.lat + northM / 111320,
  longitude: BASE.lon + eastM / (111320 * Math.cos(BASE.lat * Math.PI / 180))
});
const ist = (date, hh, mm, ss = 0) => Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+05:30`);
const fix = (ts, northM, eastM, accuracy = 12) => ({ ...at(northM, eastM), timestamp: ts, accuracy, speed: 0 });
const pathKm = (pts) => pts.slice(1).reduce((s, p, i) => s + R.haversineDistanceKm(pts[i].latitude, pts[i].longitude, p.latitude, p.longitude), 0);
// Deterministic wobble of up to ~12 m around a spot
const wobble = (i) => [Math.sin(i * 1.7) * 9, Math.cos(i * 2.3) * 9];

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------
test('interval setting: dashboard "N Seconds" values, numbers, minutes and hours; junk is unreadable', () => {
  assert.equal(R.parseIntervalSeconds('900 Seconds'), 900);
  assert.equal(R.parseIntervalSeconds('60 Seconds'), 60);
  assert.equal(R.parseIntervalSeconds(30), 30);
  assert.equal(R.parseIntervalSeconds('15 Minutes'), 900);
  assert.equal(R.parseIntervalSeconds('2 hours'), 7200);
  for (const bad of [null, undefined, '', 'abc', '0 Seconds', '-5 Seconds', '10 parsecs']) assert.equal(R.parseIntervalSeconds(bad), null, String(bad));
});

test('ping timing follows the day\'s real gaps, else the setting for that day; GPS gap = 3 intervals, at least 3 min', () => {
  const every = (sec, n) => Array.from({ length: n }, (_, i) => fix(ist('2026-10-30', 9, 0) + i * sec * 1000, 0, 0));
  const settings900 = { intervalSeconds: 900, provider: 'GPS Only', gpsEverySeconds: 900, source: 'current settings' };

  const sparse = R.pingTiming(every(900, 20), settings900);
  assert.equal(sparse.observedSeconds, 900);
  assert.equal(sparse.usedSeconds, 900);
  assert.equal(sparse.gpsGapAfterSeconds, 2700);
  assert.equal(sparse.basis, 'observed');

  const dense = R.pingTiming(every(10, 200), settings900);
  assert.equal(dense.usedSeconds, 10, 'a phone pinging every 10 s is judged by 10 s, whatever today\'s setting says');
  assert.equal(dense.gpsGapAfterSeconds, 180);

  const tooFew = R.pingTiming(every(900, 3), { intervalSeconds: 60, provider: 'GPS + Cellular', gpsEverySeconds: 420, source: 'settings history' });
  assert.equal(tooFew.observedSeconds, null);
  assert.equal(tooFew.usedSeconds, 420, 'with 1 GPS : 6 cellular pings a GPS fix comes every 7 intervals');
  assert.equal(tooFew.basis, 'settings');
  assert.equal(R.pingTiming([], null).usedSeconds, 300);
});

test('counted track: standing-still wobble adds nothing at any interval; slow real movement still adds up', () => {
  for (const sec of [10, 60, 900]) {
    const still = Array.from({ length: 300 }, (_, i) => fix(ist('2026-10-30', 9, 0) + i * sec * 1000, ...wobble(i)));
    assert.ok(pathKm(still) > 0.5, `old way counts wobble (${sec}s)`);
    assert.equal(R.buildTrack(still).length, 1, `${sec}s pings standing still: nothing counted`);
  }

  // Walking 1.2 m/s east for 10 minutes with 10 s pings: each step (12 m) is below the wobble limit, the walk is not
  const walk = Array.from({ length: 61 }, (_, i) => fix(ist('2026-10-30', 9, 0) + i * 10000, 0, i * 12));
  const walked = pathKm(R.buildTrack(walk)) * 1000;
  assert.ok(walked > 690 && walked <= 720, `walk counted as ${Math.round(walked)} m of 720 m`);

  // A 300 m-accuracy fix 400 m away is within its own error: drawn, not counted
  const withBadFix = [fix(ist('2026-10-30', 9, 0), 0, 0), fix(ist('2026-10-30', 9, 15), 400, 0, 300), fix(ist('2026-10-30', 9, 30), 5, 0)];
  assert.equal(R.buildTrack(withBadFix).length, 1);

  // But 14 km every 15 minutes at 300 m accuracy (poor GPS on a highway) is real travel and all of it counts
  const highway = Array.from({ length: 5 }, (_, i) => fix(ist('2026-10-30', 19, 45) + i * 900000, i * 14000, 0, 300));
  assert.equal(R.buildTrack(highway).length, 5);
  assert.ok(Math.abs(pathKm(R.buildTrack(highway)) - 56) < 0.1);
});

test('stops come from position, not phone speed (phones send speed 0 or nothing)', () => {
  const d = '2026-10-30';
  const pts = [
    ...Array.from({ length: 9 }, (_, i) => fix(ist(d, 9, 0) + i * 900000, ...wobble(i))),     // 09:00-11:00 at office
    fix(ist(d, 11, 15), 1200, 0), fix(ist(d, 11, 30), 2500, 800),                            // out
    ...Array.from({ length: 5 }, (_, i) => fix(ist(d, 11, 45) + i * 900000, ...wobble(i + 3))) // 11:45-12:45 back
  ];
  pts.forEach((p) => { p.speed = 30; }); // a non-zero speed must not hide a stop either
  const stops = R.detectStops(pts);
  assert.deepEqual(stops.map((s) => s.durationMinutes), [120, 60]);
  assert.equal(R.detectStops(pts.slice(0, 1)).length, 0);
});

// ---------------------------------------------------------------------------
// Integration: processReplay against SQLite and a local OSRM stand-in
// ---------------------------------------------------------------------------
test('integration', async (t) => {
  await sequelize.sync({ force: true });

  // OSRM stand-in: refuses requests without a User-Agent (like the public server); each leg's road is 1.5x
  // the straight line unless told otherwise
  const calls = [];
  let behaviour = 'normal';
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push({ ua: req.headers['user-agent'], url: req.url });
    if (!req.headers['user-agent'] || behaviour === 'down') { res.writeHead(403, { 'Content-Type': 'text/html' }); return res.end('<html>403 Forbidden</html>'); }
    const coords = u.pathname.split('/').pop().split(';').map((c) => c.split(',').map(Number)); // [lon, lat]
    const factor = behaviour === 'detour' ? 10 : 1.5;
    const legs = coords.slice(1).map((c, i) => {
      const a = coords[i];
      const m = R.haversineDistanceKm(a[1], a[0], c[1], c[0]) * 1000 * factor;
      const mid = [(a[0] + c[0]) / 2 + 0.0005, (a[1] + c[1]) / 2];
      return { distance: m, duration: m / 10, steps: [{ geometry: { coordinates: [a, mid] } }, { geometry: { coordinates: [mid, c] } }] };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'Ok', routes: [{ legs, distance: legs.reduce((s, l) => s + l.distance, 0) }] }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  process.env.OSRM_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); delete process.env.OSRM_URL; await sequelize.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

  await Employee.create({ id: 'E9', empCode: 'HMPL9', name: 'Route Test', email: 'e9@t.test', password: 'x', status: 'ACTIVE', joiningDate: '2020-01-01' });
  await Setting.create({ id: 1, location_update_interval: '900 Seconds', location_provider: 'GPS Only' });
  // A settings save on 20 Oct changed the interval from 60 s to 900 s
  await SettingAuditLog.create({
    admin_user_id: 'ADMIN',
    changes_json: JSON.stringify({ previous: { location_update_interval: '60 Seconds', location_provider: 'GPS Only' }, updated: { location_update_interval: '900 Seconds' } }),
    createdAt: new Date('2026-10-20T06:00:00Z')
  });

  // A day of 15-minute pings: at office with wobble, an hour's trip, back at office. Each day sits `north` metres
  // away so its OSRM requests are never answered from the route cache of another day.
  const trip = [[1070, -440], [2620, 430], [2770, 810]];
  const seedTripDay = async (date, north) => {
    const rows = [];
    for (let i = 0; i < 7; i++) rows.push({ ts: ist(date, 9, 53) + i * 900000, p: wobble(i) });
    trip.forEach((p, k) => rows.push({ ts: ist(date, 11, 38) + k * 900000, p }));
    for (let i = 0; i < 12; i++) rows.push({ ts: ist(date, 12, 23) + i * 900000, p: wobble(i + 7) });
    await Footprint.bulkCreate(rows.map((r, i) => ({ id: `${date}-${i}`, userId: 'HMPL9', userName: 'Route Test', date, trackingMethod: 'GPS', timestamp: r.ts, accuracy: 12, ...at(r.p[0] + north, r.p[1]) })));
    return { count: rows.length, tripStraightKm: pathKm([wobble(6), ...trip, wobble(7)].map(([n, e]) => at(n + north, e))) };
  };
  const day = '2026-10-30';
  const { count: rowCount, tripStraightKm } = await seedTripDay(day, 0);

  await t.test('OSRM road mode: User-Agent sent, only the trip routed (one request), wobble not counted', async () => {
    calls.length = 0;
    const r = await R.processReplay('HMPL9', day, 'osrm');
    assert.equal(calls.length, 1, 'the four trip legs go in one request; office wobble needs none');
    assert.equal(calls[0].ua, 'HydroHRMS-RouteReplay/1.0');
    assert.match(calls[0].url, /continue_straight=false/);
    assert.ok(Math.abs(r.roadDistance - tripStraightKm * 1.5) < 0.02, `road ${r.roadDistance} vs ${tripStraightKm * 1.5}`);
    assert.ok(Math.abs(r.straightDistance - tripStraightKm) < 0.02);
    assert.equal(r.statistics.roadRoutedLegs, 4);
    assert.ok(r.statistics.ignoredWobbleKm > 0.05, 'old way would have added the wobble');
    assert.equal(r.pingInterval.configuredSeconds, 900);
    assert.equal(r.pingInterval.configuredSource, 'current settings');
    assert.equal(r.pingInterval.observedSeconds, 900);
    assert.equal(r.pingInterval.gpsGapAfterSeconds, 2700);
    assert.ok(r.segments.every((s) => !s.isGpsLost), '15-minute gaps are normal at a 900 s interval');
    assert.ok(r.segments.every((s) => s.geometry.length === 3), 'road geometry from the route steps');
    assert.deepEqual(r.stops.map((s) => s.durationMinutes), [90, 165]);
    assert.ok(r.averageSpeed > 0 && r.maximumSpeed >= r.averageSpeed);
    assert.equal(r.gpsPoints.length, rowCount, 'every fix is still drawn');
    const firstHop = r.segments[0];
    assert.equal(firstHop.movingMinutes, 15, 'time sitting at the office before leaving is not travel time');
    assert.equal(firstHop.gapMinutes, 15);
  });

  await t.test('fast mode: same counted track as straight lines, no OSRM requests', async () => {
    calls.length = 0;
    const r = await R.processReplay('HMPL9', day, 'fast');
    assert.equal(calls.length, 0);
    assert.ok(Math.abs(r.roadDistance - tripStraightKm) < 0.02);
    assert.equal(r.roadDistance, r.straightDistance);
    assert.equal(r.pingInterval.observedSeconds, 900);
  });

  await t.test('OSRM refusing or detouring: straight lines, or 1.3x straight for an impossible detour', async () => {
    const downDay = await seedTripDay('2026-10-29', 5000);
    behaviour = 'down';
    const down = await R.processReplay('HMPL9', '29-10-2026', 'osrm');
    assert.equal(down.statistics.osrmFailures, 1);
    assert.ok(Math.abs(down.roadDistance - downDay.tripStraightKm) < 0.02);

    const detourDay = await seedTripDay('2026-10-28', 10000);
    behaviour = 'detour';
    const detour = await R.processReplay('HMPL9', '2026-10-28', 'osrm');
    assert.equal(detour.statistics.estimatedLegs, 4, 'a road 10x the straight line is not believed');
    assert.ok(Math.abs(detour.roadDistance - detourDay.tripStraightKm * 1.3) < 0.02);
    behaviour = 'normal';
  });

  await t.test('an older day uses that day\'s setting from the settings history and its own ping gaps', async () => {
    const old = '2026-10-17';
    const pts = [];
    for (let i = 0; i < 30; i++) pts.push({ ts: ist(old, 10, 0) + i * 60000, p: [0, i * 40] });       // walking, 60 s pings
    for (let i = 0; i < 10; i++) pts.push({ ts: ist(old, 10, 40) + i * 60000, p: [0, 1200 + i * 40] }); // after a 11-minute hole
    await Footprint.bulkCreate(pts.map((r, i) => ({ id: `old${i}`, userId: 'HMPL9', userName: 'Route Test', date: old, trackingMethod: 'GPS', timestamp: r.ts, accuracy: 10, ...at(...r.p) })));
    const r = await R.processReplay('HMPL9', old, 'fast');
    assert.equal(r.pingInterval.configuredSeconds, 60);
    assert.equal(r.pingInterval.configuredSource, 'settings history');
    assert.equal(r.pingInterval.observedSeconds, 60);
    assert.equal(r.pingInterval.gpsGapAfterSeconds, 180);
    calls.length = 0;
    const o = await R.processReplay('HMPL9', old, 'osrm');
    assert.equal(calls.length, 0, 'dense pings already trace the road: 40 m hops are not sent to OSRM');
    assert.equal(o.roadDistance, o.straightDistance);
    assert.equal(o.segments.filter((s) => s.isGpsLost).length, 1, 'only the 11-minute hole is a GPS gap');
    assert.equal(o.segments.find((s) => s.isGpsLost).gapMinutes, 11);
  });

  await t.test('a day with no fixes still reports the ping interval', async () => {
    const r = await R.processReplay('HMPL9', '2026-10-01', 'osrm');
    assert.equal(r.roadDistance, 0);
    assert.equal(r.pingInterval.configuredSeconds, 60, '1 Oct was before the 20 Oct change');
  });

  await t.test('"GPS + Cellular": a GPS fix is expected every (gps + cellular) / gps intervals', async () => {
    await Setting.update({ location_update_interval: '60 Seconds', location_provider: 'GPS + Cellular', gps_ratio_count: 1, cellular_ratio_count: 6 }, { where: { id: 1 } });
    const s = await R.configuredPingSettings('2026-10-30');
    assert.deepEqual(s, { intervalSeconds: 60, provider: 'GPS + Cellular', gpsEverySeconds: 420, source: 'current settings' });
    const r = await R.processReplay('HMPL9', '2026-10-02', 'fast');
    assert.equal(r.pingInterval.expectedGpsSeconds, 60, 'the day before any later save uses the history, which was GPS Only');
  });
});
