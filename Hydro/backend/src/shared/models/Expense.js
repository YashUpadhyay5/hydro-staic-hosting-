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
    type: DataTypes.TEXT,
    allowNull: true,
  },
  invoiceUrls: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const rawValue = this.getDataValue('invoiceUrls');
      if (rawValue) {
        try {
          const parsed = JSON.parse(rawValue);
          if (Array.isArray(parsed)) return parsed;
        } catch (e) {
          if (typeof rawValue === 'string') return [rawValue];
        }
      }
      const single = this.getDataValue('invoiceUrl');
      return single ? [single] : [];
    },
    set(val) {
      if (Array.isArray(val)) {
        this.setDataValue('invoiceUrls', JSON.stringify(val));
      } else if (typeof val === 'string' && val.trim()) {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            this.setDataValue('invoiceUrls', val);
          } else {
            this.setDataValue('invoiceUrls', JSON.stringify([val]));
          }
        } catch (e) {
          this.setDataValue('invoiceUrls', JSON.stringify([val]));
        }
      } else {
        this.setDataValue('invoiceUrls', null);
      }
    }
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'pending',
  },
  suspiciousReason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  actionBy: {
    type: DataTypes.STRING,
    allowNull: true,
  }
}, {
  timestamps: true,
});

// Sequelize Hook: Automatically deletes the physical files when a record is destroyed
Expense.afterDestroy(async (expense, options) => {
  try {
    const { getStoragePath } = require('../../core/middleware/upload');
    const urlsToDelete = new Set();
    
    // Check invoiceUrls
    const urls = expense.invoiceUrls;
    if (Array.isArray(urls)) {
      urls.forEach(u => { if (u) urlsToDelete.add(u); });
    }
    if (expense.invoiceUrl) {
      urlsToDelete.add(expense.invoiceUrl);
    }
    
    for (const url of urlsToDelete) {
      let fullPath;
      if (url.startsWith('/static/uploads/')) {
        const filename = path.basename(url);
        fullPath = path.join(__dirname, '..', 'uploads', filename);
      } else {
        fullPath = path.join(getStoragePath(), url);
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
