const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Media = sequelize.define('Media', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    field: 'user_id',
    allowNull: false,
  },
  userName: {
    type: DataTypes.STRING,
    field: 'user_name',
    allowNull: false,
  },
  filePath: {
    type: DataTypes.STRING,
    field: 'file_path',
    allowNull: false,
  },
  mediaType: {
    type: DataTypes.STRING,
    field: 'media_type',
    allowNull: false, // 'image' or 'video'
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
  cloudinaryUrl: {
    type: DataTypes.STRING,
    field: 'cloudinary_url',
    allowNull: true,
  },
  timestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  siteId: {
    type: DataTypes.INTEGER,
    field: 'site_id',
    allowNull: true,
    references: {
      model: 'sites',
      key: 'id'
    }
  },
  clusterId: {
    type: DataTypes.INTEGER,
    field: 'cluster_id',
    allowNull: true,
    references: {
      model: 'clusters',
      key: 'id'
    }
  }
}, {
  tableName: 'geotagged_media',
  timestamps: true,
  underscored: true
});

const Site = require('./Site');
Media.belongsTo(Site, { foreignKey: 'siteId', as: 'site' });
Site.hasMany(Media, { foreignKey: 'siteId', as: 'media' });

const Cluster = require('./Cluster');
Media.belongsTo(Cluster, { foreignKey: 'clusterId', as: 'cluster' });
Cluster.hasMany(Media, { foreignKey: 'clusterId', as: 'media' });

const fs = require('fs');
const path = require('path');

Media.afterDestroy(async (mediaItem, options) => {
  try {
    const { getStoragePath } = require('../../core/middleware/upload');
    let fullPath;
    if (mediaItem.filePath) {
      if (mediaItem.filePath.startsWith('/static/uploads/')) {
        const filename = path.basename(mediaItem.filePath);
        fullPath = path.join(__dirname, '..', 'uploads', filename);
      } else {
        fullPath = path.join(getStoragePath(), mediaItem.filePath);
      }
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[Sequelize Hook] Automatically deleted physical file: ${fullPath}`);
      }
    }
  } catch (err) {
    console.error(`[Sequelize Hook Error] Failed to delete file for media ${mediaItem.id}:`, err.message);
  }
});

module.exports = Media;
