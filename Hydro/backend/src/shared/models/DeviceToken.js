const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const DeviceToken = sequelize.define('DeviceToken', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  employeeId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'employee_id'
  },
  token: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  deviceType: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'device_type'
  },
  platform: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  lastActive: {
    type: DataTypes.DATE,
    field: 'last_active'
  }
}, {
  tableName: 'device_tokens',
  timestamps: true,
  underscored: true
});

module.exports = DeviceToken;
