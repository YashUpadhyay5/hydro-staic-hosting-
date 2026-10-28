const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Setting = sequelize.define('Setting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  config_version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  punch_in_start: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '08:30',
  },
  punch_in_end: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '10:00',
  },
  punch_out_time: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '18:00',
  },
  location_provider: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'GPS Preferred',
  },
  gps_ratio_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  cellular_ratio_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 6,
  },
  location_update_interval: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '30 Seconds',
  },
  grace_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 15,
  },
  half_day_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 240,
  },
  full_day_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 480,
  },
  min_working_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 240,
  },
  max_working_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 720,
  },
  overtime_threshold_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 480,
  },
  auto_sync_interval_seconds: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 30,
  },
  allow_cross_day: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  }
}, {
  tableName: 'settings',
  timestamps: true,
  underscored: true
});

module.exports = Setting;
