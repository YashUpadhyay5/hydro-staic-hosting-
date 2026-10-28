const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const EmployeeGeofenceTrackingState = sequelize.define('EmployeeGeofenceTrackingState', {
  employeeId: {
    type: DataTypes.STRING,
    primaryKey: true,
    field: 'employee_id'
  },
  attendanceId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'attendance_id'
  },
  consecutiveOutsideCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'consecutive_outside_count'
  },
  alertSent: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'alert_sent'
  },
  lastStatus: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'NONE',
    field: 'last_status' // 'INSIDE', 'OUTSIDE', 'NONE'
  },
  lastOutsidePingAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_outside_ping_at'
  },
  lastAlertSentAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_alert_sent_at'
  },
  lastPingTimestamp: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'last_ping_timestamp'
  },
  lastEvaluatedLat: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    field: 'last_evaluated_lat'
  },
  lastEvaluatedLon: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    field: 'last_evaluated_lon'
  }
}, {
  tableName: 'employee_geofence_tracking_states',
  timestamps: true,
  underscored: true
});

module.exports = EmployeeGeofenceTrackingState;
