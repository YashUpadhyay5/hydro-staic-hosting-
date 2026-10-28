const express = require('express');
const router = express.Router();
const HolidayCalendar = require('../../../../shared/models/HolidayCalendar');

// GET all location holiday calendars
router.get('/calendars', async (req, res) => {
  try {
    const calendars = await HolidayCalendar.findAll({
      order: [['createdAt', 'ASC']]
    });
    return res.status(200).json(calendars);
  } catch (error) {
    console.error('Error fetching holiday calendars:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET single calendar by ID or location
router.get('/calendars/:idOrLocation', async (req, res) => {
  try {
    const { idOrLocation } = req.params;
    let calendar = await HolidayCalendar.findByPk(idOrLocation);
    if (!calendar) {
      calendar = await HolidayCalendar.findOne({
        where: { location: idOrLocation }
      });
    }
    if (!calendar) {
      return res.status(404).json({ error: 'Holiday calendar not found.' });
    }
    return res.status(200).json(calendar);
  } catch (error) {
    console.error('Error fetching calendar:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST / PUT Create or Update a Location Holiday Calendar
router.post('/calendars', async (req, res) => {
  try {
    const { id, name, location, state, year, isDefault, holidays } = req.body;
    if (!name || !location) {
      return res.status(400).json({ error: 'Name and location are required.' });
    }

    const calId = id || `cal-${location.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const [calendar, created] = await HolidayCalendar.findOrCreate({
      where: { id: calId },
      defaults: {
        id: calId,
        name,
        location,
        state: state || '',
        year: year || 2026,
        isDefault: isDefault || false,
        holidays: holidays || []
      }
    });

    if (!created) {
      await calendar.update({
        name,
        location,
        state: state || calendar.state,
        year: year || calendar.year,
        isDefault: isDefault !== undefined ? isDefault : calendar.isDefault,
        holidays: holidays || calendar.holidays
      });
    }

    return res.status(200).json({ success: true, calendar });
  } catch (error) {
    console.error('Error saving holiday calendar:', error);
    return res.status(500).json({ error: error.message });
  }
});

const { Op } = require('sequelize');

// POST Batch Sync all calendars from UI to DB
router.post('/calendars/sync', async (req, res) => {
  try {
    const { calendars } = req.body;
    if (!Array.isArray(calendars)) {
      return res.status(400).json({ error: 'calendars array is required.' });
    }

    const syncedIds = [];
    for (const cal of calendars) {
      const calId = cal.id || `cal-${(cal.location || cal.name).toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      syncedIds.push(calId);
      const [record, created] = await HolidayCalendar.findOrCreate({
        where: { id: calId },
        defaults: {
          id: calId,
          name: cal.name || `${cal.location} Calendar`,
          location: cal.location || cal.name,
          state: cal.state || '',
          year: cal.year || 2026,
          isDefault: cal.isDefault || false,
          holidays: cal.holidays || []
        }
      });

      if (!created) {
        await record.update({
          name: cal.name || record.name,
          location: cal.location || record.location,
          state: cal.state || record.state,
          year: cal.year || record.year,
          isDefault: cal.isDefault !== undefined ? cal.isDefault : record.isDefault,
          // never replace saved holidays with an empty list from a stale browser copy
          holidays: (Array.isArray(cal.holidays) && (cal.holidays.length > 0 || !(record.holidays || []).length)) ? cal.holidays : record.holidays
        });
      }
    }

    // NOTE: sync never deletes. A browser holding an old or short list used to wipe other calendars here.
    // Calendars are removed only through DELETE /calendars/:id.

    const allDbCalendars = await HolidayCalendar.findAll({ order: [['createdAt', 'ASC']] });
    return res.status(200).json({ success: true, calendars: allDbCalendars });
  } catch (error) {
    console.error('Error batch syncing calendars:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE a holiday calendar
router.delete('/calendars/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let calendar = await HolidayCalendar.findByPk(id);
    if (!calendar) {
      calendar = await HolidayCalendar.findOne({
        where: {
          [Op.or]: [
            { location: id },
            { name: id }
          ]
        }
      });
    }
    if (!calendar) {
      return res.status(404).json({ error: 'Calendar not found.' });
    }
    await calendar.destroy();
    return res.status(200).json({ success: true, message: 'Calendar deleted.' });
  } catch (error) {
    console.error('Error deleting calendar:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
