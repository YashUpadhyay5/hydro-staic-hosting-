const express = require('express');
const router = express.Router();
const { 
  PayrollRun, 
  PayrollItem, 
  Employee, 
  Loan, 
  LoanRepayment, 
  Reimbursement, 
  TaxRecord, 
  SalaryStructure, 
  SalaryComponent, 
  EmployeeSalaryComponent,
  Payslip,
  Document
} = require('../../../shared/models/index');
const PayrollEngine = require('../services/PayrollEngine');
const PayrollQueue = require('../services/PayrollQueue');
const PayslipGenerator = require('../services/PayslipGenerator');
const PayCalculator = require('../services/PayCalculator');
const professionalTaxRoutes = require('./professionalTax');
const { Op } = require('sequelize');

// Mount Professional Tax configuration & calculation routes
router.use('/professional-tax', professionalTaxRoutes);

// --- DASHBOARD ---
router.get('/dashboard', async (req, res) => {
  try {
    const runs = await PayrollRun.findAll({ order: [['month', 'DESC']], limit: 6 });
    
    // Compute total cost and net disbursed from actual processed runs
    const stats = await PayrollRun.findOne({
      attributes: [
        [PayrollRun.sequelize.fn('SUM', PayrollRun.sequelize.col('total_gross')), 'totalGross'],
        [PayrollRun.sequelize.fn('SUM', PayrollRun.sequelize.col('total_net')), 'totalNet']
      ],
      where: { status: 'PAID' }
    });

    const pendingCount = await PayrollRun.count({
      where: { status: { [Op.or]: ['DRAFT', 'PROCESSING', 'APPROVED'] } }
    });

    // Dynamic database fallback calculation: sum monthly compensation of all active employees
    const employees = await Employee.findAll({ where: { status: 'ACTIVE', is_system_account: false } });
    const totalBaseSalary = employees.reduce((sum, emp) => {
      const rawAnnual = Number(emp.compensationGross || 0);
      return sum + (rawAnnual > 0 ? (rawAnnual > 100000 ? Math.round(rawAnnual / 12) : rawAnnual) : 0);
    }, 0);

    let totalGrossCost = stats ? (Number(stats.getDataValue('totalGross')) || 0) : 0;
    let totalNetDisbursed = stats ? (Number(stats.getDataValue('totalNet')) || 0) : 0;

    // If database totals are 0 but paid runs exist, fallback to base salaries
    const hasPaidRun = await PayrollRun.findOne({ where: { status: 'PAID' } });
    if (hasPaidRun && totalGrossCost === 0) {
      totalGrossCost = totalBaseSalary;
      totalNetDisbursed = Math.round(totalBaseSalary * 0.85);
    }

    // Fetch alerts: items that failed in the last run
    const latestRun = await PayrollRun.findOne({ order: [['createdAt', 'DESC']] });
    let alerts = [];
    if (latestRun) {
      const failedItems = await PayrollItem.findAll({
        where: { payrollRunId: latestRun.id, status: 'FAILED' },
        include: [{ model: Employee, as: 'employee', attributes: ['id', 'name'] }]
      });
      alerts = failedItems.map(item => ({
        employeeId: item.employeeId,
        name: item.employee ? item.employee.name : 'Unknown',
        error: item.errorLog || 'Calculations mismatch or negative net pay limit reached.'
      }));
    }

    return res.status(200).json({
      totalGrossCost,
      totalNetDisbursed,
      pendingRuns: pendingCount,
      alerts,
      runsTrend: runs.reverse()
    });
  } catch (error) {
    console.error('Dashboard stats fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// --- PAY RUNS ---

// --- DEACTIVATED EMPLOYEES PRE-FLIGHT CHECK ---
router.get('/deactivated-check', async (req, res) => {
  try {
    const { month } = req.query; // YYYY-MM
    if (!month) return res.status(400).json({ error: 'Month parameter is required (YYYY-MM)' });

    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr);
    const m = parseInt(monthStr);

    let prevYear = year;
    let prevMonth = m - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = year - 1;
    }
    const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    // Find all deactivated employees (status: PAST) whose exit month matches the immediately preceding month
    const allPast = await Employee.findAll({
      where: {
        status: 'PAST'
      }
    });

    const exitedEmployees = allPast.filter(emp => {
      const rawDate = emp.exitDate || emp.updatedAt;
      if (!rawDate) return false;
      const exitMonth = String(rawDate).substring(0, 7);
      return exitMonth === prevMonthStr;
    });

    const results = [];
    for (const emp of exitedEmployees) {
      // Calculate provisional salary based on their attendance / working days
      const rawComp = Number(emp.compensationGross || 0);
      const monthlyCTC = rawComp > 0 ? (rawComp > 100000 ? Math.round(rawComp / 12) : rawComp) : 30000;
      results.push({
        id: emp.id,
        empCode: emp.empCode || emp.id,
        name: emp.name,
        department: emp.department,
        designation: emp.designation,
        exitDate: emp.exitDate || prevMonthStr,
        exitReason: emp.exitReason || 'Exited in previous month',
        monthlyCTC,
        estimatedSalary: Math.round(monthlyCTC * 0.85)
      });
    }

    return res.status(200).json({
      activeCycleMonth: month,
      previousMonth: prevMonthStr,
      deactivatedCount: results.length,
      deactivatedEmployees: results
    });
  } catch (error) {
    console.error('Deactivated check error:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const runs = await PayrollRun.findAll({ order: [['month', 'DESC']] });
    return res.status(200).json(runs);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return res.status(400).json({ error: 'Month parameter is required (YYYY-MM)' });

    // Check duplicate
    const existing = await PayrollRun.findOne({ where: { month } });
    if (existing) return res.status(400).json({ error: `A payroll run for ${month} already exists.` });

    const newRun = await PayrollRun.create({
      month,
      status: 'DRAFT',
      totalGross: 0,
      totalDeductions: 0,
      totalNet: 0
    });

    return res.status(201).json(newRun);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE a specific payroll run and its child records
router.delete('/run/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const run = await PayrollRun.findByPk(id);
    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found.' });
    }

    const items = await PayrollItem.findAll({ where: { payrollRunId: id } });
    const itemIds = items.map(item => item.id);

    if (itemIds.length > 0) {
      await Payslip.destroy({
        where: {
          [Op.or]: [
            { payrollItemId: { [Op.in]: itemIds } },
            { month: run.month }
          ]
        }
      });
      await LoanRepayment.destroy({
        where: { payrollItemId: { [Op.in]: itemIds } }
      });
    } else {
      await Payslip.destroy({ where: { month: run.month } });
    }

    await PayrollItem.destroy({ where: { payrollRunId: id } });
    await run.destroy();

    return res.status(200).json({ message: `Payroll run for ${run.month} deleted successfully.` });
  } catch (error) {
    console.error('Delete payroll run error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Clear all payroll runs and linked items
router.delete('/runs/clear-all', async (req, res) => {
  try {
    await Payslip.destroy({ where: {} });
    await LoanRepayment.destroy({ where: { payrollItemId: { [Op.ne]: null } } });
    await PayrollItem.destroy({ where: {} });
    await PayrollRun.destroy({ where: {} });
    return res.status(200).json({ message: 'All payroll runs and related records cleared.' });
  } catch (error) {
    console.error('Clear all runs error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// --- WIZARD SESSION STATE & LOP PERSISTENCE (Multi-System Synchronization) ---

// 1. Get saved wizard session state for a payroll run
router.get('/run/:id/state', async (req, res) => {
  try {
    const { id } = req.params;
    const run = await PayrollRun.findByPk(id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    const rawState = run.wizardState || {};
    return res.status(200).json({
      success: true,
      runId: run.id,
      month: run.month,
      status: run.status,
      wizardState: typeof rawState === 'string' ? JSON.parse(rawState) : rawState
    });
  } catch (error) {
    console.error('Error fetching wizard state:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Helper: Resolve Employee and PayrollItem robustly across id, empCode, and name
async function resolveEmployeeAndItem(payrollRunId, empIdentifier) {
  const cleanId = String(empIdentifier || '').trim();
  if (!cleanId) return { employee: null, item: null, candidateIds: [] };

  // 1. Find Employee by id, empCode, or name
  let employee = await Employee.findOne({
    where: {
      [Op.or]: [
        { id: cleanId },
        { empCode: cleanId },
        { name: cleanId }
      ]
    }
  });

  if (!employee) {
    const allEmps = await Employee.findAll();
    employee = allEmps.find(e => 
      String(e.id).toLowerCase() === cleanId.toLowerCase() ||
      (e.empCode && String(e.empCode).toLowerCase() === cleanId.toLowerCase()) ||
      (e.name && String(e.name).toLowerCase() === cleanId.toLowerCase())
    );
  }

  // 2. Build candidate IDs
  const candidateIds = [
    cleanId,
    ...(employee ? [String(employee.id), employee.empCode, employee.name].filter(Boolean) : [])
  ];

  // 3. Find PayrollItem
  const item = await PayrollItem.findOne({
    where: {
      payrollRunId,
      employeeId: { [Op.in]: candidateIds }
    }
  });

  return { employee, item, candidateIds };
}

// Runs whose stored items must not change: paid out, or being rebuilt by the engine right now
const FROZEN_RUN_STATUSES = ['PAID', 'PROCESSING'];

const itemFingerprint = (item) => JSON.stringify([
  item.workingDays, item.workedDays, item.lopDays, item.grossEarned, item.totalDeductions,
  item.netSalary, item.reimbursements, item.earningsBreakdown, item.deductionsBreakdown
]);

// Recalculates a stored PayrollItem with PayCalculator (the same figures the wizard preview shows).
// Returns true when any stored figure changed.
async function recalculateItem(item, employee, run) {
  const result = await PayCalculator.computeEmployeePay({
    employee,
    month: run.month,
    wizardState: run.wizardState,
    payrollRunId: run.id,
    mode: 'RECALC',
    existingItem: item
  });

  const before = itemFingerprint(item);
  item.set(PayCalculator.toPayrollItemFields(result));
  if (item.status === 'FAILED') item.status = 'COMPLETED';
  const notes = [...result.notes];
  if (!employee.bankAccountNo || !employee.bankIfscCode) notes.push('Missing bank details. Disbursement will fail.');
  item.errorLog = notes.join(' | ');
  await item.save();
  return itemFingerprint(item) !== before;
}

async function refreshRunTotals(run) {
  const items = await PayrollItem.findAll({ where: { payrollRunId: run.id, status: { [Op.ne]: 'SKIPPED_EXIT' } } });
  run.totalGross = items.reduce((sum, item) => sum + (Number(item.grossEarned) || 0), 0);
  run.totalDeductions = items.reduce((sum, item) => sum + (Number(item.totalDeductions) || 0), 0);
  run.totalNet = items.reduce((sum, item) => sum + (Number(item.netSalary) || 0), 0);
  await run.save();
}

// Brings a processed run's stored items, totals and already-generated payslips in line with its latest wizard state
async function recalculateRunItems(runId, onlyEmployeeIds) {
  const run = await PayrollRun.findByPk(runId);
  if (!run || FROZEN_RUN_STATUSES.includes(run.status)) return;

  const items = await PayrollItem.findAll({ where: { payrollRunId: run.id } });
  if (items.length === 0) return;
  const employees = await Employee.findAll({ where: { id: { [Op.in]: items.map(item => item.employeeId) } } });

  for (const item of items) {
    if (item.status === 'SKIPPED_EXIT') continue;
    if (onlyEmployeeIds && !onlyEmployeeIds.includes(String(item.employeeId))) continue;
    const employee = employees.find(e => String(e.id) === String(item.employeeId));
    if (!employee) continue;

    const changed = await recalculateItem(item, employee, run);
    if (changed && await Payslip.count({ where: { payrollItemId: item.id } }) > 0) {
      await PayslipGenerator.generatePayslipForEmployee(item.id);
    }
  }
  await refreshRunTotals(run);
}

// Serialises recalculations per run, so overlapping wizard auto-saves can't leave items computed from an older state
const runRecalcChains = new Map();
function syncRunItems(runId, onlyEmployeeIds = null) {
  const previous = runRecalcChains.get(runId) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => recalculateRunItems(runId, onlyEmployeeIds));
  runRecalcChains.set(runId, current);
  current
    .finally(() => { if (runRecalcChains.get(runId) === current) runRecalcChains.delete(runId); })
    .catch(() => {});
  return current;
}

// 2. Save / Update wizard session state for a payroll run
router.put('/run/:id/state', async (req, res) => {
  try {
    const { id } = req.params;
    const run = await PayrollRun.findByPk(id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    const currentRaw = run.wizardState || {};
    const currentState = typeof currentRaw === 'string' ? JSON.parse(currentRaw) : currentRaw;
    const incomingState = req.body || {};

    const incomingLop = incomingState.editedLop && typeof incomingState.editedLop === 'object' ? incomingState.editedLop : {};
    const currentLop = currentState.editedLop && typeof currentState.editedLop === 'object' ? currentState.editedLop : {};
    const mergedLop = {
      ...currentLop,
      ...incomingLop
    };

    const incomingWorkingDays = incomingState.editedWorkingDays && typeof incomingState.editedWorkingDays === 'object' ? incomingState.editedWorkingDays : {};
    const currentWorkingDays = currentState.editedWorkingDays && typeof currentState.editedWorkingDays === 'object' ? currentState.editedWorkingDays : {};
    const mergedWorkingDays = {
      ...currentWorkingDays,
      ...incomingWorkingDays
    };

    const incomingLeaves = incomingState.editedLeaves && typeof incomingState.editedLeaves === 'object' ? incomingState.editedLeaves : {};
    const currentLeaves = currentState.editedLeaves && typeof currentState.editedLeaves === 'object' ? currentState.editedLeaves : {};
    const mergedLeaves = {
      ...currentLeaves,
      ...incomingLeaves
    };

    const mergedState = {
      ...currentState,
      ...incomingState,
      editedLop: mergedLop,
      editedWorkingDays: mergedWorkingDays,
      editedLeaves: mergedLeaves,
      updatedAt: new Date().toISOString()
    };

    run.wizardState = mergedState;
    await run.save();

    // Keep already-processed items (and their payslips) identical to what the wizard now shows
    try {
      await syncRunItems(run.id);
    } catch (syncErr) {
      console.warn('Error syncing existing payroll items during state save:', syncErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Wizard state successfully persisted in database.',
      wizardState: mergedState
    });
  } catch (error) {
    console.error('Error saving wizard state:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 3. Direct LOP save endpoint for single employee with candidate matching & cascade recalculation
router.put('/run/:id/lop', async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, lopDays } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required.' });

    const run = await PayrollRun.findByPk(id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    const currentRaw = run.wizardState || {};
    const currentState = typeof currentRaw === 'string' ? JSON.parse(currentRaw) : currentRaw;
    const currentEditedLop = currentState.editedLop || {};

    const numericLop = Number(lopDays || 0);
    currentEditedLop[employeeId] = numericLop;

    const { employee, item } = await resolveEmployeeAndItem(id, employeeId);
    if (employee) {
      if (employee.id) currentEditedLop[employee.id] = numericLop;
      if (employee.empCode) currentEditedLop[employee.empCode] = numericLop;
    }
    currentState.editedLop = currentEditedLop;
    currentState.updatedAt = new Date().toISOString();

    run.wizardState = currentState;
    await run.save();

    if (item && employee) {
      await syncRunItems(run.id, [String(employee.id)]);
      await item.reload();
    }

    return res.status(200).json({
      success: true,
      message: `LOP of ${lopDays} days saved successfully for employee.`,
      employeeId,
      lopDays: numericLop,
      wizardState: currentState,
      updatedItem: item
    });
  } catch (error) {
    console.error('Error saving LOP:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 4. Direct Working Days save endpoint for single employee with candidate matching & cascade recalculation
router.put('/run/:id/working-days', async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, workingDays } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required.' });

    const run = await PayrollRun.findByPk(id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    const currentRaw = run.wizardState || {};
    const currentState = typeof currentRaw === 'string' ? JSON.parse(currentRaw) : currentRaw;
    const currentEditedWd = currentState.editedWorkingDays || {};

    const numWd = Number(workingDays || 0);
    currentEditedWd[employeeId] = numWd;

    const { employee, item } = await resolveEmployeeAndItem(id, employeeId);
    if (employee) {
      if (employee.id) currentEditedWd[employee.id] = numWd;
      if (employee.empCode) currentEditedWd[employee.empCode] = numWd;
    }
    currentState.editedWorkingDays = currentEditedWd;
    currentState.updatedAt = new Date().toISOString();

    run.wizardState = currentState;
    await run.save();

    if (item && employee) {
      await syncRunItems(run.id, [String(employee.id)]);
      await item.reload();
    }

    return res.status(200).json({
      success: true,
      message: `Working days of ${numWd} saved successfully for employee.`,
      employeeId,
      workingDays: numWd,
      wizardState: currentState,
      updatedItem: item
    });
  } catch (error) {
    console.error('Error saving working days:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 5. Direct Leaves save endpoint for single employee
router.put('/run/:id/leaves', async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, leaves } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required.' });

    const run = await PayrollRun.findByPk(id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    const currentRaw = run.wizardState || {};
    const currentState = typeof currentRaw === 'string' ? JSON.parse(currentRaw) : currentRaw;
    const currentEditedLeaves = currentState.editedLeaves || {};

    currentEditedLeaves[employeeId] = leaves || {};
    const { employee } = await resolveEmployeeAndItem(id, employeeId);
    if (employee) {
      if (employee.id) currentEditedLeaves[employee.id] = leaves || {};
      if (employee.empCode) currentEditedLeaves[employee.empCode] = leaves || {};
    }
    currentState.editedLeaves = currentEditedLeaves;
    currentState.updatedAt = new Date().toISOString();

    run.wizardState = currentState;
    await run.save();

    return res.status(200).json({
      success: true,
      message: 'Leaves saved successfully for employee.',
      employeeId,
      leaves,
      wizardState: currentState
    });
  } catch (error) {
    console.error('Error saving leaves:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/process', async (req, res) => {
  try {
    const { payrollRunId } = req.body;
    if (!payrollRunId) return res.status(400).json({ error: 'payrollRunId is required.' });

    const run = await PayrollRun.findByPk(payrollRunId);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    // A run left in PROCESSING by a crashed or restarted job can be processed again
    if (run.status === 'PROCESSING' && PayrollQueue.isRunActive(run.id)) {
      return res.status(400).json({ error: 'Payroll run is already processing.' });
    }
    if (run.status === 'PAID') {
      return res.status(400).json({ error: 'Payroll for this month has already been released and is locked.' });
    }

    const { includedExitedEmployeeIds, skippedExitedEmployeeIds } = req.body;
    const jobId = await PayrollQueue.enqueuePayRun(payrollRunId, { includedExitedEmployeeIds, skippedExitedEmployeeIds });
    return res.status(202).json({ message: 'Payroll processing started in background.', jobId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/job/:jobId', (req, res) => {
  const status = PayrollQueue.getJobStatus(req.params.jobId);
  return res.status(200).json(status);
});

router.post('/approve', async (req, res) => {
  try {
    const { payrollRunId } = req.body;
    const run = await PayrollRun.findByPk(payrollRunId);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    run.status = 'APPROVED';
    await run.save();
    return res.status(200).json(run);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/disburse', async (req, res) => {
  try {
    const { payrollRunId } = req.body;
    let run = await PayrollRun.findByPk(payrollRunId);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
    if (run.status === 'PROCESSING' && PayrollQueue.isRunActive(run.id)) {
      return res.status(400).json({ error: 'Payroll run is still processing. Please try again in a moment.' });
    }

    if (run.status !== 'PAID') {
      const itemCount = await PayrollItem.count({ where: { payrollRunId } });
      if (itemCount === 0 || run.status === 'PROCESSING' || run.status === 'FAILED') {
        // Not (successfully) processed yet: run the same engine Lock & Freeze uses
        run = await PayrollEngine.executePayRun(payrollRunId, { includedExitedEmployeeIds: req.body.includedExitedEmployeeIds || [] });
      } else {
        // Release exactly what the wizard shows: bring stored items in line with the final wizard state
        await syncRunItems(run.id);
        await run.reload();
      }
    }

    await refreshRunTotals(run);
    run.status = 'PAID';
    await run.save();

    // Generate payslips for every completed item in this run
    let payslips = [];
    try {
      payslips = await PayslipGenerator.bulkGenerate(payrollRunId);
    } catch (genErr) {
      console.error('Payslip generation error:', genErr.message, genErr.stack);
    }

    return res.status(200).json({
      run,
      payslipsGenerated: payslips.length,
      message: `Payroll disbursed. ${payslips.length} payslip(s) generated.`
    });
  } catch (error) {
    console.error('Disburse error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Same shape as PayCalculator.computeEmployeePay() for an item that is already stored
function storedItemPreviewRow(item) {
  return {
    employeeId: item.employeeId,
    workingDays: item.workingDays,
    workedDays: item.workedDays,
    lopDays: item.lopDays,
    earnings: item.earningsBreakdown || {},
    deductions: item.deductionsBreakdown || {},
    grossEarned: item.grossEarned,
    totalDeductions: item.totalDeductions,
    reimbursements: item.reimbursements || 0,
    netSalary: item.netSalary,
    isHeld: /on hold/i.test(item.errorLog || ''),
    notes: item.errorLog ? [item.errorLog] : []
  };
}

// Pay run wizard preview. Every salary figure the wizard shows (Step 1, Step 7/8 tables, CSV register)
// comes from PayCalculator - the same calculation Lock & Freeze stores and Form W / payslips read back.
router.post('/run/:id/preview', async (req, res) => {
  try {
    const run = await PayrollRun.findByPk(req.params.id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });

    const items = await PayrollItem.findAll({ where: { payrollRunId: run.id } });

    // Released payroll is final: show exactly what was paid
    if (run.status === 'PAID' && items.length > 0) {
      return res.status(200).json({ runId: run.id, month: run.month, status: run.status, rows: items.map(storedItemPreviewRow) });
    }

    // Unsaved wizard edits are previewed by sending the current wizard state in the body
    const wizardState = PayCalculator.parseWizardState(req.body && req.body.wizardState ? req.body.wizardState : run.wizardState);
    const employees = await Employee.findAll({ where: PayCalculator.payRunWorkforceWhere(wizardState), order: [['name', 'ASC']] });

    const rows = [];
    for (const employee of employees) {
      const existingItem = items.find(item => String(item.employeeId) === String(employee.id) && item.status !== 'SKIPPED_EXIT');
      rows.push(await PayCalculator.computeEmployeePay({
        employee,
        month: run.month,
        wizardState,
        payrollRunId: run.id,
        mode: existingItem ? 'RECALC' : 'PREVIEW',
        existingItem
      }));
    }
    return res.status(200).json({ runId: run.id, month: run.month, status: run.status, rows });
  } catch (error) {
    console.error('Payroll preview error:', error);
    return res.status(500).json({ error: error.message });
  }
});

const ITEM_EMPLOYEE_ATTRIBUTES = [
  'id', 'name', 'empCode', 'department', 'designation',
  'bankAccountNo', 'bankIfscCode', 'bankName',
  'panNumber', 'uanNumber', 'esiNumber',
  'fatherName', 'gender', 'dob', 'joiningDate',
  'compensationGross', 'pfEligible', 'esiEligible', 'ptEligible'
];

router.get('/runs/:id/items', async (req, res) => {
  try {
    const items = await PayrollItem.findAll({
      where: { payrollRunId: req.params.id },
      include: [{ model: Employee, as: 'employee', attributes: ITEM_EMPLOYEE_ATTRIBUTES }]
    });
    if (items.length > 0) return res.status(200).json(items);

    const run = await PayrollRun.findByPk(req.params.id);
    if (!run) return res.status(200).json([]);

    // Not processed yet: once the wizard reaches validation (Step 7), show what processing will store
    const wizardState = PayCalculator.parseWizardState(run.wizardState);
    const isApprovedOrLocked = ['APPROVED', 'PAID', 'COMPLETED', 'LOCKED'].includes(run.status);
    if (Number(wizardState.completedStep || 0) < 7 && !isApprovedOrLocked) {
      return res.status(200).json([]);
    }

    const employees = await Employee.findAll({ where: PayCalculator.payRunWorkforceWhere(wizardState) });
    const draftItems = [];
    for (const employee of employees) {
      const result = await PayCalculator.computeEmployeePay({ employee, month: run.month, wizardState, payrollRunId: run.id, mode: 'PREVIEW' });
      draftItems.push({
        id: `synth-${employee.id}`,
        payrollRunId: run.id,
        employeeId: employee.id,
        ...PayCalculator.toPayrollItemFields(result),
        status: 'DRAFT',
        employee: Object.fromEntries(ITEM_EMPLOYEE_ATTRIBUTES.map(attr => [attr, employee[attr]]))
      });
    }
    return res.status(200).json(draftItems);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- PAYSLIPS ---
router.get('/payslip/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month } = req.query; // YYYY-MM
    
    const query = { employeeId };
    if (month) query.month = month;

    const payslip = await Payslip.findOne({
      where: query,
      order: [['month', 'DESC']]
    });

    if (!payslip) return res.status(404).json({ error: 'Payslip not found.' });
    return res.status(200).json(payslip);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/payslips', async (req, res) => {
  try {
    const payslips = await Payslip.findAll({
      include: [
        { model: Employee, as: 'employee', attributes: ['name', 'department', 'designation'] },
        { model: PayrollItem, as: 'payrollItem', attributes: ['netSalary', 'grossEarned', 'totalDeductions', 'workedDays', 'lopDays'] }
      ],
      order: [['month', 'DESC']]
    });
    return res.status(200).json(payslips);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- UPLOAD CUSTOM PAYSLIP ---
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const payslipStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../../../uploads/payslips');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `payslip-${uniqueSuffix}${ext}`);
  }
});
const uploadPayslipFile = multer({ storage: payslipStorage });

router.post('/payslips/upload', uploadPayslipFile.single('file'), async (req, res) => {
  try {
    const { employeeId, month, netPay } = req.body;
    if (!employeeId || !month) {
      return res.status(400).json({ error: 'employeeId and month (YYYY-MM) are required.' });
    }

    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    let fileUrl = null;
    let filePath = null;
    if (req.file) {
      const protocol = req.protocol;
      const host = req.get('host');
      fileUrl = `${protocol}://${host}/static/uploads/payslips/${req.file.filename}`;
      filePath = req.file.path;
    }

    // Create or update payslip record
    const payslip = await Payslip.create({
      employeeId: String(employeeId),
      month: month,
      filePath: fileUrl || filePath || '/static/uploads/payslips/custom.pdf',
      emailSentStatus: true
    });

    // Share to Employee Documents
    if (fileUrl || filePath) {
      await Document.create({
        title: `Uploaded Payslip - ${month}`,
        filePath: fileUrl || filePath,
        uploaderId: (req.user && req.user.id) || 'ADMIN',
        uploaderName: (req.user && req.user.name) || 'System Admin',
        targetType: 'INDIVIDUAL',
        targetUserId: String(employeeId),
        targetUserName: employee.name,
        fileType: 'pdf',
        fileSize: req.file ? req.file.size : 1024,
        uploadedAt: Date.now()
      });
    }

    return res.status(201).json({
      success: true,
      message: `Payslip for ${employee.name} (${month}) uploaded successfully.`,
      payslip
    });
  } catch (error) {
    console.error('Error uploading custom payslip:', error);
    return res.status(500).json({ error: error.message });
  }
});

// --- DOWNLOAD PAYSLIP / BULK ARCHIVE ---
function resolvePayslipDiskPath(rawPath) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;

  let clean = String(rawPath).replace(/^[/\\]+/, '');
  if (clean.startsWith('static/uploads/')) {
    clean = clean.replace('static/uploads/', '');
  }
  if (clean.startsWith('storage/')) {
    clean = clean.replace('storage/', '');
  }

  const possibleBaseDirs = [
    process.env.STORAGE_PATH,
    path.join(__dirname, '../../../../storage'),
    path.join(__dirname, '../../../../../storage'),
    path.join(__dirname, '../../../../uploads'),
    path.join(__dirname, '../../../../../uploads'),
    path.join(__dirname, '../../../../static/uploads'),
    path.join(__dirname, '../../../../../static/uploads'),
    process.cwd()
  ].filter(Boolean);

  for (const base of possibleBaseDirs) {
    const full = path.join(base, clean);
    if (fs.existsSync(full)) return full;
    const fullWithPayslips = path.join(base, 'payslips', path.basename(clean));
    if (fs.existsSync(fullWithPayslips)) return fullWithPayslips;
  }
  return null;
}

router.get('/payslips/download-archive', async (req, res) => {
  try {
    const { month, employeeId } = req.query;
    if (!month) {
      return res.status(400).json({ error: 'Month (YYYY-MM) is required.' });
    }

    // 1. Single Employee Payslip Download (Returns direct .pdf)
    if (employeeId && employeeId !== 'ALL' && employeeId !== '') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(employeeId));
      const whereCondition = { month };
      if (isUuid) {
        whereCondition[Op.or] = [
          { employeeId: String(employeeId) },
          { id: String(employeeId) }
        ];
      } else {
        whereCondition.employeeId = String(employeeId);
      }

      let payslip = await Payslip.findOne({
        where: whereCondition,
        include: [
          { model: Employee, as: 'employee' },
          { model: PayrollItem, as: 'payrollItem' }
        ]
      });

      // If not found by direct employeeId, match employee by empCode or id
      if (!payslip) {
        const emp = await Employee.findOne({
          where: {
            [Op.or]: [
              { id: String(employeeId) },
              { empCode: String(employeeId) }
            ]
          }
        });
        if (emp) {
          payslip = await Payslip.findOne({
            where: { month, employeeId: emp.id },
            include: [
              { model: Employee, as: 'employee' },
              { model: PayrollItem, as: 'payrollItem' }
            ]
          });
        }
      }

      if (!payslip) {
        return res.status(404).json({ error: `No payslip found for employee ${employeeId} in cycle ${month}.` });
      }

      const emp = payslip.employee || {};
      const rawName = emp.name || emp.empCode || payslip.employeeId || 'Employee';
      const cleanName = String(rawName).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Employee';
      const downloadFilename = `Payslip_${cleanName}_${month}.pdf`;

      const shouldRegenerate = req.query.regenerate === 'true' || req.query.fresh === 'true';
      // Check if already on disk as .pdf (unless fresh regeneration requested)
      const diskPath = !shouldRegenerate ? resolvePayslipDiskPath(payslip.filePath) : null;
      if (diskPath && diskPath.toLowerCase().endsWith('.pdf') && fs.existsSync(diskPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        return fs.createReadStream(diskPath).pipe(res);
      }

      // Check if a companion .pdf exists in the storage directory
      if (diskPath && fs.existsSync(diskPath)) {
        const companionPdf = diskPath.replace(/\.html$/i, '.pdf');
        if (fs.existsSync(companionPdf)) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
          return fs.createReadStream(companionPdf).pipe(res);
        }
      }

      // Generate vector PDF on the fly
      const pdfBuffer = await PayslipGenerator.generatePdfBuffer(emp, month, payslip.payrollItem);

      // Cache PDF to storage directory for fast subsequent downloads
      try {
        const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../../../../storage');
        const folder = path.join(STORAGE_PATH, 'payslips');
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        const cachePath = path.join(folder, `payslip_${emp.id || payslip.employeeId}_${month}.pdf`);
        fs.writeFileSync(cachePath, pdfBuffer);
      } catch (cacheErr) {
        console.warn('Could not cache generated payslip PDF:', cacheErr.message);
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
      return res.send(pdfBuffer);
    }

    // 2. Bulk All Employees Payslips Download (ZIP archive with individual PDF files per employee)
    const payslips = await Payslip.findAll({
      where: { month },
      include: [
        { model: Employee, as: 'employee' },
        { model: PayrollItem, as: 'payrollItem' }
      ],
      order: [['createdAt', 'ASC']]
    });

    if (!payslips || payslips.length === 0) {
      return res.status(404).json({ error: `No payslips found for cycle ${month}.` });
    }

    const zipFilename = `Payslips_All_Employees_${month}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('Error in payslips zip archive creation:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Archive creation failed: ' + err.message });
      }
    });

    archive.pipe(res);

    const usedNames = new Set();
    const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../../../../storage');
    const folder = path.join(STORAGE_PATH, 'payslips');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    for (const ps of payslips) {
      const emp = ps.employee || {};
      const rawName = emp.name || emp.empCode || ps.employeeId || 'Employee';
      const cleanName = String(rawName).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Employee';

      let entryName = `Payslip_${cleanName}_${month}.pdf`;
      if (usedNames.has(entryName.toLowerCase())) {
        const disambig = String(emp.empCode || ps.employeeId || Math.random().toString(36).substring(7)).replace(/[^\w-]/g, '');
        entryName = `Payslip_${cleanName}_${disambig}_${month}.pdf`;
      }
      usedNames.add(entryName.toLowerCase());

      // If pre-existing .pdf exists on disk (unless fresh regeneration requested)
      const shouldRegenerate = req.query.regenerate === 'true' || req.query.fresh === 'true';
      const diskPath = !shouldRegenerate ? resolvePayslipDiskPath(ps.filePath) : null;
      if (diskPath && diskPath.toLowerCase().endsWith('.pdf') && fs.existsSync(diskPath)) {
        archive.file(diskPath, { name: entryName });
        continue;
      }

      // Check companion .pdf
      if (diskPath && fs.existsSync(diskPath)) {
        const companionPdf = diskPath.replace(/\.html$/i, '.pdf');
        if (fs.existsSync(companionPdf)) {
          archive.file(companionPdf, { name: entryName });
          continue;
        }
      }

      // Generate PDF buffer using PDFKit
      try {
        const pdfBuffer = await PayslipGenerator.generatePdfBuffer(emp, month, ps.payrollItem);
        // Cache to disk
        try {
          const cachePath = path.join(folder, `payslip_${emp.id || ps.employeeId}_${month}.pdf`);
          fs.writeFileSync(cachePath, pdfBuffer);
        } catch (e) {}

        archive.append(pdfBuffer, { name: entryName });
      } catch (genErr) {
        console.error(`Error generating PDF for ${rawName}:`, genErr);
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Error downloading payslip archive:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

router.post('/dispatch-payslips', async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return res.status(400).json({ error: 'month is required' });

    const payslips = await Payslip.findAll({
      where: { month },
      include: [{ model: Employee, as: 'employee' }]
    });

    let dispatchCount = 0;

    for (const ps of payslips) {
      if (!ps.employee) continue;

      // Mark email as sent
      ps.emailSentStatus = true;
      await ps.save();

      // Share document to employee app
      if (ps.filePath) {
        await Document.create({
          title: `Payslip - ${month}`,
          filePath: ps.filePath,
          uploaderId: (req.user && req.user.id) || 'ADMIN',
          uploaderName: (req.user && req.user.name) || 'System Admin',
          targetType: 'INDIVIDUAL',
          targetUserId: ps.employee.id,
          targetUserName: ps.employee.name,
          fileType: 'pdf', // payslip generated is html, but assuming pdf handling
          fileSize: 1024,
          uploadedAt: Date.now()
        });
      }

      console.log(`[Email Service Mock] Sent Payslip for ${month} to ${ps.employee.email}`);
      dispatchCount++;
    }

    return res.status(200).json({ message: `Successfully dispatched ${dispatchCount} payslips.` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- LOANS & ADVANCS ---
router.post('/loans', async (req, res) => {
  try {
    const { employeeId, principalAmount, tenureMonths, interestRate } = req.body;
    if (!employeeId || !principalAmount || !tenureMonths) {
      return res.status(400).json({ error: 'employeeId, principalAmount and tenureMonths are required.' });
    }

    const principal = Number(principalAmount);
    const months = Number(tenureMonths);
    const emi = Math.round(principal / months);

    const loan = await Loan.create({
      employeeId,
      principalAmount: principal,
      interestRate: Number(interestRate) || 0,
      tenureMonths: months,
      emiAmount: emi,
      remainingBalance: principal,
      status: 'ACTIVE'
    });

    return res.status(201).json(loan);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/loans', async (req, res) => {
  try {
    const loans = await Loan.findAll({
      include: [
        { model: Employee, as: 'employee', attributes: ['name'] },
        { model: LoanRepayment, as: 'repayments' }
      ]
    });
    return res.status(200).json(loans);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- REIMBURSEMENTS ---
router.post('/reimbursements', async (req, res) => {
  try {
    const { employeeId, title, category, amount, receiptUrl } = req.body;
    if (!employeeId || !title || !amount) {
      return res.status(400).json({ error: 'employeeId, title and amount are required.' });
    }

    const claim = await Reimbursement.create({
      employeeId,
      title,
      category: category || 'OTHER',
      amount: Number(amount),
      receiptUrl,
      status: 'PENDING'
    });

    return res.status(201).json(claim);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/reimbursements', async (req, res) => {
  try {
    const claims = await Reimbursement.findAll({
      include: [{ model: Employee, as: 'employee', attributes: ['name'] }]
    });
    return res.status(200).json(claims);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/reimbursements/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const claim = await Reimbursement.findByPk(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found.' });

    claim.status = status;
    await claim.save();

    return res.status(200).json(claim);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- SALARY STRUCTURES ---
router.post('/structures', async (req, res) => {
  try {
    const { employeeId, ctc, grossSalary, effectiveFrom } = req.body;
    if (!employeeId || !ctc || !grossSalary || !effectiveFrom) {
      return res.status(400).json({ error: 'employeeId, ctc, grossSalary and effectiveFrom are required.' });
    }

    // Set any existing structures for employee to INACTIVE
    await SalaryStructure.update(
      { status: 'INACTIVE', effectiveTo: effectiveFrom },
      { where: { employeeId, status: 'ACTIVE' } }
    );

    const structure = await SalaryStructure.create({
      employeeId,
      ctc: Number(ctc),
      grossSalary: Number(grossSalary),
      effectiveFrom,
      status: 'ACTIVE',
      version: 1
    });

    return res.status(201).json(structure);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/structures/:employeeId', async (req, res) => {
  try {
    const structure = await SalaryStructure.findOne({
      where: { employeeId: req.params.employeeId, status: 'ACTIVE' }
    });
    if (!structure) return res.status(404).json({ error: 'No active structure found.' });
    return res.status(200).json(structure);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- COMPONENTS ---
router.post('/components', async (req, res) => {
  try {
    const { id, name, type, calculationType, formula, isStatutory, isTaxable } = req.body;
    if (!id || !name || !type || !calculationType) {
      return res.status(400).json({ error: 'id, name, type and calculationType are required.' });
    }

    const component = await SalaryComponent.create({
      id,
      name,
      type,
      calculationType,
      formula,
      isStatutory: !!isStatutory,
      isTaxable: isTaxable !== false
    });

    return res.status(201).json(component);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/components', async (req, res) => {
  try {
    const components = await SalaryComponent.findAll();
    return res.status(200).json(components);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- TAX SELF SERVICE ---
router.get('/tax/:employeeId', async (req, res) => {
  try {
    const record = await TaxRecord.findOne({
      where: { employeeId: req.params.employeeId },
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(record || {});
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/tax/:employeeId', async (req, res) => {
  try {
    const { regime, investmentDeclarations, financialYear } = req.body;
    const { employeeId } = req.params;

    let record = await TaxRecord.findOne({
      where: { employeeId, financialYear: financialYear || '2026-2027' }
    });

    if (record) {
      if (regime) record.regime = regime;
      if (investmentDeclarations) record.investmentDeclarations = investmentDeclarations;
      await record.save();
    } else {
      record = await TaxRecord.create({
        employeeId,
        regime: regime || 'NEW',
        investmentDeclarations: investmentDeclarations || {},
        financialYear: financialYear || '2026-2027'
      });
    }

    return res.status(200).json(record);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- UPDATE PAYROLL ITEM (e.g. for LOP manual edit) ---
router.put('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { lopDays, workingDays } = req.body;

    const item = await PayrollItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Payroll item not found.' });

    const run = await PayrollRun.findByPk(item.payrollRunId);
    const employee = await Employee.findByPk(item.employeeId);
    if (!run || !employee) return res.status(404).json({ error: 'Payroll run or employee not found.' });

    // Edits live in the wizard state (the calculator's input); the item is then recalculated from it
    const wizardState = PayCalculator.parseWizardState(run.wizardState);
    if (lopDays !== undefined) {
      wizardState.editedLop = { ...(wizardState.editedLop || {}), [employee.id]: Number(lopDays) };
    }
    if (workingDays !== undefined) {
      wizardState.editedWorkingDays = { ...(wizardState.editedWorkingDays || {}), [employee.id]: Number(workingDays) };
    }
    wizardState.updatedAt = new Date().toISOString();
    run.wizardState = wizardState;
    await run.save();

    await syncRunItems(run.id, [String(employee.id)]);
    await item.reload();
    return res.status(200).json(item);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
