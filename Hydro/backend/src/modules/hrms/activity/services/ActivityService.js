// Day activities: what an employee is doing, started and finished from their phone with a planned end time
// they choose. When the planned time runs out the phone rings (an ALARM push, like the clock-out reminder)
// asking for extra time and the reason, and keeps ringing every REMINDER_EVERY_MINUTES until they answer,
// finish, clock out or MAX_RINGS_PER_DEADLINE rings go unanswered. API: DAY_ACTIVITIES_API.md.
const { Op } = require('sequelize');
const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const DeviceToken = require('../../../../shared/models/DeviceToken');
const EmployeeActivity = require('../../../../shared/models/EmployeeActivity');
const { workListFor } = require('./WorkLists');
const ActivityNotificationService = require('./ActivityNotificationService');
const SiteResolver = require('./SiteResolver');
const { resolveCanonicalEmployee } = require('../../../../core/utils/employeeCache');

const MINUTE = 60 * 1000;
const REMINDER_EVERY_MINUTES = 5;     // same pace as the clock-out alarm
const MAX_RINGS_PER_DEADLINE = 12;    // an hour of unanswered rings, then stop until they act
const MAX_ACTIVITY_HOURS = 16;
const MAX_PLANNED_MINUTES = MAX_ACTIVITY_HOURS * 60;
const MIN_EXTRA_MINUTES = 5;
const MAX_EXTRA_MINUTES = 8 * 60;
const MAX_BACKDATE_HOURS = 12;        // a phone that was offline may send when it really started
const LATE_GRACE_MS = MINUTE;         // finishing within a minute of the deadline needs no reason

class ActivityError extends Error {
  constructor(message, status = 400, code = 'INVALID', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const istDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms));
const istClock = (ms) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ms)).toUpperCase();

// Epoch ms (number or numeric string) or an ISO date-time string; null when unreadable
function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) {
    const n = Number(v);
    return Number.isFinite(n) && n > 1e12 ? n : null;
  }
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

const text = (v, max) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const coord = (v, limit) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

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

// The activity as the page and the phone see it, with the figures worked out
function present(activity, now = Date.now()) {
  const a = activity.get ? activity.get({ plain: true }) : { ...activity };
  const end = a.endedAt || now;
  const extraMinutesAsked = a.extensions.reduce((s, e) => s + (Number(e.extraMinutes) || 0), 0);
  let state = a.status;
  if (a.status === 'IN_PROGRESS') {
    if (a.date < istDate(now)) state = 'UNFINISHED';
    else if (now > a.deadlineAt) state = 'OVERDUE';
  } else if (a.status === 'COMPLETED' && a.endedAt > a.plannedEndAt) {
    // late = finished after the ORIGINAL plan, by any amount (the phone has rung by then); extra time does not hide it
    state = 'COMPLETED_LATE';
  }
  return {
    ...a,
    state,
    siteName: a.siteName || null,
    plannedMinutes: Math.round((a.plannedEndAt - a.startedAt) / MINUTE),
    takenMinutes: Math.max(0, Math.round((end - a.startedAt) / MINUTE)),
    overMinutes: Math.max(0, Math.round((end - a.deadlineAt) / MINUTE)),
    overPlanMinutes: Math.max(0, Math.round((end - a.plannedEndAt) / MINUTE)),
    extraMinutesAsked
  };
}

async function currentFor(employee) {
  return EmployeeActivity.findOne({
    where: { employeeId: employee.id, status: 'IN_PROGRESS' },
    order: [['startedAt', 'DESC']]
  });
}

async function start(employee, body = {}, now = Date.now()) {
  // Some work places choose from a fixed list (see WorkLists.js); a listed item may also fix the time
  const workList = await workListFor(employee);
  let title;
  let fixedMinutes = null;
  if (workList.mode === 'LIST') {
    const item = workList.items.find((i) => i.key === text(body.workKey, 60));
    if (!item) throw new ActivityError('Choose the work from the list for your work place.', 400, 'WORK_REQUIRED', { workList });
    title = item.title;
    fixedMinutes = item.minutes;
  } else {
    title = text(body.title, 120);
    if (!title) throw new ActivityError('Say what the activity is (title).', 400, 'TITLE_REQUIRED');
  }

  let startedAt = now;
  if (body.startedAt !== undefined && body.startedAt !== null && body.startedAt !== '') {
    const t = parseTime(body.startedAt);
    if (t === null || t > now + MINUTE || t < now - MAX_BACKDATE_HOURS * 60 * MINUTE) {
      throw new ActivityError(`startedAt must be a time within the last ${MAX_BACKDATE_HOURS} hours.`, 400, 'INVALID_START');
    }
    startedAt = Math.min(t, now);
  }

  let plannedEndAt = null;
  if (fixedMinutes) {
    plannedEndAt = startedAt + fixedMinutes * MINUTE;
  } else if (body.plannedEndAt !== undefined && body.plannedEndAt !== null && body.plannedEndAt !== '') {
    plannedEndAt = parseTime(body.plannedEndAt);
    if (plannedEndAt === null) throw new ActivityError('plannedEndAt is not a valid time.', 400, 'INVALID_PLANNED_END');
  } else if (body.plannedMinutes !== undefined && body.plannedMinutes !== null && body.plannedMinutes !== '') {
    const m = Number(body.plannedMinutes);
    if (!Number.isInteger(m) || m < 1 || m > MAX_PLANNED_MINUTES) {
      throw new ActivityError(`plannedMinutes must be a whole number from 1 to ${MAX_PLANNED_MINUTES}.`, 400, 'INVALID_PLANNED_END');
    }
    plannedEndAt = startedAt + m * MINUTE;
  } else {
    throw new ActivityError('Give the planned end time (plannedEndAt) or the planned minutes (plannedMinutes).', 400, 'PLANNED_END_REQUIRED');
  }
  if (plannedEndAt <= startedAt) throw new ActivityError('The planned end must be after the start.', 400, 'INVALID_PLANNED_END');
  if (plannedEndAt > startedAt + MAX_ACTIVITY_HOURS * 60 * MINUTE) {
    throw new ActivityError(`An activity can be planned for at most ${MAX_ACTIVITY_HOURS} hours.`, 400, 'INVALID_PLANNED_END');
  }

  const current = await currentFor(employee);
  if (current) {
    throw new ActivityError(`Finish or cancel "${current.title}" first.`, 409, 'ACTIVITY_IN_PROGRESS', { current: present(current, now) });
  }

  const siteInfo = await SiteResolver.resolveSite(body.latitude, body.longitude, employee);
  const siteName = text(body.siteName, 150) || siteInfo?.siteName || null;

  const activity = await EmployeeActivity.create({
    employeeId: employee.id,
    date: istDate(startedAt),
    title,
    notes: text(body.notes, 2000) || null,
    startedAt,
    plannedEndAt,
    deadlineAt: plannedEndAt,
    startLatitude: coord(body.latitude, 90),
    startLongitude: coord(body.longitude, 180),
    siteName
  });
  ActivityNotificationService.dispatch({ eventType: 'ACTIVITY_STARTED', activity, employee, details: { siteName, siteInfo } });
  return activity;
}

function assertInProgress(activity) {
  if (activity.status !== 'IN_PROGRESS') {
    throw new ActivityError(`This activity is already ${activity.status === 'COMPLETED' ? 'finished' : 'cancelled'}.`, 409, 'NOT_IN_PROGRESS');
  }
}

// Extra time with the reason: from the current deadline when asked early, from now when it has already passed
async function extend(activity, body = {}, now = Date.now()) {
  assertInProgress(activity);
  const extraMinutes = Number(body.extraMinutes);
  if (!Number.isInteger(extraMinutes) || extraMinutes < MIN_EXTRA_MINUTES || extraMinutes > MAX_EXTRA_MINUTES) {
    throw new ActivityError(`extraMinutes must be a whole number from ${MIN_EXTRA_MINUTES} to ${MAX_EXTRA_MINUTES}.`, 400, 'INVALID_EXTRA_MINUTES');
  }
  const reason = text(body.reason, 500);
  if (reason.length < 3) throw new ActivityError('Say why the extra time is needed (reason).', 400, 'REASON_REQUIRED');

  const previousDeadlineAt = activity.deadlineAt;
  const newDeadlineAt = Math.max(now, previousDeadlineAt) + extraMinutes * MINUTE;
  if (newDeadlineAt > activity.startedAt + MAX_ACTIVITY_HOURS * 60 * MINUTE) {
    throw new ActivityError(`An activity can last at most ${MAX_ACTIVITY_HOURS} hours; finish this one and start a new one.`, 400, 'TOO_LONG');
  }
  activity.extensions = [...activity.extensions, { at: now, extraMinutes, reason, previousDeadlineAt, newDeadlineAt }];
  activity.deadlineAt = newDeadlineAt;
  activity.deadlineReminders = 0;
  activity.lastReminderAt = null;
  const saved = await activity.save();
  const emp = await Employee.findByPk(activity.employeeId);
  ActivityNotificationService.dispatch({
    eventType: 'ACTIVITY_EXTENDED',
    activity: saved,
    employee: emp,
    details: { extraMinutes, reason, previousDeadlineAt, newDeadlineAt, siteName: saved.siteName }
  });
  return saved;
}

async function finish(activity, body = {}, now = Date.now()) {
  assertInProgress(activity);
  const reason = text(body.reason, 500);
  if (now > activity.deadlineAt + LATE_GRACE_MS && reason.length < 3) {
    throw new ActivityError('This activity ran past its time. Say why (reason) to finish it.', 400, 'REASON_REQUIRED');
  }
  activity.status = 'COMPLETED';
  activity.endedAt = now;
  if (reason) activity.finishReason = reason;
  const notes = text(body.notes, 2000);
  if (notes) activity.notes = activity.notes ? `${activity.notes}\n${notes}` : notes;
  activity.endLatitude = coord(body.latitude, 90);
  activity.endLongitude = coord(body.longitude, 180);

  const emp = await Employee.findByPk(activity.employeeId);
  if (!activity.siteName) {
    const sInfo = await SiteResolver.resolveSite(activity.startLatitude || activity.endLatitude, activity.startLongitude || activity.endLongitude, emp);
    activity.siteName = text(body.siteName, 150) || sInfo?.siteName || null;
  }
  const saved = await activity.save();
  const siteInfo = await SiteResolver.resolveSite(saved.endLatitude || saved.startLatitude, saved.endLongitude || saved.startLongitude, emp);
  const isLate = saved.endedAt > saved.plannedEndAt;

  ActivityNotificationService.dispatch({
    eventType: isLate ? 'ACTIVITY_COMPLETED_LATE' : 'ACTIVITY_COMPLETED',
    activity: saved,
    employee: emp,
    details: {
      siteName: saved.siteName || siteInfo?.siteName,
      siteInfo,
      finishLatitude: saved.endLatitude,
      finishLongitude: saved.endLongitude,
      reason,
      takenMinutes: Math.max(0, Math.round((saved.endedAt - saved.startedAt) / MINUTE)),
      overPlanMinutes: Math.max(0, Math.round((saved.endedAt - saved.plannedEndAt) / MINUTE))
    }
  });
  return saved;
}

async function cancel(activity, body = {}, now = Date.now()) {
  assertInProgress(activity);
  activity.status = 'CANCELLED';
  activity.endedAt = now;
  const reason = text(body.reason, 500);
  if (reason) activity.finishReason = reason;
  const saved = await activity.save();
  const emp = await Employee.findByPk(activity.employeeId);
  ActivityNotificationService.dispatch({
    eventType: 'ACTIVITY_CANCELLED',
    activity: saved,
    employee: emp,
    details: { reason }
  });
  return saved;
}

async function listForDay(employee, date) {
  return EmployeeActivity.findAll({
    where: { employeeId: employee.id, date },
    order: [['startedAt', 'ASC']]
  });
}

// Clocked out = today's latest attendance session has a check-out
async function hasClockedOut(employee, date) {
  const session = await Attendance.findOne({
    where: { userId: { [Op.in]: [employee.id, employee.empCode].filter(Boolean) }, date },
    order: [['createdAt', 'DESC']]
  });
  const out = session && session.checkOut;
  return Boolean(out) && !['null', 'undefined', '-', ''].includes(String(out).trim());
}

// Rings every phone the employee has registered; true when at least one push was delivered
async function ringPhones(employee, title, body, payload) {
  const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
  const rows = await DeviceToken.findAll({ where: { employeeId: { [Op.in]: [employee.id, employee.empCode].filter(Boolean) } } });
  const tokens = [...new Set([...rows.map((r) => r.token), employee.fcmToken].filter(Boolean))];
  let delivered = false;
  for (const token of tokens) {
    if (await HeartbeatMonitorService.sendPush(token, title, body, payload)) delivered = true;
  }
  return delivered;
}

// Called every minute by CronScheduler. `ring` is replaceable for tests.
async function runOverdueReminders(now = Date.now(), ring = ringPhones) {
  const today = istDate(now);
  const due = await EmployeeActivity.findAll({
    where: {
      status: 'IN_PROGRESS',
      date: today,
      deadlineAt: { [Op.lte]: now },
      deadlineReminders: { [Op.lt]: MAX_RINGS_PER_DEADLINE }
    }
  });
  let rang = 0;
  for (const activity of due) {
    // a few seconds of slack: the minute loop does not fire at exactly the same second each time
    if (activity.lastReminderAt && now - activity.lastReminderAt < REMINDER_EVERY_MINUTES * MINUTE - 5000) continue;
    const employee = await Employee.findByPk(activity.employeeId);
    if (!employee || await hasClockedOut(employee, today)) continue;

    const delivered = await ring(
      employee,
      `⏰ Time is up: ${activity.title}`,
      `Your planned time for "${activity.title}" ended at ${istClock(activity.deadlineAt)}. How much extra time do you need, and why?`,
      {
        type: 'ALARM',
        sound: 'alarm_loud',
        action: 'activity_extend',
        activityId: activity.id,
        activityTitle: activity.title,
        deadlineAt: activity.deadlineAt
      }
    );
    if (!delivered) continue;
    if (activity.deadlineReminders === 0) {
      ActivityNotificationService.dispatch({
        eventType: 'ACTIVITY_OVERDUE',
        activity,
        employee,
        details: { deadlineAt: activity.deadlineAt }
      });
    }
    activity.remindersSent += 1;
    activity.deadlineReminders += 1;
    activity.lastReminderAt = now;
    await activity.save();
    rang++;
  }
  return { due: due.length, rang };
}

module.exports = {
  ActivityError,
  REMINDER_EVERY_MINUTES,
  MAX_RINGS_PER_DEADLINE,
  istDate,
  parseTime,
  resolveEmployee,
  present,
  currentFor,
  start,
  extend,
  finish,
  cancel,
  listForDay,
  hasClockedOut,
  runOverdueReminders
};
