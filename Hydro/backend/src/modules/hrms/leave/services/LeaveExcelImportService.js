const crypto = require('crypto');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const sequelize = require('../../../../config/database');
const Employee = require('../../../../shared/models/Employee');
const LeaveAdjustment = require('../../../../shared/models/LeaveAdjustment');
const policy = require('../../../../core/config/leavePolicy');
const LeaveBalanceService = require('./LeaveBalanceService');

/**
 * Imports the "EL and Sunday working" Excel sheet into the leave ledger.
 *
 * Layout is detected from the sheet, not hard-coded: the header row is the one containing "Emp code";
 * each section (EARNED LEAVES / SUNDAY-HOLIDAY WORKING) is a run of columns
 * [Remaining from <year>] [month columns...] [Left Leaves] [Remarks], and its title is the merged cell above.
 *
 * Month cells are net values from the manual register (EL credited minus leave taken). Months before
 * LEDGER_START_MONTH are imported; later months are calculated live by the portal and are ignored.
 */

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const round2 = (n) => Math.round(n * 100) / 100;

class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function cellMonth(cell) {
  if (!cell) return null;
  if (cell.t === 'n' && cell.v > 20000 && cell.v < 80000) {
    const d = XLSX.SSF.parse_date_code(cell.v);
    return d ? { year: d.y, month: d.m } : null;
  }
  const s = String(cell.w || cell.v || '').trim().toLowerCase();
  const m = s.match(/^([a-z]{3})[a-z]*[\s\-/']*(\d{2}|\d{4})$/);
  if (!m || !MONTH_ABBR.includes(m[1])) return null;
  const y = Number(m[2]);
  return { year: y < 100 ? 2000 + y : y, month: MONTH_ABBR.indexOf(m[1]) + 1 };
}

function parseNumber(cell) {
  if (!cell || cell.v === null || cell.v === undefined || String(cell.v).trim() === '') return { value: null };
  const v = Number(cell.v);
  return Number.isFinite(v) ? { value: v } : { value: null, error: `"${cell.v}" is not a number` };
}

function parseWorkbook(buffer) {
  let wb;
  try { wb = XLSX.read(buffer, { type: 'buffer' }); } catch { throw new ImportError('The file could not be read as an Excel workbook.'); }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) throw new ImportError('The first sheet is empty.');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const at = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const text = (r, c) => String(at(r, c)?.v ?? '').trim();

  // Header row = the row with an "Emp code" cell.
  let headerRow = -1;
  let codeCol = -1;
  for (let r = range.s.r; r <= Math.min(range.e.r, 20) && headerRow < 0; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) if (/^emp\.?\s*code$/i.test(text(r, c))) { headerRow = r; codeCol = c; break; }
  }
  if (headerRow < 0) throw new ImportError('Could not find the header row (a column named "Emp code").');
  const findCol = (re) => { for (let c = range.s.c; c <= range.e.c; c++) if (re.test(text(headerRow, c))) return c; return -1; };
  const nameCol = findCol(/staff\s*name|employee\s*name|^name$/i);

  // Sections: each starts at a "Remaining from" column (or its first month column).
  const sections = [];
  let current = null;
  for (let c = codeCol + 1; c <= range.e.c; c++) {
    const h = text(headerRow, c);
    const month = cellMonth(at(headerRow, c));
    if (/^remaining\s*from/i.test(h)) { current = { carryCol: c, months: [], leftCol: -1, remarksCol: -1 }; sections.push(current); continue; }
    if (month) {
      if (!current || current.leftCol >= 0) { current = { carryCol: -1, months: [], leftCol: -1, remarksCol: -1 }; sections.push(current); }
      current.months.push({ col: c, ...month });
      continue;
    }
    if (current && /^left/i.test(h)) current.leftCol = c;
    else if (current && /^remark/i.test(h)) current.remarksCol = c;
  }
  // Section titles come from merged/plain cells in the rows above the header.
  const titleFor = (sec) => {
    const cols = [sec.carryCol, ...sec.months.map((m) => m.col), sec.leftCol].filter((c) => c >= 0);
    for (let r = headerRow - 1; r >= Math.max(0, headerRow - 3); r--) {
      for (const mg of ws['!merges'] || []) {
        if (mg.s.r <= r && mg.e.r >= r && cols.some((c) => c >= mg.s.c && c <= mg.e.c)) {
          const t = text(mg.s.r, mg.s.c);
          if (t) return t;
        }
      }
      for (const c of cols) if (text(r, c)) return text(r, c);
    }
    return '';
  };
  let el = null;
  let special = null;
  for (const s of sections) {
    const title = titleFor(s).toLowerCase();
    if (!el && /earned/.test(title)) el = s;
    else if (!special && /(sunday|holiday)/.test(title)) special = s;
  }
  if (!el) throw new ImportError('Could not find the "EARNED LEAVES" section.');

  const rows = [];
  const errors = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const code = text(r, codeCol);
    if (!code) continue;
    const readSection = (sec) => {
      if (!sec) return null;
      const out = { carry: null, months: [], left: null, remarks: null };
      const read = (c, label) => {
        const p = parseNumber(at(r, c));
        if (p.error) errors.push({ row: r + 1, code, message: `${label}: ${p.error}` });
        return p.value;
      };
      if (sec.carryCol >= 0) out.carry = read(sec.carryCol, 'Remaining from previous year');
      for (const m of sec.months) out.months.push({ year: m.year, month: m.month, value: read(m.col, `${MONTH_ABBR[m.month - 1]}-${m.year}`) });
      if (sec.leftCol >= 0) out.left = read(sec.leftCol, 'Left Leaves');
      if (sec.remarksCol >= 0) out.remarks = text(r, sec.remarksCol) || null;
      return out;
    };
    rows.push({ rowNumber: r + 1, code, name: nameCol >= 0 ? text(r, nameCol) : '', el: readSection(el), special: readSection(special) });
  }
  if (!rows.length) throw new ImportError('No employee rows found under the header.');
  return { rows, errors, hasSpecialSection: !!special };
}

/** Builds a preview: matches rows to employees and compares imported totals with the current ledger. */
async function buildPlan(buffer, fileName) {
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const parsed = parseWorkbook(buffer);
  const ledgerStart = LeaveBalanceService.parseLedgerStart();
  const migrationStart = LeaveBalanceService.parseMonthSetting(policy.MIGRATION_START_MONTH);
  const year = new Date().getFullYear();

  const employees = await Employee.findAll();
  const byCode = new Map();
  const byName = new Map();
  for (const e of employees) {
    if (e.empCode) byCode.set(norm(e.empCode), e);
    byCode.set(norm(e.id), e);
    if (e.name) {
      const k = norm(e.name);
      byName.set(k, byName.has(k) ? 'AMBIGUOUS' : e);
    }
  }

  const warnings = [...parsed.errors.map((e) => ({ row: e.row, code: e.code, message: e.message }))];
  const items = [];
  const unmatched = [];
  const skipped = [];
  const seen = new Set();

  for (const row of parsed.rows) {
    let emp = byCode.get(norm(row.code));
    let matchedBy = 'code';
    if (!emp) {
      const byN = row.name ? byName.get(norm(row.name)) : null;
      if (byN && byN !== 'AMBIGUOUS') { emp = byN; matchedBy = 'name'; }
    }
    if (!emp) { unmatched.push({ row: row.rowNumber, code: row.code, name: row.name }); continue; }
    if (seen.has(emp.id)) { warnings.push({ row: row.rowNumber, code: row.code, message: `${emp.empCode || emp.id} appears more than once; only the first row is imported.` }); continue; }
    seen.add(emp.id);
    if (matchedBy === 'name') warnings.push({ row: row.rowNumber, code: row.code, message: `Code "${row.code}" not found; matched by name to ${emp.empCode} ${emp.name}.` });

    // The sheet's monthly cells are what was LEFT of each month's leave. That only fits an employee
    // without history yet; for anyone whose months were already entered (earned, consumed, Sun/Hol),
    // writing these would mix two different ways of recording and break the balance.
    const current = await LeaveBalanceService.getEmployeeMonthlyLedger(emp, year, { withContext: false });
    if (current.migrationActive) {
      skipped.push({ row: row.rowNumber, employeeId: emp.id, empCode: emp.empCode || emp.id, name: emp.name });
      continue;
    }

    const entries = [];
    const sum = (sec) => (sec ? (sec.carry || 0) + sec.months.reduce((s, m) => s + (m.value || 0), 0) : 0);
    for (const [kind, sec] of [['MIGRATION_EARNED', row.el], ['MIGRATION_SPECIAL', row.special]]) {
      if (!sec) continue;
      if (sec.left !== null && round2(sum(sec)) !== round2(sec.left)) {
        warnings.push({ row: row.rowNumber, code: row.code, message: `${kind === 'MIGRATION_EARNED' ? 'EL' : 'Sunday'} "Left Leaves" (${sec.left}) does not equal the sum of the row (${round2(sum(sec))}). Monthly values are imported.` });
      }
      for (const m of sec.months) {
        if (m.value === null) continue;
        const idx = LeaveBalanceService.monthIndex(m.year, m.month);
        if (idx >= ledgerStart.index) {
          const expected = kind === 'MIGRATION_EARNED' ? policy.EARNED_LEAVE_PER_MONTH : 0;
          if (m.value !== expected) warnings.push({ row: row.rowNumber, code: row.code, message: `${MONTH_ABBR[m.month - 1]}-${m.year} = ${m.value} ignored: from ${policy.LEDGER_START_MONTH} the portal calculates this month from approved leave.` });
          continue;
        }
        if (idx < migrationStart.index) {
          warnings.push({ row: row.rowNumber, code: row.code, message: `${MONTH_ABBR[m.month - 1]}-${m.year} ignored: before the migration period (${policy.MIGRATION_START_MONTH}). Put it in "Remaining from" instead.` });
          continue;
        }
        if (m.value < 0) { warnings.push({ row: row.rowNumber, code: row.code, message: `${MONTH_ABBR[m.month - 1]}-${m.year} is negative (${m.value}); imported as is.` }); }
        entries.push({ type: kind, year: m.year, month: m.month, days: m.value });
      }
    }
    // Always written (even 0) so every matched employee belongs to the batch and their older opening rows are superseded.
    const carry = round2((row.el?.carry || 0) + (row.special?.carry || 0));
    entries.push({ type: 'MIGRATION_CARRY_FORWARD', year: null, month: null, days: carry });

    const importedTotal = round2(entries.reduce((s, e) => s + e.days, 0));
    const preLedgerCurrent = current.balanceAtLedgerStart; // balance carried into the ledger start today (opening or migration history)
    items.push({
      row: row.rowNumber,
      sheetCode: row.code,
      sheetName: row.name,
      employeeId: emp.id,
      empCode: emp.empCode || emp.id,
      name: emp.name,
      matchedBy,
      entries,
      importedEl: round2(entries.filter((e) => e.type === 'MIGRATION_EARNED').reduce((s, e) => s + e.days, 0)),
      importedSpecial: round2(entries.filter((e) => e.type === 'MIGRATION_SPECIAL').reduce((s, e) => s + e.days, 0)),
      importedCarry: carry,
      importedTotal,
      currentOpening: preLedgerCurrent,
      currentAvailable: current.availableBalance,
      newAvailable: round2(current.availableBalance - preLedgerCurrent + importedTotal),
      difference: round2(importedTotal - preLedgerCurrent)
    });
  }

  const notInSheet = employees
    .filter((e) => e.status === 'ACTIVE' && !e.isSystemAccount && !seen.has(e.id))
    .map((e) => ({ employeeId: e.id, empCode: e.empCode || e.id, name: e.name }));

  const previous = await LeaveAdjustment.findOne({ where: { adjustmentType: { [Op.in]: LeaveBalanceService.MIGRATION_TYPES }, reason: { [Op.like]: `%sha256:${fileHash.slice(0, 16)}%` } } });

  return {
    fileName,
    fileHash,
    ledgerStartMonth: policy.LEDGER_START_MONTH,
    alreadyImported: !!previous,
    items,
    skipped, // already have history in the portal: not changed by an import
    unmatched,
    notInSheet,
    warnings,
    blockingErrors: parsed.errors.length
  };
}

/** Writes the plan in one transaction. Every row of the batch shares relatedAdjustmentId = batchId. */
async function applyImport(buffer, fileName, expectedHash, actor) {
  const plan = await buildPlan(buffer, fileName);
  if (expectedHash && expectedHash !== plan.fileHash) throw new ImportError('The file changed since the preview. Preview it again.', 409);
  if (plan.blockingErrors) throw new ImportError('The sheet has cells that are not numbers. Fix them and preview again.');
  if (plan.alreadyImported) return { duplicate: true, plan };

  const batchId = uuidv4();
  const tag = `sha256:${plan.fileHash.slice(0, 16)}`;
  let rowsWritten = 0;
  await sequelize.transaction(async (transaction) => {
    for (const item of plan.items) {
      for (const e of item.entries) {
        await LeaveAdjustment.create({
          employeeId: item.employeeId,
          empCode: item.empCode,
          employeeName: item.name,
          leaveType: e.type === 'MIGRATION_SPECIAL' ? 'Special Earned Leave' : 'Earned Leave',
          adjustmentType: e.type,
          days: e.days,
          year: e.year,
          month: e.month,
          effectiveDate: e.year ? `${e.year}-${String(e.month).padStart(2, '0')}-01` : null,
          relatedAdjustmentId: batchId,
          reason: `Imported from Excel "${fileName}" row ${item.row} (${tag})`,
          adjustedBy: actor,
          status: 'ACTIVE'
        }, { transaction });
        rowsWritten++;
      }
    }
  });
  return { duplicate: false, batchId, rowsWritten, plan };
}

module.exports = { parseWorkbook, buildPlan, applyImport, ImportError };
