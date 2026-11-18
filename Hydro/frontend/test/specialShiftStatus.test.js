// Sunday / holiday shift status mapping used by the Attendance Record grid and its Excel export.
// Run with: npm test (node's built-in test runner; no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import {
    isoOfItem, formatShiftHours, buildSpecialShiftIndex, findSpecialShift, specialShiftDisplay, creditRulesText,
    SPECIAL_SUMMARY_HEADERS, emptySpecialCounts, addSpecialCount, specialCountsRow
} from '../src/modules/hrms/components/views/specialShiftStatus.js';

const shift = (over) => ({
    adjustmentId: Math.random().toString(36).slice(2), employeeId: 'E1', empCode: 'C1', employeeName: 'A', workDate: '2026-10-04',
    dayType: 'SUNDAY', holidayName: null, status: 'PENDING', source: 'ATTENDANCE', checkIn: '09:00 AM', checkOut: '05:30 PM',
    workingHours: 8.5, eligibleDays: 1, attendanceStatus: 'COMPLETE', approvedDays: 0, verifiedByName: null, verifiedAt: null, ...over
});

test('date columns keep their own day (no time-zone shift)', () => {
    assert.equal(isoOfItem({ year: 2026, month: 9, day: 4 }), '2026-10-04');
    assert.equal(formatShiftHours(8.5), '8 h 30 m');
    assert.equal(formatShiftHours(5.9999), '6 h 00 m');
    assert.equal(formatShiftHours(null), '—');
});

test('labels: pending amber, approved green with ✓, rejected shows no credit; Sunday vs holiday', () => {
    const p = specialShiftDisplay(shift());
    assert.equal(p.state, 'PENDING');
    assert.equal(p.label, 'WOS (Pending)');
    assert.equal(p.creditLine, 'Eligible: 1 day');
    assert.equal(p.colors.xlFill, 'FFFEF3C7');

    const needs = specialShiftDisplay(shift({ eligibleDays: 0, workingHours: 2 }));
    assert.equal(needs.creditLine, 'Needs review');

    const a = specialShiftDisplay(shift({ status: 'ACTIVE', approvedDays: 1, verifiedByName: 'Admin (E9)', verifiedAt: '2026-10-05T10:00:00Z' }));
    assert.equal(a.label, 'WOS ✓');
    assert.equal(a.creditLine, '+1 day');
    assert.match(a.tooltip, /credited by Admin \(E9\)/);

    const r = specialShiftDisplay(shift({ status: 'REJECTED', rejectionReason: 'Not scheduled' }));
    assert.equal(r.label, 'Sunday (No Credit Approved)');
    assert.match(r.tooltip, /Not scheduled/);

    const h = specialShiftDisplay(shift({ dayType: 'HOLIDAY', holidayName: 'Diwali', status: 'PENDING' }));
    assert.equal(h.label, 'WOH (Pending)');
    assert.equal(specialShiftDisplay(shift({ dayType: 'HOLIDAY', status: 'REJECTED' })).label, 'Holiday (No Credit Approved)');
    assert.equal(specialShiftDisplay(shift({ dayType: 'HOLIDAY', status: 'ACTIVE', approvedDays: 0.5 })).label, 'WOH ✓');
    assert.equal(specialShiftDisplay(null), null);
});

test('one shift per employee and date: the credit that decides the balance wins', () => {
    const idx = buildSpecialShiftIndex([
        shift({ status: 'REVERSED', approvedDays: 1 }),
        shift({ status: 'ACTIVE', approvedDays: 1, source: 'MANUAL' }),
        shift({ employeeId: 'E2', empCode: 'C2', status: 'PENDING' })
    ]);
    assert.equal(findSpecialShift(idx, { id: 'E1' }, '2026-10-04').status, 'ACTIVE');
    assert.equal(findSpecialShift(idx, { id: 'x', empCode: 'c1' }, '2026-10-04').status, 'ACTIVE', 'matched by code, case-insensitive');
    assert.equal(findSpecialShift(idx, { id: 'E2' }, '2026-10-04').status, 'PENDING');
    assert.equal(findSpecialShift(idx, { id: 'E1' }, '2026-10-11'), null);
});

test('summary counts: only approved credits count as verified credit; pending and rejected never do', () => {
    const c = emptySpecialCounts();
    addSpecialCount(c, shift({ status: 'ACTIVE', approvedDays: 1 }));
    addSpecialCount(c, shift({ status: 'ACTIVE', approvedDays: 0.5, dayType: 'HOLIDAY' }));
    addSpecialCount(c, shift({ status: 'PENDING', eligibleDays: 1 }));
    addSpecialCount(c, shift({ status: 'REJECTED' }));
    addSpecialCount(c, shift({ status: 'REVERSED', approvedDays: 1 }));
    addSpecialCount(c, shift({ status: 'PENDING', dayType: 'HOLIDAY' }));
    assert.deepEqual(specialCountsRow(c), [1, 1, 2, 1, 1, 0, 1.5]);
    assert.equal(SPECIAL_SUMMARY_HEADERS.length, specialCountsRow(c).length);
});

test('credit rules text comes from the server policy', () => {
    assert.equal(creditRulesText({ creditRules: [{ minHours: 4, days: 0.5 }, { minHours: 6, days: 1 }] }),
        '6 h or more = 1 day, 4 h to under 6 h = 0.5 days, under 4 h = admin review');
});

test('Excel: cells built the way the export builds them open in ExcelJS and SheetJS with the right statuses and totals', async () => {
    const shifts = [
        shift({ workDate: '2026-10-04', status: 'PENDING' }),
        shift({ workDate: '2026-10-11', status: 'ACTIVE', approvedDays: 1, verifiedByName: 'Admin' }),
        shift({ workDate: '2026-10-18', status: 'REJECTED', rejectionReason: 'No' })
    ];
    const idx = buildSpecialShiftIndex(shifts);
    const emp = { id: 'E1' };
    const dates = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'];

    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('Attendance Record');
    const ws2 = wb.addWorksheet('Attendance Status');
    const baseHeaders = ['Present (P)', 'Absent (A)', 'WOS', 'WOH', 'EL', 'Sun/Hol Consumed', 'LOP', 'Sunday (WO)', 'Holiday (H)', 'Total Payable Days'];
    const headers = [...baseHeaders, ...SPECIAL_SUMMARY_HEADERS];
    ['Emp ID', 'Name', 'Department'].forEach((h, i) => { ws2.getCell(1, 1 + i).value = h; });
    ['C1', 'A', 'Ops'].forEach((v, i) => { ws2.getCell(2, 1 + i).value = v; });
    headers.forEach((h, i) => { ws2.getCell(1, 4 + dates.length + i).value = h; });
    const counts = emptySpecialCounts();
    let wos = 0;
    dates.forEach((iso, d) => {
        const s = findSpecialShift(idx, emp, iso);
        const view = specialShiftDisplay(s);
        const c1 = ws1.getCell(2, 4 + d);
        const c2 = ws2.getCell(2, 4 + d);
        wos++; // every date has a punch in this example
        if (!view) { c1.value = 'WOS'; c2.value = 'WOS'; return; }
        c1.value = { richText: [
            { text: `${view.shortLabel || view.label}\n`, font: { bold: true, color: { argb: view.colors.xlFont } } },
            { text: `09:00 AM - 05:30 PM · ${view.hours}\n` },
            { text: view.creditLine, font: { italic: true } }
        ] };
        c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: view.colors.xlFill } };
        c1.note = view.tooltip;
        c2.value = view.state === 'APPROVED' || view.state === 'PENDING' ? view.label : `${view.code} (No Credit)`;
        c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: view.colors.xlFill } };
        addSpecialCount(counts, s);
    });
    const totals = [0, 0, wos, 0, 0, 0, 0, 0, 0, wos, ...specialCountsRow(counts)];
    totals.forEach((v, i) => { ws2.getCell(2, 4 + dates.length + i).value = v; });
    const buffer = await wb.xlsx.writeBuffer();

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buffer);
    const s1 = back.getWorksheet('Attendance Record');
    assert.equal(s1.getCell(2, 4).value.richText[0].text, 'WOS (Pending)\n');
    assert.equal(s1.getCell(2, 5).value.richText[0].text, 'WOS ✓\n');
    assert.equal(s1.getCell(2, 5).value.richText[2].text, '+1 day');
    assert.equal(s1.getCell(2, 6).value.richText[0].text, 'WOS (No Credit)\n');
    assert.equal(s1.getCell(2, 7).value, 'WOS', 'no verification record: unchanged WOS');
    assert.equal(s1.getCell(2, 4).fill.fgColor.argb, 'FFFEF3C7');
    assert.ok(String(s1.getCell(2, 4).note.texts ? s1.getCell(2, 4).note.texts.map((t) => t.text).join('') : s1.getCell(2, 4).note).includes('awaiting verification'));

    // A second, independent reader opens the same file.
    const sheet = XLSX.read(Buffer.from(buffer), { type: 'buffer' }).Sheets['Attendance Status'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const head = rows[0].slice(3 + dates.length);
    const vals = rows[1].slice(3 + dates.length);
    const col = (name) => vals[head.indexOf(name)];
    assert.deepEqual(rows[1].slice(3, 3 + dates.length), ['WOS (Pending)', 'WOS ✓', 'WOS (No Credit)', 'WOS']);
    assert.equal(col('WOS'), 4, 'existing WOS total unchanged');
    assert.equal(col('Total Payable Days'), 4, 'existing payable total unchanged');
    assert.equal(col('Verified WOS (Paid & Credited)'), 1);
    assert.equal(col('Pending WOS (Under Admin Review)'), 1);
    assert.equal(col('Rejected/Reversed WOS (No Credit)'), 1);
    assert.equal(col('Approved Sun/Hol Credit (Days)'), 1);
});
