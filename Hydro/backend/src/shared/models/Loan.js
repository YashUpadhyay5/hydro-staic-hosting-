const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Loan = sequelize.define('Loan', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: false,
  },
  principalAmount: {
    type: DataTypes.DOUBLE,
    field: 'principal_amount',
    allowNull: false,
  },
  interestRate: {
    type: DataTypes.DOUBLE,
    field: 'interest_rate',
    defaultValue: 0, // Flat interest or 0 interest advance
  },
  tenureMonths: {
    type: DataTypes.INTEGER,
    field: 'tenure_months',
    allowNull: false,
  },
  emiAmount: {
    type: DataTypes.DOUBLE,
    field: 'emi_amount',
    allowNull: false,
  },
  remainingBalance: {
    type: DataTypes.DOUBLE,
    field: 'remaining_balance',
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'ACTIVE', // 'PENDING', 'ACTIVE', 'CLOSED', 'REJECTED'
  }
}, {
  tableName: 'loans',
  timestamps: true,
  underscored: true
});

module.exports = Loan;
