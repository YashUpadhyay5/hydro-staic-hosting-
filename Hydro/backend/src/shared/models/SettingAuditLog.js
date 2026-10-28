const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const SettingAuditLog = sequelize.define('SettingAuditLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  admin_user_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  changes_json: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  ip_address: {
    type: DataTypes.STRING,
    allowNull: true,
  }
}, {
  tableName: 'setting_audit_logs',
  timestamps: true,
  underscored: true
});

module.exports = SettingAuditLog;
