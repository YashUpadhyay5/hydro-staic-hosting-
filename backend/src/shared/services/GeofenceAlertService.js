const { Op } = require('sequelize');
const sequelize = require('../../config/database');
const Geofence = require('../models/Geofence');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const EmployeeGeofenceTrackingState = require('../models/EmployeeGeofenceTrackingState');
const ShiftEngine = require('./ShiftEngine');
const NotificationService = require('../../modules/hrms/notification/services/NotificationService');
const { getDistance } = require('../../core/utils/siteCache');
const { getCachedEmployees, resolveCanonicalEmployee } = require('../../core/utils/employeeCache');

const GPS_BUFFER_METERS = 10; // 10 meter buffer zone for GPS drift

class GeofenceAlertService {
  constructor() {
    this.geofenceCache = [];
    this.lastGeofenceCacheTime = 0;
    this.CACHE_TTL_MS = 60000; // 1 minute TTL for geofence cache
  }

  /**
   * Authoritative IST Date formatter (YYYY-MM-DD)
   */
  getAuthoritativeISTDate(d = new Date()) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * Format timestamp to IST 12-hour/24-hour time string
   */
  formatISTTime(ts) {
    try {
      const d = ts ? new Date(ts) : new Date();
      return d.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return new Date().toLocaleTimeString();
    }
  }

  /**
   * Load active geofences from database with in-memory caching
   */
  async getActiveGeofences() {
    const now = Date.now();
    if (this.geofenceCache.length > 0 && (now - this.lastGeofenceCacheTime) < this.CACHE_TTL_MS) {
      return this.geofenceCache;
    }

    try {
      const list = await Geofence.findAll();
      this.geofenceCache = list.map(g => (g.get ? g.get({ plain: true }) : g));
      this.lastGeofenceCacheTime = now;
    } catch (err) {
      console.warn('[GeofenceAlertService] Failed to load geofences from DB:', err.message);
    }
    return this.geofenceCache;
  }

  /**
   * Resolve an employee's assigned geofence(s) dynamically
   */
  async resolveAssignedGeofences(employee) {
    if (!employee) return [];
    const allGeofences = await this.getActiveGeofences();
    if (!allGeofences || allGeofences.length === 0) return [];

    // 1. Explicit assignment in customFields or model columns
    let customFields = {};
    try {
      const rawCf = employee.customFields !== undefined ? employee.customFields : employee.custom_fields;
      customFields = typeof rawCf === 'string' ? JSON.parse(rawCf) : (rawCf || {});
      if (typeof customFields === 'string') customFields = JSON.parse(customFields);
    } catch (e) {}

    const explicitIds = [];
    if (customFields.assignedGeofenceId) explicitIds.push(String(customFields.assignedGeofenceId));
    if (customFields.geofenceId) explicitIds.push(String(customFields.geofenceId));
    if (Array.isArray(customFields.assignedGeofences)) {
      customFields.assignedGeofences.forEach(id => explicitIds.push(String(id)));
    }
    if (employee.assignedGeofenceId) explicitIds.push(String(employee.assignedGeofenceId));
    if (employee.assigned_geofence_id) explicitIds.push(String(employee.assigned_geofence_id));

    if (explicitIds.length > 0) {
      const matched = allGeofences.filter(gf => explicitIds.includes(String(gf.id)));
      if (matched.length > 0) return matched;
    }

    // 2. Location-based resolution
    const empLoc = String(employee.location || '').trim().toLowerCase();
    if (empLoc) {
      // Direct exact match by geofence name
      const exactMatches = allGeofences.filter(gf => String(gf.name || '').trim().toLowerCase() === empLoc);
      if (exactMatches.length > 0) return exactMatches;

      // Headquarters / HQ -> Noida Office
      if (empLoc === 'headquarters' || empLoc === 'head office' || empLoc === 'hq') {
        const hqGf = allGeofences.filter(gf => String(gf.name || '').toLowerCase().includes('noida'));
        if (hqGf.length > 0) return hqGf;
      }

      // Substring match
      const subMatches = allGeofences.filter(gf => String(gf.name || '').toLowerCase().includes(empLoc));
      if (subMatches.length > 0) return subMatches;

      // Region mappings for known field operating territories
      if (empLoc === 'punjab') {
        const punjabGfs = allGeofences.filter(gf => gf.latitude >= 31.0 && gf.latitude <= 32.5 && gf.longitude >= 74.0 && gf.longitude <= 76.5);
        if (punjabGfs.length > 0) return punjabGfs;
      }
      if (empLoc === 'up' || empLoc === 'uttar pradesh') {
        const upGfs = allGeofences.filter(gf => gf.latitude >= 25.0 && gf.latitude <= 27.0 && gf.longitude >= 82.5 && gf.longitude <= 85.0);
        if (upGfs.length > 0) return upGfs;
      }
      if (empLoc === 'hp' || empLoc === 'himachal' || empLoc === 'himachal pradesh') {
        const hpGfs = allGeofences.filter(gf => gf.latitude >= 30.3 && gf.latitude <= 31.2 && gf.longitude >= 77.0 && gf.longitude <= 78.0);
        if (hpGfs.length > 0) return hpGfs;
      }
    }

    // 3. Fallback for office staff -> Noida HQ Office (Geofence #1)
    const isOffice = String(employee.designation || '').trim().toUpperCase() === 'OFFICE' || 
                     String(employee.primaryWorkMode || employee.primary_work_mode || '').trim().toLowerCase() === 'office';
    if (isOffice) {
      const noidaGf = allGeofences.filter(gf => String(gf.name || '').toLowerCase().includes('noida'));
      if (noidaGf.length > 0) return noidaGf;
      return [allGeofences[0]];
    }

    return [];
  }

  /**
   * Validate coordinates accuracy and filter out unreliable or cellular pings
   */
  isReliableGpsPing(ping) {
    if (!ping) return false;
    if (ping.latitude == null || ping.longitude == null) return false;

    const lat = parseFloat(ping.latitude);
    const lon = parseFloat(ping.longitude);
    if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return false;

    // Reject mock location pings
    if (ping.isMockLocation === true || ping.is_mock_location === true) return false;

    // Reject cellular tower jumps, wifi and network location estimations
    const method = String(ping.trackingMethod || ping.tracking_method || ping.provider || '').toUpperCase();
    const hasCellId = Boolean(ping.cellId || ping.cell_id);
    if (method.includes('CELL') || method.includes('TOWER') || method.includes('WIFI') || method.includes('NETWORK') || hasCellId) {
      return false;
    }

    // Accuracy guard: Coarse readings (> 500m) are unreliable and cannot trigger alerts
    const accuracy = parseFloat(ping.accuracy);
    if (!isNaN(accuracy) && accuracy > 500) {
      return false;
    }

    return true;
  }

  /**
   * Check if employee has an active attendance session today
   */
  async getActiveAttendanceSession(employee, possibleUserIds, targetDate) {
    const todayIST = targetDate || this.getAuthoritativeISTDate();
    let altDate = todayIST;
    if (todayIST && todayIST.includes('-')) {
      const parts = todayIST.split('-');
      if (parts.length === 3) altDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    const attRecord = await Attendance.findOne({
      where: {
        userId: { [Op.in]: possibleUserIds },
        [Op.or]: [
          { date: { [Op.in]: [todayIST, altDate] } },
          sequelize.where(sequelize.fn('date', sequelize.col('createdAt')), todayIST)
        ],
        checkIn: { [Op.ne]: null }
      },
      order: [['createdAt', 'DESC']]
    });

    if (!attRecord) return null;

    // Check if explicitly checked out
    const isCheckedOut = attRecord.checkOut &&
      attRecord.checkOut !== 'null' &&
      attRecord.checkOut !== 'undefined' &&
      String(attRecord.checkOut).trim() !== '' &&
      String(attRecord.checkOut).trim() !== '-';

    if (isCheckedOut) return null;

    return attRecord;
  }

  /**
   * Validate if timestamp falls within employee's configured working hours
   */
  isWithinWorkingHours(employee, timestamp) {
    const empShift = ShiftEngine.resolveEmployeeShift(employee);
    const validTs = Number(timestamp) || Date.now();
    const istTimeStr = this.formatISTTime(validTs);

    const currentMinutes = ShiftEngine.parseTimeToMinutes(istTimeStr);
    const startMinutes = ShiftEngine.parseTimeToMinutes(empShift.start || '09:00:00');
    const endMinutes = ShiftEngine.parseTimeToMinutes(empShift.end || '18:00:00');

    if (currentMinutes == null || startMinutes == null || endMinutes == null) {
      return true; // If parse fails, do not block
    }

    // Regular daytime shift
    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    // Overnight shift crossing midnight
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  /**
   * Check whether coordinates are inside any of the assigned geofences
   */
  checkGeofenceBoundary(latitude, longitude, assignedGeofences) {
    if (!assignedGeofences || assignedGeofences.length === 0) {
      return { isInside: true, distance: 0, geofence: null };
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    let minDistance = Infinity;
    let closestGf = null;

    for (const gf of assignedGeofences) {
      const radius = parseFloat(gf.radius) || 100;
      const gfLat = parseFloat(gf.latitude);
      const gfLon = parseFloat(gf.longitude);
      const dist = getDistance(lat, lon, gfLat, gfLon);

      if (dist < minDistance) {
        minDistance = dist;
        closestGf = gf;
      }

      // If inside ANY assigned geofence (with 10m drift buffer)
      if (dist <= (radius + GPS_BUFFER_METERS)) {
        return {
          isInside: true,
          distance: dist,
          geofence: gf,
          minDistanceMeters: Math.round(dist)
        };
      }
    }

    return {
      isInside: false,
      distance: minDistance,
      geofence: closestGf,
      minDistanceMeters: Math.round(minDistance)
    };
  }

  /**
   * Main evaluation pipeline for an incoming location ping:
   * 1. Validate employee & canonical identity
   * 2. Filter invalid coordinates & unreliable GPS readings
   * 3. Check active attendance session (must be clocked in, not checked out)
   * 4. Check configured working hours
   * 5. Check boundary against assigned geofence
   * 6. Atomically update consecutive counter in database
   * 7. Trigger alert after 2 consecutive outside pings (single alert per continuous event)
   */
  async evaluatePing(ping, options = {}) {
    const rawUserId = ping.userId || ping.user_id;
    if (!rawUserId) return { status: 'SKIPPED_NO_USER' };

    // 1. Resolve canonical employee
    const { empMap, empAliasesMap } = await getCachedEmployees();
    const resolvedEmp = await resolveCanonicalEmployee(rawUserId, empMap);
    const canonicalId = resolvedEmp ? resolvedEmp.canonicalId : String(rawUserId);
    const userAliases = (empAliasesMap && empAliasesMap.get(String(rawUserId).trim().toLowerCase())) || [String(rawUserId)];

    let empObj = resolvedEmp ? resolvedEmp.employee : null;
    if (!empObj) {
      empObj = await Employee.findOne({
        where: {
          [Op.or]: [
            { id: { [Op.in]: userAliases } },
            { empCode: { [Op.in]: userAliases } },
            { name: { [Op.in]: userAliases } }
          ]
        }
      });
    }

    if (!empObj) {
      return { status: 'SKIPPED_EMP_NOT_FOUND', userId: rawUserId };
    }

    const possibleUserIds = Array.from(new Set([empObj.id, empObj.empCode, empObj.name, canonicalId, String(rawUserId), ...userAliases].filter(Boolean)));

    // 2. Validate GPS accuracy & reliability rules
    if (!this.isReliableGpsPing(ping)) {
      return { status: 'SKIPPED_UNRELIABLE', userId: canonicalId, accuracy: ping.accuracy, trackingMethod: ping.trackingMethod };
    }

    const validTimestamp = Number(ping.timestamp) || Date.now();
    const targetDate = ping.date || this.getAuthoritativeISTDate(validTimestamp);

    // 3. Active Attendance Check
    const activeSession = await this.getActiveAttendanceSession(empObj, possibleUserIds, targetDate);
    if (!activeSession) {
      return { status: 'SKIPPED_NO_ACTIVE_ATTENDANCE', userId: canonicalId, date: targetDate };
    }

    // 4. Configured Working Hours Check
    const inWorkingHours = this.isWithinWorkingHours(empObj, validTimestamp);
    if (!inWorkingHours) {
      return { status: 'SKIPPED_OUTSIDE_WORKING_HOURS', userId: canonicalId };
    }

    // 5. Resolve assigned geofences
    const assignedGeofences = await this.resolveAssignedGeofences(empObj);
    if (!assignedGeofences || assignedGeofences.length === 0) {
      return { status: 'SKIPPED_NO_ASSIGNED_GEOFENCE', userId: canonicalId };
    }

    // 6. Check geofence boundary
    const boundaryResult = this.checkGeofenceBoundary(ping.latitude, ping.longitude, assignedGeofences);

    // 7. Atomic State Update in Database (Row-level lock prevents race conditions)
    let alertTriggered = false;
    let currentCount = 0;
    let isAlertSent = false;

    const tx = options.transaction || await sequelize.transaction();
    const isExternalTx = Boolean(options.transaction);

    try {
      // Find or create persistent tracking state for employee
      let [state] = await EmployeeGeofenceTrackingState.findOrCreate({
        where: { employeeId: canonicalId },
        defaults: {
          employeeId: canonicalId,
          attendanceId: String(activeSession.id),
          consecutiveOutsideCount: 0,
          alertSent: false,
          lastStatus: 'NONE'
        },
        transaction: tx
      });

      // Row-level lock in Postgres to prevent concurrent pings from double-firing
      if (sequelize.options.dialect === 'postgres') {
        const lockedRows = await sequelize.query(
          'SELECT * FROM employee_geofence_tracking_states WHERE employee_id = :empId FOR UPDATE;',
          { replacements: { empId: canonicalId }, transaction: tx, type: sequelize.QueryTypes.SELECT }
        );
        if (lockedRows && lockedRows.length > 0) {
          state = await EmployeeGeofenceTrackingState.findByPk(canonicalId, { transaction: tx });
        }
      }

      state.attendanceId = String(activeSession.id);
      state.lastPingTimestamp = validTimestamp;
      state.lastEvaluatedLat = parseFloat(ping.latitude);
      state.lastEvaluatedLon = parseFloat(ping.longitude);

      if (boundaryResult.isInside) {
        // Return inside: reset consecutive outside count and clear alertSent flag
        state.consecutiveOutsideCount = 0;
        state.alertSent = false;
        state.lastStatus = 'INSIDE';
        await state.save({ transaction: tx });
        currentCount = 0;
        isAlertSent = false;
      } else {
        // Outside geofence: increment consecutive count
        state.consecutiveOutsideCount = (state.consecutiveOutsideCount || 0) + 1;
        state.lastStatus = 'OUTSIDE';
        state.lastOutsidePingAt = new Date(validTimestamp);
        currentCount = state.consecutiveOutsideCount;

        // ALERT RULE: Exactly 2 consecutive outside pings triggers alert once per continuous outside event
        if (state.consecutiveOutsideCount >= 2 && !state.alertSent) {
          state.alertSent = true;
          state.lastAlertSentAt = new Date();
          alertTriggered = true;
          isAlertSent = true;
        } else {
          isAlertSent = Boolean(state.alertSent);
        }

        await state.save({ transaction: tx });
      }

      if (!isExternalTx) {
        await tx.commit();
      }
    } catch (dbErr) {
      if (!isExternalTx) {
        try { await tx.rollback(); } catch (_) {}
      }
      console.error(`[GeofenceAlertService] Database state update error for ${canonicalId}:`, dbErr.message);
      return { status: 'ERROR', error: dbErr.message };
    }

    // 8. If alert triggered, dispatch notification safely through existing notification service
    if (alertTriggered) {
      const alertTitle = '⚠️ Geofence Boundary Alert';
      const alertBody = "⚠️ You are outside your designated work geofence. Please ensure you remain within the permitted work location during working hours. If you have an approved work-related reason to leave, please follow your company's attendance policy.";
      const alertPayload = {
        type: 'OUTSIDE_GEOFENCE',
        employeeId: canonicalId,
        employeeName: empObj.name || '',
        empCode: empObj.empCode || canonicalId,
        department: empObj.department || '',
        designation: empObj.designation || '',
        consecutiveCount: currentCount,
        distanceMeters: boundaryResult.minDistanceMeters,
        nearestGeofence: boundaryResult.geofence ? boundaryResult.geofence.name : 'Work Location',
        timestamp: validTimestamp
      };

      try {
        console.log(`[GeofenceAlertService] 🚨 Dispatched Outside-Geofence Alert for ${canonicalId} (${empObj.name}) after ${currentCount} consecutive outside pings.`);
        const notifRes = await NotificationService.sendToEmployee(empObj.id || canonicalId, alertTitle, alertBody, alertPayload, 'SYSTEM');
        if (!notifRes || !notifRes.success) {
          console.warn(`[GeofenceAlertService] Notification dispatch indicated non-success for ${canonicalId}`);
        }
      } catch (notifErr) {
        console.error(`[GeofenceAlertService] Notification delivery failed for ${canonicalId}:`, notifErr.message);
        // If delivery critically threw an error before reaching device, allow retry on next ping by resetting state.alertSent
        state.alertSent = false;
        await state.save().catch(() => {});
      }
    }

    return {
      status: boundaryResult.isInside ? 'INSIDE' : 'OUTSIDE',
      userId: canonicalId,
      consecutiveCount: currentCount,
      alertSent: isAlertSent,
      alertTriggered,
      distanceMeters: boundaryResult.minDistanceMeters,
      nearestGeofence: boundaryResult.geofence ? boundaryResult.geofence.name : null
    };
  }

  /**
   * Reset tracking state for an employee when attendance session ends or begins
   */
  async resetTrackingState(employeeId, newAttendanceId = null) {
    if (!employeeId) return;
    try {
      const { empMap } = await getCachedEmployees();
      const resolvedEmp = await resolveCanonicalEmployee(employeeId, empMap);
      const canonicalId = resolvedEmp ? resolvedEmp.canonicalId : String(employeeId);
      const primaryId = resolvedEmp?.employee?.id;

      const idsToReset = Array.from(new Set([canonicalId, primaryId, String(employeeId)].filter(Boolean)));
      for (const id of idsToReset) {
        await EmployeeGeofenceTrackingState.upsert({
          employeeId: id,
          attendanceId: newAttendanceId ? String(newAttendanceId) : null,
          consecutiveOutsideCount: 0,
          alertSent: false,
          lastStatus: 'NONE',
          lastOutsidePingAt: null,
          lastAlertSentAt: null,
          lastPingTimestamp: Date.now()
        });
      }

      console.log(`[GeofenceAlertService] Tracking state reset for ${canonicalId} (AttendanceId: ${newAttendanceId || 'NONE'})`);
    } catch (err) {
      console.warn(`[GeofenceAlertService] Failed to reset tracking state for ${employeeId}:`, err.message);
    }
  }
}

module.exports = new GeofenceAlertService();
