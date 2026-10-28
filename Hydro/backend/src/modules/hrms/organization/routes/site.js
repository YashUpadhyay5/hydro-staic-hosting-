const express = require('express');
const router = express.Router();
const Site = require('../../../../shared/models/Site');
const { loadSites } = require('../../../../core/utils/siteCache');

// GET all sites
router.get('/', async (req, res) => {
  try {
    const sites = await Site.findAll({
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(sites);
  } catch (err) {
    console.error('Error fetching sites:', err);
    return res.status(500).json({ error: 'Failed to retrieve site configuration.' });
  }
});

// POST create a site
router.post('/', async (req, res) => {
  try {
    const { name, latitude, longitude, radius } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Site name is required.' });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const rad = parseFloat(radius);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
    }

    if (isNaN(rad) || rad <= 0) {
      return res.status(400).json({ error: 'Please enter a valid radius greater than 0.' });
    }

    const newSite = await Site.create({
      name: name.trim(),
      latitude: lat,
      longitude: lon,
      radius: rad
    });

    console.log(`[Site API] Created new site: ${newSite.name} (ID: ${newSite.id})`);
    
    // Reload memory cache
    await loadSites();

    return res.status(201).json(newSite);
  } catch (err) {
    console.error('Error creating site:', err);
    return res.status(500).json({ error: 'Failed to create site configuration.' });
  }
});

// PUT update a site
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, latitude, longitude, radius } = req.body;

    const site = await Site.findByPk(id);
    if (!site) {
      return res.status(404).json({ error: 'Site not found.' });
    }

    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Site name cannot be empty.' });
      }
      site.name = name.trim();
    }

    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (isNaN(lat)) return res.status(400).json({ error: 'Invalid latitude value.' });
      site.latitude = lat;
    }

    if (longitude !== undefined) {
      const lon = parseFloat(longitude);
      if (isNaN(lon)) return res.status(400).json({ error: 'Invalid longitude value.' });
      site.longitude = lon;
    }

    if (radius !== undefined) {
      const rad = parseFloat(radius);
      if (isNaN(rad) || rad <= 0) return res.status(400).json({ error: 'Radius must be a positive number.' });
      site.radius = rad;
    }

    await site.save();
    console.log(`[Site API] Updated site configuration for ID: ${id}`);

    // Reload memory cache
    await loadSites();

    return res.status(200).json(site);
  } catch (err) {
    console.error('Error updating site:', err);
    return res.status(500).json({ error: 'Failed to update site configuration.' });
  }
});

// DELETE a site
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const site = await Site.findByPk(id);
    if (!site) {
      return res.status(404).json({ error: 'Site not found.' });
    }

    await site.destroy();
    console.log(`[Site API] Deleted site configuration for ID: ${id}`);

    // Reload memory cache
    await loadSites();

    return res.status(200).json({ message: 'Site configuration deleted successfully.' });
  } catch (err) {
    console.error('Error deleting site:', err);
    return res.status(500).json({ error: 'Failed to delete site configuration.' });
  }
});

module.exports = router;
