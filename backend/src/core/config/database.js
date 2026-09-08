const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

let sequelize;

if (process.env.DATABASE_URL) {
  console.log('Connecting to Cloud PostgreSQL Database via DATABASE_URL...');
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    pool: {
      max: 10,
      min: 1,
      acquire: 30000,
      idle: 10000
    }
  });
} else {
  const STORAGE_PATH = process.env.STORAGE_PATH 
    ? path.resolve(process.env.STORAGE_PATH) 
    : path.resolve(__dirname, '../../../../storage');
  if (!fs.existsSync(STORAGE_PATH)){
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
  }

  const dbPath = path.join(STORAGE_PATH, 'database.sqlite');
  console.log(`Connecting to local SQLite database at ${dbPath}...`);

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false,
    pool: {
      max: 5,
      min: 1,
      acquire: 30000,
      idle: 10000
    },
    retry: {
      max: 5,
      match: [
        /SQLITE_BUSY/,
        /database is locked/
      ]
    }
  });

  // Enforce high-concurrency WAL & busy timeout pragmas on SQLite connections
  sequelize.addHook('afterConnect', (connection) => {
    try {
      if (connection && typeof connection.run === 'function') {
        connection.run('PRAGMA journal_mode = WAL;');
        connection.run('PRAGMA busy_timeout = 10000;');
        connection.run('PRAGMA synchronous = NORMAL;');
        connection.run('PRAGMA cache_size = -64000;');
      }
    } catch (err) {
      console.warn('[Database Pragma Warning]:', err.message);
    }
  });
}

module.exports = sequelize;