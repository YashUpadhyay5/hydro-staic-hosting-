const runSeeders = async (sequelize) => {
  // Seed initial employees
  try {
    const Employee = require('../models/Employee');
    const empCount = await Employee.count();
    if (empCount === 0) {
      await Employee.bulkCreate([
        {
          id: 'HMPL01',
          empCode: 'HMPL01',
          name: 'System Admin',
          email: 'admin@hydromaterial.com',
          password: 'password123',
          role: 'ADMIN',
          designation: 'OFFICE',
          gender: 'Male',
          department: 'Management',
          jobTitle: 'Director',
          joiningDate: '2022-01-01',
          status: 'ACTIVE'
        },
        {
          id: 'HMPL02',
          empCode: 'HMPL02',
          name: 'Yash Material',
          email: 'yashhydromaterial@gmail.com',
          password: 'password123',
          role: 'EMPLOYEE',
          designation: 'FIELD',
          gender: 'Female',
          department: 'Engineering',
          jobTitle: 'Engineer IT',
          joiningDate: '2026-07-07',
          status: 'ACTIVE'
        }
      ]);
      console.log('Seeded initial default employees successfully.');
    }
  } catch (seedErr) {
    console.error('Failed to seed initial employees:', seedErr);
  }

  // Seed initial geofence settings
  try {
    const Geofence = require('../models/Geofence');
    const geoCount = await Geofence.count();
    if (geoCount === 0) {
      await Geofence.create({
        latitude: 28.6692,
        longitude: 77.4538,
        radius: 100.0
      });
      console.log('Seeded default geofence settings successfully.');
    }
  } catch (seedErr) {
    console.error('Failed to seed geofence settings:', seedErr);
  }

  // Seed default cluster settings (V2 feature integration)
  try {
    const ClusterSetting = require('../models/ClusterSetting');
    const setSetting = await ClusterSetting.findByPk(1);
    if (!setSetting) {
      await ClusterSetting.create({ id: 1, clusterRadius: 500 });
      console.log('Seeded default cluster settings successfully.');
    }
  } catch (seedErr) {
    console.error('Failed to seed default cluster settings:', seedErr.message);
  }

  // Seed initial rules
  try {
    const Rule = require('../models/Rule');
    const ruleCount = await Rule.count();
    if (ruleCount === 0) {
      await Rule.bulkCreate([
        { key: 'autoClockOutTime', value: '17:30', label: 'Auto Clock-out Time', description: 'Automatic shift clock-out time for Field Staff.', category: 'tracking' },
        { key: 'gpsPingInterval', value: '10', label: 'GPS Ping Interval (seconds)', description: 'Frequency of high-accuracy GPS location updates.', category: 'tracking' },
        { key: 'cellularPingInterval', value: '30', label: 'Cellular Ping Interval (seconds)', description: 'Frequency of cellular/tower location updates.', category: 'tracking' },
        { key: 'mockLocationBlocker', value: 'true', label: 'Block Mock Location', description: 'Prevent check-in if mock location is active on the mobile device.', category: 'tracking' },
        { key: 'geofenceRadius', value: '100', label: 'Geofence Radius (meters)', description: 'Office geofence boundary radius for validating attendance check-ins.', category: 'tracking' },
        { key: 'distanceCalculationFilter', value: 'GPS-Only', label: 'Distance Calculation Filter', description: 'Filter coordinates to GPS-Only tracking points for travel calculations.', category: 'tracking' },
        
        { key: 'offlineCacheStorage', value: 'true', label: 'Enable Offline Storage', description: 'Store coordinates locally on the device when mobile internet/network is off.', category: 'offline' },
        { key: 'offlineCacheLimit', value: '1000', label: 'Offline Log Limit', description: 'Maximum local footprint records to cache on device before overwriting oldest.', category: 'offline' },
        { key: 'autoSyncInterval', value: 'Immediate', label: 'Sync Interval', description: 'Frequency of pushing local cache logs to server after internet is restored.', category: 'offline' },
        
        { key: 'autoLogoutHours', value: '8', label: 'Auto Session Timeout (Hours)', description: 'Hours of inactivity after which non-admin employees are automatically logged out.', category: 'session' },
        { key: 'defaultAllowedLeaves', value: '15', label: 'Default Allowed Leaves', description: 'Default annual leaves allocated on profile registration.', category: 'general' },
        { key: 'defaultProbationDays', value: '30', label: 'Default Probation Period (Days)', description: 'Default probation duration for new hires.', category: 'general' },
        
        { key: 'heartbeatInterval', value: '30', label: 'Heartbeat Interval (seconds)', description: 'Frequency of location heartbeats expected from devices.', category: 'tracking' },
        { key: 'missedHeartbeatThreshold', value: '3', label: 'Missed Heartbeat Threshold', description: 'Number of consecutive missed heartbeats before marking tracking as interrupted.', category: 'tracking' },
        { key: 'notificationDelay', value: '90', label: 'Notification Delay (seconds)', description: 'Seconds to wait before sending recovery notification warnings.', category: 'tracking' },
        { key: 'retryDelay', value: '120', label: 'Notification Retry Delay (seconds)', description: 'Seconds to wait before resending recovery push alerts.', category: 'tracking' },
        { key: 'maximumNotifications', value: '3', label: 'Maximum Notification Retries', description: 'Maximum recovery attempts before escalating session to administrator.', category: 'tracking' },
        { key: 'enableAdminAlert', value: 'true', label: 'Enable Administrator Notifications', description: 'Enable email/dashboard alerts for admins when recovery attempts fail.', category: 'tracking' }
      ]);
      console.log('Seeded initial system rules successfully.');
    }
  } catch (seedErr) {
    console.error('Failed to seed rules settings:', seedErr.message);
  }

  // Seed default salary components
  try {
    const SalaryComponent = require('../models/SalaryComponent');
    const compCount = await SalaryComponent.count();
    if (compCount === 0) {
      await SalaryComponent.bulkCreate([
        { id: 'BASIC', name: 'Basic Salary', type: 'EARNING', calculationType: 'FORMULA', formula: 'GROSS * 0.50', isStatutory: false, isTaxable: true, status: 'ACTIVE' },
        { id: 'HRA', name: 'House Rent Allowance', type: 'EARNING', calculationType: 'FORMULA', formula: 'BASIC * 0.40', isStatutory: false, isTaxable: true, status: 'ACTIVE' },
        { id: 'SPECIAL_ALLOWANCE', name: 'Special Allowance', type: 'EARNING', calculationType: 'FORMULA', formula: 'GROSS - BASIC - HRA', isStatutory: false, isTaxable: true, status: 'ACTIVE' },
        { id: 'OVERTIME', name: 'Overtime Pay', type: 'EARNING', calculationType: 'FLAT', formula: '', isStatutory: false, isTaxable: true, status: 'ACTIVE' },
        { id: 'EPF_EE', name: 'Employee Provident Fund', type: 'DEDUCTION', calculationType: 'FORMULA', formula: 'BASIC * 0.12', isStatutory: true, isTaxable: false, status: 'ACTIVE' },
        { id: 'ESI_EE', name: 'Employee State Insurance', type: 'DEDUCTION', calculationType: 'FORMULA', formula: 'GROSS * 0.0075', isStatutory: true, isTaxable: false, status: 'ACTIVE' },
        { id: 'PT', name: 'Professional Tax', type: 'DEDUCTION', calculationType: 'FLAT', formula: '', isStatutory: true, isTaxable: false, status: 'ACTIVE' },
        { id: 'LWF', name: 'Labour Welfare Fund', type: 'DEDUCTION', calculationType: 'FLAT', formula: '', isStatutory: true, isTaxable: false, status: 'ACTIVE' },
        { id: 'TDS', name: 'Income Tax (TDS)', type: 'DEDUCTION', calculationType: 'FLAT', formula: '', isStatutory: true, isTaxable: false, status: 'ACTIVE' }
      ]);
      console.log('Seeded default salary components successfully.');
    }
  } catch (seedErr) {
    console.error('Failed to seed salary components:', seedErr.message);
  }

  // Seed default salary structures for existing employees
  try {
    const Employee = require('../models/Employee');
    const SalaryStructure = require('../models/SalaryStructure');
    const employees = await Employee.findAll();
    for (const emp of employees) {
      const existing = await SalaryStructure.findOne({ where: { employeeId: emp.id } });
      if (!existing) {
        const annualComp = Number(emp.compensationGross || 0);
        const monthlyGross = annualComp > 0 ? Math.round(annualComp / 12) : 25000;
        await SalaryStructure.create({
          employeeId: emp.id,
          ctc: annualComp > 0 ? annualComp : monthlyGross * 12,
          grossSalary: monthlyGross,
          effectiveFrom: '2026-04-01',
          version: 1,
          status: 'ACTIVE'
        });
        console.log(`Seeded default salary structure for employee: ${emp.name} (Monthly Gross: ₹${monthlyGross})`);
      }
    }
  } catch (seedErr) {
    console.error('Failed to seed default salary structures:', seedErr.message);
  }

  // Seed default system settings
  try {
    const Setting = require('../models/Setting');
    await Setting.findOrCreate({
      where: { id: 1 },
      defaults: {
        punch_in_start: '08:30',
        punch_in_end: '10:00',
        punch_out_time: '18:00',
        location_provider: 'GPS Preferred',
        location_update_interval: '60 Seconds'
      }
    });
    console.log('Seeded default system settings successfully.');
  } catch (seedErr) {
    console.error('Failed to seed default system settings:', seedErr.message);
  }

  // Seed baseline Professional Tax configurations
  try {
    const ProfessionalTaxService = require('../../core/utils/ProfessionalTaxService');
    await ProfessionalTaxService.seedBaselineStates();
  } catch (seedErr) {
    console.error('Failed to seed baseline Professional Tax configurations:', seedErr.message);
  }
};

module.exports = { runSeeders };
