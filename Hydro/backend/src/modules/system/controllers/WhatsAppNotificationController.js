const NotificationSetting = require('../../../shared/models/NotificationSetting');
const NotificationRecipient = require('../../../shared/models/NotificationRecipient');
const WhatsAppNotificationLog = require('../../../shared/models/WhatsAppNotificationLog');
const AttendanceSummaryService = require('../../hrms/attendance/services/AttendanceSummaryService');
const { executeDailyAttendanceWhatsAppJob } = require('../../../shared/services/jobs/dailyAttendanceWhatsAppJob');

class WhatsAppNotificationController {
  // GET /api/v1/notifications/whatsapp/settings
  static async getSettings(req, res) {
    try {
      const [setting] = await NotificationSetting.findOrCreate({
        where: { notificationType: 'DAILY_ATTENDANCE_SUMMARY' },
        defaults: {
          enabled: true,
          scheduledTime: '12:00',
          timezone: 'Asia/Kolkata',
          templateName: 'daily_attendance_summary'
        }
      });

      const recipients = await NotificationRecipient.findAll({
        order: [['createdAt', 'DESC']]
      });

      return res.status(200).json({
        setting,
        recipients
      });
    } catch (err) {
      console.error('Error fetching notification settings:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PUT /api/v1/notifications/whatsapp/settings
  static async updateSettings(req, res) {
    try {
      const { enabled, scheduledTime, timezone, templateName, sendOnHolidays, sendOnWeekoffs } = req.body;
      let [setting] = await NotificationSetting.findOrCreate({
        where: { notificationType: 'DAILY_ATTENDANCE_SUMMARY' }
      });

      await setting.update({
        enabled: enabled !== undefined ? enabled : setting.enabled,
        scheduledTime: scheduledTime || setting.scheduledTime,
        timezone: timezone || setting.timezone,
        templateName: templateName || setting.templateName,
        sendOnHolidays: sendOnHolidays !== undefined ? sendOnHolidays : setting.sendOnHolidays,
        sendOnWeekoffs: sendOnWeekoffs !== undefined ? sendOnWeekoffs : setting.sendOnWeekoffs,
        updatedBy: req.user ? req.user.id : 'ADMIN'
      });

      return res.status(200).json({ success: true, setting });
    } catch (err) {
      console.error('Error updating notification settings:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/v1/notifications/whatsapp/recipients
  static async addRecipient(req, res) {
    try {
      const { recipientType, targetRole, phoneNumber, name } = req.body;
      if (!recipientType) {
        return res.status(400).json({ error: 'recipientType is required (ROLE or CUSTOM_NUMBER)' });
      }

      const recipient = await NotificationRecipient.create({
        notificationType: 'DAILY_ATTENDANCE_SUMMARY',
        recipientType,
        targetRole: recipientType === 'ROLE' ? targetRole : null,
        phoneNumber: recipientType === 'CUSTOM_NUMBER' ? phoneNumber : null,
        name: name || (recipientType === 'ROLE' ? `${targetRole} Group` : phoneNumber),
        enabled: true
      });

      return res.status(201).json({ success: true, recipient });
    } catch (err) {
      console.error('Error adding recipient:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE /api/v1/notifications/whatsapp/recipients/:id
  static async deleteRecipient(req, res) {
    try {
      const { id } = req.params;
      const recipient = await NotificationRecipient.findByPk(id);
      if (!recipient) {
        return res.status(404).json({ error: 'Recipient not found' });
      }

      await recipient.destroy();
      return res.status(200).json({ success: true, message: 'Recipient removed successfully' });
    } catch (err) {
      console.error('Error deleting recipient:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/v1/notifications/whatsapp/test
  static async sendTestNotification(req, res) {
    try {
      const result = await executeDailyAttendanceWhatsAppJob('TEST');
      return res.status(200).json({
        success: true,
        message: 'Test WhatsApp attendance summary dispatched successfully',
        result
      });
    } catch (err) {
      console.error('Error triggering test notification:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/v1/notifications/whatsapp/trigger
  static async triggerManualNotification(req, res) {
    try {
      const result = await executeDailyAttendanceWhatsAppJob('MANUAL_TRIGGER');
      return res.status(200).json({
        success: true,
        message: 'Manual attendance summary job triggered',
        result
      });
    } catch (err) {
      console.error('Error triggering manual notification:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // GET /api/v1/notifications/whatsapp/logs
  static async getNotificationLogs(req, res) {
    try {
      const logs = await WhatsAppNotificationLog.findAll({
        order: [['createdAt', 'DESC']],
        limit: 50
      });

      const todayStr = new Date().toISOString().split('T')[0];
      const summaryToday = await AttendanceSummaryService.getDailySummary(todayStr);

      return res.status(200).json({
        todayStr,
        summaryToday,
        logs
      });
    } catch (err) {
      console.error('Error fetching notification logs:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = WhatsAppNotificationController;
