const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ReadReceipt = sequelize.define('ReadReceipt', {
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
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: false,
  },
  readAt: {
    type: DataTypes.DATE,
    field: 'read_at',
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'read_receipts',
  timestamps: true,
  underscored: true,
});

module.exports = ReadReceipt;
