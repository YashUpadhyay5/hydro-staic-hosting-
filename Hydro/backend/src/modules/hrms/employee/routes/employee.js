const express = require('express');
const router = express.Router();
const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const HolidayCalendar = require('../../../../shared/models/HolidayCalendar');
const SalaryStructure = require('../../../../shared/models/SalaryStructure');
const PayrollRun = require('../../../../shared/models/PayrollRun');
const PayrollItem = require('../../../../shared/models/PayrollItem');
const { calculateEarnedLeaves } = require('../../../../core/utils/leaveCalculator');
const { validatePasswordStrength } = require('../../../auth/services/authService');
const fs = require('fs');
const path = require('path');
const { profileUpload } = require('../../../../core/middleware/upload');
const requireRole = require('../../../../core/middleware/requireRole');
const verifyToken = require('../../../../core/middleware/verifyToken');
const { Op } = require('sequelize');
const { invalidateEmployeeCache } = require('../../../../core/utils/employeeCache');
const LeaveBalanceService = require('../../leave/services/LeaveBalanceService');

// Replaces the computed leave figures with the Leave Balances ledger so the employee profile, the mobile
// app and the Leave Balances pages agree. Form fields (allowedLeaves, openingLeaveBalance) are left untouched.
async function applyLedgerBalances(empObjs) {
  try {
    const snapshots = await LeaveBalanceService.getBalanceSnapshots(empObjs);
    for (const e of empObjs) {
      const s = snapshots.get(e.id);
      if (!s) continue;
      e.availableLeaves = s.available;
      e.totalEarnedLeaves = s.credited;
      e.leaveBalance = s;
    }
  } catch (err) {
    console.warn('Leave ledger balances unavailable, using legacy figures:', err.message);
  }
  return empObjs;
}

const SYSTEM_CUSTOM_FIELD_KEYS = new Set([
  'panNumber', 'pan', 'uanNumber', 'pfUan', 'pfNumber', 'pf_number',
  'esiNumber', 'esicNumber', 'esiNo', 'bankAccountNo',
  'accountNumber', 'bankIfscCode', 'ifscCode', 'aadhaarNumber',
  'aadharNumber', 'aadhaar', 'aadhar', 'highestQualification',
  'openingLeaveBalance', 'earnedLeaves',
  'fatherName', 'father_name', 'spouseName', 'spouse_name',
  'presentAddress', 'present_address', 'permanentAddress', 'permanent_address',
  'emergencyContact', 'emergency_contact'
]);

// Helper to format holiday countdowns
const formatHolidayList = (rawHolidays = []) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();

  return (rawHolidays || []).map((item, idx) => {
    let hDate = item.date ? new Date(item.date) : new Date(currentYear, item.month || 0, item.day || 1);
    if (isNaN(hDate.getTime())) {
      hDate = new Date(currentYear, 0, 1);
    }
    hDate.setHours(0, 0, 0, 0);

    // Roll over to next year if already passed in current year
    if (hDate.getTime() < today.getTime()) {
      if (item.date && String(item.date).includes('-')) {
        const parts = item.date.split('-');
        if (parts.length >= 3) {
          hDate = new Date(currentYear + 1, parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          hDate.setHours(0, 0, 0, 0);
        }
      }
    }

    const diffTime = hDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let countdown = 'Upcoming';
    if (diffDays === 0) countdown = 'Today 🎉';
    else if (diffDays === 1) countdown = 'Tomorrow 🎈';
    else if (diffDays > 1) countdown = `In ${diffDays} days`;

    const dayName = !isNaN(hDate.getTime()) ? hDate.toLocaleDateString('en-US', { weekday: 'long' }) : (item.day || '');
    const dateStr = !isNaN(hDate.getTime()) ? hDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : (item.date || '');

    return {
      id: item.id || `h-${idx + 1}`,
      title: item.title || item.name || 'Holiday',
      date: item.date || hDate.toISOString().split('T')[0],
      dateFormatted: dateStr,
      day: dayName,
      type: item.type || 'Gazetted Holiday',
      description: item.description || '',
      diffDays,
      countdown
    };
  }).sort((a, b) => a.diffDays - b.diffDays);
};

// GET logged-in employee's personal location holiday calendar
router.get('/my-holidays', verifyToken, async (req, res) => {
  try {
    const employeeId = req.user?.id || req.query?.employeeId;
    if (!employeeId) {
      return res.status(401).json({ error: 'Unauthorized. Employee ID not found in token.' });
    }

    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found.' });
    }

    const locationName = employee.location || employee.holidayDetails || 'Headquarters';

    // Search for location calendar in DB
    let calendar = null;
    try {
      const allCalendars = await HolidayCalendar.findAll();
      calendar = allCalendars.find(c => 
        (c.location && c.location.toLowerCase() === locationName.toLowerCase()) ||
        (c.name && c.name.toLowerCase().includes(locationName.toLowerCase()))
      );
      if (!calendar && allCalendars.length > 0) {
        calendar = allCalendars.find(c => c.isDefault) || allCalendars[0];
      }
    } catch (dbErr) {
      console.warn('HolidayCalendar table query warning:', dbErr.message);
    }

    const rawHolidays = calendar?.holidays || [];
    const formattedHolidays = formatHolidayList(rawHolidays);

    return res.status(200).json({
      success: true,
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        designation: employee.designation,
        location: locationName
      },
      calendar: {
        id: calendar?.id || null,
        name: calendar?.name || `${locationName} Calendar`,
        location: calendar?.location || locationName,
        year: calendar?.year || new Date().getFullYear(),
        totalHolidays: formattedHolidays.length
      },
      holidays: formattedHolidays
    });
  } catch (error) {
    console.error('Error fetching employee my-holidays:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET specific employee's location holiday calendar by ID
router.get('/:id/holidays', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const locationName = employee.location || employee.holidayDetails || 'Headquarters';

    let calendar = null;
    try {
      const allCalendars = await HolidayCalendar.findAll();
      calendar = allCalendars.find(c => 
        (c.location && c.location.toLowerCase() === locationName.toLowerCase()) ||
        (c.name && c.name.toLowerCase().includes(locationName.toLowerCase()))
      );
      if (!calendar && allCalendars.length > 0) {
        calendar = allCalendars.find(c => c.isDefault) || allCalendars[0];
      }
    } catch (dbErr) {
      console.warn('HolidayCalendar table query warning:', dbErr.message);
    }

    const rawHolidays = calendar?.holidays || [];
    const formattedHolidays = formatHolidayList(rawHolidays);

    return res.status(200).json({
      success: true,
      employee: {
        id: employee.id,
        name: employee.name,
        location: locationName
      },
      calendar: {
        id: calendar?.id || null,
        name: calendar?.name || `${locationName} Calendar`,
        location: calendar?.location || locationName,
        year: calendar?.year || new Date().getFullYear(),
        totalHolidays: formattedHolidays.length
      },
      holidays: formattedHolidays
    });
  } catch (error) {
    console.error('Error fetching employee holidays by ID:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET single employee profile
router.get('/', async (req, res) => {
  try {
    const { page, limit, chunked, includeSystem } = req.query;
    const whereClause = includeSystem === 'true' ? {} : { is_system_account: false };

    if (chunked === 'true' || page || limit) {
      const p = Math.max(1, parseInt(page || 1, 10));
      const l = Math.min(200, Math.max(1, parseInt(limit || 20, 10)));
      const offset = (p - 1) * l;

      const { count, rows } = await Employee.findAndCountAll({
        where: whereClause,
        limit: l,
        offset,
        order: [['name', 'ASC']]
      });

      const mapped = rows.map(emp => {
        const empObj = emp.toJSON();
        const rawAllowed = emp.allowed_leaves !== undefined ? emp.allowed_leaves : emp.allowedLeaves;
        const dynamicLeaves = calculateEarnedLeaves(emp.joiningDate || emp.createdAt);
        empObj.allowedLeaves = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
          ? Number(rawAllowed)
          : dynamicLeaves;
        const cf = (typeof empObj.customFields === 'object' && empObj.customFields !== null) ? empObj.customFields : {};
        const openingBalance = Number(emp.opening_leave_balance !== undefined && emp.opening_leave_balance !== null
          ? emp.opening_leave_balance
          : (emp.openingLeaveBalance !== undefined && emp.openingLeaveBalance !== null
            ? emp.openingLeaveBalance
            : (cf.openingLeaveBalance || cf.earnedLeaves || 0)));
        empObj.openingLeaveBalance = openingBalance;
        empObj.earnedLeaves = openingBalance;
        empObj.totalEarnedLeaves = empObj.allowedLeaves + openingBalance;
        empObj.availableLeaves = Math.max(0, empObj.totalEarnedLeaves - (emp.consumedLeaves || 0));
        empObj.aadhaar = empObj.aadhaarNumber || empObj.aadharNumber || cf.aadhaarNumber || cf.aadharNumber || cf.aadhaar || cf.aadhar || empObj.aadhaar || null;
        empObj.aadhaarNumber = empObj.aadhaar;
        empObj.aadharNumber = empObj.aadhaar;
        empObj.pan = empObj.panNumber || cf.panNumber || cf.pan || empObj.pan || null;
        empObj.panNumber = empObj.pan;
        empObj.pfUan = empObj.uanNumber || cf.uanNumber || cf.pfUan || empObj.pfUan || null;
        empObj.uanNumber = empObj.pfUan;
        empObj.esiNo = empObj.esiNumber || cf.esiNumber || cf.esiNo || empObj.esiNo || null;
        empObj.esiNumber = empObj.esiNo;
        empObj.accountNumber = empObj.bankAccountNo || cf.bankAccountNo || cf.accountNumber || empObj.accountNumber || null;
        empObj.bankAccountNo = empObj.accountNumber;
        empObj.ifscCode = empObj.bankIfscCode || cf.bankIfscCode || cf.ifscCode || empObj.ifscCode || null;
        empObj.fatherName = empObj.fatherName || empObj.father_name || cf.fatherName || cf.father_name || null;
        empObj.father_name = empObj.fatherName;
        empObj.spouseName = empObj.spouseName || empObj.spouse_name || cf.spouseName || cf.spouse_name || null;
        empObj.spouse_name = empObj.spouseName;
        empObj.presentAddress = empObj.presentAddress || empObj.present_address || cf.presentAddress || cf.present_address || null;
        empObj.present_address = empObj.presentAddress;
        empObj.permanentAddress = empObj.permanentAddress || empObj.permanent_address || cf.permanentAddress || cf.permanent_address || empObj.presentAddress || null;
        empObj.permanent_address = empObj.permanentAddress;
        empObj.emergencyContact = empObj.emergencyContact || empObj.emergency_contact || cf.emergencyContact || cf.emergency_contact || null;
        empObj.placeOfDuty = emp.placeOfDuty || emp.place_of_duty || cf.placeOfDuty || null;
        empObj.place_of_duty = empObj.placeOfDuty;
        // Normalize highestQualification — stored as JSON string
        try {
          empObj.highestQualification = empObj.highestQualification
            ? (typeof empObj.highestQualification === 'string' ? JSON.parse(empObj.highestQualification) : empObj.highestQualification)
            : (cf.highestQualification || null);
        } catch (e) { empObj.highestQualification = null; }
        return empObj;

      });

      await applyLedgerBalances(mapped);
      return res.status(200).json({
        data: mapped,
        page: p,
        limit: l,
        totalRecords: count,
        totalPages: Math.ceil(count / l),
        hasMore: p * l < count
      });
    }

    const employees = await Employee.findAll({
      where: whereClause,
      order: [['name', 'ASC']]
    });
    
    const mapped = employees.map(emp => {
      const empObj = emp.toJSON();
      const rawAllowed = emp.allowed_leaves !== undefined ? emp.allowed_leaves : emp.allowedLeaves;
      const dynamicLeaves = calculateEarnedLeaves(emp.joiningDate || emp.createdAt);
      empObj.allowedLeaves = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
        ? Number(rawAllowed)
        : dynamicLeaves;
      const cf = (typeof empObj.customFields === 'object' && empObj.customFields !== null) ? empObj.customFields : {};
      const openingBalance = Number(emp.opening_leave_balance !== undefined && emp.opening_leave_balance !== null
        ? emp.opening_leave_balance
        : (emp.openingLeaveBalance !== undefined && emp.openingLeaveBalance !== null
          ? emp.openingLeaveBalance
          : (cf.openingLeaveBalance || cf.earnedLeaves || 0)));
      empObj.openingLeaveBalance = openingBalance;
      empObj.earnedLeaves = openingBalance;
      empObj.totalEarnedLeaves = empObj.allowedLeaves + openingBalance;
      empObj.availableLeaves = Math.max(0, empObj.totalEarnedLeaves - (emp.consumedLeaves || 0));
      empObj.aadhaar = empObj.aadhaarNumber || empObj.aadharNumber || cf.aadhaarNumber || cf.aadharNumber || cf.aadhaar || cf.aadhar || empObj.aadhaar || null;
      empObj.aadhaarNumber = empObj.aadhaar;
      empObj.aadharNumber = empObj.aadhaar;
      empObj.pan = empObj.panNumber || cf.panNumber || cf.pan || empObj.pan || null;
      empObj.panNumber = empObj.pan;
      empObj.pfUan = empObj.uanNumber || cf.uanNumber || cf.pfUan || empObj.pfUan || null;
      empObj.uanNumber = empObj.pfUan;
      empObj.pfNumber = empObj.pfNumber || empObj.pf_number || cf.pfNumber || cf.pf_number || null;
      empObj.pf_number = empObj.pfNumber;
      empObj.esiNo = empObj.esiNumber || cf.esiNumber || cf.esiNo || empObj.esiNo || null;
      empObj.esiNumber = empObj.esiNo;
      empObj.accountNumber = empObj.bankAccountNo || cf.bankAccountNo || cf.accountNumber || empObj.accountNumber || null;
      empObj.bankAccountNo = empObj.accountNumber;
      empObj.fatherName = empObj.fatherName || empObj.father_name || cf.fatherName || cf.father_name || null;
      empObj.father_name = empObj.fatherName;
      empObj.spouseName = empObj.spouseName || empObj.spouse_name || cf.spouseName || cf.spouse_name || null;
      empObj.spouse_name = empObj.spouseName;
      empObj.presentAddress = empObj.presentAddress || empObj.present_address || cf.presentAddress || cf.present_address || null;
      empObj.present_address = empObj.presentAddress;
      empObj.permanentAddress = empObj.permanentAddress || empObj.permanent_address || cf.permanentAddress || cf.permanent_address || empObj.presentAddress || null;
      empObj.permanent_address = empObj.permanentAddress;
      empObj.emergencyContact = empObj.emergencyContact || empObj.emergency_contact || cf.emergencyContact || cf.emergency_contact || null;
      empObj.emergency_contact = empObj.emergencyContact;
      empObj.placeOfDuty = emp.placeOfDuty || emp.place_of_duty || cf.placeOfDuty || null;
      empObj.place_of_duty = empObj.placeOfDuty;
      try {
        empObj.highestQualification = empObj.highestQualification
          ? (typeof empObj.highestQualification === 'string' ? JSON.parse(empObj.highestQualification) : empObj.highestQualification)
          : (cf.highestQualification || null);
      } catch (e) { empObj.highestQualification = null; }
      return empObj;

    });

    await applyLedgerBalances(mapped);
    return res.status(200).json(mapped);
  } catch (error) {
    console.error('Error fetching employees:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET single employee profile
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const empObj = employee.toJSON();
    const rawAllowed = employee.allowed_leaves !== undefined ? employee.allowed_leaves : employee.allowedLeaves;
    const dynamicLeaves = calculateEarnedLeaves(employee.joiningDate || employee.createdAt);
    empObj.allowedLeaves = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
      ? Number(rawAllowed)
      : dynamicLeaves;
    const cf = (typeof empObj.customFields === 'object' && empObj.customFields !== null) ? empObj.customFields : {};
    const openingBalance = Number(employee.opening_leave_balance !== undefined && employee.opening_leave_balance !== null
      ? employee.opening_leave_balance
      : (employee.openingLeaveBalance !== undefined && employee.openingLeaveBalance !== null
        ? employee.openingLeaveBalance
        : (cf.openingLeaveBalance || cf.earnedLeaves || 0)));
    empObj.openingLeaveBalance = openingBalance;
    empObj.earnedLeaves = openingBalance;
    empObj.totalEarnedLeaves = empObj.allowedLeaves + openingBalance;
    empObj.availableLeaves = Math.max(0, empObj.totalEarnedLeaves - (employee.consumedLeaves || 0));
    empObj.aadhaar = empObj.aadhaarNumber || empObj.aadharNumber || cf.aadhaarNumber || cf.aadharNumber || cf.aadhaar || cf.aadhar || empObj.aadhaar || null;
    empObj.aadhaarNumber = empObj.aadhaar;
    empObj.aadharNumber = empObj.aadhaar;
    empObj.pan = empObj.panNumber || cf.panNumber || cf.pan || empObj.pan || null;
    empObj.panNumber = empObj.pan;
    empObj.pfUan = empObj.uanNumber || cf.uanNumber || cf.pfUan || empObj.pfUan || null;
    empObj.uanNumber = empObj.pfUan;
    empObj.pfNumber = empObj.pfNumber || empObj.pf_number || cf.pfNumber || cf.pf_number || null;
    empObj.pf_number = empObj.pfNumber;
    empObj.esiNo = empObj.esiNumber || cf.esiNumber || cf.esiNo || empObj.esiNo || null;
    empObj.esiNumber = empObj.esiNo;
    empObj.accountNumber = empObj.bankAccountNo || cf.bankAccountNo || cf.accountNumber || empObj.accountNumber || null;
    empObj.bankAccountNo = empObj.accountNumber;
    empObj.ifscCode = empObj.bankIfscCode || cf.bankIfscCode || cf.ifscCode || empObj.ifscCode || null;
    empObj.bankIfscCode = empObj.ifscCode;
    empObj.fatherName = empObj.fatherName || empObj.father_name || cf.fatherName || cf.father_name || null;
    empObj.father_name = empObj.fatherName;
    empObj.spouseName = empObj.spouseName || empObj.spouse_name || cf.spouseName || cf.spouse_name || null;
    empObj.spouse_name = empObj.spouseName;
    empObj.presentAddress = empObj.presentAddress || empObj.present_address || cf.presentAddress || cf.present_address || null;
    empObj.present_address = empObj.presentAddress;
    empObj.permanentAddress = empObj.permanentAddress || empObj.permanent_address || cf.permanentAddress || cf.permanent_address || empObj.presentAddress || null;
    empObj.permanent_address = empObj.permanentAddress;
    empObj.emergencyContact = empObj.emergencyContact || empObj.emergency_contact || cf.emergencyContact || cf.emergency_contact || null;
    empObj.emergency_contact = empObj.emergencyContact;
    empObj.placeOfDuty = employee.placeOfDuty || employee.place_of_duty || cf.placeOfDuty || null;
    empObj.place_of_duty = empObj.placeOfDuty;
    try {
      empObj.highestQualification = empObj.highestQualification
        ? (typeof empObj.highestQualification === 'string' ? JSON.parse(empObj.highestQualification) : empObj.highestQualification)
        : (cf.highestQualification || null);
    } catch (e) { empObj.highestQualification = null; }
    await applyLedgerBalances([empObj]);
    return res.status(200).json(empObj);

  } catch (error) {
    console.error('Error fetching employee:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST Create new employee
router.post('/', requireRole(['ADMIN']), async (req, res) => {
  try {
    const { 
      name, email, password, designation, role, allowedLeaves, status,
      gender, dob, empCode, nationality, phoneNo, joiningDate, jobTitle,
      legalEntity, department, location, placeOfDuty, reportingManager,
      probationPolicy, noticePeriod, leaveSetting, holidayDetails,
      weeklyOffs, attendanceSetting, overtime, expensePolicies,
      compensationGross, customFields, pfEligible, pfAmount, esiEligible, lwfEligible, lwfAmount,
      vpfEligible, vpfAmount, ptEligible, ptAmount, ptStateCode, ptExemption, ptExemptionType, ptExemptionReason, taxRegime,
      bankName, bankAccountNo, bankIfscCode, bankBranchName,
      fatherName, spouseName, presentAddress, permanentAddress, emergencyContact, highestQualification,
      aadhaarNumber, aadharNumber, aadhaar, aadhar,
      panNumber, pan, uanNumber, pfUan, pfNumber, esiNumber, esicNumber, esiNo, ifscCode, accountNumber,
      exitReason, exitDiscussed, exitDiscussionSummary, exitTerminationReason, exitNoticeDate, exitComments, exitDate
    } = req.body;

    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const assignedPassword = (password && password.trim() && password !== '.') ? password : 'Employee@123';

    // Check if employee already exists
    const existing = await Employee.findOne({ where: { email: email.toLowerCase() } });
    if (existing) {
      return res.status(400).json({ error: 'An employee with this email already exists.' });
    }

    // Determine target ID
    let id = empCode;
    if (!id) {
      const employees = await Employee.findAll({ attributes: ['id'] });
      let maxNumber = 0;
      for (const emp of employees) {
        if (emp.id) {
          const match = emp.id.match(/^EMP(\d+)$/i);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) {
              maxNumber = num;
            }
          }
        }
      }
      const nextNumber = maxNumber + 1;
      id = `EMP${String(nextNumber).padStart(4, '0')}`;
    }

    const resolvedAadhaar = aadhaarNumber || aadharNumber || aadhaar || aadhar || null;
    const resolvedPan = panNumber || pan || null;
    const resolvedUan = uanNumber || pfUan || null;
    const resolvedPf = pfNumber || req.body.pf_number || null;
    const resolvedEsi = esiNumber || esicNumber || esiNo || null;
    const resolvedBankAcct = bankAccountNo || accountNumber || null;
    const resolvedIfsc = bankIfscCode || ifscCode || null;

    const cleanCustomFields = {};
    if (customFields && typeof customFields === 'object') {
      Object.entries(customFields).forEach(([k, v]) => {
        if (!SYSTEM_CUSTOM_FIELD_KEYS.has(k)) {
          cleanCustomFields[k] = v;
        }
      });
    }

    const newEmp = await Employee.create({
      id,
      name,
      email: email.toLowerCase(),
      password: assignedPassword,
      designation: designation || 'OFFICE',
      role: role || 'EMPLOYEE',
      status: status || 'ACTIVE',
      allowedLeaves: allowedLeaves !== undefined ? Number(allowedLeaves) : 0,
      consumedLeaves: 0,
      gender: gender || 'Male',
      dob,
      empCode: empCode || id,
      nationality,
      phoneNo,
      joiningDate,
      jobTitle,
      legalEntity: legalEntity || 'Hydromaterials Private Limited',
      department,
      location,
      placeOfDuty: placeOfDuty || null,
      reportingManager,
      probationPolicy,
      noticePeriod,
      leaveSetting,
      holidayDetails,
      weeklyOffs: weeklyOffs || 'Sunday',
      attendanceSetting,
      overtime,
      expensePolicies,
      compensationGross: compensationGross !== undefined ? Number(compensationGross) : null,
      pfEligible: pfEligible !== undefined ? pfEligible : true,
      pfAmount: pfAmount !== undefined && pfAmount !== null && pfAmount !== '' ? Number(pfAmount) : null,
      esiEligible: esiEligible !== undefined ? esiEligible : true,
      lwfEligible: lwfEligible !== undefined ? lwfEligible : true,
      lwfAmount: lwfAmount !== undefined ? Number(lwfAmount) : 60,
      vpfEligible: vpfEligible !== undefined ? vpfEligible : false,
      vpfAmount: vpfAmount !== undefined ? Number(vpfAmount) : 0,
      ptEligible: ptEligible !== undefined ? ptEligible : true,
      ptAmount: (ptAmount !== undefined && ptAmount !== null && ptAmount !== '' && !isNaN(Number(ptAmount))) ? Number(ptAmount) : null,
      ptStateCode: ptStateCode || 'TN',
      ptExemption: ptExemption === true,
      ptExemptionType: ptExemptionType || 'NONE',
      ptExemptionReason: ptExemptionReason || null,
      taxRegime: taxRegime || 'New Regime (Section 115BAC)',
      bankName: bankName || null,
      bankAccountNo: resolvedBankAcct,
      bankIfscCode: resolvedIfsc,
      bankBranchName: bankBranchName || null,
      fatherName: fatherName || req.body.father_name || null,
      spouseName: spouseName || req.body.spouse_name || null,
      presentAddress: presentAddress || req.body.present_address || req.body.currentAddress || req.body.address || null,
      permanentAddress: permanentAddress || req.body.permanent_address || null,
      emergencyContact: emergencyContact || req.body.emergency_contact || null,
      highestQualification: highestQualification ? (typeof highestQualification === 'string' ? highestQualification : JSON.stringify(highestQualification)) : null,
      aadhaarNumber: resolvedAadhaar,
      panNumber: resolvedPan,
      uanNumber: resolvedUan,
      pfNumber: resolvedPf,
      esiNumber: resolvedEsi,
      exitReason: exitReason || null,
      exitDiscussed: exitDiscussed !== undefined ? exitDiscussed : null,
      exitDiscussionSummary: exitDiscussionSummary || null,
      exitTerminationReason: exitTerminationReason || null,
      exitNoticeDate: exitNoticeDate || null,
      exitComments: exitComments || null,
      exitDate: exitDate || null,
      customFields: cleanCustomFields
    });

    // Auto-create active SalaryStructure for the new employee
    try {
      const annualCtc = compensationGross !== undefined && compensationGross !== null && !isNaN(Number(compensationGross))
        ? Number(compensationGross)
        : 300000;
      const monthlyGross = Math.round(annualCtc / 12);
      const effectiveDate = joiningDate || new Date().toISOString().split('T')[0];

      await SalaryStructure.create({
        employeeId: newEmp.id,
        ctc: annualCtc,
        grossSalary: monthlyGross,
        effectiveFrom: effectiveDate,
        status: 'ACTIVE',
        version: 1
      });
    } catch (ssErr) {
      console.warn('[Employee Create] SalaryStructure auto-create warning:', ssErr.message);
    }

    invalidateEmployeeCache();
    return res.status(201).json(newEmp);
  } catch (error) {
    console.error('Error creating employee:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT Edit employee details
router.put('/:id', requireRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, email, password, designation, role, allowedLeaves, consumedLeaves, openingLeaveBalance, earnedLeaves, status,
      gender, dob, empCode, nationality, phoneNo, joiningDate, jobTitle,
      legalEntity, department, location, placeOfDuty, reportingManager,
      probationPolicy, noticePeriod, leaveSetting, holidayDetails,
      weeklyOffs, attendanceSetting, overtime, expensePolicies,
      compensationGross, customFields, pfEligible, pfAmount, esiEligible, lwfEligible, lwfAmount, vpfEligible, vpfAmount, 
      ptEligible, ptAmount, ptStateCode, ptExemption, ptExemptionType, ptExemptionReason, taxRegime,
      bankName, bankAccountNo, bankIfscCode, bankBranchName, fatherName, spouseName, presentAddress, permanentAddress, emergencyContact, highestQualification,
      aadhaarNumber, aadharNumber, aadhaar, aadhar,
      panNumber, pan, uanNumber, pfUan, pfNumber, esiNumber, esicNumber, esiNo, ifscCode, accountNumber,
      exitReason, exitDiscussed, exitDiscussionSummary, exitTerminationReason, exitNoticeDate, exitComments, exitDate
    } = req.body;


    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const previousName = employee.name;
    const previousGross = employee.compensationGross;

    if (name) employee.name = name;
    if (email) employee.email = email.toLowerCase();
    if (password && password !== employee.password) employee.password = password;
    if (designation) employee.designation = designation;
    if (role) employee.role = role;
    if (status) employee.status = status;
    if (allowedLeaves !== undefined) employee.allowedLeaves = Number(allowedLeaves);
    if (consumedLeaves !== undefined) employee.consumedLeaves = Number(consumedLeaves);
    if (openingLeaveBalance !== undefined) {
      employee.openingLeaveBalance = Number(openingLeaveBalance);
      employee.earnedLeaves = Number(openingLeaveBalance);
    } else if (earnedLeaves !== undefined) {
      employee.openingLeaveBalance = Number(earnedLeaves);
      employee.earnedLeaves = Number(earnedLeaves);
    }
    if (gender !== undefined) employee.gender = gender;
    if (dob !== undefined) employee.dob = dob;
    if (empCode !== undefined) employee.empCode = empCode;
    if (nationality !== undefined) employee.nationality = nationality;
    if (phoneNo !== undefined) employee.phoneNo = phoneNo;
    if (joiningDate !== undefined) employee.joiningDate = joiningDate;
    if (jobTitle !== undefined) employee.jobTitle = jobTitle;
    if (legalEntity !== undefined) employee.legalEntity = legalEntity;
    if (department !== undefined) employee.department = department;
    if (location !== undefined) employee.location = location;
    if (placeOfDuty !== undefined) {
      employee.placeOfDuty = placeOfDuty;
      employee.setDataValue('place_of_duty', placeOfDuty);
    }
    if (reportingManager !== undefined) employee.reportingManager = reportingManager;
    if (probationPolicy !== undefined) employee.probationPolicy = probationPolicy;
    if (noticePeriod !== undefined) employee.noticePeriod = noticePeriod;
    if (leaveSetting !== undefined) employee.leaveSetting = leaveSetting;
    if (holidayDetails !== undefined) employee.holidayDetails = holidayDetails;
    if (weeklyOffs !== undefined) employee.weeklyOffs = weeklyOffs;
    if (attendanceSetting !== undefined) employee.attendanceSetting = attendanceSetting;
    if (overtime !== undefined) employee.overtime = overtime;
    if (expensePolicies !== undefined) employee.expensePolicies = expensePolicies;
    if (compensationGross !== undefined) employee.compensationGross = compensationGross !== null ? Number(compensationGross) : null;
    if (pfEligible !== undefined) employee.pfEligible = pfEligible;
    if (pfAmount !== undefined) employee.pfAmount = (pfAmount !== null && pfAmount !== '' && !isNaN(Number(pfAmount))) ? Number(pfAmount) : null;
    if (esiEligible !== undefined) employee.esiEligible = esiEligible;
    if (lwfEligible !== undefined) employee.lwfEligible = lwfEligible;
    if (lwfAmount !== undefined) employee.lwfAmount = Number(lwfAmount) || 60;
    if (vpfEligible !== undefined) employee.vpfEligible = vpfEligible;
    if (vpfAmount !== undefined) employee.vpfAmount = Number(vpfAmount) || 0;
    if (ptEligible !== undefined) employee.ptEligible = ptEligible;
    if (ptAmount !== undefined) employee.ptAmount = (ptAmount !== null && ptAmount !== '' && !isNaN(Number(ptAmount))) ? Number(ptAmount) : null;
    if (ptStateCode !== undefined) employee.ptStateCode = ptStateCode;
    if (ptExemption !== undefined) employee.ptExemption = ptExemption === true;
    if (ptExemptionType !== undefined) employee.ptExemptionType = ptExemptionType || 'NONE';
    if (ptExemptionReason !== undefined) employee.ptExemptionReason = ptExemptionReason || null;
    if (taxRegime !== undefined) employee.taxRegime = taxRegime;
    if (bankName !== undefined) employee.bankName = bankName;
    if (bankAccountNo !== undefined || accountNumber !== undefined) {
      employee.bankAccountNo = bankAccountNo || accountNumber;
      employee.setDataValue('bank_account_no', bankAccountNo || accountNumber);
      employee.setDataValue('account_number', bankAccountNo || accountNumber);
    }
    if (bankIfscCode !== undefined || ifscCode !== undefined) {
      employee.bankIfscCode = bankIfscCode || ifscCode;
      employee.setDataValue('bank_ifsc_code', bankIfscCode || ifscCode);
      employee.setDataValue('ifsc_code', bankIfscCode || ifscCode);
    }
    if (bankBranchName !== undefined) employee.bankBranchName = bankBranchName;
    if (aadhaarNumber !== undefined || aadharNumber !== undefined || aadhaar !== undefined || aadhar !== undefined) {
      const aVal = aadhaarNumber || aadharNumber || aadhaar || aadhar;
      employee.aadhaarNumber = aVal;
      employee.setDataValue('aadhaar_number', aVal);
      employee.setDataValue('aadhaarNumber', aVal);
      employee.setDataValue('aadhar_number', aVal);
      employee.setDataValue('aadharNumber', aVal);
    }
    if (panNumber !== undefined || pan !== undefined) {
      const pVal = panNumber || pan;
      employee.panNumber = pVal;
      employee.setDataValue('pan_number', pVal);
      employee.setDataValue('panNumber', pVal);
    }
    if (uanNumber !== undefined || pfUan !== undefined) {
      const uVal = uanNumber !== undefined ? uanNumber : pfUan;
      employee.uanNumber = uVal;
      employee.setDataValue('uan_number', uVal);
      employee.setDataValue('uanNumber', uVal);
    }
    if (pfNumber !== undefined || req.body.pf_number !== undefined) {
      const pfVal = pfNumber !== undefined ? pfNumber : req.body.pf_number;
      employee.pfNumber = pfVal;
      employee.setDataValue('pf_number', pfVal);
      employee.setDataValue('pfNumber', pfVal);
    }
    if (esiNumber !== undefined || esicNumber !== undefined || esiNo !== undefined) {
      const eVal = esiNumber || esicNumber || esiNo;
      employee.esiNumber = eVal;
      employee.setDataValue('esi_number', eVal);
      employee.setDataValue('esiNumber', eVal);
      employee.esicNumber = eVal;
      employee.setDataValue('esicNumber', eVal);
    }

    // Update customFields if provided (sanitize and preserve user custom fields, allowing deletions)
    if (customFields !== undefined) {
      const cleanCustom = {};
      if (customFields && typeof customFields === 'object') {
        Object.entries(customFields).forEach(([k, v]) => {
          if (!SYSTEM_CUSTOM_FIELD_KEYS.has(k)) {
            cleanCustom[k] = v;
          }
        });
      }
      employee.customFields = cleanCustom;
      employee.setDataValue('customFields', JSON.stringify(cleanCustom));
      employee.setDataValue('custom_fields', JSON.stringify(cleanCustom));
    }

    // Save fatherName, spouseName, presentAddress, permanentAddress, emergencyContact, highestQualification
    const fVal = fatherName !== undefined ? fatherName : req.body.father_name;
    if (fVal !== undefined) {
      employee.fatherName = fVal;
      employee.setDataValue('fatherName', fVal);
      employee.setDataValue('father_name', fVal);
    }
    const sVal = spouseName !== undefined ? spouseName : req.body.spouse_name;
    if (sVal !== undefined) {
      employee.spouseName = sVal;
      employee.setDataValue('spouseName', sVal);
      employee.setDataValue('spouse_name', sVal);
    }
    const pVal = presentAddress !== undefined ? presentAddress : (req.body.present_address || req.body.address || req.body.currentAddress);
    if (pVal !== undefined) {
      employee.presentAddress = pVal;
      employee.setDataValue('presentAddress', pVal);
      employee.setDataValue('present_address', pVal);
    }
    const permVal = permanentAddress !== undefined ? permanentAddress : req.body.permanent_address;
    if (permVal !== undefined) {
      employee.permanentAddress = permVal;
      employee.setDataValue('permanentAddress', permVal);
      employee.setDataValue('permanent_address', permVal);
    }
    const ecVal = emergencyContact !== undefined ? emergencyContact : req.body.emergency_contact;
    if (ecVal !== undefined) {
      employee.emergencyContact = ecVal;
      employee.setDataValue('emergencyContact', ecVal);
      employee.setDataValue('emergency_contact', ecVal);
    }
    if (highestQualification !== undefined) {
      const hqStr = highestQualification ? (typeof highestQualification === 'string' ? highestQualification : JSON.stringify(highestQualification)) : null;
      employee.highestQualification = hqStr;
      employee.setDataValue('highest_qualification', hqStr);
    }

    if (exitReason !== undefined) employee.exitReason = exitReason;
    if (exitDiscussed !== undefined) employee.exitDiscussed = exitDiscussed;
    if (exitDiscussionSummary !== undefined) employee.exitDiscussionSummary = exitDiscussionSummary;
    if (exitTerminationReason !== undefined) employee.exitTerminationReason = exitTerminationReason;
    if (exitNoticeDate !== undefined) employee.exitNoticeDate = exitNoticeDate;
    if (exitComments !== undefined) employee.exitComments = exitComments;
    if (exitDate !== undefined) employee.exitDate = exitDate;

    await employee.save();
    invalidateEmployeeCache();

    // Prepare normalized response payload (matching GET /:id)
    const empObj = employee.toJSON();
    const rawAllowed = employee.allowed_leaves !== undefined ? employee.allowed_leaves : employee.allowedLeaves;
    const dynamicLeaves = calculateEarnedLeaves(employee.joiningDate || employee.createdAt);
    empObj.allowedLeaves = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
      ? Number(rawAllowed)
      : dynamicLeaves;
    const cf = (typeof empObj.customFields === 'object' && empObj.customFields !== null) ? empObj.customFields : {};
    const openingBalance = Number(employee.opening_leave_balance !== undefined && employee.opening_leave_balance !== null
      ? employee.opening_leave_balance
      : (employee.openingLeaveBalance !== undefined && employee.openingLeaveBalance !== null
        ? employee.openingLeaveBalance
        : (cf.openingLeaveBalance || cf.earnedLeaves || 0)));
    empObj.openingLeaveBalance = openingBalance;
    empObj.earnedLeaves = openingBalance;
    empObj.totalEarnedLeaves = empObj.allowedLeaves + openingBalance;
    empObj.availableLeaves = Math.max(0, empObj.totalEarnedLeaves - (employee.consumedLeaves || 0));
    empObj.aadhaar = empObj.aadhaarNumber || empObj.aadharNumber || cf.aadhaarNumber || cf.aadharNumber || cf.aadhaar || cf.aadhar || empObj.aadhaar || null;
    empObj.aadhaarNumber = empObj.aadhaar;
    empObj.aadharNumber = empObj.aadhaar;
    empObj.pan = empObj.panNumber || cf.panNumber || cf.pan || empObj.pan || null;
    empObj.panNumber = empObj.pan;
    empObj.pfUan = empObj.uanNumber || cf.uanNumber || cf.pfUan || empObj.pfUan || null;
    empObj.uanNumber = empObj.pfUan;
    empObj.pfNumber = empObj.pfNumber || empObj.pf_number || cf.pfNumber || cf.pf_number || null;
    empObj.pf_number = empObj.pfNumber;
    empObj.esiNo = empObj.esiNumber || cf.esiNumber || cf.esiNo || empObj.esiNo || null;
    empObj.esiNumber = empObj.esiNo;
    empObj.accountNumber = empObj.bankAccountNo || cf.bankAccountNo || cf.accountNumber || empObj.accountNumber || null;
    empObj.bankAccountNo = empObj.accountNumber;
    empObj.ifscCode = empObj.bankIfscCode || cf.bankIfscCode || cf.ifscCode || empObj.ifscCode || null;
    empObj.bankIfscCode = empObj.ifscCode;
    empObj.fatherName = empObj.fatherName || empObj.father_name || fVal || null;
    empObj.father_name = empObj.fatherName;
    empObj.spouseName = empObj.spouseName || empObj.spouse_name || sVal || null;
    empObj.spouse_name = empObj.spouseName;
    empObj.presentAddress = empObj.presentAddress || empObj.present_address || pVal || null;
    empObj.present_address = empObj.presentAddress;
    empObj.permanentAddress = empObj.permanentAddress || empObj.permanent_address || permVal || null;
    empObj.permanent_address = empObj.permanentAddress;
    empObj.emergencyContact = empObj.emergencyContact || empObj.emergency_contact || ecVal || null;
    empObj.emergency_contact = empObj.emergencyContact;
    empObj.placeOfDuty = employee.placeOfDuty || employee.place_of_duty || null;
    empObj.place_of_duty = empObj.placeOfDuty;
    try {
      empObj.highestQualification = empObj.highestQualification
        ? (typeof empObj.highestQualification === 'string' ? JSON.parse(empObj.highestQualification) : empObj.highestQualification)
        : (cf.highestQualification || null);
    } catch (e) { empObj.highestQualification = null; }

    // Respond immediately to the client with updated profile (< 25ms)
    await applyLedgerBalances([empObj]);
    res.status(200).json(empObj);

    // Asynchronously perform background cascading updates without blocking the HTTP thread or user UI
    setImmediate(async () => {
      try {
        const isCompChanged = (compensationGross !== undefined && compensationGross !== null && !isNaN(Number(compensationGross)) && Number(compensationGross) !== Number(previousGross));

        // Auto-sync active SalaryStructure whenever compensationGross actually changes
        if (isCompChanged) {
          try {
            const annualCtc = Number(compensationGross);
            const monthlyGross = Math.round(annualCtc / 12);
            const revisionDate = req.body.revisionEffectiveDate || new Date().toISOString().split('T')[0];
            const revisionReason = req.body.revisionReason || 'Salary Revision';

            const candidateIds = [employee.id, employee.empCode].filter(Boolean);
            const existingStructure = await SalaryStructure.findOne({
              where: {
                employeeId: { [Op.in]: candidateIds },
                status: 'ACTIVE'
              },
              order: [['version', 'DESC'], ['createdAt', 'DESC']]
            });

            const todayStr = new Date().toISOString().split('T')[0];
            const isFutureRevision = revisionDate > todayStr;

            if (existingStructure) {
              if (Number(existingStructure.ctc) !== annualCtc) {
                let prevEffectiveTo = revisionDate;
                try {
                  const rDate = new Date(revisionDate);
                  rDate.setDate(rDate.getDate() - 1);
                  prevEffectiveTo = rDate.toISOString().split('T')[0];
                } catch (e) {
                  prevEffectiveTo = revisionDate;
                }

                existingStructure.effectiveTo = prevEffectiveTo;
                existingStructure.status = isFutureRevision ? 'ACTIVE' : 'INACTIVE';
                await existingStructure.save();

                const nextVersion = (existingStructure.version || 1) + 1;
                await SalaryStructure.create({
                  employeeId: employee.id,
                  ctc: annualCtc,
                  grossSalary: monthlyGross,
                  effectiveFrom: revisionDate,
                  effectiveTo: null,
                  status: isFutureRevision ? 'SCHEDULED' : 'ACTIVE',
                  version: nextVersion,
                  revisionReason: revisionReason
                });

                employee.lastRevisionDate = revisionDate;
                await employee.save();
              }
            } else {
              await SalaryStructure.create({
                employeeId: employee.id,
                ctc: annualCtc,
                grossSalary: monthlyGross,
                effectiveFrom: employee.joiningDate || revisionDate,
                effectiveTo: null,
                status: 'ACTIVE',
                version: 1,
                revisionReason: 'Initial Salary Structure'
              });
            }
          } catch (ssErr) {
            console.warn('[Employee Update] SalaryStructure auto-sync warning:', ssErr.message);
          }

          // Invalidate stale draft adjustments and update open DRAFT pay run items
          try {
            const draftRuns = await PayrollRun.findAll({ where: { status: 'DRAFT' } });
            const revMonthStr = (req.body.revisionEffectiveDate || new Date().toISOString().split('T')[0]).slice(0, 7);

            for (const dRun of draftRuns) {
              const runMonthStr = `${dRun.year}-${String(dRun.month).padStart(2, '0')}`;
              if (runMonthStr < revMonthStr) continue;

              if (dRun.wizardState) {
                const ws = typeof dRun.wizardState === 'string' ? JSON.parse(dRun.wizardState) : { ...dRun.wizardState };
                if (ws.appliedAdjustments && (ws.appliedAdjustments[id] || ws.appliedAdjustments[employee.id] || (employee.empCode && ws.appliedAdjustments[employee.empCode]))) {
                  delete ws.appliedAdjustments[id];
                  delete ws.appliedAdjustments[employee.id];
                  if (employee.empCode) delete ws.appliedAdjustments[employee.empCode];
                  dRun.wizardState = ws;
                  await dRun.save();
                }
              }

              const rawCtc = Number(employee.compensationGross || 0);
              const monthlyGross = rawCtc > 0 ? (rawCtc > 100000 ? Math.round(rawCtc / 12) : rawCtc) : 25000;
              const targetIds = [employee.id, id, employee.empCode].filter(Boolean);
              
              const item = await PayrollItem.findOne({
                where: {
                  payrollRunId: dRun.id,
                  employeeId: { [Op.in]: targetIds }
                }
              });

              if (item) {
                const workingDays = Number(item.workingDays) || 30;
                const workedDays = Number(item.workedDays) !== undefined ? Number(item.workedDays) : (workingDays - (Number(item.lopDays) || 0));
                const factor = workingDays > 0 ? (workedDays / workingDays) : 1;
                
                const baseBasic = Number(employee.basicSalary || Math.round(monthlyGross * 0.50));
                const baseHra = Number(employee.hra || Math.round(monthlyGross * 0.30));
                const baseOther = Number(employee.allowances || Math.max(0, monthlyGross - baseBasic - baseHra));

                const basic = Math.round(baseBasic * factor);
                const hraVal = Math.round(baseHra * factor);
                const special = Math.round(baseOther * factor);
                const newEarnedGross = basic + hraVal + special;

                const earnings = {
                  ...(typeof item.earningsBreakdown === 'string' ? JSON.parse(item.earningsBreakdown || '{}') : (item.earningsBreakdown || {})),
                  BASIC: basic,
                  HRA: hraVal,
                  SPECIAL_ALLOWANCE: special,
                  OTHER_ALLOWANCE: special
                };

                const deds = {
                  ...(typeof item.deductionsBreakdown === 'string' ? JSON.parse(item.deductionsBreakdown || '{}') : (item.deductionsBreakdown || {}))
                };

                if (employee.pfEligible !== false) {
                  const pfWage = basic + special;
                  const epfAmount = (employee.pfAmount && Number(employee.pfAmount) > 0)
                    ? Math.round(Number(employee.pfAmount) * factor)
                    : (pfWage < 15000 ? Math.round(pfWage * 0.12) : 1800);
                  deds.EPF_EE = epfAmount;
                  deds.PF_EE = epfAmount;
                } else {
                  deds.EPF_EE = 0;
                  deds.PF_EE = 0;
                }

                if (employee.esiEligible !== false && newEarnedGross <= 21000) {
                  deds.ESI_EE = Math.ceil(newEarnedGross * 0.0075);
                } else {
                  deds.ESI_EE = 0;
                }

                if (employee.ptEligible !== false) {
                  deds.PT = 208;
                } else {
                  deds.PT = 0;
                }

                if (employee.vpfEligible && Number(employee.vpfAmount) > 0) {
                  deds.VPF_EE = Number(employee.vpfAmount);
                  deds.VPF = Number(employee.vpfAmount);
                } else {
                  deds.VPF_EE = 0;
                  deds.VPF = 0;
                }

                const pfDed = Number(deds.EPF_EE != null ? deds.EPF_EE : (deds.PF_EE || 0));
                const vpfDed = Number(deds.VPF_EE != null ? deds.VPF_EE : (deds.VPF || 0));
                const esiDed = Number(deds.ESI_EE != null ? deds.ESI_EE : (deds.ESI || 0));
                const ptDed = Number(deds.PT || 0);
                const lwfDed = Number(deds.LWF_EE != null ? deds.LWF_EE : (deds.LWF || 0));
                const tdsDed = Number(deds.TDS || 0);
                const adhocDed = Number(deds.ADHOC_DEDUCTION || 0);
                const otherDed = Number(deds.OTHER != null ? deds.OTHER : (deds.LWP || 0));

                const totalDeds = pfDed + vpfDed + esiDed + ptDed + lwfDed + tdsDed + adhocDed + otherDed;

                item.grossEarned = newEarnedGross;
                item.earningsBreakdown = earnings;
                item.deductionsBreakdown = deds;
                item.totalDeductions = totalDeds;
                item.netSalary = Math.max(0, newEarnedGross - totalDeds);
                await item.save();

                const allItems = await PayrollItem.findAll({ where: { payrollRunId: dRun.id } });
                if (allItems.length > 0) {
                  dRun.totalGross = allItems.reduce((s, it) => s + (Number(it.grossEarned) || 0), 0);
                  dRun.totalDeductions = allItems.reduce((s, it) => s + (Number(it.totalDeductions) || 0), 0);
                  dRun.totalNet = allItems.reduce((s, it) => s + (Number(it.netSalary) || 0), 0);
                  await dRun.save();
                }
              }
            }
          } catch (wsErr) {
            console.warn('[Employee Update] Draft pay run wizardState clean warning:', wsErr.message);
          }
        }

        // Cascade name update to Attendances table only if name or empCode actually changed
        if ((name && name !== previousName) || (empCode && empCode !== employee.empCode)) {
          try {
            const targetIdentifiers = [employee.id, employee.empCode, id].filter(Boolean);
            await Attendance.update(
              { userName: employee.name },
              {
                where: {
                  userId: { [Op.in]: targetIdentifiers }
                }
              }
            );
          } catch (attSyncErr) {
            console.warn('[Employee Update] Attendance cascade update warning:', attSyncErr.message);
          }
        }

        // Auto-regenerate cached payslips for this employee so updates (placeOfDuty, designation, etc.) reflect immediately
        try {
          const PayslipGenerator = require('../../../payroll/services/PayslipGenerator');
          const { PayrollItem } = require('../../../../shared/models');
          const candidateEmpIds = [employee.id, employee.empCode].filter(Boolean);
          const empPayrollItems = await PayrollItem.findAll({
            where: { employeeId: { [Op.in]: candidateEmpIds } }
          });
          for (const pItem of empPayrollItems) {
            try {
              await PayslipGenerator.generatePayslipForEmployee(pItem.id);
            } catch (psGenErr) {
              console.warn('[Employee Update] Auto-refresh payslip warning:', psGenErr.message);
            }
          }
        } catch (psErr) {
          console.warn('[Employee Update] Payslip refresh cascade error:', psErr.message);
        }
      } catch (bgErr) {
        console.warn('[Employee Update] Background cascade error:', bgErr.message);
      }
    });
  } catch (error) {
    console.error('Error updating employee:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE Remove employee
router.delete('/:id', requireRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    await employee.destroy();
    invalidateEmployeeCache();
    return res.status(200).json({ message: 'Employee deleted successfully.' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/employees/:id/profile-photo - Upload/Update profile photo
router.post('/:id/profile-photo', (req, res, next) => {
  profileUpload.single('profilePhoto')(req, res, (err) => {
    if (err) {
      console.error("❌ Multer profile photo error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }

    // Delete old profile picture if exists
    if (employee.profilePhotoUrl) {
      const oldPath = path.join(profileUpload.getStoragePath(), employee.profilePhotoUrl);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
          console.log(`[Storage Log] Deleted old profile photo: ${oldPath}`);
        } catch (unlinkErr) {
          console.error('[Storage Log Error] Failed to delete old photo:', unlinkErr.message);
        }
      }
    }

    // Save new relative path
    employee.profilePhotoUrl = `profile/${req.file.filename}`;
    await employee.save();

    console.log(`[Storage Log] Profile photo uploaded successfully for: ${id}`);
    return res.status(200).json(employee);
  } catch (error) {
    console.error('Error uploading profile photo:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/employees/:id/profile-photo - Delete profile photo
router.delete('/:id/profile-photo', async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (employee.profilePhotoUrl) {
      const oldPath = path.join(profileUpload.getStoragePath(), employee.profilePhotoUrl);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
          console.log(`[Storage Log] Deleted profile photo on deletion request: ${oldPath}`);
        } catch (unlinkErr) {
          console.error('[Storage Log Error] Failed to delete photo:', unlinkErr.message);
        }
      }
      employee.profilePhotoUrl = null;
      await employee.save();
    }

    return res.status(200).json(employee);
  } catch (error) {
    console.error('Error deleting profile photo:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /fcm-token : Register client push token for FCM/Expo recovery
router.post('/fcm-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token parameter is required.' });
    }
    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    employee.fcmToken = token;
    await employee.save();
    console.log(`[FCM Register] Mapped token for user ${req.user.id}: ${token}`);
    return res.status(200).json({ message: 'FCM/Expo Token registered successfully.' });
  } catch (error) {
    console.error('Error saving FCM Token:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PATCH /:id/bypass-clockin : Expose clock-in limit bypass override approval (Phase 3)
router.patch('/:id/bypass-clockin', async (req, res) => {
  try {
    if (req.user && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only administrators can approve clock-in overrides.' });
    }

    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    employee.clockInBypassApproved = true;
    await employee.save();
    
    console.log(`[Admin Override] Clock-in limit bypass approved for user: ${id}`);
    return res.status(200).json({ message: 'Clock-in bypass override approved successfully.', employee });
  } catch (error) {
    console.error('Error approving clock-in bypass:', error);
    return res.status(500).json({ error: error.message });
  }
});
// --- PERMANENT PROFILE PHOTO (AVATAR) UPLOAD & REMOVAL ---
const multer = require('multer');
const avatarUploadDir = path.join(__dirname, '..', '..', '..', '..', '..', 'uploads');
if (!fs.existsSync(avatarUploadDir)) {
  fs.mkdirSync(avatarUploadDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ext.replace(/[^a-z0-9.]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// POST /api/employees/:id/avatar - Upload employee profile photo
router.post('/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No avatar image file was uploaded.' });
    }

    // Save public static URL path in database
    const avatarUrl = `/static/uploads/${req.file.filename}`;
    employee.avatar = avatarUrl;
    employee.profilePhotoUrl = avatarUrl;
    await employee.save();

    invalidateEmployeeCache();

    return res.status(200).json({
      success: true,
      message: 'Avatar uploaded and updated successfully.',
      avatar: avatarUrl,
      employee
    });
  } catch (error) {
    console.error('Error uploading employee avatar:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/employees/:id/avatar - Remove employee profile photo
router.delete('/:id/avatar', async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (employee.avatar && employee.avatar.startsWith('/static/uploads/')) {
      const filename = employee.avatar.replace('/static/uploads/', '');
      const filePath = path.join(avatarUploadDir, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }

    employee.avatar = null;
    await employee.save();

    invalidateEmployeeCache();

    return res.status(200).json({
      success: true,
      message: 'Avatar removed successfully.',
      avatar: null,
      employee
    });
  } catch (error) {
    console.error('Error removing employee avatar:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/:id/salary-history - Fetch complete revision history for an employee
router.get('/:id/salary-history', async (req, res) => {
  try {
    const { id } = req.params;
    let employee = await Employee.findByPk(id);
    if (!employee) {
      employee = await Employee.findOne({ where: { empCode: id } });
    }
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const candidateIds = [employee.id, employee.empCode].filter(Boolean);
    let structures = await SalaryStructure.findAll({
      where: {
        employeeId: { [Op.in]: candidateIds }
      },
      order: [
        ['effectiveFrom', 'ASC'],
        ['version', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });

    // If no structure exists yet, initialize baseline version 1 from employee's master compensation
    if (structures.length === 0 && Number(employee.compensationGross) > 0) {
      const annualCtc = Number(employee.compensationGross);
      const initStruct = await SalaryStructure.create({
        employeeId: employee.id,
        ctc: annualCtc,
        grossSalary: Math.round(annualCtc / 12),
        effectiveFrom: employee.joiningDate || new Date().toISOString().split('T')[0],
        effectiveTo: null,
        status: 'ACTIVE',
        version: 1,
        revisionReason: 'Initial Salary Structure'
      });
      structures = [initStruct];
    }

    const todayStr = new Date().toISOString().split('T')[0];
    let prevCtc = null;
    let prevGross = null;
    let upcomingRevision = null;
    let activeStructure = null;

    const enrichedHistory = structures.map((item, idx) => {
      const ctc = Number(item.ctc || 0);
      const gross = Number(item.grossSalary || 0);
      let diffAmount = 0;
      let diffPercent = 0;
      let isIncrease = false;
      let isDecrease = false;

      if (prevCtc !== null) {
        diffAmount = ctc - prevCtc;
        diffPercent = prevCtc > 0 ? Number(((diffAmount / prevCtc) * 100).toFixed(2)) : 0;
        isIncrease = diffAmount > 0;
        isDecrease = diffAmount < 0;
      }

      prevCtc = ctc;
      prevGross = gross;

      const seqVersion = idx + 1;
      const displayVersion = (item.version && item.version > 1) ? item.version : seqVersion;

      // Determine temporal point-in-time status
      const isScheduled = item.effectiveFrom && item.effectiveFrom > todayStr;
      const isPast = item.effectiveTo && item.effectiveTo < todayStr;
      const isCurrentActive = !isScheduled && !isPast && (item.status === 'ACTIVE' || (!item.effectiveTo || item.effectiveTo >= todayStr));

      let computedStatus = item.status;
      if (isScheduled) {
        computedStatus = 'SCHEDULED';
      } else if (isCurrentActive) {
        computedStatus = 'ACTIVE';
        activeStructure = item;
      } else if (isPast) {
        computedStatus = 'INACTIVE';
      }

      const revObj = {
        id: item.id,
        version: displayVersion,
        revisionLabel: seqVersion === 1 ? 'Revision 1 (Initial)' : `Revision ${displayVersion}`,
        status: computedStatus,
        rawStatus: item.status,
        isScheduled,
        isCurrentActive,
        isPast,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo,
        ctc,
        grossSalary: gross,
        monthlyGross: gross,
        annualCtc: ctc,
        revisionReason: item.revisionReason || (seqVersion === 1 ? 'Initial Salary Structure' : 'Salary Revision'),
        diffAmount,
        diffPercent,
        isIncrease,
        isDecrease,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };

      if (isScheduled && !upcomingRevision) {
        upcomingRevision = {
          version: displayVersion,
          effectiveDate: item.effectiveFrom,
          newCtc: ctc,
          newMonthlyGross: gross,
          diffAmount,
          diffPercent,
          reason: revObj.revisionReason
        };
      }

      return revObj;
    });

    // Initial CTC from baseline record
    const initialCtc = structures.length > 0 ? Number(structures[0].ctc || 0) : Number(employee.compensationGross || 0);

    // Current Active CTC governing payroll today
    const currentStructure = activeStructure || structures.find(s => !s.effectiveFrom || s.effectiveFrom <= todayStr) || structures[structures.length - 1];
    const currentCtc = currentStructure ? Number(currentStructure.ctc || 0) : initialCtc;

    const totalGrowthAmount = currentCtc - initialCtc;
    const totalGrowthPercent = initialCtc > 0 ? Number(((totalGrowthAmount / initialCtc) * 100).toFixed(2)) : 0;
    const latestRevisionDate = currentStructure ? (currentStructure.effectiveFrom || employee.joiningDate) : employee.joiningDate;

    return res.status(200).json({
      success: true,
      employee: {
        id: employee.id,
        name: employee.name,
        empCode: employee.empCode,
        currentCtc,
        joiningDate: employee.joiningDate
      },
      summary: {
        totalRevisions: enrichedHistory.length,
        currentCtc,
        initialCtc,
        totalGrowthAmount,
        totalGrowthPercent,
        latestRevisionDate,
        hasUpcomingRevision: !!upcomingRevision,
        upcomingRevision
      },
      history: enrichedHistory.reverse() // Most recent revision first
    });
  } catch (error) {
    console.error('Error fetching salary history:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
