const { Op } = require('sequelize');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const AuditLog = require('../models/AuditLog');
const Rule = require('../models/Rule');
const Setting = require('../models/Setting');
const axios = require('axios');
const admin = require('../../config/firebase');
const { getCachedEmployees } = require('../../core/utils/employeeCache');

let cachedConfig = null;
let lastConfigTime = 0;

class HeartbeatMonitorService {
    static _io = null;

    static setIO(io) {
        this._io = io;
    }
    
    // Invalidate cached configuration when updated from admin dashboard
    static invalidateConfigCache() {
        cachedConfig = null;
        lastConfigTime = 0;
        console.log('[HeartbeatService] Configuration cache invalidated.');
    }

    // Fetch configuration dynamically from dashboard Setting & Rule tables (cached for 60s)
    static async getConfig() {
        const now = Date.now();
        if (cachedConfig && (now - lastConfigTime < 60000)) {
            return cachedConfig;
        }

        try {
            // Read active location_update_interval configured by admin on dashboard
            let locationIntervalSeconds = 30;
            try {
                const setting = await Setting.findOne({ where: { id: 1 }, raw: true });
                if (setting && setting.location_update_interval) {
                    const raw = String(setting.location_update_interval).trim();
                    const match = raw.match(/\d+/);
                    if (match) {
                        const parsed = parseInt(match[0], 10);
                        if (!isNaN(parsed) && parsed > 0) {
                            locationIntervalSeconds = parsed;
                        }
                    }
                }
            } catch (setErr) {
                console.warn('[HeartbeatService] Warning reading Setting model:', setErr.message);
            }

            const rules = await Rule.findAll({
                where: {
                    key: {
                        [Op.in]: [
                            'maximumNotifications',
                            'enableAdminAlert'
                        ]
                    }
                }
            }).catch(() => []);

            const config = {
                heartbeatInterval: locationIntervalSeconds, // Synced dynamically to dashboard location update interval
                missedHeartbeatThreshold: 2, // Exactly 2 intervals trigger interruption alert
                notificationDelay: locationIntervalSeconds * 2, // 2 intervals (e.g. 60s for 30s interval, 1800s for 15m)
                retryDelay: Math.max(locationIntervalSeconds, 60), // Throttled retry cadence
                maximumNotifications: 3,
                enableAdminAlert: true
            };

            rules.forEach(rule => {
                if (rule.key === 'maximumNotifications') config.maximumNotifications = parseInt(rule.value, 10);
                if (rule.key === 'enableAdminAlert') config.enableAdminAlert = rule.value === 'true';
            });

            cachedConfig = config;
            lastConfigTime = now;
            console.log(`[HeartbeatService] Loaded tracking config: Interval = ${config.heartbeatInterval}s, Alert Threshold = ${config.missedHeartbeatThreshold * config.heartbeatInterval}s (2 intervals)`);
            return config;
        } catch (err) {
            console.error('[HeartbeatService] Error reading config rules:', err.message);
            return {
                heartbeatInterval: 30,
                missedHeartbeatThreshold: 2,
                notificationDelay: 60,
                retryDelay: 60,
                maximumNotifications: 3,
                enableAdminAlert: true
            };
        }
    }

    // Phase 1 & 8: Register a Heartbeat Signal
    static async registerHeartbeat(userId, telemetry = {}) {
        const now = Date.now();
        try {
            // Resolve employee aliases to match active session across id, empCode, and name
            let candidateIds = [userId];
            try {
                const { empAliasesMap } = await getCachedEmployees();
                const clean = String(userId || '').trim().toLowerCase();
                const aliases = empAliasesMap ? empAliasesMap.get(clean) : null;
                if (aliases && Array.isArray(aliases) && aliases.length > 0) {
                    candidateIds = Array.from(new Set([userId, ...aliases].filter(Boolean)));
                }
            } catch (e) {}

            // Find active attendance session (checkOut is null or empty)
            const session = await Attendance.findOne({
                where: {
                    [Op.and]: [
                        {
                            [Op.or]: [
                                { userId: { [Op.in]: candidateIds } },
                                { userName: { [Op.in]: candidateIds } }
                            ]
                        },
                        {
                            [Op.or]: [
                                { checkOut: null },
                                { checkOut: '' },
                                { checkOut: 'null' },
                                { checkOut: 'undefined' },
                                { checkOut: '-' }
                            ]
                        }
                    ]
                },
                order: [['createdAt', 'DESC']]
            });

            if (!session) {
                console.log(`[HeartbeatService] Heartbeat ignored. No active check-in session for user: ${userId}`);
                return null;
            }

            const oldStatus = session.trackingStatus;
            const wasInterrupted = oldStatus === 'INTERRUPTED' || oldStatus === 'MISSING' || oldStatus === 'WARNING';

            // Telemetry update mapping
            session.lastHeartbeat = now;
            session.heartbeatCount = (session.heartbeatCount || 0) + 1;
            session.missedHeartbeatCount = 0;
            
            // Device specifications
            if (telemetry.manufacturer) session.deviceManufacturer = telemetry.manufacturer;
            if (telemetry.model) session.deviceModel = telemetry.model;
            if (telemetry.androidVersion) session.androidVersion = telemetry.androidVersion;
            if (telemetry.batteryLevel !== undefined && telemetry.batteryLevel !== null) session.batteryLevel = parseFloat(telemetry.batteryLevel);
            if (telemetry.networkType) session.networkType = telemetry.networkType;
            if (telemetry.gpsEnabled !== undefined && telemetry.gpsEnabled !== null) session.gpsEnabled = telemetry.gpsEnabled;
            if (telemetry.trackingReliabilityScore !== undefined && telemetry.trackingReliabilityScore !== null) session.trackingReliabilityScore = parseFloat(telemetry.trackingReliabilityScore);

            if (wasInterrupted) {
                session.trackingStatus = 'RECOVERED';
                session.recoveryTime = now;
                session.notificationCount = 0; // reset notification escalation count upon recovery
                
                const interruptedMs = now - (session.lastNotificationTime || session.lastHeartbeat || (session.createdAt ? session.createdAt.getTime() : now));
                session.trackingInterruptedDuration = (session.trackingInterruptedDuration || 0) + Math.max(0, Math.floor(interruptedMs / 1000));
                
                await session.save();

                // Audit recovery event
                await AuditLog.create({
                    employeeId: session.userId || userId,
                    attendanceSessionId: session.id,
                    event: 'TRACKING_RECOVERED',
                    details: {
                        durationSecs: Math.max(0, Math.floor(interruptedMs / 1000)),
                        telemetry
                    },
                    timestamp: now
                }).catch(() => {});

                console.log(`[HeartbeatService] Session recovered for user ${session.userId} (${session.userName || userId}). Interrupted duration: ${Math.max(0, Math.floor(interruptedMs / 1000))}s`);

                if (HeartbeatMonitorService._io) {
                    try {
                        HeartbeatMonitorService._io.emit('ATTENDANCE_UPDATE', {
                            date: session.date,
                            action: 'RECOVERED',
                            userId: session.userId,
                            sessionId: session.id
                        });
                    } catch (sockErr) {}
                }
            } else {
                session.trackingStatus = 'ACTIVE';
                await session.save();

                // Audit log heartbeat received
                await AuditLog.create({
                    employeeId: session.userId || userId,
                    attendanceSessionId: session.id,
                    event: 'HEARTBEAT_RECEIVED',
                    details: { telemetry },
                    timestamp: now
                }).catch(() => {});
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
                    [Op.or]: [
                        { checkOut: null },
                        { checkOut: '' },
                        { checkOut: 'null' },
                        { checkOut: 'undefined' },
                        { checkOut: '-' }
                    ],
                    date: today
                }
            });

            for (const session of activeSessions) {
                // Calculate elapsed time since last heartbeat or clock-in
                const referenceTime = session.lastHeartbeat ? parseInt(session.lastHeartbeat, 10) : session.createdAt.getTime();
                const secondsElapsed = Math.floor((now - referenceTime) / 1000);
                const intervalSec = config.heartbeatInterval || 30;
                const missedIntervals = Math.floor(secondsElapsed / intervalSec);

                session.missedHeartbeatCount = missedIntervals;
                const oldStatus = session.trackingStatus;
                let newStatus = oldStatus;

                // Dynamic 2-interval threshold logic:
                // < 1 interval missed: healthy (ACTIVE / RECOVERED)
                // 1 interval missed: WARNING (grace period; no push notification)
                // >= 2 intervals missed: INTERRUPTED (dispatches recovery push notification)
                if (missedIntervals >= config.missedHeartbeatThreshold) {
                    newStatus = 'INTERRUPTED';
                } else if (missedIntervals === 1) {
                    newStatus = 'WARNING';
                } else if (missedIntervals === 0) {
                    if (oldStatus === 'WARNING' || oldStatus === 'MISSING') {
                        newStatus = 'ACTIVE';
                    }
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
                            missedIntervals,
                            intervalSec
                        },
                        timestamp: now
                    }).catch(() => {});

                    console.log(`[HeartbeatService] User ${session.userId} transitioned: ${oldStatus} -> ${newStatus} (${secondsElapsed}s elapsed, ${missedIntervals} intervals missed, interval: ${intervalSec}s)`);
                }

                // Trigger Recovery FCM Escalation if Interrupted (>= 2 intervals missed)
                if (newStatus === 'INTERRUPTED') {
                    await this.escalateInterruption(session, config, now);
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

            const referenceTime = session.lastHeartbeat ? parseInt(session.lastHeartbeat, 10) : session.createdAt.getTime();
            const secondsElapsed = Math.floor((now - referenceTime) / 1000);
            const formatElapsed = (secs) => {
                if (secs >= 120) {
                    const mins = Math.floor(secs / 60);
                    return `${mins} minutes`;
                }
                return `${secs} seconds`;
            };
            const elapsedText = formatElapsed(secondsElapsed);

            const attempt = session.notificationCount + 1;
            const title = 'HRMS Attendance Alert';
            const body = `We haven't received your location update for the last ${elapsedText}. Please open HRMS to keep your session active.`;
            const payload = {
                attendanceSessionId: String(session.id),
                employeeId: String(session.userId),
                trackingStatus: 'INTERRUPTED',
                notificationType: 'tracking_interrupted',
                deepLink: 'mobileapp://attendance',
                elapsedSeconds: String(secondsElapsed),
                attempt: String(attempt)
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
                console.log(`[HeartbeatService] Recovery notification (attempt ${attempt}) sent to user: ${session.userId} (${elapsedText} elapsed)`);
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

  // Backwards compatibility alias for CronScheduler / external callers
  static async sendPushNotification(token, title, body, payload = {}) {
    return this.sendPush(token, title, body, payload);
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
