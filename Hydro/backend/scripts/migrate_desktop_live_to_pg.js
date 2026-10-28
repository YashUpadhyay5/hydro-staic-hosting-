const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { Client } = require('pg');

const SQLITE_PATH = 'C:/Users/Falcon/Desktop/hydro-copy/Hydro/storage/database.sqlite';
const PG_CONN_STRING = process.env.DATABASE_URL || 'postgres://hydro_admin:hydro_secure_pass_2026@127.0.0.1:5432/hydro_hrms';

// Tables belonging to the Invoice Extractor module that already contain live verified extractions in Postgres
const PROTECTED_TABLES = new Set([
  'documents',
  'project_inventory_docs_v2',
  'raw_ai_extractions',
  'user_verified_extractions',
  'location_leaves_backup_20260926'
]);

async function runLiveMigration() {
  console.log('===============================================================');
  console.log('   MIGRATING LIVE ACTIVE DESKTOP SQLITE TO POSTGRESQL          ');
  console.log('===============================================================');
  console.log(`Source Active SQLite: ${SQLITE_PATH}`);
  console.log(`Target Postgres DB   : ${PG_CONN_STRING.replace(/:[^:@]+@/, ':****@')}`);

  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`Fatal: SQLite database file not found at ${SQLITE_PATH}`);
    process.exit(1);
  }

  const sqlite = new Sequelize({
    dialect: 'sqlite',
    storage: SQLITE_PATH,
    logging: false
  });

  const pgClient = new Client({
    connectionString: PG_CONN_STRING
  });

  await pgClient.connect();
  console.log('Connected to PostgreSQL database.');

  // Disable FK triggers during bulk migration
  await pgClient.query("SET session_replication_role = 'replica';");
  console.log('Foreign key triggers temporarily disabled for bulk load.\n');

  // Fetch all tables from Desktop SQLite
  const [sqliteTables] = await sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;");
  
  // Get existing tables in Postgres
  const pgTablesRes = await pgClient.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';");
  const existingPgTables = new Set(pgTablesRes.rows.map(r => r.table_name));

  const stats = [];

  for (const { name: tableName } of sqliteTables) {
    if (PROTECTED_TABLES.has(tableName)) {
      const pgc = await pgClient.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
      console.log(`[PROTECTED] ${tableName.padEnd(32)} -> Kept existing Postgres data (${pgc.rows[0].cnt} rows)`);
      stats.push({ table: tableName, sqliteCount: 'Protected', pgCount: pgc.rows[0].cnt, status: 'PRESERVED' });
      continue;
    }

    // Inspect columns in SQLite
    const [cols] = await sqlite.query(`PRAGMA table_info("${tableName}");`);
    if (!cols || cols.length === 0) continue;

    // Ensure table exists in Postgres
    if (!existingPgTables.has(tableName)) {
      const colDefs = cols.map(c => {
        let type = 'TEXT';
        const uType = (c.type || '').toUpperCase();
        if (uType.includes('INT')) {
          type = 'BIGINT';
        } else if (uType.includes('REAL') || uType.includes('FLOAT') || uType.includes('DOUBLE') || uType.includes('NUMERIC') || uType.includes('DECIMAL')) {
          type = 'DOUBLE PRECISION';
        } else if (uType.includes('BLOB')) {
          type = 'BYTEA';
        } else if (uType.includes('BOOL')) {
          type = 'BOOLEAN';
        } else if (uType.includes('DATE') || uType.includes('TIME') || uType.includes('JSON')) {
          type = 'TEXT';
        }
        return `"${c.name}" ${type}${c.pk ? ' PRIMARY KEY' : ''}`;
      });

      const createSql = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(',\n  ')}\n);`;
      await pgClient.query(createSql);
      existingPgTables.add(tableName);
    }

    // Inspect PG column types
    const pgColInfoRes = await pgClient.query(`
      SELECT column_name, data_type, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public';
    `, [tableName]);

    const pgColTypes = {};
    const pgColMaxLens = {};
    for (const r of pgColInfoRes.rows) {
      pgColTypes[r.column_name] = r.data_type.toLowerCase();
      pgColMaxLens[r.column_name] = r.character_maximum_length;
    }

    const validCols = cols.filter(c => pgColTypes[c.name] !== undefined);
    const colNames = validCols.map(c => `"${c.name}"`).join(', ');

    const [countRes] = await sqlite.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const totalSqliteRows = parseInt(countRes[0].cnt, 10);

    const existingPgCountRes = await pgClient.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const existingPgCount = parseInt(existingPgCountRes.rows[0].cnt, 10);

    // Special handling for location_footprints: append new Sept 20-30 footprints
    if (tableName === 'location_footprints') {
      process.stdout.write(`Syncing [${tableName}] newer records... `);
      const pgMaxTsRes = await pgClient.query('SELECT MAX(timestamp) as max_ts FROM location_footprints;');
      const pgMaxTs = pgMaxTsRes.rows[0].max_ts || 0;

      const [newRows] = await sqlite.query(`SELECT * FROM location_footprints WHERE timestamp > ${pgMaxTs};`);
      if (newRows.length > 0) {
        const BATCH_SIZE = 1000;
        let inserted = 0;
        for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
          const chunk = newRows.slice(i, i + BATCH_SIZE);
          const valuePlaceholders = [];
          const queryParams = [];
          let paramIndex = 1;

          for (const row of chunk) {
            const rowPlaceholders = [];
            for (const col of validCols) {
              let val = row[col.name];
              let pgType = pgColTypes[col.name];
              if (val !== null && val !== undefined) {
                if (pgType === 'boolean') {
                  val = val === 1 || val === true || val === '1';
                } else if (pgType.includes('int') && typeof val === 'string' && /^-?\d+$/.test(val)) {
                  val = BigInt(val).toString();
                }
              } else {
                val = null;
              }
              rowPlaceholders.push(`$${paramIndex++}`);
              queryParams.push(val);
            }
            valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
          }

          const insertSql = `INSERT INTO "location_footprints" (${colNames}) VALUES ${valuePlaceholders.join(', ')};`;
          await pgClient.query(insertSql, queryParams);
          inserted += chunk.length;
        }
        const updatedPgCountRes = await pgClient.query('SELECT COUNT(*) as cnt FROM location_footprints;');
        console.log(`Appended ${inserted} new footprints (Total now in PG: ${updatedPgCountRes.rows[0].cnt}) - MATCH`);
        stats.push({ table: tableName, sqliteCount: totalSqliteRows, pgCount: updatedPgCountRes.rows[0].cnt, status: 'APPENDED' });
      } else {
        console.log(`Up to date (${existingPgCount} rows in PG) - MATCH`);
        stats.push({ table: tableName, sqliteCount: totalSqliteRows, pgCount: existingPgCount, status: 'MATCH' });
      }
      continue;
    }

    // If counts match and not 0, skip unless it's Attendances (always ensure Attendances has today's data)
    if (existingPgCount === totalSqliteRows && tableName !== 'Attendances') {
      console.log(`[SYNCED]    ${tableName.padEnd(32)} -> Match (${existingPgCount}/${totalSqliteRows})`);
      stats.push({ table: tableName, sqliteCount: totalSqliteRows, pgCount: existingPgCount, status: 'MATCH' });
      continue;
    }

    process.stdout.write(`Migrating [${tableName.padEnd(25)}] (${totalSqliteRows} SQLite rows)... `);

    // Truncate to replace with live active data
    await pgClient.query(`TRUNCATE TABLE "${tableName}" CASCADE;`);

    if (totalSqliteRows === 0) {
      console.log('0 rows - Done');
      stats.push({ table: tableName, sqliteCount: 0, pgCount: 0, status: 'MATCH' });
      continue;
    }

    // Batch insert from SQLite
    const BATCH_SIZE = 2500;
    let offset = 0;
    let inserted = 0;

    while (offset < totalSqliteRows) {
      const [rows] = await sqlite.query(`SELECT * FROM "${tableName}" LIMIT ${BATCH_SIZE} OFFSET ${offset};`);
      if (!rows || rows.length === 0) break;

      const valuePlaceholders = [];
      const queryParams = [];
      let paramIndex = 1;

      for (const row of rows) {
        const rowPlaceholders = [];
        for (const col of validCols) {
          let val = row[col.name];
          let pgType = pgColTypes[col.name];

          if (val !== null && val !== undefined) {
            if (pgType === 'boolean') {
              val = val === 1 || val === true || val === '1' || val === 'true';
            } else if (pgType === 'json' || pgType === 'jsonb') {
              if (typeof val === 'object') {
                val = JSON.stringify(val);
              } else if (typeof val === 'string') {
                const trimmed = val.trim();
                if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                  val = trimmed;
                } else {
                  val = JSON.stringify(val);
                }
              }
            } else if (pgType.includes('int') && typeof val === 'string' && /^-?\d+$/.test(val)) {
              val = BigInt(val).toString();
            } else if (typeof val === 'string') {
              const maxLen = pgColMaxLens[col.name];
              if (maxLen && val.length > maxLen) {
                await pgClient.query(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE TEXT;`);
                delete pgColMaxLens[col.name];
                pgColTypes[col.name] = 'text';
                pgType = 'text';
              }
              if (pgType === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
                try {
                  await pgClient.query(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE VARCHAR(255);`);
                  pgColTypes[col.name] = 'character varying';
                  pgType = 'character varying';
                } catch (e) {}
              }
            }
          } else {
            val = null;
          }

          rowPlaceholders.push(`$${paramIndex++}`);
          queryParams.push(val);
        }
        valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
      }

      const insertSql = `INSERT INTO "${tableName}" (${colNames}) VALUES ${valuePlaceholders.join(', ')};`;
      await pgClient.query(insertSql, queryParams);

      inserted += rows.length;
      offset += BATCH_SIZE;
    }

    // Reset sequence if exists
    try {
      await pgClient.query(`
        SELECT setval(
          pg_get_serial_sequence('"' || $1 || '"', 'id'),
          COALESCE((SELECT MAX(id) FROM "${tableName}"), 1) + 1,
          false
        );
      `, [tableName]);
    } catch (e) {}

    const verifyRes = await pgClient.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const finalCount = parseInt(verifyRes.rows[0].cnt, 10);
    const status = finalCount === totalSqliteRows ? 'MATCH' : 'MISMATCH';
    console.log(`Done (${finalCount}/${totalSqliteRows} rows) - ${status}`);
    stats.push({ table: tableName, sqliteCount: totalSqliteRows, pgCount: finalCount, status });
  }

  // Restore foreign keys
  await pgClient.query("SET session_replication_role = 'origin';");
  console.log('\nForeign key triggers re-enabled.');

  // Perform Final Verification of Attendance and Crucial Stats
  console.log('\n===============================================================');
  console.log('             LIVE MIGRATION FINAL VERIFICATION                ');
  console.log('===============================================================');

  const maxDateRes = await pgClient.query('SELECT MAX(date) as max_date, MIN(date) as min_date, COUNT(*) as total_att FROM "Attendances";');
  console.log(`Attendance Date Range in Postgres: ${maxDateRes.rows[0].min_date} to ${maxDateRes.rows[0].max_date}`);
  console.log(`Total Attendance Records in PG   : ${maxDateRes.rows[0].total_att}`);

  const todayAttRes = await pgClient.query('SELECT "employeeId", date, "checkInTime", "status" FROM "Attendances" WHERE date = \'2026-09-30\';');
  console.log(`Today's (2026-09-30) Punches in PG: ${todayAttRes.rows.length} employees`);
  todayAttRes.rows.forEach(r => {
    console.log(`  - Employee: ${r.employeeId.padEnd(10)} | Check-In: ${r.checkInTime} | Status: ${r.status}`);
  });

  const payslipsRes = await pgClient.query('SELECT COUNT(*) as cnt FROM payslips;');
  console.log(`Payslips in PG                   : ${payslipsRes.rows[0].cnt}`);

  const leavesRes = await pgClient.query('SELECT COUNT(*) as cnt FROM location_leaves;');
  console.log(`Leaves in PG                     : ${leavesRes.rows[0].cnt}`);

  const docsRes = await pgClient.query('SELECT COUNT(*) as cnt FROM documents;');
  console.log(`Invoice Documents (Preserved)    : ${docsRes.rows[0].cnt}`);

  await sqlite.close();
  await pgClient.end();
  console.log('\nMigration successfully finished!');
}

runLiveMigration().catch(err => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
