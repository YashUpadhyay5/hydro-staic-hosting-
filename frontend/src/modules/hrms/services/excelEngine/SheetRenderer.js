import { DataMapper } from './DataMapper.js';
import { ExcelStyleCopier } from './ExcelStyleCopier.js';
import { MergeManager } from './MergeManager.js';
import { FormulaExtender } from './FormulaExtender.js';
import { AttendanceColumnGenerator } from './AttendanceColumnGenerator.js';

export class SheetRenderer {
  /**
   * Completely purges leftover template sample rows beyond actual database records
   */
  static cleanUnusedTemplateRows(worksheet, startRowIndex, actualRecordCount, maxCols = 50) {
    if (!worksheet) return;
    const lastFilledRowIndex = startRowIndex + actualRecordCount - 1;
    const totalSheetRows = Math.max(worksheet.rowCount || 0, 60);

    for (let r = lastFilledRowIndex + 1; r <= totalSheetRows; r++) {
      const row = worksheet.findRow(r) || worksheet.getRow(r);
      if (!row) continue;

      for (let c = 1; c <= maxCols; c++) {
        const cell = row.getCell(c);
        if (cell) {
          cell.value = null;
          cell.style = {};
        }
      }
      row.commit();
    }
  }

  /**
   * Render Form U on loaded official template sheet
   */
  static renderFormU(worksheet, employees = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    if (!worksheet) return;

    const meta = DataMapper.mapMetadata(employees, selectedMonth);
    const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3);

    // Headers on official Form U:
    // C4 contains Establishment Details
    // C5 contains Registration Certificate No
    worksheet.getCell('C4').value = [meta.companyName, meta.companyAddress].filter(Boolean).join(', ');
    worksheet.getCell('C5').value = meta.regNo || 'REG-HRMS-2026';

    // Row 6 has the table headers
    // Employee records start at Row 7
    const templateRowIndex = 7;
    const formURows = DataMapper.mapFormURows(employees, selectedMonth);

    formURows.forEach((rowData, idx) => {
      const targetRowIndex = templateRowIndex + idx;
      const targetRow = worksheet.getRow(targetRowIndex);

      rowData.forEach((val, colIdx) => {
        const cell = targetRow.getCell(colIdx + 1);
        cell.value = val;
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        cell.font = { name: 'Calibri', size: 9 };
        if (colIdx === 0 || colIdx === 2 || colIdx === 3 || colIdx === 5 || colIdx === 6 || colIdx === 13 || colIdx === 14) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });

      targetRow.commit();
    });

    this.cleanUnusedTemplateRows(worksheet, templateRowIndex, formURows.length, 25);

    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }

  /**
   * Render Form S on loaded official template sheet
   */
  static renderFormS(worksheet, employees = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    if (!worksheet) return;

    const meta = DataMapper.mapMetadata(employees, selectedMonth);
    const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3);

    // Form S Header layout:
    // Row 4 (E4..N4): Name and full address of the establishment
    // Row 5 (E5..N5): Name of Employer/Managing Director
    // Row 5 (O5): Payment date
    // Row 6 (E6..N6): Wage Period
    worksheet.getCell('E4').value = [meta.companyName, meta.companyAddress].filter(Boolean).join(', ');
    worksheet.getCell('E5').value = `${meta.employerName || 'Employer / Management'}, ${meta.companyAddress}`;
    worksheet.getCell('O5').value = meta.paymentDate;
    worksheet.getCell('E6').value = monthLabel;

    // Row 9 is column names, Row 10 is column indices (1)..(16)
    // Employee records start at Row 11
    const templateRowIndex = 11;
    const formSRows = DataMapper.mapFormSRows(employees);

    formSRows.forEach((rowData, idx) => {
      const targetRowIndex = templateRowIndex + idx;
      const targetRow = worksheet.getRow(targetRowIndex);

      rowData.forEach((val, colIdx) => {
        const cell = targetRow.getCell(colIdx + 1);
        cell.value = val;
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        cell.font = { name: 'Calibri', size: 9 };
        if (colIdx === 0 || colIdx === 2 || colIdx === 5 || colIdx === 6 || colIdx === 7 || colIdx === 8 || colIdx === 9 || colIdx === 10 || colIdx === 11 || colIdx === 12) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colIdx === 14) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
        } else if (colIdx === 15) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (typeof val === 'number' && val > 0) {
            cell.numFmt = '#,##0.00';
          }
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
      targetRow.commit();
    });

    // Place Signature block dynamically immediately below the last employee row
    const sigRowIndex = templateRowIndex + formSRows.length + 1;
    const sigRow = worksheet.getRow(sigRowIndex);
    sigRow.getCell(1).value = "Signature of the Employer/Contractor/Managing Director \n/ Managing Partner / or Authorised Person(Name in Capitals)";
    sigRow.getCell(1).font = { name: 'Calibri', size: 9, bold: true };
    sigRow.commit();

    // Clean any unused template rows beyond the signature row
    this.cleanUnusedTemplateRows(worksheet, sigRowIndex + 1, 0, 20);

    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }

  /**
   * Render Form V Muster on loaded official template sheet
   */
  static renderFormVMuster(worksheet, employees = [], attendance = [], leaves = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    if (!worksheet) return;

    const meta = DataMapper.mapMetadata(employees, selectedMonth);
    const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3);
    const daysInMonth = AttendanceColumnGenerator.getDaysInMonth(selectedMonth);

    worksheet.getCell('E4').value = meta.companyName;
    worksheet.getCell('E5').value = meta.companyAddress;
    worksheet.getCell('E6').value = monthLabel;

    // Header is row 7, Date labels are row 8 (Columns 7 to 37)
    const row8 = worksheet.getRow(8);
    for (let day = 1; day <= 31; day++) {
      const cell = row8.getCell(6 + day);
      if (day <= daysInMonth) {
        cell.value = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, day);
      } else {
        cell.value = '';
      }
    }
    row8.commit();

    // Employee records start at Row 9
    const templateRowIndex = 9;
    const musterData = DataMapper.mapFormVMusterRows(employees, attendance, leaves, selectedMonth);

    musterData.forEach((empData, idx) => {
      const targetRowIndex = templateRowIndex + idx;
      const targetRow = worksheet.getRow(targetRowIndex);

      targetRow.getCell(1).value = empData.seq;
      targetRow.getCell(2).value = empData.name;
      targetRow.getCell(3).value = empData.fatherSpouse;
      targetRow.getCell(4).value = empData.gender;
      targetRow.getCell(5).value = empData.doj;
      targetRow.getCell(6).value = empData.designation;

      for (let day = 1; day <= 31; day++) {
        const cell = targetRow.getCell(6 + day);
        if (day <= daysInMonth) {
          cell.value = empData.dailySymbols[day - 1] || '-';
        } else {
          cell.value = '';
        }
      }

      // Column 38 is Remarks
      targetRow.getCell(38).value = '';

      for (let c = 1; c <= 38; c++) {
        const cell = targetRow.getCell(c);
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        cell.font = { name: 'Calibri', size: 9 };
        if (c === 2 || c === 3 || c === 6) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }

      targetRow.commit();
    });

    this.cleanUnusedTemplateRows(worksheet, templateRowIndex, musterData.length, 45);

    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }

  /**
   * Render Form V Register on loaded official template sheet
   */
  static renderFormVRegister(worksheet, employees = [], attendance = [], leaves = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    if (!worksheet) return;

    const meta = DataMapper.mapMetadata(employees, selectedMonth);
    const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3);
    const daysInMonth = AttendanceColumnGenerator.getDaysInMonth(selectedMonth);
    const endDayPad = String(daysInMonth).padStart(2, '0');

    worksheet.getCell('A4').value = `For the period From 01 ${monthLabel} To ${endDayPad} ${monthLabel}`;
    worksheet.getCell('C5').value = [meta.companyName, meta.companyAddress].filter(Boolean).join(', ');
    worksheet.getCell('C6').value = meta.employerName || '';
    worksheet.getCell('C7').value = meta.managerName || '';
    worksheet.getCell('C8').value = meta.regNo || '';

    // Row 10 is headers, Row 11 is dates (Columns 7 to 37), Row 12 is column numbers
    const row11 = worksheet.getRow(11);
    for (let day = 1; day <= 31; day++) {
      const cell = row11.getCell(6 + day);
      if (day <= daysInMonth) {
        cell.value = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, day);
      } else {
        cell.value = '';
      }
    }
    row11.commit();

    // Employee records start at Row 13
    const templateRowIndex = 13;
    const [year, month] = selectedMonth.split('-');

    employees.forEach((emp, idx) => {
      const targetRowIndex = templateRowIndex + idx;
      const targetRow = worksheet.getRow(targetRowIndex);

      const empPunches = attendance.filter(a => DataMapper.matchesEmp(a, emp));
      const empLeaves = leaves.filter(l => DataMapper.matchesEmp(l, emp));

      targetRow.getCell(1).value = idx + 1;
      targetRow.getCell(2).value = emp.name || '';
      targetRow.getCell(3).value = emp.empCode || emp.emp_code || emp.employeeId || '';
      targetRow.getCell(4).value = emp.startTime || '09:00 AM';
      targetRow.getCell(5).value = 0.5;
      targetRow.getCell(6).value = emp.endTime || '05:30 PM';

      let totalHours = 0;
      let totalDaysWorked = 0;
      let lossOfPayDays = 0;

      for (let day = 1; day <= 31; day++) {
        const cell = targetRow.getCell(6 + day);
        if (day <= daysInMonth) {
          const dayPad = String(day).padStart(2, '0');
          const dateStr = `${year}-${month}-${dayPad}`;
          const symbol = AttendanceColumnGenerator.getAttendanceSymbol(dateStr, empPunches, empLeaves, emp.weekly_offs || emp.weeklyOffs);
          const hours = (symbol === 'P') ? 8 : (symbol === 'HD' ? 4 : 0);
          cell.value = hours > 0 ? hours : (symbol === 'WO' ? 'WO' : '-');
          totalHours += hours;
          if (hours > 0) totalDaysWorked += (hours === 8 ? 1 : 0.5);
          if (symbol === 'A' || symbol === 'LOP') lossOfPayDays += 1;
        } else {
          cell.value = '';
        }
      }

      // Summary columns: Col 38 = Total Days Worked, Col 39 = Total Hours Worked, Col 40 = Loss of Pay
      targetRow.getCell(38).value = totalDaysWorked;
      targetRow.getCell(39).value = totalHours;
      targetRow.getCell(40).value = lossOfPayDays;
      targetRow.getCell(41).value = '-';
      targetRow.getCell(42).value = '-';
      targetRow.getCell(43).value = '';

      for (let c = 1; c <= 43; c++) {
        const cell = targetRow.getCell(c);
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        cell.font = { name: 'Calibri', size: 9 };
        if (c === 2) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }

      targetRow.commit();
    });

    this.cleanUnusedTemplateRows(worksheet, templateRowIndex, employees.length, 45);

    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }

  /**
   * Render Form W on loaded official template sheet
   */
  static renderFormW(worksheet, employees = [], attendance = [], payslips = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    if (!worksheet) return;

    const meta = DataMapper.mapMetadata(employees, selectedMonth);
    const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3);
    const daysInMonth = AttendanceColumnGenerator.getDaysInMonth(selectedMonth);
    const endDayPad = String(daysInMonth).padStart(2, '0');

    worksheet.getCell('D4').value = [meta.companyName, meta.companyAddress].filter(Boolean).join(', ');
    worksheet.getCell('D5').value = meta.employerName || '';
    worksheet.getCell('D6').value = meta.managerName || '';
    worksheet.getCell('D7').value = meta.regNo || '';
    worksheet.getCell('A8').value = `Wage Period from 01 ${monthLabel} to ${endDayPad} ${monthLabel} (Monthly)`;

    // 1. Unmerge all template merges touching rows 9 to 100
    const mergeKeys = Object.keys(worksheet._merges || {});
    for (const range of mergeKeys) {
      const m = worksheet._merges[range];
      if (m && ((m.top >= 9 && m.top <= 100) || (m.bottom >= 9 && m.bottom <= 100))) {
        try {
          worksheet.unMergeCells(range);
        } catch (e) {}
      }
    }

    // 2. Clear cells in rows 9 to 60 up to col 35 and decouple template shared styles
    for (let r = 9; r <= 60; r++) {
      const row = worksheet.getRow(r);
      for (let c = 1; c <= 35; c++) {
        const cell = row.getCell(c);
        cell.value = null;
        cell.style = {};
      }
      row.commit();
    }

    // 3. Set Proportional Column Widths for Executive Legibility
    const colWidths = [
      { col: 1, width: 10 },  // Serial Number
      { col: 2, width: 26 },  // Name of the Employee
      { col: 3, width: 18 },  // Employee ID
      { col: 4, width: 14 },  // Working Days
      { col: 5, width: 14 },  // Days Worked
      { col: 6, width: 15 },  // Basic Wage
      { col: 7, width: 15 },  // HRA
      { col: 8, width: 15 },  // Other Allowances
      { col: 9, width: 18 },  // Total Base Gross
      { col: 10, width: 15 }, // Earned Basic
      { col: 11, width: 15 }, // Earned HRA
      { col: 12, width: 15 }, // Other Allowances
      { col: 13, width: 16 }, // Ad-hoc Payment
      { col: 14, width: 16 }, // Ad-hoc Deduction
      { col: 15, width: 18 }, // Total Earned Gross
      { col: 16, width: 16 }, // Employer PF
      { col: 17, width: 16 }, // Employee PF
      { col: 18, width: 16 }, // VPF
      { col: 19, width: 16 }, // ESIC Employee
      { col: 20, width: 16 }, // ESIC Employer
      { col: 21, width: 14 }, // PT
      { col: 22, width: 16 }, // Income Tax (TDS)
      { col: 23, width: 16 }, // Other Deductions
      { col: 24, width: 16 }, // Total Deductions
      { col: 25, width: 18 }, // Net Wages
      { col: 26, width: 16 }  // Date of Payment
    ];
    colWidths.forEach(({ col, width }) => {
      worksheet.getColumn(col).width = width;
    });

    // 4. Category styling palette (Executive Corporate Theme)
    const colStyles = {
      // 1-5: General Employee Info (Executive Deep Navy)
      1: { t1Bg: 'FF1E3A8A', t2Bg: 'FF1E3A8A' },
      2: { t1Bg: 'FF1E3A8A', t2Bg: 'FF1E3A8A' },
      3: { t1Bg: 'FF1E3A8A', t2Bg: 'FF1E3A8A' },
      4: { t1Bg: 'FF1E3A8A', t2Bg: 'FF1E3A8A' },
      5: { t1Bg: 'FF1E3A8A', t2Bg: 'FF1E3A8A' },
      // 6-9: Base Registration Gross (Refined Slate Indigo)
      6: { t1Bg: 'FF2B4C7E', t2Bg: 'FF3B629B' },
      7: { t1Bg: 'FF2B4C7E', t2Bg: 'FF3B629B' },
      8: { t1Bg: 'FF2B4C7E', t2Bg: 'FF3B629B' },
      9: { t1Bg: 'FF2B4C7E', t2Bg: 'FF25436E' },
      // 10-15: Earned Gross Salary (Royal Blue - Highlights month earnings)
      10: { t1Bg: 'FF1D4ED8', t2Bg: 'FF2563EB' },
      11: { t1Bg: 'FF1D4ED8', t2Bg: 'FF2563EB' },
      12: { t1Bg: 'FF1D4ED8', t2Bg: 'FF2563EB' },
      13: { t1Bg: 'FF1D4ED8', t2Bg: 'FF2563EB' },
      14: { t1Bg: 'FF1D4ED8', t2Bg: 'FF2563EB' },
      15: { t1Bg: 'FF1D4ED8', t2Bg: 'FF1E40AF' },
      // 16-18: Provident Fund (Sophisticated Steel Slate)
      16: { t1Bg: 'FF1E3A5F', t2Bg: 'FF2C5282' },
      17: { t1Bg: 'FF1E3A5F', t2Bg: 'FF2C5282' },
      18: { t1Bg: 'FF1E3A5F', t2Bg: 'FF2C5282' },
      // 19-20: ESIC (Steel Slate)
      19: { t1Bg: 'FF1E3A5F', t2Bg: 'FF2C5282' },
      20: { t1Bg: 'FF1E3A5F', t2Bg: 'FF2C5282' },
      // 21: Professional Tax (Slate Indigo)
      21: { t1Bg: 'FF2B4C7E', t2Bg: 'FF2B4C7E' },
      // 22: Income Tax (TDS) (Slate Indigo)
      22: { t1Bg: 'FF2B4C7E', t2Bg: 'FF3B629B' },
      // 23: Other Deductions (Slate Indigo)
      23: { t1Bg: 'FF2B4C7E', t2Bg: 'FF3B629B' },
      // 24: Total Deductions (Warm Charcoal Slate)
      24: { t1Bg: 'FF334155', t2Bg: 'FF334155' },
      // 25: Net Wages (Prestigious Emerald - Key Payout Highlight)
      25: { t1Bg: 'FF065F46', t2Bg: 'FF047857' },
      // 26: Date of Payment (Executive Deep Navy)
      26: { t1Bg: 'FF1E3A8A', t2Bg: 'FF1E3A8A' }
    };

    // 5. Set Tier 1 (Group Category) Header Values in Row 9
    worksheet.getCell('A9').value = 'Serial Number';
    worksheet.getCell('B9').value = 'Name of the Employee';
    worksheet.getCell('C9').value = 'Employee Identification No.';
    worksheet.getCell('D9').value = 'Number of working days';
    worksheet.getCell('E9').value = 'Number of days worked';
    worksheet.getCell('F9').value = 'GROSS SALARY (BASE REGISTRATION)';
    worksheet.getCell('J9').value = 'EARNED GROSS SALARY';
    worksheet.getCell('P9').value = 'PROVIDENT FUND (PF)';
    worksheet.getCell('S9').value = 'ESIC';
    worksheet.getCell('U9').value = 'Professional Tax (₹)';
    worksheet.getCell('V9').value = 'Income Tax (TDS) (₹)';
    worksheet.getCell('W9').value = 'Other Deductions (₹)';
    worksheet.getCell('X9').value = 'Total Deductions (₹)';
    worksheet.getCell('Y9').value = 'Net Wages (₹)';
    worksheet.getCell('Z9').value = 'Date of Payment';

    // 6. Set Tier 2 (Subheadings) Values in Row 10
    worksheet.getCell('F10').value = 'Basic Wage (₹)';
    worksheet.getCell('G10').value = 'House Rent Allowance (₹)';
    worksheet.getCell('H10').value = 'Other Allowances (₹)';
    worksheet.getCell('I10').value = 'Total Base Gross (₹)';
    worksheet.getCell('J10').value = 'Earned Basic (₹)';
    worksheet.getCell('K10').value = 'Earned HRA (₹)';
    worksheet.getCell('L10').value = 'Other Allowances (₹)';
    worksheet.getCell('M10').value = 'Ad-hoc Payment (₹)';
    worksheet.getCell('N10').value = 'Ad-hoc Deduction (₹)';
    worksheet.getCell('O10').value = 'Total Earned Gross (₹)';
    worksheet.getCell('P10').value = 'Employer PF Contribution (12%) (₹)';
    worksheet.getCell('Q10').value = 'Employee PF Contribution (12%) (₹)';
    worksheet.getCell('R10').value = 'Voluntary PF (VPF) (₹)';
    worksheet.getCell('S10').value = 'Employee Contribution (0.75%) (₹)';
    worksheet.getCell('T10').value = 'Employer Contribution (3.25%) (₹)';

    // Row heights for spacious, modern presentation
    worksheet.getRow(9).height = 28;
    worksheet.getRow(10).height = 28;
    worksheet.getRow(11).height = 18;

    // 7. Apply Header Merges
    worksheet.mergeCells('A9:A10');
    worksheet.mergeCells('B9:B10');
    worksheet.mergeCells('C9:C10');
    worksheet.mergeCells('D9:D10');
    worksheet.mergeCells('E9:E10');
    worksheet.mergeCells('F9:I9');
    worksheet.mergeCells('J9:O9');
    worksheet.mergeCells('P9:R9');
    worksheet.mergeCells('S9:T9');
    worksheet.mergeCells('U9:U10');
    worksheet.mergeCells('V9:V10');
    worksheet.mergeCells('W9:W10');
    worksheet.mergeCells('X9:X10');
    worksheet.mergeCells('Y9:Y10');
    worksheet.mergeCells('Z9:Z10');

    // 8. Style Header Cells (Rows 9 & 10) and Column Numbers (Row 11)
    for (let c = 1; c <= 26; c++) {
      const style = colStyles[c] || { t1Bg: 'FF1E3A8A', t2Bg: 'FF1E3A8A' };

      // Row 9 (Tier 1 Category Group)
      const cell9 = worksheet.getRow(9).getCell(c);
      cell9.style = {};
      cell9.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell9.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell9.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.t1Bg } };
      cell9.border = {
        top: { style: 'medium', color: { argb: 'FF0F172A' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: '33FFFFFF' } },
        right: { style: 'thin', color: { argb: '33FFFFFF' } }
      };

      // Row 10 (Tier 2 Subheading)
      const cell10 = worksheet.getRow(10).getCell(c);
      cell10.style = {};
      cell10.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell10.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell10.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.t2Bg } };
      cell10.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: '33FFFFFF' } },
        right: { style: 'thin', color: { argb: '33FFFFFF' } }
      };

      // Row 11 (Column Numbering)
      const cell11 = worksheet.getRow(11).getCell(c);
      cell11.style = {};
      cell11.value = `(${c})`;
      cell11.font = { name: 'Calibri', size: 8, italic: true, bold: true, color: { argb: 'FF475569' } };
      cell11.alignment = { horizontal: 'center', vertical: 'middle' };
      cell11.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell11.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    }

    // 9. Employee records start at Row 12
    const templateRowIndex = 12;
    const formWRows = DataMapper.mapFormWRows(employees, attendance, payslips, selectedMonth);

    // Running totals for summary row
    const totals = Array(27).fill(0);

    formWRows.forEach((rowData, idx) => {
      const targetRowIndex = templateRowIndex + idx;
      const targetRow = worksheet.getRow(targetRowIndex);
      targetRow.height = 22;

      const isEven = idx % 2 === 1;
      const baseRowBg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

      rowData.forEach((val, colIdx) => {
        const colNum = colIdx + 1;
        const cell = targetRow.getCell(colNum);
        cell.style = {};

        const isNetWages = colNum === 25;
        const isEmpName = colNum === 2;

        if (colNum === 15) {
          // Total Earned Gross (Column O) = Earned Basic (J) + Earned HRA (K) + Other Allowances (L) + Ad-hoc Payment (M) - Ad-hoc Deduction (N)
          cell.value = { formula: `J${targetRowIndex}+K${targetRowIndex}+L${targetRowIndex}+M${targetRowIndex}-N${targetRowIndex}`, result: val };
        } else if (colNum === 24) {
          // Total Deductions (Column X) = Employee PF (Q) + VPF (R) + Employee ESIC (S) + PT (U) + TDS (V) + Other (W)
          cell.value = { formula: `Q${targetRowIndex}+R${targetRowIndex}+S${targetRowIndex}+U${targetRowIndex}+V${targetRowIndex}+W${targetRowIndex}`, result: val };
        } else if (colNum === 25) {
          // Net Wages (Column Y) = Total Earned Gross (O) - Total Deductions (X)
          const isHeld = (val === 0 && rowData[14] > 0);
          cell.value = isHeld ? 0 : { formula: `O${targetRowIndex}-X${targetRowIndex}`, result: val };
        } else {
          cell.value = val;
        }

        // Elegant soft mint background for Net Wages column
        const cellBg = isNetWages 
          ? (isEven ? 'FFECFDF5' : 'FFF0FDF4') 
          : baseRowBg;

        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cellBg } };

        cell.font = { 
          name: 'Calibri', 
          size: 9, 
          bold: isNetWages || isEmpName,
          color: { argb: isNetWages ? 'FF065F46' : 'FF0F172A' } 
        };

        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        if (colIdx === 0 || colIdx === 2 || colIdx === 3 || colIdx === 4 || colIdx === 25) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colIdx >= 5 && colIdx <= 24) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (typeof val === 'number') {
            cell.numFmt = '#,##0.00';
            totals[colNum] += val;
          }
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
      targetRow.commit();
    });

    // 10. Executive Total Summary Row
    let rowsWritten = formWRows.length;
    if (formWRows.length > 0) {
      const totalRowIndex = templateRowIndex + formWRows.length;
      const totalRow = worksheet.getRow(totalRowIndex);
      totalRow.height = 24;

      for (let c = 1; c <= 26; c++) {
        const cell = totalRow.getCell(c);
        cell.style = {};
        const isNetWages = c === 25;

        cell.fill = { 
          type: 'pattern', 
          pattern: 'solid', 
          fgColor: { argb: isNetWages ? 'FFDCFCE7' : 'FFF1F5F9' } 
        };

        cell.border = {
          top: { style: 'thin', color: { argb: 'FF0F172A' } },
          bottom: { style: 'double', color: { argb: 'FF0F172A' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        cell.font = { 
          name: 'Calibri', 
          size: 9.5, 
          bold: true, 
          color: { argb: isNetWages ? 'FF065F46' : 'FF0F172A' } 
        };

        if (c === 2) {
          cell.value = 'TOTAL';
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (c >= 6 && c <= 25 && totals[c] > 0) {
          const colLetter = String.fromCharCode(64 + c);
          if (c === 25) {
            cell.value = { formula: `O${totalRowIndex}-X${totalRowIndex}`, result: Math.round(totals[c] * 100) / 100 };
          } else if (c === 15 || c === 24 || (c >= 6 && c <= 23)) {
            cell.value = { formula: `SUM(${colLetter}${templateRowIndex}:${colLetter}${totalRowIndex - 1})`, result: Math.round(totals[c] * 100) / 100 };
          } else {
            cell.value = Math.round(totals[c] * 100) / 100;
          }
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
        } else {
          cell.value = '';
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }
      totalRow.commit();
      rowsWritten += 1;
    }

    this.cleanUnusedTemplateRows(worksheet, templateRowIndex, rowsWritten, 45);

    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }

  /**
   * Render Form X on loaded official template sheet
   */
  static renderFormX(worksheet, employees = [], leaves = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    if (!worksheet) return;

    const meta = DataMapper.mapMetadata(employees, selectedMonth);
    const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3);

    worksheet.getCell('D4').value = [meta.companyName, meta.companyAddress].filter(Boolean).join(', ');
    worksheet.getCell('D5').value = meta.employerName || '';
    worksheet.getCell('D6').value = meta.managerName || '';
    worksheet.getCell('D7').value = meta.regNo || '';
    worksheet.getCell('A8').value = `For the month of ${monthLabel} | Total: ${meta.totalEmployees} (Male: ${meta.maleCount}, Female: ${meta.femaleCount})`;

    // Row 9-10 are headers, Row 11 is column numbers
    // Employee records start at Row 12
    const templateRowIndex = 12;

    employees.forEach((emp, idx) => {
      const targetRowIndex = templateRowIndex + idx;
      const targetRow = worksheet.getRow(targetRowIndex);

      // Filter ONLY approved leaves for this employee in the selected month
      const empLeaves = leaves.filter(l => {
        if (!DataMapper.matchesEmp(l, emp)) return false;
        const status = String(l.status || '').toLowerCase().trim();
        if (status !== 'approved' && status !== 'accepted') return false;
        const sDate = String(l.startDate || l.start_date || '');
        const eDate = String(l.endDate || l.end_date || '');
        return sDate.startsWith(selectedMonth) || eDate.startsWith(selectedMonth);
      });

      let elCount = 0;
      let mlCount = 0;
      let clCount = 0;

      empLeaves.forEach(l => {
        const type = String(l.type || '').toUpperCase();
        let days = Number(l.totalDays || l.total_days || 0);
        if (days <= 0 && l.startDate && l.endDate) {
          const d1 = new Date(l.startDate);
          const d2 = new Date(l.endDate);
          const diffTime = Math.abs(d2 - d1);
          days = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);
        }
        if (days <= 0) days = 1;

        if (type.includes('EARNED') || type === 'EL') {
          // If elDays is explicitly tracked in DB, use actual approved EL days (so LOP days are not counted)
          const actualEl = (l.elDays !== undefined && l.elDays !== null) ? Number(l.elDays) : days;
          elCount += actualEl;
        } else if (type.includes('MED') || type === 'ML') {
          mlCount += days;
        } else {
          clCount += days;
        }
      });

      const allowed = Number(emp.allowed_leaves || emp.allowedLeaves || 15);
      const openingRaw = emp.opening_leave_balance !== undefined && emp.opening_leave_balance !== null
        ? emp.opening_leave_balance
        : (emp.openingLeaveBalance !== undefined && emp.openingLeaveBalance !== null
          ? emp.openingLeaveBalance
          : (emp.earned_leaves !== undefined && emp.earned_leaves !== null
            ? emp.earned_leaves
            : (emp.earnedLeaves !== undefined && emp.earnedLeaves !== null
              ? emp.earnedLeaves
              : null)));
      const openingEarned = (openingRaw !== null && !isNaN(Number(openingRaw))) ? Math.max(0, Number(openingRaw)) : 0;
      const openingMedical = Number(emp.medical_leaves || emp.medicalLeaves || 0);
      const openingCasual = Number(emp.casual_leaves || emp.casualLeaves || 0);

      // Col 1: Serial Number
      targetRow.getCell(1).value = idx + 1;
      // Col 2: Name of the employee
      targetRow.getCell(2).value = emp.name || emp.fullName || '';
      // Col 3: Employee Identification No.
      targetRow.getCell(3).value = emp.empCode || emp.emp_code || emp.employeeId || emp.code || '';
      // Col 4-7: Earned Leave
      targetRow.getCell(4).value = openingEarned;
      targetRow.getCell(5).value = 1;
      targetRow.getCell(6).value = elCount;
      targetRow.getCell(7).value = { formula: `+D${targetRowIndex}+E${targetRowIndex}-F${targetRowIndex}` };
      // Col 8-10: Medical Leave
      targetRow.getCell(8).value = openingMedical;
      targetRow.getCell(9).value = mlCount;
      targetRow.getCell(10).value = { formula: `+H${targetRowIndex}-I${targetRowIndex}` };
      // Col 11-13: Other Leave
      targetRow.getCell(11).value = openingCasual;
      targetRow.getCell(12).value = clCount;
      targetRow.getCell(13).value = { formula: `+K${targetRowIndex}-L${targetRowIndex}` };
      // Col 14-15: Maternity Benefits
      targetRow.getCell(14).value = 'NA';
      targetRow.getCell(15).value = 'NA';
      // Col 16: Status
      targetRow.getCell(16).value = emp.status || 'ACTIVE';

      for (let c = 1; c <= 16; c++) {
        const cell = targetRow.getCell(c);
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        cell.font = { name: 'Calibri', size: 9 };
        if (c === 2) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }

      targetRow.commit();
    });

    this.cleanUnusedTemplateRows(worksheet, templateRowIndex, employees.length, 25);

    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }

  /**
   * Render Form T on loaded official template sheet (Multi-Employee with Keka-style spacing & dynamic live sync)
   */
  static renderFormT(worksheet, employees = [], payslips = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    if (!worksheet) return;

    // One wage slip per employee paid in this run
    const activeEmployees = (employees || []).filter(e => e && DataMapper.findRunItem(payslips, e));
    if (!activeEmployees.length) return;

    const meta = DataMapper.mapMetadata(activeEmployees, selectedMonth);
    const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3);
    const daysInMonth = AttendanceColumnGenerator.getDaysInMonth(selectedMonth);

    const CARD_ROWS = 18;
    const SPACER_ROWS = 2;
    const BLOCK_SIZE = CARD_ROWS + SPACER_ROWS;

    // Unmerge C13:J13 on the loaded template sheet and split into C13:F13 (VPF label) & G13:J13 (VPF amount)
    try {
      worksheet.unMergeCells('C13:J13');
    } catch (e) {}
    try {
      worksheet.mergeCells('C13:F13');
      worksheet.mergeCells('G13:J13');
    } catch (e) {}
    worksheet.getCell('C13').value = 'VPF Employee';

    // Merge coordinates relative to top of each 18-row card block [r1, c1, r2, c2]
    const MERGE_OFFSETS = [
      [1, 1, 1, 10],   // A1:J1 (Form T Header)
      [2, 1, 2, 10],   // A2:J2 (Wage Slip/Leave Card)
      [3, 1, 3, 10],   // A3:J3 ([See sub-rule (6) of Rule 11])
      [4, 1, 4, 2],    // A4:B4 (1. Name and address label)
      [4, 3, 4, 10],   // C4:J4 (Establishment details)
      [5, 1, 5, 2],    // A5:B5 (2. Name of person employed label)
      [5, 3, 5, 10],   // C5:J5 (Employee Name)
      [6, 1, 6, 2],    // A6:B6 (3. Father/Husband's Name label)
      [6, 3, 6, 10],   // C6:J6 (Father / Spouse Name)
      [7, 1, 7, 2],    // A7:B7 (4. Designation label)
      [7, 3, 7, 10],   // C7:J7 (Designation)
      [8, 1, 8, 2],    // A8:B8 (5. Date of entry into service label)
      [8, 3, 8, 10],   // C8:J8 (Date of Joining)
      [9, 1, 9, 2],    // A9:B9 (6. Wage period label)
      [9, 3, 9, 6],    // C9:F9 (From: 01 Month)
      [9, 7, 9, 10],   // G9:J9 (To: 31 Month)
      [10, 1, 10, 2],  // A10:B10 (7. Earnings label)
      [10, 3, 10, 10], // C10:J10 (Deductions label)
      [11, 3, 11, 6],  // C11:F11 (PF Employee label)
      [11, 7, 11, 10], // G11:J11 (PF Amount)
      [12, 3, 12, 6],  // C12:F12 (Professional Tax label)
      [12, 7, 12, 10], // G12:J12 (PT Amount)
      [13, 3, 13, 6],  // C13:F13 (VPF Employee label)
      [13, 7, 13, 10], // G13:J13 (VPF Amount)
      [14, 3, 14, 6],  // C14:F14 (Net Amount Paid label)
      [14, 7, 14, 10], // G14:J14 (Net Amount)
      [15, 1, 15, 2],  // A15:B15 (Leave Availed label)
      [16, 1, 16, 2],  // A16:B16 (Leave Credit label)
      [17, 1, 17, 2],  // A17:B17 (Signature Employer label)
      [17, 3, 17, 10]  // C17:J17 (Signature Employee label)
    ];

    activeEmployees.forEach((emp, idx) => {
      const startRow = 1 + idx * BLOCK_SIZE;

      // For idx > 0, clone formatting, cell labels, borders, and merges from template block (rows 1..18)
      if (idx > 0) {
        for (let r = 1; r <= CARD_ROWS; r++) {
          const srcRow = worksheet.getRow(r);
          const destRow = worksheet.getRow(startRow + r - 1);
          if (srcRow.height) destRow.height = srcRow.height;

          for (let c = 1; c <= 10; c++) {
            const srcCell = srcRow.getCell(c);
            const destCell = destRow.getCell(c);
            destCell.value = srcCell.value;

            if (srcCell.font) destCell.font = JSON.parse(JSON.stringify(srcCell.font));
            if (srcCell.fill) destCell.fill = JSON.parse(JSON.stringify(srcCell.fill));
            if (srcCell.border) destCell.border = JSON.parse(JSON.stringify(srcCell.border));
            if (srcCell.alignment) destCell.alignment = JSON.parse(JSON.stringify(srcCell.alignment));
            if (srcCell.numFmt) destCell.numFmt = srcCell.numFmt;
          }
        }

        // Clone Merges with row offset
        MERGE_OFFSETS.forEach(([r1, c1, r2, c2]) => {
          const rowOffset = idx * BLOCK_SIZE;
          worksheet.mergeCells(r1 + rowOffset, c1, r2 + rowOffset, c2);
        });

        // Insert subtle Keka-style spacer divider band
        const spacerRow1 = worksheet.getRow(startRow - 2);
        const spacerRow2 = worksheet.getRow(startRow - 1);
        spacerRow1.height = 14;
        spacerRow2.height = 14;
        for (let c = 1; c <= 10; c++) {
          spacerRow1.getCell(c).value = '';
          spacerRow2.getCell(c).value = '';
          spacerRow1.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          spacerRow2.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        }
      }

      // Wage figures exactly as stored by payroll (the same numbers the payslip prints)
      const f = DataMapper.mapPayrollFigures(DataMapper.findRunItem(payslips, emp), emp, selectedMonth);
      const basic = f.earnedBasic;
      const hra = f.earnedHra;
      const allowances = f.earnedOther;
      const gross = f.earnedGross;
      const pf = f.pfEe;
      const pt = f.pt;
      const vpf = f.vpfEe;
      const otherDeductions = f.esiEe + f.tds + f.otherDed;
      const net = f.net;

      // Establishment & Employee Header Details
      worksheet.getCell(`C${startRow + 3}`).value = [meta.companyName, meta.companyAddress].filter(Boolean).join(', ');
      worksheet.getCell(`C${startRow + 4}`).value = `${emp.name || ''} (${emp.empCode || emp.emp_code || ''})`;
      worksheet.getCell(`C${startRow + 5}`).value = emp.fatherName || emp.father_name || emp.spouseName || 'N/A';
      worksheet.getCell(`C${startRow + 6}`).value = emp.jobTitle || emp.job_title || emp.designation || 'Staff';
      worksheet.getCell(`C${startRow + 7}`).value = emp.joiningDate || emp.joining_date || emp.doj || '01-01-2026';
      worksheet.getCell(`C${startRow + 8}`).value = `From: 01 ${monthLabel}`;
      worksheet.getCell(`G${startRow + 8}`).value = `To: ${daysInMonth} ${monthLabel}`;

      // Earnings Column (Col B)
      worksheet.getCell(`B${startRow + 10}`).value = basic > 0 ? basic : 0;
      worksheet.getCell(`B${startRow + 11}`).value = hra > 0 ? hra : 0;
      worksheet.getCell(`B${startRow + 12}`).value = allowances > 0 ? allowances : 0;
      worksheet.getCell(`B${startRow + 13}`).value = { formula: `B${startRow + 10}+B${startRow + 11}+B${startRow + 12}`, result: gross };

      // Deductions & Net Pay Column (Col G)
      worksheet.getCell(`C${startRow + 10}`).value = 'PF Employee';
      worksheet.getCell(`G${startRow + 10}`).value = pf > 0 ? pf : 0;
      worksheet.getCell(`C${startRow + 11}`).value = 'Professional Tax';
      worksheet.getCell(`G${startRow + 11}`).value = pt > 0 ? pt : 0;
      worksheet.getCell(`C${startRow + 12}`).value = 'VPF Employee';
      worksheet.getCell(`G${startRow + 12}`).value = vpf > 0 ? vpf : 0;
      worksheet.getCell(`G${startRow + 13}`).value = { formula: `MAX(0,B${startRow + 13}-SUM(G${startRow + 10}:G${startRow + 12}))`, result: net };
    });

    worksheet.pageSetup = {
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }
}
