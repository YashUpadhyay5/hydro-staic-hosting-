const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const LoanRepayment = sequelize.define('LoanRepayment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  loanId: {
    type: DataTypes.UUID,
    field: 'loan_id',
    allowNull: false,
  },
  payrollItemId: {
    type: DataTypes.UUID,
    field: 'payroll_item_id',
    allowNull: true, // Nullable if paid manually (cash/bank transfer outside payroll run)
  },
  amountPaid: {
    type: DataTypes.DOUBLE,
    field: 'amount_paid',
    allowNull: false,
  },
  repaymentDate: {
    type: DataTypes.DATE,
    field: 'repayment_date',
    defaultValue: DataTypes.NOW,
  },
  source: {
    type: DataTypes.STRING,
    defaultValue: 'PAYROLL', // 'PAYROLL', 'MANUAL'
  }
}, {
  tableName: 'loan_repayments',
  timestamps: true,
  underscored: true
});

module.exports = LoanRepayment;
