const express = require('express');
const router = express.Router();
const WhatsAppNotificationController = require('../controllers/WhatsAppNotificationController');

// Mounted at /api/v1/notifications/whatsapp
router.get('/settings', WhatsAppNotificationController.getSettings);
router.put('/settings', WhatsAppNotificationController.updateSettings);

router.post('/recipients', WhatsAppNotificationController.addRecipient);
router.delete('/recipients/:id', WhatsAppNotificationController.deleteRecipient);

router.post('/test', WhatsAppNotificationController.sendTestNotification);
router.post('/trigger', WhatsAppNotificationController.triggerManualNotification);

router.get('/logs', WhatsAppNotificationController.getNotificationLogs);

module.exports = router;
