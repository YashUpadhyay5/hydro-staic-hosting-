require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const sequelize = require('./src/config/database');
const Attendance = require('./src/shared/models/Attendance');
const Employee = require('./src/shared/models/Employee');
const { Op } = require('sequelize');

(async () => {
  try {
    const emps = await Employee.findAll({
      where: {
        name: { [Op.iLike]: '%Roop%' }
      }
    });
    const empsUpas = await Employee.findAll({
      where: {
        name: { [Op.iLike]: '%Upas%' }
      }
    });
    console.log('Roop Employees:', emps.map(e => ({ id: e.id, name: e.name, empCode: e.empCode })));
    console.log('Upas Employees:', empsUpas.map(e => ({ id: e.id, name: e.name, empCode: e.empCode })));

    const allIds = [
      ...emps.flatMap(e => [e.id, e.empCode]),
      ...empsUpas.flatMap(e => [e.id, e.empCode])
    ].filter(Boolean);

    const records = await Attendance.findAll({
      where: {
        [Op.or]: [
          { userId: { [Op.in]: allIds } },
          { userName: { [Op.iLike]: '%Roop%' } },
          { userName: { [Op.iLike]: '%Upas%' } }
        ]
      },
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
      limit: 15
    });

    console.log('\nAttendance records:');
    records.forEach(r => {
      console.log({
        id: r.id,
        userId: r.userId,
        userName: r.userName,
        date: r.date,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        workingHours: r.workingHours,
        overtimeStatus: r.overtimeStatus,
        overtimeMinutes: r.overtimeMinutes,
        overtimeHours: r.overtimeHours,
        overtimeApprovedBy: r.overtimeApprovedBy,
        overtimeApprovedAt: r.overtimeApprovedAt,
        overtimeDecisionNote: r.overtimeDecisionNote
      });
    });

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
