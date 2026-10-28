const crypto = require('crypto');
const { Op } = require('sequelize');
const WorkdayCalendarService = require('../../../../shared/services/WorkdayCalendarService');
const LeaveAdjustment = require('../../../../shared/models/LeaveAdjustment');
const { Employee, Attendance } = require('../../../../shared/models');

class SpecialEarnedCreditService {
  /**
   * Evaluates an individual attendance punch/session and automatically credits
   * Special Earned Leave if the date is a Sunday / Weekly-Off or Location Holiday for that employee.
   *
   * @param {Object} record - Attendance record instance or plain object
   * @param {Object} emp - Employee record instance or plain object
   * @returns {Promise<{ credited: boolean, reason?: string, record?: Object }>}
   */
  static async evaluateAndCredit(record, emp) {
    try {
      if (!record || (!record.checkIn && !record.checkOut && !record.workingHours)) {
        return { credited: false, reason: 'NO_VALID_PUNCH' };
      }
      if (!emp) {
        return { credited: false, reason: 'NO_EMPLOYEE' };
      }

      const dateStr = record.date ? String(record.date).slice(0, 10) : null;
      if (!dateStr || dateStr.length !== 10) {
        return { credited: false, reason: 'INVALID_DATE' };
      }

      // Check whether this date is Sunday/Weekly-Off or Holiday for THIS specific employee
      const dayEval = await WorkdayCalendarService.evaluateEmployeeDay(emp, dateStr);
      const isWeeklyOff = dayEval.reason === 'WEEKLY_OFF';
      const isHoliday = dayEval.reason === 'HOLIDAY';

      if (!isWeeklyOff && !isHoliday) {
        return { credited: false, reason: 'REGULAR_WORKDAY' };
      }

      const year = parseInt(dateStr.slice(0, 4), 10);
      const month = parseInt(dateStr.slice(5, 7), 10);
      const creditType = isWeeklyOff 
        ? 'Special Earned - Sunday' 
        : `Special Earned - Holiday: ${dayEval.details || 'Holiday'}`;
      const reasonText = isWeeklyOff 
        ? `Auto-credit: Worked on Sunday (${dateStr})` 
        : `Auto-credit: Worked on Holiday (${dayEval.details || 'Holiday'} - ${dateStr})`;

      // Guarantee idempotency: check if credit already exists for this employee and workDate
      const existing = await LeaveAdjustment.findOne({
        where: {
          employeeId: emp.id,
          workDate: dateStr,
          adjustmentType: 'SPECIAL_EARNED_CREDIT',
          status: 'ACTIVE'
        }
      });

      if (existing) {
        return { credited: false, reason: 'ALREADY_EXISTS', record: existing };
      }

      // Create Special Earned Leave credit in location_leave_adjustments
      const newCredit = await LeaveAdjustment.create({
        id: crypto.randomUUID(),
        employeeId: emp.id,
        empCode: emp.empCode || emp.emp_code || emp.id,
        employeeName: emp.name,
        leaveType: creditType,
        adjustmentType: 'SPECIAL_EARNED_CREDIT',
        days: 1.0,
        reason: reasonText,
        effectiveDate: dateStr,
        workDate: dateStr,
        year,
        month,
        adjustedBy: 'System (Attendance Sync)',
        status: 'ACTIVE'
      });

      console.log(`[SpecialEarnedCreditService] Successfully auto-credited 1 day to ${emp.name} (${emp.id}) for working on ${dateStr} [${creditType}]`);
      return { credited: true, record: newCredit };
    } catch (error) {
      console.error('[SpecialEarnedCreditService] Error evaluating credit:', error.message);
      return { credited: false, error: error.message };
    }
  }

  /**
   * Batch synchronizes special earned credits for all attendance records in a given month (YYYY-MM)
   * or date range. Idempotent: will not create duplicate credits.
   *
   * @param {string} monthStr - Format 'YYYY-MM' (e.g. '2026-10')
   * @returns {Promise<{ success: boolean, totalProcessed: number, newlyCredited: number, credits: Array }>}
   */
  static async syncCreditsForMonth(monthStr) {
    try {
      if (!monthStr || !monthStr.includes('-')) {
        const now = new Date();
        monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }

      const allEmployees = await Employee.findAll({
        where: { status: { [Op.in]: ['ACTIVE', 'active'] } }
      });

      const empMap = new Map();
      allEmployees.forEach(e => {
        empMap.set(String(e.id).toLowerCase(), e);
        if (e.empCode) empMap.set(String(e.empCode).toLowerCase(), e);
        if (e.emp_code) empMap.set(String(e.emp_code).toLowerCase(), e);
        if (e.name) empMap.set(String(e.name).toLowerCase(), e);
      });

      const attendanceRecords = await Attendance.findAll({
        where: {
          date: { [Op.like]: `${monthStr}%` },
          [Op.or]: [
            { checkIn: { [Op.ne]: null } },
            { checkOut: { [Op.ne]: null } },
            { workingHours: { [Op.ne]: null } }
          ]
        }
      });

      let newlyCredited = 0;
      const createdCredits = [];

      for (const rec of attendanceRecords) {
        const uId = String(rec.userId || '').trim().toLowerCase();
        const uName = String(rec.userName || '').trim().toLowerCase();
        const emp = empMap.get(uId) || empMap.get(uName);
        if (!emp) continue;

        const res = await this.evaluateAndCredit(rec, emp);
        if (res.credited) {
          newlyCredited++;
          createdCredits.push({
            employeeId: emp.id,
            name: emp.name,
            date: rec.date,
            type: res.record?.leaveType
          });
        }
      }

      return {
        success: true,
        month: monthStr,
        totalAttendanceRecords: attendanceRecords.length,
        newlyCredited,
        credits: createdCredits
      };
    } catch (err) {
      console.error('[SpecialEarnedCreditService] syncCreditsForMonth error:', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = SpecialEarnedCreditService;
