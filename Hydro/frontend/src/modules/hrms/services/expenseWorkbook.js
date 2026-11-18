// Builds the Expenses Excel report: a "Summary" page, an "Expense Register"
// and one statement per employee. Pure (no React / browser APIs) so it can be
// exercised directly in Node.
//
// Filtering works without macros: every report table is a formula-driven
// list. Each record exists once, on a very-hidden "Data" sheet, with a Match
// flag (does it satisfy that page's yellow filter cells?) and a running Cum
// count of matches; visible row k shows the record where Cum first reaches k
// (MATCH(k, Cum, 0)). Records that don't match never get pulled into the
// visible table, and no page carries hidden or duplicated columns. Only Excel
// 2007-era functions are used (INDEX/MATCH/IFERROR/SUMIFS/COUNTIFS), so it
// works in Excel 2013+.

export const PETROL_CATEGORY = 'Petrol and diesel';
const ADVANCE_CATEGORY = 'Advance / Payment';
// Excel serial for 01-Jan-10000 — used as "no upper bound" when To Date is blank.
const NO_UPPER_DATE = 2958466;

const ROW = { company: 1, title: 2, subtitle: 3, filterBar: 4, filter1: 5, filter2: 6, kpiBar: 7, kpiLabel: 8, kpiValue: 9, spacer: 10, header: 11 };

const COLOR = {
    navy: 'FF1F3864',
    white: 'FFFFFFFF',
    text: 'FF1F2937',
    muted: 'FF595959',
    grid: 'FFD0D7E2',
    band: 'FFF3F6FA',
    section: 'FFD9E1F2',
    kpi: 'FFEAF0F8',
    input: 'FFFFF2CC',
    inputBorder: 'FFBF9000',
    link: 'FF1F4E9E',
    green: 'FF107C41',
    amber: 'FF9C6500',
    red: 'FFC00000'
};

const FMT = {
    money: '"₹"#,##0.00;[Red]-"₹"#,##0.00;"-"',
    count: '#,##0;-#,##0;"-"',
    km: '#,##0.0" km";-#,##0.0" km";"-"',
    date: 'dd-mmm-yyyy',
    datetime: 'dd-mmm-yyyy hh:mm'
};

const FONT = 'Calibri';

// ── small utilities ─────────────────────────────────────────────────────────

const colL = (n) => {
    let s = '';
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
};
const colN = (letters) => letters.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
const abs = (addr) => addr.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');

const toDate = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
};
// Date-only, built from UTC parts: ExcelJS converts a Date to a serial purely
// from getTime(), so a local-time constructor would shift the stored day by the
// browser's UTC offset (e.g. one day early in IST).
const utcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const txt = (v) => (v === null || v === undefined || String(v).trim() === '' ? '-' : String(v));
const fmtBillDate = (billDate) => {
    if (!billDate) return '-';
    return String(billDate).includes('T') ? new Date(billDate).toLocaleDateString('en-GB') : String(billDate);
};
const escSheetRef = (s) => String(s).replace(/'/g, "''");
const sumBy = (arr, fn) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
const fmtStamp = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${pad(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const thin = (argb) => ({ style: 'thin', color: { argb } });
const box = (argb) => ({ top: thin(argb), left: thin(argb), bottom: thin(argb), right: thin(argb) });

// Applies a style to every cell of a range — merged cells draw their borders
// from each underlying cell, so styling only the top-left one leaves gaps.
const styleRange = (ws, range, style) => {
    const [a, b = a] = range.split(':');
    const [, c1, r1] = a.match(/^([A-Z]+)(\d+)$/);
    const [, c2, r2] = b.match(/^([A-Z]+)(\d+)$/);
    for (let r = Number(r1); r <= Number(r2); r++) {
        for (let c = colN(c1); c <= colN(c2); c++) {
            const cell = ws.getCell(r, c);
            Object.entries(style).forEach(([k, v]) => { cell[k] = v; });
        }
    }
};
const mergeIfRange = (ws, range) => { if (range.includes(':')) ws.mergeCells(range); };

// ── shared page furniture ───────────────────────────────────────────────────

function scaffold(ws, { widths, company, title, subtitle, backLinkCols, tabColor }) {
    ws.properties.tabColor = { argb: tabColor };
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const last = colL(widths.length);
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: ROW.header, showGridLines: false, zoomScale: 90 }];

    const bar = (row, text, fill, font) => {
        const range = `A${row}:${last}${row}`;
        ws.mergeCells(range);
        const c = ws.getCell(`A${row}`);
        c.value = text;
        c.font = font;
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (fill) styleRange(ws, range, { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } } });
    };

    bar(ROW.company, company, null, { name: FONT, size: 16, bold: true, color: { argb: COLOR.navy } });
    ws.getRow(ROW.company).height = 26;
    bar(ROW.title, title, null, { name: FONT, size: 12.5, bold: true, color: { argb: COLOR.text } });
    ws.getRow(ROW.title).height = 20;

    const subtitleEnd = backLinkCols ? colL(colN(backLinkCols.split(':')[0]) - 1) : last;
    ws.mergeCells(`A${ROW.subtitle}:${subtitleEnd}${ROW.subtitle}`);
    const sub = ws.getCell(`A${ROW.subtitle}`);
    sub.value = subtitle;
    sub.font = { name: FONT, size: 9, italic: true, color: { argb: COLOR.muted } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    if (backLinkCols) {
        const [b1, b2] = backLinkCols.split(':');
        mergeIfRange(ws, `${b1}${ROW.subtitle}:${b2}${ROW.subtitle}`);
        const link = ws.getCell(`${b1}${ROW.subtitle}`);
        link.value = { formula: 'HYPERLINK("#\'Summary\'!A1","◀  Back to Summary")', result: '◀  Back to Summary' };
        link.font = { name: FONT, size: 9.5, bold: true, underline: true, color: { argb: COLOR.link } };
        link.alignment = { vertical: 'middle', horizontal: 'right' };
    }
    ws.getRow(ROW.subtitle).height = 18;

    const sectionFont = { name: FONT, size: 9, bold: true, color: { argb: COLOR.navy } };
    bar(ROW.filterBar, 'FILTERS', COLOR.section, sectionFont);
    ws.getRow(ROW.filterBar).height = 18;
    ws.getRow(ROW.filter1).height = 21;
    ws.getRow(ROW.filter2).height = 21;

    bar(ROW.kpiBar, 'KEY FIGURES', COLOR.section, sectionFont);
    ws.getRow(ROW.kpiBar).height = 18;
    ws.getRow(ROW.kpiLabel).height = 18;
    ws.getRow(ROW.kpiValue).height = 26;
    ws.getRow(ROW.spacer).height = 8;

    ws.pageSetup = {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: `${ROW.header}:${ROW.header}`,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.3 }
    };
    ws.headerFooter = { oddFooter: `&L&8${company}&C&8Page &P of &N&R&8Printed &D` };
    return last;
}

function filterInput(ws, { labelCols, inputCols, row, label, value, numFmt, validation }) {
    const [l1, l2 = l1] = labelCols.split(':');
    mergeIfRange(ws, `${l1}${row}:${l2}${row}`);
    const lc = ws.getCell(`${l1}${row}`);
    lc.value = label;
    lc.font = { name: FONT, size: 9.5, bold: true, color: { argb: COLOR.muted } };
    lc.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };

    const [i1, i2 = i1] = inputCols.split(':');
    const range = `${i1}${row}:${i2}${row}`;
    mergeIfRange(ws, range);
    styleRange(ws, range, {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.input } },
        border: box(COLOR.inputBorder)
    });
    const ic = ws.getCell(`${i1}${row}`);
    ic.value = value;
    ic.font = { name: FONT, size: 10, bold: true, color: { argb: COLOR.text } };
    ic.alignment = { vertical: 'middle', horizontal: 'center' };
    if (numFmt) ic.numFmt = numFmt;
    ic.dataValidation = validation;
    return abs(`${i1}${row}`);
}

const dateValidation = {
    type: 'date', operator: 'between', allowBlank: true,
    formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2099, 11, 31))],
    showErrorMessage: true, errorTitle: 'Invalid date', error: 'Enter a valid date, e.g. 25-09-2026.'
};
const listValidation = (name) => ({
    type: 'list', allowBlank: false, formulae: [name],
    showErrorMessage: true, errorTitle: 'Pick from the list', error: 'Choose a value from the drop-down.'
});

function kpi(ws, { cols, label, formula, result, numFmt, color = COLOR.navy }) {
    const [c1, c2 = c1] = cols.split(':');
    const labelRange = `${c1}${ROW.kpiLabel}:${c2}${ROW.kpiLabel}`;
    const valueRange = `${c1}${ROW.kpiValue}:${c2}${ROW.kpiValue}`;
    mergeIfRange(ws, labelRange);
    mergeIfRange(ws, valueRange);
    const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.kpi } };
    styleRange(ws, labelRange, { fill, border: { top: thin(COLOR.grid), left: thin(COLOR.grid), right: thin(COLOR.grid) } });
    styleRange(ws, valueRange, { fill, border: { bottom: thin(COLOR.grid), left: thin(COLOR.grid), right: thin(COLOR.grid) } });

    const lc = ws.getCell(`${c1}${ROW.kpiLabel}`);
    lc.value = label;
    lc.font = { name: FONT, size: 8.5, bold: true, color: { argb: COLOR.muted } };
    lc.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    const vc = ws.getCell(`${c1}${ROW.kpiValue}`);
    vc.value = { formula, result };
    vc.numFmt = numFmt;
    vc.font = { name: FONT, size: 12, bold: true, color: { argb: color } };
    vc.alignment = { vertical: 'middle', horizontal: 'center' };
    return abs(`${c1}${ROW.kpiValue}`);
}

function headerRow(ws, row, labels, startCol = 1) {
    labels.forEach((label, i) => {
        const c = ws.getCell(row, startCol + i);
        c.value = label;
        c.font = { name: FONT, size: 9.5, bold: true, color: { argb: COLOR.white } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        c.border = box(COLOR.white);
    });
    ws.getRow(row).height = 32;
}

// Formula-driven visible table. Row k shows the source row whose running
// match count first reaches k; `columns[i].expr(idx, r, k)` builds the cell's
// expression from that index expression. When fewer than k rows match, MATCH
// fails and IFERROR leaves the row blank. `matched` = how many rows the
// default filters select, so the cached results mirror what Excel computes.
function dynamicRows(ws, { firstRow, count, matched = count, cumRange, columns, lastCol }) {
    for (let k = 1; k <= count; k++) {
        const r = firstRow + k - 1;
        const idx = `MATCH(${k},${cumRange},0)`;
        const filled = k <= matched;
        columns.forEach((col) => {
            const cell = ws.getCell(`${col.col}${r}`);
            cell.value = { formula: `IFERROR(${col.expr(idx, r, k)},"")`, result: filled ? col.result(k) : '' };
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.font = col.font || { name: FONT, size: 9.5, color: { argb: COLOR.text } };
            cell.alignment = { vertical: 'middle', horizontal: col.align || 'left', wrapText: !!col.wrap };
            cell.border = { bottom: thin(COLOR.grid) };
        });
        ws.getRow(r).height = 18;
    }
    if (count > 0) {
        const lastRow = firstRow + count - 1;
        ws.addConditionalFormatting({
            ref: `A${firstRow}:${lastCol}${lastRow}`,
            rules: [{
                type: 'expression',
                formulae: [`AND($A${firstRow}<>"",MOD(ROW(),2)=0)`],
                style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLOR.band } } }
            }]
        });
    }
}

const serialNo = (k) => (idx) => `IF(ISNUMBER(${idx}),${k},"")`;

function statusColouring(ws, ref, firstCell) {
    ws.addConditionalFormatting({
        ref,
        rules: [
            { type: 'expression', formulae: [`${firstCell}="APPROVED"`], style: { font: { bold: true, color: { argb: COLOR.green } } } },
            { type: 'expression', formulae: [`${firstCell}="PENDING"`], style: { font: { bold: true, color: { argb: COLOR.amber } } } },
            { type: 'expression', formulae: [`${firstCell}="REJECTED"`], style: { font: { bold: true, color: { argb: COLOR.red } } } }
        ]
    });
}

// Lays out a table of named columns on the hidden Data sheet, starting at
// `startCol`, and returns key → column letter plus a range builder.
function dataTable(data, startCol, keys, labels) {
    const col = {};
    keys.forEach((key, i) => {
        col[key] = colL(startCol + i);
        const c = data.getCell(1, startCol + i);
        c.value = labels[i];
        c.font = { name: FONT, size: 9, bold: true };
    });
    return {
        col,
        nextCol: startCol + keys.length + 1,
        range: (key, from, to) => `Data!$${col[key]}$${from}:$${col[key]}$${to}`
    };
}

// ── data preparation ────────────────────────────────────────────────────────

function uniqueSheetTitle(raw, used) {
    let clean = String(raw).replace(/[\\/?*[\]:"]/g, '_').replace(/^'+|'+$/g, '').trim();
    if (clean.length > 31) clean = clean.substring(0, 31).trim();
    if (!clean) clean = 'Employee';
    let title = clean;
    let n = 1;
    while (used.has(title.toLowerCase())) {
        const suffix = `_${n++}`;
        title = clean.substring(0, 31 - suffix.length) + suffix;
    }
    used.add(title.toLowerCase());
    return title;
}

function buildLedgerRows(items, payments, hrmsKmById, resolveInvoiceUrl, isPetrol) {
    const rows = [];
    items.forEach((exp) => {
        const status = String(exp.status || 'pending').toUpperCase();
        const amount = Number(exp.amount || 0);
        const billNo = txt(exp.billNo);
        rows.push({
            date: toDate(exp.createdAt) || new Date(0),
            type: 'Expense',
            category: exp.category || 'General',
            paidToFrom: txt(exp.merchantName || exp.siteName),
            incurred: amount,
            received: 0,
            effect: status === 'APPROVED' ? amount : 0,
            remark: txt(exp.description),
            billYN: billNo !== '-' ? 'Y' : 'N',
            billNo,
            billDate: fmtBillDate(exp.billDate),
            hrmsKm: isPetrol(exp.category) ? (hrmsKmById.get(exp.id) ?? 0) : 0,
            site: txt(exp.siteName),
            status,
            url: txt(resolveInvoiceUrl(exp))
        });
    });
    payments.forEach((p) => {
        const amount = Number(p.amount || 0);
        rows.push({
            date: toDate(p.date) || new Date(0),
            type: 'Advance',
            category: ADVANCE_CATEGORY,
            paidToFrom: txt(p.description),
            incurred: 0,
            received: amount,
            effect: -amount,
            remark: '-',
            billYN: '-',
            billNo: '-',
            billDate: '-',
            hrmsKm: 0,
            site: '-',
            status: '-',
            url: '-'
        });
    });
    rows.sort((a, b) => a.date - b.date);
    let balance = 0;
    rows.forEach((r) => { balance += r.effect; r.balance = balance; });
    return rows;
}

function dateBounds(dates) {
    const valid = dates.filter(Boolean);
    if (valid.length === 0) {
        const today = utcDay(new Date());
        return { min: today, max: today };
    }
    let min = valid[0];
    let max = valid[0];
    valid.forEach((d) => { if (d < min) min = d; if (d > max) max = d; });
    return { min: utcDay(min), max: utcDay(max) };
}

const sheetRef = (ws) => `'${escSheetRef(ws.name)}'`;

// ── workbook ────────────────────────────────────────────────────────────────

export async function buildExpenseWorkbook({
    ExcelJS,
    expenses,
    resolveEmployee,
    resolveInvoiceUrl,
    fetchLedgerExtras,
    categories = [],
    // Category names that count as fuel claims for the KM columns (servers name it differently)
    petrolCategories = [PETROL_CATEGORY],
    companyName = 'HYDROMATERIALS PRIVATE LIMITED',
    now = new Date()
}) {
    const isPetrol = (category) => petrolCategories.includes(category);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Hydro HRMS';
    workbook.created = now;
    // Every formula also carries a cached result, but force a full recalc on
    // open as well so nothing depends on Excel deciding to recalculate.
    workbook.calcProperties.fullCalcOnLoad = true;
    const stamp = fmtStamp(now);

    // Group expenses by employee (alphabetical, like a ledger index).
    const groupsByKey = new Map();
    expenses.forEach((exp) => {
        const info = resolveEmployee(exp);
        const key = String(info.empCode || info.empName || 'Unknown').trim();
        if (!groupsByKey.has(key)) {
            groupsByKey.set(key, { name: info.empName, code: info.empCode, location: info.location, empStatus: info.empStatus, items: [] });
        }
        groupsByKey.get(key).items.push(exp);
    });
    const groups = [...groupsByKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    // Advance/payment entries and petrol km windows, fetched in parallel.
    await Promise.all(groups.map(async (g) => {
        const petrol = g.items
            .filter((e) => isPetrol(e.category))
            .map((e) => {
                const d = toDate(e.billDate) || toDate(e.createdAt);
                return { id: e.id, ymd: d ? d.toISOString().split('T')[0] : null };
            })
            .filter((e) => e.ymd)
            .sort((a, b) => a.ymd.localeCompare(b.ymd));
        let extras = { payments: [], hrmsKm: petrol.map(() => null) };
        try {
            extras = (await fetchLedgerExtras(g.code, petrol.map((p) => p.ymd))) || extras;
        } catch (err) {
            console.error(`Ledger data unavailable for ${g.name}; continuing without it.`, err);
        }
        const kmById = new Map();
        petrol.forEach((p, i) => kmById.set(p.id, extras.hrmsKm?.[i] ?? null));
        g.payments = extras.payments || [];
        g.rows = buildLedgerRows(g.items, g.payments, kmById, resolveInvoiceUrl, isPetrol);
    }));

    const used = new Set(['summary', 'expense register', 'data']);
    groups.forEach((g) => {
        g.sheetTitle = uniqueSheetTitle(g.code && g.code !== '-' ? `${g.name} (${g.code})` : g.name, used);
    });

    // Category lists: the standard taxonomy first, then anything else in the data.
    const seen = new Set(categories);
    const extraCats = [...new Set(expenses.map((e) => e.category || 'General'))].filter((c) => !seen.has(c)).sort();
    const allCategories = [...categories, ...extraCats];

    // Sheets in tab order. "Data" holds the one copy of every record that the
    // report pages read from; it's very-hidden, so it never appears as a tab.
    const wsSummary = workbook.addWorksheet('Summary');
    const wsRegister = workbook.addWorksheet('Expense Register');
    groups.forEach((g) => { g.ws = workbook.addWorksheet(g.sheetTitle); });
    const data = workbook.addWorksheet('Data', { state: 'veryHidden' });

    const allDates = [
        ...expenses.map((e) => toDate(e.createdAt)),
        ...groups.flatMap((g) => g.payments.map((p) => toDate(p.date)))
    ];
    const globalRange = dateBounds(allDates);

    // ── Data: ledger transactions of every employee, one block per employee ──
    const LD = dataTable(data, 1,
        ['emp', 'date', 'type', 'cat', 'party', 'incurred', 'received', 'effect', 'remark', 'billYN', 'billNo', 'billDate', 'hrms', 'gps', 'site', 'status', 'url', 'match', 'cum'],
        ['Employee', 'Date', 'Type', 'Category', 'Paid To / From', 'Incurred', 'Received', 'Balance Effect', 'Remark', 'Bill Y/N', 'Bill No', 'Bill Date', 'HRMS KM', 'GPS KM', 'Site', 'Status', 'Invoice URL', 'Match', 'Cum']);
    let nextDataRow = 2;
    groups.forEach((g) => {
        g.dFirst = nextDataRow;
        g.dLast = nextDataRow + Math.max(g.rows.length, 1) - 1;
        nextDataRow = g.dLast + 1;
    });
    const DATA_START_TWO = LD.nextCol;

    // ── Employee statements ──
    const LEDGER_HEAD = ROW.header;
    const OPENING_ROW = LEDGER_HEAD + 1;
    const LEDGER_FIRST = LEDGER_HEAD + 2;
    groups.forEach((g) => {
        const ws = g.ws;
        const rows = g.rows;
        const n = rows.length;
        const range = dateBounds(rows.map((r) => r.date));
        const q = sheetRef(ws);

        const lastCol = scaffold(ws, {
            widths: [6, 17, 20, 24, 15, 15, 16, 26, 8, 13, 12, 11, 11, 16, 11, 11],
            company: companyName,
            title: `Employee Expense Statement  —  ${g.name}`,
            subtitle: `Employee Code: ${txt(g.code)}   |   Location: ${txt(g.location)}   |   Status: ${txt(g.empStatus)}`,
            backLinkCols: 'N:P',
            tabColor: 'FF8EA9DB'
        });

        const from = filterInput(ws, { labelCols: 'B', inputCols: 'C', row: ROW.filter1, label: 'From Date', value: range.min, numFmt: FMT.date, validation: dateValidation });
        const to = filterInput(ws, { labelCols: 'D', inputCols: 'E', row: ROW.filter1, label: 'To Date', value: range.max, numFmt: FMT.date, validation: dateValidation });
        const st = filterInput(ws, { labelCols: 'B', inputCols: 'C', row: ROW.filter2, label: 'Status', value: 'All', validation: listValidation('StatusList') });
        const cat = filterInput(ws, { labelCols: 'D', inputCols: 'E:F', row: ROW.filter2, label: 'Category', value: 'All', validation: listValidation('LedgerCategoryList') });

        // Filter expressions as seen from this sheet, and as seen from Data.
        const fromLocal = `IF(${from}="",0,${from})`;
        const toLocal = `IF(${to}="",${NO_UPPER_DATE},${to}+1)`;
        const fromQ = `IF(${q}!${from}="",0,${q}!${from})`;
        const toQ = `IF(${q}!${to}="",${NO_UPPER_DATE},${q}!${to}+1)`;
        const s = (key) => LD.range(key, g.dFirst, g.dLast);

        rows.forEach((row, i) => {
            const r = g.dFirst + i;
            const set = (key, value, numFmt) => {
                const c = data.getCell(`${LD.col[key]}${r}`);
                c.value = value;
                if (numFmt) c.numFmt = numFmt;
            };
            set('emp', ws.name);
            set('date', row.date, FMT.datetime);
            set('type', row.type);
            set('cat', row.category);
            set('party', row.paidToFrom);
            set('incurred', row.incurred);
            set('received', row.received);
            set('effect', row.effect);
            set('remark', row.remark);
            set('billYN', row.billYN);
            set('billNo', row.billNo);
            set('billDate', row.billDate);
            set('hrms', row.hrmsKm);
            set('gps', 0);
            set('site', row.site);
            set('status', row.status);
            set('url', row.url);
            const c = (key) => `$${LD.col[key]}${r}`;
            set('match', {
                formula: `IF(AND(${c('date')}>=${fromQ},${c('date')}<${toQ},OR(${q}!${cat}="All",${c('cat')}=${q}!${cat}),OR(${q}!${st}="All",${c('type')}="Advance",${c('status')}=${q}!${st})),1,0)`,
                result: 1
            });
            set('cum', { formula: i === 0 ? `${LD.col.match}${r}` : `${LD.col.cum}${r - 1}+${LD.col.match}${r}`, result: i + 1 });
        });

        const totalIncurred = sumBy(rows, (r) => r.incurred);
        const approved = sumBy(rows.filter((r) => r.status === 'APPROVED'), (r) => r.incurred);
        const advances = sumBy(rows, (r) => r.received);
        const closing = n ? rows[n - 1].balance : 0;
        kpi(ws, { cols: 'B', label: 'Balance b/f', formula: `$G$${OPENING_ROW}`, result: 0, numFmt: FMT.money });
        kpi(ws, { cols: 'C', label: 'Claims in Period', formula: `COUNTIFS(${s('match')},1,${s('type')},"Expense")`, result: rows.filter((r) => r.type === 'Expense').length, numFmt: FMT.count });
        kpi(ws, { cols: 'D', label: 'Expenses Claimed', formula: `SUMIFS(${s('incurred')},${s('match')},1)`, result: totalIncurred, numFmt: FMT.money });
        kpi(ws, { cols: 'E', label: 'Approved', formula: `SUMIFS(${s('incurred')},${s('match')},1,${s('status')},"APPROVED")`, result: approved, numFmt: FMT.money, color: COLOR.green });
        kpi(ws, { cols: 'F', label: 'Advances Received', formula: `SUMIFS(${s('received')},${s('match')},1)`, result: advances, numFmt: FMT.money });
        kpi(ws, { cols: 'G', label: 'Closing Balance (as at To Date)', formula: `SUMIFS(${s('effect')},${s('date')},"<"&${toLocal})`, result: closing, numFmt: FMT.money });
        kpi(ws, { cols: 'H', label: 'HRMS KM in Period', formula: `SUMIFS(${s('hrms')},${s('match')},1)`, result: sumBy(rows, (r) => r.hrmsKm), numFmt: FMT.km });

        headerRow(ws, LEDGER_HEAD, ['S.No.', 'Date', 'Expense Type', 'Paid To / Paid From', 'Expenses Incurred', 'Advance Received', 'Running Balance', 'Remark', 'Bill (Y/N)', 'Bill No', 'Actual Bill Date', 'KM (HRMS App)', 'KM (GPS)', 'Site Name', 'Work Status', 'Invoice']);

        ws.mergeCells(`B${OPENING_ROW}:F${OPENING_ROW}`);
        const obLabel = ws.getCell(`B${OPENING_ROW}`);
        obLabel.value = 'Balance brought forward';
        obLabel.font = { name: FONT, size: 9.5, bold: true, italic: true, color: { argb: COLOR.navy } };
        obLabel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        const obCell = ws.getCell(`G${OPENING_ROW}`);
        obCell.value = { formula: `SUMIFS(${s('effect')},${s('date')},"<"&${fromLocal})`, result: 0 };
        obCell.numFmt = FMT.money;
        obCell.font = { name: FONT, size: 9.5, bold: true, color: { argb: COLOR.navy } };
        styleRange(ws, `A${OPENING_ROW}:${lastCol}${OPENING_ROW}`, { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.kpi } }, border: { bottom: thin(COLOR.grid) } });
        ws.getRow(OPENING_ROW).height = 18;

        const at = (idx, key) => `INDEX(${s(key)},${idx})`;
        const link = { name: FONT, size: 9.5, underline: true, color: { argb: COLOR.link } };
        dynamicRows(ws, {
            firstRow: LEDGER_FIRST, count: n, cumRange: s('cum'), lastCol,
            columns: [
                { col: 'A', expr: (idx, _, k) => serialNo(k)(idx), result: (k) => k, align: 'center' },
                { col: 'B', expr: (idx) => at(idx, 'date'), result: (k) => rows[k - 1].date, numFmt: FMT.datetime, align: 'center' },
                { col: 'C', expr: (idx) => at(idx, 'cat'), result: (k) => rows[k - 1].category },
                { col: 'D', expr: (idx) => at(idx, 'party'), result: (k) => rows[k - 1].paidToFrom },
                { col: 'E', expr: (idx) => at(idx, 'incurred'), result: (k) => rows[k - 1].incurred, numFmt: FMT.money, align: 'right' },
                { col: 'F', expr: (idx) => at(idx, 'received'), result: (k) => rows[k - 1].received, numFmt: FMT.money, align: 'right' },
                {
                    col: 'G',
                    expr: (idx, r) => `G${r - 1}+${at(idx, 'effect')}`,
                    result: (k) => rows[k - 1].balance,
                    numFmt: FMT.money, align: 'right',
                    font: { name: FONT, size: 9.5, bold: true, color: { argb: COLOR.navy } }
                },
                { col: 'H', expr: (idx) => at(idx, 'remark'), result: (k) => rows[k - 1].remark },
                { col: 'I', expr: (idx) => at(idx, 'billYN'), result: (k) => rows[k - 1].billYN, align: 'center' },
                { col: 'J', expr: (idx) => at(idx, 'billNo'), result: (k) => rows[k - 1].billNo, align: 'center' },
                { col: 'K', expr: (idx) => at(idx, 'billDate'), result: (k) => rows[k - 1].billDate, align: 'center' },
                { col: 'L', expr: (idx) => at(idx, 'hrms'), result: (k) => rows[k - 1].hrmsKm, numFmt: FMT.km, align: 'right' },
                { col: 'M', expr: (idx) => at(idx, 'gps'), result: () => 0, numFmt: FMT.km, align: 'right' },
                { col: 'N', expr: (idx) => at(idx, 'site'), result: (k) => rows[k - 1].site },
                { col: 'O', expr: (idx) => at(idx, 'status'), result: (k) => rows[k - 1].status, align: 'center' },
                {
                    col: 'P',
                    expr: (idx) => `IF(${at(idx, 'url')}="-","-",HYPERLINK(${at(idx, 'url')},"View Bill"))`,
                    result: (k) => (rows[k - 1].url === '-' ? '-' : 'View Bill'),
                    align: 'center', font: link
                }
            ]
        });
        if (n > 0) statusColouring(ws, `O${LEDGER_FIRST}:O${LEDGER_FIRST + n - 1}`, `$O${LEDGER_FIRST}`);
        ws.autoFilter = { from: { row: LEDGER_HEAD, column: 1 }, to: { row: LEDGER_HEAD, column: 16 } };
    });

    // ── Expense Register ──
    {
        const ws = wsRegister;
        const q = sheetRef(ws);
        const RD = dataTable(data, DATA_START_TWO,
            ['date', 'emp', 'code', 'cat', 'desc', 'amount', 'status', 'billNo', 'billDate', 'site', 'merchant', 'url', 'match', 'cum'],
            ['Date', 'Employee', 'Code', 'Category', 'Description', 'Amount', 'Status', 'Bill No', 'Bill Date', 'Site', 'Merchant', 'Invoice URL', 'Match', 'Cum']);
        const records = expenses
            .map((exp) => {
                const info = resolveEmployee(exp);
                return {
                    date: toDate(exp.createdAt) || new Date(0),
                    emp: info.empName,
                    code: txt(info.empCode),
                    cat: exp.category || 'General',
                    desc: txt(exp.description),
                    amount: Number(exp.amount || 0),
                    status: String(exp.status || 'pending').toUpperCase(),
                    billNo: txt(exp.billNo),
                    billDate: fmtBillDate(exp.billDate),
                    site: txt(exp.siteName),
                    merchant: txt(exp.merchantName),
                    url: txt(resolveInvoiceUrl(exp))
                };
            })
            .sort((a, b) => a.date - b.date);
        const n = records.length;
        const dFirst = 2;
        const dLast = dFirst + Math.max(n, 1) - 1;
        const first = ROW.header + 1;

        const lastCol = scaffold(ws, {
            widths: [6, 17, 22, 10, 20, 30, 14, 11, 14, 13, 16, 20, 11],
            company: companyName,
            title: 'Expense Register  —  all claims',
            subtitle: `Generated: ${stamp}`,
            backLinkCols: 'K:M',
            tabColor: 'FF2E75B6'
        });

        const from = filterInput(ws, { labelCols: 'B', inputCols: 'C', row: ROW.filter1, label: 'From Date', value: globalRange.min, numFmt: FMT.date, validation: dateValidation });
        const to = filterInput(ws, { labelCols: 'D:E', inputCols: 'F', row: ROW.filter1, label: 'To Date', value: globalRange.max, numFmt: FMT.date, validation: dateValidation });
        const emp = filterInput(ws, { labelCols: 'G', inputCols: 'H:I', row: ROW.filter1, label: 'Employee', value: 'All', validation: listValidation('EmployeeList') });
        const st = filterInput(ws, { labelCols: 'B', inputCols: 'C', row: ROW.filter2, label: 'Status', value: 'All', validation: listValidation('StatusList') });
        const cat = filterInput(ws, { labelCols: 'D:E', inputCols: 'F', row: ROW.filter2, label: 'Category', value: 'All', validation: listValidation('CategoryList') });

        const fromQ = `IF(${q}!${from}="",0,${q}!${from})`;
        const toQ = `IF(${q}!${to}="",${NO_UPPER_DATE},${q}!${to}+1)`;
        const s = (key) => RD.range(key, dFirst, dLast);

        records.forEach((rec, i) => {
            const r = dFirst + i;
            ['date', 'emp', 'code', 'cat', 'desc', 'amount', 'status', 'billNo', 'billDate', 'site', 'merchant', 'url'].forEach((key) => {
                const c = data.getCell(`${RD.col[key]}${r}`);
                c.value = rec[key];
                if (key === 'date') c.numFmt = FMT.datetime;
            });
            const c = (key) => `$${RD.col[key]}${r}`;
            data.getCell(`${RD.col.match}${r}`).value = {
                formula: `IF(AND(${c('date')}>=${fromQ},${c('date')}<${toQ},OR(${q}!${st}="All",${c('status')}=${q}!${st}),OR(${q}!${cat}="All",${c('cat')}=${q}!${cat}),OR(${q}!${emp}="All",${c('emp')}=${q}!${emp})),1,0)`,
                result: 1
            };
            data.getCell(`${RD.col.cum}${r}`).value = { formula: i === 0 ? `${RD.col.match}${r}` : `${RD.col.cum}${r - 1}+${RD.col.match}${r}`, result: i + 1 };
        });

        const total = sumBy(records, (r) => r.amount);
        const byStatus = (status) => sumBy(records.filter((r) => r.status === status), (r) => r.amount);
        const claimsRef = kpi(ws, { cols: 'B', label: 'Claims Listed', formula: `COUNTIF(${s('match')},1)`, result: n, numFmt: FMT.count });
        const totalRef = kpi(ws, { cols: 'C', label: 'Total Claimed', formula: `SUMIFS(${s('amount')},${s('match')},1)`, result: total, numFmt: FMT.money });
        kpi(ws, { cols: 'D:E', label: 'Approved', formula: `SUMIFS(${s('amount')},${s('match')},1,${s('status')},"APPROVED")`, result: byStatus('APPROVED'), numFmt: FMT.money, color: COLOR.green });
        kpi(ws, { cols: 'F', label: 'Pending', formula: `SUMIFS(${s('amount')},${s('match')},1,${s('status')},"PENDING")`, result: byStatus('PENDING'), numFmt: FMT.money, color: COLOR.amber });
        kpi(ws, { cols: 'G:H', label: 'Rejected', formula: `SUMIFS(${s('amount')},${s('match')},1,${s('status')},"REJECTED")`, result: byStatus('REJECTED'), numFmt: FMT.money, color: COLOR.red });
        kpi(ws, { cols: 'I:J', label: 'Average per Claim', formula: `IF(${claimsRef}=0,0,${totalRef}/${claimsRef})`, result: n ? total / n : 0, numFmt: FMT.money });

        headerRow(ws, ROW.header, ['S.No.', 'Date', 'Employee', 'Emp Code', 'Category', 'Description', 'Amount', 'Status', 'Bill No', 'Actual Bill Date', 'Site Name', 'Merchant / Vendor', 'Invoice']);

        const at = (idx, key) => `INDEX(${s(key)},${idx})`;
        const link = { name: FONT, size: 9.5, underline: true, color: { argb: COLOR.link } };
        dynamicRows(ws, {
            firstRow: first, count: n, cumRange: s('cum'), lastCol,
            columns: [
                { col: 'A', expr: (idx, _, k) => serialNo(k)(idx), result: (k) => k, align: 'center' },
                { col: 'B', expr: (idx) => at(idx, 'date'), result: (k) => records[k - 1].date, numFmt: FMT.datetime, align: 'center' },
                { col: 'C', expr: (idx) => at(idx, 'emp'), result: (k) => records[k - 1].emp },
                { col: 'D', expr: (idx) => at(idx, 'code'), result: (k) => records[k - 1].code, align: 'center' },
                { col: 'E', expr: (idx) => at(idx, 'cat'), result: (k) => records[k - 1].cat },
                { col: 'F', expr: (idx) => at(idx, 'desc'), result: (k) => records[k - 1].desc },
                { col: 'G', expr: (idx) => at(idx, 'amount'), result: (k) => records[k - 1].amount, numFmt: FMT.money, align: 'right' },
                { col: 'H', expr: (idx) => at(idx, 'status'), result: (k) => records[k - 1].status, align: 'center' },
                { col: 'I', expr: (idx) => at(idx, 'billNo'), result: (k) => records[k - 1].billNo, align: 'center' },
                { col: 'J', expr: (idx) => at(idx, 'billDate'), result: (k) => records[k - 1].billDate, align: 'center' },
                { col: 'K', expr: (idx) => at(idx, 'site'), result: (k) => records[k - 1].site },
                { col: 'L', expr: (idx) => at(idx, 'merchant'), result: (k) => records[k - 1].merchant },
                {
                    col: 'M',
                    expr: (idx) => `IF(${at(idx, 'url')}="-","-",HYPERLINK(${at(idx, 'url')},"View Bill"))`,
                    result: (k) => (records[k - 1].url === '-' ? '-' : 'View Bill'),
                    align: 'center', font: link
                }
            ]
        });
        if (n > 0) statusColouring(ws, `H${first}:H${first + n - 1}`, `$H${first}`);
        ws.autoFilter = { from: { row: ROW.header, column: 1 }, to: { row: ROW.header, column: 13 } };

        // ── Summary (its per-employee figures live on Data too) ──
        const SD = dataTable(data, RD.nextCol,
            ['name', 'code', 'location', 'empStatus', 'sheet', 'claims', 'claimed', 'approved', 'pending', 'rejected', 'advances', 'balance', 'hrms', 'gps', 'firstClaim', 'lastClaim', 'include', 'cum'],
            ['Name', 'Code', 'Location', 'Emp Status', 'Sheet', 'Claims', 'Claimed', 'Approved', 'Pending', 'Rejected', 'Advances', 'Balance', 'HRMS KM', 'GPS KM', 'First Claim', 'Last Claim', 'Include', 'Cum']);
        buildSummary(SD);

        // ── Drop-down sources ──
        const ListD = dataTable(data, SD.nextCol, ['status', 'cat', 'ledgerCat', 'emp'], ['Status List', 'Category List', 'Ledger Category List', 'Employee List']);
        const writeList = (key, values, name) => {
            values.forEach((v, i) => { data.getCell(`${ListD.col[key]}${i + 2}`).value = v; });
            workbook.definedNames.add(`Data!$${ListD.col[key]}$2:$${ListD.col[key]}$${values.length + 1}`, name);
        };
        writeList('status', ['All', 'Approved', 'Pending', 'Rejected'], 'StatusList');
        writeList('cat', ['All', ...allCategories], 'CategoryList');
        writeList('ledgerCat', ['All', ...allCategories, ADVANCE_CATEGORY], 'LedgerCategoryList');
        writeList('emp', ['All', ...groups.map((g) => g.name)], 'EmployeeList');
    }

    function buildSummary(SD) {
        const ws = wsSummary;
        const q = sheetRef(ws);
        const E = groups.length;
        const dFirst = 2;
        const dLast = dFirst + Math.max(E, 1) - 1;
        const first = ROW.header + 1;

        const lastCol = scaffold(ws, {
            widths: [6, 26, 11, 14, 11, 9, 16, 16, 16, 16, 16, 17, 12, 12, 13, 13],
            company: companyName,
            title: 'Employee Expense Summary',
            subtitle: `Generated: ${stamp}`,
            tabColor: COLOR.navy
        });

        const from = filterInput(ws, { labelCols: 'B', inputCols: 'C:D', row: ROW.filter1, label: 'From Date', value: globalRange.min, numFmt: FMT.date, validation: dateValidation });
        const to = filterInput(ws, { labelCols: 'E:F', inputCols: 'G', row: ROW.filter1, label: 'To Date', value: globalRange.max, numFmt: FMT.date, validation: dateValidation });
        const st = filterInput(ws, { labelCols: 'B', inputCols: 'C:D', row: ROW.filter2, label: 'Status', value: 'All', validation: listValidation('StatusList') });
        const cat = filterInput(ws, { labelCols: 'E:F', inputCols: 'G:H', row: ROW.filter2, label: 'Category', value: 'All', validation: listValidation('CategoryList') });

        const fromQ = `IF(${q}!${from}="",0,${q}!${from})`;
        const toQ = `IF(${q}!${to}="",${NO_UPPER_DATE},${q}!${to}+1)`;
        const stQ = `${q}!${st}`;
        const catQ = `${q}!${cat}`;

        const values = groups.map((g) => {
            const exp = g.rows.filter((r) => r.type === 'Expense');
            const amt = (status) => sumBy(exp.filter((r) => r.status === status), (r) => r.incurred);
            const dates = exp.map((r) => r.date);
            return {
                name: g.name,
                code: txt(g.code),
                location: txt(g.location),
                empStatus: txt(g.empStatus),
                sheet: escSheetRef(g.sheetTitle),
                claims: exp.length,
                claimed: sumBy(exp, (r) => r.incurred),
                approved: amt('APPROVED'),
                pending: amt('PENDING'),
                rejected: amt('REJECTED'),
                advances: sumBy(g.rows, (r) => r.received),
                balance: g.rows.length ? g.rows[g.rows.length - 1].balance : 0,
                hrms: sumBy(exp, (r) => r.hrmsKm),
                gps: 0,
                firstClaim: dates.length ? new Date(Math.min(...dates)) : null,
                lastClaim: dates.length ? new Date(Math.max(...dates)) : null
            };
        });

        groups.forEach((g, i) => {
            const r = dFirst + i;
            const v = values[i];
            const src = (key) => LD.range(key, g.dFirst, g.dLast).replace(/^Data!/, '');
            const dates = `${src('date')},">="&${fromQ},${src('date')},"<"&${toQ}`;
            const filt = `${src('type')},"Expense",${dates},${src('status')},IF(${stQ}="All","*",${stQ}),${src('cat')},IF(${catQ}="All","*",${catQ})`;
            const byStatus = (label, upper) => `IF(OR(${stQ}="All",${stQ}="${label}"),SUMIFS(${src('incurred')},${src('type')},"Expense",${dates},${src('status')},"${upper}",${src('cat')},IF(${catQ}="All","*",${catQ})),0)`;
            const put = (key, value, numFmt) => {
                const c = data.getCell(`${SD.col[key]}${r}`);
                c.value = value;
                if (numFmt) c.numFmt = numFmt;
            };
            put('name', v.name);
            put('code', v.code);
            put('location', v.location);
            put('empStatus', v.empStatus);
            put('sheet', v.sheet);
            put('claims', { formula: `COUNTIFS(${filt})`, result: v.claims });
            put('claimed', { formula: `SUMIFS(${src('incurred')},${filt})`, result: v.claimed });
            put('approved', { formula: byStatus('Approved', 'APPROVED'), result: v.approved });
            put('pending', { formula: byStatus('Pending', 'PENDING'), result: v.pending });
            put('rejected', { formula: byStatus('Rejected', 'REJECTED'), result: v.rejected });
            put('advances', { formula: `SUMIFS(${src('received')},${src('type')},"Advance",${dates})`, result: v.advances });
            put('balance', { formula: `SUMIFS(${src('effect')},${src('date')},"<"&${toQ})`, result: v.balance });
            put('hrms', { formula: `SUMIFS(${src('hrms')},${filt})`, result: v.hrms });
            put('gps', { formula: `SUMIFS(${src('gps')},${filt})`, result: v.gps });
            put('firstClaim', v.firstClaim, FMT.date);
            put('lastClaim', v.lastClaim, FMT.date);
            put('include', { formula: `IF(${SD.col.claims}${r}>0,1,0)`, result: v.claims > 0 ? 1 : 0 });
            put('cum', {
                formula: i === 0 ? `${SD.col.include}${r}` : `${SD.col.cum}${r - 1}+${SD.col.include}${r}`,
                result: values.slice(0, i + 1).filter((x) => x.claims > 0).length
            });
        });

        const b = (key) => SD.range(key, dFirst, dLast);
        const total = (key) => sumBy(values, (v) => v[key]);
        kpi(ws, { cols: 'B', label: 'Employees with Claims', formula: `COUNTIF(${b('include')},1)`, result: values.filter((v) => v.claims > 0).length, numFmt: FMT.count });
        kpi(ws, { cols: 'C:D', label: 'Claims Raised', formula: `SUM(${b('claims')})`, result: total('claims'), numFmt: FMT.count });
        kpi(ws, { cols: 'E:F', label: 'Total Claimed', formula: `SUM(${b('claimed')})`, result: total('claimed'), numFmt: FMT.money });
        kpi(ws, { cols: 'G', label: 'Approved', formula: `SUM(${b('approved')})`, result: total('approved'), numFmt: FMT.money, color: COLOR.green });
        kpi(ws, { cols: 'H', label: 'Pending', formula: `SUM(${b('pending')})`, result: total('pending'), numFmt: FMT.money, color: COLOR.amber });
        kpi(ws, { cols: 'I', label: 'Rejected', formula: `SUM(${b('rejected')})`, result: total('rejected'), numFmt: FMT.money, color: COLOR.red });
        kpi(ws, { cols: 'J:K', label: 'Advances Paid', formula: `SUM(${b('advances')})`, result: total('advances'), numFmt: FMT.money });
        kpi(ws, { cols: 'L', label: 'Net Balance (as at To Date)', formula: `SUM(${b('balance')})`, result: total('balance'), numFmt: FMT.money });

        headerRow(ws, ROW.header, ['S.No.', 'Employee Name', 'Emp Code', 'Location', 'Emp Status', 'No. of Claims', 'Total Claimed', 'Approved', 'Pending', 'Rejected', 'Advances Received', 'Balance as at To Date', 'HRMS KM', 'GPS KM', 'First Claim', 'Last Claim']);

        const included = values.filter((v) => v.claims > 0);
        const at = (idx, key) => `INDEX(${b(key)},${idx})`;
        const cached = (key) => (k) => included[k - 1][key];
        dynamicRows(ws, {
            firstRow: first, count: E, matched: included.length, cumRange: b('cum'), lastCol,
            columns: [
                { col: 'A', expr: (idx, _, k) => serialNo(k)(idx), result: (k) => k, align: 'center' },
                {
                    // HYPERLINK keeps the name clickable even inside IFERROR;
                    // the cached result keeps it visible before any recalc.
                    col: 'B',
                    expr: (idx) => `HYPERLINK("#'"&${at(idx, 'sheet')}&"'!A1",${at(idx, 'name')})`,
                    result: cached('name'),
                    font: { name: FONT, size: 10, bold: true, underline: true, color: { argb: COLOR.link } }
                },
                { col: 'C', expr: (idx) => at(idx, 'code'), result: cached('code'), align: 'center' },
                { col: 'D', expr: (idx) => at(idx, 'location'), result: cached('location') },
                { col: 'E', expr: (idx) => at(idx, 'empStatus'), result: cached('empStatus'), align: 'center' },
                { col: 'F', expr: (idx) => at(idx, 'claims'), result: cached('claims'), numFmt: FMT.count, align: 'center' },
                { col: 'G', expr: (idx) => at(idx, 'claimed'), result: cached('claimed'), numFmt: FMT.money, align: 'right' },
                { col: 'H', expr: (idx) => at(idx, 'approved'), result: cached('approved'), numFmt: FMT.money, align: 'right' },
                { col: 'I', expr: (idx) => at(idx, 'pending'), result: cached('pending'), numFmt: FMT.money, align: 'right' },
                { col: 'J', expr: (idx) => at(idx, 'rejected'), result: cached('rejected'), numFmt: FMT.money, align: 'right' },
                { col: 'K', expr: (idx) => at(idx, 'advances'), result: cached('advances'), numFmt: FMT.money, align: 'right' },
                {
                    col: 'L', expr: (idx) => at(idx, 'balance'), result: cached('balance'), numFmt: FMT.money, align: 'right',
                    font: { name: FONT, size: 9.5, bold: true, color: { argb: COLOR.navy } }
                },
                { col: 'M', expr: (idx) => at(idx, 'hrms'), result: cached('hrms'), numFmt: FMT.km, align: 'right' },
                { col: 'N', expr: (idx) => at(idx, 'gps'), result: cached('gps'), numFmt: FMT.km, align: 'right' },
                { col: 'O', expr: (idx) => at(idx, 'firstClaim'), result: cached('firstClaim'), numFmt: FMT.date, align: 'center' },
                { col: 'P', expr: (idx) => at(idx, 'lastClaim'), result: cached('lastClaim'), numFmt: FMT.date, align: 'center' }
            ]
        });
        ws.autoFilter = { from: { row: ROW.header, column: 1 }, to: { row: ROW.header, column: 16 } };
    }

    return workbook;
}
