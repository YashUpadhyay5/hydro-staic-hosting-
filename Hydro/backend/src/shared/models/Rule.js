const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Rule = sequelize.define('Rule', {
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  value: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  label: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
  }
}, {
  tableName: 'system_rules',
  timestamps: true,
  underscored: true
});

module.exports = Rule;
