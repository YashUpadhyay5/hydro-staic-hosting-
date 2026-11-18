const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// An employee's request, from the phone, to be marked present on a past day they worked but forgot to clock in
// (see REGULARIZATION_API.md). Approving it creates the attendance row for that day; rejecting leaves the day as is.
const AttendanceRegularization = sequelize.define('AttendanceRegularization', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Employee.id, with the code and name as they were when the request was made
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: false
  },
  empCode: {
    type: DataTypes.STRING,
    field: 'emp_code',
    allowNull: true
  },
  employeeName: {
    type: DataTypes.STRING,
    field: 'employee_name',
    allowNull: true
  },
  // The day to mark present (YYYY-MM-DD, IST)
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // What the employee wrote in the app
  comment: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  // Times the employee says they worked, e.g. '09:30 AM'; empty = the employee's shift
  requestedCheckIn: { type: DataTypes.STRING, field: 'requested_check_in', allowNull: true },
  requestedCheckOut: { type: DataTypes.STRING, field: 'requested_check_out', allowNull: true },
  // [{ url, name, mimeType, size }] supporting documents
  documents: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '[]',
    get() {
      try {
        const v = JSON.parse(this.getDataValue('documents') || '[]');
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    },
    set(v) {
      this.setDataValue('documents', JSON.stringify(Array.isArray(v) ? v : []));
    }
  },
  // PENDING | APPROVED | REJECTED | CANCELLED (the employee withdrew it)
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PENDING'
  },
  decidedBy: { type: DataTypes.STRING, field: 'decided_by', allowNull: true },
  decidedAt: {
    type: DataTypes.BIGINT,
    field: 'decided_at',
    allowNull: true,
    get() {
      const v = this.getDataValue('decidedAt');
      return v === null || v === undefined ? null : Number(v);
    }
  },
  decisionNote: { type: DataTypes.TEXT, field: 'decision_note', allowNull: true },
  // The attendance row an approval created
  attendanceId: { type: DataTypes.STRING, field: 'attendance_id', allowNull: true }
}, {
  tableName: 'attendance_regularizations',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status', 'date'] },
    { fields: ['employee_id', 'date'] }
  ]
});

module.exports = AttendanceRegularization;
