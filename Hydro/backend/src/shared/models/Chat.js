const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Chat = sequelize.define('Chat', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  type: {
    type: DataTypes.STRING,
    defaultValue: 'DIRECT', // DIRECT, GROUP
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  lastMessageText: {
    type: DataTypes.TEXT,
    field: 'last_message_text',
    allowNull: true,
  },
  lastMessageAt: {
    type: DataTypes.DATE,
    field: 'last_message_at',
    allowNull: true,
  },
}, {
  tableName: 'chats',
  timestamps: true,
  underscored: true,
});

module.exports = Chat;
