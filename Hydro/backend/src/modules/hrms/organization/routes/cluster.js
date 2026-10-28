const express = require('express');
const router = express.Router();
const Cluster = require('../../../../shared/models/Cluster');
const ClusterSetting = require('../../../../shared/models/ClusterSetting');
const Media = require('../../../../shared/models/Media');

// GET all auto-created clusters and their associated photos
router.get('/', async (req, res) => {
  try {
    const clusters = await Cluster.findAll({
      include: [{
        model: Media,
        as: 'media',
        order: [['timestamp', 'DESC']]
      }],
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(clusters);
  } catch (err) {
    console.error('Error fetching clusters:', err);
    return res.status(500).json({ error: 'Failed to retrieve spatial clusters.' });
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

// PUT rename cluster
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Cluster name cannot be empty.' });
    }

    const cluster = await Cluster.findByPk(id);
    if (!cluster) {
      return res.status(404).json({ error: 'Cluster not found.' });
    }

    cluster.name = name.trim();
    await cluster.save();

    console.log(`[Clusters] Renamed cluster ID ${id} to: ${cluster.name}`);
    return res.status(200).json(cluster);
  } catch (err) {
    console.error('Error updating cluster name:', err);
    return res.status(500).json({ error: 'Failed to update cluster name.' });
  }
});

module.exports = router;
