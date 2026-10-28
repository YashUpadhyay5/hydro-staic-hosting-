const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const SalaryStructure = sequelize.define('SalaryStructure', {
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
  ctc: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    defaultValue: 0,
  },
  grossSalary: {
    type: DataTypes.DOUBLE,
    field: 'gross_salary',
    allowNull: false,
    defaultValue: 0,
  },
  effectiveFrom: {
    type: DataTypes.STRING,
    field: 'effective_from', // YYYY-MM-DD
    allowNull: false,
  },
  effectiveTo: {
    type: DataTypes.STRING,
    field: 'effective_to', // YYYY-MM-DD, null means current active
    allowNull: true,
  },
  version: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'ACTIVE', // 'ACTIVE' or 'INACTIVE'
  },
  revisionReason: {
    type: DataTypes.STRING,
    field: 'revision_reason',
    allowNull: true,
    defaultValue: 'Salary Revision',
  }
}, {
  tableName: 'salary_structures',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['employee_id', 'status'] },
    { fields: ['employee_id'] }
  ]
});

module.exports = SalaryStructure;
