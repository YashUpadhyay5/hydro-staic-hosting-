const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const PinnedChat = sequelize.define('PinnedChat', {
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
  tableName: 'pinned_chats',
  timestamps: true,
  underscored: true,
});

module.exports = PinnedChat;
