const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Payslip = sequelize.define('Payslip', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  payrollItemId: {
    type: DataTypes.UUID,
    field: 'payroll_item_id',
    allowNull: false,
  },
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: false,
  },
  month: {
    type: DataTypes.STRING, // YYYY-MM
    allowNull: false,
  },
  filePath: {
    type: DataTypes.STRING,
    field: 'file_path',
    allowNull: true,
  },
  secureHash: {
    type: DataTypes.STRING,
    field: 'secure_hash',
    allowNull: true,
  },
  emailSentStatus: {
    type: DataTypes.BOOLEAN,
    field: 'email_sent_status',
    defaultValue: false,
  }
}, {
  tableName: 'payslips',
  timestamps: true,
  underscored: true
});

module.exports = Payslip;
