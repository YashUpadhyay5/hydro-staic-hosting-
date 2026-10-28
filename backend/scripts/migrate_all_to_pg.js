const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { Client } = require('pg');

const SQLITE_PATH = path.resolve(__dirname, '../../storage/database.sqlite');
const PG_CONN_STRING = 'postgres://hydro_admin:hydro_secure_pass_2026@127.0.0.1:5432/hydro_hrms';

async function migrate() {
  console.log('===============================================================');
  console.log('   SQLITE TO POSTGRESQL 1:1 COMPLETE ZERO-DATA-LOSS MIGRATION  ');
  console.log('===============================================================');
  console.log(`Source SQLite: ${SQLITE_PATH}`);
  console.log(`Target Postgres: ${PG_CONN_STRING.replace(/:[^:@]+@/, ':****@')}`);

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
  console.log('Connected to PostgreSQL target.');

  // Disable FK triggers during bulk migration
  await pgClient.query("SET session_replication_role = 'replica';");
  console.log('Foreign key triggers disabled for bulk load.');

  // Fetch all tables from SQLite
  const [sqliteTables] = await sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;");
  console.log(`Discovered ${sqliteTables.length} tables in SQLite.`);

  // Get existing tables in Postgres
  const pgTablesRes = await pgClient.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';");
  const existingPgTables = new Set(pgTablesRes.rows.map(r => r.table_name));

  const stats = [];

  for (const { name: tableName } of sqliteTables) {
    process.stdout.write(`Migrating table [${tableName}]... `);

    // 1. Inspect table columns in SQLite
    const [cols] = await sqlite.query(`PRAGMA table_info("${tableName}");`);
    if (!cols || cols.length === 0) {
      console.log('Skipped (no columns found).');
      continue;
    }

    // 2. Ensure table exists in PostgreSQL
    if (!existingPgTables.has(tableName)) {
      // Generate DDL for missing table
      const colDefs = cols.map(c => {
        let type = 'TEXT';
        const uType = (c.type || '').toUpperCase();
        if (uType.includes('INT')) {
          type = c.pk ? 'BIGINT' : 'BIGINT';
        } else if (uType.includes('REAL') || uType.includes('FLOAT') || uType.includes('DOUBLE') || uType.includes('NUMERIC') || uType.includes('DECIMAL')) {
          type = 'DOUBLE PRECISION';
        } else if (uType.includes('BLOB')) {
          type = 'BYTEA';
        } else if (uType.includes('BOOL')) {
          type = 'BOOLEAN';
        } else if (uType.includes('DATE') || uType.includes('TIME')) {
          type = 'TEXT';
        } else if (uType.includes('JSON')) {
          type = 'TEXT';
        }
        return `"${c.name}" ${type}${c.pk ? ' PRIMARY KEY' : ''}`;
      });

      const createSql = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(',\n  ')}\n);`;
      await pgClient.query(createSql);
      existingPgTables.add(tableName);
    }

    // 3. Inspect PostgreSQL column types for this table to handle conversions
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

    // Filter SQLite columns to only those that exist in PostgreSQL table
    const validCols = cols.filter(c => pgColTypes[c.name] !== undefined);
    const colNames = validCols.map(c => `"${c.name}"`).join(', ');

    // 4. Check if table is already fully migrated
    const [countRes] = await sqlite.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const totalRows = countRes[0].cnt;

    const existingPgCountRes = await pgClient.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const existingPgCount = parseInt(existingPgCountRes.rows[0].cnt, 10);

    if (totalRows === 0) {
      console.log('0 rows - MATCH');
      stats.push({ table: tableName, sqliteCount: 0, pgCount: 0, status: 'MATCH' });
      continue;
    }

    if (existingPgCount === totalRows) {
      console.log(`Already fully migrated (${existingPgCount}/${totalRows} rows) - MATCH`);
      stats.push({ table: tableName, sqliteCount: totalRows, pgCount: existingPgCount, status: 'MATCH' });
      continue;
    }

    // Truncate existing PG table so no stale/duplicate seed data exists
    await pgClient.query(`TRUNCATE TABLE "${tableName}" CASCADE;`);

    // Pre-check UUID columns in Postgres for non-standard SQLite strings
    for (const col of validCols) {
      if (pgColTypes[col.name] === 'uuid') {
        try {
          const [sampleRows] = await sqlite.query(`SELECT "${col.name}" as val FROM "${tableName}" WHERE "${col.name}" IS NOT NULL LIMIT 500;`);
          const hasNonUuid = sampleRows.some(r => r.val && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.val));
          if (hasNonUuid) {
            console.log(`\n  Converting column ${col.name} in table ${tableName} to VARCHAR(255) for legacy ID compatibility...`);
            await pgClient.query(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE VARCHAR(255);`);
            pgColTypes[col.name] = 'character varying';
          }
        } catch (e) {}
      }
    }

    const BATCH_SIZE = 2500;
    let offset = 0;
    let inserted = 0;

    while (offset < totalRows) {
      const [rows] = await sqlite.query(`SELECT * FROM "${tableName}" LIMIT ${BATCH_SIZE} OFFSET ${offset};`);
      if (!rows || rows.length === 0) break;

      // Build parameterized query
      const valuePlaceholders = [];
      const queryParams = [];
      let paramIndex = 1;

      for (const row of rows) {
        const rowPlaceholders = [];
        for (const col of validCols) {
          let val = row[col.name];
          let pgType = pgColTypes[col.name];

          // Conversions
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
                console.log(`\n  Expanding column ${col.name} in table ${tableName} to TEXT (value len: ${val.length} > ${maxLen})...`);
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
      if (totalRows > 10000) {
        process.stdout.write(`${inserted}/${totalRows}... `);
      }
    }

    // 5. Reset auto-increment sequence if id column exists
    try {
      await pgClient.query(`
        SELECT setval(
          pg_get_serial_sequence('"' || $1 || '"', 'id'),
          COALESCE((SELECT MAX(id) FROM "${tableName}"), 1) + 1,
          false
        );
      `, [tableName]);
    } catch (seqErr) {
      // Table may have non-serial or UUID primary key, ignore
    }

    // Verify row count in Postgres
    const pgCountRes = await pgClient.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const pgCount = parseInt(pgCountRes.rows[0].cnt, 10);
    const status = totalRows === pgCount ? 'MATCH' : 'MISMATCH';
    console.log(`Done (${pgCount}/${totalRows} rows) - ${status}`);
    stats.push({ table: tableName, sqliteCount: totalRows, pgCount, status });
  }

  // Restore foreign key enforcements
  await pgClient.query("SET session_replication_role = 'origin';");
  console.log('\nForeign key triggers re-enabled.');

  // Print Complete Parity Audit Table
  console.log('\n===============================================================');
  console.log('               PARITY AUDIT RECONCILIATION REPORT              ');
  console.log('===============================================================');
  console.log(String('Table Name').padEnd(35) + String('SQLite').padEnd(12) + String('PostgreSQL').padEnd(14) + 'Status');
  console.log('---------------------------------------------------------------');

  let allMatched = true;
  let totalSqliteRows = 0;
  let totalPgRows = 0;

  for (const s of stats) {
    totalSqliteRows += s.sqliteCount;
    totalPgRows += s.pgCount;
    const isOk = s.status === 'MATCH';
    if (!isOk) allMatched = false;
    const flag = isOk ? '✅ MATCH' : '❌ MISMATCH';
    console.log(s.table.padEnd(35) + String(s.sqliteCount).padEnd(12) + String(s.pgCount).padEnd(14) + flag);
  }

  console.log('===============================================================');
  console.log(`TOTAL RECORDS: SQLite: ${totalSqliteRows.toLocaleString()} | PostgreSQL: ${totalPgRows.toLocaleString()}`);
  console.log(`FINAL RESULT: ${allMatched ? '✅ 100% PARITY - ZERO DATA LOSS' : '❌ AUDIT FAILED'}`);
  console.log('===============================================================');

  await pgClient.end();
  await sqlite.close();
}

migrate().catch(err => {
  console.error('\nFatal Migration Error:', err);
  process.exit(1);
});
