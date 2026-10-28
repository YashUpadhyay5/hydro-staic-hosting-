const express = require('express');
const router = express.Router();
const Setting = require('../../../shared/models/Setting');
const SettingAuditLog = require('../../../shared/models/SettingAuditLog');
const sequelize = require('../../../config/database');
const requireRole = require('../../../core/middleware/requireRole');

const DEFAULT_SETTINGS = {
  id: 1,
  config_version: 1,
  punch_in_start: '08:30',
  punch_in_end: '10:00',
  punch_out_time: '18:00',
  location_provider: 'GPS Preferred',
  gps_ratio_count: 1,
  cellular_ratio_count: 6,
  location_update_interval: '30 Seconds',
  grace_minutes: 15,
  half_day_minutes: 240,
  full_day_minutes: 480,
  min_working_minutes: 240,
  max_working_minutes: 720,
  overtime_threshold_minutes: 480,
  auto_sync_interval_seconds: 30,
  allow_cross_day: true
};

const VALID_LOCATION_PROVIDERS = ['GPS Only', 'Cellular Only', 'GPS Preferred', 'GPS + Cellular'];
const VALID_INTERVALS = ['10 Seconds', '30 Seconds', '60 Seconds', '120 Seconds', '300 Seconds', '600 Seconds'];

// Safe auto-migration helper to add missing columns to SQLite settings table
const ensureSettingsColumns = async () => {
  try {
    if (sequelize.getDialect() !== 'sqlite') return;
    const [columns] = await sequelize.query("PRAGMA table_info(settings);");
    const names = columns.map(c => c.name);

    const checkAndAdd = async (colName, colDef) => {
      if (!names.includes(colName)) {
        await sequelize.query(`ALTER TABLE settings ADD COLUMN ${colName} ${colDef};`);
        console.log(`Auto-migrated settings: added column ${colName}`);
      }
    };

    await checkAndAdd('config_version', 'INTEGER DEFAULT 1');
    await checkAndAdd('gps_ratio_count', 'INTEGER DEFAULT 1');
    await checkAndAdd('cellular_ratio_count', 'INTEGER DEFAULT 6');
    await checkAndAdd('grace_minutes', 'INTEGER DEFAULT 15');
    await checkAndAdd('half_day_minutes', 'INTEGER DEFAULT 240');
    await checkAndAdd('full_day_minutes', 'INTEGER DEFAULT 480');
    await checkAndAdd('min_working_minutes', 'INTEGER DEFAULT 240');
    await checkAndAdd('max_working_minutes', 'INTEGER DEFAULT 720');
    await checkAndAdd('overtime_threshold_minutes', 'INTEGER DEFAULT 480');
    await checkAndAdd('auto_sync_interval_seconds', 'INTEGER DEFAULT 30');
    await checkAndAdd('allow_cross_day', 'TINYINT(1) DEFAULT 1');
  } catch (err) {
    console.error('Settings auto-migration notice:', err.message);
  }
};

// GET /api/settings - Fetch current settings supporting versioned queries (?v=N / HTTP 304)
router.get('/', async (req, res) => {
  try {
    await ensureSettingsColumns();
    const [settings] = await Setting.findOrCreate({
      where: { id: 1 },
      defaults: DEFAULT_SETTINGS
    });

    const clientVersion = parseInt(req.query.v || req.headers['x-config-version'] || '0', 10);
    res.setHeader('X-Config-Version', String(settings.config_version || 1));
    res.setHeader('Cache-Control', 'no-cache');

    if (clientVersion > 0 && clientVersion === settings.config_version) {
      return res.status(304).end(); // 304 Not Modified
    }

    return res.status(200).json(settings);
  } catch (error) {
    console.error('Error fetching system settings:', error);
    return res.status(500).json({ error: error.message, messageKey: 'settings.fetch_failed' });
  }
});

// PUT /api/settings - Update settings with payload validation & config_version increment
router.put('/', requireRole(['ADMIN']), async (req, res) => {
  try {
    await ensureSettingsColumns();
    const {
      punch_in_start,
      punch_in_end,
      punch_out_time,
      location_provider,
      gps_ratio_count,
      cellular_ratio_count,
      location_update_interval,
      grace_minutes,
      half_day_minutes,
      full_day_minutes,
      min_working_minutes,
      max_working_minutes,
      overtime_threshold_minutes,
      auto_sync_interval_seconds,
      allow_cross_day
    } = req.body;

    if (location_provider && !VALID_LOCATION_PROVIDERS.includes(location_provider)) {
      return res.status(400).json({ error: `Invalid location_provider. Allowed: ${VALID_LOCATION_PROVIDERS.join(', ')}` });
    }

    if (location_update_interval !== undefined && typeof location_update_interval !== 'string' && typeof location_update_interval !== 'number') {
      return res.status(400).json({ error: 'location_update_interval must be a valid string or number.' });
    }

    const parsedGpsRatio = parseInt(gps_ratio_count || 1, 10);
    const parsedCellularRatio = parseInt(cellular_ratio_count || 6, 10);
    if (isNaN(parsedGpsRatio) || parsedGpsRatio < 1) {
      return res.status(400).json({ error: 'gps_ratio_count must be a positive integer >= 1.' });
    }
    if (isNaN(parsedCellularRatio) || parsedCellularRatio < 1) {
      return res.status(400).json({ error: 'cellular_ratio_count must be a positive integer >= 1.' });
    }

    const [settings] = await Setting.findOrCreate({
      where: { id: 1 },
      defaults: DEFAULT_SETTINGS
    });

    const previousValues = { ...settings.toJSON() };

    // Increment config version on live update
    settings.config_version = (settings.config_version || 1) + 1;

    if (punch_in_start !== undefined) settings.punch_in_start = String(punch_in_start).trim();
    if (punch_in_end !== undefined) settings.punch_in_end = String(punch_in_end).trim();
    if (punch_out_time !== undefined) settings.punch_out_time = String(punch_out_time).trim();
    if (location_provider !== undefined) settings.location_provider = location_provider;
    settings.gps_ratio_count = parsedGpsRatio;
    settings.cellular_ratio_count = parsedCellularRatio;
    if (location_update_interval !== undefined) settings.location_update_interval = location_update_interval;

    if (grace_minutes !== undefined) settings.grace_minutes = Math.max(0, parseInt(grace_minutes, 10));
    if (half_day_minutes !== undefined) settings.half_day_minutes = Math.max(60, parseInt(half_day_minutes, 10));
    if (full_day_minutes !== undefined) settings.full_day_minutes = Math.max(120, parseInt(full_day_minutes, 10));
    if (min_working_minutes !== undefined) settings.min_working_minutes = Math.max(60, parseInt(min_working_minutes, 10));
    if (max_working_minutes !== undefined) settings.max_working_minutes = Math.min(1440, parseInt(max_working_minutes, 10));
    if (overtime_threshold_minutes !== undefined) settings.overtime_threshold_minutes = Math.max(60, parseInt(overtime_threshold_minutes, 10));
    if (auto_sync_interval_seconds !== undefined) settings.auto_sync_interval_seconds = Math.max(5, parseInt(auto_sync_interval_seconds, 10));
    if (allow_cross_day !== undefined) settings.allow_cross_day = Boolean(allow_cross_day);

    await settings.save();

    // Immediately bust HeartbeatMonitorService config cache so the new location interval takes effect
    try {
      const HeartbeatMonitorService = require('../../../shared/services/HeartbeatMonitorService');
      if (typeof HeartbeatMonitorService.invalidateConfigCache === 'function') {
        HeartbeatMonitorService.invalidateConfigCache();
      }
    } catch (hbCacheErr) {}

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1';
    await SettingAuditLog.create({
      admin_user_id: req.user ? (req.user.id || req.user.empCode) : 'ADMIN',
      changes_json: JSON.stringify({ previous: previousValues, updated: settings }),
      ip_address: String(clientIp)
    }).catch(err => console.error('Non-blocking audit log creation error:', err.message));

    res.setHeader('X-Config-Version', String(settings.config_version));
    return res.status(200).json(settings);
  } catch (error) {
    console.error('Error updating system settings:', error);
    return res.status(500).json({ error: error.message, messageKey: 'settings.update_failed' });
  }
});

module.exports = router;
