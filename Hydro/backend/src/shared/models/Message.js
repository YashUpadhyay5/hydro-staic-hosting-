const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Message = sequelize.define('Message', {
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
  senderId: {
    type: DataTypes.STRING,
    field: 'sender_id',
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  type: {
    type: DataTypes.STRING,
    defaultValue: 'TEXT', // TEXT, IMAGE, DOCUMENT, AUDIO, VIDEO
  },
  parentMessageId: {
    type: DataTypes.UUID,
    field: 'parent_message_id',
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'SENT', // SENT, DELIVERED, READ
  },
}, {
  tableName: 'messages',
  timestamps: true,
  underscored: true,
});

module.exports = Message;
