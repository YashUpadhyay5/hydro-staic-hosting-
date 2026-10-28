const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Reimbursement = sequelize.define('Reimbursement', {
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
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  category: {
    type: DataTypes.STRING,
    defaultValue: 'OTHER', // 'FUEL', 'TRAVEL', 'BROADBAND', 'MEDICAL', 'OTHER'
  },
  amount: {
    type: DataTypes.DOUBLE,
    allowNull: false,
  },
  claimDate: {
    type: DataTypes.DATE,
    field: 'claim_date',
    defaultValue: DataTypes.NOW,
  },
  receiptUrl: {
    type: DataTypes.STRING,
    field: 'receipt_url',
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'PENDING', // 'PENDING', 'APPROVED', 'REJECTED'
  },
  processedInRunId: {
    type: DataTypes.UUID,
    field: 'processed_in_run_id',
    allowNull: true,
  }
}, {
  tableName: 'reimbursements',
  timestamps: true,
  underscored: true
});

module.exports = Reimbursement;
