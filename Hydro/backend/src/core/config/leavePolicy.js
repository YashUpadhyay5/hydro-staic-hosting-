// Single source of truth for org-wide leave policy used by the Leave Balances module.
// The frontend never hard-codes these values; it reads them from the ledger API response.
module.exports = {
  // Earned leave credited per eligible month.
  EARNED_LEAVE_PER_MONTH: 1,

  // First month of the leave ledger (YYYY-MM). Balances before this month were migrated from
  // the previous software as OPENING_BALANCE adjustments (effective 2026-09-26), so earned leave
  // accrues and approved leave is deducted only from this month onward.
  LEDGER_START_MONTH: '2026-10',

  // Migration period: months from here up to LEDGER_START_MONTH hold history from the previous platform.
  // Admins enter/import them per month (earned, special earned, consumed) plus a carry-forward from the
  // year before. Once an employee has any migration entry, it replaces their migrated opening balance.
  MIGRATION_START_MONTH: '2026-01',

  // Consumption order: first earned, first used. Every leave day (and consumed value) uses the oldest
  // available credit: carried-forward/opening balance, monthly EL, Sunday/holiday (special) credits.
  // A month's EL counts as earned at the END of that month, so Sunday/holiday work done during a month
  // is used before that month's EL. Set to 'MONTH_START' to treat EL as earned on the 1st instead.
  EL_EARNED_AT: 'MONTH_END',

  // Smallest leave unit accepted for manual edits (half-day).
  LEAVE_UNIT_STEP: 0.5,

  // A month's balance may not be pushed below zero by a manual change.
  ALLOW_NEGATIVE_BALANCE: false,

  // Roles allowed to view every employee's balances, and to change them.
  BALANCE_VIEW_ROLES: ['ADMIN', 'SUPER_ADMIN', 'HR', 'HR_ADMIN', 'MANAGER', 'TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER'],
  BALANCE_EDIT_ROLES: ['ADMIN', 'SUPER_ADMIN'],

  // ---- Sunday / holiday shifts (special earned leave) ----
  // A shift worked on a weekly off or a holiday is recorded as a PENDING credit; it only counts in the
  // balance once an admin approves it (ACTIVE). Rejected credits (REJECTED) never count.
  // Calculated credit by actual working hours, highest threshold first. Below the lowest threshold the
  // calculated credit is 0 and an admin must explicitly override to credit anything.
  SPECIAL_SHIFT_CREDIT_RULES: [
    { minHours: 6, days: 1 },
    { minHours: 4, days: 0.5 }
  ],
  // Most a single Sunday/holiday shift can be credited, even with an override.
  SPECIAL_SHIFT_MAX_DAYS: 1,
  // Shifts are evaluated automatically from this month on. Earlier months are register history
  // (Excel import / typed in), where an automatic credit would count the same Sunday twice.
  SPECIAL_SHIFT_AUTO_START_MONTH: '2026-10',
  // Who may see the review list, and who may approve or reject. Nobody may approve their own shift.
  SPECIAL_SHIFT_VIEW_ROLES: ['ADMIN', 'SUPER_ADMIN', 'HR', 'HR_ADMIN', 'MANAGER', 'TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER'],
  SPECIAL_SHIFT_VERIFY_ROLES: ['ADMIN', 'SUPER_ADMIN'],
  // Payroll run statuses that close a month: approvals in that month are refused (rejections still allowed,
  // they change no balance). 'PAID' is the existing "released and locked" state.
  SPECIAL_SHIFT_LOCKED_PAYROLL_STATUSES: ['PAID']
};
