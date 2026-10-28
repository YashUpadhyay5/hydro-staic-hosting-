const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Document = sequelize.define('Document', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  filePath: {
    type: DataTypes.STRING,
    field: 'file_path',
    allowNull: false,
  },
  uploaderId: {
    type: DataTypes.STRING,
    field: 'uploader_id',
    allowNull: false,
  },
  uploaderName: {
    type: DataTypes.STRING,
    field: 'uploader_name',
    allowNull: false,
  },
  targetType: {
    type: DataTypes.STRING,
    field: 'target_type', // 'ALL', 'INDIVIDUAL', or 'ADMIN'
    allowNull: false,
  },
  targetUserId: {
    type: DataTypes.STRING,
    field: 'target_user_id',
    allowNull: true,
  },
  targetUserName: {
    type: DataTypes.STRING,
    field: 'target_user_name',
    allowNull: true,
  },
  fileType: {
    type: DataTypes.STRING,
    field: 'file_type',
    allowNull: true,
  },
  fileSize: {
    type: DataTypes.INTEGER,
    field: 'file_size',
    allowNull: true,
  },
  uploadedAt: {
    type: DataTypes.BIGINT,
    field: 'uploaded_at',
    allowNull: false,
  }
}, {
  tableName: 'location_documents',
  timestamps: true,
  underscored: true
});

const fs = require('fs');
const path = require('path');

Document.afterDestroy(async (document, options) => {
  try {
    const { getStoragePath } = require('../../core/middleware/upload');
    let fullPath;
    if (document.filePath) {
      if (document.filePath.startsWith('/static/uploads/')) {
        const filename = path.basename(document.filePath);
        fullPath = path.join(__dirname, '..', 'uploads', filename);
      } else {
        fullPath = path.join(getStoragePath(), document.filePath);
      }
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[Sequelize Hook] Automatically deleted physical file: ${fullPath}`);
      }
    }
  } catch (err) {
    console.error(`[Sequelize Hook Error] Failed to delete file for document ${document.id}:`, err.message);
  }
});

module.exports = Document;
