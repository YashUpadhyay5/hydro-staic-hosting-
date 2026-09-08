const Expense = require('../../../../shared/models/Expense');
const Employee = require('../../../../shared/models/Employee');
const sequelize = require('../../../../config/database');
const { getCachedEmployees } = require('../../../../core/utils/employeeCache');
const fs = require('fs');
const path = require('path');

// 1. Fetch all expenses
exports.getAllExpenses = async (req, res) => {
  try {
    const expenses = await Expense.findAll({
      order: [['createdAt', 'DESC']]
    });

    const { employees, empMap } = await getCachedEmployees();

    const enriched = expenses.map(exp => {
      const plain = exp.toJSON();
      const matched = empMap.get(String(plain.userId || '').toLowerCase()) || 
                      empMap.get(String(plain.userName || '').toLowerCase());
      if (matched) {
        plain.userId = matched.empCode || matched.id;
        plain.empCode = matched.empCode || matched.id;
        plain.userName = matched.name || plain.userName;
      } else {
        plain.empCode = plain.userId;
      }
      return plain;
    });
    
    return res.status(200).json(enriched);
  } catch (error) {
    console.error('❌ Fetch exception encountered:', error); 
    return res.status(500).json({ 
      error: 'Database execution failure retrieving expense items.',
      details: error.message 
    });
  }
};

// 2. Create a new expense claim
exports.createExpenseClaim = async (req, res) => {
  try {
    const { category, amount, description, userId, userName, billNo, billDate, siteName, merchantName } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({ error: 'Category field is required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid numeric amount greater than 0.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Missing required multipart invoice file attachment.' });
    }

    // Resolve latest assigned employee code & name from database
    let finalUserId = userId ? userId.trim() : null;
    let finalUserName = userName ? userName.trim() : null;
    if (finalUserId) {
      const emp = await Employee.findOne({
        where: sequelize.where(
          sequelize.fn('lower', sequelize.col('id')),
          sequelize.fn('lower', finalUserId)
        )
      }) || await Employee.findOne({
        where: sequelize.where(
          sequelize.fn('lower', sequelize.col('emp_code')),
          sequelize.fn('lower', finalUserId)
        )
      });
      if (emp) {
        finalUserId = emp.empCode || emp.id;
        finalUserName = emp.name || finalUserName;
      }
    }

    // Use relative path for database storage
    const invoiceUrl = `invoices/${req.file.filename}`;

    const newExpense = await Expense.create({
      userId: finalUserId,
      userName: finalUserName,
      category: category.trim(),
      amount: parsedAmount,
      description: description ? description.trim() : null,
      billNo: billNo ? billNo.trim() : null,
      billDate: billDate ? billDate.trim() : null,
      siteName: siteName ? siteName.trim() : null,
      merchantName: merchantName ? merchantName.trim() : null,
      invoiceUrl
    });

    return res.status(201).json({ message: 'Expense record synchronized successfully!', id: newExpense.id });
  } catch (error) {
    console.error('❌ Persistence validation failure:', error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log(`[Storage Log] Cleaned up uploaded invoice file: ${req.file.path}`);
      } catch (unlinkErr) {
        console.error('[Storage Log Error] Failed to delete orphaned invoice:', unlinkErr.message);
      }
    }
    return res.status(500).json({ 
      error: 'Server internal validation engine dropped payload instantiation properties.',
      details: error.message
    });
  }
};

// 3. Update expense approval status (Pending / Approved / Rejected)
exports.updateExpenseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be approved or rejected.' });
    }

    const expense = await Expense.findByPk(id);
    if (!expense) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    expense.status = status;
    await expense.save();

    console.log(`--- [BACKEND] Expense ${id} status updated to ${status} ---`);
    return res.status(200).json(expense);
  } catch (error) {
    console.error('❌ Update expense status exception:', error);
    return res.status(500).json({ 
      error: 'Failed to update expense status.',
      details: error.message 
    });
  }
};

// 4. Update full expense record details (Includes file replacement handling)
exports.updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { category, amount, description, billNo, billDate, merchantName, siteName, status } = req.body;
    console.log(`--- [BACKEND] API hit: Updating expense ${id} ---`, req.body);

    const expense = await Expense.findByPk(id);
    if (!expense) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    if (category) expense.category = category.trim();
    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        expense.amount = parsedAmount;
      }
    }
    if (description !== undefined) expense.description = description ? description.trim() : null;
    if (billNo !== undefined) expense.billNo = billNo ? billNo.trim() : null;
    if (billDate !== undefined) expense.billDate = billDate ? billDate.trim() : null;
    if (merchantName !== undefined) expense.merchantName = merchantName ? merchantName.trim() : null;
    if (siteName !== undefined) expense.siteName = siteName ? siteName.trim() : null;
    if (status !== undefined && ['approved', 'rejected', 'pending'].includes(String(status).toLowerCase())) {
      expense.status = String(status).toLowerCase();
    }

    if (req.file) {
      // Clean up old file if it exists and is local
      if (expense.invoiceUrl) {
        const { getStoragePath } = require('../../../../core/middleware/upload');
        let oldPath = path.join(getStoragePath(), expense.invoiceUrl);
        if (expense.invoiceUrl.startsWith('/static/uploads/')) {
          oldPath = path.join(__dirname, '..', 'uploads', path.basename(expense.invoiceUrl));
        }
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
          console.log(`[Storage Log] Cleaned up old invoice file during update: ${oldPath}`);
        }
      }
      expense.invoiceUrl = `invoices/${req.file.filename}`;
    }

    await expense.save();
    console.log(`--- [BACKEND] Expense ${id} updated successfully ---`);
    return res.status(200).json(expense);
  } catch (error) {
    console.error('❌ Update expense exception:', error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log(`[Storage Log] Cleaned up uploaded invoice file after failed update: ${req.file.path}`);
      } catch (unlinkErr) {
        console.error('[Storage Log Error]', unlinkErr.message);
      }
    }
    return res.status(500).json({ 
      error: 'Failed to update expense.',
      details: error.message 
    });
  }
};