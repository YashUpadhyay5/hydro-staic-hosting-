import test from 'node:test';
import assert from 'node:assert/strict';

import { DataMapper } from '../src/modules/hrms/services/excelEngine/DataMapper.js';
import { SheetRenderer } from '../src/modules/hrms/services/excelEngine/SheetRenderer.js';
import { AttendanceColumnGenerator } from '../src/modules/hrms/services/excelEngine/AttendanceColumnGenerator.js';
import { ExcelTemplateLoader } from '../src/modules/hrms/services/excelEngine/ExcelTemplateLoader.js';
import { getDynamicFormData } from '../src/modules/hrms/data/complianceFormsData.js';
import { parseDateOnly } from '../src/modules/hrms/utils/helpers.js';

process.env.TZ = 'Asia/Kolkata';

const sampleEmployees = [
  {
    id: 1,
    empCode: 'HMPL101',
    name: 'Aarav Director',
    gender: 'Male',
    jobTitle: 'Managing Director',
    designation: 'Director',
    joiningDate: '2023-01-10',
    status: 'ACTIVE',
    compensationGross: 60000
  },
  {
    id: 2,
    empCode: 'HMPL102',
    name: 'Priya Nair',
    gender: 'Female',
    jobTitle: 'Engineer',
    designation: 'Staff',
    joiningDate: '2024-03-01',
    status: 'ACTIVE',
    compensationGross: 30000
  },
  {
    id: 3,
    empCode: 'HMPL103',
    name: 'Rohan Sharma',
    gender: 'Male',
    jobTitle: 'Technician',
    designation: 'FIELD',
    joiningDate: '2024-06-15',
    status: 'ACTIVE',
    compensationGross: 25000
  },
  {
    id: 4,
    empCode: 'HMPL104',
    name: 'Kiran Verma',
    gender: 'Male',
    jobTitle: 'Analyst',
    designation: 'Staff',
    joiningDate: '2025-01-05',
    status: 'ACTIVE',
    compensationGross: 28000
  },
  // Past / inactive employees that must NOT appear when unpaid
  {
    id: 5,
    empCode: 'HMPL110',
    name: 'Aditya Mishra',
    gender: 'Male',
    jobTitle: 'Operator',
    joiningDate: '2024-01-01',
    exitDate: '2026-09-15',
    exitReason: 'Resigned',
    status: 'PAST',
    compensationGross: 21001
  },
  {
    id: 6,
    empCode: 'HMPL115',
    name: 'BB2',
    gender: 'Female',
    jobTitle: 'Coordinator',
    joiningDate: '2024-02-01',
    exitDate: null,
    status: 'PAST',
    compensationGross: 13000
  },
  {
    id: 7,
    empCode: 'HMPL118',
    name: 'DD4',
    gender: 'Male',
    jobTitle: 'Helper',
    joiningDate: '2024-05-01',
    exitDate: '2026-10-10',
    exitReason: 'Completed contract',
    status: 'PAST',
    compensationGross: 15000
  }
];

function makePayItem(emp, overrides = {}) {
  const gross = Math.round((emp.compensationGross || 25000));
  const basic = Math.round(gross * 0.5);
  const hra = Math.round(gross * 0.3);
  const special = Math.max(0, gross - basic - hra);
  return {
    employeeId: emp.id,
    empCode: emp.empCode,
    employeeName: emp.name,
    workingDays: 27,
    workedDays: 27,
    lopDays: 0,
    grossEarned: gross,
    earningsBreakdown: { BASIC: basic, HRA: hra, SPECIAL_ALLOWANCE: special },
    deductionsBreakdown: { EPF_EE: 1800, PT: 200 },
    totalDeductions: 2000,
    netSalary: gross - 2000,
    status: 'PAID',
    ...overrides
  };
}

test('parseDateOnly handles both YYYY-MM-DD and DD/MM/YYYY safely', () => {
  const iso = parseDateOnly('2026-10-15', false);
  const dmy = parseDateOnly('15/10/2026', false);
  const dmyDash = parseDateOnly('15-10-2026', false);
  assert.deepEqual([iso.getFullYear(), iso.getMonth(), iso.getDate()], [2026, 9, 15]);
  assert.deepEqual([dmy.getFullYear(), dmy.getMonth(), dmy.getDate()], [2026, 9, 15]);
  assert.deepEqual([dmyDash.getFullYear(), dmyDash.getMonth(), dmyDash.getDate()], [2026, 9, 15]);
});

test('eligibleEmployeesForMonth aligns past/inactive filtering with payroll runs and tenure bounds', () => {
  const octPayslips = sampleEmployees.slice(0, 4).map(e => makePayItem(e));

  // With Oct payroll run: all unpaid PAST employees (including Oct mid-month unpaid DD4 and null-exitDate BB2) are excluded
  const eligible = DataMapper.eligibleEmployeesForMonth(sampleEmployees, '2026-10', octPayslips);
  assert.deepEqual(eligible.map(e => e.empCode), ['HMPL101', 'HMPL102', 'HMPL103', 'HMPL104']);

  // SKIPPED_EXIT item stays excluded; settled PAST item (checkedExited) is included consistently
  const withSettledAndSkipped = [
    ...octPayslips,
    makePayItem(sampleEmployees[6]), // DD4 explicitly settled in pay run
    makePayItem(sampleEmployees[4], { status: 'SKIPPED_EXIT' }) // Aditya skipped
  ];
  const eligibleWithSettlement = DataMapper.eligibleEmployeesForMonth(sampleEmployees, '2026-10', withSettledAndSkipped);
  assert.deepEqual(eligibleWithSettlement.map(e => e.empCode), ['HMPL101', 'HMPL102', 'HMPL103', 'HMPL104', 'HMPL118']);

  // Pre-payroll (no payslips): excludes PAST with exitDate < monthStart or missing exitDate, excludes future joiners
  const withFutureHire = [
    ...sampleEmployees,
    { id: 8, empCode: 'HMPL199', name: 'Future Hire', gender: 'Male', joiningDate: '2026-11-05', status: 'ACTIVE' }
  ];
  const prePayrollOct = DataMapper.eligibleEmployeesForMonth(withFutureHire, '2026-10', []);
  // HMPL110 exited Sept 15 (excluded), HMPL115 has null exitDate (excluded), HMPL199 joins Nov 5 (excluded), HMPL118 exited Oct 10 (included until payroll excludes them)
  assert.deepEqual(prePayrollOct.map(e => e.empCode), ['HMPL101', 'HMPL102', 'HMPL103', 'HMPL104', 'HMPL118']);

  // Explicit includeInactive option keeps inactive records when inspecting "Not Active / Inactive"
  const onlyPast = sampleEmployees.filter(e => e.status === 'PAST');
  assert.equal(DataMapper.eligibleEmployeesForMonth(onlyPast, '2026-10', octPayslips, { includeInactive: true }).length, 3);
});

test('all 7 Excel sheets exclude unpaid PAST employees and match Form W / Form T headcount', async () => {
  DataMapper.setDirectory(sampleEmployees);
  try {
    const octPayslips = sampleEmployees.slice(0, 4).map(e => makePayItem(e));
    const wb = await ExcelTemplateLoader.loadTemplate();

    SheetRenderer.renderFormU(wb.getWorksheet('Form U'), sampleEmployees, '2026-10', octPayslips);
    SheetRenderer.renderFormS(wb.getWorksheet('Form S'), sampleEmployees, '2026-10', octPayslips);
    SheetRenderer.renderFormVMuster(wb.getWorksheet('Form V Muster'), sampleEmployees, [], [], '2026-10', octPayslips);
    SheetRenderer.renderFormVRegister(wb.getWorksheet('Form V Register'), sampleEmployees, [], [], '2026-10', octPayslips);
    SheetRenderer.renderFormW(wb.getWorksheet('Form W'), sampleEmployees, [], octPayslips, '2026-10');
    SheetRenderer.renderFormX(wb.getWorksheet('Form X'), sampleEmployees, [], '2026-10', octPayslips);
    SheetRenderer.renderFormT(wb.getWorksheet('Form T'), sampleEmployees, octPayslips, '2026-10');

    const countRows = (sheetName, startRow, colIndex) => {
      const ws = wb.getWorksheet(sheetName);
      const values = [];
      for (let r = startRow; r <= ws.rowCount; r++) {
        const val = ws.getRow(r).getCell(colIndex).value;
        if (val !== null && val !== undefined && String(val).trim() !== '' && !String(val).startsWith('Signature')) {
          values.push(String(val));
        }
      }
      return values;
    };

    const formUNames = countRows('Form U', 7, 2);
    const formSNames = countRows('Form S', 11, 2);
    const formVMusterNames = countRows('Form V Muster', 9, 2);
    const formVRegNames = countRows('Form V Register', 13, 2);
    const formXNames = countRows('Form X', 12, 2);

    // Form W has a Total row below employees; only count numbered employee rows
    const wsW = wb.getWorksheet('Form W');
    const formWNames = [];
    for (let r = 12; r <= wsW.rowCount; r++) {
      const sl = wsW.getRow(r).getCell(1).value;
      const name = wsW.getRow(r).getCell(2).value;
      if (typeof sl === 'number' && name) formWNames.push(String(name));
    }

    // Form T prints one card every 20 rows (startRow = 1 + block * 20), with "Name (Code)" in C{startRow+4}
    const wsT = wb.getWorksheet('Form T');
    const formTNames = [];
    for (let block = 0; block < 10; block++) {
      const cellVal = wsT.getCell(`C${1 + block * 20 + 4}`).value;
      if (cellVal && String(cellVal).includes('HMPL')) formTNames.push(String(cellVal));
    }

    const expectedNames = ['Aarav Director', 'Priya Nair', 'Rohan Sharma', 'Kiran Verma'];
    assert.deepEqual(formUNames, expectedNames);
    assert.deepEqual(formSNames, expectedNames);
    assert.deepEqual(formVMusterNames, expectedNames);
    assert.deepEqual(formVRegNames, expectedNames);
    assert.deepEqual(formXNames, expectedNames);
    assert.deepEqual(formWNames, expectedNames);
    assert.equal(formTNames.length, 4);

    // Check Form X headcount cell A8 and Form W Men/Women cells L6/M6 agree
    assert.equal(wb.getWorksheet('Form X').getCell('A8').value, 'For the month of Oct 2026 | Total: 4 (Male: 3, Female: 1)');
    assert.equal(wb.getWorksheet('Form W').getCell('L6').value, 3);
    assert.equal(wb.getWorksheet('Form W').getCell('M6').value, 1);

    // Settled mid-month exit (DD4, exited 2026-10-10) renders exit info on Excel Form U and zero LOP after exit date on Excel Form V Register
    const settledWb = await ExcelTemplateLoader.loadTemplate();
    const settledPayslips = [...octPayslips, makePayItem(sampleEmployees[6])];
    SheetRenderer.renderFormU(settledWb.getWorksheet('Form U'), sampleEmployees, '2026-10', settledPayslips);
    SheetRenderer.renderFormVRegister(settledWb.getWorksheet('Form V Register'), sampleEmployees, [], [], '2026-10', settledPayslips);
    const dd4FormURow = settledWb.getWorksheet('Form U').getRow(7 + 4);
    assert.equal(dd4FormURow.getCell(22).value, '10/10/2026');
    assert.equal(dd4FormURow.getCell(23).value, 'Completed contract');
    assert.equal(dd4FormURow.getCell(24).value, 'Exited (Completed contract)');
    const dd4FormVRegRow = settledWb.getWorksheet('Form V Register').getRow(13 + 4);
    // Oct 1..10 has 2 Sundays (Oct 4, Oct 11 -> Oct 4 only), so 9 weekdays + 1 WO; Oct 11..31 must be '-' (0 LOP added)
    assert.equal(dd4FormVRegRow.getCell(6 + 11).value, '-');
    assert.equal(dd4FormVRegRow.getCell(40).value, 9);
  } finally {
    DataMapper.setDirectory([]);
  }
});

test('UI/PDF getDynamicFormData excludes unpaid PAST employees across all 7 forms and honors tenure/exit fields', () => {
  DataMapper.setDirectory(sampleEmployees);
  try {
    const octPayslips = sampleEmployees.slice(0, 4).map(e => makePayItem(e));
    const formKeys = ['Form S', 'Form U', 'Form V Muster', 'Form V Register', 'Form X', 'Form W', 'Form T'];

    for (const key of formKeys) {
      const data = getDynamicFormData(key, '2026-10', sampleEmployees, [], [], octPayslips, {});
      assert.equal(data.body.length, 4, `${key} should contain only 4 active employees`);
      const headRow = data.meta.find(r => /Total/i.test(r[0]));
      if (headRow) {
        assert.equal(headRow[2], 'Total: 4 (Male: 3, Female: 1)', `${key} headcount should be 4 (Male: 3, Female: 1)`);
      }
      const flat = JSON.stringify(data.body);
      assert.ok(!flat.includes('Aditya Mishra') && !flat.includes('HMPL115') && !flat.includes('HMPL118'), `${key} leaked a PAST employee`);
    }

    // Mid-month exit settled in Oct payroll: appears on all forms with accurate Form U exit data & bounded Form V attendance
    const settledPayslips = [...octPayslips, makePayItem(sampleEmployees[6])]; // DD4 exited 2026-10-10
    const formU = getDynamicFormData('Form U', '2026-10', sampleEmployees, [], [], settledPayslips, {});
    assert.equal(formU.body.length, 5);
    const dd4RowU = formU.body.find(r => r[1] === 'DD4');
    assert.equal(dd4RowU[14], '10/10/2026');
    assert.equal(dd4RowU[15], 'Completed contract');
    assert.equal(dd4RowU[16], 'Exited (Completed contract)');

    // Form V Muster must mark days after 2026-10-10 as '-' rather than 'A' or 'WO'
    const muster = getDynamicFormData('Form V Muster', '2026-10', sampleEmployees, [], [], settledPayslips, {});
    const dd4Muster = muster.body.find(r => r[1] === 'DD4');
    // Columns 7..37 are Oct 1..31; index 17 is Oct 11 (after Oct 10 exit) -> '-'
    assert.equal(dd4Muster[7 + 10], '-');
    assert.equal(dd4Muster[7 + 30], '-');
    // Present + Leaves + WO + Absent sums only days <= 10 (not 31)
    const totals = dd4Muster.slice(7 + 31);
    assert.equal(totals[0] + totals[1] + totals[2] + totals[3], 10);

    // AttendanceColumnGenerator directly returns '-' after exitDate and before joiningDate
    assert.equal(AttendanceColumnGenerator.getAttendanceSymbol('2026-10-11', [], [], 'Sunday', sampleEmployees[6]), '-');
    assert.equal(AttendanceColumnGenerator.getAttendanceSymbol('2024-02-28', [], [], 'Sunday', sampleEmployees[1]), '-');

    // Explicit inactive view shows 0 accrued EL in Form X for unpaid inactive employee
    const inactiveFormX = getDynamicFormData('Form X', '2026-10', [sampleEmployees[4]], [], [], octPayslips, { includeInactive: true });
    assert.equal(inactiveFormX.body[0][4], 0);
  } finally {
    DataMapper.setDirectory([]);
  }
});
