const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProfessionalTaxRule = sequelize.define('ProfessionalTaxRule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  stateId: {
    type: DataTypes.UUID,
    field: 'state_id',
    allowNull: false,
    references: {
      model: 'professional_tax_states',
      key: 'id'
    }
  },
  ruleName: {
    type: DataTypes.STRING,
    field: 'rule_name',
    allowNull: true,
  },
  salaryFrom: {
    type: DataTypes.FLOAT,
    field: 'salary_from',
    allowNull: false,
    defaultValue: 0,
  },
  salaryTo: {
    type: DataTypes.FLOAT,
    field: 'salary_to',
    allowNull: false,
    defaultValue: 999999999,
  },
  ptAmount: {
    type: DataTypes.FLOAT,
    field: 'pt_amount',
    allowNull: false,
    defaultValue: 0,
  },
  calculationType: {
    type: DataTypes.STRING,
    field: 'calculation_type',
    allowNull: false,
    defaultValue: 'FIXED', // 'FIXED', 'PERCENTAGE', 'FORMULA'
  },
  formulaExpression: {
    type: DataTypes.STRING,
    field: 'formula_expression',
    allowNull: true,
  },
  periodType: {
    type: DataTypes.STRING,
    field: 'period_type',
    allowNull: false,
    defaultValue: 'MONTHLY', // 'MONTHLY', 'QUARTERLY', 'ANNUAL'
  },
  monthSpecificRules: {
    type: DataTypes.TEXT, // Stored as JSON string, e.g. '{"2":300,"3":300}'
    field: 'month_specific_rules',
    allowNull: true,
  },
  gender: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ALL', // 'ALL', 'MALE', 'FEMALE'
  },
  employeeCategory: {
    type: DataTypes.STRING,
    field: 'employee_category',
    allowNull: false,
    defaultValue: 'ALL', // 'ALL', 'EMPLOYEE', 'CONTRACTOR', 'OTHER'
  },
  isExemption: {
    type: DataTypes.BOOLEAN,
    field: 'is_exemption',
    allowNull: false,
    defaultValue: false,
  },
  exemptionType: {
    type: DataTypes.STRING,
    field: 'exemption_type',
    allowNull: true, // 'NONE', 'AGE', 'GENDER', 'DISABILITY', 'CATEGORY', 'SALARY', 'CUSTOM'
  },
  exemptionValue: {
    type: DataTypes.STRING,
    field: 'exemption_value',
    allowNull: true,
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
  isActive: {
    type: DataTypes.BOOLEAN,
    field: 'is_active',
    allowNull: false,
    defaultValue: true,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ACTIVE', // 'DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'DISABLED'
  },
  priority: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
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
  tableName: 'professional_tax_rules',
  timestamps: true,
  underscored: true,
});

const ProfessionalTaxState = require('./ProfessionalTaxState');
ProfessionalTaxRule.belongsTo(ProfessionalTaxState, { foreignKey: 'stateId', as: 'state' });
ProfessionalTaxState.hasMany(ProfessionalTaxRule, { foreignKey: 'stateId', as: 'rules' });

module.exports = ProfessionalTaxRule;
