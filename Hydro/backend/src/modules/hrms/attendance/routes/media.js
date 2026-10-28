const express = require('express');
const router = express.Router();
const Media = require('../../../../shared/models/Media');
const Employee = require('../../../../shared/models/Employee');
const sequelize = require('../../../../config/database');
const { Op } = require('sequelize');
const { imagesUpload: upload, getStoragePath } = require('../../../../core/middleware/upload');
const fs = require('fs');
const path = require('path');

// Helper to find employee by id, emp_code, or name
async function findEmployee(identifier, name) {
  if (!identifier && !name) return null;
  let emp = null;
  if (identifier) {
    emp = await Employee.findOne({
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('id')), String(identifier).toLowerCase()),
          sequelize.where(sequelize.fn('lower', sequelize.col('emp_code')), String(identifier).toLowerCase())
        ]
      }
    });
  }
  if (!emp && name) {
    emp = await Employee.findOne({
      where: sequelize.where(sequelize.fn('lower', sequelize.col('name')), String(name).toLowerCase())
    });
  }
  return emp;
}

// GET all geotagged media
router.get('/', async (req, res) => {
  try {
    const { userId, site_id, cluster_id } = req.query;
    const whereClause = {};
    
    // Fetch employee mapping for enrichment
    const employees = await Employee.findAll();
    const empMap = new Map();
    employees.forEach(emp => {
      if (emp.id) empMap.set(String(emp.id).toLowerCase(), emp);
      if (emp.empCode) empMap.set(String(emp.empCode).toLowerCase(), emp);
      if (emp.name) empMap.set(String(emp.name).toLowerCase(), emp);
    });

    if (userId) {
      const emp = empMap.get(String(userId).toLowerCase());
      const possibleIds = [String(userId).toLowerCase()];
      if (emp) {
        if (emp.id) possibleIds.push(String(emp.id).toLowerCase());
        if (emp.empCode) possibleIds.push(String(emp.empCode).toLowerCase());
      }
      whereClause.userId = { [Op.in]: possibleIds };
    }
    
    if (site_id !== undefined && site_id !== '') {
      if (site_id === 'null' || site_id === 'unassigned') {
        whereClause.siteId = null;
      } else {
        whereClause.siteId = site_id;
      }
    }

    if (cluster_id !== undefined && cluster_id !== '') {
      if (cluster_id === 'null' || cluster_id === 'unassigned') {
        whereClause.clusterId = null;
      } else {
        whereClause.clusterId = cluster_id;
      }
    }

    const mediaList = await Media.findAll({
      where: whereClause,
      include: ['site', 'cluster'],
      order: [['timestamp', 'DESC']]
    });

    const enrichedList = mediaList.map(m => {
      const plain = m.toJSON();
      const emp = empMap.get(String(plain.userId || '').toLowerCase()) || 
                  empMap.get(String(plain.userName || '').toLowerCase());
      if (emp) {
        plain.userId = emp.empCode || emp.id;
        plain.empCode = emp.empCode || emp.id;
        plain.userName = emp.name || plain.userName;
      } else {
        plain.empCode = plain.userId;
      }
      return plain;
    });

    return res.status(200).json(enrichedList);
  } catch (error) {
    console.error('Error fetching media list:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST upload geotagged media
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('❌ Multer upload error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const {
      userId,
      userName,
      latitude,
      longitude,
      address,
      mediaType,
      timestamp,
      date
    } = req.body;

    const rawUserId = userId || (req.user && req.user.id);
    const emp = await findEmployee(rawUserId, userName);
    const finalUserId = emp ? (emp.empCode || emp.id) : (rawUserId || 'SYSTEM');
    const finalUserName = emp ? emp.name : (userName || 'Employee');

    // Use relative path for database storage
    const filePath = `images/${req.file.filename}`;
    const cloudinaryUrl = null; // Removed Cloudinary integration for offline self-hosted mode

    // 1. Dynamic Site classification
    const { findNearestSite, getDistance } = require('../../../../core/utils/siteCache');
    const matchedSite = findNearestSite(latitude, longitude);
    const siteId = matchedSite ? matchedSite.id : null;

    // 2. Dynamic Cluster classification
    let clusterId = null;
    if (latitude && longitude) {
      const Cluster = require('../../../../shared/models/Cluster');
      const ClusterSetting = require('../../../../shared/models/ClusterSetting');
      
      // Get settings
      let setting = await ClusterSetting.findByPk(1);
      const radiusThreshold = setting ? setting.clusterRadius : 500;

      const latNum = parseFloat(latitude);
      const lonNum = parseFloat(longitude);

      // Find matching cluster
      const clusters = await Cluster.findAll();
      let matchedCluster = null;
      let minDistance = Infinity;
      const GPS_BUFFER = 20; // 20m GPS noise buffer

      for (const cl of clusters) {
        const dist = getDistance(latNum, lonNum, cl.centerLatitude, cl.centerLongitude);
        if (dist <= (radiusThreshold + GPS_BUFFER)) {
          if (dist < minDistance) {
            minDistance = dist;
            matchedCluster = cl;
          }
        }
      }

      if (matchedCluster) {
        clusterId = matchedCluster.id;
        // Update cluster center average
        const siblings = await Media.findAll({ where: { clusterId: matchedCluster.id } });
        const lats = [...siblings.map(s => s.latitude), latNum].filter(l => l !== null);
        const lons = [...siblings.map(s => s.longitude), lonNum].filter(l => l !== null);
        
        matchedCluster.centerLatitude = lats.reduce((a, b) => a + b, 0) / lats.length;
        matchedCluster.centerLongitude = lons.reduce((a, b) => a + b, 0) / lons.length;
        await matchedCluster.save();
      } else {
        // Create new cluster
        const count = await Cluster.count();
        let clusterName = `Cluster #${count + 1}`;
        if (address) {
          const parts = address.split(',').map(p => p.trim()).filter(Boolean);
          if (parts.length > 0) {
            const firstPart = parts[0];
            const hasPlus = firstPart.includes('+');
            const isShortNumeric = /^\d+[\d\/\-\s]*$/.test(firstPart);
            if ((hasPlus || isShortNumeric) && parts.length > 1) {
              clusterName = parts.slice(1, 3).join(', ');
            } else {
              clusterName = parts.slice(0, 2).join(', ');
            }
          }
        }

        const newCluster = await Cluster.create({
          name: clusterName,
          centerLatitude: latNum,
          centerLongitude: lonNum,
          radius: radiusThreshold
        });
        clusterId = newCluster.id;
      }
    }

    const newMedia = await Media.create({
      userId: finalUserId,
      userName: finalUserName,
      filePath,
      cloudinaryUrl,
      mediaType,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      address: address || null,
      timestamp: timestamp ? parseInt(timestamp, 10) : Date.now(),
      date: date || new Date().toISOString().split('T')[0],
      siteId,
      clusterId
    });

    // Load with associations for immediate frontend updates
    const finalMedia = await Media.findByPk(newMedia.id, {
      include: ['site', 'cluster']
    });

    console.log(`[Storage Log] Geotagged media uploaded successfully. DB ID: ${newMedia.id}, Site ID: ${siteId}, Cluster ID: ${clusterId}`);
    return res.status(201).json(finalMedia);
  } catch (error) {
    console.error('Error creating geotagged media:', error);
    // Clean up file if error occurs
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`[Storage Log] Deleted orphaned media file after error: ${req.file.path}`);
    }
    return res.status(500).json({ error: error.message });
  }
});

// DELETE a geotagged media by ID
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const mediaItem = await Media.findByPk(id);
    if (!mediaItem) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Resolve physical path dynamically
    let fullPath;
    if (mediaItem.filePath.startsWith('/static/uploads/')) {
      // Legacy uploads folder
      const filename = path.basename(mediaItem.filePath);
      fullPath = path.join(__dirname, '..', 'uploads', filename);
    } else {
      // New storage folder
      fullPath = path.join(getStoragePath(), mediaItem.filePath);
    }

    // Attempt to delete physical file from disk
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`[Storage Log] Deleted file: ${fullPath}`);
      } catch (err) {
        console.error(`[Storage Log Error] Failed to delete file ${fullPath}:`, err.message);
      }
    } else {
      console.warn(`[Storage Log Warning] File not found on disk during deletion: ${fullPath}`);
    }

    await mediaItem.destroy();
    console.log(`[Storage Log] Media DB record deleted: ${id}`);
    return res.status(200).json({ message: 'Media deleted successfully' });
  } catch (error) {
    console.error('Error deleting media:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
