const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expense');
const { invoicesUpload: upload } = require('../../../../core/middleware/upload');

// Fetch all expenses
router.get('/', expenseController.getAllExpenses);

// Update only the status of an expense (e.g., approve/reject)
router.patch('/:id/status', expenseController.updateExpenseStatus);

// Create a new expense claim (includes file upload handling)
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, expenseController.createExpenseClaim);

// Update an existing expense entirely (includes file upload handling)
router.put('/:id', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, expenseController.updateExpense);

module.exports = router;