const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const PayrollItem = sequelize.define('PayrollItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  payrollRunId: {
    type: DataTypes.UUID,
    field: 'payroll_run_id',
    allowNull: false,
  },
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: false,
  },
  workingDays: {
    type: DataTypes.DOUBLE,
    field: 'working_days',
    defaultValue: 30,
  },
  workedDays: {
    type: DataTypes.DOUBLE,
    field: 'worked_days',
    defaultValue: 30,
  },
  lopDays: {
    type: DataTypes.DOUBLE,
    field: 'lop_days',
    defaultValue: 0,
  },
  overtimeHours: {
    type: DataTypes.DOUBLE,
    field: 'overtime_hours',
    defaultValue: 0,
  },
  earningsBreakdown: {
    type: DataTypes.TEXT,
    field: 'earnings_breakdown', // Store JSON string: { BASIC: 12000, HRA: 4800, SPECIAL: 3000 }
    defaultValue: '{}',
    get() {
      const val = this.getDataValue('earningsBreakdown');
      return val ? JSON.parse(val) : {};
    },
    set(val) {
      this.setDataValue('earningsBreakdown', JSON.stringify(val));
    }
  },
  deductionsBreakdown: {
    type: DataTypes.TEXT,
    field: 'deductions_breakdown', // Store JSON string: { PF_EE: 1440, ESI_EE: 126, PT: 200, LWF: 10, TDS: 1500, LOAN_EMI: 2500 }
    defaultValue: '{}',
    get() {
      const val = this.getDataValue('deductionsBreakdown');
      return val ? JSON.parse(val) : {};
    },
    set(val) {
      this.setDataValue('deductionsBreakdown', JSON.stringify(val));
    }
  },
  grossEarned: {
    type: DataTypes.DOUBLE,
    field: 'gross_earned',
    defaultValue: 0,
  },
  totalDeductions: {
    type: DataTypes.DOUBLE,
    field: 'total_deductions',
    defaultValue: 0,
  },
  netSalary: {
    type: DataTypes.DOUBLE,
    field: 'net_salary',
    defaultValue: 0,
  },
  reimbursements: {
    type: DataTypes.DOUBLE,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'DRAFT', // 'DRAFT', 'COMPLETED', 'FAILED'
  },
  professionalTaxAmount: {
    type: DataTypes.DOUBLE,
    field: 'professional_tax_amount',
    allowNull: true,
    defaultValue: 0,
  },
  professionalTaxRuleId: {
    type: DataTypes.STRING,
    field: 'professional_tax_rule_id',
    allowNull: true,
  },
  professionalTaxStateId: {
    type: DataTypes.STRING,
    field: 'professional_tax_state_id',
    allowNull: true,
  },
  professionalTaxSalaryBasis: {
    type: DataTypes.STRING,
    field: 'professional_tax_salary_basis',
    allowNull: true,
  },
  professionalTaxCalculationDate: {
    type: DataTypes.STRING,
    field: 'professional_tax_calculation_date',
    allowNull: true,
  },
  errorLog: {
    type: DataTypes.TEXT,
    field: 'error_log',
    allowNull: true,
  }
}, {
  tableName: 'payroll_items',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['payroll_run_id', 'employee_id'] },
    { fields: ['payroll_run_id'] }
  ]
});

module.exports = PayrollItem;
