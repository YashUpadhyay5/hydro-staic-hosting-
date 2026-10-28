const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Attachment = sequelize.define('Attachment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  messageId: {
    type: DataTypes.UUID,
    field: 'message_id',
    allowNull: false,
  },
  fileName: {
    type: DataTypes.STRING,
    field: 'file_name',
    allowNull: true,
  },
  fileUrl: {
    type: DataTypes.TEXT,
    field: 'file_url',
    allowNull: false,
  },
  fileType: {
    type: DataTypes.STRING,
    field: 'file_type',
    defaultValue: 'DOCUMENT',
  },
  fileSize: {
    type: DataTypes.INTEGER,
    field: 'file_size',
    defaultValue: 0,
  },
  mimeType: {
    type: DataTypes.STRING,
    field: 'mime_type',
    defaultValue: 'application/octet-stream',
  },
}, {
  tableName: 'attachments',
  timestamps: true,
  underscored: true,
});

module.exports = Attachment;
