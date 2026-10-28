const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProfessionalTaxState = sequelize.define('ProfessionalTaxState', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  stateCode: {
    type: DataTypes.STRING,
    field: 'state_code',
    allowNull: false,
    unique: true,
  },
  stateName: {
    type: DataTypes.STRING,
    field: 'state_name',
    allowNull: false,
  },
  countryCode: {
    type: DataTypes.STRING,
    field: 'country_code',
    allowNull: false,
    defaultValue: 'IN',
  },
  taxName: {
    type: DataTypes.STRING,
    field: 'tax_name',
    allowNull: false,
    defaultValue: 'Professional Tax',
  },
  isEnabled: {
    type: DataTypes.BOOLEAN,
    field: 'is_enabled',
    allowNull: false,
    defaultValue: true,
  },
  salaryBasis: {
    type: DataTypes.STRING,
    field: 'salary_basis',
    allowNull: false,
    defaultValue: 'GROSS_SALARY', // 'GROSS_SALARY', 'BASIC_SALARY', 'TAXABLE_SALARY', 'TOTAL_EARNINGS'
  },
  maxAnnualPt: {
    type: DataTypes.FLOAT,
    field: 'max_annual_pt',
    allowNull: true,
    defaultValue: 2500,
  },
  maxMonthlyPt: {
    type: DataTypes.FLOAT,
    field: 'max_monthly_pt',
    allowNull: true,
  },
  frequency: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'MONTHLY', // 'MONTHLY', 'QUARTERLY', 'ANNUAL'
  },
  effectiveFrom: {
    type: DataTypes.STRING,
    field: 'effective_from',
    allowNull: false,
    defaultValue: '2026-04-01',
  },
  effectiveTo: {
    type: DataTypes.STRING,
    field: 'effective_to',
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  createdBy: {
    type: DataTypes.STRING,
    field: 'created_by',
    allowNull: true,
  },
  updatedBy: {
    type: DataTypes.STRING,
    field: 'updated_by',
    allowNull: true,
  }
}, {
  tableName: 'professional_tax_states',
  timestamps: true,
  underscored: true,
});

module.exports = ProfessionalTaxState;
