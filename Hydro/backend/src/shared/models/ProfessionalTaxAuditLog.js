const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ProfessionalTaxAuditLog = sequelize.define('ProfessionalTaxAuditLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    field: 'user_id',
    allowNull: true,
  },
  userName: {
    type: DataTypes.STRING,
    field: 'user_name',
    allowNull: true,
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false, // 'CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DISABLE', 'SCHEDULE', 'IMPORT'
  },
  stateId: {
    type: DataTypes.UUID,
    field: 'state_id',
    allowNull: true,
  },
  stateCode: {
    type: DataTypes.STRING,
    field: 'state_code',
    allowNull: true,
  },
  ruleId: {
    type: DataTypes.UUID,
    field: 'rule_id',
    allowNull: true,
  },
  oldValue: {
    type: DataTypes.TEXT,
    field: 'old_value',
    allowNull: true,
  },
  newValue: {
    type: DataTypes.TEXT,
    field: 'new_value',
    allowNull: true,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  ipAddress: {
    type: DataTypes.STRING,
    field: 'ip_address',
    allowNull: true,
  },
  timestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: () => Date.now(),
  }
}, {
  tableName: 'professional_tax_audit_logs',
  timestamps: true,
  underscored: true,
});

module.exports = ProfessionalTaxAuditLog;
