const Expense = require('../../../../shared/models/Expense');
const Employee = require('../../../../shared/models/Employee');
const sequelize = require('../../../../config/database');
const { getCachedEmployees } = require('../../../../core/utils/employeeCache');
const { getStoragePath } = require('../../../../core/middleware/upload');
const fs = require('fs');
const path = require('path');
const EmailService = require('../../../../core/services/EmailService');

// Helper to safely delete an invoice file from disk
const safelyDeleteInvoiceFile = (fileRelUrl) => {
  if (!fileRelUrl) return;
  try {
    let targetPath;
    if (fileRelUrl.startsWith('/static/uploads/')) {
      const filename = path.basename(fileRelUrl);
      targetPath = path.join(__dirname, '..', 'uploads', filename);
    } else {
      targetPath = path.join(getStoragePath(), fileRelUrl);
    }
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      console.log(`[Storage Log] Cleaned up invoice file: ${targetPath}`);
    }
  } catch (err) {
    console.error(`[Storage Log Error] Failed to delete invoice file ${fileRelUrl}:`, err.message);
  }
};

// 1. Fetch all expenses
exports.getAllExpenses = async (req, res) => {
  try {
    const expenses = await Expense.findAll({
      order: [['createdAt', 'DESC']]
    });

    const { employees, empMap } = await getCachedEmployees();

    const enriched = expenses.map(exp => {
      const plain = exp.toJSON();
      
      // Ensure invoiceUrls is always a JavaScript array for consumers
      if (!plain.invoiceUrls || !Array.isArray(plain.invoiceUrls) || plain.invoiceUrls.length === 0) {
        plain.invoiceUrls = plain.invoiceUrl ? [plain.invoiceUrl] : [];
      }
      if (!plain.invoiceUrl && plain.invoiceUrls.length > 0) {
        plain.invoiceUrl = plain.invoiceUrls[0];
      }

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

// 2. Create a new expense claim (supports multiple multipart file attachments)
exports.createExpenseClaim = async (req, res) => {
  const uploadedFiles = req.files && req.files.length > 0 ? req.files : (req.file ? [req.file] : []);

  try {
    const { category, amount, description, userId, userName, billNo, billDate, siteName, merchantName } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({ error: 'Category field is required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid numeric amount greater than 0.' });
    }

    if (uploadedFiles.length === 0) {
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

    // Build array of relative invoice URLs
    const invoiceUrls = uploadedFiles.map(f => `invoices/${f.filename}`);

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
      invoiceUrl: invoiceUrls[0],
      invoiceUrls: invoiceUrls,
      status: 'pending',
      suspiciousReason: null
    });

    console.log(`--- [BACKEND] Expense created successfully: #${newExpense.id} with ${invoiceUrls.length} file(s) ---`);

    return res.status(201).json({ 
      message: 'Expense record synchronized successfully!', 
      id: newExpense.id,
      invoiceUrls: newExpense.invoiceUrls,
      expense: newExpense
    });
  } catch (error) {
    console.error('❌ Persistence validation failure:', error);
    // Cleanup any orphaned uploaded files on error
    uploadedFiles.forEach(f => {
      if (f.path && fs.existsSync(f.path)) {
        try {
          fs.unlinkSync(f.path);
          console.log(`[Storage Log] Cleaned up uploaded invoice file on error: ${f.path}`);
        } catch (unlinkErr) {
          console.error('[Storage Log Error] Failed to delete file:', unlinkErr.message);
        }
      }
    });

    return res.status(500).json({ 
      error: 'Server internal validation engine dropped payload instantiation properties.',
      details: error.message
    });
  }
};

// 3. Update expense approval status (Pending / Approved / Rejected / Suspicious)
exports.updateExpenseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actionBy, reason, suspiciousReason } = req.body;

    const validStatuses = ['approved', 'rejected', 'pending', 'suspicious'];
    if (!validStatuses.includes(String(status).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid status. Must be approved, rejected, pending, or suspicious.' });
    }

    const normalizedStatus = String(status).toLowerCase();
    const expense = await Expense.findByPk(id);
    if (!expense) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }

    expense.status = normalizedStatus;

    if (normalizedStatus === 'suspicious') {
      expense.suspiciousReason = reason || suspiciousReason || 'Admin marked as suspicious';
      expense.actionBy = actionBy || req.user?.name || req.user?.empCode || req.user?.id || 'Admin';
    } else if (normalizedStatus === 'approved' || normalizedStatus === 'rejected') {
      expense.actionBy = actionBy || req.user?.name || req.user?.empCode || req.user?.id || 'Admin';
      // Clear suspicious reason if it was subsequently approved or rejected
      if (normalizedStatus === 'approved') {
        expense.suspiciousReason = null;
      }
    } else if (normalizedStatus === 'pending') {
      expense.actionBy = null;
      expense.suspiciousReason = null;
    }

    await expense.save();

    console.log(`--- [BACKEND] Expense ${id} status updated to ${normalizedStatus} by ${expense.actionBy} ---`);

    // Asynchronously dispatch decision & receipt email to employee if email is registered
    if (normalizedStatus === 'approved' || normalizedStatus === 'rejected') {
      (async () => {
        try {
          const emp = await Employee.findOne({
            where: {
              [sequelize.Sequelize.Op.or]: [
                { id: expense.userId },
                { empCode: expense.userId }
              ]
            }
          });

          if (emp && emp.email && emp.email.includes('@')) {
            console.log(`✉️ [Expense Hook] Dispatching receipt email to ${emp.email} for expense #${expense.id}`);
            await EmailService.sendExpenseDecisionEmail({
              to: emp.email,
              employeeName: emp.name,
              expense: expense.toJSON(),
              decision: normalizedStatus,
              actionBy: expense.actionBy,
              receiptPath: expense.invoiceUrl
            });
          } else {
            console.log(`ℹ️ [Expense Hook] No email found for employee ${expense.userId}; skipping email notification.`);
          }
        } catch (mailErr) {
          console.error('⚠️ [Expense Hook] Failed to send receipt email:', mailErr.message);
        }
      })();
    }

    return res.status(200).json(expense);
  } catch (error) {
    console.error('❌ Update expense status exception:', error);
    return res.status(500).json({ 
      error: 'Failed to update expense status.',
      details: error.message 
    });
  }
};

// 4. Update and resend expense claim (Supports edits, suspicious resubmission, and multiple attachments)
exports.updateExpense = async (req, res) => {
  const uploadedFiles = req.files && req.files.length > 0 ? req.files : (req.file ? [req.file] : []);

  try {
    const { id } = req.params;
    const { 
      category, 
      amount, 
      description, 
      billNo, 
      billDate, 
      merchantName, 
      siteName, 
      status, 
      actionBy,
      existingInvoiceUrls,
      existingInvoiceUrl
    } = req.body;

    console.log(`--- [BACKEND] API hit: Updating expense ${id} ---`, req.body);

    const expense = await Expense.findByPk(id);
    if (!expense) {
      // Clean up newly uploaded files if expense not found
      uploadedFiles.forEach(f => { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); });
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

    // Status management:
    // If status is explicitly passed, update it; otherwise reset to 'pending' on resubmission
    if (status !== undefined && ['approved', 'rejected', 'pending', 'suspicious'].includes(String(status).toLowerCase())) {
      const lowerStatus = String(status).toLowerCase();
      expense.status = lowerStatus;
      if (lowerStatus === 'approved' || lowerStatus === 'rejected' || lowerStatus === 'suspicious') {
        expense.actionBy = actionBy || req.user?.name || req.user?.empCode || req.user?.id || expense.actionBy || 'Admin';
      } else if (lowerStatus === 'pending') {
        expense.actionBy = null;
        expense.suspiciousReason = null;
      }
    } else {
      // Default employee resubmit workflow: reset to pending and clear suspiciousReason
      expense.status = 'pending';
      expense.suspiciousReason = null;
    }

    // Attachment Management:
    // 1. Gather retained existing attachment URLs
    let preservedUrls = [];
    if (existingInvoiceUrls) {
      if (Array.isArray(existingInvoiceUrls)) {
        preservedUrls = existingInvoiceUrls;
      } else if (typeof existingInvoiceUrls === 'string') {
        try {
          const parsed = JSON.parse(existingInvoiceUrls);
          if (Array.isArray(parsed)) preservedUrls = parsed;
          else preservedUrls = [existingInvoiceUrls];
        } catch (_) {
          preservedUrls = existingInvoiceUrls.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    } else if (existingInvoiceUrl) {
      preservedUrls = [existingInvoiceUrl];
    } else if (uploadedFiles.length === 0) {
      // If neither existingInvoiceUrls nor new files were sent, keep current attachments
      preservedUrls = expense.invoiceUrls || (expense.invoiceUrl ? [expense.invoiceUrl] : []);
    }

    // 2. Gather newly uploaded file URLs
    const newlyUploadedUrls = uploadedFiles.map(f => `invoices/${f.filename}`);

    // 3. Combine final attachments list
    const finalInvoiceUrls = [...preservedUrls, ...newlyUploadedUrls];

    if (finalInvoiceUrls.length > 0) {
      // Clean up any old files that were explicitly removed from the claim
      const oldUrls = expense.invoiceUrls || (expense.invoiceUrl ? [expense.invoiceUrl] : []);
      const removedUrls = oldUrls.filter(oldUrl => !finalInvoiceUrls.includes(oldUrl));
      removedUrls.forEach(safelyDeleteInvoiceFile);

      expense.invoiceUrls = finalInvoiceUrls;
      expense.invoiceUrl = finalInvoiceUrls[0];
    }

    await expense.save();
    console.log(`--- [BACKEND] Expense ${id} updated & resent successfully (${expense.invoiceUrls.length} attachments) ---`);

    if (expense.status === 'approved' || expense.status === 'rejected') {
      (async () => {
        try {
          const emp = await Employee.findOne({
            where: {
              [sequelize.Sequelize.Op.or]: [
                { id: expense.userId },
                { empCode: expense.userId }
              ]
            }
          });

          if (emp && emp.email && emp.email.includes('@')) {
            console.log(`✉️ [Expense Hook] Dispatching receipt email to ${emp.email} for expense #${expense.id}`);
            await EmailService.sendExpenseDecisionEmail({
              to: emp.email,
              employeeName: emp.name,
              expense: expense.toJSON(),
              decision: expense.status,
              actionBy: expense.actionBy,
              receiptPath: expense.invoiceUrl
            });
          }
        } catch (mailErr) {
          console.error('⚠️ [Expense Hook] Failed to send receipt email on update:', mailErr.message);
        }
      })();
    }

    return res.status(200).json({
      message: 'Expense updated and resent successfully!',
      expense
    });
  } catch (error) {
    console.error('❌ Update expense exception:', error);
    // Cleanup newly uploaded files on failure
    uploadedFiles.forEach(f => {
      if (f.path && fs.existsSync(f.path)) {
        try {
          fs.unlinkSync(f.path);
        } catch (_) {}
      }
    });

    return res.status(500).json({ 
      error: 'Failed to update expense.',
      details: error.message 
    });
  }
};
