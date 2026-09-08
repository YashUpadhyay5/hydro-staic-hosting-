const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Attendance = sequelize.define('Attendance', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  userName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  checkIn: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  checkOut: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  workingHours: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  coords: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  lastHeartbeat: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  heartbeatCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  missedHeartbeatCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  trackingStatus: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ACTIVE',
  },
  deviceManufacturer: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  deviceModel: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  androidVersion: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  batteryLevel: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  networkType: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  gpsEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: true,
  },
  trackingReliabilityScore: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  notificationCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  lastNotificationTime: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  recoveryTime: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  trackingInterruptedDuration: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  workMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'office',
  },
  isSwitched: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  checkInMethod: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  clockOutMethod: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  shiftCode: {
    type: DataTypes.STRING,
    allowNull: true,
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['userId', 'date'] },
    { fields: ['createdAt'] }
  ]
});

module.exports = Attendance;
