const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// What an employee is doing during the day, started and finished from their phone (see DAY_ACTIVITIES_API.md).
// The employee sets the planned end; asking for extra time moves deadlineAt. Times are epoch milliseconds,
// like Footprint.timestamp (Postgres returns BIGINT as a string, so the getters turn them back into numbers).
const millis = (field, allowNull = true) => ({
  type: DataTypes.BIGINT,
  field,
  allowNull,
  get() {
    const v = this.getDataValue(field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
    return v === null || v === undefined ? null : Number(v);
  }
});

const EmployeeActivity = sequelize.define('EmployeeActivity', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: false
  },
  // IST day the activity started on (YYYY-MM-DD)
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  startedAt: millis('started_at', false),
  plannedEndAt: millis('planned_end_at', false),
  deadlineAt: millis('deadline_at', false),
  endedAt: millis('ended_at'),
  // IN_PROGRESS | COMPLETED | CANCELLED ("over time" is worked out from deadlineAt)
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'IN_PROGRESS'
  },
  // [{ at, extraMinutes, reason, previousDeadlineAt, newDeadlineAt }]
  extensions: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '[]',
    get() {
      try {
        const v = JSON.parse(this.getDataValue('extensions') || '[]');
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    },
    set(v) {
      this.setDataValue('extensions', JSON.stringify(Array.isArray(v) ? v : []));
    }
  },
  // Reason given when finishing after the deadline
  finishReason: {
    type: DataTypes.TEXT,
    field: 'finish_reason',
    allowNull: true
  },
  remindersSent: {
    type: DataTypes.INTEGER,
    field: 'reminders_sent',
    allowNull: false,
    defaultValue: 0
  },
  // Rings since the current deadline passed; reset when extra time is given
  deadlineReminders: {
    type: DataTypes.INTEGER,
    field: 'deadline_reminders',
    allowNull: false,
    defaultValue: 0
  },
  lastReminderAt: millis('last_reminder_at'),
  startLatitude: { type: DataTypes.FLOAT, field: 'start_latitude', allowNull: true },
  startLongitude: { type: DataTypes.FLOAT, field: 'start_longitude', allowNull: true },
  endLatitude: { type: DataTypes.FLOAT, field: 'end_latitude', allowNull: true },
  endLongitude: { type: DataTypes.FLOAT, field: 'end_longitude', allowNull: true },
  siteName: { type: DataTypes.STRING(150), field: 'site_name', allowNull: true }
}, {
  tableName: 'employee_day_activities',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['employee_id', 'date'] },
    { fields: ['status', 'deadline_at'] }
  ]
});

module.exports = EmployeeActivity;
