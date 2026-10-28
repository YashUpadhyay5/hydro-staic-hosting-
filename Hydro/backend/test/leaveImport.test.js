// Excel import + end-to-end "approval updates everywhere" tests. Throwaway SQLite only.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-import-test-'));
process.env.STORAGE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const XLSX = require('xlsx');

const src = path.join(__dirname, '..', 'src');
const sequelize = require(path.join(src, 'config/database'));
const Employee = require(path.join(src, 'shared/models/Employee'));
const Leave = require(path.join(src, 'shared/models/Leave'));
const LeaveAdjustment = require(path.join(src, 'shared/models/LeaveAdjustment'));
const HolidayCalendar = require(path.join(src, 'shared/models/HolidayCalendar'));
const Attendance = require(path.join(src, 'shared/models/Attendance'));
const S = require(path.join(src, 'modules/hrms/leave/services/LeaveBalanceService'));

const ledgerStart = S.parseLedgerStart();
const Y = ledgerStart.year;

// Builds a workbook with the same layout as "EL and Sunday working details": titles merged on row 1,
// header on row 2 (month headers are real Excel dates), one row per employee.
function buildSheet(rows) {
  const serial = (y, m) => Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 86400000);
  const months = Array.from({ length: 12 }, (_, i) => ({ t: 'n', v: serial(Y, i + 1), z: 'mmm-yy' }));
  const header = ['S.No', 'Emp code', 'Staff Name', 'Office', 'Remaining from 2025', ...months, 'Left Leaves', 'Remarks', '', 'Remaining from 2025', ...months, 'Left Leaves', 'Remarks'];
  const title = Array(header.length).fill('');
  title[4] = 'EARNED LEAVES';
  title[21] = 'SUNDAY/HOLIDAY WORKING';
  const aoa = [title, header.map((h) => (typeof h === 'object' ? null : h)), ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  months.forEach((cell, i) => {
    ws[XLSX.utils.encode_cell({ r: 1, c: 5 + i })] = cell;
    ws[XLSX.utils.encode_cell({ r: 1, c: 21 + i })] = cell;
  });
  ws['!merges'] = [{ s: { r: 0, c: 4 }, e: { r: 0, c: 18 } }, { s: { r: 0, c: 21 }, e: { r: 0, c: 35 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
// EL Jan..Dec then Sunday Jan..Dec; null = blank cell
const row = (sno, code, name, el, sun, elCarry = 0, sunCarry = '') => {
  const sum = (a, c) => a.reduce((s, v) => s + (Number(v) || 0), 0) + (Number(c) || 0);
  return [sno, code, name, 'Noida', elCarry, ...el.map((v) => (v === null ? '' : v)), sum(el, elCarry), '', '', sunCarry, ...sun.map((v) => (v === null ? '' : v)), sum(sun, sunCarry), ''];
};
const blank12 = Array(12).fill(null);

let base;
async function call(method, url, { role = 'ADMIN', body, file } = {}) {
  let payload;
  const headers = { 'x-test-role': role };
  if (file) {
    payload = new FormData();
    payload.append('file', new Blob([file.buffer]), file.name);
    for (const [k, v] of Object.entries(body || {})) payload.append(k, v);
  } else if (body) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  return { status: res.status, body: await res.json() };
}

test('excel import and connected balances', async (t) => {
  const now = new Date();
  if (S.monthIndex(now.getFullYear(), now.getMonth() + 1) < ledgerStart.index) { t.skip('before ledger start'); return; }
  await Promise.all([Employee, Leave, LeaveAdjustment, HolidayCalendar, Attendance].map((m) => m.sync({ force: true })));
  const mk = (id, code, name, joiningDate = '2020-01-01') => Employee.create({ id, empCode: code, name, email: `${id}@t.test`, password: 'x', status: 'ACTIVE', joiningDate });
  await mk('E1', 'HMPL01', 'Anshup');
  await mk('E2', 'HMPL067', 'Dharm Veer Yadav');
  await mk('E3', 'HMPL99', 'Not In Sheet');
  // Legacy migration rows that the import must supersede
  await LeaveAdjustment.create({ employeeId: 'E1', empCode: 'HMPL01', employeeName: 'Anshup', adjustmentType: 'OPENING_BALANCE', days: 5, reason: 'Migrated from previous software' });
  await LeaveAdjustment.create({ employeeId: 'E2', empCode: 'HMPL067', employeeName: 'Dharm Veer Yadav', adjustmentType: 'OPENING_BALANCE', days: 1, reason: 'Migrated from previous software' });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'ADMIN', role: req.headers['x-test-role'], name: 'Tester' }; next(); });
  app.use('/api/leaves', require(path.join(src, 'modules/hrms/leave/routes/leave')));
  app.use('/api/employees', require(path.join(src, 'modules/hrms/employee/routes/employee')));
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await sequelize.close(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

  const el1 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const el2 = [0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 1, 1]; // Oct = 0 (not the policy default) → warning, ignored
  const sun2 = [null, 0, null, null, null, null, null, 2, null, null, null, null];
  const file = { name: 'EL and Sunday working.xlsx', buffer: buildSheet([
    row(1, 'HMPL01', 'Anshup', el1, blank12),
    row(2, 'HMLP067', 'Dharm Veer Yadav', el2, sun2),
    row(3, 'ZZZ1', 'Unknown Person', el1, blank12)
  ]) };

  await t.test('preview matches rows, reports differences and writes nothing', async () => {
    const before = await LeaveAdjustment.count();
    const r = await call('POST', '/api/leaves/balances/import/preview', { file });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await LeaveAdjustment.count(), before);
    const e1 = r.body.items.find((i) => i.empCode === 'HMPL01');
    const pre = ledgerStart.month - 1; // months before the ledger start
    assert.equal(e1.importedEl, pre);
    assert.equal(e1.currentOpening, 5);
    assert.equal(e1.difference, pre - 5);
    const e2 = r.body.items.find((i) => i.empCode === 'HMPL067');
    assert.equal(e2.matchedBy, 'name');
    assert.equal(e2.importedSpecial, 2);
    assert.equal(r.body.unmatched[0].code, 'ZZZ1');
    assert.deepEqual(r.body.notInSheet.map((e) => e.empCode), ['HMPL99']);
    assert.ok(r.body.warnings.some((w) => /ignored/.test(w.message)), 'non-default month after ledger start is reported');
    assert.equal((await call('POST', '/api/leaves/balances/import/preview', { file, role: 'EMPLOYEE' })).status, 403);
  });

  await t.test('import writes one batch; opening superseded; Jan–Sep shown as imported months', async () => {
    const preview = (await call('POST', '/api/leaves/balances/import/preview', { file })).body;
    const r = await call('POST', '/api/leaves/balances/import', { file, body: { expectedHash: preview.fileHash } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.employees, 2);
    const l1 = (await call('GET', `/api/leaves/balances/E1?year=${Y}`)).body;
    assert.equal(l1.openingBalance, 0, 'legacy opening row superseded, carry-forward 0');
    assert.ok(l1.openingEntries.some((e) => e.superseded));
    const jan = l1.months.find((m) => m.month === 1);
    assert.equal(jan.migrated, true);
    assert.equal(jan.earnedLeave, 1);
    const lastPre = l1.months.find((m) => m.month === ledgerStart.month - 1);
    assert.equal(lastPre.remainingBalance, ledgerStart.month - 1);
    const l2 = (await call('GET', `/api/leaves/balances/E2?year=${Y}`)).body;
    assert.equal(l2.months.find((m) => m.month === 8).specialEarnedLeave, 2);
    assert.equal(l2.months.find((m) => m.month === 7).earnedLeave, 0.5);
    // re-importing the same file writes nothing
    const again = await call('POST', '/api/leaves/balances/import', { file, body: { expectedHash: preview.fileHash } });
    assert.equal(again.body.duplicate, true);
    // a stale preview hash is refused
    assert.equal((await call('POST', '/api/leaves/balances/import', { file, body: { expectedHash: 'abc' } })).status, 409);
  });

  await t.test('history changed after the import is flagged against the register; a later import leaves it alone', async () => {
    let l1 = (await call('GET', `/api/leaves/balances/E1?year=${Y}`)).body;
    assert.deepEqual(l1.registerChanges, []);
    const r = await call('POST', '/api/leaves/balances/E1/submit', { body: { year: Y, expectedVersion: l1.version, idempotencyKey: 'reg-1', changes: [
      { kind: 'migration', year: Y, month: 2, field: 'consumed', value: 0.5, comment: 'Consumed in Apr' }
    ] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    l1 = r.body.ledger;
    assert.deepEqual(l1.months.find((m) => m.month === 2).register.differences, [{ field: 'consumed', register: 0, now: 0.5 }]);
    assert.deepEqual(l1.registerChanges.map((c) => [c.monthName, c.field, c.register, c.now]), [['February', 'consumed', 0, 0.5]]);
    const list = (await call('GET', `/api/leaves/balances?year=${Y}`)).body;
    assert.equal(list.data.find((d) => d.employeeId === 'E1').registerChanges, 1);

    // a different sheet must not overwrite employees whose history is already entered
    const other = { name: 'second.xlsx', buffer: buildSheet([row(1, 'HMPL01', 'Anshup', el1.map(() => 0), blank12)]) };
    const preview = (await call('POST', '/api/leaves/balances/import/preview', { file: other })).body;
    assert.deepEqual(preview.skipped.map((s) => s.empCode), ['HMPL01']);
    assert.equal(preview.items.length, 0);
  });

  await t.test('migration months are editable by admins with an audit trail', async () => {
    // E3 has no history yet: Jan–Sep are editable migration months but not counted.
    let l3 = (await call('GET', `/api/leaves/balances/E3?year=${Y}`)).body;
    const jan = l3.months.find((m) => m.month === 1);
    assert.equal(jan.migrationMonth, true);
    assert.equal(jan.migrated, false);
    assert.equal(l3.migrationActive, false);
    const submit = (changes, role = 'ADMIN') => call('POST', '/api/leaves/balances/E3/submit', { role, body: { year: Y, expectedVersion: l3.version, idempotencyKey: `m-${Math.random()}`, changes } });

    assert.equal((await submit([{ kind: 'migration', year: Y, month: 1, field: 'earned', value: 1 }], 'EMPLOYEE')).status, 403);
    assert.equal((await submit([{ kind: 'migration', year: Y, month: ledgerStart.month, field: 'earned', value: 1 }])).status, 400, 'live month is not a migration month');
    assert.equal((await submit([{ kind: 'migration', year: Y, month: 1, field: 'bogus', value: 1 }])).status, 400);

    // consumed / special values need a remark
    const noRemark = await submit([{ kind: 'migration', year: Y, month: 2, field: 'consumed', value: 0.5 }]);
    assert.equal(noRemark.status, 400);
    assert.match(noRemark.body.error, /Remark for consumed leave is required/);

    const r = await submit([
      { kind: 'migration', year: Y, month: 1, field: 'earned', value: 1, comment: 'From old HRMS' },
      { kind: 'migration', year: Y, month: 2, field: 'special', value: 2, comment: 'Two Sundays in old register' },
      { kind: 'migration', year: Y, month: 2, field: 'consumed', value: 0.5, comment: 'Half day on 12 Feb' },
      { kind: 'migration-carry', value: 3, comment: 'Balance at 31 Dec 2025' }
    ]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    l3 = r.body.ledger;
    assert.equal(l3.migrationActive, true);
    assert.equal(l3.carryForward, 3);
    assert.equal(l3.openingBalance, 3);
    const feb = l3.months.find((m) => m.month === 2);
    assert.deepEqual(feb.migrationValues, { earned: null, special: 2, consumed: 0.5 });
    assert.equal(feb.remainingBalance, 3 + 1 + 2 - 0.5);
    assert.equal(l3.months.find((m) => m.month === 1).migrationHistory[0].reason, 'From old HRMS');

    // editing again records the previous value; latest value wins
    const r2 = await submit([{ kind: 'migration', year: Y, month: 1, field: 'earned', value: 0.5 }]);
    assert.equal(r2.status, 201);
    const jan2 = r2.body.ledger.months.find((m) => m.month === 1);
    assert.equal(jan2.earnedLeave, 0.5);
    assert.equal(jan2.migrationHistory[0].previousValue, 1);
    assert.match(jan2.migrationHistory[0].reason, /was 1/);

    // A dated Sunday credit inside a migration month is allowed and counted.
    const firstSunday = [1, 2, 3, 4, 5, 6, 7].map((d) => new Date(Date.UTC(Y, 0, d))).find((d) => d.getUTCDay() === 0);
    const sundayISO = firstSunday.toISOString().slice(0, 10);
    const opts = (await call('GET', `/api/leaves/balances/E3/special-dates?year=${Y}&month=1`)).body;
    assert.ok(opts.sundays.some((s) => s.date === sundayISO));
    l3 = r2.body.ledger;
    const r3 = await submit([{ kind: 'special-add', creditType: 'SUNDAY', workDate: sundayISO, days: 1, reason: 'Site visit on Sunday' }]);
    assert.equal(r3.status, 201, JSON.stringify(r3.body));
    const jan3 = r3.body.ledger.months.find((m) => m.month === 1);
    assert.equal(jan3.specialEarnedLeave, 1);
    assert.equal(jan3.specialEarnedRecords[0].creditLabel, 'Sunday');

    // Remarks can be edited without changing the days; "." is not accepted as a remark.
    l3 = r3.body.ledger;
    const dot = await submit([{ kind: 'migration', year: Y, month: 2, field: 'consumed', value: 0.5, comment: '.' }]);
    assert.equal(dot.status, 400);
    assert.match(dot.body.error, /few words/);
    const sundayCredit = jan3.specialEarnedRecords[0];
    const r4 = await submit([
      { kind: 'migration', year: Y, month: 2, field: 'consumed', value: 0.5, comment: 'Half day on 12 Feb (corrected)' },
      { kind: 'special-remark', adjustmentId: sundayCredit.id, reason: 'Site visit, Sunday shift' }
    ]);
    assert.equal(r4.status, 201, JSON.stringify(r4.body));
    const feb4 = r4.body.ledger.months.find((m) => m.month === 2);
    assert.equal(feb4.consumedLeave, 0.5);
    assert.equal(feb4.migrationHistory.find((h) => h.field === 'consumed').reason, 'Half day on 12 Feb (corrected)');
    const jan4 = r4.body.ledger.months.find((m) => m.month === 1);
    assert.equal(jan4.specialEarnedRecords[0].id, sundayCredit.id, 'same credit, only the remark changed');
    assert.equal(jan4.specialEarnedRecords[0].reason, 'Site visit, Sunday shift');
    assert.equal(jan4.specialEarnedLeave, 1);
    assert.equal(jan4.reversedSpecialEarnedRecords.length, 0, 'a remark edit is not a removal');
  });

  await t.test('approving a leave updates the ledger, the requests list and the employee profile', async () => {
    const before = (await call('GET', `/api/leaves/balances/E1?year=${Y}`)).body;
    const applied = await call('POST', '/api/leaves', { body: { userId: 'HMPL01', userName: 'Anshup', startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, endDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`, reason: 'family' } });
    assert.equal(applied.status, 201);
    assert.equal(applied.body.elDays, 2);
    // pending: nothing deducted yet
    assert.equal((await call('GET', `/api/leaves/balances/E1?year=${Y}`)).body.availableBalance, before.availableBalance);
    assert.equal((await call('PATCH', `/api/leaves/${applied.body.id}/status`, { body: { status: 'approved' } })).status, 200);
    const after = (await call('GET', `/api/leaves/balances/E1?year=${Y}`)).body;
    assert.equal(after.availableBalance, before.availableBalance - 2);
    assert.equal(after.months.find((m) => m.month === now.getMonth() + 1).consumedFromRequests, 2);
    const list = (await call('GET', '/api/leaves')).body.find((l) => l.id === applied.body.id);
    assert.equal(list.leavesRemaining, after.availableBalance);
    const emp = (await call('GET', '/api/employees/E1')).body;
    assert.equal(emp.availableLeaves, after.availableBalance);
    // rejecting it again restores the balance everywhere
    await call('PATCH', `/api/leaves/${applied.body.id}/status`, { body: { status: 'rejected' } });
    assert.equal((await call('GET', '/api/employees/E1')).body.availableLeaves, before.availableBalance);
  });
});
