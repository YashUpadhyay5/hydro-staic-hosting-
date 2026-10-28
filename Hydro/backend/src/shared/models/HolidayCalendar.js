const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const HolidayCalendar = sequelize.define('HolidayCalendar', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  location: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  state: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2026,
  },
  isDefault: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  holidays: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  }
}, {
  tableName: 'holiday_calendars',
  timestamps: true,
});

module.exports = HolidayCalendar;
