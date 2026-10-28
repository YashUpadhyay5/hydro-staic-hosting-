import { AttendanceColumnGenerator } from './AttendanceColumnGenerator.js';

export class DataMapper {
  /**
   * Universal entity matcher across DB tables
   */
  static matchesEmp(record, emp) {
    if (!record || !emp) return false;
    const rUser = String(record.userId || record.user_id || record.userName || record.user_name || record.employeeId || record.employee_id || '').trim().toLowerCase();
    const rName = String(record.userName || record.user_name || record.name || record.fullName || '').trim().toLowerCase();

    const empId = String(emp.id || '').trim().toLowerCase();
    const empCode = String(emp.empCode || emp.emp_code || emp.employeeId || emp.employee_id || emp.code || '').trim().toLowerCase();
    const empName = String(emp.name || emp.fullName || '').trim().toLowerCase();

    if (!rUser && !rName) return false;

    return (
      (empId && (rUser === empId || rName === empId)) ||
      (empCode && (rUser === empCode || rName === empCode)) ||
      (empName && (rName === empName || rUser === empName)) ||
      (empName && rName && (rName.includes(empName) || empName.includes(rName))) ||
      (empName && rUser && (rUser.includes(empName) || empName.includes(rUser)))
    );
  }

  /**
   * Strictly formats dates as DD/MM/YYYY for statutory compliance excel sheets
   */
  static formatDate(val) {
    if (!val) return '';
    const str = String(val).trim();
    if (!str || str === '-' || str === '—' || str === 'N/A') return str;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;

    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
    }

    const dmyMatch = str.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
    if (dmyMatch) {
      return `${dmyMatch[1].padStart(2, '0')}/${dmyMatch[2].padStart(2, '0')}/${dmyMatch[3]}`;
    }

    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }

    return str;
  }

  /**
   * Map DB data into template metadata placeholders dynamically
   */
  static mapMetadata(employees = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    const emp0 = employees[0] || {};
    const companyName = emp0.legalEntity || emp0.legal_entity || emp0.companyName || 'Hydromaterials Pvt Ltd';
    const companyAddress = emp0.location || emp0.address || '34, Third Floor, Block-2, SIDCO Electronic Complex, Guindy Industrial Estate, Chennai Tamil Nadu 600032';

    const adminEmp = employees.find(e => String(e.role || '').toUpperCase() === 'ADMIN');
    const employerName = adminEmp?.name || emp0.reportingManager || emp0.reporting_manager || 'Director';
    const managerName = adminEmp?.name || emp0.reportingManager || emp0.reporting_manager || 'Managing Director';
    const currentYear = new Date().getFullYear();
    const regNo = emp0.legalEntity ? `REG-${String(emp0.legalEntity).toUpperCase().replace(/\s+/g, '')}-${currentYear}` : `REG-HMPL-${currentYear}`;

    const maleCount = employees.filter(e => {
      const g = String(e.gender || '').trim().toLowerCase();
      return g === 'male' || g === 'm';
    }).length;
    const femaleCount = employees.filter(e => {
      const g = String(e.gender || '').trim().toLowerCase();
      return g === 'female' || g === 'f';
    }).length;
    const totalEmployees = employees.length;

    // Dynamic payment date (last day of selectedMonth in DD/MM/YYYY)
    let paymentDate = '';
    try {
      const [y, m] = selectedMonth.split('-');
      const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0);
      const dd = String(lastDay.getDate()).padStart(2, '0');
      const mm = String(lastDay.getMonth() + 1).padStart(2, '0');
      const yyyy = lastDay.getFullYear();
      paymentDate = `${dd}/${mm}/${yyyy}`;
    } catch (e) {
      const now = new Date();
      paymentDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    }

    return {
      companyName,
      companyAddress,
      employerName,
      managerName,
      regNo,
      totalEmployees,
      maleCount,
      femaleCount,
      paymentDate
    };
  }

  /**
   * Calculate statutory Form U dates:
   * 1. Date on which completion of 480 days of service = DOJ + 480 days (N/A if future)
   * 2. Date on which made permanent = DOJ + 6 months (N/A if future)
   */
  static calculateFormUDates(joiningDate, refDate = new Date()) {
    if (!joiningDate) {
      return { date480Days: 'N/A', datePermanent: 'N/A' };
    }

    const d1 = new Date(joiningDate);
    if (isNaN(d1.getTime())) {
      return { date480Days: 'N/A', datePermanent: 'N/A' };
    }

    // 1. Completion of 480 days of service: Date of entry into service + 480 days
    const d480 = new Date(d1);
    d480.setDate(d480.getDate() + 480);
    const date480Days = d480 <= refDate ? this.formatDate(d480) : 'N/A';

    // 2. Date on which made permanent: Date of entry into service + 6 months
    const dPerm = new Date(d1);
    dPerm.setMonth(dPerm.getMonth() + 6);
    const datePermanent = dPerm <= refDate ? this.formatDate(dPerm) : 'N/A';

    return { date480Days, datePermanent };
  }

  /**
   * Map DB employee records to Form U row array (15+ columns matching statutory layout)
   */
  static mapFormURows(employees = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    const refDate = new Date();

    return employees.map((emp, idx) => {
      let custom = {};
      try {
        if (typeof emp.custom_fields === 'string') custom = JSON.parse(emp.custom_fields);
        else if (typeof emp.custom_fields === 'object') custom = emp.custom_fields || {};
      } catch (e) {}

      const name = emp.name || emp.fullName || `Employee ${idx + 1}`;
      const code = emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id || `EMP${String(idx + 1).padStart(3, '0')}`;
      const gender = emp.gender || 'Male';
      const father = emp.fatherName || emp.father_name || emp.spouseName || custom.fatherName || custom.spouseName || '-';
      const dob = this.formatDate(emp.dob || emp.dateOfBirth || '1995-05-15');
      const rawDoj = emp.joiningDate || emp.joining_date || emp.doj;
      const doj = rawDoj ? this.formatDate(rawDoj) : '-';
      const { date480Days, datePermanent } = this.calculateFormUDates(rawDoj, refDate);
      const designation = emp.jobTitle || emp.job_title || emp.designation || emp.role || 'Staff';
      const address = emp.presentAddress || emp.present_address || emp.address || emp.location || '-';
      const permAddress = emp.permanentAddress || emp.permanent_address || address;

      const uan = emp.uan_number || emp.uanNumber || custom.uanNumber || custom.pfUan || '-';
      const pf = emp.pf_number || emp.pfNumber || custom.pf_number || custom.pfNumber || uan;
      const esic = emp.esi_number || emp.esiNumber || emp.esic_number || emp.esicNumber || custom.esiNumber || custom.esicNumber || '-';
      const aadhar = emp.aadhaar || emp.aadhaar_number || custom.aadhaar || custom.aadhar;
      const pan = emp.pan_number || emp.panNumber || custom.panNumber || custom.pan || '-';
      const bankDetails = [
        emp.bank_account_no || emp.bankAccountNo,
        emp.bank_name || emp.bankName,
        emp.bank_ifsc_code || emp.bankIfscCode
      ].filter(Boolean).join(', ') || '-';
      const phone = emp.phone_no || emp.phoneNo || emp.mobile || '-';
      const email = emp.email || '-';

      return [
        idx + 1,          // Col 1: Serial Number
        name,             // Col 2: Name of the employee
        code,             // Col 3: Employee Identification No.
        gender,           // Col 4: Gender
        father,           // Col 5: Father / Spouse Name
        dob,              // Col 6: Date of Birth
        doj,              // Col 7: Date of entry into service
        designation,      // Col 8: Designation
        address,          // Col 9: Present Address
        permAddress,      // Col 10: Permanent Address
        pf,               // Col 11: Employee's Provident Fund No.
        esic,             // Col 12: Employee's State Insurance Corporation No.
        aadhar || pan,    // Col 13: Aadhaar No.
        date480Days,      // Col 14: Date on which completion of 480 days of service
        datePermanent,    // Col 15: Date on which made permanent
        '-',              // Col 16: Period of Suspension if any
        bankDetails,      // Col 17: Bank A/c Number, Name of Bank, Branch (IFSC Code)
        '-',              // Col 18: Photo
        phone,            // Col 19: Mobile Number
        email,            // Col 20: e-mail I.D
        '-',              // Col 21: Specimen Signature / Thump Impression
        '-',              // Col 22: Date of Exit
        '-',              // Col 23: Reason for Exit
        'Active'          // Col 24: Remarks
      ];
    });
  }

  /**
   * Map DB employee records to Form S row array (16 columns matching statutory layout)
   */
  static mapFormSRows(employees = []) {
    return employees.map((emp, idx) => {
      let custom = {};
      try {
        if (typeof emp.custom_fields === 'string') custom = JSON.parse(emp.custom_fields);
        else if (typeof emp.custom_fields === 'object') custom = emp.custom_fields || {};
      } catch (e) {}

      const name = emp.name || emp.fullName || `Employee ${idx + 1}`;
      const code = emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id || `EMP${String(idx + 1).padStart(3, '0')}`;
      const gender = emp.gender || 'Male';
      const father = emp.fatherName || emp.father_name || emp.spouseName || custom.fatherName || custom.spouseName || '-';
      const designation = emp.jobTitle || emp.job_title || emp.designation || emp.role || 'Staff';
      const doj = this.formatDate(emp.joiningDate || emp.joining_date || emp.doj || '2023-01-10');
      const attStr = String(emp.attendance_setting || emp.attendanceSetting || '');
      const isFlexible = attStr.toLowerCase().includes('flex') || String(emp.shift || '').toLowerCase().includes('flex');
      const shift = emp.shift || (isFlexible ? 'Flexible Shift' : 'General Shift (9:00 AM - 5:30 PM)');
      const startTime = emp.startTime || '09:00 AM';
      const restInterval = '0.5 hours';
      const endTime = emp.endTime || '05:30 PM';
      const weeklyOff = emp.weeklyOffs || emp.weekly_offs || 'Sunday';
      const classOfWork = String(emp.designation || '').toUpperCase() === 'FIELD' ? 'Field Work' : 'Office Work';

      const grossComp = Number(emp.compensation_gross || emp.compensationGross || 0);
      const monthlyRate = grossComp > 0 ? (grossComp > 100000 ? Math.round(grossComp / 12) : grossComp) : 25000;
      const minRate = (emp.minRate != null && emp.minRate !== '' && !isNaN(Number(emp.minRate))) ? Number(emp.minRate) : '';

      return [
        idx + 1,
        name,
        gender,
        father,
        designation,
        code,
        doj,
        'Adult',
        shift,
        startTime,
        restInterval,
        endTime,
        weeklyOff,
        classOfWork,
        monthlyRate,
        minRate
      ];
    });
  }

  /**
   * Map DB employee records and attendance calendar for Form V Muster
   */
  static mapFormVMusterRows(employees = [], attendance = [], leaves = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    const daysCount = AttendanceColumnGenerator.getDaysInMonth(selectedMonth);
    const [year, month] = selectedMonth.split('-');

    return employees.map((emp, idx) => {
      let custom = {};
      try {
        if (typeof emp.custom_fields === 'string') custom = JSON.parse(emp.custom_fields);
        else if (typeof emp.custom_fields === 'object') custom = emp.custom_fields || {};
      } catch (e) {}

      const empPunches = attendance.filter(a => this.matchesEmp(a, emp));
      const empLeaves = leaves.filter(l => this.matchesEmp(l, emp));

      const dailySymbols = [];
      for (let day = 1; day <= daysCount; day++) {
        const dayPad = String(day).padStart(2, '0');
        const dateStr = `${year}-${month}-${dayPad}`;
        const symbol = AttendanceColumnGenerator.getAttendanceSymbol(dateStr, empPunches, empLeaves, emp.weekly_offs || emp.weeklyOffs);
        dailySymbols.push(symbol);
      }

      return {
        seq: idx + 1,
        name: emp.name || emp.fullName || `Employee ${idx + 1}`,
        fatherSpouse: emp.fatherName || emp.father_name || emp.spouseName || custom.fatherName || custom.spouseName || '-',
        gender: emp.gender || 'Male',
        doj: this.formatDate(emp.joiningDate || emp.joining_date || emp.doj || '2023-01-10'),
        designation: emp.jobTitle || emp.job_title || emp.designation || 'Staff',
        dailySymbols
      };
    });
  }

  /**
   * Finds an employee's stored payroll item: exact employee id, else the employee code
   * (no fuzzy name matching - a wrong match would print someone else's wages).
   */
  static findRunItem(items = [], emp) {
    const usable = (items || []).filter(it => it && it.status !== 'SKIPPED_EXIT');
    const empId = String(emp.id || '').trim().toLowerCase();
    const empCode = String(emp.empCode || emp.emp_code || '').trim().toLowerCase();
    const itemEmpId = (it) => String(it.employeeId ?? it.employee_id ?? '').trim().toLowerCase();
    return usable.find(it => empId && itemEmpId(it) === empId)
      || usable.find(it => empCode && itemEmpId(it) === empCode)
      || null;
  }

  /**
   * Reads every wage figure for Form W / Form T from a stored payroll item.
   * Items hold the server-side PayCalculator result - the same figures the pay run wizard
   * previewed and the payslip prints - so nothing is recalculated here. Only the monthly
   * "rate of wages" columns come from the employee profile.
   */
  static mapPayrollFigures(item, emp, selectedMonth) {
    const parse = (v) => {
      if (!v) return {};
      if (typeof v === 'string') {
        try { return JSON.parse(v) || {}; } catch (e) { return {}; }
      }
      return v;
    };
    const num = (v) => Number(v) || 0;
    const pick = (obj, ...keys) => {
      for (const k of keys) {
        if (obj[k] != null) return num(obj[k]);
      }
      return 0;
    };
    const earnings = parse(item.earningsBreakdown ?? item.earnings_breakdown);
    const deductions = parse(item.deductionsBreakdown ?? item.deductions_breakdown);

    const [yrStr, moStr] = (selectedMonth || '').split('-');
    const calendarDays = new Date(parseInt(yrStr, 10), parseInt(moStr, 10), 0).getDate() || 30;
    const workingDays = num(item.workingDays ?? item.working_days) || calendarDays;
    const daysWorked = (item.workedDays ?? item.worked_days) != null
      ? num(item.workedDays ?? item.worked_days)
      : Math.max(0, workingDays - num(item.lopDays ?? item.lop_days));

    const rawGross = num(emp.compensationGross || emp.compensation_gross || emp.ctc || emp.salary);
    const rateGross = rawGross > 0 ? (rawGross > 100000 ? Math.round(rawGross / 12) : rawGross) : 0;
    const rateBasic = Math.round(rateGross * 0.50);
    const rateHra = Math.round(rateGross * 0.30);
    const rateOther = Math.max(0, rateGross - rateBasic - rateHra);

    const earnedBasic = pick(earnings, 'BASIC', 'basic');
    const earnedHra = pick(earnings, 'HRA', 'hra');
    const adhocPayment = pick(earnings, 'ADHOC_PAYMENT', 'adhoc_payment', 'adhocPayment') || pick(item, 'adhocPay', 'adhocPayment');
    const adhocDeduction = pick(deductions, 'ADHOC_DEDUCTION', 'adhoc_deduction', 'adhocDeduction') || pick(item, 'adhocDed', 'adhocDeduction');
    const extraEarnings = pick(earnings, 'BONUS') + pick(earnings, 'ARREARS') + pick(earnings, 'OVERTIME');
    // "Other" carries bonus / arrears / overtime (adhocPayment and adhocDeduction have their own sub-columns now)
    const earnedOther = pick(earnings, 'SPECIAL_ALLOWANCE', 'OTHER_ALLOWANCE', 'special', 'other') + extraEarnings;
    const earnedGross = Math.max(0, earnedBasic + earnedHra + earnedOther + adhocPayment - adhocDeduction);

    const pfEe = pick(deductions, 'EPF_EE', 'PF_EE', 'pf_ee');
    const vpfEe = pick(deductions, 'VPF_EE', 'VPF', 'vpf_ee');
    const esiEe = pick(deductions, 'ESI_EE', 'ESI', 'esi_ee');
    const pt = pick(deductions, 'PT', 'pt');
    const tds = pick(deductions, 'TDS', 'tds');
    const lwf = pick(deductions, 'LWF', 'LWF_EE', 'lwf');
    // Ad-hoc deduction is positioned in the Earned Gross Salary section, so it is excluded from otherDed to avoid duplicate deduction
    const otherDed = lwf
      + pick(deductions, 'LOAN_EMI', 'loan_emi')
      + pick(deductions, 'OTHER', 'LWP', 'other');
    const totalDed = pfEe + vpfEe + esiEe + pt + tds + otherDed;

    return {
      workingDays,
      daysWorked,
      rateBasic,
      rateHra,
      rateOther,
      rateGross,
      earnedBasic,
      earnedHra,
      earnedOther,
      adhocPayment,
      adhocDeduction,
      earnedGross,
      // Employer contributions are shown on Form W only; they are never deducted from the employee
      pfEr: pfEe,
      pfEe,
      vpfEe,
      esiEe,
      esiEr: esiEe > 0 ? Math.ceil(earnedGross * 0.0325) : 0,
      pt,
      tds,
      otherDed,
      totalDed,
      // Net wages exclude reimbursements, which are not wages
      net: Math.max(0, earnedGross - totalDed)
    };
  }

  /**
   * Map DB employee records to Form W row array strictly from payroll run records
   */
  static mapFormWRows(employees = [], attendance = [], payslips = [], selectedMonth = new Date().toISOString().slice(0, 7)) {
    const [yrStr, moStr] = (selectedMonth || '').split('-');
    const year = parseInt(yrStr, 10) || new Date().getFullYear();
    const monthNum = parseInt(moStr, 10) || (new Date().getMonth() + 1);
    const lastDay = new Date(year, monthNum, 0);
    const dynamicPaymentDate = `${String(lastDay.getDate()).padStart(2, '0')}/${String(monthNum).padStart(2, '0')}/${year}`;

    // Form W strictly requires processed pay run items
    const hasRunData = Array.isArray(payslips) && payslips.some(it => it && (it.grossEarned != null || it.gross_earned != null));
    if (!hasRunData) {
      return [];
    }

    const rows = [];
    employees.forEach((emp) => {
      const item = this.findRunItem(payslips, emp);
      if (!item) return;
      const f = this.mapPayrollFigures(item, emp, selectedMonth);

      rows.push([
        rows.length + 1,
        emp.name || emp.fullName || item.employeeName || `Employee ${rows.length + 1}`,
        emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id,
        f.workingDays,
        f.daysWorked,
        f.rateBasic,
        f.rateHra,
        f.rateOther,
        f.rateGross,
        f.earnedBasic,
        f.earnedHra,
        f.earnedOther,
        f.adhocPayment,
        f.adhocDeduction,
        f.earnedGross,
        f.pfEr,
        f.pfEe,
        f.vpfEe,
        f.esiEe,
        f.esiEr,
        f.pt,
        f.tds,
        f.otherDed,
        f.totalDed,
        f.net,
        this.formatDate(item.paymentDate || item.payment_date || dynamicPaymentDate)
      ]);
    });
    return rows;
  }
}
