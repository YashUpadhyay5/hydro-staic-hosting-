const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const EmployeeSalaryComponent = sequelize.define('EmployeeSalaryComponent', {
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
  componentId: {
    type: DataTypes.STRING,
    field: 'component_id',
    allowNull: false,
  },
  value: {
    type: DataTypes.STRING, // Can hold a flat value (e.g. 15000) or a custom formula override
    allowNull: false,
  }
}, {
  tableName: 'employee_salary_components',
  timestamps: true,
  underscored: true
});

module.exports = EmployeeSalaryComponent;
