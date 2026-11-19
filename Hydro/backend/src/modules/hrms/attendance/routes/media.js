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
        whereClause.siteId = null;
      } else {
        whereClause.siteId = cluster_id;
      }
    }

    const mediaList = await Media.findAll({
      where: whereClause,
      include: ['site', 'cluster', 'geofence'],
      order: [['timestamp', 'DESC']]
    });

    const enrichedList = mediaList.map(m => {
      const plain = m.toJSON();
      if (plain.geofence) {
        plain.site = plain.geofence;
      }
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

    // 1. Dynamic Office Geofence classification (matches the 158 sites from Office Geofence Configuration)
    const Geofence = require('../../../../shared/models/Geofence');
    const { getDistance } = require('../../../../core/utils/siteCache');
    let siteId = null;

    if (latitude && longitude) {
      const latNum = parseFloat(latitude);
      const lonNum = parseFloat(longitude);
      if (!isNaN(latNum) && !isNaN(lonNum)) {
        try {
          const geofences = await Geofence.findAll();
          let closestGf = null;
          let minDist = Infinity;
          for (const gf of geofences) {
            const dist = getDistance(latNum, lonNum, Number(gf.latitude), Number(gf.longitude));
            const maxAllowed = (Number(gf.radius) || 300) + 30; // 30m GPS drift buffer
            if (dist <= maxAllowed && dist < minDist) {
              minDist = dist;
              closestGf = gf;
            }
          }
          if (closestGf) {
            siteId = closestGf.id;
          }
        } catch (gfErr) {
          console.warn('[Media Upload] Geofence resolution error:', gfErr.message);
        }
      }
    }

    // 2. Photo groups under matched Geofence Site
    const clusterId = null;

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
      include: ['site', 'cluster', 'geofence']
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
