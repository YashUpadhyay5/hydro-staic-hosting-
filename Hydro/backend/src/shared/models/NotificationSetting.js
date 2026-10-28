const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const NotificationSetting = sequelize.define('NotificationSetting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  notificationType: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    defaultValue: 'DAILY_ATTENDANCE_SUMMARY',
    field: 'notification_type'
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  scheduledTime: {
    type: DataTypes.STRING,
    defaultValue: '12:00',
    field: 'scheduled_time'
  },
  timezone: {
    type: DataTypes.STRING,
    defaultValue: 'Asia/Kolkata'
  },
  templateName: {
    type: DataTypes.STRING,
    defaultValue: 'daily_attendance_summary',
    field: 'template_name'
  },
  sendOnHolidays: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'send_on_holidays'
  },
  sendOnWeekoffs: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'send_on_weekoffs'
  },
  includeDetailedBreakdown: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'include_detailed_breakdown'
  },
  maxRetryAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
    field: 'max_retry_attempts'
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'created_by'
  },
  updatedBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'updated_by'
  }
}, {
  tableName: 'notification_settings',
  timestamps: true,
  underscored: true
});

module.exports = NotificationSetting;
