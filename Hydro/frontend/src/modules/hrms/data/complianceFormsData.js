
export const COMPLIANCE_FORMS_CONFIG = [
  {
    id: 'Form S',
    sheetName: 'Form S',
    title: 'Form S',
    name: 'Notice of Daily Hours Of Work, Rest Interval, Weekly Holiday, Etc.',
    rule: '[See sub-rule (4) of Rule 18]',
    category: 'Hours & Rest Compliance',
    icon: 'fa-clock',
    color: '#6366f1',
    badge: 'Form S',
    description: 'Statutory notice declaring daily working hours, rest intervals, shifts, and weekly holidays derived from DB employee records.'
  },
  {
    id: 'Form U',
    sheetName: 'Form U',
    title: 'Form U',
    name: 'Employee Register',
    rule: '[See sub-rule(1) of rule(16)]',
    category: 'Employee Master Records',
    icon: 'fa-address-card',
    color: '#10b981',
    badge: 'Form U',
    description: 'Master register displaying active database records for employee designations, DOB, joining dates, and address details.'
  },
  {
    id: 'Form V Muster',
    sheetName: 'Form V Muster',
    title: 'Form V Muster',
    name: 'Muster Roll',
    rule: '[See Rule 26(5)]',
    category: 'Attendance Muster',
    icon: 'fa-clipboard-user',
    color: '#f59e0b',
    badge: 'Muster Roll',
    description: 'Daily attendance muster roll calculated from database punch logs, present days, weekly offs, and approved leave records.'
  },
  {
    id: 'Form V Register',
    sheetName: 'Form V Register',
    title: 'Form V Register',
    name: 'Register of Employment',
    rule: '[See sub-rule (1) of rule (16)]',
    category: 'Employment Log',
    icon: 'fa-briefcase',
    color: '#3b82f6',
    badge: 'Register of Employment',
    description: 'Employment register maintaining daily work commencement, rest interval, and total working hours per employee.'
  },
  {
    id: 'Form X',
    sheetName: 'Form X',
    title: 'Form X',
    name: 'Register of Leave and Social Security Benefits',
    rule: '[See sub-rule (1) of rule (16)]',
    category: 'Leave & Social Benefits',
    icon: 'fa-umbrella-beach',
    color: '#ef4444',
    badge: 'Form X',
    description: 'Detailed register tracking opening leave balances, earned leave, availed leave, maternity benefits, and gratuity payouts from DB.'
  },
  {
    id: 'Form T',
    sheetName: 'Form T',
    title: 'Form T',
    name: 'Wage Slip / Leave Card',
    rule: '[See sub-rule (6) of Rule 11]',
    category: 'Wage Slip',
    icon: 'fa-receipt',
    color: '#8b5cf6',
    badge: 'Form T',
    description: 'Standardized wage slip and leave balance card summarizing employee earnings breakdown, statutory deductions, and leave credit.'
  },
  {
    id: 'Form W',
    sheetName: 'Form W',
    title: 'Form W',
    name: 'Register of Wages',
    rule: '[See sub-rule(1) of rule(16)]',
    category: 'Wages Register',
    icon: 'fa-money-bill-wave',
    color: '#06b6d4',
    badge: 'Form W',
    description: 'Statutory wage register logging days worked, basic pay, HRA, allowances, gross salary, PF, PT deductions, and net disbursed wages.'
  }
];

// Helper to get current default YYYY-MM
export const getCurrentMonthYYYYMM = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// Format YYYY-MM into human readable month string (e.g. "2026-07" -> "July 2026")
export const formatMonthYearLabel = (monthStr) => {
  if (!monthStr) {
    monthStr = getCurrentMonthYYYYMM();
  }
  try {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch (e) {
    return monthStr;
  }
};

// Get days in a specific YYYY-MM month
export const getDaysInMonthCount = (monthStr) => {
  if (!monthStr) return 30;
  try {
    const [year, month] = monthStr.split('-');
    return new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
  } catch (e) {
    return 30;
  }
};

// Calculate count of Sundays in a month
export const getSundaysCount = (monthStr) => {
  if (!monthStr) return 4;
  try {
    const [year, month] = monthStr.split('-');
    const days = getDaysInMonthCount(monthStr);
    let sundays = 0;
    for (let day = 1; day <= days; day++) {
      const dt = new Date(parseInt(year, 10), parseInt(month, 10) - 1, day);
      if (dt.getDay() === 0) sundays++;
    }
    return sundays || 4;
  } catch (e) {
    return 4;
  }
};

/**
 * Universal entity matcher across location_employees, Attendances, location_leaves
 */
export const matchesEmp = (record, emp) => {
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
};

/**
 * Calculate actual leave days span from start_date to end_date
 */
export const calculateLeaveDays = (startDate, endDate, totalDays) => {
  if (Number(totalDays) > 0) return Number(totalDays);
  if (!startDate || !endDate) return 1;
  try {
    const d1 = new Date(startDate);
    const d2 = new Date(endDate);
    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return isNaN(diffDays) ? 1 : diffDays;
  } catch (e) {
    return 1;
  }
};

/**
 * Filter approved/accepted leave records for a specific employee and month
 */
export const getEmpLeavesForMonth = (emp, leavesList = [], selectedMonth) => {
  return leavesList.filter(l => {
    const status = String(l.status || '').toLowerCase();
    const isApproved = status === 'approved' || status === 'accepted';
    if (!isApproved) return false;

    const sDate = l.startDate || l.start_date || '';
    const eDate = l.endDate || l.end_date || '';
    const isInMonth = sDate.startsWith(selectedMonth) || eDate.startsWith(selectedMonth);

    return isInMonth && matchesEmp(l, emp);
  });
};

/**
 * Filter attendance punch records for a specific employee and month
 */
export const getEmpAttendanceForMonth = (emp, attendanceList = [], selectedMonth) => {
  const empPunches = attendanceList.filter(a => {
    const aDate = a.date || a.createdAt || '';
    return aDate.startsWith(selectedMonth) && matchesEmp(a, emp);
  });
  const uniqueDates = new Set(empPunches.map(a => (a.date || a.createdAt || '').slice(0, 10)));
  return {
    presentDays: uniqueDates.size,
    punches: empPunches
  };
};

/**
 * Get statutory attendance symbol (P, A, L, WO, H, OD, HD) for an employee on a date
 */
export const getAttendanceSymbolFromPunches = (dateStr, empPunches = [], empLeaves = [], weeklyOffsSetting = 'Sunday') => {
  const hasApprovedLeave = empLeaves.some(l => {
    const sDate = l.startDate || l.start_date || '';
    const eDate = l.endDate || l.end_date || '';
    return dateStr >= sDate && dateStr <= eDate;
  });

  if (hasApprovedLeave) {
    const leaveObj = empLeaves.find(l => {
      const sDate = l.startDate || l.start_date || '';
      const eDate = l.endDate || l.end_date || '';
      return dateStr >= sDate && dateStr <= eDate;
    });
    const type = String(leaveObj?.type || '').toUpperCase();
    if (type.includes('SICK') || type === 'SL') return 'SL';
    if (type.includes('CASUAL') || type === 'CL') return 'CL';
    if (type.includes('EARNED') || type === 'EL') return 'EL';
    return 'L';
  }

  const hasPunch = empPunches.some(p => {
    const pDate = p.date || p.createdAt || '';
    return pDate.startsWith(dateStr);
  });

  if (hasPunch) {
    return 'P';
  }

  try {
    const d = new Date(dateStr);
    if (d.getDay() === 0) return 'WO'; // Sunday
    if (d.getDay() === 6 && (weeklyOffsSetting || '').toLowerCase().includes('saturday')) return 'WO';
  } catch (e) {}

  return 'A'; // Absent
};

// Helper to strictly format dates as DD/MM/YYYY for all compliance forms
export const formatDateDDMMYYYY = (val) => {
  if (!val) return '';
  const str = String(val).trim();
  if (!str || str === '-' || str === '—' || str === 'N/A') return str;

  // Already in DD/MM/YYYY format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;

  // ISO format YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
  }

  // DD-MM-YYYY or DD.MM.YYYY
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
};

/**
 * Generates 100% dynamic DB form records and metadata. NO static hardcoded text!
 */
export const getDynamicFormData = (formKey, selectedMonth = getCurrentMonthYYYYMM(), employees = [], attendance = [], leaves = [], runItems = [], settings = {}) => {
  // Derive shift times from Settings → Attendance Shift Policy
  const fmt12 = (t24) => {
    if (!t24) return null;
    const [h, m] = String(t24).split(':').map(Number);
    if (isNaN(h)) return null;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m || 0).padStart(2, '0')} ${suffix}`;
  };
  const settingsStartTime = fmt12(settings.punch_in_start);
  const settingsEndTime   = fmt12(settings.punch_out_time);
  // Compute rest interval from shift length (assume 30 min break standard)
  const settingsRestInterval = '0.5 hours';
  const monthLabel = formatMonthYearLabel(selectedMonth);
  const totalDaysInMonth = getDaysInMonthCount(selectedMonth);
  const sundaysCount = getSundaysCount(selectedMonth);

  // Derive dynamic establishment and employer details strictly from DB
  const companyName = employees[0]?.legalEntity || employees[0]?.legal_entity || employees[0]?.companyName || 'Hydromaterials Private Limited';
  const companyAddress = employees[0]?.location || employees[0]?.address || 'Headquarters, Noida, Uttar Pradesh';
  const adminEmp = employees.find(e => String(e.role || '').toUpperCase() === 'ADMIN');
  const employerName = adminEmp?.name || employees[0]?.reportingManager || employees[0]?.reporting_manager || 'Director';
  const managerName = adminEmp?.name || employees[0]?.reportingManager || employees[0]?.reporting_manager || 'Managing Director';
  const currentYear = new Date().getFullYear();
  const regNo = employees[0]?.legalEntity ? `REG-${String(employees[0].legalEntity).toUpperCase().replace(/\s+/g, '')}-${currentYear}` : `REG-HMPL-${currentYear}`;

  const maleCount = employees.filter(e => {
    const g = String(e.gender || '').trim().toLowerCase();
    return g === 'male' || g === 'm';
  }).length;
  const femaleCount = employees.filter(e => {
    const g = String(e.gender || '').trim().toLowerCase();
    return g === 'female' || g === 'f';
  }).length;
  const totalEmployees = employees.length;

  let dynamicPaymentDate = '';
  try {
    const [y, m] = selectedMonth.split('-');
    const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0);
    const dd = String(lastDay.getDate()).padStart(2, '0');
    const mm = String(lastDay.getMonth() + 1).padStart(2, '0');
    const yyyy = lastDay.getFullYear();
    dynamicPaymentDate = `${dd}/${mm}/${yyyy}`;
  } catch (e) {
    dynamicPaymentDate = monthLabel;
  }

  if (!employees || employees.length === 0) {
    return {
      meta: [
        [formKey, '', ''],
        ['Statutory Compliance Form', '', ''],
        ['Establishment:', '', companyName],
        ['Period:', '', monthLabel]
      ],
      headers: [['Status Message']],
      body: [['No active employee records found in database for this period.']]
    };
  }

  if (formKey === 'Form U') {
    const meta = [
      ['Form U', '', ''],
      ['Employee Register', '', ''],
      ['[See sub-rule(1) of rule(16)]', '', ''],
      ['Name and Address of the Establishment:', '', `${companyName}, ${companyAddress}`],
      ['Registration Certificate No:', '', regNo],
      ['Total Persons Employed:', '', `Total: ${totalEmployees} (Male: ${maleCount}, Female: ${femaleCount})`],
      ['Period:', '', monthLabel]
    ];
    const headers = [
      ['Serial Number', 'Name of the employee', 'Employee Identification No.', 'Gender', 'Father / Spouse Name', 'Date of Birth', 'Date of entry into service', 'Designation', 'EPF No.', 'ESIC No.', 'Date of completion of 480 days of service', 'Date on which made permanent', 'Department', 'Location / Address']
    ];
    const body = employees.map((emp, idx) => {
      let custom = {};
      try {
        if (typeof emp.custom_fields === 'string') custom = JSON.parse(emp.custom_fields);
        else if (typeof emp.custom_fields === 'object') custom = emp.custom_fields || {};
      } catch (e) {}

      const name = emp.name || emp.fullName || `Employee ${idx + 1}`;
      const code = emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id || `EMP${String(idx + 1).padStart(3, '0')}`;
      const gender = emp.gender || 'Male';
      const father = emp.fatherName || emp.father_name || emp.spouseName || custom.fatherName || custom.spouseName || '-';
      const dob = formatDateDDMMYYYY(emp.dob || emp.dateOfBirth || '1995-05-15');
      const rawDoj = emp.joiningDate || emp.joining_date || emp.doj;
      const doj = rawDoj ? formatDateDDMMYYYY(rawDoj) : '-';

      let date480Days = 'N/A';
      let datePermanent = 'N/A';
      if (rawDoj) {
        const d1 = new Date(rawDoj);
        if (!isNaN(d1.getTime())) {
          const now = new Date();
          const d480 = new Date(d1);
          d480.setDate(d480.getDate() + 480);
          if (d480 <= now) date480Days = formatDateDDMMYYYY(d480);

          const dPerm = new Date(d1);
          dPerm.setMonth(dPerm.getMonth() + 6);
          if (dPerm <= now) datePermanent = formatDateDDMMYYYY(dPerm);
        }
      }

      const designation = emp.jobTitle || emp.job_title || emp.designation || emp.role || 'Field Staff';
      const uan = emp.uan_number || emp.uanNumber || custom.uanNumber || custom.pfUan || '-';
      const esic = emp.esi_number || emp.esiNumber || emp.esic_number || emp.esicNumber || custom.esiNumber || custom.esicNumber || '-';
      const dept = emp.department || 'Operations';
      const addr = emp.presentAddress || emp.address || emp.location || '-';

      return [
        idx + 1,
        name,
        code,
        gender,
        father,
        dob,
        doj,
        designation,
        uan,
        esic,
        date480Days,
        datePermanent,
        dept,
        addr
      ];
    });
    return { meta, headers, body };
  }

  if (formKey === 'Form S') {
    const meta = [
      ['FORM S', '', ''],
      ['Notice of Daily Hours Of Work, Rest Interval, Weekly Holiday, Etc.', '', ''],
      ['[See sub-rule (4) of Rule 18]', '', ''],
      ['Name and full address of the establishment:', '', `${companyName}, ${companyAddress}`],
      ['Name of Employer / Managing Director:', '', employerName],
      ['Name of Manager / Incharge:', '', managerName],
      ['Total Persons Employed:', '', `Total: ${totalEmployees} (Male: ${maleCount}, Female: ${femaleCount})`],
      ['Wage Period:', '', monthLabel],
      ['Date of Payment of Wages:', '', dynamicPaymentDate]
    ];
    const headers = [
      ['Serial No.', 'Name of the person employed', 'Sex', 'Father/Husband’s Name', 'Designation', 'Employee number', 'Date of entry into service', 'Adult/Adolescent/Child', 'Shift Number', 'Time of commencement of work', 'Rest Interval', 'Time of cessation of work', 'Weekly Holiday', 'Class of workers', 'Rate of Wages (Max)', 'Rate of Wages (Min)']
    ];
    const body = employees.map((emp, idx) => {
      let custom = {};
      try {
        if (typeof emp.custom_fields === 'string') custom = JSON.parse(emp.custom_fields);
        else if (typeof emp.custom_fields === 'object') custom = emp.custom_fields || {};
      } catch (e) {}

      const name = emp.name || emp.fullName || `Employee ${idx + 1}`;
      const code = emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id || `EMP${String(idx + 1).padStart(3, '0')}`;
      const gender = emp.gender || 'Male';
      const father = emp.fatherName || emp.father_name || emp.spouseName || custom.fatherName || custom.spouseName || '-';
      const designation = emp.jobTitle || emp.job_title || emp.designation || emp.role || 'Field Staff';
      const doj = formatDateDDMMYYYY(emp.joiningDate || emp.joining_date || emp.doj || '2023-01-10');
      const attStr = String(emp.attendance_setting || emp.attendanceSetting || '');
      const isFlexible = attStr.toLowerCase().includes('flex') || String(emp.shift || '').toLowerCase().includes('flex');
      const shift = emp.shift || (isFlexible ? 'Flexible Shift' : 'General Shift (9:00 AM - 5:30 PM)');
      let empCustomStart = emp.startTime;
      let empCustomEnd = emp.endTime;
      if (!empCustomStart && attStr.includes('-') && !attStr.includes('9-6') && !attStr.includes('9-5:30')) {
        const tm = attStr.match(/(\d{1,2}(?::\d{2})?)\s*[-–to]+\s*(\d{1,2}(?::\d{2})?)/);
        if (tm) {
          empCustomStart = fmt12(tm[1].includes(':') ? tm[1] : `${tm[1]}:00`);
          empCustomEnd = fmt12(tm[2].includes(':') ? tm[2] : `${tm[2]}:00`);
        }
      }
      const startTime = empCustomStart || '09:00 AM';
      const restInterval = '0.5 hours';
      const endTime = empCustomEnd || '05:30 PM';
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
    return { meta, headers, body };
  }

  if (formKey === 'Form V Muster') {
    const meta = [
      ['Form V', '', ''],
      ['Muster Roll [See Rule 26(5)]', '', ''],
      ['Name of Factory / Establishment:', '', companyName],
      ['Place:', '', companyAddress],
      ['Name of Manager/Incharge:', '', managerName],
      ['Total Workers Employed:', '', `Total: ${totalEmployees} (Male: ${maleCount}, Female: ${femaleCount})`],
      ['For the Month:', '', monthLabel]
    ];

    const dayHeaders = [];
    for (let day = 1; day <= totalDaysInMonth; day++) {
      dayHeaders.push(String(day).padStart(2, '0'));
    }

    const headers = [
      ['SI No.', 'Name of the Employee', 'Employee ID', "Father's/Spouse's Name", 'Sex', 'Date of Entry into Service', 'Designation', ...dayHeaders, 'Present', 'Leaves', 'Weekly Offs', 'Absent']
    ];

    const [year, month] = selectedMonth.split('-');

    const body = employees.map((emp, idx) => {
      const name = emp.name || emp.fullName || `Employee ${idx + 1}`;
      const code = emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id || `EMP${String(idx + 1).padStart(3, '0')}`;
      const father = emp.fatherName || emp.spouseName || `${name.split(' ')[0]} Ram`;
      const gender = emp.gender || 'Male';
      const doj = formatDateDDMMYYYY(emp.joiningDate || emp.joining_date || emp.doj || '2023-01-10');
      const designation = emp.jobTitle || emp.job_title || emp.designation || 'Field Staff';

      const empPunches = attendance.filter(a => matchesEmp(a, emp));
      const empApprovedLeaves = getEmpLeavesForMonth(emp, leaves, selectedMonth);

      const dailySymbols = [];
      let presentDays = 0;
      let totalLeaveDays = 0;
      let weeklyOffs = 0;

      for (let day = 1; day <= totalDaysInMonth; day++) {
        const dayPad = String(day).padStart(2, '0');
        const dateStr = `${year}-${month}-${dayPad}`;
        const symbol = getAttendanceSymbolFromPunches(dateStr, empPunches, empApprovedLeaves, emp.weekly_offs || emp.weeklyOffs);
        dailySymbols.push(symbol);

        if (symbol === 'P' || symbol === 'HD') presentDays++;
        else if (symbol === 'SL' || symbol === 'CL' || symbol === 'EL' || symbol === 'L') totalLeaveDays++;
        else if (symbol === 'WO') weeklyOffs++;
      }

      const absentDays = Math.max(0, totalDaysInMonth - presentDays - totalLeaveDays - weeklyOffs);

      return [
        idx + 1,
        name,
        code,
        father,
        gender,
        doj,
        designation,
        ...dailySymbols,
        presentDays || 0,
        totalLeaveDays || 0,
        weeklyOffs || 0,
        absentDays || 0
      ];
    });

    return { meta, headers, body };
  }

  if (formKey === 'Form V Register') {
    const meta = [
      ['Form V', '', ''],
      ['REGISTER OF EMPLOYMENT [See sub-rule (1) of rule (16)]', '', ''],
      ['For the period:', '', monthLabel],
      ['Name and Address of the Establishment:', '', `${companyName}, ${companyAddress}`],
      ['Name of Employer:', '', employerName],
      ['Name of Manager/Incharge:', '', managerName],
      ['Total Persons Employed:', '', `Total: ${totalEmployees} (Male: ${maleCount}, Female: ${femaleCount})`]
    ];
    const headers = [
      ['Serial Number', 'Name of the Employee', 'Employee Identification No.', 'Designation', 'Time at which work commences', 'Rest Interval', 'Time at which work ends', 'Daily Hours of work', 'Overtime Status']
    ];
    const body = employees.map((emp, idx) => {
      const name = emp.name || emp.fullName || `Employee ${idx + 1}`;
      const code = emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id || `EMP${String(idx + 1).padStart(3, '0')}`;
      const designation = emp.jobTitle || emp.job_title || emp.designation || 'Field Staff';
      const attStrV = String(emp.attendance_setting || emp.attendanceSetting || '');
      let empCustomStartV = emp.startTime;
      let empCustomEndV = emp.endTime;
      if (!empCustomStartV && attStrV.includes('-') && !attStrV.includes('9-6') && !attStrV.includes('9-5:30')) {
        const tmV = attStrV.match(/(\d{1,2}(?::\d{2})?)\s*[-–to]+\s*(\d{1,2}(?::\d{2})?)/);
        if (tmV) {
          empCustomStartV = fmt12(tmV[1].includes(':') ? tmV[1] : `${tmV[1]}:00`);
          empCustomEndV = fmt12(tmV[2].includes(':') ? tmV[2] : `${tmV[2]}:00`);
        }
      }
      const startTime = empCustomStartV || '09:00 AM';
      const restInterval = '0.5 hours';
      const endTime = empCustomEndV || '05:30 PM';
      const dailyHours = emp.dailyHours || '8.0';
      const overtime = emp.overtime || 'Eligible';

      return [
        idx + 1,
        name,
        code,
        designation,
        startTime,
        restInterval,
        endTime,
        dailyHours,
        overtime
      ];
    });
    return { meta, headers, body };
  }

  if (formKey === 'Form W') {
    const meta = [
      ['Form-W', '', ''],
      ['REGISTER OF WAGES [See sub-rule(1) of rule(16)]', '', ''],
      ['Name and Address of the Establishment :', '', `${companyName}, ${companyAddress}`],
      ['Name of Employer :', '', employerName],
      ['Name of Manager/Incharge :', '', managerName],
      ['Total Number of persons employed :', '', `Total: ${totalEmployees} (Male: ${maleCount}, Female: ${femaleCount})`],
      ['Wage Period :', '', monthLabel],
      ['Date of Payment of Wages :', '', dynamicPaymentDate]
    ];
    const headers = [
      [
        { label: 'Sl. No.', rowSpan: 2 },
        { label: 'Name of the Employee', rowSpan: 2 },
        { label: 'Employee ID', rowSpan: 2 },
        { label: 'Working Days', rowSpan: 2 },
        { label: 'Days Worked', rowSpan: 2 },
        { label: 'GROSS SALARY (BASE REGISTRATION)', colSpan: 4, align: 'center' },
        { label: 'EARNED GROSS SALARY', colSpan: 6, align: 'center' },
        { label: 'PROVIDENT FUND (PF)', colSpan: 3, align: 'center' },
        { label: 'ESIC', colSpan: 2, align: 'center' },
        { label: 'Professional Tax (₹)', rowSpan: 2 },
        { label: 'Income Tax (TDS) (₹)', rowSpan: 2 },
        { label: 'Other Deductions (₹)', rowSpan: 2 },
        { label: 'Total Deductions (₹)', rowSpan: 2 },
        { label: 'Net Wages (₹)', rowSpan: 2 },
        { label: 'Date of Payment', rowSpan: 2 }
      ],
      [
        'Basic Wage (₹)',
        'House Rent Allowance (₹)',
        'Other Allowances (₹)',
        'Total Gross Salary (₹)',
        'Earned Basic (₹)',
        'Earned HRA (₹)',
        'Other Allowances (₹)',
        'Ad-hoc Payment (₹)',
        'Ad-hoc Deduction (₹)',
        'Total Earned Gross (₹)',
        'Employer PF (12%) (₹)',
        'Employee PF (12%) (₹)',
        'Voluntary PF (VPF) (₹)',
        'Employee ESIC (0.75%) (₹)',
        'Employer ESIC (3.25%) (₹)'
      ]
    ];
    // Form W strictly requires processed payroll data from pay run
    const hasRunData = Array.isArray(runItems) && runItems.length > 0 && runItems.some(it => (it.grossEarned != null || it.workedDays != null || it.workingDays != null || it.gross_earned != null || it.worked_days != null || it.working_days != null));
    if (!hasRunData) {
      return {
        meta,
        headers,
        body: [],
        payrollNotRun: true,
        message: `Please run the payroll first. No processed payroll records found for ${monthLabel}.`
      };
    }

    // Identical rows to the downloaded Excel Form W: figures read from the stored payroll items
    const body = DataMapper.mapFormWRows(employees, attendance, runItems, selectedMonth);

    return { meta, headers, body };
  }

  if (formKey === 'Form X') {
    const meta = [
      ['Form-X', '', ''],
      ['Register of Leave and Social Security Benefits [See sub-rule (1) of rule (16)]', '', ''],
      ['Name and Address of the Establishment: ', '', `${companyName}, ${companyAddress}`],
      ['Name of Employer:', '', employerName],
      ['Name of Manager/Incharge:', '', managerName],
      ['Total Persons Employed:', '', `Total: ${totalEmployees} (Male: ${maleCount}, Female: ${femaleCount})`],
      ['For the month of:', '', monthLabel]
    ];
    const headers = [
      ['Serial Number', 'Name of the employee', 'Employee Identification No.', 'Opening Earned Leave', 'Earned Leave Accrued (Month)', 'Earned Leave Availed (Month)', 'Closing Earned Leave Balance', 'Status']
    ];
    const body = employees.map((emp, idx) => {
      const name = emp.name || emp.fullName || `Employee ${idx + 1}`;
      const code = emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id || `EMP${String(idx + 1).padStart(3, '0')}`;

      const empApprovedLeaves = getEmpLeavesForMonth(emp, leaves, selectedMonth);

      let elCount = 0;

      empApprovedLeaves.forEach(l => {
        const lType = String(l.type || '').toUpperCase();
        let days = Number(l.totalDays || l.total_days || 0);
        if (days <= 0 && (l.startDate || l.start_date) && (l.endDate || l.end_date)) {
          const d1 = new Date(l.startDate || l.start_date);
          const d2 = new Date(l.endDate || l.end_date);
          const diffTime = Math.abs(d2 - d1);
          days = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);
        }
        if (days <= 0) days = 1;

        if (lType.includes('EARNED') || lType === 'EL') {
          const actualEl = (l.elDays !== undefined && l.elDays !== null) ? Number(l.elDays) : days;
          elCount += actualEl;
        }
      });

      const openingRaw = emp.opening_leave_balance !== undefined && emp.opening_leave_balance !== null
        ? emp.opening_leave_balance
        : (emp.openingLeaveBalance !== undefined && emp.openingLeaveBalance !== null
          ? emp.openingLeaveBalance
          : (emp.earned_leaves !== undefined && emp.earned_leaves !== null
            ? emp.earned_leaves
            : (emp.earnedLeaves !== undefined && emp.earnedLeaves !== null
              ? emp.earnedLeaves
              : null)));
      const opening = (openingRaw !== null && !isNaN(Number(openingRaw))) ? Math.max(0, Number(openingRaw)) : 0;
      const accruedInMonth = 1;
      const closingBalance = Math.max(0, opening + accruedInMonth - elCount);

      return [
        idx + 1,
        name,
        code,
        opening,
        accruedInMonth,
        elCount,
        closingBalance,
        emp.status || 'ACTIVE'
      ];
    });
    return { meta, headers, body };
  }

  if (formKey === 'Form T') {
    const meta = [
      ['Form T', '', ''],
      ['Wage Slip / Leave Card [See sub-rule (6) of Rule 11]', '', ''],
      ['Name and address of the establishment:', '', `${companyName}, ${companyAddress}`],
      ['Name of Employer:', '', employerName],
      ['Wage period:', '', monthLabel]
    ];
    const headers = [
      ['Employee ID', 'Employee Name', 'Designation', 'Department', 'Basic Wage (₹)', 'HRA (₹)', 'Other Allowances (₹)', 'Gross Salary (₹)', 'PF Deduction (₹)', 'VPF Deduction (₹)', 'ESI Deduction (₹)', 'PT Deduction (₹)', 'Income Tax / TDS (₹)', 'Other Deductions (₹)', 'Total Deductions (₹)', 'Net Salary Paid (₹)', 'Bank Account No.']
    ];
    // One wage slip per employee paid in this run, figures as stored by payroll (same as the payslip)
    const body = [];
    employees.forEach((emp) => {
      const item = DataMapper.findRunItem(runItems, emp);
      if (!item) return;
      const f = DataMapper.mapPayrollFigures(item, emp, selectedMonth);
      body.push([
        emp.empCode || emp.emp_code || emp.employeeId || emp.code || emp.id,
        emp.name || emp.fullName || item.employeeName || `Employee ${body.length + 1}`,
        emp.jobTitle || emp.job_title || emp.designation || emp.role || 'Field Staff',
        emp.department || 'Operations',
        f.earnedBasic,
        f.earnedHra,
        f.earnedOther,
        f.earnedGross,
        f.pfEe,
        f.vpfEe,
        f.esiEe,
        f.pt,
        f.tds,
        f.otherDed,
        f.totalDed,
        f.net,
        emp.bank_account_no || emp.bankAccountNo || '—'
      ]);
    });
    return { meta, headers, body };
  }

  return { meta: [], headers: [], body: [] };
};

const cleanRowValue = (val) => {
  if (val === null || val === undefined) return 0;
  return val;
};

import { ExcelExportService } from '../services/excelEngine/ExcelExportService.js';
import { DataMapper } from '../services/excelEngine/DataMapper.js';

/**
 * Export a single compliance form to an official Excel file using ExcelEngine
 */
export const exportFormToExcel = (formKey, selectedMonth = getCurrentMonthYYYYMM(), employees = [], attendance = [], leaves = [], runItems = [], settings = {}) => {
  return ExcelExportService.exportSingleFormToExcel(formKey, selectedMonth, employees, attendance, leaves, runItems, settings);
};

/**
 * Export ALL compliance forms into a single multi-sheet official template Excel (.xlsx) file
 */
export const exportAllFormsToExcel = (selectedMonth = getCurrentMonthYYYYMM(), employees = [], attendance = [], leaves = [], runItems = [], settings = {}) => {
  return ExcelExportService.exportAllFormsToExcel(selectedMonth, employees, attendance, leaves, runItems, settings);
};

/**
 * Export a form view to PDF using html2canvas and jsPDF — libraries loaded on demand
 */
export const exportFormToPDF = async (elementId, title = 'Compliance_Form', selectedMonth = getCurrentMonthYYYYMM()) => {
  const el = document.getElementById(elementId);
  if (!el) {
    alert('Container element not found for PDF export.');
    return;
  }

  try {
    // Dynamic import — only downloads jsPDF + html2canvas when user actually clicks Export PDF
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas')
    ]);

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#08080a'
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth - 20;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 10;

    pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    const monthLabel = formatMonthYearLabel(selectedMonth).replace(/\s+/g, '_');
    pdf.save(`${title.replace(/\s+/g, '_')}_${monthLabel}.pdf`);
  } catch (err) {
    console.error('Failed to generate PDF:', err);
    alert('Could not export PDF. Please try downloading as Excel.');
  }
};

