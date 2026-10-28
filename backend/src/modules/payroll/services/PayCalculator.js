const {
  SalaryStructure,
  EmployeeSalaryComponent,
  Loan,
  LoanRepayment,
  Reimbursement,
  Leave
} = require('../../../shared/models/index');
const { Op } = require('sequelize');
const ProfessionalTaxService = require('../../../core/utils/ProfessionalTaxService');

/**
 * PayCalculator - the ONLY place that decides an employee's pay for a payroll run.
 *
 * Every consumer goes through computeEmployeePay():
 *   - Lock & Freeze (PayrollEngine)                    -> stored PayrollItem + payslip
 *   - wizard auto-save / LOP / working-day edits         -> recalculated PayrollItem
 *   - /disburse and draft (synthetic) items
 *   - POST /run/:id/preview                              -> pay run wizard tables & CSV register
 * Form W, Form T and payslips only read the stored result, so all of them show the same numbers.
 */

const PF_RATE = 0.12;
const PF_WAGE_CEILING = 15000;
const ESI_EE_RATE = 0.0075;
const ESI_WAGE_LIMIT = 21000;
const DEFAULT_MONTHLY_GROSS = 25000;
const DEFAULT_ANNUAL_LWF = 60;

function parseWizardState(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }
  return raw;
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Supports DD/MM/YYYY and YYYY-MM-DD(THH:mm) strings
function parseDateParts(dStr) {
  if (!dStr) return null;
  const clean = String(dStr).trim();
  if (clean === '' || clean === 'null' || clean === 'undefined') return null;
  let parts;
  if (clean.includes('/')) {
    const p = clean.split('/');
    parts = { day: parseInt(p[0], 10), month: parseInt(p[1], 10), year: parseInt(p[2], 10) };
  } else if (clean.includes('-')) {
    const p = clean.split('T')[0].split('-');
    parts = { year: parseInt(p[0], 10), month: parseInt(p[1], 10), day: parseInt(p[2], 10) };
  } else {
    return null;
  }
  return (isNaN(parts.year) || isNaN(parts.month)) ? null : parts;
}

function employeeIdentity(employee) {
  return {
    id: String(employee.id || ''),
    code: String(employee.empCode || employee.emp_code || ''),
    name: String(employee.name || employee.fullName || '')
  };
}

// Wizard state maps are keyed by employee id, emp code or name (case-insensitive); id wins
function findWizardKey(map, who) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined;
  const keys = Object.keys(map);
  for (const candidate of [who.id, who.code, who.name]) {
    if (!candidate) continue;
    const key = keys.find(k => k.toLowerCase() === candidate.toLowerCase());
    if (key !== undefined) return key;
  }
  return undefined;
}

const OVERRIDE_TYPE_ALIASES = {
  EPF: ['EPF', 'PF', 'PF_EE', 'EPF_EE'],
  VPF: ['VPF', 'VPF_EE'],
  ESI: ['ESI', 'ESI_EE', 'ESIC'],
  PT: ['PT'],
  LWF: ['LWF', 'LWF_EE'],
  TDS: ['TDS'],
  OTHER: ['OTHER', 'LWP', 'OTHER_DEDUCTION']
};

const LEGACY_OVERRIDE_PROPS = {
  EPF: ['epf', 'pf', 'pf_ee', 'PF_EE', 'EPF_EE'],
  VPF: ['vpf', 'vpf_ee', 'VPF_EE'],
  ESI: ['esi', 'esi_ee', 'ESI_EE'],
  PT: ['pt', 'PT'],
  LWF: ['lwf', 'lwf_ee', 'LWF_EE'],
  TDS: ['tds', 'TDS'],
  OTHER: ['other', 'OTHER', 'lwp', 'LWP']
};

/**
 * Step 6 statutory overrides. Current wizard format is an array of
 * { employeeId, employeeName, overrideType, amount } (employee-specific first, then 'ALL');
 * the legacy object format { [empId]: { epf, pt, ... } } is still honoured.
 */
function resolveOverride(appliedOverrides, who, type) {
  if (!appliedOverrides) return null;
  const aliases = OVERRIDE_TYPE_ALIASES[type] || [type];
  const isUsable = (v) => v !== undefined && v !== null && v !== '' && !isNaN(Number(v));

  if (Array.isArray(appliedOverrides)) {
    const typeMatches = (o) => aliases.includes(String(o.overrideType || '').toUpperCase());
    const specific = appliedOverrides.find(o => {
      if (!typeMatches(o)) return false;
      const oEmp = String(o.employeeId || '').toLowerCase();
      if (!oEmp || oEmp === 'all') return false;
      return oEmp === who.id.toLowerCase() || (who.code && oEmp === who.code.toLowerCase());
    });
    if (specific && isUsable(specific.amount)) return Number(specific.amount);

    const general = appliedOverrides.find(o => typeMatches(o) && String(o.employeeId || '').toUpperCase() === 'ALL');
    if (general && isUsable(general.amount)) return Number(general.amount);
    return null;
  }

  if (typeof appliedOverrides === 'object') {
    const key = findWizardKey(appliedOverrides, who);
    const ovr = key !== undefined ? appliedOverrides[key] : (appliedOverrides.ALL || appliedOverrides.all);
    if (!ovr) return null;
    for (const prop of (LEGACY_OVERRIDE_PROPS[type] || [type.toLowerCase()])) {
      if (isUsable(ovr[prop])) return Number(ovr[prop]);
    }
  }
  return null;
}

// compensation_gross holds the annual CTC; small values were entered as monthly figures
function toMonthly(value) {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  return v > 100000 ? Math.round(v / 12) : v;
}

async function resolveBaseMonthlyGross(employee, wizardAdj, periodStart, periodEnd, transaction) {
  if (wizardAdj && Number(wizardAdj.ctc) > 0) {
    return { amount: toMonthly(wizardAdj.ctc), source: 'WIZARD_REVISION' };
  }
  const fromProfile = toMonthly(employee.compensationGross);
  if (fromProfile > 0) return { amount: fromProfile, source: 'EMPLOYEE_PROFILE' };

  const candidateIds = [String(employee.id), employee.empCode].filter(Boolean);
  const structure = await SalaryStructure.findOne({
    where: {
      employeeId: { [Op.in]: candidateIds },
      effectiveFrom: { [Op.lte]: periodEnd },
      [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: periodStart } }]
    },
    order: [['effectiveFrom', 'DESC'], ['version', 'DESC'], ['createdAt', 'DESC']],
    transaction
  });
  const fromStructure = structure ? toMonthly(structure.grossSalary) : 0;
  if (fromStructure > 0) return { amount: fromStructure, source: 'SALARY_STRUCTURE' };

  return { amount: DEFAULT_MONTHLY_GROSS, source: 'DEFAULT' };
}

// Approved LOP / unpaid leave days starting in the pay month (used only when Step 1 has no LOP edit)
async function lopDaysFromLeaves(who, year, month, transaction) {
  const leaves = await Leave.findAll({
    where: {
      [Op.or]: [
        { userId: who.id },
        ...(who.code ? [{ userId: who.code }, { userName: who.code }] : []),
        ...(who.name ? [{ userId: who.name }, { userName: who.name }] : [])
      ]
    },
    transaction
  });

  return leaves.reduce((sum, l) => {
    if (String(l.status || '').toLowerCase() !== 'approved') return sum;
    const start = parseDateParts(l.startDate);
    if (!start || start.year !== year || start.month !== month) return sum;
    const type = String(l.type || '').toLowerCase();
    if (!type.includes('lop') && !type.includes('unpaid') && !type.includes('loss of pay')) return sum;

    let days = Number(l.lopDays) > 0 ? Number(l.lopDays) : Number(l.totalDays) || 0;
    if (days <= 0) {
      const diff = Math.round((new Date(l.endDate || l.startDate) - new Date(l.startDate)) / 86400000) + 1;
      days = isNaN(diff) ? 1 : Math.max(1, diff);
    }
    return sum + days;
  }, 0);
}

/**
 * Computes one employee's pay for a run month.
 *
 * @param {object} params.employee      Employee model instance (or plain object with the same attributes)
 * @param {string} params.month         Pay month, 'YYYY-MM'
 * @param {object} params.wizardState   Pay run wizard state (edited LOP, overrides, ad-hoc, holds, ...)
 * @param {string} params.payrollRunId  Run id (reimbursements already linked to this run stay with it)
 * @param {string} params.mode          'PREVIEW' | 'PROCESS' | 'RECALC'. RECALC keeps the loan EMI that was
 *                                      booked for params.existingItem when the run was processed.
 * @param {object} params.existingItem  Stored PayrollItem being recalculated (RECALC only)
 */
async function computeEmployeePay({ employee, month, wizardState = {}, payrollRunId = null, mode = 'PREVIEW', existingItem = null, transaction = null }) {
  const ws = parseWizardState(wizardState);
  const who = employeeIdentity(employee);
  const [year, mon] = String(month).split('-').map(n => parseInt(n, 10));
  const calendarDays = getDaysInMonth(year, mon);
  const monthPad = String(mon).padStart(2, '0');
  const periodStart = `${year}-${monthPad}-01`;
  const periodEnd = `${year}-${monthPad}-${String(calendarDays).padStart(2, '0')}`;
  const notes = [];

  // 1. Days. The daily rate is monthly salary / working days (Step 1 edit, else calendar days).
  //    Without a Step 1 edit, joiners / leavers inside the month are paid only for the days employed.
  const editedWorkingDays = ws.editedWorkingDays || {};
  const wdKey = findWizardKey(editedWorkingDays, who);
  const editedWd = wdKey !== undefined ? Number(editedWorkingDays[wdKey]) : NaN;
  const hasEditedWd = !isNaN(editedWd) && editedWd >= 0;
  const workingDays = hasEditedWd ? editedWd : calendarDays;

  let employedDays = workingDays;
  if (!hasEditedWd) {
    const join = parseDateParts(employee.joiningDate);
    const exit = parseDateParts(employee.exitDate);
    let joinDay = null;
    if (join) {
      if (join.year === year && join.month === mon) {
        joinDay = Math.min(Math.max(1, join.day || 1), calendarDays);
        employedDays = calendarDays - joinDay + 1;
      } else if (join.year > year || (join.year === year && join.month > mon)) {
        employedDays = 0;
      }
    }
    if (exit && employee.status === 'PAST' && exit.year === year && exit.month === mon) {
      const exitDay = Math.min(Math.max(1, exit.day || 1), calendarDays);
      employedDays = joinDay ? Math.max(0, exitDay - joinDay + 1) : Math.min(employedDays, exitDay);
    }
  }

  // 2. LOP: Step 1 edit, else approved LOP leaves
  const editedLop = ws.editedLop || {};
  const lopKey = findWizardKey(editedLop, who);
  const editedLopVal = lopKey !== undefined ? Number(editedLop[lopKey]) : NaN;
  const lopDays = !isNaN(editedLopVal) && editedLopVal >= 0
    ? editedLopVal
    : await lopDaysFromLeaves(who, year, mon, transaction);

  const workedDays = Math.max(0, employedDays - lopDays);
  const ratio = workingDays > 0 ? Math.min(1, workedDays / workingDays) : 0;

  // 3. Monthly rates
  const adjKey = findWizardKey(ws.appliedAdjustments || {}, who);
  const wizardAdj = adjKey !== undefined ? ws.appliedAdjustments[adjKey] : null;
  const base = await resolveBaseMonthlyGross(employee, wizardAdj, periodStart, periodEnd, transaction);

  const customComponents = await EmployeeSalaryComponent.findAll({ where: { employeeId: who.id }, transaction });
  const customValue = (componentId) => {
    const c = customComponents.find(x => x.componentId === componentId);
    return c && Number(c.value) > 0 ? Number(c.value) : null;
  };
  const rateBasic = customValue('BASIC') ?? Math.round(base.amount * 0.50);
  const rateHra = customValue('HRA') ?? Math.round(base.amount * 0.30);
  const rateSpecial = Math.max(0, base.amount - rateBasic - rateHra);

  const heldKey = findWizardKey(ws.heldEmployees || {}, who);
  const isHeld = heldKey !== undefined && !!ws.heldEmployees[heldKey];
  if (isHeld) notes.push('Salary on hold for this cycle (Step 5).');

  // 4. Earnings (a held salary is not paid in this cycle at all)
  const earnings = {};
  let adhocDeduction = 0;
  if (!isHeld) {
    earnings.BASIC = Math.round(rateBasic * ratio);
    earnings.HRA = Math.round(rateHra * ratio);
    earnings.SPECIAL_ALLOWANCE = Math.round(rateSpecial * ratio);

    if (wizardAdj && Number(wizardAdj.bonus) > 0) earnings.BONUS = Number(wizardAdj.bonus);

    const empAdhocs = (Array.isArray(ws.appliedAdhoc) ? ws.appliedAdhoc : []).filter(a => {
      const aEmp = String(a.employeeId || '').toLowerCase();
      return aEmp === who.id.toLowerCase() || (who.code && aEmp === who.code.toLowerCase());
    });
    const adhocSum = (type) => empAdhocs.filter(a => a.type === type).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    if (adhocSum('PAYMENT') > 0) earnings.ADHOC_PAYMENT = adhocSum('PAYMENT');
    if (adhocSum('ARREARS') > 0) earnings.ARREARS = adhocSum('ARREARS');
    adhocDeduction = adhocSum('DEDUCTION');

    const editedOvertime = ws.editedOvertime || ws.appliedOvertime || {};
    const otKey = findWizardKey(editedOvertime, who);
    const otHours = otKey !== undefined ? Number(editedOvertime[otKey]) : Number(employee.overtimeHours || 0);
    if (otHours > 0) earnings.OVERTIME = Math.round((base.amount / 240) * 1.5 * otHours);
  }
  const grossEarned = Object.values(earnings).reduce((s, v) => s + v, 0);

  // 5. Deductions. Nothing can be deducted from a month with no earnings (e.g. full-month LOP).
  const deductions = {};
  let pt = { amount: 0, ruleId: null, stateId: null, salaryBasis: null };
  let loanId = null;
  let claims = [];

  if (grossEarned > 0) {
    const ovr = (type) => resolveOverride(ws.appliedOverrides, who, type);

    // EPF: registered monthly amount, else 12% of (Basic + Other allowances) capped at the
    // Rs 15,000 wage ceiling; prorated by payable days.
    const epfOvr = ovr('EPF');
    if (epfOvr !== null) {
      deductions.EPF_EE = epfOvr;
    } else if (employee.pfEligible !== false) {
      const pfWage = rateBasic + rateSpecial;
      const monthlyPf = Number(employee.pfAmount) > 0
        ? Number(employee.pfAmount)
        : Math.round(Math.min(pfWage, PF_WAGE_CEILING) * PF_RATE);
      deductions.EPF_EE = Math.round(monthlyPf * ratio);
    }

    const vpfOvr = ovr('VPF');
    deductions.VPF_EE = vpfOvr !== null ? vpfOvr : (employee.vpfEligible === true ? (Number(employee.vpfAmount) || 0) : 0);

    // ESI: coverage decided on the monthly wage rate; 0.75% of earnings rounded up to the next rupee
    const esiOvr = ovr('ESI');
    deductions.ESI_EE = esiOvr !== null
      ? esiOvr
      : (employee.esiEligible !== false && base.amount <= ESI_WAGE_LIMIT ? Math.ceil(grossEarned * ESI_EE_RATE) : 0);

    const ptOvr = ovr('PT');
    if (ptOvr !== null) {
      pt = { amount: ptOvr, ruleId: null, stateId: null, salaryBasis: 'OVERRIDE' };
    } else {
      const ptResult = await ProfessionalTaxService.calculateProfessionalTax({
        employee,
        grossSalary: base.amount,
        basicSalary: rateBasic,
        taxableSalary: Math.max(0, base.amount - (deductions.EPF_EE || 0) - deductions.ESI_EE),
        totalEarnings: base.amount,
        payrollDate: periodStart,
        attendanceRatio: 1
      });
      pt = {
        amount: ptResult.ptAmount || 0,
        ruleId: ptResult.ruleId || null,
        stateId: ptResult.stateId || null,
        salaryBasis: ptResult.salaryBasis || 'GROSS_SALARY'
      };
    }
    deductions.PT = pt.amount;

    const lwfOvr = ovr('LWF');
    if (lwfOvr !== null) {
      deductions.LWF = lwfOvr;
    } else if (employee.lwfEligible !== false) {
      const hasAnnualLwf = employee.lwfAmount !== null && employee.lwfAmount !== undefined && employee.lwfAmount !== '' && Number(employee.lwfAmount) >= 0;
      deductions.LWF = Math.round((hasAnnualLwf ? Number(employee.lwfAmount) : DEFAULT_ANNUAL_LWF) / 12);
    }

    // TDS is only deducted when entered in the wizard (Step 6) - exactly what the wizard shows for approval
    const tdsOvr = ovr('TDS');
    deductions.TDS = tdsOvr !== null ? tdsOvr : 0;

    const otherOvr = ovr('OTHER');
    if (otherOvr !== null && otherOvr > 0) deductions.OTHER = otherOvr;
    if (adhocDeduction > 0) deductions.ADHOC_DEDUCTION = adhocDeduction;

    if (mode === 'RECALC') {
      // Loan EMI was booked (LoanRepayment + balance) when the run was processed; keep that figure
      if (existingItem) {
        const repayments = await LoanRepayment.findAll({ where: { payrollItemId: existingItem.id }, transaction });
        const emi = repayments.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
        if (emi > 0) deductions.LOAN_EMI = emi;
      }
    } else {
      const activeLoan = await Loan.findOne({ where: { employeeId: who.id, status: 'ACTIVE' }, transaction });
      if (activeLoan) {
        const emi = Math.min(Number(activeLoan.emiAmount) || 0, Number(activeLoan.remainingBalance) || 0);
        if (emi > 0) {
          deductions.LOAN_EMI = emi;
          loanId = activeLoan.id;
        }
      }
    }

    // Approved reimbursements are paid with the salary (not part of wages); claims already linked to this run stay with it
    claims = await Reimbursement.findAll({
      where: {
        employeeId: who.id,
        status: 'APPROVED',
        processedInRunId: mode === 'RECALC' ? payrollRunId : { [Op.or]: [null, ...(payrollRunId ? [payrollRunId] : [])] }
      },
      transaction
    });
  }

  // 6. Net pay can never go negative: recover less of the loan / advances / TDS this month
  const sumDeductions = () => Object.values(deductions).reduce((s, v) => s + (Number(v) || 0), 0);
  let shortfall = sumDeductions() - grossEarned;
  if (shortfall > 0) {
    for (const key of ['LOAN_EMI', 'ADHOC_DEDUCTION', 'OTHER', 'TDS']) {
      if (shortfall <= 0) break;
      if (!deductions[key]) continue;
      const cut = Math.min(shortfall, deductions[key]);
      deductions[key] -= cut;
      shortfall -= cut;
      notes.push(`${key} reduced by ${cut} to avoid negative net pay.`);
    }
    if (shortfall > 0) notes.push('Statutory deductions exceed gross earnings; review the Step 6 overrides.');
  }

  // Store only non-zero components so payslips and forms never show phantom lines
  for (const key of Object.keys(deductions)) {
    if (!Number(deductions[key])) delete deductions[key];
  }
  if (!deductions.LOAN_EMI) loanId = null;

  const totalDeductions = sumDeductions();
  const reimbursements = claims.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const netSalary = Math.max(0, grossEarned - totalDeductions) + reimbursements;

  return {
    employeeId: who.id,
    empCode: who.code,
    name: who.name,
    month,
    workingDays,
    employedDays,
    workedDays,
    lopDays,
    ratio,
    isHeld,
    baseMonthlyGross: base.amount,
    baseSource: base.source,
    rates: { BASIC: rateBasic, HRA: rateHra, SPECIAL_ALLOWANCE: rateSpecial },
    earnings,
    deductions,
    grossEarned,
    totalDeductions,
    reimbursements,
    netSalary,
    professionalTax: pt,
    loanId,
    claimIds: claims.map(c => c.id),
    notes
  };
}

// Employees in a pay run: everyone active, plus exited employees ticked for settlement in the wizard
function payRunWorkforceWhere(wizardState, extraExitedIds = []) {
  const checkedExited = parseWizardState(wizardState).checkedExited || {};
  const exitedIds = new Set([
    ...extraExitedIds.map(String),
    ...Object.keys(checkedExited).filter(id => checkedExited[id])
  ]);
  return {
    is_system_account: false,
    [Op.or]: [
      { status: 'ACTIVE' },
      { status: 'PAST', id: { [Op.in]: Array.from(exitedIds) } }
    ]
  };
}

// Field values for a PayrollItem row built from a computeEmployeePay() result
function toPayrollItemFields(result) {
  return {
    workingDays: result.workingDays,
    workedDays: result.workedDays,
    lopDays: result.lopDays,
    earningsBreakdown: result.earnings,
    deductionsBreakdown: result.deductions,
    grossEarned: result.grossEarned,
    totalDeductions: result.totalDeductions,
    netSalary: result.netSalary,
    reimbursements: result.reimbursements,
    professionalTaxAmount: result.professionalTax.amount,
    professionalTaxRuleId: result.professionalTax.ruleId,
    professionalTaxStateId: result.professionalTax.stateId,
    professionalTaxSalaryBasis: result.professionalTax.salaryBasis,
    professionalTaxCalculationDate: `${result.month}-01`
  };
}

module.exports = {
  computeEmployeePay,
  toPayrollItemFields,
  parseWizardState,
  payRunWorkforceWhere
};
