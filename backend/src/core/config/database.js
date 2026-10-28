const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

let sequelize;

const isPostgres = process.env.DB_DIALECT === 'postgres' || !!process.env.DATABASE_URL;

if (isPostgres) {
  try {
    const pg = require('pg');
    pg.defaults.parseInt8 = true;
  } catch (e) {}

  const dbUrl = process.env.DATABASE_URL || 
    `postgres://${process.env.DB_USER || 'hydro_admin'}:${process.env.DB_PASSWORD || 'hydro_secure_pass_2026'}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'hydro_hrms'}`;

  const isLocal = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost') || process.env.DB_SSL === 'false';
  console.log(`Connecting to PostgreSQL Database at ${dbUrl.replace(/:[^:@]+@/, ':****@')} (Local/No-SSL: ${isLocal})...`);

  sequelize = new Sequelize(dbUrl, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: isLocal ? {} : {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      min: parseInt(process.env.DB_POOL_MIN || '4', 10),
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
      max: 1, // Single-connection pool avoids writer lock contention on SQLite file
      min: 1,
      acquire: 60000,
      idle: 10000
    },
    retry: {
      max: 10,
      match: [
        /SQLITE_BUSY/,
        /database is locked/
      ]
    }
  });

  // Enforce high-concurrency WAL, memory pragmas, and 30s busy timeout
  sequelize.addHook('afterConnect', (connection) => {
    return new Promise((resolve) => {
      try {
        if (connection && typeof connection.exec === 'function') {
          connection.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 30000;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;
            PRAGMA temp_store = MEMORY;
            PRAGMA mmap_size = 268435456;
            PRAGMA wal_autocheckpoint = 1000;
          `, (err) => {
            if (err) console.warn('[Database Pragma Error]:', err.message);
            resolve();
          });
        } else if (connection && typeof connection.run === 'function') {
          connection.run('PRAGMA journal_mode = WAL;');
          connection.run('PRAGMA busy_timeout = 30000;');
          connection.run('PRAGMA synchronous = NORMAL;');
          connection.run('PRAGMA cache_size = -64000;');
          connection.run('PRAGMA temp_store = MEMORY;');
          connection.run('PRAGMA mmap_size = 268435456;');
          connection.run('PRAGMA wal_autocheckpoint = 1000;', () => resolve());
        } else {
          resolve();
        }
      } catch (err) {
        console.warn('[Database Pragma Warning]:', err.message);
        resolve();
      }
    });
  });

  // One-time startup WAL checkpoint to maintain lean WAL file size
  sequelize.authenticate().then(async () => {
    try {
      await sequelize.query('PRAGMA wal_checkpoint(TRUNCATE);');
      console.log('[SQLite Optimizer] Checkpoint completed, WAL size reset.');
    } catch (chkErr) {
      console.warn('[SQLite Optimizer] Startup checkpoint warning:', chkErr.message);
    }
  }).catch(() => {});
}

module.exports = sequelize;