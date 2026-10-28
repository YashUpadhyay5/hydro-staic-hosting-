const express = require('express');
const router = express.Router();
const Geofence = require('../../../../shared/models/Geofence');

// GET all active geofence settings
router.get('/', async (req, res) => {
  try {
    const list = await Geofence.findAll({
      order: [['createdAt', 'ASC']]
    });

    if (list.length === 0) {
      // Return default if none created
      return res.status(200).json([{
        id: 1,
        name: 'Default Office',
        latitude: 28.6692,
        longitude: 77.4538,
        radius: 100.0
      }]);
    }
    return res.status(200).json(list);
  } catch (error) {
    console.error('Error fetching geofences:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST Create a new geofence boundary
router.post('/', async (req, res) => {
  try {
    const { name, latitude, longitude, radius } = req.body;
    if (latitude === undefined || longitude === undefined || radius === undefined) {
      return res.status(400).json({ error: 'Latitude, longitude and radius are required.' });
    }

    const newGf = await Geofence.create({
      name: name || 'Office Geofence',
      latitude: Number(latitude),
      longitude: Number(longitude),
      radius: Number(radius)
    });

    return res.status(201).json(newGf);
  } catch (error) {
    console.error('Error creating geofence:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST Bulk create geofences
router.post('/bulk', async (req, res) => {
  try {
    const { sites } = req.body;
    if (!Array.isArray(sites) || sites.length === 0) {
      return res.status(400).json({ error: 'Sites array is required.' });
    }

    const createdSites = [];
    for (const site of sites) {
      const { name, latitude, longitude, radius } = site;
      if (latitude !== undefined && longitude !== undefined && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
        const newGf = await Geofence.create({
          name: name || 'Office Geofence',
          latitude: Number(latitude),
          longitude: Number(longitude),
          radius: Number(radius) || 100
        });
        createdSites.push(newGf);
      }
    }

    return res.status(201).json({ success: true, count: createdSites.length, data: createdSites });
  } catch (error) {
    console.error('Error bulk creating geofences:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT Update an existing geofence
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, latitude, longitude, radius } = req.body;

    const gf = await Geofence.findByPk(id);
    if (!gf) {
      return res.status(404).json({ error: 'Geofence not found.' });
    }

    if (name !== undefined) gf.name = name;
    if (latitude !== undefined) gf.latitude = Number(latitude);
    if (longitude !== undefined) gf.longitude = Number(longitude);
    if (radius !== undefined) gf.radius = Number(radius);

    await gf.save();
    return res.status(200).json(gf);
  } catch (error) {
    console.error('Error updating geofence:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE Geofence by ID
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedCount = await Geofence.destroy({
      where: { id }
    });

    if (deletedCount === 0) {
      return res.status(404).json({ error: 'Geofence not found.' });
    }
    return res.status(200).json({ message: 'Geofence deleted successfully.' });
  } catch (error) {
    console.error('Error deleting geofence:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET Employee Geofence Tracking Status
router.get('/tracking-status/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const EmployeeGeofenceTrackingState = require('../../../../shared/models/EmployeeGeofenceTrackingState');
    const GeofenceAlertService = require('../../../../shared/services/GeofenceAlertService');
    const Employee = require('../../../../shared/models/Employee');
    const { getCachedEmployees, resolveCanonicalEmployee } = require('../../../../core/utils/employeeCache');

    const { empMap } = await getCachedEmployees();
    const resolvedEmp = await resolveCanonicalEmployee(employeeId, empMap);
    const canonicalId = resolvedEmp ? resolvedEmp.canonicalId : String(employeeId);
    const empObj = resolvedEmp ? resolvedEmp.employee : await Employee.findByPk(canonicalId);

    const state = await EmployeeGeofenceTrackingState.findByPk(canonicalId);
    const assignedGeofences = empObj ? await GeofenceAlertService.resolveAssignedGeofences(empObj) : [];

    return res.status(200).json({
      employeeId: canonicalId,
      state: state || {
        employeeId: canonicalId,
        consecutiveOutsideCount: 0,
        alertSent: false,
        lastStatus: 'NONE'
      },
      assignedGeofences: assignedGeofences.map(g => ({
        id: g.id,
        name: g.name,
        latitude: g.latitude,
        longitude: g.longitude,
        radius: g.radius
      }))
    });
  } catch (error) {
    console.error('Error fetching employee tracking status:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;