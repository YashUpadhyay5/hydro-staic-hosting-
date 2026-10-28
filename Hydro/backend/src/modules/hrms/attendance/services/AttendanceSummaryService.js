const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const Leave = require('../../../../shared/models/Leave');
const sequelize = require('../../../../config/database');
const { Op } = require('sequelize');

const getAuthoritativeISTDate = (d = new Date()) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

class AttendanceSummaryService {
  /**
   * Generates authoritative attendance metrics for a single date.
   * Single source of truth for HR dashboards & WhatsApp notifications.
   */
  static async getDailySummary(rawDateStr) {
    const targetDate = rawDateStr ? (rawDateStr.length === 10 ? rawDateStr : getAuthoritativeISTDate(rawDateStr)) : getAuthoritativeISTDate();

    // 1. Fetch Active Employees
    const activeEmployees = await Employee.findAll({
      where: {
        status: { [Op.or]: ['ACTIVE', 'Active', 'active', null] }
      }
    });

    // Support alternate date formats in query (YYYY-MM-DD vs DD-MM-YYYY)
    let altDate = targetDate;
    if (targetDate.includes('-')) {
      const parts = targetDate.split('-');
      if (parts.length === 3) {
        altDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    // 2. Fetch Attendance Records for Target Date
    const attendanceRecords = await Attendance.findAll({
      where: {
        [Op.or]: [
          { date: { [Op.in]: Array.from(new Set([targetDate, altDate].filter(Boolean))) } },
          sequelize.where(sequelize.fn('date', sequelize.col('createdAt')), targetDate)
        ]
      }
    });

    // 3. Fetch Approved Leaves for Target Date
    let leaveRecords = [];
    try {
      leaveRecords = await Leave.findAll({
        where: {
          status: { [Op.or]: ['APPROVED', 'Approved', 'approved'] },
          startDate: { [Op.lte]: targetDate },
          endDate: { [Op.gte]: targetDate }
        }
      });
    } catch (e) {
      console.warn('[AttendanceSummaryService] Leave query fallback warning:', e.message);
    }

    const totalEmployees = activeEmployees.length;
    let presentCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let halfDayCount = 0;
    let lateCount = 0;
    let notMarkedCount = 0;

    // Create multi-key index maps for 100% resilient lookup
    const attendanceMap = new Map();
    attendanceRecords.forEach(a => {
      [a.userId, a.userName, a.empCode].filter(Boolean).forEach(k => {
        attendanceMap.set(String(k).trim().toLowerCase(), a);
      });
    });

    const leaveMap = new Map();
    leaveRecords.forEach(l => {
      [l.userId, l.user_id, l.employeeId, l.userName].filter(Boolean).forEach(k => {
        leaveMap.set(String(k).trim().toLowerCase(), l);
      });
    });

    // Categorize each active employee using all identifiers (id, empCode, emp_code, name)
    activeEmployees.forEach(emp => {
      const keys = [emp.id, emp.empCode, emp.emp_code, emp.name].filter(Boolean).map(k => String(k).trim().toLowerCase());
      
      let att = null;
      for (const k of keys) {
        if (attendanceMap.has(k)) {
          att = attendanceMap.get(k);
          break;
        }
      }

      let lve = null;
      for (const k of keys) {
        if (leaveMap.has(k)) {
          lve = leaveMap.get(k);
          break;
        }
      }

      if (att) {
        const status = String(att.status || '').toUpperCase();
        if (status.includes('HALF') || status.includes('HALF_DAY')) {
          halfDayCount++;
        } else {
          presentCount++;
        }

        if (att.isLate || status.includes('LATE')) {
          lateCount++;
        }
      } else if (lve) {
        const leaveType = String(lve.leaveType || lve.type || '').toUpperCase();
        if (leaveType.includes('HALF')) {
          halfDayCount++;
        } else {
          leaveCount++;
        }
      } else {
        // No attendance and no approved leave
        absentCount++;
        notMarkedCount++;
      }
    });

    const attendancePercentage = totalEmployees > 0 
      ? Number((((presentCount + (halfDayCount * 0.5)) / totalEmployees) * 100).toFixed(2)) 
      : 0;

    return {
      date: targetDate,
      totalEmployees,
      present: presentCount,
      absent: absentCount,
      onLeave: leaveCount,
      halfDay: halfDayCount,
      late: lateCount,
      notMarked: notMarkedCount,
      attendancePercentage: attendancePercentage.toFixed(2),
      isHoliday: false,
      isWeekOff: false
    };
  }
}

module.exports = AttendanceSummaryService;
