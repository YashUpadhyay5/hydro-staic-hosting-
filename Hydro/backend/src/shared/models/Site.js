const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Site = sequelize.define('Site', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  latitude: {
    type: DataTypes.DOUBLE,
    allowNull: false,
  },
  longitude: {
    type: DataTypes.DOUBLE,
    allowNull: false,
  },
  radius: {
    type: DataTypes.DOUBLE,
    allowNull: false, // in meters
    defaultValue: 300.0,
  }
}, {
  tableName: 'sites',
  timestamps: true,
  underscored: true
});

module.exports = Site;
