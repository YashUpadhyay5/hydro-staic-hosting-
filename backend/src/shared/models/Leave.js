const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Leave = sequelize.define('Leave', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    field: 'user_id',
    allowNull: false,
  },
  userName: {
    type: DataTypes.STRING,
    field: 'user_name',
    allowNull: false,
  },
  startDate: {
    type: DataTypes.STRING,
    field: 'start_date',
    allowNull: false,
  },
  endDate: {
    type: DataTypes.STRING,
    field: 'end_date',
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pending', // pending, approved, rejected
  },
  elDays: {
    type: DataTypes.INTEGER,
    field: 'el_days',
    allowNull: false,
    defaultValue: 0,
  },
  lopDays: {
    type: DataTypes.INTEGER,
    field: 'lop_days',
    allowNull: false,
    defaultValue: 0,
  },
  totalDays: {
    type: DataTypes.INTEGER,
    field: 'total_days',
    allowNull: false,
    defaultValue: 0,
  },
  appliedAt: {
    type: DataTypes.BIGINT,
    field: 'applied_at',
    allowNull: false,
  },
  actionBy: {
    type: DataTypes.STRING,
    field: 'action_by',
    allowNull: true,
  }
}, {
  tableName: 'location_leaves',
  timestamps: true,
  underscored: true
});

module.exports = Leave;
