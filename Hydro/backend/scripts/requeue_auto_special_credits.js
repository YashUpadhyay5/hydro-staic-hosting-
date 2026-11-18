// One-off: move the Sunday/holiday credits that the old attendance sync added automatically (before shift
// verification existed) back to Pending, so they count in leave balances only once an admin approves them on
// the Attendance > Weekend / Holiday Shifts page. Register (Excel) history and Leave Balances entries are not touched.
//
// Usage (from Hydro/backend):
//   node scripts/requeue_auto_special_credits.js            dry run: lists what would move, changes nothing
//   node scripts/requeue_auto_special_credits.js --apply    moves them (take a database backup first)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const apply = process.argv.includes('--apply');
const SpecialEarnedCreditService = require('../src/modules/hrms/leave/services/SpecialEarnedCreditService');
const sequelize = require('../src/config/database');

(async () => {
  const result = await SpecialEarnedCreditService.requeueAutoCredits({ apply, actor: 'Admin (requeue script)' });
  console.log(apply ? '\nMOVED TO PENDING' : '\nDRY RUN (nothing changed)');
  for (const i of result.items) {
    const hours = i.workingHours === undefined ? '' : `${i.workingHours} h worked, calculated ${i.eligibleDays} day(s)`;
    const state = i.moved ? 'moved' : (i.skipped ? `skipped: ${i.skipped}` : 'would move');
    console.log(`  ${i.workDate}  ${String(i.empCode).padEnd(8)} ${String(i.employeeName).padEnd(22)} ${i.days} day(s) credited  ${hours}  -> ${state}`);
  }
  console.log(`${result.total} automatic credit(s) found, ${result.moved} moved.`);
  if (!apply && result.total) console.log('Run again with --apply to move them.');
  await sequelize.close();
  process.exit(0);
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
