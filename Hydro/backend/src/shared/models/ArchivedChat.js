const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ArchivedChat = sequelize.define('ArchivedChat', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  chatId: {
    type: DataTypes.UUID,
    field: 'chat_id',
    allowNull: false,
  },
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: false,
  },
}, {
  tableName: 'archived_chats',
  timestamps: true,
  underscored: true,
});

module.exports = ArchivedChat;
