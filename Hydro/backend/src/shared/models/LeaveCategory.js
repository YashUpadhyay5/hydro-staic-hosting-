const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// Special leave categories (Marriage / Paternity / Maternity). A leave request carrying one of these
// codes has its own allowance: it never uses Earned Leave and never becomes LOP.
const LeaveCategory = sequelize.define('LeaveCategory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // stable key the app sends, e.g. 'marriage'
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  durationValue: {
    type: DataTypes.INTEGER,
    field: 'duration_value',
    allowNull: false,
    validate: { min: 1 },
  },
  durationUnit: {
    type: DataTypes.STRING,
    field: 'duration_unit',
    allowNull: false,
    defaultValue: 'days',
    validate: { isIn: [['days', 'months']] },
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    field: 'is_active',
    allowNull: false,
    defaultValue: true,
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    field: 'sort_order',
    allowNull: false,
    defaultValue: 0,
  }
}, {
  tableName: 'location_leave_categories',
  timestamps: true,
  underscored: true
});

module.exports = LeaveCategory;
