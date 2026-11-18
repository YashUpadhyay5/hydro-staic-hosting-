// Day Activities Notification Service
// Dispatches notifications to Admins / Managers and Employees across:
// 1. In-App Notification Center (Notification & NotificationLog tables)
// 2. Mobile Push Notifications via FCM (DeviceToken & Employee.fcmToken)
// 3. Live WebSockets (socketGateway) for instant dashboard & tracking map updates
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');

const istClock = (ms) => {
  if (!ms) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(new Date(ms)).toUpperCase();
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
};

const formatDuration = (min) => {
  if (min === null || min === undefined || isNaN(min)) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

class ActivityNotificationService {
  /**
   * Dispatch notification for Day Activity lifecycle event.
   * Runs asynchronously without blocking the caller.
   */
  static dispatch(eventData) {
    // Non-blocking fire-and-forget
    setImmediate(async () => {
      try {
        await this._processDispatch(eventData);
      } catch (err) {
        console.warn('[ActivityNotificationService] Dispatch error:', err.message || err);
      }
    });
  }

  static async _processDispatch({ eventType, activity, employee, details = {} }) {
    if (!activity || !employee) return;

    // Dynamically resolve models to avoid circular dependencies
    const Employee = require('../../../../shared/models/Employee');
    const DeviceToken = require('../../../../shared/models/DeviceToken');
    const Notification = require('../../../../shared/models/Notification');
    const NotificationLog = require('../../../../shared/models/NotificationLog');
    const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');

    const empName = employee.name || 'Employee';
    const empCode = employee.empCode || employee.id || '';
    const title = activity.title || 'Day Activity';
    const siteName = activity.siteName || details.siteName || (details.siteInfo && details.siteInfo.siteName) || '';
    const siteSuffix = siteName ? ` at ${siteName}` : '';

    const plannedMinutes = activity.plannedEndAt && activity.startedAt
      ? Math.max(1, Math.round((activity.plannedEndAt - activity.startedAt) / (60 * 1000)))
      : 0;
    const takenMinutes = details.takenMinutes !== undefined
      ? details.takenMinutes
      : (activity.endedAt ? Math.max(0, Math.round((activity.endedAt - activity.startedAt) / (60 * 1000))) : 0);
    const overPlanMinutes = details.overPlanMinutes !== undefined
      ? details.overPlanMinutes
      : (activity.endedAt && activity.plannedEndAt ? Math.max(0, Math.round((activity.endedAt - activity.plannedEndAt) / (60 * 1000))) : 0);

    let notifTitle = '';
    let notifBody = '';

    switch (eventType) {
      case 'ACTIVITY_STARTED':
        notifTitle = `📋 Day Activity Started: ${empName}`;
        notifBody = `${empName} (${empCode}) started "${title}"${siteSuffix}. Planned: ${formatDuration(plannedMinutes)} (Due at ${istClock(activity.deadlineAt || activity.plannedEndAt)}).`;
        break;

      case 'ACTIVITY_EXTENDED':
        notifTitle = `⏳ Activity Extended: ${empName}`;
        notifBody = `${empName} requested +${details.extraMinutes || 0} min for "${title}"${siteSuffix}. Reason: "${details.reason || 'None'}". New deadline: ${istClock(activity.deadlineAt)}.`;
        break;

      case 'ACTIVITY_COMPLETED':
        notifTitle = `✅ Activity Completed: ${empName}${siteSuffix}`;
        notifBody = `${empName} completed "${title}"${siteSuffix} on time (Duration: ${formatDuration(takenMinutes)}).`;
        break;

      case 'ACTIVITY_COMPLETED_LATE':
        notifTitle = `⚠️ Activity Completed Late: ${empName}${siteSuffix}`;
        notifBody = `${empName} completed "${title}"${siteSuffix} ${formatDuration(overPlanMinutes)} late. Reason: "${details.reason || activity.finishReason || 'None'}". Total: ${formatDuration(takenMinutes)}.`;
        break;

      case 'ACTIVITY_CANCELLED':
        notifTitle = `❌ Activity Cancelled: ${empName}${siteSuffix}`;
        notifBody = `${empName} cancelled "${title}"${siteSuffix}. Reason: "${details.reason || activity.finishReason || 'None'}".`;
        break;

      case 'ACTIVITY_OVERDUE':
        notifTitle = `⚠️ Activity Overdue: ${empName}${siteSuffix}`;
        notifBody = `${empName}'s activity "${title}"${siteSuffix} has exceeded its deadline (${istClock(activity.deadlineAt)}). Phone alarm triggered.`;
        break;

      default:
        notifTitle = `Activity Update: ${empName}${siteSuffix}`;
        notifBody = `${empName} updated "${title}"${siteSuffix}.`;
    }

    const payload = {
      type: eventType,
      category: 'DAY_ACTIVITY',
      activityId: String(activity.id),
      employeeId: String(employee.id),
      employeeName: empName,
      empCode: empCode,
      activityTitle: title,
      siteName: siteName || null,
      status: activity.status,
      startedAt: activity.startedAt,
      plannedEndAt: activity.plannedEndAt,
      deadlineAt: activity.deadlineAt,
      endedAt: activity.endedAt,
      timestamp: Date.now(),
      ...details
    };

    // 1. Fetch Staff / Admin recipients
    const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN', 'HR', 'HR_ADMIN', 'MANAGER', 'TRACKING_MANAGER', 'FIELD_INVOICE_MANAGER'];
    let staffRecipients = [];
    try {
      staffRecipients = await Employee.findAll({
        where: {
          role: { [Op.in]: STAFF_ROLES },
          status: 'ACTIVE'
        },
        attributes: ['id', 'empCode', 'name', 'role', 'fcmToken']
      });
    } catch (e) {
      staffRecipients = [];
    }

    // 2. Persist Notification records in DB
    const adminNotificationId = uuidv4();
    try {
      await Notification.create({
        id: adminNotificationId,
        title: notifTitle,
        body: notifBody,
        type: 'DAY_ACTIVITY',
        target: 'STAFF',
        targetId: 'ADMIN',
        status: 'SENT',
        createdBy: employee.id || 'SYSTEM',
        payload: JSON.stringify(payload)
      });

      // Also create personal notification for employee so it appears in their own mobile inbox
      let empInboxTitle = notifTitle;
      let empInboxBody = notifBody;
      if (eventType === 'ACTIVITY_COMPLETED' || eventType === 'ACTIVITY_COMPLETED_LATE') {
        const resolvedSite = siteName || 'this site';
        empInboxTitle = `✅ Work Completed at ${resolvedSite}`;
        empInboxBody = `Your work "${title}" at ${resolvedSite} is complete. You can now leave this site and move to your next site.`;
      }

      const employeeNotificationId = uuidv4();
      await Notification.create({
        id: employeeNotificationId,
        title: empInboxTitle,
        body: empInboxBody,
        type: 'DAY_ACTIVITY',
        target: 'EMPLOYEE',
        targetId: String(employee.id),
        status: 'SENT',
        createdBy: employee.id || 'SYSTEM',
        payload: JSON.stringify({ ...payload, isEmployeeDispatch: true })
      });

      // Write logs for staff recipients
      if (staffRecipients.length > 0) {
        const logEntries = staffRecipients.map(staff => ({
          id: uuidv4(),
          notificationId: adminNotificationId,
          employeeId: staff.id,
          status: 'SENT',
          sentAt: new Date()
        }));
        await NotificationLog.bulkCreate(logEntries, { ignoreDuplicates: true });
      }

      // Write log for employee
      await NotificationLog.create({
        id: uuidv4(),
        notificationId: employeeNotificationId,
        employeeId: String(employee.id),
        status: 'SENT',
        sentAt: new Date()
      });
    } catch (dbErr) {
      console.warn('[ActivityNotificationService] Failed to persist notifications to DB:', dbErr.message);
    }

    // 3. Emit Real-Time WebSockets
    try {
      const { getIO } = require('../../../../sockets/socketGateway');
      const io = getIO();
      if (io) {
        // Global broadcast for admin tracking panel and toast
        io.emit('day_activity_event', {
          id: adminNotificationId,
          title: notifTitle,
          body: notifBody,
          payload,
          timestamp: Date.now()
        });
        io.emit('DAY_ACTIVITY_UPDATE', {
          employeeId: employee.id,
          activityId: activity.id,
          eventType,
          activity: activity.get ? activity.get({ plain: true }) : activity
        });
        // Targeted emit to employee's private socket room
        const resolvedSite = siteName || 'this site';
        const empSocketTitle = (eventType === 'ACTIVITY_COMPLETED' || eventType === 'ACTIVITY_COMPLETED_LATE')
          ? `✅ Work Completed at ${resolvedSite}`
          : notifTitle;
        const empSocketBody = (eventType === 'ACTIVITY_COMPLETED' || eventType === 'ACTIVITY_COMPLETED_LATE')
          ? `Your work "${title}" at ${resolvedSite} is complete. You can now leave this site and move to your next site.`
          : notifBody;

        io.to(`user:${employee.id}`).emit('day_activity_event', {
          title: empSocketTitle,
          body: empSocketBody,
          payload: { ...payload, isEmployeeDispatch: true },
          timestamp: Date.now()
        });
      }
    } catch (sockErr) {
      // Sockets may be unavailable in test environments
    }

    // 4. Send FCM Push Notifications to Staff / Admins
    // In test runs (SQLite mock DB), skip external FCM pushes to keep test mocks clean
    if (process.env.DB_DIALECT === 'sqlite' && process.env.TEST_DISPATCH_PUSH !== 'true') {
      return;
    }

    try {
      const staffIds = staffRecipients.map(s => s.id);
      let staffTokens = [];
      if (staffIds.length > 0) {
        const tokenRows = await DeviceToken.findAll({
          where: { employeeId: { [Op.in]: staffIds } },
          attributes: ['token']
        });
        staffTokens = tokenRows.map(r => r.token);
      }
      staffRecipients.forEach(s => {
        if (s.fcmToken && !staffTokens.includes(s.fcmToken)) {
          staffTokens.push(s.fcmToken);
        }
      });

      const uniqueStaffTokens = [...new Set(staffTokens.filter(Boolean))];
      for (const token of uniqueStaffTokens) {
        HeartbeatMonitorService.sendPush(token, notifTitle, notifBody, payload).catch(() => {});
      }
    } catch (fcmStaffErr) {
      console.warn('[ActivityNotificationService] Admin push error:', fcmStaffErr.message);
    }

    // 5. Send Smart Geofence Dispatch Push to Employee upon Activity Completion
    if (eventType === 'ACTIVITY_COMPLETED' || eventType === 'ACTIVITY_COMPLETED_LATE') {
      try {
        const SiteResolver = require('./SiteResolver');
        const finishLat = details.finishLatitude !== undefined && details.finishLatitude !== null
          ? details.finishLatitude
          : (activity.endLatitude || activity.startLatitude);
        const finishLng = details.finishLongitude !== undefined && details.finishLongitude !== null
          ? details.finishLongitude
          : (activity.endLongitude || activity.startLongitude);

        const siteRef = details.siteInfo || (await SiteResolver.resolveSite(finishLat, finishLng, employee));
        const isStillOnSite = SiteResolver.isStillInsideGeofence(finishLat, finishLng, siteRef);

        if (isStillOnSite) {
          const resolvedSiteName = siteName || siteRef?.siteName || 'Site';
          const workerPushTitle = `✅ Work Completed at ${resolvedSiteName}`;
          const workerPushBody = `Your work "${title}" at ${resolvedSiteName} is complete. You can now leave this site and move to your next site.`;
          const workerPayload = {
            type: 'ACTIVITY_SITE_COMPLETED_DISPATCH',
            category: 'DAY_ACTIVITY',
            action: 'MOVE_TO_NEXT_SITE',
            activityId: String(activity.id),
            employeeId: String(employee.id),
            activityTitle: title,
            siteName: resolvedSiteName,
            timestamp: Date.now()
          };

          // Collect employee's registered FCM tokens
          let empTokens = [];
          const tokenRows = await DeviceToken.findAll({
            where: { employeeId: String(employee.id) },
            attributes: ['token']
          });
          empTokens = tokenRows.map(r => r.token);
          if (employee.fcmToken && !empTokens.includes(employee.fcmToken)) {
            empTokens.push(employee.fcmToken);
          }

          const uniqueEmpTokens = [...new Set(empTokens.filter(Boolean))];
          for (const token of uniqueEmpTokens) {
            HeartbeatMonitorService.sendPush(token, workerPushTitle, workerPushBody, workerPayload).catch(() => {});
          }
          console.log(`[ActivityNotificationService] Dispatched leave-site push to employee ${empName} (${empCode}) at ${resolvedSiteName}.`);
        } else {
          console.log(`[ActivityNotificationService] Employee ${empName} (${empCode}) is already outside geofence for ${siteName || 'site'}. Suppressed leave-site push.`);
        }
      } catch (workerPushErr) {
        console.warn('[ActivityNotificationService] Employee dispatch push error:', workerPushErr.message);
      }
    }
  }
}

module.exports = ActivityNotificationService;
