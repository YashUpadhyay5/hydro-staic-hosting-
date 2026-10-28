const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');
const fs = require('fs');
const path = require('path');

const Expense = sequelize.define('Expense', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  userName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  amount: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  billNo: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  billDate: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  siteName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  merchantName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  invoiceUrl: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
  },
  actionBy: {
    type: DataTypes.STRING,
    allowNull: true,
  }
}, {
  timestamps: true,
});

// Sequelize Hook: Automatically deletes the physical file when a record is destroyed
Expense.afterDestroy(async (expense, options) => {
  try {
    const { getStoragePath } = require('../../core/middleware/upload');
    let fullPath;
    
    if (expense.invoiceUrl) {
      if (expense.invoiceUrl.startsWith('/static/uploads/')) {
        const filename = path.basename(expense.invoiceUrl);
        fullPath = path.join(__dirname, '..', 'uploads', filename);
      } else {
        fullPath = path.join(getStoragePath(), expense.invoiceUrl);
      }
      
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[Sequelize Hook] Automatically deleted physical file: ${fullPath}`);
      }
    }
  } catch (err) {
    console.error(`[Sequelize Hook Error] Failed to delete file for expense ${expense.id}:`, err.message);
  }
});

module.exports = Expense;