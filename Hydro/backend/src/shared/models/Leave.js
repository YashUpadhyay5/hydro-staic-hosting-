const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Leave = sequelize.define('Leave', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    field: 'user_id',
    allowNull: false,
  },
  userName: {
    type: DataTypes.STRING,
    field: 'user_name',
    allowNull: false,
  },
  startDate: {
    type: DataTypes.STRING,
    field: 'start_date',
    allowNull: false,
  },
  endDate: {
    type: DataTypes.STRING,
    field: 'end_date',
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pending', // pending, approved, rejected
  },
  elDays: {
    type: DataTypes.INTEGER,
    field: 'el_days',
    allowNull: false,
    defaultValue: 0,
  },
  lopDays: {
    type: DataTypes.INTEGER,
    field: 'lop_days',
    allowNull: false,
    defaultValue: 0,
  },
  totalDays: {
    type: DataTypes.INTEGER,
    field: 'total_days',
    allowNull: false,
    defaultValue: 0,
  },
  appliedAt: {
    type: DataTypes.BIGINT,
    field: 'applied_at',
    allowNull: false,
  },
  actionBy: {
    type: DataTypes.STRING,
    field: 'action_by',
    allowNull: true,
  },
  leaveCategory: {
    type: DataTypes.STRING,
    field: 'leave_category',
    allowNull: true, // NULL = ordinary EL/LOP leave; otherwise a location_leave_categories code (never uses EL)
  },
  // The request's working dates (Sundays and the employee's holidays skipped), fixed when it was applied.
  // EL is charged to the first elDays of them. NULL on older requests, which keep calendar days.
  workingDates: {
    type: DataTypes.TEXT,
    field: 'working_dates',
    allowNull: true,
    get() {
      const raw = this.getDataValue('workingDates');
      if (raw === null || raw === undefined) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    set(value) {
      this.setDataValue('workingDates', Array.isArray(value) ? JSON.stringify(value) : null);
    }
  }
}, {
  tableName: 'location_leaves',
  timestamps: true,
  underscored: true
});

module.exports = Leave;
