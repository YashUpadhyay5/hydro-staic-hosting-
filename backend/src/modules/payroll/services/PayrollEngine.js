const {
  Employee,
  PayrollItem,
  PayrollRun,
  Payslip,
  Loan,
  LoanRepayment,
  Reimbursement
} = require('../../../shared/models/index');
const { Op } = require('sequelize');
const ProfessionalTaxService = require('../../../core/utils/ProfessionalTaxService');
const PayCalculator = require('./PayCalculator');

class PayrollEngine {
  /**
   * Helper to get total days in a month
   */
  getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /**
   * Calculates statutory Professional Tax dynamically using ProfessionalTaxService (No hardcoding)
   */
  async calculateProfessionalTax(gross, stateCode = 'TN', gender = 'ALL', date = new Date().toISOString().split('T')[0]) {
    const dummyEmp = { ptEligible: true, ptStateCode: stateCode, gender };
    const res = await ProfessionalTaxService.calculateProfessionalTax({
      employee: dummyEmp,
      grossSalary: gross,
      payrollDate: date
    });
    return res.ptAmount || 0;
  }

  /**
   * Calculates and stores one employee's PayrollItem for a run.
   * All figures come from PayCalculator, the same calculation the pay run wizard previews.
   */
  async processEmployeePayroll(employeeId, year, month, payrollRunId, transaction = null) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    try {
      const employee = await Employee.findByPk(employeeId, { transaction });
      if (!employee) {
        throw new Error(`Employee ${employeeId} not found.`);
      }
      const run = payrollRunId ? await PayrollRun.findByPk(payrollRunId, { transaction }) : null;

      const result = await PayCalculator.computeEmployeePay({
        employee,
        month: monthStr,
        wizardState: run ? run.wizardState : {},
        payrollRunId,
        mode: 'PROCESS',
        transaction
      });

      const errorLogs = [...result.notes];
      if (!employee.bankAccountNo || !employee.bankIfscCode) {
        errorLogs.push('Missing bank details. Disbursement will fail.');
      }

      const payrollItem = await PayrollItem.create({
        payrollRunId,
        employeeId,
        ...PayCalculator.toPayrollItemFields(result),
        status: 'COMPLETED',
        errorLog: errorLogs.join(' | ')
      }, { transaction });

      // Reimbursements paid with this salary belong to this run
      if (result.claimIds.length > 0) {
        await Reimbursement.update(
          { processedInRunId: payrollRunId },
          { where: { id: { [Op.in]: result.claimIds } }, transaction }
        );
      }

      // Book the loan EMI recovered by this salary
      const emi = result.deductions.LOAN_EMI || 0;
      if (result.loanId && emi > 0) {
        const loan = await Loan.findByPk(result.loanId, { transaction });
        await LoanRepayment.create({
          loanId: loan.id,
          payrollItemId: payrollItem.id,
          amountPaid: emi,
          source: 'PAYROLL'
        }, { transaction });

        loan.remainingBalance = Number(loan.remainingBalance) - emi;
        if (loan.remainingBalance <= 0) {
          loan.status = 'CLOSED';
        }
        await loan.save({ transaction });
      }

      return payrollItem;

    } catch (err) {
      console.error(`Error processing payroll for employee ${employeeId}:`, err);
      return await PayrollItem.create({
        payrollRunId,
        employeeId,
        workingDays: 0,
        workedDays: 0,
        lopDays: 0,
        grossEarned: 0,
        totalDeductions: 0,
        netSalary: 0,
        status: 'FAILED',
        errorLog: err.message
      }, { transaction });
    }
  }

  /**
   * Removes a run's previous results so it can be recalculated. Payslips go first (they reference
   * the items), loan EMIs booked by the run are given back and its reimbursements are released.
   */
  async clearRunItems(payrollRunId, transaction = null) {
    const items = await PayrollItem.findAll({ where: { payrollRunId }, transaction });
    const itemIds = items.map(item => item.id);
    if (itemIds.length === 0) return;

    const repayments = await LoanRepayment.findAll({ where: { payrollItemId: { [Op.in]: itemIds } }, transaction });
    for (const repayment of repayments) {
      const loan = await Loan.findByPk(repayment.loanId, { transaction });
      if (loan) {
        const closedByRepayment = loan.status === 'CLOSED' && Number(loan.remainingBalance) <= 0;
        loan.remainingBalance = Number(loan.remainingBalance) + Number(repayment.amountPaid || 0);
        if (closedByRepayment && loan.remainingBalance > 0) {
          loan.status = 'ACTIVE';
        }
        await loan.save({ transaction });
      }
      await repayment.destroy({ transaction });
    }

    await Reimbursement.update({ processedInRunId: null }, { where: { processedInRunId: payrollRunId }, transaction });
    await Payslip.destroy({ where: { payrollItemId: { [Op.in]: itemIds } }, transaction });
    await PayrollItem.destroy({ where: { payrollRunId }, transaction });
  }

  /**
   * Execute complete payroll processing run
   */
  async executePayRun(payrollRunId, options = {}) {
    const run = await PayrollRun.findByPk(payrollRunId);
    if (!run) throw new Error('Payroll run not found.');

    run.status = 'PROCESSING';
    run.attendanceLocked = true;
    run.errorMessage = null;
    await run.save();

    try {
      const [year, month] = run.month.split('-').map(n => parseInt(n, 10));

      // Same workforce the wizard shows
      const employees = await Employee.findAll({
        where: PayCalculator.payRunWorkforceWhere(run.wizardState, options.includedExitedEmployeeIds || [])
      });

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      let runFailed = false;

      // Replace the previous results atomically: a failure leaves the earlier items untouched
      await PayrollRun.sequelize.transaction(async (transaction) => {
        await this.clearRunItems(run.id, transaction);

        for (const emp of employees) {
          const item = await this.processEmployeePayroll(emp.id, year, month, run.id, transaction);
          if (item.status === 'FAILED') runFailed = true;
          totalGross += item.grossEarned || 0;
          totalDeductions += item.totalDeductions || 0;
          totalNet += item.netSalary || 0;
        }
      });

      run.totalGross = totalGross;
      run.totalDeductions = totalDeductions;
      run.totalNet = totalNet;
      run.status = runFailed ? 'FAILED' : 'APPROVED';
      await run.save();

      return run;
    } catch (err) {
      // Never leave the run stuck in PROCESSING; it can simply be processed again
      run.status = 'FAILED';
      run.errorMessage = err.message;
      await run.save();
      throw err;
    }
  }
}

module.exports = new PayrollEngine();
