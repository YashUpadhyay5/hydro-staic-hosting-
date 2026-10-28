const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  target: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  targetId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'target_id'
  },
  scheduleAt: {
    type: DataTypes.DATE,
    field: 'schedule_at'
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'PENDING'
  },
  createdBy: {
    type: DataTypes.STRING,
    field: 'created_by'
  },
  payload: {
    type: DataTypes.TEXT,
    allowNull: true,
  }
}, {
  tableName: 'notifications',
  timestamps: true,
  underscored: true
});

module.exports = Notification;
