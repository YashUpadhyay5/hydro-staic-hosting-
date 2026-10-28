const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Footprint = sequelize.define('Footprint', {
  id: {
    type: DataTypes.STRING(255),
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    field: 'user_id',
    allowNull: false,
  },
  timestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  trackingMethod: {
    type: DataTypes.STRING,
    field: 'tracking_method',
    allowNull: false, // GPS, CELLULAR, NETWORK, UNAVAILABLE
  },
  latitude: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  longitude: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  accuracy: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  speed: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  heading: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  altitude: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  cellId: {
    type: DataTypes.INTEGER,
    field: 'cell_id',
    allowNull: true,
  },
  lac: {
    type: DataTypes.INTEGER,
    field: 'lac',
    allowNull: true,
  },
  tac: {
    type: DataTypes.INTEGER,
    field: 'tac',
    allowNull: true,
  },
  mcc: {
    type: DataTypes.INTEGER,
    field: 'mcc',
    allowNull: true,
  },
  mnc: {
    type: DataTypes.INTEGER,
    field: 'mnc',
    allowNull: true,
  },
  signalStrength: {
    type: DataTypes.INTEGER,
    field: 'signal_strength',
    allowNull: true,
  },
  locationEnabled: {
    type: DataTypes.BOOLEAN,
    field: 'location_enabled',
    allowNull: false,
    defaultValue: true,
  },
  batteryLevel: {
    type: DataTypes.FLOAT,
    field: 'battery_level',
    allowNull: true,
  },
  batteryTemp: {
    type: DataTypes.FLOAT,
    field: 'battery_temp',
    allowNull: true,
  },
  networkType: {
    type: DataTypes.STRING,
    field: 'network_type',
    allowNull: true,
  },
  reason: {
    type: DataTypes.STRING,
    field: 'reason',
    allowNull: true,
  },
  isMockLocation: {
    type: DataTypes.BOOLEAN,
    field: 'is_mock_location',
    allowNull: false,
    defaultValue: false,
  }
}, {
  tableName: 'location_footprints',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id', 'timestamp'] },
    { fields: ['user_id', 'date'] },
    { fields: ['user_id', 'battery_level', 'timestamp'] }
  ]
});

module.exports = Footprint;
