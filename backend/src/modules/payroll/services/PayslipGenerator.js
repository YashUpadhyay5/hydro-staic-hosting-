const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { Payslip, Employee, PayrollItem, PayrollRun } = require('../../../shared/models/index');

/**
 * Converts numbers into Indian Rupee words (INR)
 * Format: "Nineteen Thousand Eight Hundred and Nine Rupees only"
 */
function numberToWordsINR(num) {
    if (!num || isNaN(num)) return 'Zero Rupees only';
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function inWords(n) {
        if ((n = n.toString()).length > 9) return 'overflow';
        let n_array = ('000000000' + n).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
        if (!n_array) return '';
        let str = '';
        str += (n_array[1] != 0) ? (a[Number(n_array[1])] || b[n_array[1][0]] + ' ' + a[n_array[1][1]]) + 'Crore ' : '';
        str += (n_array[2] != 0) ? (a[Number(n_array[2])] || b[n_array[2][0]] + ' ' + a[n_array[2][1]]) + 'Lakh ' : '';
        str += (n_array[3] != 0) ? (a[Number(n_array[3])] || b[n_array[3][0]] + ' ' + a[n_array[3][1]]) + 'Thousand ' : '';
        str += (n_array[4] != 0) ? (a[Number(n_array[4])] || b[n_array[4][0]] + ' ' + a[n_array[4][1]]) + 'Hundred ' : '';
        str += (n_array[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n_array[5])] || b[n_array[5][0]] + ' ' + a[n_array[5][1]]) : '';
        return str;
    }
    const val = Math.round(num);
    const words = inWords(val);
    return `${words.trim()} Rupees only`;
}

function formatCurrency(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPayslipMonthYear(monthStr) {
    if (!monthStr) return 'AUG 2025';
    const [year, month] = monthStr.split('-');
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const mIdx = parseInt(month, 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
        return `${monthNames[mIdx]} ${year}`;
    }
    return String(monthStr).toUpperCase();
}

function formatJoinedDate(dStr) {
    if (!dStr) return 'N/A';
    if (typeof dStr === 'string' && /^\d{2}\s+[A-Za-z]{3}\s+\d{4}$/.test(dStr.trim())) return dStr.trim();
    const match = String(dStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        const [, year, month, day] = match;
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mIdx = parseInt(month, 10) - 1;
        if (mIdx >= 0 && mIdx < 12) {
            return `${day} ${months[mIdx]} ${year}`;
        }
    }
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return String(dStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getLogoPath() {
    const possible = [
        path.join(__dirname, '../../../assets/company_logo.jpeg'),
        'D:/hydro-copy/Hydro/backend/src/assets/company_logo.jpeg',
        'D:/hydro-copy/Hydro/backend/storage/images/company_logo.jpeg',
        'D:/hydro-copy/Hydro/storage/images/company_logo.jpeg',
        'C:/Users/Falcon/Desktop/hydro-copy/Hydro/storage/images/company_logo.jpeg'
    ];
    for (const p of possible) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function buildFinancialBreakdowns(item) {
    const earningsObj = (item && item.earningsBreakdown) || {};
    const deductionsObj = (item && item.deductionsBreakdown) || {};

    let earningsList = [];
    let gross = Number(item?.grossEarned || item?.grossSalary || 0);

    const explicitEarnings = Object.entries(earningsObj).filter(([, v]) => Number(v) > 0);
    if (explicitEarnings.length > 0) {
        const labels = {
            BASIC: 'Basic',
            HRA: 'HRA',
            SPECIAL_ALLOWANCE: 'Other Allowance',
            OTHER_ALLOWANCE: 'Other Allowance',
            OTHER: 'Other Allowance',
            BONUS: 'Bonus',
            OVERTIME: 'Overtime Allowance',
            ARREARS: 'Arrears',
            ADHOC_PAYMENT: 'Ad-hoc Payment'
        };
        earningsList = explicitEarnings.map(([k, v]) => ({
            label: labels[k] || k.replace(/_/g, ' '),
            amount: Number(v)
        }));
    } else if (gross > 0) {
        const basic = Math.round(gross * 0.5 * 100) / 100;
        const hra = Math.round(gross * 0.3 * 100) / 100;
        const other = Math.round((gross - basic - hra) * 100) / 100;
        earningsList = [
            { label: 'Basic', amount: basic },
            { label: 'HRA', amount: hra },
            { label: 'Other Allowance', amount: other }
        ];
    } else {
        earningsList = [{ label: 'Basic', amount: 0 }];
    }

    const totalEarnings = Math.round(earningsList.reduce((acc, curr) => acc + curr.amount, 0) * 100) / 100;

    const contributionsList = [];
    const pfVal = Number(deductionsObj.EPF_EE || item?.pfDeduction || 0);
    if (pfVal > 0) {
        contributionsList.push({ label: 'PF Employee', amount: pfVal });
    }
    const vpfVal = Number(deductionsObj.VPF_EE || item?.vpfDeduction || 0);
    if (vpfVal > 0) {
        contributionsList.push({ label: 'VPF Employee', amount: vpfVal });
    }
    const totalContributions = Math.round(contributionsList.reduce((acc, curr) => acc + curr.amount, 0) * 100) / 100;

    const taxesList = [];
    const ptVal = Number(deductionsObj.PT || item?.ptDeduction || 0);
    if (ptVal > 0) {
        taxesList.push({ label: 'Professional Tax', amount: ptVal });
    }
    const esiVal = Number(deductionsObj.ESI_EE || item?.esiDeduction || 0);
    if (esiVal > 0) {
        taxesList.push({ label: 'ESIC', amount: esiVal });
    }
    const tdsVal = Number(deductionsObj.TDS || item?.tdsDeduction || 0);
    if (tdsVal > 0) {
        taxesList.push({ label: 'Income Tax (TDS)', amount: tdsVal });
    }
    const lwfVal = Number(deductionsObj.LWF || item?.lwfDeduction || 0);
    if (lwfVal > 0) {
        taxesList.push({ label: 'Labour Welfare Fund (LWF)', amount: lwfVal });
    }
    const emiVal = Number(deductionsObj.LOAN_EMI || 0);
    if (emiVal > 0) {
        taxesList.push({ label: 'Loan Repayment (EMI)', amount: emiVal });
    }
    const adhocVal = Number(deductionsObj.ADHOC_DEDUCTION || 0);
    if (adhocVal > 0) {
        taxesList.push({ label: 'Salary Advance / Recovery', amount: adhocVal });
    }
    const otherVal = Number(deductionsObj.OTHER || 0);
    if (otherVal > 0) {
        taxesList.push({ label: 'Other Deductions', amount: otherVal });
    }

    const recognizedKeys = new Set(['EPF_EE', 'VPF_EE', 'PT', 'ESI_EE', 'TDS', 'LWF', 'LOAN_EMI', 'ADHOC_DEDUCTION', 'OTHER']);
    for (const [k, v] of Object.entries(deductionsObj)) {
        if (!recognizedKeys.has(k) && Number(v) > 0) {
            taxesList.push({ label: k.replace(/_/g, ' '), amount: Number(v) });
        }
    }

    const totalTaxes = Math.round(taxesList.reduce((acc, curr) => acc + curr.amount, 0) * 100) / 100;

    let netSalary = 0;
    if (item && item.netSalary !== undefined && item.netSalary !== null) {
        netSalary = Number(item.netSalary);
    } else {
        netSalary = Math.round((totalEarnings - totalContributions - totalTaxes) * 100) / 100;
    }

    return {
        earningsList,
        totalEarnings,
        contributionsList,
        totalContributions,
        taxesList,
        totalTaxes,
        netSalary
    };
}

/**
 * Safely renders cell text within maxW, dynamically reducing font size if text is long
 * to guarantee zero horizontal or vertical overlap with adjacent columns
 */
function renderPdfCell(doc, text, x, y, maxW, baseSize = 9.8, font = 'Helvetica', color = '#000000') {
    doc.font(font).fillColor(color);
    const str = String(text != null && text !== '' ? text : 'N/A');
    doc.fontSize(baseSize);
    const strWidth = doc.widthOfString(str);
    if (strWidth > maxW) {
        const targetW = maxW - 2;
        const scaled = (targetW / strWidth) * baseSize;
        const finalSize = Math.max(6.5, Math.floor(scaled * 10) / 10);
        doc.fontSize(finalSize);
    }
    doc.text(str, x, y, { width: maxW, lineBreak: false });
    doc.fontSize(baseSize);
}

class PayslipGenerator {
  /**
   * Generates exact HTML template matching the company reference design
   */
  generateHtmlTemplate(employee, run, item) {
    const emp = (typeof employee?.toJSON === 'function') ? employee.toJSON() : (employee || {});
    const it = item || {};
    const month = (run && run.month) ? run.month : (it.month || '');

    const logoPath = getLogoPath();
    let logoBase64 = '';
    if (logoPath && fs.existsSync(logoPath)) {
        logoBase64 = `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString('base64')}`;
    }

    const monthYearStr = formatPayslipMonthYear(month);
    const empName = (emp.name || 'Employee').toUpperCase();
    const pfNumber = emp.pfNumber || emp.pf_number || (emp.customFields && (emp.customFields.pfNumber || emp.customFields.pf_number)) || 'N/A';
    const uanNumber = emp.uanNumber || emp.pfUan || (emp.customFields && (emp.customFields.uanNumber || emp.customFields.pfUan)) || 'N/A';
    const panNumber = emp.panNumber || emp.pan || (emp.customFields && (emp.customFields.panNumber || emp.customFields.pan)) || 'N/A';
    const bankAccount = emp.bankAccountNo || emp.accountNo || (emp.customFields && emp.customFields.bankAccountNo) || 'N/A';
    const bankIfsc = emp.bankIfscCode || emp.ifscCode || (emp.customFields && emp.customFields.bankIfscCode) || 'N/A';
    const placeOfDutyStr = emp.placeOfDuty || emp.place_of_duty || (emp.customFields && (emp.customFields.placeOfDuty || emp.customFields.place_of_duty)) || 'N/A';

    const totalWorking = Number(it.workingDays || 0).toFixed(1);
    const actualPayable = Number(it.workingDays || 0).toFixed(1);
    const lop = Number(it.lopDays || 0).toFixed(2);
    const daysPayable = it.workedDays !== undefined
        ? Number(it.workedDays).toFixed(1)
        : (Number(it.workingDays || 0) - Number(it.lopDays || 0)).toFixed(1);

    const financial = buildFinancialBreakdowns(it);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Payslip ${monthYearStr} - ${empName}</title>
  <style>
    @page {
      size: A4;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: 24px 0;
      background-color: #f1f5f9;
      font-family: Arial, Helvetica, sans-serif;
      color: #000000;
      -webkit-font-smoothing: antialiased;
    }
    .no-print-toolbar {
      max-width: 595.28pt;
      margin: 0 auto 16px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #ffffff;
      padding: 10px 18px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .payslip-page {
      width: 595.28pt;
      min-height: 841.89pt;
      margin: 0 auto;
      background: #ffffff;
      padding: 36.2pt;
      position: relative;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }
    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24pt;
    }
    .title-row {
      font-size: 18pt;
      font-weight: bold;
      line-height: 1.1;
      margin-bottom: 14pt;
    }
    .title-month {
      font-weight: normal;
      color: #505050;
      margin-left: 6pt;
    }
    .company-name {
      font-size: 9pt;
      font-weight: normal;
      color: #000000;
      margin-bottom: 8pt;
    }
    .company-address {
      font-size: 7.5pt;
      line-height: 1.4;
      color: #000000;
    }
    .logo-container {
      width: 50.6pt;
      height: 90pt;
      display: flex;
      justify-content: flex-end;
      align-items: flex-start;
    }
    .logo-container img {
      width: 50.6pt;
      height: 90pt;
      object-fit: contain;
      margin-top: -7pt;
    }
    .emp-name-title {
      font-size: 9.8pt;
      font-weight: bold;
      margin-bottom: 8pt;
      color: #000000;
    }
    .divider-black {
      height: 0.8pt;
      background-color: #000000;
      width: 100%;
      margin: 0;
    }
    .divider-grey {
      height: 0.75pt;
      background-color: #dcdcdc;
      width: 100%;
      margin: 0;
    }
    .grid-4col {
      display: grid;
      grid-template-columns: 130.7pt 130.6pt 130.6pt 130.7pt;
      padding: 8pt 0;
    }
    .cell-label {
      font-size: 8.2pt;
      color: #858585;
      margin-bottom: 2pt;
    }
    .cell-val {
      font-size: 9.8pt;
      color: #000000;
    }
    .section-title {
      font-size: 9.8pt;
      color: #000000;
      margin-top: 24pt;
      margin-bottom: 8pt;
    }
    .financial-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      margin-top: 14pt;
      position: relative;
    }
    .financial-left {
      padding-right: 18pt;
    }
    .financial-right {
      padding-left: 18pt;
      border-left: 0.75pt solid #d3d3d3;
    }
    .fin-title {
      font-size: 9.8pt;
      font-weight: bold;
      margin-bottom: 12pt;
      color: #000000;
    }
    .fin-row {
      display: flex;
      justify-content: space-between;
      font-size: 9.8pt;
      color: #000000;
      margin-bottom: 4.5pt;
    }
    .fin-row.total {
      font-weight: bold;
      margin-top: 8pt;
      margin-bottom: 14pt;
    }
    .fin-row.total .fin-amount {
      font-weight: normal;
    }
    .net-salary-box {
      background-color: #f8f8f9;
      border-radius: 4px;
      padding: 11pt 12pt;
      margin-top: 18pt;
    }
    .net-salary-row {
      display: flex;
      font-size: 9.8pt;
      margin-bottom: 8pt;
    }
    .net-salary-row:last-child {
      margin-bottom: 0;
    }
    .net-label {
      width: 208pt;
      color: #000000;
    }
    .net-val {
      color: #000000;
    }
    .net-val.bold {
      font-weight: bold;
    }
    .note-line {
      margin-top: 18pt;
      font-size: 9.8pt;
    }
    .note-line strong {
      font-weight: bold;
    }
    .note-line em {
      font-style: italic;
    }
    .footer-statement {
      margin-top: 28pt;
      font-size: 7.5pt;
      font-style: italic;
      color: #000000;
    }
    @media print {
      body {
        padding: 0;
        background: #ffffff;
      }
      .no-print-toolbar {
        display: none !important;
      }
      .payslip-page {
        box-shadow: none;
        margin: 0;
        width: 100%;
        min-height: auto;
        padding: 36.2pt;
      }
    }
  </style>
</head>
<body>
  <div class="no-print-toolbar">
    <div style="font-weight: 600; font-size: 13px; color: #1e293b;">
      Employee Payslip Preview
    </div>
    <button onclick="window.print()" style="cursor: pointer; background: #2563eb; color: #ffffff; border: none; padding: 6px 16px; border-radius: 6px; font-weight: 600; font-size: 12px;">
      Print / Save as PDF
    </button>
  </div>

  <div class="payslip-page">
    <!-- Logo Watermark -->
    ${logoBase64 ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;z-index:0;"><img src="${logoBase64}" alt="Watermark" style="width:320px;height:569px;object-fit:fill;opacity:0.25;" /></div>` : ''}
    <!-- Header -->
    <div class="header-container">
      <div>
        <div class="title-row">
          <span>PAYSLIP</span><span class="title-month">${monthYearStr}</span>
        </div>
        <div class="company-name">HYDROMATERIALS PVT LTD</div>
        <div class="company-address">
          Corp. Office : No. 34, THIRD FLOOR, BLOCK-2<br/>
          SIDCO ELECTRONIC COMPLEX, GUINDY INDUSTRIAL ESTATE, ,<br/>
          CHENNAI TAMIL NADU 600032<br/>
          Place of Duty : ${placeOfDutyStr}
        </div>
      </div>
    </div>

    <!-- Employee Name -->
    <div class="emp-name-title">${empName}</div>

    <!-- Divider 1 -->
    <div class="divider-black"></div>

    <!-- Employee Details Table -->
    <div class="grid-4col">
      <div>
        <div class="cell-label">Employee Number</div>
        <div class="cell-val">${emp.empCode || emp.id || 'N/A'}</div>
      </div>
      <div>
        <div class="cell-label">Date Joined</div>
        <div class="cell-val">${formatJoinedDate(emp.joiningDate)}</div>
      </div>
      <div>
        <div class="cell-label">Department</div>
        <div class="cell-val">${emp.department || 'Operations'}</div>
      </div>
      <div>
        <div class="cell-label">Sub Department</div>
        <div class="cell-val">${emp.subDepartment || emp.customFields?.subDepartment || 'N/A'}</div>
      </div>
    </div>

    <div class="divider-grey"></div>

    <div class="grid-4col">
      <div>
        <div class="cell-label">Designation</div>
        <div class="cell-val">${emp.jobTitle || emp.designation || 'Staff'}</div>
      </div>
      <div>
        <div class="cell-label">Payment Mode</div>
        <div class="cell-val">${emp.paymentMode || emp.customFields?.paymentMode || 'Bank Transfer'}</div>
      </div>
      <div>
        <div class="cell-label">Bank</div>
        <div class="cell-val">${emp.bankName || 'HDFC Bank'}</div>
      </div>
      <div>
        <div class="cell-label">Bank IFSC</div>
        <div class="cell-val">${bankIfsc}</div>
      </div>
    </div>

    <div class="divider-grey"></div>

    <div class="grid-4col">
      <div>
        <div class="cell-label">Bank Account</div>
        <div class="cell-val">${bankAccount}</div>
      </div>
      <div>
        <div class="cell-label">UAN</div>
        <div class="cell-val">${uanNumber}</div>
      </div>
      <div>
        <div class="cell-label">PF Number</div>
        <div class="cell-val">${pfNumber}</div>
      </div>
      <div>
        <div class="cell-label">PAN Number</div>
        <div class="cell-val">${panNumber}</div>
      </div>
    </div>

    <div class="divider-black"></div>

    <!-- Salary Details -->
    <div class="section-title">SALARY DETAILS</div>
    <div class="divider-black"></div>

    <div class="grid-4col">
      <div>
        <div class="cell-label">Actual Payable Days</div>
        <div class="cell-val">${actualPayable}</div>
      </div>
      <div>
        <div class="cell-label">Total Working Days</div>
        <div class="cell-val">${totalWorking}</div>
      </div>
      <div>
        <div class="cell-label">Loss Of Pay Days</div>
        <div class="cell-val">${lop}</div>
      </div>
      <div>
        <div class="cell-label">Days Payable</div>
        <div class="cell-val">${daysPayable}</div>
      </div>
    </div>

    <div class="divider-grey"></div>

    <!-- Financial Breakdown -->
    <div class="financial-grid">
      <!-- Left: EARNINGS -->
      <div class="financial-left">
        <div class="fin-title">EARNINGS</div>
        ${financial.earningsList.map(e => `
          <div class="fin-row">
            <span>${e.label}</span>
            <span>${formatCurrency(e.amount)}</span>
          </div>
        `).join('')}
        <div class="fin-row total">
          <span>Total Earnings (A)</span>
          <span class="fin-amount">${formatCurrency(financial.totalEarnings)}</span>
        </div>
      </div>

      <!-- Right: CONTRIBUTIONS & TAXES/DEDUCTIONS -->
      <div class="financial-right">
        <div class="fin-title">CONTRIBUTIONS</div>
        ${(financial.contributionsList.length > 0 ? financial.contributionsList : [{ label: 'PF Employee', amount: 0 }]).map(c => `
          <div class="fin-row">
            <span>${c.label}</span>
            <span>${formatCurrency(c.amount)}</span>
          </div>
        `).join('')}
        <div class="fin-row total">
          <span>Total Contributions (B)</span>
          <span class="fin-amount">${formatCurrency(financial.totalContributions)}</span>
        </div>

        <div class="fin-title" style="margin-top: 18pt;">TAXES & DEDUCTIONS</div>
        ${(financial.taxesList.length > 0 ? financial.taxesList : [{ label: 'Professional Tax', amount: 0 }]).map(t => `
          <div class="fin-row">
            <span>${t.label}</span>
            <span>${formatCurrency(t.amount)}</span>
          </div>
        `).join('')}
        <div class="fin-row total">
          <span>Total Taxes & Deductions (C)</span>
          <span class="fin-amount">${formatCurrency(financial.totalTaxes)}</span>
        </div>
      </div>
    </div>

    <!-- Net Salary Box -->
    <div class="net-salary-box">
      <div class="net-salary-row">
        <div class="net-label">Net Salary Payable ( A - B - C )</div>
        <div class="net-val">${formatCurrency(financial.netSalary)}</div>
      </div>
      <div class="net-salary-row">
        <div class="net-label">Net Salary in words</div>
        <div class="net-val bold">${numberToWordsINR(financial.netSalary)}</div>
      </div>
    </div>

    <!-- Notes -->
    <div class="note-line">
      <strong>**Note :</strong> <em>All amounts displayed in this payslip are in</em> <strong><em>INR</em></strong>
    </div>

    <!-- Footer Statement -->
    <div class="footer-statement">
      * This is computer generated statement, does not require signature.
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates exact PDF matching sample
   */
  generatePdfBuffer(employee, month, item) {
    return new Promise((resolve, reject) => {
        try {
            const emp = (typeof employee?.toJSON === 'function') ? employee.toJSON() : (employee || {});
            const it = item || {};

            const doc = new PDFDocument({
                size: 'A4',
                margin: 0,
                info: {
                    Title: `Payslip - ${month} - ${emp.name || 'Employee'}`,
                    Author: 'HYDROMATERIALS PVT LTD'
                }
            });

            const chunks = [];
            doc.on('data', c => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // ── Diagonal Logo Watermark ─────────────────────────────────────
            // A4 page: 595.28 x 841.89 pt — center at (297.64, 420.94)
            const wmLogoPath = getLogoPath();
            if (wmLogoPath && fs.existsSync(wmLogoPath)) {
                const wmW = 300;
                const wmH = Math.round(wmW * 1.778);  // matches actual logo ratio 720:1280
                doc.save();
                doc.translate(297.64, 420.94);   // move origin to page centre
                doc.opacity(0.25);                // visible professional watermark
                doc.image(wmLogoPath, -(wmW / 2), -(wmH / 2), { width: wmW, height: wmH });
                doc.opacity(1);                   // reset opacity
                doc.restore();
            }
            // ────────────────────────────────────────────────────────────────


            const placeOfDutyStr = emp.placeOfDuty || emp.place_of_duty || (emp.customFields && (emp.customFields.placeOfDuty || emp.customFields.place_of_duty)) || 'N/A';

            // Header
            const monthYearStr = formatPayslipMonthYear(month);
            doc.font('Helvetica-Bold').fontSize(18.0).fillColor('#000000').text('PAYSLIP', 37.0, 32.4, { continued: true });
            doc.font('Helvetica').fontSize(18.0).fillColor('#505050').text(`  ${monthYearStr}`);

            doc.font('Helvetica').fontSize(9.0).fillColor('#000000').text('HYDROMATERIALS PVT LTD', 37.0, 69.7);
            doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text('Corp. Office : No. 34, THIRD FLOOR, BLOCK-2', 37.0, 90.1);
            doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text('SIDCO ELECTRONIC COMPLEX, GUINDY INDUSTRIAL ESTATE, ,', 37.0, 102.5);
            doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text('CHENNAI TAMIL NADU 600032', 37.0, 114.8);
            doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text(`Place of Duty : ${placeOfDutyStr}`, 37.0, 127.2);

            // Employee Name
            const empName = (emp.name || 'Employee').toUpperCase();
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text(empName, 36.2, 152.4);

            // Divider 1 (solid black)
            doc.rect(36.2, 172.0, 522.6, 0.8).fill('#000000');

            // Employee Details Table (3 Rows x 4 Columns)
            const colX = [36.2, 166.9, 297.5, 428.1];

            // Row 1
            doc.font('Helvetica').fontSize(8.2).fillColor('#858585');
            doc.text('Employee Number', colX[0], 178.9);
            doc.text('Date Joined', colX[1], 178.9);
            doc.text('Department', colX[2], 178.9);
            doc.text('Sub Department', colX[3], 178.9);

            // Row 1
            renderPdfCell(doc, emp.empCode || emp.id || 'N/A', colX[0], 190.0, 124);
            renderPdfCell(doc, formatJoinedDate(emp.joiningDate), colX[1], 190.0, 124);
            renderPdfCell(doc, emp.department || 'Operations', colX[2], 190.0, 124);
            renderPdfCell(doc, emp.subDepartment || emp.customFields?.subDepartment || 'N/A', colX[3], 190.0, 128);

            // Divider 2 (light grey)
            doc.rect(36.2, 210.9, 522.6, 0.75).fill('#dcdcdc');

            // Row 2
            doc.font('Helvetica').fontSize(8.2).fillColor('#858585');
            doc.text('Designation', colX[0], 217.7);
            doc.text('Payment Mode', colX[1], 217.7);
            doc.text('Bank', colX[2], 217.7);
            doc.text('Bank IFSC', colX[3], 217.7);

            const bankIfsc = emp.bankIfscCode || emp.ifscCode || (emp.customFields && emp.customFields.bankIfscCode) || 'N/A';
            const bankAccount = emp.bankAccountNo || emp.accountNo || (emp.customFields && emp.customFields.bankAccountNo) || 'N/A';

            renderPdfCell(doc, emp.jobTitle || emp.designation || 'Staff', colX[0], 228.9, 124);
            renderPdfCell(doc, emp.paymentMode || emp.customFields?.paymentMode || 'Bank Transfer', colX[1], 228.9, 124);
            renderPdfCell(doc, emp.bankName || 'HDFC Bank', colX[2], 228.9, 124);
            renderPdfCell(doc, bankIfsc, colX[3], 228.9, 128);

            // Divider 3 (light grey)
            doc.rect(36.2, 249.7, 522.6, 0.75).fill('#dcdcdc');

            // Row 3
            doc.font('Helvetica').fontSize(8.2).fillColor('#858585');
            doc.text('Bank Account', colX[0], 256.6);
            doc.text('UAN', colX[1], 256.6);
            doc.text('PF Number', colX[2], 256.6);
            doc.text('PAN Number', colX[3], 256.6);

            const pfNumber = emp.pfNumber || emp.pf_number || (emp.customFields && (emp.customFields.pfNumber || emp.customFields.pf_number)) || 'N/A';
            const uanNumber = emp.uanNumber || emp.pfUan || (emp.customFields && (emp.customFields.uanNumber || emp.customFields.pfUan)) || 'N/A';
            const panNumber = emp.panNumber || emp.pan || (emp.customFields && (emp.customFields.panNumber || emp.customFields.pan)) || 'N/A';

            renderPdfCell(doc, bankAccount, colX[0], 267.7, 124);
            renderPdfCell(doc, uanNumber, colX[1], 267.7, 124);
            renderPdfCell(doc, pfNumber, colX[2], 267.7, 124);
            renderPdfCell(doc, panNumber, colX[3], 267.7, 128);

            // Divider 4 (solid black)
            doc.rect(36.2, 288.6, 522.6, 0.8).fill('#000000');

            // SALARY DETAILS
            doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text('SALARY DETAILS', 36.2, 319.4);
            // Divider 5 (solid black)
            doc.rect(36.2, 339.1, 522.6, 0.8).fill('#000000');

            const salX = [36.2, 186.3, 328.2, 458.4];
            doc.font('Helvetica').fontSize(8.2).fillColor('#858585');
            doc.text('Actual Payable Days', salX[0], 346.0);
            doc.text('Total Working Days', salX[1], 346.0);
            doc.text('Loss Of Pay Days', salX[2], 346.0);
            doc.text('Days Payable', salX[3], 346.0);

            const totalWorking = Number(it.workingDays || 0).toFixed(1);
            const actualPayable = Number(it.workingDays || 0).toFixed(1);
            const lop = Number(it.lopDays || 0).toFixed(2);
            const daysPayable = it.workedDays !== undefined
                ? Number(it.workedDays).toFixed(1)
                : (Number(it.workingDays || 0) - Number(it.lopDays || 0)).toFixed(1);

            renderPdfCell(doc, actualPayable, salX[0], 357.1, 140);
            renderPdfCell(doc, totalWorking, salX[1], 357.1, 135);
            renderPdfCell(doc, lop, salX[2], 357.1, 125);
            renderPdfCell(doc, daysPayable, salX[3], 357.1, 95);

            // Divider 6 (light grey)
            doc.rect(36.2, 378.0, 522.6, 0.75).fill('#dcdcdc');

            // Financial Breakdowns
            const financial = buildFinancialBreakdowns(it);

            // Dynamic layout calculations
            const finStartY = 392.6;

            // EARNINGS & CONTRIBUTIONS section titles
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text('EARNINGS', 37.0, finStartY);
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text('CONTRIBUTIONS', 305.4, finStartY);

            let earnY = finStartY + 18.0;
            for (const earn of financial.earningsList) {
                renderPdfCell(doc, earn.label, 37.0, earnY, 170, 9.8, 'Helvetica', '#000000');
                doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text(formatCurrency(earn.amount), 215.0, earnY, { width: 75, align: 'right' });
                earnY += 15.8;
            }
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text('Total Earnings (A)', 37.0, earnY);
            doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text(formatCurrency(financial.totalEarnings), 215.0, earnY, { width: 75, align: 'right' });
            const earningsEndY = earnY + 16.0;

            // CONTRIBUTIONS
            let contribY = finStartY + 18.0;
            if (financial.contributionsList.length === 0) {
                financial.contributionsList.push({ label: 'PF Employee', amount: 0 });
            }
            for (const c of financial.contributionsList) {
                renderPdfCell(doc, c.label, 305.4, contribY, 165, 9.8, 'Helvetica', '#000000');
                doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text(formatCurrency(c.amount), 476.0, contribY, { width: 75, align: 'right' });
                contribY += 15.8;
            }
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text('Total Contributions (B)', 305.4, contribY);
            doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text(formatCurrency(financial.totalContributions), 476.0, contribY, { width: 75, align: 'right' });

            // TAXES & DEDUCTIONS
            let taxHeaderY = contribY + 32.0;
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text('TAXES & DEDUCTIONS', 305.4, taxHeaderY);

            let taxY = taxHeaderY + 18.0;
            if (financial.taxesList.length === 0) {
                financial.taxesList.push({ label: 'Professional Tax', amount: 0 });
            }
            for (const t of financial.taxesList) {
                renderPdfCell(doc, t.label, 305.4, taxY, 165, 9.8, 'Helvetica', '#000000');
                doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text(formatCurrency(t.amount), 476.0, taxY, { width: 75, align: 'right' });
                taxY += 15.8;
            }
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text('Total Taxes & Deductions (C)', 305.4, taxY);
            doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text(formatCurrency(financial.totalTaxes), 476.0, taxY, { width: 75, align: 'right' });
            const deductionsEndY = taxY + 16.0;

            // Vertical divider line between Earnings and Deductions
            const vertEndY = Math.max(earningsEndY, deductionsEndY, 502.8);
            doc.moveTo(297.5, finStartY + 1.1).lineTo(297.5, vertEndY).strokeColor('#d3d3d3').lineWidth(0.75).stroke();

            // Net Salary Box
            const netBoxY = Math.max(vertEndY + 12.2, 515.0);
            doc.rect(36.25, netBoxY, 522.5, 25.8).fill('#f8f8f9');
            doc.rect(36.25, netBoxY + 25.8, 522.5, 33.3).fill('#f8f8f9');

            doc.font('Helvetica').fontSize(9.8).fillColor('#000000').text('Net Salary Payable ( A - B - C )', 46.0, netBoxY + 10.7);
            doc.text(formatCurrency(financial.netSalary), 254.7, netBoxY + 10.7);

            doc.text('Net Salary in words', 46.0, netBoxY + 33.5);
            renderPdfCell(doc, numberToWordsINR(financial.netSalary), 254.7, netBoxY + 33.5, 295, 9.8, 'Helvetica-Bold', '#000000');

            // Note
            const noteY = netBoxY + 64.8;
            doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text('**Note :', 37.0, noteY, { continued: true });
            doc.font('Helvetica-Oblique').text('    All amounts displayed in this payslip are in ', { continued: true });
            doc.font('Helvetica-BoldOblique').text('INR');

            // Footer statement
            const footerY = noteY + 37.1;
            doc.font('Helvetica').fontSize(11.0).fillColor('#000000').text('*', 36.2, footerY - 2.0, { continued: true });
            doc.font('Helvetica-Oblique').fontSize(7.5).text(' This is computer generated statement, does not require signature.');

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
  }

  /**
   * Generates payslip files for a run
   */
  async generatePayslipForEmployee(payrollItemId) {
    const item = await PayrollItem.findByPk(payrollItemId, {
      include: [
        { model: Employee, as: 'employee' },
        { model: PayrollRun, as: 'payrollRun' }
      ]
    });

    if (!item || !item.employee || !item.payrollRun) {
      throw new Error('Payroll item dependencies not resolved.');
    }

    const htmlContent = this.generateHtmlTemplate(item.employee, item.payrollRun, item);

    const targetFolders = [
      path.join(process.env.STORAGE_PATH || path.join(__dirname, '..', '..', '..', '..', 'storage'), 'payslips'),
      'D:/hydro-copy/Hydro/backend/storage/payslips',
      'D:/hydro-copy/Hydro/storage/payslips',
      'C:/Users/Falcon/Desktop/hydro-copy/Hydro/storage/payslips'
    ];

    const fileName = `payslip_${item.employee.id}_${item.payrollRun.month}.html`;
    const pdfFileName = `payslip_${item.employee.id}_${item.payrollRun.month}.pdf`;

    let pdfBuffer = null;
    try {
      pdfBuffer = await this.generatePdfBuffer(item.employee, item.payrollRun.month, item);
    } catch (pdfErr) {
      console.warn('Could not generate PDF payslip during save:', pdfErr.message);
    }

    for (const folder of targetFolders) {
      try {
        if (!fs.existsSync(folder)) {
          fs.mkdirSync(folder, { recursive: true });
        }
        fs.writeFileSync(path.join(folder, fileName), htmlContent);
        if (pdfBuffer) {
          fs.writeFileSync(path.join(folder, pdfFileName), pdfBuffer);
        }
      } catch (err) {
        console.warn(`Failed writing payslip files to ${folder}:`, err.message);
      }
    }

    const relativePath = `payslips/${pdfFileName}`;
    const secureHash = crypto.createHash('sha256').update(htmlContent).digest('hex');

    // Save payslip record (regenerating a payslip updates the existing record instead of adding a duplicate)
    const existing = await Payslip.findOne({ where: { payrollItemId: item.id } });
    if (existing) {
      existing.filePath = relativePath;
      existing.secureHash = secureHash;
      await existing.save();
      return existing;
    }

    const payslip = await Payslip.create({
      payrollItemId: item.id,
      employeeId: item.employee.id,
      month: item.payrollRun.month,
      filePath: relativePath,
      secureHash,
      emailSentStatus: true
    });

    return payslip;
  }

  /**
   * Bulk generation
   */
  async bulkGenerate(payrollRunId) {
    const items = await PayrollItem.findAll({
      where: { payrollRunId, status: 'COMPLETED' }
    });

    const payslips = [];
    for (const item of items) {
      const ps = await this.generatePayslipForEmployee(item.id);
      payslips.push(ps);
    }
    return payslips;
  }
}

module.exports = new PayslipGenerator();
