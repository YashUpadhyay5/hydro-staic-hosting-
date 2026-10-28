const cron = require('node-cron');
const NotificationSetting = require('../../models/NotificationSetting');
const NotificationRecipient = require('../../models/NotificationRecipient');
const WhatsAppNotificationLog = require('../../models/WhatsAppNotificationLog');
const Employee = require('../../models/Employee');
const AttendanceSummaryService = require('../../../modules/hrms/attendance/services/AttendanceSummaryService');
const { getProvider } = require('../whatsapp/WhatsAppProvider');

async function executeDailyAttendanceWhatsAppJob(executionType = 'AUTOMATED') {
  const dateStr = new Date().toISOString().split('T')[0];
  console.log(`\n==========================================================`);
  console.log(`[WHATSAPP JOB] Executing ${executionType} Job for ${dateStr}`);
  console.log(`==========================================================`);

  try {
    // 1. Fetch Notification Setting
    let [setting] = await NotificationSetting.findOrCreate({
      where: { notificationType: 'DAILY_ATTENDANCE_SUMMARY' },
      defaults: {
        enabled: true,
        scheduledTime: '12:00',
        timezone: 'Asia/Kolkata',
        templateName: 'daily_attendance_summary'
      }
    });

    if (executionType === 'AUTOMATED' && !setting.enabled) {
      console.log('[WHATSAPP JOB] Automated notifications are currently DISABLED in settings. Skipping.');
      return { status: 'SKIPPED', reason: 'Disabled in settings' };
    }

    // 2. Fetch Active Recipients
    const recipients = await NotificationRecipient.findAll({
      where: { enabled: true }
    });

    // Also look up users matching target roles
    const phonesToNotify = [];

    for (const r of recipients) {
      if (r.recipientType === 'CUSTOM_NUMBER' && r.phoneNumber) {
        phonesToNotify.push({ phone: r.phoneNumber, name: r.name || 'Custom Contact' });
      } else if (r.recipientType === 'ROLE' && r.targetRole) {
        const matchingEmployees = await Employee.findAll({
          where: { role: r.targetRole, status: { [require('sequelize').Op.or]: ['ACTIVE', 'Active', 'active', null] } }
        });
        matchingEmployees.forEach(emp => {
          if (emp.phone || emp.mobile) {
            phonesToNotify.push({ phone: emp.phone || emp.mobile, name: `${emp.name} (${r.targetRole})` });
          }
        });
      }
    }

    // Fallback sandbox test recipient if no recipients configured
    if (phonesToNotify.length === 0) {
      phonesToNotify.push({ phone: '+917668976193', name: 'Primary Admin (+917668976193)' });
    }

    // Deduplicate phones
    const uniqueRecipientsMap = new Map();
    phonesToNotify.forEach(item => {
      const clean = item.phone.replace(/[^0-9]/g, '');
      if (clean && !uniqueRecipientsMap.has(clean)) {
        uniqueRecipientsMap.set(clean, item.name);
      }
    });

    // 3. Generate Authoritative Attendance Summary
    const summaryData = await AttendanceSummaryService.getDailySummary(dateStr);

    const provider = getProvider();
    const results = [];

    for (const [phone, name] of uniqueRecipientsMap.entries()) {
      // 4. Idempotency Check for AUTOMATED executions
      if (executionType === 'AUTOMATED') {
        const existingLog = await WhatsAppNotificationLog.findOne({
          where: {
            notificationType: 'DAILY_ATTENDANCE_SUMMARY',
            businessDate: dateStr,
            recipientPhone: phone,
            executionType: 'AUTOMATED',
            status: ['SENT', 'DELIVERED', 'SENDING']
          }
        });

        if (existingLog) {
          console.log(`[WHATSAPP JOB IDEMPOTENCY] Already sent today's automated summary to ${phone}. SKIPPED.`);
          results.push({ phone, status: 'SKIPPED_IDEMPOTENT' });
          continue;
        }
      }

      // Record SENDING log entry
      const logRecord = await WhatsAppNotificationLog.create({
        notificationType: 'DAILY_ATTENDANCE_SUMMARY',
        businessDate: dateStr,
        recipientPhone: phone,
        recipientName: name,
        status: 'SENDING',
        executionType,
        payloadSummary: summaryData
      });

      // Dispatch WhatsApp Template Message
      const dispatchResult = await provider.sendTemplateMessage(
        phone,
        setting.templateName || 'daily_attendance_summary',
        summaryData
      );

      if (dispatchResult.success) {
        await logRecord.update({
          status: 'SENT',
          messageWamid: dispatchResult.wamid,
          sentAt: new Date()
        });
        console.log(`[WHATSAPP JOB SUCCESS] Sent to ${name} (${phone}) | WAMID: ${dispatchResult.wamid}`);
        results.push({ phone, name, status: 'SENT', wamid: dispatchResult.wamid });
      } else {
        await logRecord.update({
          status: 'FAILED',
          errorCode: dispatchResult.errorCode,
          errorMessage: dispatchResult.errorMessage
        });
        console.error(`[WHATSAPP JOB FAILED] Failed for ${name} (${phone}):`, dispatchResult.errorMessage);
        results.push({ phone, name, status: 'FAILED', error: dispatchResult.errorMessage });
      }
    }

    return { success: true, businessDate: dateStr, summaryData, results };
  } catch (err) {
    console.error('[WHATSAPP JOB CRITICAL ERROR]:', err);
    return { success: false, error: err.message };
  }
}

function initDailyWhatsAppCron() {
  console.log('[CRON INIT] Initializing Daily WhatsApp Attendance Summary Job (Target: 12:00 PM Asia/Kolkata)...');
  cron.schedule('0 12 * * *', async () => {
    await executeDailyAttendanceWhatsAppJob('AUTOMATED');
  }, {
    scheduled: true,
    timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata'
  });
}

module.exports = {
  executeDailyAttendanceWhatsAppJob,
  initDailyWhatsAppCron
};
