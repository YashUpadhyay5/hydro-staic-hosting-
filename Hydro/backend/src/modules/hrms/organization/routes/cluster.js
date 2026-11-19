const express = require('express');
const router = express.Router();
const Cluster = require('../../../../shared/models/Cluster');
const ClusterSetting = require('../../../../shared/models/ClusterSetting');
const Media = require('../../../../shared/models/Media');
const Geofence = require('../../../../shared/models/Geofence');

// GET all office geofence locations as clusters (with associated photos grouped by site)
router.get('/', async (req, res) => {
  try {
    const geofences = await Geofence.findAll({
      where: {
        category: 'SITE'
      },
      include: [{
        model: Media,
        as: 'media',
        order: [['timestamp', 'DESC']]
      }],
      order: [['name', 'ASC']]
    });

    // Map Geofence fields to Cluster shape so frontend works unchanged
    const siteAsClusters = geofences.map(g => ({
      id: g.id,
      name: g.name,
      centerLatitude: g.latitude,
      centerLongitude: g.longitude,
      radius: g.radius,
      media: g.media || [],
      createdAt: g.createdAt,
      updatedAt: g.updatedAt
    }));

    return res.status(200).json(siteAsClusters);
  } catch (err) {
    console.error('Error fetching office geofence clusters:', err);
    return res.status(500).json({ error: 'Failed to retrieve site clusters.' });
  }
});

// GET current cluster settings
router.get('/settings', async (req, res) => {
  try {
    let setting = await ClusterSetting.findByPk(1);
    if (!setting) {
      setting = await ClusterSetting.create({ id: 1, clusterRadius: 500 });
    }
    return res.status(200).json(setting);
  } catch (err) {
    console.error('Error fetching cluster settings:', err);
    return res.status(500).json({ error: 'Failed to retrieve cluster settings.' });
  }
});

// POST update cluster settings
router.post('/settings', async (req, res) => {
  try {
    const { clusterRadius } = req.body;
    const rad = parseInt(clusterRadius, 10);
    if (isNaN(rad) || rad <= 0) {
      return res.status(400).json({ error: 'Please enter a valid radius greater than 0.' });
    }

    let setting = await ClusterSetting.findByPk(1);
    if (!setting) {
      setting = await ClusterSetting.create({ id: 1, clusterRadius: rad });
    } else {
      setting.clusterRadius = rad;
      await setting.save();
    }

    console.log(`[Cluster Settings] Updated cluster radius threshold to: ${rad} meters`);
    return res.status(200).json(setting);
  } catch (err) {
    console.error('Error updating cluster settings:', err);
    return res.status(500).json({ error: 'Failed to update cluster settings.' });
  }
});

// PUT rename geofence site (called from cluster rename UI)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Site name cannot be empty.' });
    }

    const gf = await Geofence.findByPk(id);
    if (!gf) {
      return res.status(404).json({ error: 'Site not found.' });
    }

    gf.name = name.trim();
    await gf.save();

    console.log(`[Site Clusters] Renamed geofence site ID ${id} to: ${gf.name}`);
    return res.status(200).json({ id: gf.id, name: gf.name });
  } catch (err) {
    console.error('Error updating site name:', err);
    return res.status(500).json({ error: 'Failed to update site name.' });
  }
});

module.exports = router;
