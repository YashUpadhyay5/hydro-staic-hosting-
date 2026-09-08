const Setting = require('../models/Setting');

class ShiftEngine {
  /**
   * Parse time strings like '09:00:00', '9:30 AM', '18:00' into minutes from midnight
   */
  static parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const str = String(timeStr).trim().toUpperCase();
    
    // Match HH:MM:SS AM/PM or HH:MM AM/PM
    const ampmMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = parseInt(ampmMatch[2], 10);
      const ampm = ampmMatch[4];
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    }
    return null;
  }

  /**
   * Format minutes from midnight to HH:MM:SS in 24-hour time
   */
  static formatMinutesTo24h(minutes) {
    const hrs = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
  }

  /**
   * Resolves the authoritative shift configuration for an employee
   * @param {Object} emp - Employee object or attendance_setting string
   * @param {Object} [globalSettings] - System Settings object
   * @returns {Object} { start: '09:00:00', end: '18:00:00', graceMinutes: 30, code: '9-6', label: '9:00 AM - 6:00 PM' }
   */
  static resolveEmployeeShift(emp, globalSettings = null) {
    const rawSetting = typeof emp === 'string' ? emp : (emp?.attendance_setting || emp?.attendanceSetting || '');
    const clean = String(rawSetting).trim().toLowerCase();

    // Known shift presets
    if (clean === '9-6' || clean === '9 to 6' || clean === '09:00-18:00' || clean === 'general') {
      return {
        code: '9-6',
        start: '09:00:00',
        end: '18:00:00',
        graceMinutes: 30,
        label: '9:00 AM - 6:00 PM'
      };
    }

    if (clean === '10-7' || clean === '10 to 7' || clean === '10:00-19:00') {
      return {
        code: '10-7',
        start: '10:00:00',
        end: '19:00:00',
        graceMinutes: 30,
        label: '10:00 AM - 7:00 PM'
      };
    }

    if (clean === '8-5' || clean === '8 to 5' || clean === '08:00-17:00' || clean === 'morning') {
      return {
        code: '8-5',
        start: '08:00:00',
        end: '17:00:00',
        graceMinutes: 30,
        label: '8:00 AM - 5:00 PM'
      };
    }

    if (clean === '11-8' || clean === '11 to 8' || clean === '11:00-20:00') {
      return {
        code: '11-8',
        start: '11:00:00',
        end: '20:00:00',
        graceMinutes: 30,
        label: '11:00 AM - 8:00 PM'
      };
    }

    // Dynamic pattern matching e.g. "8:30-17:30" or "9-18"
    const rangeMatch = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?$/);
    if (rangeMatch) {
      let startH = parseInt(rangeMatch[1], 10);
      const startM = parseInt(rangeMatch[2] || '0', 10);
      let endH = parseInt(rangeMatch[3], 10);
      const endM = parseInt(rangeMatch[4] || '0', 10);

      // Convert 12h to 24h if end < start (e.g. 9 to 6 -> 9 to 18)
      if (endH < startH && endH < 12) endH += 12;

      const startStr = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`;
      const endStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
      return {
        code: `${startH}-${endH}`,
        start: startStr,
        end: endStr,
        graceMinutes: 30,
        label: `${startStr.slice(0, 5)} - ${endStr.slice(0, 5)}`
      };
    }

    // Fallback to Global System Settings
    if (globalSettings) {
      const gStart = globalSettings.punch_in_start || globalSettings.punchInStart || '09:00';
      const gEnd = globalSettings.punch_out_time || globalSettings.punchOutTime || '18:00';
      const gGrace = Number(globalSettings.grace_minutes || globalSettings.graceMinutes || 30);
      const sH = gStart.length === 5 ? `${gStart}:00` : gStart;
      const eH = gEnd.length === 5 ? `${gEnd}:00` : gEnd;
      return {
        code: 'DEFAULT',
        start: sH,
        end: eH,
        graceMinutes: gGrace,
        label: `${sH.slice(0, 5)} - ${eH.slice(0, 5)}`
      };
    }

    // Default company shift 9:00 AM - 6:00 PM
    return {
      code: '9-6',
      start: '09:00:00',
      end: '18:00:00',
      graceMinutes: 30,
      label: '9:00 AM - 6:00 PM'
    };
  }

  /**
   * Resolves the most accurate check-out time when auto-closing a session
   */
  static async resolveAutoCheckOutTime(possibleUserIds, dateStr, shift, FootprintModel = null) {
    if (FootprintModel && possibleUserIds && possibleUserIds.length > 0 && dateStr) {
      try {
        const { Op } = require('sequelize');
        const lastFootprint = await FootprintModel.findOne({
          where: {
            userId: { [Op.in]: possibleUserIds },
            date: dateStr,
            batteryLevel: { [Op.ne]: null }
          },
          order: [['timestamp', 'DESC']],
          raw: true
        });

        if (lastFootprint && lastFootprint.timestamp) {
          const date = new Date(Number(lastFootprint.timestamp));
          const hrs = String(date.getHours()).padStart(2, '0');
          const mins = String(date.getMinutes()).padStart(2, '0');
          const secs = String(date.getSeconds()).padStart(2, '0');
          return {
            checkOutTime: `${hrs}:${mins}:${secs}`,
            method: 'AUTO_LOCATION_ANCHOR'
          };
        }
      } catch (e) {
        console.warn('[ShiftEngine] Error resolving location anchor:', e.message);
      }
    }

    // Fallback to scheduled shift end time
    return {
      checkOutTime: shift.end || '18:00:00',
      method: 'AUTO_SHIFT_END'
    };
  }

  /**
   * Calculates precise working hours string (HH:MM:SS) between checkIn and checkOut
   */
  static calculateWorkingHours(checkInVal, checkOutVal) {
    if (!checkInVal || !checkOutVal) return null;

    const parseToSecs = (val) => {
      const s = String(val).trim();
      const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
      if (match) {
        let hrs = parseInt(match[1], 10);
        const mins = parseInt(match[2], 10);
        const secs = parseInt(match[3] || '0', 10);
        const ampm = match[4];
        if (ampm === 'PM' && hrs < 12) hrs += 12;
        if (ampm === 'AM' && hrs === 12) hrs = 0;
        return hrs * 3600 + mins * 60 + secs;
      }
      return null;
    };

    const inSecs = parseToSecs(checkInVal);
    const outSecs = parseToSecs(checkOutVal);

    if (inSecs != null && outSecs != null) {
      let diff = outSecs - inSecs;
      if (diff < 0) diff += 86400; // Handled overnight shift wrap
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    return '08:00:00';
  }
}

module.exports = ShiftEngine;
