const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const LeaveAdjustment = sequelize.define('LeaveAdjustment', {
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
  empCode: {
    type: DataTypes.STRING,
    field: 'emp_code',
    allowNull: true,
  },
  employeeName: {
    type: DataTypes.STRING,
    field: 'employee_name',
    allowNull: false,
  },
  leaveType: {
    type: DataTypes.STRING,
    field: 'leave_type',
    allowNull: false,
    defaultValue: 'Earned Leave',
  },
  adjustmentType: {
    type: DataTypes.STRING,
    field: 'adjustment_type',
    allowNull: false,
    defaultValue: 'OPENING_BALANCE',
    // 'OPENING_BALANCE', 'CREDIT', 'DEBIT', 'SET_BALANCE' (legacy, employee-level, unscoped by year/month)
    // 'EARNED_LEAVE_OVERRIDE', 'SPECIAL_EARNED_CREDIT', 'SPECIAL_EARNED_REVERSAL', 'CONSUMED_LEAVE_CORRECTION' (Leave Balances module, scoped by year/month)
  },
  days: {
    type: DataTypes.DOUBLE,
    field: 'days',
    allowNull: false,
    defaultValue: 0,
  },
  reason: {
    type: DataTypes.TEXT,
    field: 'reason',
    allowNull: false,
  },
  effectiveDate: {
    type: DataTypes.STRING,
    field: 'effective_date',
    allowNull: true,
  },
  adjustedBy: {
    type: DataTypes.STRING,
    field: 'adjusted_by',
    allowNull: true,
    defaultValue: 'Admin',
  },
  year: {
    type: DataTypes.INTEGER,
    field: 'year',
    allowNull: true,
  },
  month: {
    type: DataTypes.INTEGER,
    field: 'month',
    allowNull: true, // 1-12
  },
  workDate: {
    type: DataTypes.STRING,
    field: 'work_date',
    allowNull: true, // used by SPECIAL_EARNED_CREDIT/REVERSAL
  },
  relatedAdjustmentId: {
    type: DataTypes.UUID,
    field: 'related_adjustment_id',
    allowNull: true, // links a SPECIAL_EARNED_REVERSAL back to the credit it reverses
  },
  status: {
    type: DataTypes.STRING,
    field: 'status',
    allowNull: false,
    defaultValue: 'ACTIVE', // 'ACTIVE' | 'REVERSED'
  }
}, {
  tableName: 'location_leave_adjustments',
  timestamps: true,
  underscored: true,
});

module.exports = LeaveAdjustment;
