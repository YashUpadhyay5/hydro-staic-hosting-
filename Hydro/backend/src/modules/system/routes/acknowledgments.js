const express = require('express');
const router = express.Router();
const Acknowledgment = require('../../../shared/models/Acknowledgment');

// POST /api/acknowledgments - Submit legal compliance acknowledgment
router.post('/', async (req, res) => {
  try {
    const { userId, user_id, employeeName, employee_name, employeeEmail, employee_email, deviceInfo, device_info, termsVersion, terms_version } = req.body;

    const activeUserId = userId || user_id;
    const activeName = employeeName || employee_name;
    const activeEmail = employeeEmail || employee_email;
    const activeDevice = deviceInfo || device_info || 'Mobile App';
    const activeVersion = termsVersion || terms_version || 'v1.0';

    if (!activeUserId || !activeName || !activeEmail) {
      return res.status(400).json({ error: 'User ID, employee name, and employee email are required.' });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1';

    const record = await Acknowledgment.create({
      user_id: String(activeUserId).trim(),
      employee_name: String(activeName).trim(),
      employee_email: String(activeEmail).trim(),
      device_info: String(activeDevice).trim(),
      ip_address: String(ipAddress).trim(),
      terms_version: String(activeVersion).trim(),
      accepted_at: new Date(),
      status: 'ACCEPTED'
    });

    return res.status(201).json(record);
  } catch (error) {
    console.error('Error submitting legal compliance acknowledgment:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/acknowledgments - Fetch all legal compliance records for Admin audit
router.get('/', async (req, res) => {
  try {
    const records = await Acknowledgment.findAll({
      order: [['accepted_at', 'DESC']]
    });
    return res.status(200).json(records);
  } catch (error) {
    console.error('Error fetching legal acknowledgments:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
