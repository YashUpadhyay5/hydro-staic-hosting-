require('dotenv').config();
const sequelize = require('../src/config/database');
const { runMigrations } = require('../src/shared/database/migrations');

(async () => {
  try {
    console.log('Connecting to database and running migrations...');
    await sequelize.authenticate();
    await runMigrations(sequelize);
    console.log('Migrations executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();
