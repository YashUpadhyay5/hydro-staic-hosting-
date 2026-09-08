const { Op } = require('sequelize');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const AuditLog = require('../models/AuditLog');
const Rule = require('../models/Rule');
const axios = require('axios');
const admin = require('../../config/firebase');
const { getCachedEmployees } = require('../../core/utils/employeeCache');

let cachedConfig = null;
let lastConfigTime = 0;

class HeartbeatMonitorService {
    
    // Fetch configuration from Rule table with fallbacks (cached for 60s)
    static async getConfig() {
        const now = Date.now();
        if (cachedConfig && (now - lastConfigTime < 60000)) {
            return cachedConfig;
        }

        try {
            const rules = await Rule.findAll({
                where: {
                    key: {
                        [Op.in]: [
                            'heartbeatInterval',
                            'missedHeartbeatThreshold',
                            'notificationDelay',
                            'retryDelay',
                            'maximumNotifications',
                            'enableAdminAlert'
                        ]
                    }
                }
            });

            const config = {
                heartbeatInterval: 30, // seconds
                missedHeartbeatThreshold: 3,
                notificationDelay: 90, // seconds
                retryDelay: 120, // seconds
                maximumNotifications: 3,
                enableAdminAlert: true
            };

            rules.forEach(rule => {
                if (rule.key === 'heartbeatInterval') config.heartbeatInterval = parseInt(rule.value, 10);
                if (rule.key === 'missedHeartbeatThreshold') config.missedHeartbeatThreshold = parseInt(rule.value, 10);
                if (rule.key === 'notificationDelay') config.notificationDelay = parseInt(rule.value, 10);
                if (rule.key === 'retryDelay') config.retryDelay = parseInt(rule.value, 10);
                if (rule.key === 'maximumNotifications') config.maximumNotifications = parseInt(rule.value, 10);
                if (rule.key === 'enableAdminAlert') config.enableAdminAlert = rule.value === 'true';
            });

            cachedConfig = config;
            lastConfigTime = now;
            return config;
        } catch (err) {
            console.error('[HeartbeatService] Error reading config rules:', err.message);
            return {
                heartbeatInterval: 30,
                missedHeartbeatThreshold: 3,
                notificationDelay: 90,
                retryDelay: 120,
                maximumNotifications: 3,
                enableAdminAlert: true
            };
        }
    }

    // Phase 1 & 8: Register a Heartbeat Signal
    static async registerHeartbeat(userId, telemetry = {}) {
        const now = Date.now();
        try {
            // Find active attendance session (checkOut is null)
            const session = await Attendance.findOne({
                where: {
                    userId,
                    checkOut: null
                },
                order: [['createdAt', 'DESC']]
            });

            if (!session) {
                console.log(`[HeartbeatService] Heartbeat ignored. No active check-in session for user: ${userId}`);
                return null;
            }

            const oldStatus = session.trackingStatus;
            const wasInterrupted = oldStatus === 'INTERRUPTED';

            // Telemetry update mapping
            session.lastHeartbeat = now;
            session.heartbeatCount += 1;
            session.missedHeartbeatCount = 0;
            
            // Device specifications
            if (telemetry.manufacturer) session.deviceManufacturer = telemetry.manufacturer;
            if (telemetry.model) session.deviceModel = telemetry.model;
            if (telemetry.androidVersion) session.androidVersion = telemetry.androidVersion;
            if (telemetry.batteryLevel !== undefined) session.batteryLevel = parseFloat(telemetry.batteryLevel);
            if (telemetry.networkType) session.networkType = telemetry.networkType;
            if (telemetry.gpsEnabled !== undefined) session.gpsEnabled = telemetry.gpsEnabled;
            if (telemetry.trackingReliabilityScore !== undefined) session.trackingReliabilityScore = parseFloat(telemetry.trackingReliabilityScore);

            if (wasInterrupted) {
                session.trackingStatus = 'RECOVERED';
                session.recoveryTime = now;
                
                const interruptedMs = now - (session.lastNotificationTime || session.lastHeartbeat || session.createdAt.getTime());
                session.trackingInterruptedDuration += Math.floor(interruptedMs / 1000);
                
                await session.save();

                // Audit recovery event
                await AuditLog.create({
                    employeeId: userId,
                    attendanceSessionId: session.id,
                    event: 'TRACKING_RECOVERED',
                    details: {
                        durationSecs: Math.floor(interruptedMs / 1000),
                        telemetry
                    },
                    timestamp: now
                });

                console.log(`[HeartbeatService] Session recovered for user ${userId}. Interrupted duration: ${Math.floor(interruptedMs / 1000)}s`);
            } else {
                session.trackingStatus = 'ACTIVE';
                await session.save();

                // Audit log heartbeat received
                await AuditLog.create({
                    employeeId: userId,
                    attendanceSessionId: session.id,
                    event: 'HEARTBEAT_RECEIVED',
                    details: { telemetry },
                    timestamp: now
                });
            }

            return session;
        } catch (err) {
            console.error(`[HeartbeatService] Failed to register heartbeat for user ${userId}:`, err.message);
            return null;
        }
    }

    // In-memory set to prevent redundant admin escalation alerts and unbounded audit growth
    static _adminAlertSentSessions = new Set();
    static _isRunning = false;

    // Phase 5: Periodically Scan Active Sessions (run every 60s)
    static async runBackgroundCheck() {
        if (this._isRunning) {
            return;
        }
        this._isRunning = true;
        const now = Date.now();
        
        try {
            const config = await this.getConfig();
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

            // Find all active attendance sessions strictly for today
            const activeSessions = await Attendance.findAll({
                where: {
                    checkOut: null,
                    date: today
                }
            });

            for (const session of activeSessions) {
                // Calculate elapsed time since last heartbeat or clock-in
                const referenceTime = session.lastHeartbeat ? parseInt(session.lastHeartbeat, 10) : session.createdAt.getTime();
                const secondsElapsed = Math.floor((now - referenceTime) / 1000);

                // Check if heartbeat interval exceeded
                if (secondsElapsed >= config.heartbeatInterval) {
                    session.missedHeartbeatCount = (session.missedHeartbeatCount || 0) + 1;
                    
                    const oldStatus = session.trackingStatus;
                    let newStatus = oldStatus;

                    if (session.missedHeartbeatCount === 1) {
                        newStatus = 'MISSING';
                    } else if (session.missedHeartbeatCount === 2) {
                        newStatus = 'WARNING';
                    } else if (session.missedHeartbeatCount >= config.missedHeartbeatThreshold) {
                        newStatus = 'INTERRUPTED';
                    }

                    if (newStatus !== oldStatus) {
                        session.trackingStatus = newStatus;
                        await session.save();

                        // Log state transition
                        await AuditLog.create({
                            employeeId: session.userId,
                            attendanceSessionId: session.id,
                            event: `HEARTBEAT_STATE_${newStatus}`,
                            details: {
                                previousState: oldStatus,
                                secondsElapsed,
                                missedCount: session.missedHeartbeatCount
                            },
                            timestamp: now
                        }).catch(() => {});

                        console.log(`[HeartbeatService] User ${session.userId} transitioned: ${oldStatus} -> ${newStatus}`);
                    }

                    // Trigger Recovery FCM Escalation if Interrupted
                    if (newStatus === 'INTERRUPTED') {
                        await this.escalateInterruption(session, config, now);
                    }
                }
            }
        } catch (err) {
            console.error('[HeartbeatService] Background monitoring loop failed:', err.message);
        } finally {
            this._isRunning = false;
        }
    }

    // Phase 6 & 7: FCM Escalation & Throttling
    static async escalateInterruption(session, config, now) {
        // Throttling logic
        const lastNotifTime = session.lastNotificationTime ? parseInt(session.lastNotificationTime, 10) : 0;
        const secondsSinceLastNotif = Math.floor((now - lastNotifTime) / 1000);

        if (session.notificationCount > 0 && secondsSinceLastNotif < config.retryDelay) {
            // Throttled: Wait retry delay before sending subsequent notifications
            return;
        }

        const sessionKey = `${session.id}_${session.userId}`;

        if (session.notificationCount >= config.maximumNotifications) {
            // Threshold exceeded: Escalate to administrator only once per session
            if (config.enableAdminAlert && !this._adminAlertSentSessions.has(sessionKey)) {
                this._adminAlertSentSessions.add(sessionKey);
                console.warn(`[Escalation Alert] User ${session.userId} has exceeded maximum recovery attempts (${session.notificationCount}). Notifying Administrator.`);
                await AuditLog.create({
                    employeeId: session.userId,
                    attendanceSessionId: session.id,
                    event: 'ADMIN_ESCALATION_TRIGGERED',
                    details: {
                        notificationCount: session.notificationCount,
                        lastHeartbeat: session.lastHeartbeat
                    },
                    timestamp: now
                }).catch(() => {});
            }
            return;
        }

        // Fetch user token
        try {
            const { empMap } = await getCachedEmployees();
            const employee = empMap.get(String(session.userId || '').toLowerCase());
            if (!employee || !employee.fcmToken) {
                // console.log(`[HeartbeatService] Cannot send push recovery: User ${session.userId} has no registered push token.`);
                return;
            }

            const attempt = session.notificationCount + 1;
            const title = 'HRMS Attendance Alert';
            const body = `We haven't received your location for the last ${attempt * config.heartbeatInterval} seconds. Please open HRMS.`;
            const payload = {
                attendanceSessionId: session.id,
                employeeId: session.userId,
                trackingStatus: 'INTERRUPTED',
                notificationType: 'tracking_interrupted',
                deepLink: 'mobileapp://attendance'
            };

            const success = await this.sendPush(employee.fcmToken, title, body, payload);
            if (success) {
                session.notificationCount += 1;
                session.lastNotificationTime = now;
                await session.save();

                await AuditLog.create({
                    employeeId: session.userId,
                    attendanceSessionId: session.id,
                    event: 'NOTIFICATION_SENT',
                    details: {
                        attempt,
                        token: employee.fcmToken,
                        payload
                    },
                    timestamp: now
                });
                console.log(`[HeartbeatService] Recovery notification (attempt ${attempt}) sent to user: ${session.userId}`);
            }
        } catch (err) {
            console.error(`[HeartbeatService] Notification escalation trigger failed for session ${session.id}:`, err.message);
        }
    }

  // Direct Firebase FCM Push Notification Sender
  static async sendPush(token, title, body, payload = {}) {
    if (!token) return false;

    // Standardize data payload values to strings for FCM
    const stringData = {};
    for (const [key, val] of Object.entries(payload)) {
      stringData[key] = String(val);
    }

    const message = {
      token: token,
      notification: {
        title: title,
        body: body,
      },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default',
        },
      },
    };

    try {
      const response = await admin.messaging().send(message);
      console.log(`[Direct FCM Push] Successfully delivered to (${token}): ${response}`);
      return true;
    } catch (err) {
      console.error('[Direct FCM Push Error] Failed to send message:', err.message);
      return false;
    }
  }

    // Phase 15: Analytics reports
    static async getAnalyticsReport() {
        try {
            const allSessions = await Attendance.findAll();
            const interruptedSessions = allSessions.filter(s => s.trackingStatus === 'RECOVERED' || s.trackingInterruptedDuration > 0);
            
            let totalRecoveryTime = 0;
            let successCount = 0;

            interruptedSessions.forEach(s => {
                if (s.recoveryTime) {
                    successCount += 1;
                    totalRecoveryTime += s.trackingInterruptedDuration;
                }
            });

            const avgRecoveryTime = successCount > 0 ? Math.floor(totalRecoveryTime / successCount) : 0;
            const successRate = interruptedSessions.length > 0 ? ((successCount / interruptedSessions.length) * 100).toFixed(2) : '100.00';

            // Group by OEM reliability
            const oems = {};
            allSessions.forEach(s => {
                if (s.deviceManufacturer) {
                    const mfr = s.deviceManufacturer.toUpperCase();
                    if (!oems[mfr]) oems[mfr] = { total: 0, interrupted: 0 };
                    oems[mfr].total += 1;
                    if (s.trackingStatus === 'INTERRUPTED' || s.trackingInterruptedDuration > 0) {
                        oems[mfr].interrupted += 1;
                    }
                }
            });

            const oemReliability = {};
            Object.keys(oems).forEach(mfr => {
                const data = oems[mfr];
                const reliability = ((1 - (data.interrupted / data.total)) * 100).toFixed(2);
                oemReliability[mfr] = `${reliability}% (Sessions: ${data.total})`;
            });

            return {
                totalInterruptedSessions: interruptedSessions.length,
                successfulRecoveries: successCount,
                averageRecoveryTimeSeconds: avgRecoveryTime,
                recoverySuccessRate: `${successRate}%`,
                oemReliabilitySummary: oemReliability
            };
        } catch (err) {
            console.error('[HeartbeatService] Analytics compilation failed:', err.message);
            return { error: err.message };
        }
    }
}

module.exports = HeartbeatMonitorService;
