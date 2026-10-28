const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Cluster = sequelize.define('Cluster', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  centerLatitude: {
    type: DataTypes.DOUBLE,
    field: 'center_lat',
    allowNull: false,
  },
  centerLongitude: {
    type: DataTypes.DOUBLE,
    field: 'center_lng',
    allowNull: false,
  },
  radius: {
    type: DataTypes.INTEGER,
    allowNull: false,
  }
}, {
  tableName: 'clusters',
  timestamps: true,
  underscored: true
});

module.exports = Cluster;
