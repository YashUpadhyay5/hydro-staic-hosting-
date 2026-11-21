// Attendance regularization: an employee who worked a past day but forgot to clock in asks, from the phone, to be
// marked present (comment + supporting documents). An admin approves or rejects it on the dashboard; approving
// creates the attendance row for that day, which is what every "present" count in the system reads.
// API: REGULARIZATION_API.md.
const { Op } = require('sequelize');
const sequelize = require('../../../../config/database');
const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const Leave = require('../../../../shared/models/Leave');
const DeviceToken = require('../../../../shared/models/DeviceToken');
const AttendanceRegularization = require('../../../../shared/models/AttendanceRegularization');
const ShiftEngine = require('../../../../shared/services/ShiftEngine');
const { resolveCanonicalEmployee } = require('../../../../core/utils/employeeCache');

const MAX_BACKDATE_DAYS = 31;      // a request can reach back this far
const MAX_DOCUMENTS = 5;
const METHOD = 'REGULARIZED';      // checkInMethod / clockOutMethod of the attendance row an approval creates
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

class RegularizationError extends Error {
  constructor(message, status = 400, code = 'INVALID', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const istDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms));
const text = (v, max) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

// '9:30', '09:30', '9:30 AM', '18:05:00' -> minutes after midnight, or null
function parseClock(v) {
  const s = text(v, 20);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3] && m[3].toUpperCase();
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// Same shape the clock-in writes: '09:12:33 AM'
function clock12(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const h = h24 % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00 ${h24 < 12 ? 'AM' : 'PM'}`;
}

async function resolveEmployee(identifier) {
  const id = text(identifier, 200);
  if (!id) return null;
  try {
    const canonical = await resolveCanonicalEmployee(id);
    const targetPk = canonical?.employee?.id || canonical?.canonicalId;
    if (targetPk) {
      const emp = await Employee.findByPk(targetPk);
      if (emp) return emp;
    }
    if (canonical?.canonicalId) {
      const emp = await Employee.findOne({ where: { empCode: canonical.canonicalId } });
      if (emp) return emp;
    }
  } catch (e) {}
  return Employee.findOne({ where: { [Op.or]: [{ id }, { empCode: id }, { name: id }] } });
}

const idVariants = (employee) => [employee.id, employee.empCode].filter(Boolean);
const dateVariants = (iso) => {
  const [y, m, d] = iso.split('-');
  return [iso, `${d}-${m}-${y}`];
};

async function attendanceOn(employee, iso, options = {}) {
  return Attendance.findOne({ where: { userId: { [Op.in]: idVariants(employee) }, date: { [Op.in]: dateVariants(iso) } }, ...options });
}

// One attendance row in the shape a clock-in and clock-out leave behind: the given times, else the employee's shift.
// Also used by the monthly attendance register when an admin marks a day present.
async function createPresentDay(employee, date, { checkIn = null, checkOut = null, method = METHOD, transaction } = {}) {
  const shift = ShiftEngine.resolveEmployeeShift(employee);
  const inText = checkIn || clock12(ShiftEngine.parseTimeToMinutes(shift.start));
  const outText = checkOut || clock12(ShiftEngine.parseTimeToMinutes(shift.end));
  const isOffice = String(employee.designation || '').trim().toUpperCase() === 'OFFICE';
  return Attendance.create({
    userId: employee.empCode || employee.id,
    userName: employee.name || 'Employee',
    date,
    checkIn: inText,
    checkOut: outText,
    workingHours: ShiftEngine.calculateWorkingHours(inText, outText),
    workMode: isOffice ? 'office' : 'field',
    isSwitched: false,
    checkInMethod: method,
    clockOutMethod: method,
    shiftCode: shift.code
  }, { transaction });
}

// The request as the dashboard and the phone see it
function present(row) {
  return row.get ? row.get({ plain: true }) : { ...row };
}

// body: { date, comment, checkIn?, checkOut? }; files: multer files saved under storage/regularization
async function create(employee, body = {}, files = [], now = Date.now()) {
  const date = text(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new RegularizationError('Give the date to regularize as YYYY-MM-DD.', 400, 'INVALID_DATE');
  }
  const today = istDate(now);
  if (date >= today) {
    throw new RegularizationError('Only a past day can be regularized. Clock in for today.', 400, 'DATE_NOT_PAST');
  }
  if (dayNumber(today) - dayNumber(date) > MAX_BACKDATE_DAYS) {
    throw new RegularizationError(`Requests can go back at most ${MAX_BACKDATE_DAYS} days.`, 400, 'DATE_TOO_OLD');
  }

  const comment = text(body.comment, 1000);
  if (comment.length < 3) throw new RegularizationError('Say why you could not clock in (comment).', 400, 'COMMENT_REQUIRED');

  const inText = text(body.checkIn, 20);
  const outText = text(body.checkOut, 20);
  const inMin = parseClock(inText);
  const outMin = parseClock(outText);
  if ((inText && inMin === null) || (outText && outMin === null)) {
    throw new RegularizationError('checkIn and checkOut must be times such as 09:30 or 9:30 AM.', 400, 'INVALID_TIME');
  }
  if (inMin !== null && outMin !== null && outMin <= inMin) {
    throw new RegularizationError('checkOut must be after checkIn.', 400, 'INVALID_TIME');
  }
  if (files.length > MAX_DOCUMENTS) {
    throw new RegularizationError(`Attach at most ${MAX_DOCUMENTS} documents.`, 400, 'TOO_MANY_DOCUMENTS');
  }

  if (await attendanceOn(employee, date)) {
    throw new RegularizationError('You already have attendance on that day.', 409, 'ATTENDANCE_EXISTS');
  }
  const pending = await AttendanceRegularization.findOne({ where: { employeeId: employee.id, date, status: 'PENDING' } });
  if (pending) {
    throw new RegularizationError('You already have a pending request for that day.', 409, 'ALREADY_REQUESTED', { request: present(pending) });
  }
  const leave = await Leave.findOne({
    where: {
      userId: { [Op.in]: idVariants(employee) },
      startDate: { [Op.lte]: date },
      endDate: { [Op.gte]: date },
      status: { [Op.in]: ['APPROVED', 'Approved', 'approved'] }
    }
  });
  if (leave) throw new RegularizationError('You are on approved leave on that day.', 409, 'ON_LEAVE');

  return AttendanceRegularization.create({
    employeeId: employee.id,
    empCode: employee.empCode || null,
    employeeName: employee.name || null,
    date,
    comment,
    requestedCheckIn: inMin === null ? null : clock12(inMin),
    requestedCheckOut: outMin === null ? null : clock12(outMin),
    documents: files.map((f) => ({
      url: `storage/regularization/${f.filename}`,
      name: text(f.originalname, 200) || f.filename,
      mimeType: f.mimetype || null,
      size: f.size || null
    }))
  });
}

// filters: { status ('ALL' or one of STATUSES; default PENDING), employeeId, from, to }; oldest day first
async function list({ status = 'PENDING', employeeId, from, to } = {}) {
  const where = {};
  const wanted = String(status || 'PENDING').toUpperCase();
  if (wanted !== 'ALL') {
    if (!STATUSES.includes(wanted)) throw new RegularizationError(`status must be ALL or one of ${STATUSES.join(', ')}.`, 400, 'INVALID_STATUS');
    where.status = wanted;
  }
  if (employeeId) where.employeeId = employeeId;
  if (from || to) {
    where.date = {};
    if (from) where.date[Op.gte] = text(from, 10);
    if (to) where.date[Op.lte] = text(to, 10);
  }
  const rows = await AttendanceRegularization.findAll({ where, order: [['date', 'ASC'], ['createdAt', 'ASC']] });
  const pendingCount = await AttendanceRegularization.count({ where: { status: 'PENDING', ...(employeeId ? { employeeId } : {}) } });
  return { requests: rows.map(present), pendingCount };
}

function assertPending(row) {
  if (row.status !== 'PENDING') {
    throw new RegularizationError(`This request was already ${row.status.toLowerCase()}.`, 409, 'NOT_PENDING', { request: present(row) });
  }
}

// Best-effort push so the employee hears the decision; a failure never undoes it
async function notifyEmployee(employee, title, body, payload) {
  try {
    const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
    const rows = await DeviceToken.findAll({ where: { employeeId: { [Op.in]: idVariants(employee) } } });
    const tokens = [...new Set([...rows.map((r) => r.token), employee.fcmToken].filter(Boolean))];
    for (const token of tokens) await HeartbeatMonitorService.sendPush(token, title, body, payload);
  } catch (error) {
    console.warn('[Regularization] Could not notify the employee:', error.message);
  }
}

const readableDate = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`));

// Marks the employee present on the day: one attendance row, in the shape a clock-in and clock-out would leave
async function approve(row, actor, body = {}, now = Date.now(), notify = notifyEmployee) {
  assertPending(row);
  const employee = await Employee.findByPk(row.employeeId);
  if (!employee) throw new RegularizationError('The employee no longer exists.', 404, 'EMPLOYEE_NOT_FOUND');
  if (await attendanceOn(employee, row.date)) {
    throw new RegularizationError('The employee already has attendance on that day. Reject this request instead.', 409, 'ATTENDANCE_EXISTS');
  }

  await sequelize.transaction(async (transaction) => {
    const attendance = await createPresentDay(employee, row.date, {
      checkIn: row.requestedCheckIn, checkOut: row.requestedCheckOut, method: METHOD, transaction
    });

    row.status = 'APPROVED';
    row.decidedBy = text(actor, 200) || null;
    row.decidedAt = now;
    row.decisionNote = text(body.note, 500) || null;
    row.attendanceId = attendance.id;
    await row.save({ transaction });
  });

  await notify(employee, 'Attendance regularized',
    `You are marked present for ${readableDate(row.date)}.`,
    { type: 'REGULARIZATION', status: 'APPROVED', requestId: row.id, date: row.date });
  return row;
}

async function reject(row, actor, body = {}, now = Date.now(), notify = notifyEmployee) {
  assertPending(row);
  const note = text(body.note, 500);
  if (note.length < 3) throw new RegularizationError('Say why the request is rejected (note).', 400, 'NOTE_REQUIRED');
  row.status = 'REJECTED';
  row.decidedBy = text(actor, 200) || null;
  row.decidedAt = now;
  row.decisionNote = note;
  await row.save();

  const employee = await Employee.findByPk(row.employeeId);
  if (employee) {
    await notify(employee, 'Regularization rejected',
      `Your request for ${readableDate(row.date)} was rejected: ${note}`,
      { type: 'REGULARIZATION', status: 'REJECTED', requestId: row.id, date: row.date });
  }
  return row;
}

// The employee withdraws their own pending request
async function cancel(row, now = Date.now()) {
  assertPending(row);
  row.status = 'CANCELLED';
  row.decidedAt = now;
  return row.save();
}

// -------------------------------------------------------------
// OVERTIME REGULARIZATION (WORKING HOURS > 8 HOURS / 480 MINS)
// -------------------------------------------------------------

function formatDurationMins(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatMinsToHHMMSS(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function presentOvertime(row, emp = null) {
  const plain = row.get ? row.get({ plain: true }) : { ...row };
  const inM = ShiftEngine.parseTimeToMinutes(plain.checkIn);
  const outM = ShiftEngine.parseTimeToMinutes(plain.checkOut);
  const totalMins = (inM != null && outM != null && outM > inM) ? (outM - inM) : 0;
  const otMins = Math.max(0, totalMins - 480);

  const empCode = emp?.empCode || emp?.emp_code || plain.userId;
  const employeeName = emp?.name || plain.userName;
  const status = plain.overtimeStatus || (otMins > 0 ? 'PENDING' : 'NONE');

  const rawWorkingHours = ShiftEngine.calculateWorkingHours(plain.checkIn, plain.checkOut);
  // When rejected: decrease that extra overtime from total working time (capped at 480m / 08:00:00)
  // When approved or pending: shows full recorded duration
  const effectiveMins = status === 'REJECTED' ? Math.min(totalMins, 480) : totalMins;
  const effectiveHoursFormatted = formatDurationMins(effectiveMins);
  const effectiveWorkingHours = status === 'REJECTED' ? '08:00:00' : rawWorkingHours;

  return {
    id: plain.id,
    attendanceId: plain.id,
    userId: plain.userId,
    empCode,
    employeeName,
    date: plain.date,
    checkIn: plain.checkIn,
    checkOut: plain.checkOut,
    totalMinutes: totalMins,
    totalHoursFormatted: formatDurationMins(totalMins),
    effectiveMinutes: effectiveMins,
    effectiveHoursFormatted,
    rawWorkingHours,
    effectiveWorkingHours,
    overtimeMinutes: otMins,
    overtimeHours: plain.overtimeHours || formatMinsToHHMMSS(otMins),
    overtimeHoursFormatted: formatDurationMins(otMins),
    overtimeStatus: status,
    status,
    decidedBy: plain.overtimeApprovedBy || null,
    decidedAt: plain.overtimeApprovedAt || null,
    decisionNote: plain.overtimeDecisionNote || null,
    department: emp?.department || null,
    designation: emp?.designation || null,
    avatar: emp?.avatar || null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt
  };
}

async function listOvertime({ status = 'PENDING', date, from, to, employeeId, limit = 100, page = 1 } = {}) {
  const { getCachedEmployees } = require('../../../../core/utils/employeeCache');
  const { empMap } = await getCachedEmployees();

  const where = {
    checkIn: { [Op.ne]: null },
    checkOut: { [Op.ne]: null }
  };

  const wantedStatus = String(status || 'PENDING').toUpperCase();
  if (wantedStatus !== 'ALL') {
    where.overtimeStatus = wantedStatus;
  } else {
    where[Op.or] = [
      { overtimeMinutes: { [Op.gt]: 0 } },
      { overtimeStatus: { [Op.in]: ['PENDING', 'APPROVED', 'REJECTED'] } }
    ];
  }

  if (date) {
    where.date = text(date, 10);
  } else if (from || to) {
    where.date = {};
    if (from) where.date[Op.gte] = text(from, 10);
    if (to) where.date[Op.lte] = text(to, 10);
  }

  if (employeeId) {
    const emp = await resolveEmployee(employeeId);
    if (emp) {
      where.userId = { [Op.in]: idVariants(emp) };
    }
  }

  const p = Math.max(1, parseInt(page || 1, 10));
  const l = Math.min(200, Math.max(1, parseInt(limit || 100, 10)));
  const offset = (p - 1) * l;

  const { count, rows } = await Attendance.findAndCountAll({
    where,
    order: [['date', 'DESC'], ['createdAt', 'DESC']],
    limit: l,
    offset
  });

  const countBase = {
    checkIn: { [Op.ne]: null },
    checkOut: { [Op.ne]: null }
  };
  if (employeeId) {
    const emp = await resolveEmployee(employeeId);
    if (emp) countBase.userId = { [Op.in]: idVariants(emp) };
  }

  const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
    Attendance.count({ where: { ...countBase, overtimeStatus: 'PENDING' } }),
    Attendance.count({ where: { ...countBase, overtimeStatus: 'APPROVED' } }),
    Attendance.count({ where: { ...countBase, overtimeStatus: 'REJECTED' } })
  ]);

  const requests = rows.map((row) => {
    const uKey = String(row.userId || '').toLowerCase();
    const unKey = String(row.userName || '').toLowerCase();
    const emp = empMap.get(uKey) || empMap.get(unKey) || null;
    return presentOvertime(row, emp);
  });

  return {
    requests,
    totalRecords: count,
    pendingCount,
    approvedCount,
    rejectedCount,
    page: p,
    limit: l
  };
}

async function approveOvertime(id, actor, body = {}) {
  const row = await Attendance.findByPk(id);
  if (!row) throw new RegularizationError('Attendance record not found.', 404, 'NOT_FOUND');

  const inM = ShiftEngine.parseTimeToMinutes(row.checkIn);
  const outM = ShiftEngine.parseTimeToMinutes(row.checkOut);
  if (inM == null || outM == null || outM <= inM) {
    throw new RegularizationError('Invalid clock-in or clock-out times for overtime.', 400, 'INVALID_PUNCH');
  }

  const diff = outM - inM;
  if (diff <= 480) {
    throw new RegularizationError('Working hours do not exceed 8 hours.', 400, 'NOT_OVERTIME');
  }

  const otMins = diff - 480;
  const otHrs = Math.floor(otMins / 60);
  const otRemMins = otMins % 60;
  const otFormatted = `${String(otHrs).padStart(2, '0')}:${String(otRemMins).padStart(2, '0')}:00`;

  row.overtimeStatus = 'APPROVED';
  row.overtimeMinutes = otMins;
  row.overtimeHours = otFormatted;
  row.overtimeApprovedBy = text(actor, 200) || 'admin';
  row.overtimeApprovedAt = new Date();
  row.overtimeDecisionNote = text(body.note, 500) || 'Approved';
  // Rule: When approved, overtime is ADDED to total working hours
  row.workingHours = ShiftEngine.calculateWorkingHours(row.checkIn, row.checkOut);
  await row.save();

  const { getCachedEmployees } = require('../../../../core/utils/employeeCache');
  const { empMap } = await getCachedEmployees();
  const emp = empMap.get(String(row.userId).toLowerCase()) || null;
  return presentOvertime(row, emp);
}

async function rejectOvertime(id, actor, body = {}) {
  const row = await Attendance.findByPk(id);
  if (!row) throw new RegularizationError('Attendance record not found.', 404, 'NOT_FOUND');

  const inM = ShiftEngine.parseTimeToMinutes(row.checkIn);
  const outM = ShiftEngine.parseTimeToMinutes(row.checkOut);
  if (inM == null || outM == null || outM <= inM) {
    throw new RegularizationError('Invalid clock-in or clock-out times for overtime.', 400, 'INVALID_PUNCH');
  }

  row.overtimeStatus = 'REJECTED';
  row.overtimeApprovedBy = text(actor, 200) || 'admin';
  row.overtimeApprovedAt = new Date();
  row.overtimeDecisionNote = text(body.note, 500) || 'Rejected';
  // Rule: When rejected, overtime is NOT added; working hours capped at 8 hours (08:00:00)
  row.workingHours = '08:00:00';
  await row.save();

  const { getCachedEmployees } = require('../../../../core/utils/employeeCache');
  const { empMap } = await getCachedEmployees();
  const emp = empMap.get(String(row.userId).toLowerCase()) || null;
  return presentOvertime(row, emp);
}

async function resetOvertime(id, actor) {
  const row = await Attendance.findByPk(id);
  if (!row) throw new RegularizationError('Attendance record not found.', 404, 'NOT_FOUND');

  row.overtimeStatus = 'PENDING';
  row.overtimeApprovedBy = null;
  row.overtimeApprovedAt = null;
  row.overtimeDecisionNote = null;
  // Reset back to pending -> restores full recorded working hours
  row.workingHours = ShiftEngine.calculateWorkingHours(row.checkIn, row.checkOut);
  await row.save();

  const { getCachedEmployees } = require('../../../../core/utils/employeeCache');
  const { empMap } = await getCachedEmployees();
  const emp = empMap.get(String(row.userId).toLowerCase()) || null;
  return presentOvertime(row, emp);
}

module.exports = {
  RegularizationError,
  MAX_BACKDATE_DAYS,
  MAX_DOCUMENTS,
  METHOD,
  istDate,
  resolveEmployee,
  present,
  presentOvertime,
  createPresentDay,
  create,
  list,
  approve,
  reject,
  cancel,
  listOvertime,
  approveOvertime,
  rejectOvertime,
  resetOvertime
};
