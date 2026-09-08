const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Footprint = require('../models/Footprint');
const ShiftEngine = require('./ShiftEngine');
const HeartbeatMonitorService = require('./HeartbeatMonitorService');

class CronScheduler {
  static start() {
    console.log('[CronScheduler] Initializing zero-dependency cron scheduler...');
    
    // Auto-close stale past sessions on boot
    this.autoCloseStaleSessions().catch(err => console.error('[CronScheduler Init Auto-Close Error]:', err.message));

    let last9AMFiredDate = null;
    let last6PMFiredDate = null;

    setInterval(async () => {
      try {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const HH = now.getHours();
        const MM = now.getMinutes();

        // 0. Periodic check to auto-close any unclosed past sessions from previous dates
        if (MM === 0 || MM === 30) {
          await this.autoCloseStaleSessions();
        }

        // 1. 9:00 AM Clock-In Reminder (Trigger within the first 5 minutes of the 9:00 AM hour)
        if (HH === 9 && MM < 5 && last9AMFiredDate !== todayStr) {
          last9AMFiredDate = todayStr;
          await this.run9AMClockInReminder(todayStr);
        }

        // 2. 6:00 PM Clock-Out Alert (Trigger within the first 5 minutes of the 6:00 PM hour)
        if (HH === 18 && MM < 5 && last6PMFiredDate !== todayStr) {
          last6PMFiredDate = todayStr;
          await this.run6PMClockOutAlert(todayStr);
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

  static async run9AMClockInReminder(dateStr) {
    try {
      console.log(`[CronScheduler] Triggering 9:00 AM clock-in verification for date: ${dateStr}...`);
      
      // Find all employees who have clocked in today
      const clockedInSessions = await Attendance.findAll({
        where: { date: dateStr }
      });

      const clockedInUserIds = clockedInSessions.map(s => s.userId);

      // Find all active employees who haven't clocked in
      const missingEmployees = await Employee.findAll({
        where: {
          status: 'ACTIVE',
          role: 'EMPLOYEE',
          id: { [Op.notIn]: clockedInUserIds.length > 0 ? clockedInUserIds : [''] }
        }
      });

      console.log(`[CronScheduler] Found ${missingEmployees.length} employees missing clock-in for today.`);

      for (const emp of missingEmployees) {
        if (emp.fcmToken) {
          const success = await HeartbeatMonitorService.sendPushNotification(
            emp.fcmToken,
            'Clock-In Reminder',
            "You haven't clocked in yet. Please clock in now.",
            { action: 'open_attendance' }
          );
          if (success) {
            console.log(`[CronScheduler] Sent 9:00 AM clock-in reminder to user: ${emp.id}`);
          }
        }
      }
    } catch (err) {
      console.error('[CronScheduler] Failed running 9:00 AM job:', err.message);
    }
  }

  static async run6PMClockOutAlert(dateStr) {
    try {
      console.log(`[CronScheduler] Triggering 6:00 PM clock-out alarm for date: ${dateStr}...`);

      // Find all active unclosed office sessions
      const activeOfficeSessions = await Attendance.findAll({
        where: {
          date: dateStr,
          checkOut: null,
          workMode: 'office'
        }
      });

      for (const session of activeOfficeSessions) {
        const emp = await Employee.findByPk(session.userId);
        if (emp && emp.fcmToken) {
          const success = await HeartbeatMonitorService.sendPushNotification(
            emp.fcmToken,
            'Clock-Out Reminder',
            'Your working hours are complete. Please clock-out.',
            {
              type: 'ALARM',
              sound: 'alarm_loud',
              action: 'clock_out'
            }
          );
          if (success) {
            console.log(`[CronScheduler] Sent 6:00 PM clock-out alarm notification to user: ${emp.id}`);
          }
        }
      }
    } catch (err) {
      console.error('[CronScheduler] Failed running 6:00 PM job:', err.message);
    }
  }

  static async autoCloseStaleSessions() {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const staleSessions = await Attendance.findAll({
        where: {
          date: { [Op.ne]: todayStr },
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
