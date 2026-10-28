const HolidayCalendar = require('../models/HolidayCalendar');
const Leave = require('../models/Leave');
const { Op } = require('sequelize');

class WorkdayCalendarService {
  /**
   * Evaluates whether a given date is an official working day for an employee.
   * Checks Weekly Offs, Approved Leaves, and Location-based Holiday Calendars.
   *
   * @param {Object} emp - Employee Sequelize record or plain object
   * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
   * @returns {Promise<{ isWorkDay: boolean, reason: string, details: string }>}
   */
  static async evaluateEmployeeDay(emp, dateStr) {
    if (!emp) return { isWorkDay: false, reason: 'INVALID_EMPLOYEE', details: 'No employee provided' };

    // 1. Weekly-Off Check (e.g. Sunday)
    try {
      const istDate = new Date(`${dateStr}T12:00:00+05:30`);
      const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(istDate);
      const weeklyOffs = String(emp.weeklyOffs || 'Sunday').toLowerCase();

      if (weeklyOffs.includes(dayName.toLowerCase())) {
        return { isWorkDay: false, reason: 'WEEKLY_OFF', details: `${dayName} is Weekly Off` };
      }
    } catch (e) {
      console.warn('[WorkdayCalendarService] Weekly-off calculation error:', e.message);
    }

    // 2. Approved Leave Check
    try {
      const possibleUserIds = [emp.id, emp.empCode, emp.emp_code].filter(Boolean);
      const activeLeave = await Leave.findOne({
        where: {
          userId: { [Op.in]: possibleUserIds },
          status: 'approved',
          startDate: { [Op.lte]: dateStr },
          endDate: { [Op.gte]: dateStr }
        }
      });

      if (activeLeave) {
        return { isWorkDay: false, reason: 'APPROVED_LEAVE', details: `Approved Leave (${activeLeave.type || 'Leave'})` };
      }
    } catch (e) {
      console.warn('[WorkdayCalendarService] Approved leave check error:', e.message);
    }

    // 3. Holiday Calendar Check
    try {
      const empLoc = String(emp.location || '').toLowerCase().trim();
      const empHolDet = String(emp.holidayDetails || '').toLowerCase().trim();

      const calendars = await HolidayCalendar.findAll({ raw: true });
      const matchedCal = calendars.find(c => {
        const cName = String(c.name || '').toLowerCase().trim();
        const cLoc = String(c.location || '').toLowerCase().trim();
        return (empHolDet && (cName === empHolDet || cName.includes(empHolDet) || cLoc === empHolDet)) ||
               (empLoc && (cLoc === empLoc || cName.includes(empLoc)));
      });

      if (matchedCal) {
        let holidays = [];
        try {
          holidays = typeof matchedCal.holidays === 'string' ? JSON.parse(matchedCal.holidays) : (matchedCal.holidays || []);
        } catch (e) {}

        const holiday = holidays.find(h => h.date === dateStr);
        if (holiday) {
          return { isWorkDay: false, reason: 'HOLIDAY', details: holiday.title || 'Public Holiday' };
        }
      }
    } catch (e) {
      console.warn('[WorkdayCalendarService] Holiday calendar check error:', e.message);
    }

    return { isWorkDay: true, reason: 'WORKDAY', details: 'Regular Working Day' };
  }
}

module.exports = WorkdayCalendarService;
