const { Employee, SalaryStructure } = require('../models');

/**
 * Ensures every employee in location_employees has an active, up-to-date SalaryStructure
 * matching their compensationGross (annual CTC).
 */
async function syncAllSalaryStructures() {
  try {
    const employees = await Employee.findAll();
    let syncedCount = 0;
    let createdCount = 0;

    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Automatically transition SCHEDULED structures whose effective date has arrived
    const scheduledDue = await SalaryStructure.findAll({
      where: {
        status: 'SCHEDULED',
        effectiveFrom: { [require('sequelize').Op.lte]: todayStr }
      }
    });

    for (const sched of scheduledDue) {
      // Retire earlier active structures
      await SalaryStructure.update(
        { status: 'INACTIVE' },
        {
          where: {
            employeeId: sched.employeeId,
            status: 'ACTIVE',
            id: { [require('sequelize').Op.ne]: sched.id }
          }
        }
      );
      sched.status = 'ACTIVE';
      await sched.save();
      syncedCount++;
    }

    // 2. Ensure every employee has at least one baseline structure
    for (const emp of employees) {
      const annualCtc = Number(emp.compensationGross) > 0 ? Number(emp.compensationGross) : 300000;
      const monthlyGross = Math.round(annualCtc / 12);
      const effectiveDate = emp.joiningDate || (emp.createdAt ? new Date(emp.createdAt).toISOString().split('T')[0] : '2024-01-01');

      const existingCount = await SalaryStructure.count({
        where: { employeeId: emp.id }
      });

      if (existingCount === 0) {
        await SalaryStructure.create({
          employeeId: emp.id,
          ctc: annualCtc,
          grossSalary: monthlyGross,
          effectiveFrom: effectiveDate,
          status: 'ACTIVE',
          version: 1,
          revisionReason: 'Initial Salary Structure'
        });
        createdCount++;
      }
    }

    console.log(`[SalaryStructure Sync] Complete. Updated: ${syncedCount}, Created: ${createdCount}, Total Employees: ${employees.length}`);
    return { syncedCount, createdCount, total: employees.length };
  } catch (err) {
    console.error('[SalaryStructure Sync Error]:', err);
    throw err;
  }
}

module.exports = { syncAllSalaryStructures };

if (require.main === module) {
  syncAllSalaryStructures().then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}
