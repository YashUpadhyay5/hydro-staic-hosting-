const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Acknowledgment = sequelize.define('Acknowledgment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  employee_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  employee_email: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  device_info: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  ip_address: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  terms_version: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'v1.0',
  },
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ACCEPTED',
  }
}, {
  tableName: 'legal_acknowledgments',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id', 'accepted_at']
    }
  ]
});

module.exports = Acknowledgment;
