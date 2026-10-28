/**
 * payrollItemResolver.js
 *
 * Prepares stored payroll run items for the screens that display them:
 * - Pay Runs tab and Pay Run Wizard
 * - Reports tab (Form W & Register of Wages) and Compliance Form Full View
 * - Official downloaded Excel (Form W / Form T)
 *
 * Every figure is calculated once, on the server (PayCalculator), so all of these show the same numbers.
 */

/**
 * Universal entity matcher across employees, run items, leaves, and attendance
 */
export function matchesEmp(record, emp) {
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
 * Parses date string in DD/MM/YYYY or YYYY-MM-DD format
 */
export function parseDateParts(dateStr) {
  if (!dateStr) return null;
  const clean = String(dateStr).trim();
  if (clean === 'null' || clean === 'undefined' || clean === '') return null;
  if (clean.includes('/')) {
    const parts = clean.split('/');
    return {
      day: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10),
      year: parseInt(parts[2], 10)
    };
  } else if (clean.includes('-')) {
    const parts = clean.split('T')[0].split('-');
    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10),
      day: parseInt(parts[2], 10)
    };
  }
  return null;
}

/**
 * Robust statutory override resolver supporting both Array and Object structures,
 * employee-specific IDs, codes, names, and company-wide 'ALL' bulk overrides.
 */
export const resolveOverrideValue = (appliedOverrides, empIdStr = '', empCodeStr = '', empNameStr = '', type = '') => {
  if (!appliedOverrides) return null;
  const targetType = String(type).toUpperCase();
  if (Array.isArray(appliedOverrides)) {
    // 1. Employee-specific override
    const specific = appliedOverrides.find(o => {
      const oEmpId = String(o.employeeId || '').toLowerCase();
      const oType = String(o.overrideType || '').toUpperCase();
      const matchesEmp = (
        (empIdStr && oEmpId === empIdStr.toLowerCase()) ||
        (empCodeStr && oEmpId === empCodeStr.toLowerCase()) ||
        (empNameStr && String(o.employeeName || '').toLowerCase().includes(empNameStr.toLowerCase()))
      );
      const matchesType = (
        oType === targetType ||
        (targetType === 'EPF' && (oType === 'PF' || oType === 'PF_EE')) ||
        (targetType === 'PF_EE' && (oType === 'EPF' || oType === 'PF')) ||
        (targetType === 'ESI' && (oType === 'ESI_EE' || oType === 'ESIC')) ||
        (targetType === 'ESI_EE' && (oType === 'ESI' || oType === 'ESIC')) ||
        (targetType === 'LWF' && oType === 'LWF_EE') ||
        (targetType === 'LWF_EE' && oType === 'LWF') ||
        (targetType === 'OTHER' && (oType === 'LWP' || oType === 'OTHER_DEDUCTION'))
      );
      return matchesEmp && matchesType;
    });
    if (specific !== undefined && specific.amount !== undefined && specific.amount !== '') {
      return Number(specific.amount);
    }

    // 2. Company-wide bulk override ('ALL')
    const general = appliedOverrides.find(o => {
      const oEmpId = String(o.employeeId || '').toUpperCase();
      const oType = String(o.overrideType || '').toUpperCase();
      const matchesType = (
        oType === targetType ||
        (targetType === 'EPF' && (oType === 'PF' || oType === 'PF_EE')) ||
        (targetType === 'PF_EE' && (oType === 'EPF' || oType === 'PF')) ||
        (targetType === 'ESI' && (oType === 'ESI_EE' || oType === 'ESIC')) ||
        (targetType === 'ESI_EE' && (oType === 'ESI' || oType === 'ESIC')) ||
        (targetType === 'LWF' && oType === 'LWF_EE') ||
        (targetType === 'LWF_EE' && oType === 'LWF') ||
        (targetType === 'OTHER' && (oType === 'LWP' || oType === 'OTHER_DEDUCTION'))
      );
      return oEmpId === 'ALL' && matchesType;
    });
    if (general !== undefined && general.amount !== undefined && general.amount !== '') {
      return Number(general.amount);
    }
    return null;
  }

  if (typeof appliedOverrides === 'object') {
    const matchedKey = Object.keys(appliedOverrides).find(k => 
      (empIdStr && k.toLowerCase() === empIdStr.toLowerCase()) ||
      (empCodeStr && k.toLowerCase() === empCodeStr.toLowerCase()) ||
      (empNameStr && k.toLowerCase() === empNameStr.toLowerCase())
    );
    const ovr = matchedKey ? appliedOverrides[matchedKey] : (appliedOverrides['ALL'] || appliedOverrides['all']);
    if (ovr) {
      const propMap = {
        'EPF': ['epf', 'pf', 'pf_ee', 'PF_EE'],
        'PF_EE': ['epf', 'pf', 'pf_ee', 'PF_EE'],
        'VPF': ['vpf', 'vpf_ee', 'VPF_EE'],
        'VPF_EE': ['vpf', 'vpf_ee', 'VPF_EE'],
        'ESI': ['esi', 'esi_ee', 'ESI_EE'],
        'ESI_EE': ['esi', 'esi_ee', 'ESI_EE'],
        'PT': ['pt', 'PT'],
        'LWF': ['lwf', 'lwf_ee', 'LWF_EE'],
        'LWF_EE': ['lwf', 'lwf_ee', 'LWF_EE'],
        'TDS': ['tds', 'TDS'],
        'OTHER': ['other', 'OTHER', 'lwp', 'LWP']
      };
      const props = propMap[targetType] || [targetType.toLowerCase()];
      for (const p of props) {
        if (ovr[p] !== undefined && ovr[p] !== '') return Number(ovr[p]);
      }
    }
  }
  return null;
};

const parseBreakdown = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch (e) { return {}; }
  }
  return value;
};

/**
 * Returns a run's stored payroll items ready for display: JSON breakdowns parsed and the
 * snake_case aliases older screens read filled in.
 *
 * Items come from GET /payroll/runs/:id/items, i.e. the server-side PayCalculator result that
 * already includes every wizard edit (LOP, working days, overrides, ad-hoc, holds). They are
 * passed through unchanged - recalculating here is what made the forms disagree with payroll.
 * The extra parameters are accepted only for compatibility with existing callers.
 */
export function resolvePayrollRunItems(targetRun, baseDbItems = []) {
  if (!Array.isArray(baseDbItems)) return [];

  return baseDbItems.filter(Boolean).map(it => {
    const employee = it.employee || {};
    const earnings = parseBreakdown(it.earningsBreakdown ?? it.earnings_breakdown);
    const deductions = parseBreakdown(it.deductionsBreakdown ?? it.deductions_breakdown);
    const value = (camel, snake) => (it[camel] ?? it[snake]);

    return {
      ...it,
      employeeId: value('employeeId', 'employee_id'),
      employee_id: value('employeeId', 'employee_id'),
      empCode: it.empCode || employee.empCode || value('employeeId', 'employee_id'),
      employeeCode: it.employeeCode || employee.empCode || value('employeeId', 'employee_id'),
      employeeName: it.employeeName || employee.name,
      workingDays: value('workingDays', 'working_days'),
      working_days: value('workingDays', 'working_days'),
      workedDays: value('workedDays', 'worked_days'),
      worked_days: value('workedDays', 'worked_days'),
      lopDays: value('lopDays', 'lop_days'),
      lop_days: value('lopDays', 'lop_days'),
      grossEarned: value('grossEarned', 'gross_earned'),
      gross_earned: value('grossEarned', 'gross_earned'),
      totalDeductions: value('totalDeductions', 'total_deductions'),
      total_deductions: value('totalDeductions', 'total_deductions'),
      netSalary: value('netSalary', 'net_salary'),
      net_salary: value('netSalary', 'net_salary'),
      earningsBreakdown: earnings,
      earnings_breakdown: earnings,
      deductionsBreakdown: deductions,
      deductions_breakdown: deductions,
      isHeld: it.isHeld ?? /on hold/i.test(it.errorLog || '')
    };
  });
}
