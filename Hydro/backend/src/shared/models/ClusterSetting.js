const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ClusterSetting = sequelize.define('ClusterSetting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  clusterRadius: {
    type: DataTypes.INTEGER,
    field: 'cluster_radius',
    allowNull: false,
    defaultValue: 500, // in meters
  }
}, {
  tableName: 'cluster_settings',
  timestamps: true,
  underscored: true
});

module.exports = ClusterSetting;
