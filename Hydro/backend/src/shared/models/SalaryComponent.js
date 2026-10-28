const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const SalaryComponent = sequelize.define('SalaryComponent', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true, // e.g. BASIC, HRA, SPECIAL_ALLOWANCE, PF_EE, ESI_EE, PT, LWF, TDS
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false, // 'EARNING' or 'DEDUCTION'
  },
  calculationType: {
    type: DataTypes.STRING,
    field: 'calculation_type',
    allowNull: false, // 'FLAT' or 'FORMULA'
  },
  formula: {
    type: DataTypes.STRING,
    allowNull: true, // e.g., 'BASIC * 0.4'
  },
  isStatutory: {
    type: DataTypes.BOOLEAN,
    field: 'is_statutory',
    defaultValue: false,
  },
  isTaxable: {
    type: DataTypes.BOOLEAN,
    field: 'is_taxable',
    defaultValue: true,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'ACTIVE', // 'ACTIVE' or 'INACTIVE'
  }
}, {
  tableName: 'salary_components',
  timestamps: true,
  underscored: true
});

module.exports = SalaryComponent;
