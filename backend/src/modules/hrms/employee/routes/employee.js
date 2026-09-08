const express = require('express');
const router = express.Router();
const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const HolidayCalendar = require('../../../../shared/models/HolidayCalendar');
const { calculateEarnedLeaves } = require('../../../../core/utils/leaveCalculator');
const { validatePasswordStrength } = require('../../../auth/services/authService');
const fs = require('fs');
const path = require('path');
const { profileUpload } = require('../../../../core/middleware/upload');
const requireRole = require('../../../../core/middleware/requireRole');
const verifyToken = require('../../../../core/middleware/verifyToken');
const { Op } = require('sequelize');
const { invalidateEmployeeCache } = require('../../../../core/utils/employeeCache');

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
    const { page, limit, chunked } = req.query;

    if (chunked === 'true' || page || limit) {
      const p = Math.max(1, parseInt(page || 1, 10));
      const l = Math.min(200, Math.max(1, parseInt(limit || 20, 10)));
      const offset = (p - 1) * l;

      const { count, rows } = await Employee.findAndCountAll({
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
        empObj.pan = empObj.panNumber || cf.panNumber || cf.pan || empObj.pan || null;
        empObj.panNumber = empObj.pan;
        empObj.pfUan = empObj.uanNumber || cf.uanNumber || cf.pfUan || empObj.pfUan || null;
        empObj.uanNumber = empObj.pfUan;
        empObj.esiNo = empObj.esiNumber || cf.esiNumber || cf.esiNo || empObj.esiNo || null;
        empObj.esiNumber = empObj.esiNo;
        empObj.accountNumber = empObj.bankAccountNo || cf.bankAccountNo || cf.accountNumber || empObj.accountNumber || null;
        empObj.bankAccountNo = empObj.accountNumber;
        empObj.ifscCode = empObj.bankIfscCode || cf.bankIfscCode || cf.ifscCode || empObj.ifscCode || null;
        empObj.bankIfscCode = empObj.ifscCode;
        return empObj;
      });

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
      empObj.pan = empObj.panNumber || cf.panNumber || cf.pan || empObj.pan || null;
      empObj.panNumber = empObj.pan;
      empObj.pfUan = empObj.uanNumber || cf.uanNumber || cf.pfUan || empObj.pfUan || null;
      empObj.uanNumber = empObj.pfUan;
      empObj.esiNo = empObj.esiNumber || cf.esiNumber || cf.esiNo || empObj.esiNo || null;
      empObj.esiNumber = empObj.esiNo;
      empObj.accountNumber = empObj.bankAccountNo || cf.bankAccountNo || cf.accountNumber || empObj.accountNumber || null;
      empObj.bankAccountNo = empObj.accountNumber;
      empObj.ifscCode = empObj.bankIfscCode || cf.bankIfscCode || cf.ifscCode || empObj.ifscCode || null;
      empObj.bankIfscCode = empObj.ifscCode;
      return empObj;
    });

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
    empObj.pan = empObj.panNumber || cf.panNumber || cf.pan || empObj.pan || null;
    empObj.panNumber = empObj.pan;
    empObj.pfUan = empObj.uanNumber || cf.uanNumber || cf.pfUan || empObj.pfUan || null;
    empObj.uanNumber = empObj.pfUan;
    empObj.esiNo = empObj.esiNumber || cf.esiNumber || cf.esiNo || empObj.esiNo || null;
    empObj.esiNumber = empObj.esiNo;
    empObj.accountNumber = empObj.bankAccountNo || cf.bankAccountNo || cf.accountNumber || empObj.accountNumber || null;
    empObj.bankAccountNo = empObj.accountNumber;
    empObj.ifscCode = empObj.bankIfscCode || cf.bankIfscCode || cf.ifscCode || empObj.ifscCode || null;
    empObj.bankIfscCode = empObj.ifscCode;
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
      legalEntity, department, location, reportingManager,
      probationPolicy, noticePeriod, leaveSetting, holidayDetails,
      weeklyOffs, attendanceSetting, overtime, expensePolicies,
      compensationGross, customFields, pfEligible, pfAmount, esiEligible, lwfEligible, lwfAmount,
      vpfEligible, vpfAmount, ptEligible, ptAmount, ptStateCode, ptExemption, ptExemptionType, ptExemptionReason, taxRegime,
      bankName, bankAccountNo, bankIfscCode, bankBranchName,
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
      bankAccountNo: bankAccountNo || null,
      bankIfscCode: bankIfscCode || null,
      bankBranchName: bankBranchName || null,
      exitReason: exitReason || null,
      exitDiscussed: exitDiscussed !== undefined ? exitDiscussed : null,
      exitDiscussionSummary: exitDiscussionSummary || null,
      exitTerminationReason: exitTerminationReason || null,
      exitNoticeDate: exitNoticeDate || null,
      exitComments: exitComments || null,
      exitDate: exitDate || null,
      customFields: customFields || {}
    });

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
      name, email, password, designation, role, allowedLeaves, consumedLeaves, status,
      gender, dob, empCode, nationality, phoneNo, joiningDate, jobTitle,
      legalEntity, department, location, reportingManager,
      probationPolicy, noticePeriod, leaveSetting, holidayDetails,
      weeklyOffs, attendanceSetting, overtime, expensePolicies,
      compensationGross, customFields, pfEligible, pfAmount, esiEligible, lwfEligible, lwfAmount, vpfEligible, vpfAmount, 
      ptEligible, ptAmount, ptStateCode, ptExemption, ptExemptionType, ptExemptionReason, taxRegime,
      bankName, bankAccountNo, bankIfscCode, bankBranchName,
      panNumber, pan, uanNumber, pfUan, pfNumber, esiNumber, esicNumber, esiNo, ifscCode, accountNumber,
      exitReason, exitDiscussed, exitDiscussionSummary, exitTerminationReason, exitNoticeDate, exitComments, exitDate
    } = req.body;

    const employee = await Employee.findByPk(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (name) employee.name = name;
    if (email) employee.email = email.toLowerCase();
    if (password) employee.password = password;
    if (designation) employee.designation = designation;
    if (role) employee.role = role;
    if (status) employee.status = status;
    if (allowedLeaves !== undefined) employee.allowedLeaves = Number(allowedLeaves);
    if (consumedLeaves !== undefined) employee.consumedLeaves = Number(consumedLeaves);
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
    if (panNumber !== undefined || pan !== undefined) {
      const pVal = panNumber || pan;
      employee.panNumber = pVal;
      employee.setDataValue('pan_number', pVal);
      employee.setDataValue('panNumber', pVal);
    }
    if (uanNumber !== undefined || pfUan !== undefined || pfNumber !== undefined) {
      const uVal = uanNumber || pfUan || pfNumber;
      employee.uanNumber = uVal;
      employee.setDataValue('uan_number', uVal);
      employee.setDataValue('uanNumber', uVal);
      employee.setDataValue('pf_number', uVal);
    }
    if (esiNumber !== undefined || esicNumber !== undefined || esiNo !== undefined) {
      const eVal = esiNumber || esicNumber || esiNo;
      employee.esiNumber = eVal;
      employee.setDataValue('esi_number', eVal);
      employee.setDataValue('esiNumber', eVal);
      employee.setDataValue('esic_number', eVal);
    }

    // Merge into customFields as well for complete fallback safety
    const existingCustom = (typeof employee.customFields === 'object' && employee.customFields !== null) ? employee.customFields : {};
    employee.customFields = {
      ...existingCustom,
      ...(customFields || {}),
      ...(panNumber || pan ? { panNumber: panNumber || pan, pan: panNumber || pan } : {}),
      ...(uanNumber || pfUan || pfNumber ? { uanNumber: uanNumber || pfUan || pfNumber, pfUan: uanNumber || pfUan || pfNumber } : {}),
      ...(esiNumber || esicNumber || esiNo ? { esiNumber: esiNumber || esicNumber || esiNo, esicNumber: esiNumber || esicNumber || esiNo } : {}),
      ...(bankAccountNo || accountNumber ? { bankAccountNo: bankAccountNo || accountNumber } : {}),
      ...(bankIfscCode || ifscCode ? { bankIfscCode: bankIfscCode || ifscCode } : {})
    };

    if (exitReason !== undefined) employee.exitReason = exitReason;
    if (exitDiscussed !== undefined) employee.exitDiscussed = exitDiscussed;
    if (exitDiscussionSummary !== undefined) employee.exitDiscussionSummary = exitDiscussionSummary;
    if (exitTerminationReason !== undefined) employee.exitTerminationReason = exitTerminationReason;
    if (exitNoticeDate !== undefined) employee.exitNoticeDate = exitNoticeDate;
    if (exitComments !== undefined) employee.exitComments = exitComments;
    if (exitDate !== undefined) employee.exitDate = exitDate;

    await employee.save();

    // Cascade name update to Attendances table to ensure instant UI sync across all dashboards
    if (name || empCode) {
      try {
        const targetIdentifiers = [employee.id, employee.empCode, id].filter(Boolean);
        await Attendance.update(
          { userName: employee.name },
          {
            where: {
              [Op.or]: [
                { userId: { [Op.in]: targetIdentifiers } },
                { userName: employee.name }
              ]
            }
          }
        );
      } catch (attSyncErr) {
        console.warn('[Employee Update] Attendance cascade update warning:', attSyncErr.message);
      }
    }

    invalidateEmployeeCache();
    return res.status(200).json(employee);
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

module.exports = router;
