const runMigrations = async (sequelize) => {
  const isPostgres = sequelize.options.dialect === 'postgres';

  // --- HEARTBEAT MONITORING RECOVERY SYSTEM MIGRATIONS ---

  // 1. Employees Table: fcm_token (fcmToken)
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(255);');
    } else {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN fcm_token VARCHAR(255);');
    }
    console.log('Migrated location_employees table: added fcm_token column.');
  } catch (migErr) {
    if (!migErr.message.includes('duplicate column') && !migErr.message.includes('already exists')) {
      console.warn('location_employees fcm_token migration warning:', migErr.message);
    }
  }

  // Migration: Employee table - primaryWorkMode and canSwitchMode
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS primary_work_mode VARCHAR(255) DEFAULT \'office\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS can_switch_mode BOOLEAN DEFAULT true;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS gender VARCHAR(50) DEFAULT \'Male\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS department VARCHAR(255) DEFAULT \'Engineering\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS avatar TEXT;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;');
    } else {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN primary_work_mode VARCHAR(255) DEFAULT \'office\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN can_switch_mode BOOLEAN DEFAULT 1;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN gender VARCHAR(50) DEFAULT \'Male\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN department VARCHAR(255) DEFAULT \'Engineering\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN avatar TEXT;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN is_online BOOLEAN DEFAULT 0;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN last_seen DATETIME DEFAULT CURRENT_TIMESTAMP;');
    }
    console.log('Migrated location_employees: added primary_work_mode, can_switch_mode, gender, department, avatar, is_online, last_seen.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('location_employees work mode/gender migration warning:', err.message);
    }
  }

  // Migration: Attendances table - workMode and isSwitched
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE "Attendances" ADD COLUMN IF NOT EXISTS "workMode" VARCHAR(255) DEFAULT \'office\';');
      await sequelize.query('ALTER TABLE "Attendances" ADD COLUMN IF NOT EXISTS "isSwitched" BOOLEAN DEFAULT false;');
    } else {
      await sequelize.query('ALTER TABLE Attendances ADD COLUMN workMode VARCHAR(255) DEFAULT \'office\';');
      await sequelize.query('ALTER TABLE Attendances ADD COLUMN isSwitched BOOLEAN DEFAULT 0;');
    }
    console.log('Migrated Attendances: added workMode and isSwitched.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('Attendances work mode migration warning:', err.message);
    }
  }

  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS clock_in_bypass_approved BOOLEAN DEFAULT false;');
    } else {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN clock_in_bypass_approved BOOLEAN DEFAULT 0;');
    }
    console.log('Migrated location_employees: added clock_in_bypass_approved.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('location_employees bypass migration warning:', err.message);
    }
  }

  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN IF NOT EXISTS el_days INTEGER DEFAULT 0;');
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN IF NOT EXISTS lop_days INTEGER DEFAULT 0;');
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN IF NOT EXISTS total_days INTEGER DEFAULT 0;');
    } else {
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN el_days INTEGER DEFAULT 0;');
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN lop_days INTEGER DEFAULT 0;');
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN total_days INTEGER DEFAULT 0;');
    }
    console.log('Migrated location_leaves: added el_days, lop_days, total_days.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('location_leaves fields migration warning:', err.message);
    }
  }

  // 2. Attendances Table: Session tracking details
  const attendanceCols = [
    { name: 'lastHeartbeat', type: 'BIGINT' },
    { name: 'heartbeatCount', type: 'INTEGER DEFAULT 0' },
    { name: 'missedHeartbeatCount', type: 'INTEGER DEFAULT 0' },
    { name: 'trackingStatus', type: 'VARCHAR(255) DEFAULT \'ACTIVE\'' },
    { name: 'deviceManufacturer', type: 'VARCHAR(255)' },
    { name: 'deviceModel', type: 'VARCHAR(255)' },
    { name: 'androidVersion', type: 'VARCHAR(255)' },
    { name: 'batteryLevel', type: 'FLOAT' },
    { name: 'networkType', type: 'VARCHAR(255)' },
    { name: 'gpsEnabled', type: 'BOOLEAN DEFAULT true' },
    { name: 'trackingReliabilityScore', type: 'FLOAT' },
    { name: 'notificationCount', type: 'INTEGER DEFAULT 0' },
    { name: 'lastNotificationTime', type: 'BIGINT' },
    { name: 'recoveryTime', type: 'BIGINT' },
    { name: 'trackingInterruptedDuration', type: 'INTEGER DEFAULT 0' },
    { name: 'overtimeStatus', type: "VARCHAR(50) DEFAULT 'NONE'" },
    { name: 'overtimeMinutes', type: 'INTEGER DEFAULT 0' },
    { name: 'overtimeHours', type: 'VARCHAR(50)' },
    { name: 'overtimeApprovedBy', type: 'VARCHAR(255)' },
    { name: 'overtimeApprovedAt', type: 'TIMESTAMP WITH TIME ZONE' },
    { name: 'overtimeDecisionNote', type: 'TEXT' }
  ];

  for (const col of attendanceCols) {
    try {
      if (isPostgres) {
        await sequelize.query(`ALTER TABLE "Attendances" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type};`);
      } else {
        await sequelize.query(`ALTER TABLE Attendances ADD COLUMN ${col.name} ${col.type};`);
      }
      console.log(`Migrated Attendances: added ${col.name} column.`);
    } catch (migErr) {
      if (!migErr.message.includes('duplicate column') && !migErr.message.includes('already exists')) {
        console.warn(`Attendances table ${col.name} migration warning:`, migErr.message);
      }
    }
  }

  // Data migration: Enforce Overtime Rejection Rule in Attendances table:
  // When overtime is REJECTED by admin, workingHours MUST be '08:00:00' (extra overtime decreased from total working time).
  try {
    if (isPostgres) {
      await sequelize.query(`
        UPDATE "Attendances"
        SET "workingHours" = '08:00:00'
        WHERE "overtimeStatus" = 'REJECTED';
      `);
    } else {
      await sequelize.query(`
        UPDATE Attendances
        SET workingHours = '08:00:00'
        WHERE overtimeStatus = 'REJECTED';
      `);
    }
    console.log('Migrated Attendances: enforced 08:00:00 cap on rejected overtime records.');
  } catch (syncErr) {
    console.warn('Overtime workingHours sync warning:', syncErr.message);
  }

  // --- MERGED MIGRATIONS ENGINE (POSTGRES + SQLITE) ---

  // Migration for Expenses table (add billNo column)
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE "Expenses" ADD COLUMN IF NOT EXISTS "billNo" VARCHAR(255);');
    } else {
      await sequelize.query('ALTER TABLE Expenses ADD COLUMN billNo VARCHAR(255);');
    }
    console.log('Migrated Expenses table schema: added billNo column.');
  } catch (migErr) {
    if (!migErr.message.includes('duplicate column') && !migErr.message.includes('already exists')) {
      console.warn('Expenses table billNo migration warning:', migErr.message);
    }
  }

  // 1. Employees Table Dynamic Status & Exit Columns (V2)
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS status VARCHAR(255) DEFAULT \'ACTIVE\';');
    } else {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN status VARCHAR(255) DEFAULT \'ACTIVE\';');
    }
    console.log('Migrated location_employees table schema: added status column.');
  } catch (migErr) {
    if (!migErr.message.includes('duplicate column') && !migErr.message.includes('already exists')) {
      console.warn('Employees table status migration warning:', migErr.message);
    }
  }

  const additionalCols = [
    { name: 'bank_name', type: 'VARCHAR(255)' },
    { name: 'account_number', type: 'VARCHAR(255)' },
    { name: 'bank_account_no', type: 'VARCHAR(255)' },
    { name: 'ifsc_code', type: 'VARCHAR(255)' },
    { name: 'bank_ifsc_code', type: 'VARCHAR(255)' },
    { name: 'bank_branch_name', type: 'VARCHAR(255)' },
    { name: 'exit_reason', type: 'VARCHAR(255)' },
    { name: 'exit_discussed', type: 'BOOLEAN' },
    { name: 'exit_discussion_summary', type: 'TEXT' },
    { name: 'exit_termination_reason', type: 'VARCHAR(255)' },
    { name: 'exit_notice_date', type: 'VARCHAR(255)' },
    { name: 'exit_comments', type: 'TEXT' },
    { name: 'exit_date', type: 'VARCHAR(255)' },
    { name: 'profile_photo_url', type: 'VARCHAR(255)' },
    { name: 'current_token', type: 'TEXT' },
    { name: 'pf_eligible', type: 'BOOLEAN DEFAULT 1' },
    { name: 'pf_amount', type: 'DOUBLE' },
    { name: 'pfAmount', type: 'DOUBLE' },
    { name: 'pf_number', type: 'VARCHAR(255)' },
    { name: 'esi_eligible', type: 'BOOLEAN DEFAULT 1' },
    { name: 'esic_number', type: 'VARCHAR(255)' },
    { name: 'lwf_eligible', type: 'BOOLEAN DEFAULT 1' },
    { name: 'tax_regime', type: 'VARCHAR(255) DEFAULT \'New Regime (Section 115BAC)\'' },
    { name: 'custom_fields', type: 'TEXT' },
    { name: 'pt_eligible', type: 'BOOLEAN DEFAULT 1' },
    { name: 'pt_amount', type: 'DOUBLE' },
    { name: 'pt_state_id', type: 'VARCHAR(255)' },
    { name: 'pt_state_code', type: 'VARCHAR(255)' },
    { name: 'pt_exemption', type: 'BOOLEAN DEFAULT 0' },
    { name: 'pt_exemption_type', type: 'VARCHAR(255)' },
    { name: 'pt_exemption_reason', type: 'VARCHAR(255)' },
    { name: 'pt_effective_date', type: 'VARCHAR(255)' },
    { name: 'place_of_duty', type: 'VARCHAR(255)' }
  ];
  
  for (const col of additionalCols) {
    try {
      if (isPostgres) {
        await sequelize.query(`ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
      } else {
        await sequelize.query(`ALTER TABLE location_employees ADD COLUMN ${col.name} ${col.type};`);
      }
      console.log(`Migrated location_employees: added ${col.name} column.`);
    } catch (migErr) {
      if (!migErr.message.includes('duplicate column') && !migErr.message.includes('already exists')) {
        console.warn(`Employees table ${col.name} migration warning:`, migErr.message);
      }
    }
  }

  // 2. Geotagged Media Table Dynamic Migration (V1 + V2)
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE geotagged_media ADD COLUMN IF NOT EXISTS site_id INTEGER;');
      await sequelize.query('ALTER TABLE geotagged_media ADD COLUMN IF NOT EXISTS cluster_id INTEGER;');
    } else {
      await sequelize.query('ALTER TABLE geotagged_media ADD COLUMN site_id INTEGER;');
      await sequelize.query('ALTER TABLE geotagged_media ADD COLUMN cluster_id INTEGER;');
    }
    console.log('Migrated geotagged_media table schema: added site_id and cluster_id columns.');
  } catch (migErr) {
    if (!migErr.message.includes('duplicate column') && !migErr.message.includes('already exists')) {
      console.warn('Media table structural relation column migration warning:', migErr.message);
    }
  }

  // --- PostgreSQL CRITICAL ONLY EXTENSION RUN ---
  if (isPostgres) {
    try {
      await sequelize.query('DROP TABLE IF EXISTS "Footprints";');
      console.log('Cleaned up legacy Footprints table.');
    } catch (migErr) {
      console.warn('PostgreSQL table cleanup warning:', migErr.message);
    }

    try {
      await sequelize.query('ALTER TABLE geotagged_media ADD COLUMN IF NOT EXISTS address TEXT;');
      await sequelize.query('ALTER TABLE geotagged_media ADD COLUMN IF NOT EXISTS cloudinary_url VARCHAR(255);');
      console.log('Migrated geotagged_media table schema: added address and cloudinary columns.');
    } catch (migErr) {
      console.warn('PostgreSQL table migration warning:', migErr.message);
    }

    try {
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS location_source VARCHAR(50) DEFAULT \'GPS\';');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS battery_level DOUBLE PRECISION;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS battery_temp DOUBLE PRECISION;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS address TEXT;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS speed DOUBLE PRECISION;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS heading DOUBLE PRECISION;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS altitude DOUBLE PRECISION;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS is_mock_location BOOLEAN DEFAULT false;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS fix_timestamp BIGINT;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS fix_age_ms BIGINT;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS fix_elapsed_realtime_nanos BIGINT;');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS provider VARCHAR(255);');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS capture_source VARCHAR(255);');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS validation_status VARCHAR(255);');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS network_type VARCHAR(255);');
      await sequelize.query('ALTER TABLE location_footprints ADD COLUMN IF NOT EXISTS reason VARCHAR(255);');
      console.log('Migrated location_footprints table: verified location diagnostics.');
    } catch (migErr) {
      console.warn('PostgreSQL location footprint table migration warning:', migErr.message);
    }

    // Schema Migrations for SystemSettings / settings table
    try {
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS config_version INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS location_provider VARCHAR(255) DEFAULT \'GPS Only\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS gps_ratio_count INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS cellular_ratio_count INTEGER DEFAULT 2;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS location_update_interval VARCHAR(255) DEFAULT \'30 Seconds\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_sync_interval_seconds INTEGER DEFAULT 30;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS allow_cross_day BOOLEAN DEFAULT true;');
      // Sync system_settings view
      await sequelize.query('CREATE OR REPLACE VIEW system_settings AS SELECT * FROM settings;');
      console.log('Migrated system_settings table: verified config_version, location_provider, gps_ratio_count, cellular_ratio_count, location_update_interval.');
    } catch (migErr) {
      console.warn('PostgreSQL SystemSettings migration warning:', migErr.message);
    }

    try {
      await sequelize.query('ALTER TABLE location_geofence_settings ADD COLUMN IF NOT EXISTS name VARCHAR(255) DEFAULT \'Office Geofence\';');
      console.log('Migrated location_geofence_settings table schema: added name column.');
    } catch (migErr) {
      console.warn('PostgreSQL table migration warning:', migErr.message);
    }

    try {
      await sequelize.query('ALTER TABLE "Attendances" ADD COLUMN IF NOT EXISTS address TEXT;');
      console.log('Migrated Attendances table schema: added address column.');
    } catch (migErr) {
      console.warn('PostgreSQL table migration warning:', migErr.message);
    }
  }

  // Common migrations for Aadhaar, PAN, UAN, ESI, PF fields
  for (const col of ['aadhaar_number', 'aadhaarNumber', 'aadhar_number', 'aadharNumber', 'pan_number', 'panNumber', 'uan_number', 'uanNumber', 'esi_number', 'esiNumber', 'pf_number', 'pfNumber']) {
    try {
      if (isPostgres) {
        await sequelize.query(`ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS ${col} VARCHAR(255);`);
      } else {
        await sequelize.query(`ALTER TABLE location_employees ADD COLUMN ${col} VARCHAR(255);`);
      }
    } catch (e) {
      // Ignore already exists
    }
  }

  // Migration for highest_qualification column
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS highest_qualification TEXT;');
    } else {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN highest_qualification TEXT;');
    }
    console.log('Migrated location_employees: added highest_qualification column.');
  } catch (e) {
    // Ignore if already exists
  }

  // Migration for permanent_address & emergency_contact columns
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS permanent_address TEXT;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255);');
    } else {
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN permanent_address TEXT;');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN emergency_contact VARCHAR(255);');
    }
    console.log('Migrated location_employees: added permanent_address and emergency_contact columns.');
  } catch (e) {
    // Ignore if already exists
  }


  // Migration for wizard_state on payroll_runs
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS wizard_state TEXT DEFAULT \'{}\';');
    } else {
      await sequelize.query('ALTER TABLE payroll_runs ADD COLUMN wizard_state TEXT DEFAULT \'{}\';');
    }
    console.log('Migrated payroll_runs table: added wizard_state column.');
  } catch (e) {
    // Ignore already exists
  }

  // Migration for PT tracking columns on payroll_items
  const ptPayrollCols = [
    { name: 'professional_tax_amount', type: 'DOUBLE' },
    { name: 'professional_tax_rule_id', type: 'VARCHAR(255)' },
    { name: 'professional_tax_state_id', type: 'VARCHAR(255)' },
    { name: 'professional_tax_salary_basis', type: 'VARCHAR(255)' },
    { name: 'professional_tax_calculation_date', type: 'VARCHAR(255)' }
  ];
  for (const col of ptPayrollCols) {
    try {
      if (isPostgres) {
        await sequelize.query(`ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
      } else {
        await sequelize.query(`ALTER TABLE payroll_items ADD COLUMN ${col.name} ${col.type};`);
      }
    } catch (e) {
      // Ignore already exists
    }
  }

  // Migration for opening_leave_balance and earned_leaves on location_employees
  const leaveCols = [
    { name: 'opening_leave_balance', type: 'DOUBLE DEFAULT 0' },
    { name: 'earned_leaves', type: 'DOUBLE DEFAULT 0' }
  ];
  for (const col of leaveCols) {
    try {
      if (isPostgres) {
        await sequelize.query(`ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
      } else {
        await sequelize.query(`ALTER TABLE location_employees ADD COLUMN ${col.name} ${col.type};`);
      }
    } catch (e) {
      // Ignore already exists
    }
  }

  // Migration for location_leave_adjustments table
  try {
    const LeaveAdjustment = require('../models/LeaveAdjustment');
    await LeaveAdjustment.sync();
    console.log('Ensured location_leave_adjustments table exists.');
  } catch (e) {
    console.warn('location_leave_adjustments sync warning:', e.message);
  }

  // Migration for salary revision history tracking
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS revision_reason VARCHAR(255) DEFAULT \'Salary Revision\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN IF NOT EXISTS last_revision_date VARCHAR(50);');
    } else {
      await sequelize.query('ALTER TABLE salary_structures ADD COLUMN revision_reason VARCHAR(255) DEFAULT \'Salary Revision\';');
      await sequelize.query('ALTER TABLE location_employees ADD COLUMN last_revision_date VARCHAR(50);');
    }
    console.log('Migrated salary revision history columns.');
  } catch (e) {
    // Ignore if column already exists
  }

  // Migration: High-Performance B-Tree indexes for location_leaves
  try {
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_leaves_applied_at ON location_leaves(applied_at DESC);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_leaves_user_id ON location_leaves(user_id);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_leaves_status ON location_leaves(status);');
    console.log('Ensured indexes on location_leaves (applied_at, user_id, status) exist.');
  } catch (e) {
    console.warn('location_leaves indexes warning:', e.message);
  }

  // Migration: Employee Geofence Tracking State Table (Consecutive Outside Geofence Alerts)
  try {
    const EmployeeGeofenceTrackingState = require('../models/EmployeeGeofenceTrackingState');
    await EmployeeGeofenceTrackingState.sync();
    if (isPostgres) {
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_gf_tracking_emp_id ON employee_geofence_tracking_states(employee_id);');
    }
    console.log('Ensured employee_geofence_tracking_states table and index exist.');
  } catch (e) {
    console.warn('employee_geofence_tracking_states table sync warning:', e.message);
  }

  // Migration: Leave Balances module columns on location_leave_adjustments
  const leaveAdjustmentCols = [
    { name: 'year', type: 'INTEGER' },
    { name: 'month', type: 'INTEGER' },
    { name: 'work_date', type: 'VARCHAR(20)' },
    { name: 'previous_value', type: 'DOUBLE' },
    { name: 'new_value', type: 'DOUBLE' },
    { name: 'related_adjustment_id', type: 'UUID' },
    { name: 'status', type: "VARCHAR(20) DEFAULT 'ACTIVE'" }
  ];
  for (const col of leaveAdjustmentCols) {
    try {
      if (isPostgres) {
        await sequelize.query(`ALTER TABLE location_leave_adjustments ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
      } else {
        await sequelize.query(`ALTER TABLE location_leave_adjustments ADD COLUMN ${col.name} ${col.type};`);
      }
    } catch (e) {
      // Ignore already exists
    }
  }
  try {
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_leave_adjustments_emp_year_month ON location_leave_adjustments(employee_id, year, month);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_leave_adjustments_work_date ON location_leave_adjustments(employee_id, work_date);');
    console.log('Ensured Leave Balances columns/indexes on location_leave_adjustments exist.');
  } catch (e) {
    console.warn('location_leave_adjustments Leave Balances migration warning:', e.message);
  }

  // Migration: Ensure location_geofence_settings.id has auto-increment sequence in PostgreSQL
  try {
    if (isPostgres) {
      await sequelize.query(`
        CREATE SEQUENCE IF NOT EXISTS location_geofence_settings_id_seq;
        SELECT setval('location_geofence_settings_id_seq', COALESCE((SELECT MAX(id) FROM location_geofence_settings), 0) + 1, false);
        ALTER TABLE location_geofence_settings ALTER COLUMN id SET DEFAULT nextval('location_geofence_settings_id_seq');
        ALTER SEQUENCE location_geofence_settings_id_seq OWNED BY location_geofence_settings.id;
      `);
      console.log('Ensured location_geofence_settings_id_seq auto-increment sequence exists.');
    }
  } catch (e) {
    console.warn('location_geofence_settings sequence migration warning:', e.message);
  }

  // Migration: Ensure clusters.id has an auto-increment default in PostgreSQL. Without it, a photo taken at a
  // new place failed with: null value in column "id" of relation "clusters" violates not-null constraint
  try {
    if (isPostgres) {
      await sequelize.query(`
        CREATE SEQUENCE IF NOT EXISTS clusters_id_seq;
        SELECT setval('clusters_id_seq', COALESCE((SELECT MAX(id) FROM clusters), 0) + 1, false);
        ALTER TABLE clusters ALTER COLUMN id SET DEFAULT nextval('clusters_id_seq');
        ALTER SEQUENCE clusters_id_seq OWNED BY clusters.id;
      `);
      console.log('Ensured clusters_id_seq auto-increment sequence exists.');
    }
  } catch (e) {
    console.warn('clusters sequence migration warning:', e.message);
  }

  // Migration: special leave (Marriage / Paternity / Maternity). The location_leave_categories table is
  // created by sequelize.sync() from shared/models/LeaveCategory.js; this adds the request column and seeds it.
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN IF NOT EXISTS leave_category VARCHAR(255);');
    } else {
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN leave_category VARCHAR(255);');
    }
    console.log('Migrated location_leaves: added leave_category.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('location_leaves leave_category migration warning:', err.message);
    }
  }
  try {
    await sequelize.query(`
      INSERT INTO location_leave_categories (id, code, name, duration_value, duration_unit, is_active, sort_order, created_at, updated_at) VALUES
        ('6dd1a3a4-6158-4405-90b4-1dfccfde3529', 'marriage',  'Marriage Leave',  7, 'days',   true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('6b1abe7b-e89d-4aca-a1a7-8bece1b9abd1', 'paternity', 'Paternity Leave', 7, 'days',   true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('1a67affc-a9a1-4cc0-87b8-a66f7aab33d4', 'maternity', 'Maternity Leave', 6, 'months', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (code) DO NOTHING;
    `);
    console.log('Ensured default special leave categories exist.');
  } catch (err) {
    console.warn('location_leave_categories seed warning:', err.message);
  }

  // Migration: leave counts working days only; each new request stores its working dates (JSON array).
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN IF NOT EXISTS working_dates TEXT;');
    } else {
      await sequelize.query('ALTER TABLE location_leaves ADD COLUMN working_dates TEXT;');
    }
    console.log('Migrated location_leaves: added working_dates.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('location_leaves working_dates migration warning:', err.message);
    }
  }

  // Migration: a pay run records where its automatic LOP comes from. Existing runs stay NULL (leave LOP, unchanged).
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS lop_source VARCHAR(20);');
    } else {
      await sequelize.query('ALTER TABLE payroll_runs ADD COLUMN lop_source VARCHAR(20);');
    }
    console.log('Migrated payroll_runs: added lop_source.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('payroll_runs lop_source migration warning:', err.message);
    }
  }

  // Migration: Settings table SMTP configuration columns
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255) DEFAULT \'smtp.gmail.com\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 465;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_user VARCHAR(255);');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_pass VARCHAR(255);');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_from_name VARCHAR(255) DEFAULT \'Hydro HRMS\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT true;');
    } else {
      await sequelize.query('ALTER TABLE settings ADD COLUMN smtp_host VARCHAR(255) DEFAULT \'smtp.gmail.com\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN smtp_port INTEGER DEFAULT 465;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN smtp_user VARCHAR(255);');
      await sequelize.query('ALTER TABLE settings ADD COLUMN smtp_pass VARCHAR(255);');
      await sequelize.query('ALTER TABLE settings ADD COLUMN smtp_from_name VARCHAR(255) DEFAULT \'Hydro HRMS\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN smtp_secure BOOLEAN DEFAULT 1;');
    }
    console.log('Migrated settings: added smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, smtp_secure.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('settings SMTP migration warning:', err.message);
    }
  }

  // Migration: OtpVerification table
  try {
    const OtpVerification = require('../models/OtpVerification');
    await OtpVerification.sync();
    console.log('Synchronized OtpVerification table.');
  } catch (err) {
    console.warn('OtpVerification table sync warning:', err.message);
  }

  // Migration: location_geofence_settings category & employee_id
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE location_geofence_settings ADD COLUMN IF NOT EXISTS category VARCHAR(32) DEFAULT \'SITE\';');
      await sequelize.query('ALTER TABLE location_geofence_settings ADD COLUMN IF NOT EXISTS employee_id VARCHAR(64) DEFAULT NULL;');
    } else {
      await sequelize.query('ALTER TABLE location_geofence_settings ADD COLUMN category VARCHAR(32) DEFAULT \'SITE\';');
      await sequelize.query('ALTER TABLE location_geofence_settings ADD COLUMN employee_id VARCHAR(64) DEFAULT NULL;');
    }
    console.log('Migrated location_geofence_settings: added category and employee_id.');
  } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists')) {
      console.warn('location_geofence_settings category migration warning:', err.message);
    }
  }

  // Migration: System Settings table & view for dynamic phone tracking sync
  try {
    if (isPostgres) {
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS config_version INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS location_provider VARCHAR(255) DEFAULT \'GPS Only\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS gps_ratio_count INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS cellular_ratio_count INTEGER DEFAULT 2;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS location_update_interval VARCHAR(255) DEFAULT \'30 Seconds\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_sync_interval_seconds INTEGER DEFAULT 30;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS allow_cross_day BOOLEAN DEFAULT true;');
      await sequelize.query('CREATE OR REPLACE VIEW system_settings AS SELECT * FROM settings;');
    } else {
      await sequelize.query('ALTER TABLE settings ADD COLUMN config_version INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN location_provider VARCHAR(255) DEFAULT \'GPS Only\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN gps_ratio_count INTEGER DEFAULT 1;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN cellular_ratio_count INTEGER DEFAULT 2;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN location_update_interval VARCHAR(255) DEFAULT \'30 Seconds\';');
      await sequelize.query('ALTER TABLE settings ADD COLUMN auto_sync_interval_seconds INTEGER DEFAULT 30;');
      await sequelize.query('ALTER TABLE settings ADD COLUMN allow_cross_day BOOLEAN DEFAULT 1;');
    }
    console.log('Migrated settings/system_settings: verified config_version, location_provider, gps_ratio_count, cellular_ratio_count, location_update_interval.');
  } catch (migErr) {
    if (!migErr.message.includes('duplicate column') && !migErr.message.includes('already exists')) {
      console.warn('settings/system_settings migration warning:', migErr.message);
    }
  }
};

module.exports = { runMigrations };
