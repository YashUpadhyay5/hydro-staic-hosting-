const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Geofence = sequelize.define('Geofence', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Office Geofence',
  },
  latitude: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    defaultValue: 28.6692,
  },
  longitude: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    defaultValue: 77.4538,
  },
  radius: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    defaultValue: 300.0, // in meters
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'SITE', // 'SITE' or 'HOUSE'
  },
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: true,
  }
}, {
  tableName: 'location_geofence_settings',
  timestamps: true,
  underscored: true
});

module.exports = Geofence;
