const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const PayrollRun = sequelize.define('PayrollRun', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  month: {
    type: DataTypes.STRING, // format: YYYY-MM
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'DRAFT', // 'DRAFT', 'PROCESSING', 'APPROVED', 'PAID', 'FAILED'
  },
  totalGross: {
    type: DataTypes.DOUBLE,
    field: 'total_gross',
    defaultValue: 0,
  },
  totalDeductions: {
    type: DataTypes.DOUBLE,
    field: 'total_deductions',
    defaultValue: 0,
  },
  totalNet: {
    type: DataTypes.DOUBLE,
    field: 'total_net',
    defaultValue: 0,
  },
  processedBy: {
    type: DataTypes.STRING,
    field: 'processed_by',
    allowNull: true,
  },
  errorMessage: {
    type: DataTypes.TEXT,
    field: 'error_message',
    allowNull: true,
  },
  attendanceLocked: {
    type: DataTypes.BOOLEAN,
    field: 'attendance_locked',
    defaultValue: false,
  },
  wizardState: {
    type: DataTypes.TEXT,
    field: 'wizard_state',
    defaultValue: '{}',
    get() {
      const raw = this.getDataValue('wizardState');
      if (!raw) return {};
      try {
        return typeof raw === 'object' ? raw : JSON.parse(raw);
      } catch (e) {
        return {};
      }
    },
    set(val) {
      this.setDataValue('wizardState', typeof val === 'string' ? val : JSON.stringify(val || {}));
    }
  }
}, {
  tableName: 'payroll_runs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status'] },
    { fields: ['month'] }
  ]
});

module.exports = PayrollRun;
