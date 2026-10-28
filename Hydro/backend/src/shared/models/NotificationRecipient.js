const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const NotificationRecipient = sequelize.define('NotificationRecipient', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  notificationType: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'DAILY_ATTENDANCE_SUMMARY',
    field: 'notification_type'
  },
  recipientType: {
    type: DataTypes.ENUM('ROLE', 'CUSTOM_NUMBER'),
    allowNull: false,
    defaultValue: 'ROLE',
    field: 'recipient_type'
  },
  targetRole: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'target_role' // 'MANAGER', 'HR', 'ACCOUNT'
  },
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'phone_number'
  },
  name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'notification_recipients',
  timestamps: true,
  underscored: true
});

module.exports = NotificationRecipient;
