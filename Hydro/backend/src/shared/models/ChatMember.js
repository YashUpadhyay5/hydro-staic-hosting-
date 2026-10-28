const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ChatMember = sequelize.define('ChatMember', {
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
  role: {
    type: DataTypes.STRING,
    defaultValue: 'MEMBER', // MEMBER, ADMIN
  },
}, {
  tableName: 'chat_members',
  timestamps: true,
  underscored: true,
});

module.exports = ChatMember;
