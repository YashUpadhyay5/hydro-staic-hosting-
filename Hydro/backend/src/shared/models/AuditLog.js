const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const AuditLog = sequelize.define('AuditLog', {
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
  attendanceSessionId: {
    type: DataTypes.STRING,
    field: 'attendance_session_id',
    allowNull: false,
  },
  event: {
    type: DataTypes.STRING,
    allowNull: false, // HEARTBEAT_RECEIVED, HEARTBEAT_MISSING, TRACKING_INTERRUPTED, NOTIFICATION_SENT, APPLICATION_REOPENED, TRACKING_RECOVERED, CLOCK_OUT
  },
  details: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '{}',
    get() {
      const val = this.getDataValue('details');
      return val ? JSON.parse(val) : {};
    },
    set(val) {
      this.setDataValue('details', JSON.stringify(val));
    }
  },
  timestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
  }
}, {
  tableName: 'tracking_audit_logs',
  timestamps: true,
  underscored: true
});

module.exports = AuditLog;
