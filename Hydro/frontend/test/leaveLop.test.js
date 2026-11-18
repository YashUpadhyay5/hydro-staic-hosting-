// Pay run Step 1: LOP days from approved leave (fallback until the server preview arrives).
// Same cases as backend/test/payrollLop.test.js, which tests the server copy that decides the pay.
// Run with: npm test (node's built-in test runner; no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lopDatesOfLeave, lopForMonth } from '../src/modules/hrms/components/views/PayrollView/leaveLop.js';

process.env.TZ = 'Asia/Kolkata';
const approved = (over) => ({ id: Math.random().toString(36).slice(2), status: 'approved', type: 'Earned Leave', ...over });

test('working-day requests: LOP is the working dates after the EL ones', () => {
    const l = approved({ startDate: '2026-12-21', endDate: '2026-12-27', elDays: 2, lopDays: 2, totalDays: 4, workingDates: ['2026-12-21', '2026-12-22', '2026-12-24', '2026-12-26'] });
    assert.deepEqual(lopDatesOfLeave(l), ['2026-12-24', '2026-12-26']);
    assert.deepEqual(lopDatesOfLeave({ ...l, workingDates: JSON.stringify(l.workingDates) }), ['2026-12-24', '2026-12-26']);
});

test('older requests (no working dates): LOP is the calendar days after the EL days', () => {
    assert.deepEqual(lopDatesOfLeave(approved({ startDate: '2026-11-02', endDate: '2026-11-14', elDays: 12, lopDays: 1, totalDays: 13 })), ['2026-11-14']);
    assert.deepEqual(lopDatesOfLeave(approved({ startDate: '02-11-2026', endDate: '04-11-2026', elDays: 1, lopDays: 2, totalDays: 3 })), ['2026-11-03', '2026-11-04']);
});

test('LOP / unpaid typed leave is LOP on every day; special leave and all-EL leave never', () => {
    assert.deepEqual(lopDatesOfLeave(approved({ type: 'Loss of Pay', startDate: '2026-11-30', endDate: '2026-12-02', elDays: 0, lopDays: 0, totalDays: 3 })), ['2026-11-30', '2026-12-01', '2026-12-02']);
    assert.deepEqual(lopDatesOfLeave(approved({ type: 'Unpaid Leave', startDate: '2026-11-30', endDate: '2026-12-01' })), ['2026-11-30', '2026-12-01']);
    assert.deepEqual(lopDatesOfLeave(approved({ type: 'Marriage Leave', category: 'marriage', startDate: '2026-11-02', endDate: '2026-11-08', elDays: 0, lopDays: 0, totalDays: 7 })), []);
    assert.deepEqual(lopDatesOfLeave(approved({ startDate: '2026-11-02', endDate: '2026-11-03', elDays: 2, lopDays: 0, totalDays: 2 })), []);
});

test('pay month: only approved leave, split by date across months', () => {
    const span = approved({ startDate: '2026-12-29', endDate: '2027-01-02', elDays: 1, lopDays: 3, totalDays: 4, workingDates: ['2026-12-29', '2026-12-30', '2027-01-01', '2027-01-02'] });
    const leaves = [span, { ...span, status: 'pending' }, { ...span, status: 'rejected' }];
    assert.deepEqual(lopForMonth(leaves, 2026, 12), { days: 1, dates: ['2026-12-30'] });
    assert.deepEqual(lopForMonth(leaves, 2027, 1), { days: 2, dates: ['2027-01-01', '2027-01-02'] });
    assert.deepEqual(lopForMonth(leaves, 2026, 11), { days: 0, dates: [] });
});
