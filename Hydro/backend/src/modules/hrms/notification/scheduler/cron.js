const cron = require('node-cron');
const NotificationService = require('../services/NotificationService');
const { Notification } = require('../../../../shared/models');
const { Op } = require('sequelize');

class NotificationScheduler {
  start() {
    // NOTE: Hardcoded sendToAll() clock-in/out broadcasts REMOVED.
    // Shift-aware, holiday-aware, and 5-minute repeating clock-out notifications
    // are now authoritatively managed by CronScheduler.

    // Process generic pending scheduled notifications every minute
    cron.schedule('* * * * *', async () => {
      try {
        const pendingNotifications = await Notification.findAll({
          where: {
            status: 'PENDING',
            scheduleAt: {
              [Op.lte]: new Date()
            }
          }
        });

        for (const notification of pendingNotifications) {
          let payload = {};
          try { payload = JSON.parse(notification.payload); } catch (e) {}

          if (notification.target === 'EMPLOYEE') {
            await NotificationService.sendToEmployee(notification.targetId, notification.title, notification.body, payload, notification.createdBy);
          } else if (notification.target === 'DEPARTMENT') {
            await NotificationService.sendToDepartment(notification.targetId, notification.title, notification.body, payload, notification.createdBy);
          } else if (notification.target === 'EMPLOYEES') {
            await NotificationService.sendToAll(notification.title, notification.body, payload, notification.createdBy);
          }
          
          notification.status = 'PROCESSED';
          await notification.save();
        }
      } catch (error) {
        console.error('Error processing scheduled notifications:', error);
      }
    });

    console.log('Notification cron scheduler started');
  }
}

module.exports = new NotificationScheduler();
