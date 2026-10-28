const express = require('express');
const router = express.Router();
const Leave = require('../../../../shared/models/Leave');
const Employee = require('../../../../shared/models/Employee');
const sequelize = require('../../../../config/database');
const { Op } = require('sequelize');
const { calculateEarnedLeaves } = require('../../../../core/utils/leaveCalculator');
const { getCachedEmployees, invalidateEmployeeCache } = require('../../../../core/utils/employeeCache');
const LeaveAdjustment = require('../../../../shared/models/LeaveAdjustment');
const LeaveBalanceService = require('../services/LeaveBalanceService');

// Helper to reliably find an employee by id, emp_code, or name
async function findEmployee(identifier, name) {
  if (!identifier && !name) return null;
  let emp = null;
  if (identifier) {
    emp = await Employee.findOne({
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('id')), String(identifier).toLowerCase()),
          sequelize.where(sequelize.fn('lower', sequelize.col('emp_code')), String(identifier).toLowerCase())
        ]
      }
    });
  }
  if (!emp && name) {
    emp = await Employee.findOne({
      where: sequelize.where(sequelize.fn('lower', sequelize.col('name')), String(name).toLowerCase())
    });
  }
  return emp;
}

// GET all leaves (Admin) or leaves for a specific user
router.get('/', async (req, res) => {
  try {
    const { userId, limit } = req.query;
    const whereClause = {};
    if (userId) {
      const u = String(userId).trim().toLowerCase();
      whereClause[Op.or] = [
        sequelize.where(sequelize.fn('lower', sequelize.col('user_id')), u),
        sequelize.where(sequelize.fn('lower', sequelize.col('user_name')), u)
      ];
    }
    
    const leaves = await Leave.findAll({
      where: whereClause,
      order: [['appliedAt', 'DESC']],
      limit: limit ? Math.max(1, parseInt(limit, 10)) : undefined
    });

    const { empMap } = await getCachedEmployees();
    const findEmp = (l) => empMap.get(String(l.userId || '').toLowerCase()) || empMap.get(String(l.userName || '').toLowerCase());

    // Remaining/consumed come from the Leave Balances ledger so this screen matches the Leave Balances pages.
    const involved = [...new Map(leaves.map(findEmp).filter(Boolean).map((e) => [e.id, e])).values()];
    const balances = await LeaveBalanceService.getBalanceSnapshots(involved);

    const leavesWithBalances = leaves.map((leave) => {
      const leaveObj = leave.toJSON ? leave.toJSON() : { ...leave };
      const emp = findEmp(leaveObj);
      if (emp) {
        const dynamicLeaves = calculateEarnedLeaves(emp.joiningDate || emp.createdAt);
        const rawAllowed = emp.allowed_leaves !== undefined ? emp.allowed_leaves : emp.allowedLeaves;
        const effectiveAllowed = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
          ? Number(rawAllowed)
          : dynamicLeaves;
        const openingBalance = Number(emp.opening_leave_balance !== undefined && emp.opening_leave_balance !== null
          ? emp.opening_leave_balance
          : (emp.openingLeaveBalance !== undefined && emp.openingLeaveBalance !== null
            ? emp.openingLeaveBalance
            : (emp.earned_leaves || emp.earnedLeaves || 0)));
        const totalEntitled = effectiveAllowed + openingBalance;

        leaveObj.userId = emp.empCode || emp.id;
        leaveObj.empCode = emp.empCode || emp.id;
        leaveObj.userName = emp.name || leaveObj.userName;
        leaveObj.allowedLeaves = effectiveAllowed;
        leaveObj.openingBalance = openingBalance;
        const balance = balances.get(emp.id);
        leaveObj.leavesConsumed = balance ? balance.consumed : (emp.consumedLeaves || 0);
        leaveObj.leavesRemaining = balance ? balance.available : Math.max(0, totalEntitled - (emp.consumedLeaves || 0));
      } else {
        leaveObj.empCode = leaveObj.userId;
        leaveObj.allowedLeaves = 15;
        leaveObj.openingBalance = 0;
        leaveObj.leavesConsumed = 0;
        leaveObj.leavesRemaining = 15;
      }
      leaveObj.actionBy = leave.actionBy || leaveObj.action_by || null;
      return leaveObj;
    });

    return res.status(200).json(leavesWithBalances);
  } catch (error) {
    console.error('Error fetching leaves:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST Apply for a leave
router.post('/', async (req, res) => {
  try {
    const { userId, userName, startDate, endDate, reason } = req.body;
    
    if (!userId || !userName || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: 'Missing required leave fields.' });
    }

    // Calculate duration in days (inclusive)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const timeDiff = end.getTime() - start.getTime();
    const calculatedDays = Math.round(timeDiff / (1000 * 3600 * 24)) + 1;
    const finalTotalDays = Math.max(1, calculatedDays);

    const emp = await findEmployee(userId, userName);
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const dynamicLeaves = calculateEarnedLeaves(emp.joiningDate || emp.createdAt);
    const rawAllowed = emp.allowed_leaves !== undefined ? emp.allowed_leaves : emp.allowedLeaves;
    const allowed = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
      ? Number(rawAllowed)
      : dynamicLeaves;
    const openingBalance = Number(emp.opening_leave_balance !== undefined && emp.opening_leave_balance !== null
      ? emp.opening_leave_balance
      : (emp.openingLeaveBalance !== undefined && emp.openingLeaveBalance !== null
        ? emp.openingLeaveBalance
        : (emp.earned_leaves || emp.earnedLeaves || 0)));
    const totalEntitled = allowed + openingBalance;
    // Available EL comes from the Leave Balances ledger, minus EL already held by this employee's other pending requests.
    const snapshot = (await LeaveBalanceService.getBalanceSnapshots([emp])).get(emp.id);
    const pendingEl = await Leave.sum('elDays', {
      where: {
        status: 'pending',
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('user_id')), String(emp.empCode || emp.id).toLowerCase()),
          sequelize.where(sequelize.fn('lower', sequelize.col('user_id')), String(emp.id).toLowerCase())
        ]
      }
    }) || 0;
    const availableEL = snapshot
      ? Math.max(0, Math.floor(snapshot.available - pendingEl))
      : Math.max(0, totalEntitled - (emp.consumedLeaves || 0));

    let finalElDays = 0;
    let finalLopDays = 0;

    if (availableEL >= finalTotalDays) {
      finalElDays = finalTotalDays;
      finalLopDays = 0;
    } else {
      finalElDays = availableEL;
      finalLopDays = finalTotalDays - availableEL;
    }
    
    const finalUserId = emp.empCode || emp.id;
    const finalUserName = emp.name || userName;

    const newLeave = await Leave.create({
      userId: finalUserId,
      userName: finalUserName,
      startDate,
      endDate,
      type: 'Earned Leave',
      reason,
      status: 'pending',
      appliedAt: Date.now(),
      elDays: finalElDays,
      lopDays: finalLopDays,
      totalDays: finalTotalDays
    });

    // --- PUSH NOTIFICATION LOGIC FOR ADMIN ---
    try {
      const admins = await Employee.findAll({ where: { role: 'ADMIN', status: 'ACTIVE' } });
      const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
      for (const admin of admins) {
        if (admin.fcmToken) {
          await HeartbeatMonitorService.sendPush(
            admin.fcmToken,
            'New Leave Request',
            `${finalUserName} applied for ${newLeave.type} leave (${startDate} to ${endDate}).`,
            { type: 'leave_request', leaveId: newLeave.id }
          );
        }
      }
    } catch (notifErr) {
      console.warn("Admin leave notification failed:", notifErr.message);
    }
    
    return res.status(201).json(newLeave);
  } catch (error) {
    console.error('Error creating leave application:', error);
    return res.status(500).json({ error: error.message });
  }
});

const requireRole = require('../../../../core/middleware/requireRole');

// PATCH Update leave status (approved or rejected)
router.patch('/:id/status', requireRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actionBy } = req.body;
    
    if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid leave status.' });
    }
    
    const leave = await Leave.findByPk(id);
    if (!leave) {
      return res.status(404).json({ error: 'Leave request not found.' });
    }

    const emp = await findEmployee(leave.userId, leave.userName);
    
    // If the status is changing to approved, we increment consumedLeaves for that employee by only their applied EL days
    if (status === 'approved' && leave.status !== 'approved') {
      if (emp) {
        emp.consumedLeaves = (emp.consumedLeaves || 0) + (leave.elDays || 0);
        await emp.save();
      }
    } else if (status !== 'approved' && leave.status === 'approved') {
      // If we revoke approval, decrement consumedLeaves by the same EL days amount
      if (emp) {
        emp.consumedLeaves = Math.max(0, (emp.consumedLeaves || 0) - (leave.elDays || 0));
        await emp.save();
      }
    }
    
    leave.status = status;
    if (status === 'approved' || status === 'rejected') {
      leave.actionBy = actionBy || req.user?.name || req.user?.empCode || req.user?.id || 'Admin';
    } else if (status === 'pending') {
      leave.actionBy = null;
    }
    await leave.save();

    // --- PUSH NOTIFICATION LOGIC FOR EMPLOYEE ---
    try {
      if (emp && emp.fcmToken) {
        const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
        await HeartbeatMonitorService.sendPush(
          emp.fcmToken,
          `Leave ${status}`,
          `Your ${leave.type} leave request from ${leave.startDate} has been ${status.toLowerCase()}.`,
          { type: 'leave_status_update', leaveId: leave.id, status }
        );
      }
    } catch (notifErr) {
      console.warn("Employee leave status notification failed:", notifErr.message);
    }
    
    return res.status(200).json(leave);
  } catch (error) {
    console.error('Error updating leave status:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /adjustments - Retrieve leave adjustment ledger history
router.get('/adjustments', async (req, res) => {
  try {
    const { employeeId } = req.query;
    const where = {};
    if (employeeId) {
      where[Op.or] = [
        sequelize.where(sequelize.fn('lower', sequelize.col('employee_id')), String(employeeId).toLowerCase()),
        sequelize.where(sequelize.fn('lower', sequelize.col('emp_code')), String(employeeId).toLowerCase())
      ];
    }
    const adjustments = await LeaveAdjustment.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(adjustments);
  } catch (error) {
    console.error('Error fetching leave adjustments:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /adjust-balance - Adjust leave balance / credit opening balance
router.post('/adjust-balance', requireRole(['ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const {
      employeeId,
      empCode,
      adjustmentType = 'OPENING_BALANCE', // 'OPENING_BALANCE', 'CREDIT', 'DEBIT', 'SET_BALANCE'
      leaveType = 'Earned Leave',
      days,
      reason,
      effectiveDate = new Date().toISOString().slice(0, 10)
    } = req.body;

    const identifier = employeeId || empCode;
    if (!identifier) {
      return res.status(400).json({ error: 'Employee ID or Emp Code is required.' });
    }

    if (days === undefined || days === null || isNaN(Number(days))) {
      return res.status(400).json({ error: 'A valid number of days is required.' });
    }

    const numDays = Number(days);
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'Reason for leave adjustment is required.' });
    }

    const emp = await findEmployee(identifier, null);
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const currentOpening = Number(emp.openingLeaveBalance || emp.opening_leave_balance || 0);
    let newOpening = currentOpening;

    switch (adjustmentType) {
      case 'OPENING_BALANCE':
      case 'CREDIT':
        newOpening = currentOpening + numDays;
        break;
      case 'DEBIT':
        newOpening = Math.max(0, currentOpening - numDays);
        break;
      case 'SET_BALANCE':
        newOpening = Math.max(0, numDays);
        break;
      default:
        return res.status(400).json({ error: `Invalid adjustment type: ${adjustmentType}` });
    }

    // Persist to Employee record
    emp.openingLeaveBalance = newOpening;
    emp.earnedLeaves = newOpening;

    let cf = {};
    try {
      cf = typeof emp.customFields === 'object' && emp.customFields !== null
        ? emp.customFields
        : JSON.parse(emp.customFields || '{}');
    } catch {
      cf = {};
    }
    cf.openingLeaveBalance = newOpening;
    cf.earnedLeaves = newOpening;
    emp.customFields = cf;

    await emp.save();
    invalidateEmployeeCache();

    // Create adjustment audit ledger record
    const adminIdentifier = req.user?.name || req.user?.email || 'Admin';
    const adjustment = await LeaveAdjustment.create({
      employeeId: emp.id,
      empCode: emp.empCode || emp.id,
      employeeName: emp.name,
      leaveType: leaveType || 'Earned Leave',
      adjustmentType,
      days: numDays,
      reason: String(reason).trim(),
      effectiveDate,
      adjustedBy: adminIdentifier
    });

    const dynamicLeaves = calculateEarnedLeaves(emp.joiningDate || emp.createdAt);
    const rawAllowed = emp.allowed_leaves !== undefined ? emp.allowed_leaves : emp.allowedLeaves;
    const effectiveAllowed = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
      ? Number(rawAllowed)
      : dynamicLeaves;
    const snapshot = (await LeaveBalanceService.getBalanceSnapshots([emp])).get(emp.id);
    const consumed = snapshot ? snapshot.consumed : (emp.consumedLeaves || 0);
    const availableLeaves = snapshot ? snapshot.available : Math.max(0, (effectiveAllowed + newOpening) - consumed);

    return res.status(201).json({
      success: true,
      message: 'Leave balance adjusted successfully.',
      adjustment,
      employee: {
        id: emp.id,
        empCode: emp.empCode,
        name: emp.name,
        allowedLeaves: effectiveAllowed,
        openingLeaveBalance: newOpening,
        consumedLeaves: consumed,
        availableLeaves,
        leaveBalance: snapshot || undefined
      }
    });
  } catch (error) {
    console.error('Error adjusting leave balance:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// LEAVE BALANCES MODULE
// ==========================================
const leavePolicy = require('../../../../core/config/leavePolicy');
const { submitChanges, LedgerError } = require('../services/LeaveLedgerChangeService');

const userRole = (req) => String(req.user?.role || 'EMPLOYEE').toUpperCase();
const canViewAllBalances = (req) => leavePolicy.BALANCE_VIEW_ROLES.includes(userRole(req));
const canEditBalances = (req) => leavePolicy.BALANCE_EDIT_ROLES.includes(userRole(req));
const actorLabel = (req) => {
  const name = req.user?.name || req.user?.email || 'Admin';
  return req.user?.id && String(req.user.id) !== String(name) ? `${name} (${req.user.id})` : String(name);
};

function parseYearParam(value) {
  const currentYear = new Date().getFullYear();
  if (value === undefined || value === '') return currentYear;
  const y = Number(value);
  return Number.isInteger(y) && y >= 2000 && y <= currentYear + 1 ? y : null;
}

// Employees may only read their own ledger; listed roles may read everyone's.
function canViewEmployee(req, emp) {
  if (canViewAllBalances(req)) return true;
  const uid = String(req.user?.id || '').toLowerCase();
  return !!uid && (uid === String(emp.id).toLowerCase() || uid === String(emp.empCode || '').toLowerCase());
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

// GET /leaves/balances/meta - filter options and policy for the Leave Balances pages
router.get('/balances/meta', async (req, res) => {
  try {
    if (!canViewAllBalances(req)) return res.status(403).json({ error: 'You do not have access to leave balances.' });
    const rows = await Employee.findAll({ attributes: ['department'], where: { status: 'ACTIVE' }, group: ['department'], raw: true });
    const departments = rows.map((r) => r.department).filter((d) => d && String(d).trim()).sort((a, b) => a.localeCompare(b));
    const startYear = Number(leavePolicy.LEDGER_START_MONTH.slice(0, 4));
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= Math.min(startYear, currentYear); y--) years.push(y);
    return res.status(200).json({
      departments,
      years,
      canEdit: canEditBalances(req),
      policy: {
        earnedLeavePerMonth: leavePolicy.EARNED_LEAVE_PER_MONTH,
        ledgerStartMonth: leavePolicy.LEDGER_START_MONTH,
        leaveUnitStep: leavePolicy.LEAVE_UNIT_STEP,
        allowNegativeBalance: leavePolicy.ALLOW_NEGATIVE_BALANCE
      }
    });
  } catch (error) {
    console.error('Error fetching leave balance meta:', error);
    return res.status(500).json({ error: 'Failed to load leave balance filters.' });
  }
});

// GET /leaves/balances - paginated employee leave balance summary for a given year
router.get('/balances', async (req, res) => {
  try {
    if (!canViewAllBalances(req)) return res.status(403).json({ error: 'You do not have access to leave balances.' });
    const targetYear = parseYearParam(req.query.year);
    if (targetYear === null) return res.status(400).json({ error: 'Invalid year.' });
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const department = String(req.query.department || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase().slice(0, 100);

    // Same population as the dashboard's active-employee count: active, not system accounts.
    const conditions = [{ status: 'ACTIVE' }, { [Op.or]: [{ isSystemAccount: false }, { isSystemAccount: null }] }];
    if (department) conditions.push({ department });
    if (search) {
      const q = `%${escapeLike(search)}%`;
      const like = (col) => sequelize.where(sequelize.fn('lower', sequelize.col(col)), { [Op.like]: q });
      conditions.push({ [Op.or]: [like('id'), like('emp_code'), like('name')] });
    }
    const where = { [Op.and]: conditions };

    const employees = await Employee.findAll({ where, order: [['name', 'ASC'], ['id', 'ASC']] });
    const ledgers = await LeaveBalanceService.getLedgersForEmployees(employees, targetYear);

    // Pending leave requests (not yet counted in any balance) for the filtered employees in this year.
    const idSet = new Set();
    for (const e of employees) { idSet.add(String(e.id).toLowerCase()); if (e.empCode) idSet.add(String(e.empCode).toLowerCase()); }
    const pending = await Leave.findAll({ attributes: ['userId', 'startDate'], where: { status: 'pending' }, raw: true });
    const pendingLeaveRequests = pending.filter((l) => idSet.has(String(l.userId || '').toLowerCase()) && String(l.startDate || '').startsWith(String(targetYear))).length;

    const total = ledgers.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pageNum = Math.min(totalPages, Math.max(1, parseInt(req.query.page, 10) || 1));
    const round2 = (n) => Math.round(n * 100) / 100;

    return res.status(200).json({
      year: targetYear,
      summary: {
        totalActiveEmployees: total,
        totalLeaveConsumed: round2(ledgers.reduce((s, l) => s + l.yearSummary.consumedLeave, 0)),
        totalSpecialEarnedLeave: round2(ledgers.reduce((s, l) => s + l.yearSummary.specialEarnedLeave, 0)),
        pendingLeaveRequests
      },
      page: pageNum,
      limit: pageSize,
      total,
      totalPages,
      data: ledgers.slice((pageNum - 1) * pageSize, pageNum * pageSize).map((l) => ({
        employeeId: l.employeeId,
        empCode: l.empCode,
        name: l.name,
        designation: l.designation,
        department: l.department,
        profilePhoto: l.profilePhoto,
        consumedLeave: l.yearSummary.consumedLeave,
        remainingLeave: l.yearSummary.remainingBalance,
        remainingEl: l.creditSummary.el,
        remainingSpecial: l.creditSummary.special,
        registerChanges: l.registerChanges.length // history figures that no longer match the imported register
      }))
    });
  } catch (error) {
    console.error('Error fetching leave balances:', error);
    return res.status(500).json({ error: 'Failed to load leave balances.' });
  }
});

// GET /leaves/balances/:employeeId - one employee's full monthly ledger for a year
router.get('/balances/:employeeId', async (req, res) => {
  try {
    const targetYear = parseYearParam(req.query.year);
    if (targetYear === null) return res.status(400).json({ error: 'Invalid year.' });
    const emp = await findEmployee(req.params.employeeId, null);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canViewEmployee(req, emp)) return res.status(403).json({ error: 'You do not have access to this employee\'s leave ledger.' });
    const ledger = await LeaveBalanceService.getEmployeeMonthlyLedger(emp, targetYear);
    ledger.canEdit = canEditBalances(req);
    return res.status(200).json(ledger);
  } catch (error) {
    console.error('Error fetching employee leave ledger:', error);
    return res.status(500).json({ error: 'Failed to load the leave ledger.' });
  }
});

// ---- Excel import ("EL and Sunday working" register) ----
const multer = require('multer');
const LeaveExcelImportService = require('../services/LeaveExcelImportService');
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(xlsx|xls)$/i.test(file.originalname || ''))
}).single('file');
const withExcel = (req, res, next) => excelUpload(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB.' : err.message });
  if (!req.file) return res.status(400).json({ error: 'Upload an .xlsx file in the "file" field.' });
  return next();
});
const handleImportError = (res, error, label) => {
  if (error instanceof LeaveExcelImportService.ImportError) return res.status(error.status).json({ error: error.message });
  console.error(label, error);
  return res.status(500).json({ error: 'Import failed. Nothing was saved.' });
};

// POST /leaves/balances/import/preview - parse the sheet and show what would change (writes nothing)
router.post('/balances/import/preview', requireRole(leavePolicy.BALANCE_EDIT_ROLES), withExcel, async (req, res) => {
  try {
    const plan = await LeaveExcelImportService.buildPlan(req.file.buffer, req.file.originalname);
    return res.status(200).json(plan);
  } catch (error) {
    return handleImportError(res, error, 'Error previewing leave import:');
  }
});

// POST /leaves/balances/import - apply the previewed sheet in one transaction (body: expectedHash)
router.post('/balances/import', requireRole(leavePolicy.BALANCE_EDIT_ROLES), withExcel, async (req, res) => {
  try {
    const result = await LeaveExcelImportService.applyImport(req.file.buffer, req.file.originalname, req.body?.expectedHash, actorLabel(req));
    return res.status(result.duplicate ? 200 : 201).json({
      success: true,
      duplicate: result.duplicate,
      batchId: result.batchId || null,
      rowsWritten: result.rowsWritten || 0,
      employees: result.plan.items.length
    });
  } catch (error) {
    return handleImportError(res, error, 'Error importing leave sheet:');
  }
});

// GET /leaves/balances/:employeeId/special-dates?year&month - Sundays and the employee's own calendar holidays in a month
router.get('/balances/:employeeId/special-dates', async (req, res) => {
  try {
    const y = Number(req.query.year);
    const m = Number(req.query.month);
    if (!Number.isInteger(y) || y < 2000 || y > new Date().getFullYear() + 1 || !Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: 'A valid year and month are required.' });
    }
    const emp = await findEmployee(req.params.employeeId, null);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canViewEmployee(req, emp)) return res.status(403).json({ error: 'You do not have access to this employee\'s leave ledger.' });
    return res.status(200).json(await LeaveBalanceService.getSpecialEarnedDateOptions(emp, y, m));
  } catch (error) {
    console.error('Error loading special-earned date options:', error);
    return res.status(500).json({ error: 'Failed to load Sundays and holidays.' });
  }
});

// POST /leaves/balances/:employeeId/submit - apply all staged ledger changes atomically
// Body: { year, expectedVersion, idempotencyKey, changes: [{ kind: 'earned'|'special-add'|'special-reverse'|'consumed', ... }] }
router.post('/balances/:employeeId/submit', requireRole(leavePolicy.BALANCE_EDIT_ROLES), async (req, res) => {
  try {
    const targetYear = parseYearParam(req.body?.year);
    if (targetYear === null) return res.status(400).json({ error: 'Invalid year.' });
    const emp = await findEmployee(req.params.employeeId, null);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });

    const result = await submitChanges(emp, { ...req.body, year: targetYear }, actorLabel(req));
    const ledger = await LeaveBalanceService.getEmployeeMonthlyLedger(emp, targetYear);
    ledger.canEdit = true;
    return res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, ledger });
  } catch (error) {
    if (error instanceof LedgerError) {
      return res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    }
    console.error('Error submitting leave ledger changes:', error);
    return res.status(500).json({ error: 'Failed to save changes. Nothing was saved.' });
  }
});

module.exports = router;
