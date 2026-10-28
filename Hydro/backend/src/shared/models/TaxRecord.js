const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const TaxRecord = sequelize.define('TaxRecord', {
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
  financialYear: {
    type: DataTypes.STRING,
    field: 'financial_year',
    allowNull: false, // e.g. '2026-2027'
  },
  regime: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'NEW', // 'OLD' or 'NEW'
  },
  investmentDeclarations: {
    type: DataTypes.TEXT,
    field: 'investment_declarations', // JSON: { sec80C: 150000, sec80D: 25000, hraRentPaid: 12000, otherDeductions: 0 }
    defaultValue: '{}',
    get() {
      const val = this.getDataValue('investmentDeclarations');
      return val ? JSON.parse(val) : {};
    },
    set(val) {
      this.setDataValue('investmentDeclarations', JSON.stringify(val));
    }
  },
  projectedAnnualTax: {
    type: DataTypes.DOUBLE,
    field: 'projected_annual_tax',
    defaultValue: 0,
  },
  monthlyTds: {
    type: DataTypes.DOUBLE,
    field: 'monthly_tds',
    defaultValue: 0,
  }
}, {
  tableName: 'tax_records',
  timestamps: true,
  underscored: true
});

module.exports = TaxRecord;
