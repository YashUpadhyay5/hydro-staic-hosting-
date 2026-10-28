const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const Ledger = require('../../../../shared/models/Ledger');
const Employee = require('../../../../shared/models/Employee');
const Expense = require('../../../../shared/models/Expense');
const { Op } = require('sequelize');

const upload = multer({ dest: 'uploads/' });

// Helper function to parse various date formats safely
function parseBankDate(dateVal) {
  if (!dateVal) return new Date();
  if (dateVal instanceof Date) return dateVal;
  
  // Handle Excel Serial Date Number
  if (typeof dateVal === 'number') {
    return new Date((dateVal - 25569) * 86400 * 1000);
  }
  
  const str = String(dateVal).trim();
  
  // Try default JS parser
  let d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  
  // Try DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  
  // Try DD-MMM-YYYY or DD MMM YYYY (e.g. 04-Feb-2026)
  const months = {
    jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
    january:0, february:1, march:2, april:3, june:5, july:6, august:7, september:8, october:9, november:10, december:11
  };
  const dmmmMatch = str.match(/^(\d{1,2})[-/\s]([a-zA-Z]{3,})[-/\s](\d{2,4})/);
  if (dmmmMatch) {
    const day = parseInt(dmmmMatch[1], 10);
    const monthStr = dmmmMatch[2].toLowerCase();
    const month = months[monthStr];
    let year = parseInt(dmmmMatch[3], 10);
    if (year < 100) year += 2000;
    if (month !== undefined) {
      d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  return new Date(); // Fallback to current time
}

// Upload Bank Statement and parse it
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // We assume the first row contains headers
    const data = xlsx.utils.sheet_to_json(sheet);

    const employees = await Employee.findAll();

    let processedCount = 0;
    let mappedCount = 0;

    for (const row of data) {
      // Common headers might be 'Txn Date', 'Description', 'Remark', 'Debit'
      // We normalize keys to lower case for easier mapping
      const keys = Object.keys(row);
      const getVal = (possibleKeys) => {
        for (const k of keys) {
          if (possibleKeys.includes(k.toLowerCase().trim())) {
            return row[k];
          }
        }
        return null;
      };

      const rawAmount = getVal(['debit', 'withdrawal', 'amount', 'withdrawal (dr)']);
      let amount = 0;
      if (typeof rawAmount === 'number') {
        amount = rawAmount;
      } else if (typeof rawAmount === 'string') {
        amount = parseFloat(rawAmount.replace(/,/g, ''));
      }

      if (!amount || amount <= 0) continue; // Only process debits/outgoing payments

      const description = getVal(['description', 'particulars', 'narration']) || '';
      const remark = getVal(['remark', 'remarks']) || '';
      const dateVal = getVal(['txn date', 'date', 'transaction date']);
      
      const fullText = (description + ' ' + remark).toLowerCase();

      // Attempt to map to employee
      let matchedEmployeeId = null;

      for (const emp of employees) {
        // Check if both Account Number AND Name are present in the transaction text
        const accStr = emp.bankAccountNo ? String(emp.bankAccountNo).toLowerCase().trim() : '';
        const last4 = accStr.length >= 4 ? accStr.slice(-4) : accStr;
        const maskedAcc = `**${last4}`; // Safer match for IMPS
        
        const hasAccount = accStr ? (fullText.includes(accStr) || fullText.includes(maskedAcc)) : false;
        const hasName = emp.name ? fullText.includes(emp.name.toLowerCase().trim()) : false;
        
        if (hasAccount && hasName) {
          matchedEmployeeId = emp.id;
          break;
        }
      }

      const finalDescription = (description + ' | ' + remark).trim();
      const finalDate = parseBankDate(dateVal);

      // Prevent duplicates by checking if exact same transaction already exists
      const existing = await Ledger.findOne({
        where: {
          date: finalDate,
          description: finalDescription,
          amount: amount,
          type: 'payment'
        }
      });

      if (existing) {
        // If existing is unmapped but our new logic found a match, update it!
        if (!existing.employeeId && matchedEmployeeId) {
          await existing.update({ employeeId: matchedEmployeeId });
          mappedCount++;
        }
        continue; // Skip creating a new duplicate entry
      }

      await Ledger.create({
        employeeId: matchedEmployeeId,
        date: finalDate,
        description: finalDescription,
        amount: amount,
        type: 'payment',
        source: 'Bank Statement Upload'
      });

      processedCount++;
      if (matchedEmployeeId) mappedCount++;
    }

    // Clean up file
    fs.unlinkSync(req.file.path);

    res.status(200).json({
      message: 'Bank statement processed successfully',
      processed: processedCount,
      mapped: mappedCount
    });

  } catch (error) {
    console.error('Error processing bank statement:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Get Ledger Balances
router.get('/balances', async (req, res) => {
  try {
    const employees = await Employee.findAll();
    
    // Aggregate approved expenses
    const expenses = await Expense.findAll({ where: { status: 'approved' } });
    
    // Aggregate ledger payments
    const ledgers = await Ledger.findAll({ where: { type: 'payment' } });

    const balances = employees.map(emp => {
      const empExpenses = expenses.filter(e => e.userId === emp.id).reduce((sum, e) => sum + e.amount, 0);
      const empPayments = ledgers.filter(l => l.employeeId === emp.id).reduce((sum, l) => sum + l.amount, 0);
      
      return {
        id: emp.id,
        name: emp.name,
        empCode: emp.empCode || emp.id,
        approvedExpenses: empExpenses,
        totalPayments: empPayments,
        balance: empExpenses - empPayments // Positive means we owe them, Negative means advance
      };
    });

    res.status(200).json(balances);
  } catch (error) {
    console.error('Error fetching ledger balances:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get detailed ledger timeline for an employee
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;

    // Fetch approved expenses (Credits)
    const expenses = await Expense.findAll({ where: { userId: employeeId, status: 'approved' } });
    
    // Fetch ledger payments (Debits)
    const ledgers = await Ledger.findAll({ where: { employeeId: employeeId } });

    // Map to standardized format
    const timeline = [];
    
    expenses.forEach(e => {
      timeline.push({
        id: e.id,
        recordType: 'expense',
        type: e.category || 'Expense',
        category: e.category,
        date: new Date(e.createdAt),
        particulars: e.description || '',
        billNo: e.billNo || '-',
        credit: e.amount,
        debit: null,
        invoice: e.invoiceUrl || null
      });
    });

    ledgers.forEach(l => {
      timeline.push({
        id: l.id,
        recordType: 'ledger',
        type: 'BANK TRANSFER',
        date: new Date(l.date),
        particulars: l.description, 
        billNo: 'Admin Upload',
        credit: null,
        debit: l.amount
      });
    });

    // Sort chronologically (oldest first) to calculate running balance
    timeline.sort((a, b) => a.date - b.date);

    let runningBalance = 0;
    const timelineWithBalance = timeline.map(item => {
      if (item.credit) runningBalance += item.credit;
      if (item.debit) runningBalance -= item.debit;
      return { ...item, runningBalance };
    });

    // We return it chronologically so newest is at the bottom
    res.status(200).json(timelineWithBalance);
  } catch (error) {
    console.error('Error fetching employee ledger details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all unmapped bank transfers
router.get('/unmapped', async (req, res) => {
  try {
    const unmapped = await Ledger.findAll({
      where: { employeeId: null },
      order: [['date', 'DESC']]
    });
    res.status(200).json(unmapped);
  } catch (error) {
    console.error('Error fetching unmapped ledgers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Map a ledger entry to an employee
router.patch('/:id/map', async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;
    
    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId is required' });
    }

    const ledgerEntry = await Ledger.findByPk(id);
    if (!ledgerEntry) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }
    
    ledgerEntry.employeeId = employeeId;
    await ledgerEntry.save();
    
    res.status(200).json({ message: 'Mapped successfully', ledgerEntry });
  } catch (error) {
    console.error('Error mapping ledger entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unlink a ledger entry from an employee
router.patch('/:id/unlink', async (req, res) => {
  try {
    const { id } = req.params;
    const ledgerEntry = await Ledger.findByPk(id);
    if (!ledgerEntry) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }
    
    ledgerEntry.employeeId = null;
    await ledgerEntry.save();
    
    res.status(200).json({ message: 'Unlinked successfully', ledgerEntry });
  } catch (error) {
    console.error('Error unlinking ledger entry:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
