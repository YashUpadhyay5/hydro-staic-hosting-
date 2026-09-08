const express = require('express');
const router = express.Router();
const Leave = require('../../../../shared/models/Leave');
const Employee = require('../../../../shared/models/Employee');
const sequelize = require('../../../../config/database');
const { Op } = require('sequelize');
const { calculateEarnedLeaves } = require('../../../../core/utils/leaveCalculator');
const { getCachedEmployees } = require('../../../../core/utils/employeeCache');

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
    const { userId } = req.query;
    
    const leaves = await Leave.findAll({
      order: [['appliedAt', 'DESC']]
    });

    const { employees, empMap } = await getCachedEmployees();

    const leavesWithBalances = leaves.map((leave) => {
      const leaveObj = leave.toJSON();
      const emp = empMap.get(String(leave.userId || '').toLowerCase()) || 
                  empMap.get(String(leave.userName || '').toLowerCase());
      if (emp) {
        const dynamicLeaves = calculateEarnedLeaves(emp.joiningDate || emp.createdAt);
        const rawAllowed = emp.allowed_leaves !== undefined ? emp.allowed_leaves : emp.allowedLeaves;
        const effectiveAllowed = (rawAllowed !== null && rawAllowed !== undefined && rawAllowed !== '' && !isNaN(Number(rawAllowed)))
          ? Number(rawAllowed)
          : dynamicLeaves;

        leaveObj.userId = emp.empCode || emp.id;
        leaveObj.empCode = emp.empCode || emp.id;
        leaveObj.userName = emp.name || leaveObj.userName;
        leaveObj.leavesConsumed = emp.consumedLeaves || 0;
        leaveObj.leavesRemaining = Math.max(0, effectiveAllowed - (emp.consumedLeaves || 0));
      } else {
        leaveObj.empCode = leaveObj.userId;
        leaveObj.leavesConsumed = 0;
        leaveObj.leavesRemaining = 15;
      }
      return leaveObj;
    });

    // If a specific userId was requested in the query
    let result = leavesWithBalances;
    if (userId) {
      const target = String(userId).toLowerCase();
      result = result.filter(l => 
        String(l.userId).toLowerCase() === target || 
        String(l.empCode).toLowerCase() === target
      );
    }
    
    return res.status(200).json(result);
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
    const consumed = emp.consumedLeaves || 0;
    const availableEL = Math.max(0, allowed - consumed);

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
    const { status } = req.body;
    
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

module.exports = router;
