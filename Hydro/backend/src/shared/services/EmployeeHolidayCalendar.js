const HolidayCalendar = require('../models/HolidayCalendar');
const { holidayMapFromRows } = require('../../modules/hrms/leave/services/WorkingDays');

/**
 * The employee's own holiday calendar, exactly as the "my holidays" screen shows it: the first calendar
 * whose location equals the employee's location (or whose name contains it), else the default calendar,
 * else the first calendar. Shared by GET /employees/my-holidays, GET /employees/:id/holidays and leave
 * day counting, so a leave never skips a holiday the employee cannot see (or the other way round).
 * Returns { locationName, calendar } (calendar is null when there are none).
 */
async function resolveEmployeeCalendar(employee) {
  const locationName = employee.location || employee.holidayDetails || 'Headquarters';

  // Search for location calendar in DB
  let calendar = null;
  try {
    const allCalendars = await HolidayCalendar.findAll();
    calendar = allCalendars.find(c =>
      (c.location && c.location.toLowerCase() === locationName.toLowerCase()) ||
      (c.name && c.name.toLowerCase().includes(locationName.toLowerCase()))
    );
    if (!calendar && allCalendars.length > 0) {
      calendar = allCalendars.find(c => c.isDefault) || allCalendars[0];
    }
  } catch (dbErr) {
    console.warn('HolidayCalendar table query warning:', dbErr.message);
  }
  return { locationName, calendar };
}

/** Map 'YYYY-MM-DD' -> title of the holidays stored in the employee's calendar (an empty calendar skips nothing). */
async function getEmployeeHolidayMap(employee) {
  const { calendar } = await resolveEmployeeCalendar(employee);
  return holidayMapFromRows(calendar?.holidays || []);
}

module.exports = { resolveEmployeeCalendar, getEmployeeHolidayMap };
