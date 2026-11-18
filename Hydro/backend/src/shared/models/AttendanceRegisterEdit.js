const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// One admin change to one day in the monthly attendance register (P / EL / A / OFF), with what the day held
// before (attendance rows and leave requests, as they were) so any change can be traced and undone by hand.
const json = (field) => ({
  type: DataTypes.TEXT,
  allowNull: true,
  get() {
    const raw = this.getDataValue(field);
    if (raw === null || raw === undefined) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  set(v) {
    this.setDataValue(field, v === null || v === undefined ? null : JSON.stringify(v));
  }
});

const AttendanceRegisterEdit = sequelize.define('AttendanceRegisterEdit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // The changes saved together after one confirmation share a batch id
  batchId: { type: DataTypes.UUID, field: 'batch_id', allowNull: false },
  employeeId: { type: DataTypes.STRING, field: 'employee_id', allowNull: false },
  date: { type: DataTypes.STRING, allowNull: false },          // YYYY-MM-DD
  fromMark: { type: DataTypes.STRING(10), field: 'from_mark', allowNull: true },
  toMark: { type: DataTypes.STRING(10), field: 'to_mark', allowNull: false },
  note: { type: DataTypes.TEXT, allowNull: true },
  editedBy: { type: DataTypes.STRING, field: 'edited_by', allowNull: true },
  // { attendance: [rows deleted], leaves: [{ id, before: {...} }] }
  before: { ...json('before'), field: 'before_state' },
  // { attendanceId?, leaveId?, leaveUpdates: [{ id, after: {...} }] }
  after: { ...json('after'), field: 'after_state' }
}, {
  tableName: 'attendance_register_edits',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['employee_id', 'date'] },
    { fields: ['batch_id'] }
  ]
});

module.exports = AttendanceRegisterEdit;
