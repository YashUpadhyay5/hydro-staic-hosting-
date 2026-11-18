const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// Attendance evidence and the admin decision for one Sunday/holiday shift. The credit itself is the
// linked SPECIAL_EARNED_CREDIT row in location_leave_adjustments, whose status (PENDING / ACTIVE /
// REJECTED / REVERSED) is the single source of truth for the balance. Kept in its own table so the
// existing leave adjustments table needs no new columns.
const SpecialShiftVerification = sequelize.define('SpecialShiftVerification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  adjustmentId: {
    type: DataTypes.UUID,
    field: 'adjustment_id',
    allowNull: false,
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
    allowNull: true,
  },
  department: {
    type: DataTypes.STRING,
    field: 'department',
    allowNull: true, // department when the shift was recorded
  },
  workDate: {
    type: DataTypes.STRING,
    field: 'work_date',
    allowNull: false, // YYYY-MM-DD (IST attendance date)
  },
  dayType: {
    type: DataTypes.STRING,
    field: 'day_type',
    allowNull: false, // 'SUNDAY' (weekly off) | 'HOLIDAY'
  },
  holidayName: {
    type: DataTypes.STRING,
    field: 'holiday_name',
    allowNull: true,
  },
  attendanceIds: {
    type: DataTypes.TEXT,
    field: 'attendance_ids',
    allowNull: true, // JSON array of the attendance session ids the hours come from
  },
  checkIn: {
    type: DataTypes.STRING,
    field: 'check_in',
    allowNull: true, // first check-in of the day, as recorded
  },
  checkOut: {
    type: DataTypes.STRING,
    field: 'check_out',
    allowNull: true, // last check-out of the day, as recorded
  },
  workingHours: {
    type: DataTypes.DOUBLE,
    field: 'working_hours',
    allowNull: false,
    defaultValue: 0,
  },
  eligibleDays: {
    type: DataTypes.DOUBLE,
    field: 'eligible_days',
    allowNull: false,
    defaultValue: 0, // calculated from working hours by policy
  },
  attendanceStatus: {
    type: DataTypes.STRING,
    field: 'attendance_status',
    allowNull: false,
    defaultValue: 'COMPLETE', // 'COMPLETE' | 'INVALID_PUNCH' | 'OPEN_SESSION'
  },
  punchIssues: {
    type: DataTypes.TEXT,
    field: 'punch_issues',
    allowNull: true, // JSON array of problems found in the punches
  },
  autoClockOut: {
    type: DataTypes.BOOLEAN,
    field: 'auto_clock_out',
    allowNull: false,
    defaultValue: false, // a check-out was filled in by the system, not punched
  },
  evaluatedAt: {
    type: DataTypes.DATE,
    field: 'evaluated_at',
    allowNull: true,
  },
  verifiedBy: {
    type: DataTypes.STRING,
    field: 'verified_by',
    allowNull: true, // authenticated user id of the approver / rejecter
  },
  verifiedByName: {
    type: DataTypes.STRING,
    field: 'verified_by_name',
    allowNull: true,
  },
  verifiedAt: {
    type: DataTypes.DATE,
    field: 'verified_at',
    allowNull: true, // server time of the decision
  },
  approvedDays: {
    type: DataTypes.DOUBLE,
    field: 'approved_days',
    allowNull: true,
  },
  overrideApplied: {
    type: DataTypes.BOOLEAN,
    field: 'override_applied',
    allowNull: false,
    defaultValue: false, // approved days differ from the calculated credit
  },
  overrideReason: {
    type: DataTypes.TEXT,
    field: 'override_reason',
    allowNull: true,
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    field: 'rejection_reason',
    allowNull: true,
  },
  changedAfterDecision: {
    type: DataTypes.BOOLEAN,
    field: 'changed_after_decision',
    allowNull: false,
    defaultValue: false, // attendance hours changed after the approve/reject decision
  },
  latestWorkingHours: {
    type: DataTypes.DOUBLE,
    field: 'latest_working_hours',
    allowNull: true, // hours seen at the last evaluation after the decision
  }
}, {
  tableName: 'special_shift_verifications',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['adjustment_id'] },
    { unique: true, fields: ['employee_id', 'work_date'] },
    { fields: ['work_date'] }
  ]
});

module.exports = SpecialShiftVerification;
