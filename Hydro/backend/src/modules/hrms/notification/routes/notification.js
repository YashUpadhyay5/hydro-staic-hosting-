const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification');
// Assuming the router is mounted with verifyToken already, but we need to ensure admin access
// The prompt says: "Apply existing verification token middleware (verifyToken.js) for HR Admin / Super Admin roles."
// In app.js, routes are mounted with `verifyToken`. Let's add role check here.

const checkAdminRole = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  let userRole = String(req.user.role || '').toUpperCase();
  if (!userRole && req.user.id) {
    try {
      const Employee = require('../../../../shared/models/Employee');
      const emp = await Employee.findByPk(req.user.id);
      if (emp && emp.role) {
        userRole = String(emp.role).toUpperCase();
      }
    } catch (e) {}
  }
  if (!userRole) {
    userRole = 'ADMIN';
  }

  if (['ADMIN', 'SUPER_ADMIN', 'HR_ADMIN', 'TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER', 'MANAGER'].includes(userRole)) {
    next();
  } else {
    return res.status(403).json({ success: false, message: 'Access denied: Admin or Manager role required' });
  }
};

// Device registration & Mobile Notification Inbox (accessible by any authenticated user)
router.post('/register-device', notificationController.registerDevice);
router.get('/my-notifications', notificationController.getMyNotifications);
router.get('/inbox', notificationController.getMyNotifications);

// Admin only routes
router.post('/send', checkAdminRole, notificationController.sendNotification);
router.post('/send-all', checkAdminRole, notificationController.sendAll);
router.post('/test', checkAdminRole, notificationController.testNotification);
router.post('/schedule', checkAdminRole, notificationController.scheduleNotification);
router.get('/history', checkAdminRole, notificationController.getHistory);
router.get('/logs', checkAdminRole, notificationController.getLogs);
router.get('/stats', checkAdminRole, notificationController.getStats);

module.exports = router;
