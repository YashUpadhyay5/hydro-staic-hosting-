export class AttendanceColumnGenerator {
  /**
   * Get total days in month for selected YYYY-MM
   */
  static getDaysInMonth(monthStr) {
    if (!monthStr) return 31;
    try {
      const [year, month] = monthStr.split('-');
      return new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
    } catch (e) {
      return 31;
    }
  }

  /**
   * Format day header label (e.g. "01 May 2026")
   */
  static getFormattedDayHeader(monthStr, dayNum) {
    try {
      const [year, month] = monthStr.split('-');
      const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, dayNum);
      const dayPad = String(dayNum).padStart(2, '0');
      const monthShort = d.toLocaleDateString('en-US', { month: 'short' });
      return `${dayPad} ${monthShort} ${year}`;
    } catch (e) {
      return `Day ${dayNum}`;
    }
  }

  /**
   * Universal date extractor helper
   */
  static extractYYYYMMDD(punch) {
    if (!punch) return '';
    if (typeof punch === 'string') {
      if (punch.match(/^\d{4}-\d{2}-\d{2}/)) return punch.slice(0, 10);
      try {
        const d = new Date(punch);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch (e) {}
      return punch;
    }
    const rawDate = punch.date || punch.createdAt || punch.punchInTime || punch.clockInTime || punch.timestamp || punch.punchTime || '';
    if (typeof rawDate === 'number') {
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch (e) {}
    }
    const rawStr = String(rawDate).trim();
    if (rawStr.match(/^\d{4}-\d{2}-\d{2}/)) return rawStr.slice(0, 10);
    if (rawStr.match(/^\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/)) {
      const parts = rawStr.split(/[\/\-\.]/);
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    try {
      const d = new Date(rawStr);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch (e) {}
    return rawStr;
  }

  /**
   * Get statutory attendance symbol (P, A, L, WO, H, OD, HD) for an employee on a date
   */
  static getAttendanceSymbol(dateStr, empPunches = [], empLeaves = [], weeklyOffsSetting = 'Sunday') {
    // Check if approved leave exists for dateStr
    const hasApprovedLeave = empLeaves.some(l => {
      const sDate = this.extractYYYYMMDD(l.startDate || l.start_date || l.date || '');
      const eDate = this.extractYYYYMMDD(l.endDate || l.end_date || l.date || '');
      return dateStr >= sDate && dateStr <= eDate;
    });

    if (hasApprovedLeave) {
      const leaveObj = empLeaves.find(l => {
        const sDate = this.extractYYYYMMDD(l.startDate || l.start_date || l.date || '');
        const eDate = this.extractYYYYMMDD(l.endDate || l.end_date || l.date || '');
        return dateStr >= sDate && dateStr <= eDate;
      });
      const type = String(leaveObj?.type || '').toUpperCase();
      if (type.includes('SICK') || type === 'SL') return 'SL';
      if (type.includes('CASUAL') || type === 'CL') return 'CL';
      if (type.includes('EARNED') || type === 'EL') return 'EL';
      return 'L';
    }

    // Check if punch exists on dateStr
    const hasPunch = empPunches.some(p => {
      const pDateStr = this.extractYYYYMMDD(p);
      return pDateStr === dateStr || pDateStr.startsWith(dateStr);
    });

    if (hasPunch) {
      return 'P';
    }

    // Check if Sunday or Weekly Off
    try {
      const [y, m, dNum] = dateStr.split('-');
      const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(dNum, 10));
      if (d.getDay() === 0) return 'WO'; // Sunday
      if (d.getDay() === 6 && (weeklyOffsSetting || '').toLowerCase().includes('saturday')) return 'WO';
    } catch (e) {}

    return 'A'; // Absent
  }
}
