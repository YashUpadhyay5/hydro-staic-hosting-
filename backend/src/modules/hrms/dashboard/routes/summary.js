const express = require('express');
const router = express.Router();
const Leave = require('../../../../shared/models/Leave');
const Expense = require('../../../../shared/models/Expense');
const Attendance = require('../../../../shared/models/Attendance');
const Employee = require('../../../../shared/models/Employee');

const { Op } = require('sequelize');

const getAuthoritativeISTDate = (d = new Date()) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

const handleSummary = async (req, res) => {
  try {
    const todayStr = getAuthoritativeISTDate();
    let altDate = todayStr;
    if (todayStr.includes('-')) {
      const parts = todayStr.split('-');
      if (parts.length === 3) {
        altDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    const [pendingLeavesCount, pendingExpensesCount, todayAttendanceCount, activeEmployeesCount] = await Promise.all([
      Leave.count({ where: { status: 'pending' } }),
      Expense.count({ where: { status: 'pending' } }),
      Attendance.count({ 
        where: { 
          date: { [Op.in]: [todayStr, altDate] }
        } 
      }),
      Employee.count({ where: { role: { [Op.ne]: 'ADMIN' } } })
    ]);

    return res.status(200).json({
      pendingLeavesCount,
      pendingExpensesCount,
      todayAttendanceCount,
      activeEmployeesCount,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return res.status(500).json({ error: error.message });
  }
};

router.get('/', handleSummary);
router.get('/summary', handleSummary);

module.exports = router;
