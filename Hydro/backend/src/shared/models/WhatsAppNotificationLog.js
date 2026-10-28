const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const WhatsAppNotificationLog = sequelize.define('WhatsAppNotificationLog', {
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
  businessDate: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'business_date'
  },
  recipientPhone: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'recipient_phone'
  },
  recipientName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'recipient_name'
  },
  status: {
    type: DataTypes.ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'),
    allowNull: false,
    defaultValue: 'QUEUED'
  },
  executionType: {
    type: DataTypes.ENUM('AUTOMATED', 'MANUAL_TRIGGER', 'TEST'),
    allowNull: false,
    defaultValue: 'AUTOMATED',
    field: 'execution_type'
  },
  messageWamid: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'message_wamid'
  },
  payloadSummary: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'payload_summary'
  },
  attemptCount: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    field: 'attempt_count'
  },
  errorCode: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'error_code'
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'error_message'
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'sent_at'
  },
  deliveredAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'delivered_at'
  }
}, {
  tableName: 'whatsapp_notification_logs',
  timestamps: true,
  underscored: true
});

module.exports = WhatsAppNotificationLog;
