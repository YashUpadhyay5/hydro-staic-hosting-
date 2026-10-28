const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const NotificationLog = sequelize.define('NotificationLog', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  notificationId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'notification_id'
  },
  employeeId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'employee_id'
  },
  status: {
    type: DataTypes.STRING, // e.g. SENT, FAILED
    allowNull: false,
  },
  error: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  sentAt: {
    type: DataTypes.DATE,
    field: 'sent_at'
  }
}, {
  tableName: 'notification_logs',
  timestamps: true,
  underscored: true
});

module.exports = NotificationLog;
