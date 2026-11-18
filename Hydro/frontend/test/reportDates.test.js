// Attendance report period: From–To range columns and the months fetched for them.
// Run with: npm test (node's built-in test runner; no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoDate, rangeDateItems, monthsBetween } from '../src/modules/hrms/components/views/reportDates.js';

// India (UTC+5:30), where `new Date('2026-10-01')` is 05:30 local and the old toISOString() columns fell a day behind.
process.env.TZ = 'Asia/Kolkata';

test('range columns keep their own date in UTC+ time zones', () => {
    const items = rangeDateItems('2026-10-01', '2026-10-28');
    assert.equal(items.length, 28);
    assert.deepEqual(items[0], { day: 1, month: 9, year: 2026, dateStr: '2026-10-01', label: '1' });
    assert.equal(items[1].dateStr, '2026-10-02'); // Gandhi Jayanti sits under column 2, not 3
    assert.equal(items[27].dateStr, '2026-10-28');
    assert.ok(items.every((it) => it.dateStr === `2026-10-${String(it.day).padStart(2, '0')}`));
});

test('ranges across months label day/month; invalid or reversed ranges give null', () => {
    const items = rangeDateItems('2026-09-29', '2026-10-02');
    assert.deepEqual(items.map((it) => it.dateStr), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    assert.deepEqual(items.map((it) => it.label), ['29/9', '30/9', '1/10', '2/10']);
    assert.equal(rangeDateItems('2026-10-28', '2026-10-01'), null);
    assert.equal(rangeDateItems('2026-10-01', ''), null);
    assert.equal(rangeDateItems('', '2026-10-28'), null);
});

test('parseIsoDate gives local midnight', () => {
    const d = parseIsoDate('2026-10-01');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 1, 0]);
    assert.equal(parseIsoDate('01-10-2026'), null);
});

test('fetch covers every month of the period', () => {
    assert.deepEqual(monthsBetween(parseIsoDate('2026-10-01'), parseIsoDate('2026-10-28')), ['2026-10']);
    assert.deepEqual(monthsBetween(parseIsoDate('2026-11-15'), parseIsoDate('2027-02-03')), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.deepEqual(monthsBetween(new Date(2026, 9, 1), new Date(2026, 9, 31, 23, 59, 59, 999)), ['2026-10']);
});
