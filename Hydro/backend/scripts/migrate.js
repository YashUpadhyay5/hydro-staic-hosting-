require('dotenv').config();
const sequelize = require('../src/config/database');
const { runMigrations } = require('../src/shared/database/migrations');

(async () => {
  try {
    console.log('Connecting to database and running migrations...');
    await sequelize.authenticate();
    await runMigrations(sequelize);

    // System Settings migrations
    try {
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS config_version INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS location_provider VARCHAR(255) DEFAULT \'GPS Only\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS gps_ratio_count INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS cellular_ratio_count INTEGER DEFAULT 2;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS location_update_interval VARCHAR(255) DEFAULT \'30 Seconds\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_sync_interval_seconds INTEGER DEFAULT 30;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS allow_cross_day BOOLEAN DEFAULT true;');
      await sequelize.query('CREATE OR REPLACE VIEW system_settings AS SELECT * FROM settings;');
    } catch (e) {
      console.warn('System settings migration warning:', e.message);
    }

    console.log('Migrations executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();
