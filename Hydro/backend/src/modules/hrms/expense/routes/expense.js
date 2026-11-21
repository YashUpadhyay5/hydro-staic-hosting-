const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expense');
const { invoicesUpload: upload } = require('../../../../core/middleware/upload');

// Fetch all expenses
router.get('/', expenseController.getAllExpenses);

// Admin update expense status (pending, approved, rejected, suspicious)
router.patch('/:id/status', expenseController.updateExpenseStatus);

// Employee edit and resend claim (supports multipart multiple files)
router.put('/:id', (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, expenseController.updateExpense);

// Employee create new expense claim (supports multipart multiple files)
router.post('/', (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, expenseController.createExpenseClaim);

module.exports = router;
