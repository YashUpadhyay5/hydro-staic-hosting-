const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const OtpVerification = sequelize.define('OtpVerification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  employeeId: {
    type: DataTypes.STRING,
    field: 'employee_id',
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  otpHash: {
    type: DataTypes.STRING,
    field: 'otp_hash',
    allowNull: false,
  },
  purpose: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'PASSWORD_RESET',
  },
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  isUsed: {
    type: DataTypes.BOOLEAN,
    field: 'is_used',
    allowNull: false,
    defaultValue: false,
  },
  resetToken: {
    type: DataTypes.STRING,
    field: 'reset_token',
    allowNull: true,
  },
  expiresAt: {
    type: DataTypes.DATE,
    field: 'expires_at',
    allowNull: false,
  },
}, {
  tableName: 'otp_verifications',
  timestamps: true,
  underscored: true,
});

module.exports = OtpVerification;
