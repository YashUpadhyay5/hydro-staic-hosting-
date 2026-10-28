const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Footprint = require('../models/Footprint');
const ShiftEngine = require('./ShiftEngine');
const HeartbeatMonitorService = require('./HeartbeatMonitorService');
const WorkdayCalendarService = require('./WorkdayCalendarService');

const getAuthoritativeISTDate = (d = new Date()) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

const getISTTimeParts = (d = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date(d));
    const HH = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const MM = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    return { HH, MM };
  } catch {
    const now = new Date();
    return { HH: now.getHours(), MM: now.getMinutes() };
  }
};

class CronScheduler {
  static start() {
    console.log('[CronScheduler] Initializing zero-dependency intelligent cron scheduler...');
    
    // Auto-close stale past sessions on boot
    this.autoCloseStaleSessions().catch(err => console.error('[CronScheduler Init Auto-Close Error]:', err.message));

    let lastClockInFiredDate = null;

    setInterval(async () => {
      try {
        const now = new Date();
        const todayStr = getAuthoritativeISTDate(now);
        const { HH, MM } = getISTTimeParts(now);

        // 0. Periodic check to auto-close any unclosed past sessions from previous dates
        if (MM === 0 || MM === 30) {
          await this.autoCloseStaleSessions();
        }

        // 1. Targeted Clock-In Reminder (Trigger at 09:30 AM IST once per day)
        // Only sends to employees who are NOT clocked in, and NOT on holiday, weekly-off, or leave!
        if (HH === 9 && MM === 30 && lastClockInFiredDate !== todayStr) {
          lastClockInFiredDate = todayStr;
          await this.runTargetedClockInReminder(todayStr);
        }

        // 2. Clock-Out Repeating Loop (Every 5 minutes from 17:30 to 23:00 IST)
        // Repeatedly alerts employees who ARE clocked in but have NOT clocked out until they punch out!
        const isClockOutWindow = (HH > 17 || (HH === 17 && MM >= 30)) && HH <= 23;
        if (isClockOutWindow && (MM % 5 === 0)) {
          await this.run5MinClockOutReminderLoop(todayStr);
        }

        // 3. 1st of the month: Auto-increment allowed leaves
        if (now.getDate() === 1 && HH === 0 && MM < 5) {
          const leaveFlagFile = path.join(__dirname, `../../../../storage/leaves_incremented_${todayStr.slice(0, 7)}.flag`);
          if (!fs.existsSync(leaveFlagFile)) {
            await this.incrementMonthlyLeaves();
            try {
              fs.writeFileSync(leaveFlagFile, new Date().toISOString(), 'utf8');
            } catch (e) {}
          }
        }
      } catch (cronErr) {
        console.error('[CronScheduler Loop Error]:', cronErr.message);
      }
    }, 60 * 1000);
  }

  /**
   * Clock-In Reminder:
   * - Evaluates each active employee's workday status (Holiday, Sunday, Approved Leave).
   * - If working day and NOT clocked in, sends a targeted notification.
   * - If already clocked in, skips.
   */
  static async runTargetedClockInReminder(dateStr) {
    try {
      console.log(`[CronScheduler] Running targeted Clock-In check for date: ${dateStr}...`);
      
      // 1. Get all employees who have already clocked in today
      const todayAttendance = await Attendance.findAll({
        where: { date: dateStr }
      });

      const clockedInUserIds = new Set(
        todayAttendance
          .filter(a => a.checkIn && a.checkIn !== 'null' && a.checkIn !== '-' && String(a.checkIn).trim() !== '')
          .map(a => String(a.userId || '').toLowerCase().trim())
      );

      // 2. Fetch all active employees
      const activeEmployees = await Employee.findAll({
        where: {
          status: 'ACTIVE',
          role: 'EMPLOYEE'
        }
      });

      let sentCount = 0;
      let skippedCount = 0;

      for (const emp of activeEmployees) {
        const uid = String(emp.id || '').toLowerCase().trim();
        const ucode = String(emp.empCode || '').toLowerCase().trim();

        // Guard: Skip if already clocked in today
        if (clockedInUserIds.has(uid) || (ucode && clockedInUserIds.has(ucode))) {
          continue;
        }

        // Guard: Skip if today is Holiday, Sunday/Weekly Off, or Approved Leave
        const workdayStatus = await WorkdayCalendarService.evaluateEmployeeDay(emp, dateStr);
        if (!workdayStatus.isWorkDay) {
          console.log(`[Clock-In Reminder] Skipped ${emp.name} (${emp.id}): ${workdayStatus.details}`);
          skippedCount++;
          continue;
        }

        // Send targeted reminder to employee's device
        if (emp.fcmToken) {
          const success = await HeartbeatMonitorService.sendPushNotification(
            emp.fcmToken,
            '⏰ Clock-In Reminder',
            `Good morning ${emp.name}! You haven't clocked in for your shift today. Please punch in now.`,
            { action: 'open_attendance', type: 'CLOCK_IN_REMINDER' }
          );
          if (success) {
            console.log(`[Clock-In Reminder] Sent to ${emp.name} (${emp.id})`);
            sentCount++;
          }
        }
      }

      console.log(`[CronScheduler] Clock-In check complete: Sent ${sentCount}, Skipped ${skippedCount} (holiday/off/leave).`);
    } catch (err) {
      console.error('[CronScheduler] Failed running targeted clock-in job:', err.message);
    }
  }

  /**
   * Clock-Out 5-Minute Repeating Loop:
   * - Queries attendance records where employee IS clocked in (checkIn != null) BUT NOT clocked out (checkOut IS NULL).
   * - Sends high-priority reminder every 5 minutes until they punch out.
   * - Once they punch out, their session is no longer unclosed and reminders stop automatically.
   */
  static async run5MinClockOutReminderLoop(dateStr) {
    try {
      // Find all active unclosed sessions for today
      const unclosedSessions = await Attendance.findAll({
        where: {
          date: dateStr,
          checkIn: { [Op.ne]: null },
          [Op.or]: [
            { checkOut: null },
            { checkOut: '' },
            { checkOut: 'null' },
            { checkOut: '-' },
            { checkOut: 'undefined' }
          ]
        }
      });

      if (unclosedSessions.length === 0) return;

      console.log(`[CronScheduler 5-Min Clock-Out Pulse] Found ${unclosedSessions.length} unclosed sessions still clocked in at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`);

      for (const session of unclosedSessions) {
        const emp = await Employee.findOne({
          where: {
            [Op.or]: [
              { id: session.userId },
              { empCode: session.userId }
            ]
          }
        });

        if (emp && emp.fcmToken) {
          const success = await HeartbeatMonitorService.sendPushNotification(
            emp.fcmToken,
            '🔔 Clock-Out Reminder',
            `Hi ${emp.name}, your working hours are complete. Please clock out now.`,
            {
              type: 'ALARM',
              sound: 'alarm_loud',
              action: 'clock_out'
            }
          );
          if (success) {
            console.log(`[5-Min Clock-Out Pulse] Sent reminder to ${emp.name} (${session.userId})`);
          }
        }
      }
    } catch (err) {
      console.error('[CronScheduler 5-Min Clock-Out Pulse Error]:', err.message);
    }
  }

  static async autoCloseStaleSessions() {
    try {
      const todayStr = getAuthoritativeISTDate();
      const staleSessions = await Attendance.findAll({
        where: {
          date: { [Op.lt]: todayStr }, // Strictly past days in IST
          [Op.or]: [
            { checkOut: null },
            { checkOut: '' },
            { checkOut: 'null' },
            { checkOut: 'undefined' }
          ]
        }
      });

      if (staleSessions.length > 0) {
        console.log(`[CronScheduler] Found ${staleSessions.length} stale unclosed sessions from previous dates. Auto-closing with dynamic shift schedules...`);
        const employees = await Employee.findAll({ raw: true });
        const empMap = new Map();
        employees.forEach(e => {
          if (e.id) empMap.set(String(e.id).toLowerCase(), e);
          if (e.empCode) empMap.set(String(e.empCode).toLowerCase(), e);
          if (e.emp_code) empMap.set(String(e.emp_code).toLowerCase(), e);
          if (e.name) empMap.set(String(e.name).toLowerCase(), e);
        });

        for (const session of staleSessions) {
          const emp = empMap.get(String(session.userId || '').toLowerCase()) || 
                      empMap.get(String(session.userName || '').toLowerCase());
          const shift = ShiftEngine.resolveEmployeeShift(emp);
          const possibleIds = emp ? [emp.id, emp.empCode, emp.emp_code, session.userId].filter(Boolean) : [session.userId].filter(Boolean);
          
          const autoRes = await ShiftEngine.resolveAutoCheckOutTime(possibleIds, session.date, shift, Footprint);
          session.checkOut = autoRes.checkOutTime;
          session.clockOutMethod = autoRes.method || 'AUTO_SHIFT_END';
          session.shiftCode = shift.code;
          session.workingHours = ShiftEngine.calculateWorkingHours(session.checkIn, session.checkOut);
          await session.save();
        }
        console.log(`[CronScheduler] Successfully auto-closed ${staleSessions.length} stale past sessions.`);
      }
    } catch (err) {
      console.error('[CronScheduler] Error in autoCloseStaleSessions:', err.message);
    }
  }

  static async incrementMonthlyLeaves() {
    console.log('[CronScheduler] Triggering monthly leave auto-increment (+1 allowed leaves)...');
    try {
      // Safely increment allowedLeaves for all active employees by +1 using Sequelize built-in increment helper
      const affected = await Employee.increment('allowedLeaves', {
        by: 1,
        where: {
          status: 'ACTIVE',
          role: 'EMPLOYEE'
        }
      });
      console.log('[CronScheduler] Successfully auto-incremented allowed leaves for active employees.');
    } catch (err) {
      console.error('[CronScheduler] Failed running monthly leave increment job:', err.message);
    }
  }
}

module.exports = CronScheduler;
