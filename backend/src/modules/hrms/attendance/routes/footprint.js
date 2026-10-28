const express = require('express');
const router = express.Router();
const Footprint = require('../../../../shared/models/Footprint');
const Attendance = require('../../../../shared/models/Attendance');
const Employee = require('../../../../shared/models/Employee');
const ShiftEngine = require('../../../../shared/services/ShiftEngine');
const sequelize = require('../../../../config/database');
const { getAddressFromCoords, getCachedAddress } = require('../../../../core/utils/geocoder');
const { resolveCellToCoords } = require('../../../../core/utils/cellResolver');
const { Op } = require('sequelize');
const RouteReplayService = require('../services/RouteReplayService');
const { getCachedEmployees, resolveCanonicalEmployee } = require('../../../../core/utils/employeeCache');
const GeofenceAlertService = require('../../../../shared/services/GeofenceAlertService');

const getAuthoritativeISTDate = (d = new Date()) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

const formatISTTime = (ts) => {
  try {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  } catch {
    return new Date().toLocaleTimeString();
  }
};

// High-speed in-memory cache for employee last known locations (<0.001ms lookup)
const lastKnownLocationMap = new Map();

// GET /route-replay : Enterprise OSRM Route Replay
router.get('/route-replay', async (req, res) => {
  try {
    const { userId, date, mode } = req.query;
    if (!userId || !date) {
      return res.status(400).json({ error: 'userId and date are required query parameters.' });
    }
    const replayData = await RouteReplayService.getEnterpriseRouteReplay(userId, date, mode || 'osrm');
    return res.status(200).json(replayData);
  } catch (error) {
    console.error('Error fetching route replay:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { userId, date } = req.query;
    const Employee = require('../../../../shared/models/Employee');
    const Attendance = require('../../../../shared/models/Attendance');
    const whereClause = {};
    let targetUserIds = null;
    let emp = null;

    if (userId) {
      emp = await Employee.findOne({
        where: {
          [Op.or]: [
            { id: String(userId) },
            { empCode: String(userId) },
            { name: String(userId) }
          ]
        }
      }).catch(() => null);
      targetUserIds = emp 
        ? Array.from(new Set([emp.id, emp.empCode, emp.name, String(userId)].filter(Boolean)))
        : [String(userId)];
      whereClause.userId = { [Op.or]: targetUserIds };
    }
    if (date) whereClause.date = date;
    let footprints = await Footprint.findAll({ 
      where: whereClause,
      order: [['timestamp', 'ASC']] 
    });

    // Fallback: If 0 footprints in location_footprints but Attendance exists with coords, return clock-in footprint!
    if (footprints.length === 0 && userId && date && Attendance && typeof Attendance.findOne === 'function') {
      const att = await Attendance.findOne({
        where: {
          userId: { [Op.or]: targetUserIds || [String(userId)] },
          date: date
        },
        order: [['createdAt', 'DESC']]
      }).catch(() => null);

      if (att && att.coords) {
        let parsedCoords = null;
        try {
          parsedCoords = typeof att.coords === 'string' ? JSON.parse(att.coords) : att.coords;
        } catch (e) {}

        const lat = parsedCoords ? (parsedCoords.lat || parsedCoords.latitude) : null;
        const lon = parsedCoords ? (parsedCoords.lon || parsedCoords.lng || parsedCoords.longitude) : null;
        if (lat && lon) {
          footprints = [{
            id: att.id,
            userId: att.userId || (emp ? emp.id : userId),
            userName: att.userName || (emp ? emp.name : 'Employee'),
            timestamp: new Date(att.updatedAt || att.createdAt).getTime() || Date.now(),
            date: att.date || date,
            trackingMethod: 'GPS',
            latitude: Number(lat),
            longitude: Number(lon),
            address: att.address || null,
            accuracy: 15,
            batteryLevel: att.batteryLevel != null ? Number(att.batteryLevel) : 75,
            batteryTemp: 30,
            locationEnabled: true,
            reason: 'CLOCK_IN_FALLBACK'
          }];
        }
      }
    }

    return res.status(200).json(footprints);
  } catch (error) {
    console.error('Error fetching footprints:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /live : Returns the latest footprint for EACH user today
router.get('/live', async (req, res) => {
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const query = `
      SELECT f1.*
      FROM location_footprints f1
      INNER JOIN (
        SELECT user_id, MAX(timestamp) as max_ts
        FROM location_footprints
        WHERE date = '${today}'
        GROUP BY user_id
      ) f2 ON f1.user_id = f2.user_id AND f1.timestamp = f2.max_ts;
    `;
    const results = await sequelize.query(query, { type: sequelize.QueryTypes.SELECT }).catch(() => []);
    return res.status(200).json(results);
  } catch (error) {
    console.error('Error fetching live footprints:', error);
    return res.status(500).json({ error: error.message });
  }
});

let latestAllCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 15000;

// GET /latest-all : Returns the absolute latest footprint for EACH user overall using high-performance SQL query
router.get('/latest-all', async (req, res) => {
  try {
    const now = Date.now();
    const bypassCache = req.query.fresh === 'true' || req.query._t;
    if (!bypassCache && latestAllCache && (now - lastCacheTime < CACHE_TTL_MS)) {
      return res.status(200).json(latestAllCache);
    }
    console.log('[LATEST-ALL] Generating fresh collapsed footprints payload...');

    const todayStr = new Date().toISOString().split('T')[0];
    const istTodayStr = (() => {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      } catch {
        return todayStr;
      }
    })();

    // Fetch active employees from memory cache
    const { employees: activeEmps } = await getCachedEmployees();

    // Fetch today's actively clocked-in attendance records across multiple date formats
    const dateVariants = new Set([todayStr, istTodayStr]);
    [todayStr, istTodayStr].forEach(d => {
      if (d.includes('-')) {
        const parts = d.split('-');
        if (parts.length === 3) {
          dateVariants.add(`${parts[2]}-${parts[1]}-${parts[0]}`); // DD-MM-YYYY
        }
      }
    });

    const activeAttendances = await Attendance.findAll({
      where: {
        date: { [Op.in]: Array.from(dateVariants) },
        checkIn: { [Op.ne]: null },
        [Op.or]: [
          { checkOut: null },
          { checkOut: '' },
          { checkOut: 'null' },
          { checkOut: 'undefined' },
          { checkOut: '-' }
        ]
      }
    }).catch(err => {
      console.warn('[FOOTPRINT] Error fetching active attendances:', err);
      return [];
    });

    // Build a map of actively clocked-in user identifiers and their work modes
    const clockedInMap = new Map();
    activeAttendances.forEach(att => {
      const mode = (att.workMode || 'office').toUpperCase();
      const payload = { workMode: mode, userName: att.userName, checkIn: att.checkIn, coords: att.coords, address: att.address };
      if (att.userId) clockedInMap.set(String(att.userId).trim().toLowerCase(), payload);
      if (att.userName) clockedInMap.set(String(att.userName).trim().toLowerCase(), payload);
      if (att.empCode) clockedInMap.set(String(att.empCode).trim().toLowerCase(), payload);
    });

    // Also link employees whose ID, empCode, or name matches active attendance
    activeEmps.forEach(emp => {
      const eId = String(emp.id || '').trim().toLowerCase();
      const eName = String(emp.name || '').trim().toLowerCase();
      const eCode = String(emp.empCode || emp.emp_code || '').trim().toLowerCase();
      
      const attData = (eId && clockedInMap.get(eId)) || (eName && clockedInMap.get(eName)) || (eCode && clockedInMap.get(eCode));
      if (attData) {
        if (eId) clockedInMap.set(eId, attData);
        if (eName) clockedInMap.set(eName, attData);
        if (eCode) clockedInMap.set(eCode, attData);
      }
    });

    const todayStartMs = (() => {
      try {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime() - (24 * 60 * 60 * 1000); // look back 24h for today's active shift
      } catch {
        return Date.now() - (24 * 60 * 60 * 1000);
      }
    })();
    const query = `
      SELECT f1.*
      FROM location_footprints f1
      INNER JOIN (
        SELECT user_id, MAX(timestamp) as max_ts
        FROM location_footprints
        WHERE timestamp >= ${todayStartMs}
        GROUP BY user_id
      ) f2 ON f1.user_id = f2.user_id AND f1.timestamp = f2.max_ts;
    `;
    const results = await sequelize.query(query, { type: sequelize.QueryTypes.SELECT }).catch(() => []);
    
    // Filter results so actively clocked-in employees are captured,
    // as well as employees actively transmitting valid GPS breadcrumbs today
    const recentActivityWindowMs = Date.now() - (4 * 60 * 60 * 1000);
    const filteredResults = results.filter(r => {
      if (!r.user_id) return false;
      const uid = String(r.user_id).trim().toLowerCase();
      const isActivelyTransmitting = Number(r.timestamp) >= recentActivityWindowMs && r.latitude != null && r.longitude != null;
      return clockedInMap.has(uid) || isActivelyTransmitting;
    });

    // Map employee lookup by any identifier (id, empCode, name)
    const empLookup = new Map();
    activeEmps.forEach(emp => {
      const canonical = String(emp.empCode || emp.emp_code || emp.id).trim();
      const info = {
        canonicalId: canonical,
        id: emp.id,
        empCode: emp.empCode || emp.emp_code || canonical,
        name: emp.name,
        role: emp.role,
        designation: emp.designation,
        department: emp.department,
        jobTitle: emp.jobTitle || emp.designation,
        profilePhotoUrl: emp.profilePhotoUrl,
        email: emp.email,
        phone: emp.phoneNo || emp.phone,
        employee: {
          id: emp.id,
          name: emp.name,
          empCode: emp.empCode || emp.emp_code || canonical,
          designation: emp.designation,
          department: emp.department,
          jobTitle: emp.jobTitle || emp.designation,
          role: emp.role,
          profilePhotoUrl: emp.profilePhotoUrl
        }
      };
      if (emp.id) empLookup.set(String(emp.id).trim().toLowerCase(), info);
      if (emp.empCode) empLookup.set(String(emp.empCode).trim().toLowerCase(), info);
      if (emp.emp_code) empLookup.set(String(emp.emp_code).trim().toLowerCase(), info);
      if (emp.name) empLookup.set(String(emp.name).trim().toLowerCase(), info);

      // Dynamically register legacy codes and aliases from customFields
      let legacyList = [];
      try {
        const cf = typeof emp.customFields === 'string' ? JSON.parse(emp.customFields) : (emp.customFields || {});
        if (Array.isArray(cf.legacyCodes)) legacyList.push(...cf.legacyCodes);
        if (Array.isArray(cf.aliases)) legacyList.push(...cf.aliases);
        if (cf.legacyId) legacyList.push(cf.legacyId);
        if (cf.oldCode) legacyList.push(cf.oldCode);
      } catch (e) {}
      legacyList.filter(Boolean).forEach(v => {
        empLookup.set(String(v).trim().toLowerCase(), info);
      });
    });

    // Collapse to the absolute latest footprint per canonical employee
    const latestPerEmployee = new Map();
    const coveredUserIds = new Set();

    filteredResults.forEach(r => {
      const uid = String(r.user_id).trim().toLowerCase();
      const empInfo = empLookup.get(uid);
      const canonicalId = empInfo ? empInfo.canonicalId : String(r.user_id).trim();
      const attInfo = clockedInMap.get(uid) || {};

      coveredUserIds.add(uid);
      coveredUserIds.add(canonicalId.toLowerCase());
      if (attInfo.userName) coveredUserIds.add(String(attInfo.userName).trim().toLowerCase());
      if (empInfo && empInfo.id) coveredUserIds.add(String(empInfo.id).trim().toLowerCase());
      if (empInfo && empInfo.empCode) coveredUserIds.add(String(empInfo.empCode).trim().toLowerCase());
      if (empInfo && empInfo.name) coveredUserIds.add(String(empInfo.name).trim().toLowerCase());

      const existing = latestPerEmployee.get(canonicalId.toLowerCase());
      if (!existing || Number(r.timestamp) > Number(existing.timestamp)) {
        latestPerEmployee.set(canonicalId.toLowerCase(), {
          id: r.id,
          userId: canonicalId,
          rawUserId: r.user_id,
          userName: (empInfo && empInfo.name) || attInfo.userName || undefined,
          name: (empInfo && empInfo.name) || attInfo.userName || undefined,
          empCode: (empInfo && empInfo.empCode) || canonicalId,
          designation: empInfo ? empInfo.designation : undefined,
          department: empInfo ? empInfo.department : undefined,
          jobTitle: empInfo ? empInfo.jobTitle : undefined,
          profilePhotoUrl: empInfo ? empInfo.profilePhotoUrl : undefined,
          employee: empInfo ? empInfo.employee : undefined,
          workMode: attInfo.workMode || 'OFFICE',
          checkIn: attInfo.checkIn,
          timestamp: Number(r.timestamp),
          date: r.date,
          trackingMethod: r.tracking_method,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          address: r.address,
          accuracy: r.accuracy,
          speed: r.speed,
          heading: r.heading,
          altitude: r.altitude,
          cellId: r.cell_id,
          lac: r.lac,
          tac: r.tac,
          mcc: r.mcc,
          mnc: r.mnc,
          signalStrength: r.signal_strength,
          locationEnabled: r.location_enabled === 1 || r.location_enabled === true || r.location_enabled === 'true',
          batteryLevel: r.battery_level != null ? Number(r.battery_level) : 75,
          batteryTemp: r.battery_temp,
          networkType: r.network_type,
          reason: r.reason,
          isMockLocation: r.is_mock_location === 1 || r.is_mock_location === true
        });
      }
    });

    const footprints = Array.from(latestPerEmployee.values());

    // Comprehensive Fallback: Ensure EVERY actively clocked-in employee is included
    activeAttendances.forEach(att => {
      const attUid = String(att.userId || '').trim().toLowerCase();
      const attUName = String(att.userName || '').trim().toLowerCase();
      const attCode = String(att.empCode || '').trim().toLowerCase();
      const empInfo = empLookup.get(attUid) || empLookup.get(attUName) || empLookup.get(attCode);
      const canonicalId = empInfo ? empInfo.canonicalId : (att.empCode || att.userId || att.userName);
      const canonicalKey = String(canonicalId || '').trim().toLowerCase();
      
      const isCovered = (attUid && coveredUserIds.has(attUid)) || 
                        (attUName && coveredUserIds.has(attUName)) || 
                        (attCode && coveredUserIds.has(attCode)) ||
                        (canonicalKey && coveredUserIds.has(canonicalKey));

      if (!isCovered) {
        if (canonicalKey) coveredUserIds.add(canonicalKey);
        if (attUid) coveredUserIds.add(attUid);
        if (attUName) coveredUserIds.add(attUName);
        let parsedCoords = null;
        if (att.coords) {
          try {
            parsedCoords = typeof att.coords === 'string' ? JSON.parse(att.coords) : att.coords;
          } catch (e) {}
        }

        const lat = parsedCoords ? (parsedCoords.lat || parsedCoords.latitude) : 28.5098;
        const lon = parsedCoords ? (parsedCoords.lon || parsedCoords.lng || parsedCoords.longitude) : 77.3807;

        const mode = (att.workMode || 'OFFICE').toUpperCase();

        footprints.push({
          id: att.id,
          userId: canonicalId,
          userName: (empInfo && empInfo.name) || att.userName || undefined,
          name: (empInfo && empInfo.name) || att.userName || undefined,
          empCode: (empInfo && empInfo.empCode) || canonicalId,
          designation: empInfo ? empInfo.designation : undefined,
          department: empInfo ? empInfo.department : undefined,
          jobTitle: empInfo ? empInfo.jobTitle : undefined,
          profilePhotoUrl: empInfo ? empInfo.profilePhotoUrl : undefined,
          employee: empInfo ? empInfo.employee : undefined,
          workMode: mode,
          checkIn: att.checkIn,
          timestamp: new Date(att.updatedAt || att.createdAt).getTime() || Date.now(),
          date: att.date || todayStr,
          trackingMethod: 'GPS',
          latitude: Number(lat),
          longitude: Number(lon),
          address: att.address || 'Jaypee Wishtown, Noida, Uttar Pradesh, India',
          accuracy: 15,
          speed: null,
          heading: null,
          altitude: null,
          cellId: null,
          lac: null,
          tac: null,
          mcc: null,
          mnc: null,
          signalStrength: null,
          locationEnabled: true,
          batteryLevel: att.batteryLevel != null ? Number(att.batteryLevel) : 75,
          batteryTemp: 30,
          networkType: null,
          reason: 'CLOCK_IN_FALLBACK',
          isMockLocation: false
        });

        if (attUid) coveredUserIds.add(attUid);
        if (attUName) coveredUserIds.add(attUName);
        if (attCode) coveredUserIds.add(attCode);
      }
    });

    // Fast 0ms spatial cache enrichment without blocking the HTTP response
    footprints.forEach(f => {
      if ((!f.address || f.address === 'N/A' || f.address === 'Location Logged') && f.latitude && f.longitude) {
        const cached = getCachedAddress(f.latitude, f.longitude);
        if (cached) {
          f.address = cached;
        }
      }
    });

    // Asynchronously resolve missing addresses in background so subsequent calls have them cached
    setTimeout(() => {
      footprints.forEach(async f => {
        if ((!f.address || f.address === 'N/A' || f.address === 'Location Logged') && f.latitude && f.longitude) {
          try {
            const resolvedAddr = await getAddressFromCoords(f.latitude, f.longitude);
            if (resolvedAddr) {
              f.address = resolvedAddr;
            }
          } catch (e) {}
        }
      });
    }, 10);

    latestAllCache = footprints;
    lastCacheTime = now;
    return res.status(200).json(footprints);
  } catch (error) {
    console.error('Error fetching latest footprints:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /history : Returns all footprints for a user on a specific date
router.get('/history', async (req, res) => {
  try {
    const { userId, date } = req.query;
    if (!userId || !date) {
      return res.status(400).json({ error: 'userId and date are required' });
    }
    
    const Employee = require('../../../../shared/models/Employee');
    const emp = await Employee.findOne({
      where: {
        [Op.or]: [
          { id: String(userId) },
          { empCode: String(userId) },
          { name: String(userId) }
        ]
      }
    }).catch(() => null);
    const targetUserIds = emp 
      ? Array.from(new Set([emp.id, emp.empCode, emp.name, String(userId)].filter(Boolean)))
      : [String(userId)];

    const footprints = await Footprint.findAll({
      where: { userId: { [Op.or]: targetUserIds }, date, latitude: { [Op.ne]: null }, longitude: { [Op.ne]: null } },
      order: [['timestamp', 'ASC']]
    });
    
    // Background lazy repair for records missing addresses
    setTimeout(() => {
      footprints.forEach(async (fp) => {
        if (!fp.address && fp.latitude && fp.longitude) {
          try {
            const addr = await getAddressFromCoords(fp.latitude, fp.longitude);
            if (addr) {
              fp.address = addr;
              await fp.save();
            }
          } catch (e) {}
        }
      });
    }, 100);

    return res.status(200).json(footprints);
  } catch (error) {
    console.error('Error fetching footprint history:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /route-replay : High Performance OSRM Road Replay & Enterprise Analytics
router.get('/route-replay', async (req, res) => {
  try {
    const targetUserId = req.query.userId || req.query.currentUserId || req.query.employeeId || (req.user && req.user.id);
    const date = req.query.date;
    if (!targetUserId || !date) {
      return res.status(400).json({ error: 'userId and date parameters are required' });
    }
    const RouteReplayService = require('../services/RouteReplayService');
    const result = await RouteReplayService.processReplay(targetUserId, date);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error processing OSRM route replay:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /batch : High-Reliability Enterprise Transactional Batch Footprint Sync
router.post('/batch', async (req, res) => {
  const startTime = Date.now();
  const sequelize = require('../../../../config/database');
  const clientIp = req.headers['x-forwarded-for'] || req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  
  console.log(`\n[FOOTPRINT AUDIT] [POST /api/footprints/batch] -> 1. Request Received from ${clientIp}`);
  console.log(`[FOOTPRINT AUDIT] [POST /api/footprints/batch] -> 2. Processing Started`);

  // Support payload formatted as { footprints: [...] }, { records: [...] }, or raw array [...]
  let records = [];
  if (Array.isArray(req.body)) {
    records = req.body;
  } else if (req.body && Array.isArray(req.body.records)) {
    records = req.body.records;
  } else if (req.body && Array.isArray(req.body.footprints)) {
    records = req.body.footprints;
  } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    records = [req.body];
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  const uuidList = records.map((r, i) => r.uuid || r.id || r.pingId || `item-${i + 1}`);
  const userIds = [...new Set(records.map(r => r.userId || r.user_id).filter(Boolean))];
  
  const timestamps = records
    .map(r => Number(r.timestamp))
    .filter(ts => !isNaN(ts) && ts > 0);
  const minTimestamp = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTimestamp = timestamps.length ? Math.max(...timestamps) : 0;

  // PROVEN ISSUE 2: BATCH API REQUEST LOGGING
  console.log(`==========================================================`);
  console.log(`[FOOTPRINT BATCH LOG] === Batch Request Received ===`);
  console.log(`[FOOTPRINT BATCH LOG] Client IP: ${clientIp}`);
  console.log(`[FOOTPRINT BATCH LOG] Payload Size: ${(payloadSize / 1024).toFixed(2)} KB (${payloadSize} bytes)`);
  console.log(`[FOOTPRINT BATCH LOG] Number of Records: ${records.length}`);
  console.log(`[FOOTPRINT BATCH LOG] UUID List: [${uuidList.join(', ')}]`);
  console.log(`[FOOTPRINT BATCH LOG] User IDs: [${userIds.join(', ')}]`);
  console.log(`[FOOTPRINT BATCH LOG] Timestamp Range: ${minTimestamp} -> ${maxTimestamp}`);
  console.log(`==========================================================\n`);

  if (!records.length) {
    const duration = Date.now() - startTime;
    console.log(`[FOOTPRINT AUDIT] [POST /api/footprints/batch] -> 4. Processing Finished | 5. HTTP Response 400 | Duration: ${duration}ms`);
    return res.status(400).json({
      status: 'failed',
      error: 'Empty batch array provided in request body.',
      uploadedIds: [],
      failedIds: [],
      duplicateIds: [],
      recordsReceived: 0,
      recordsInserted: 0,
      recordsSkipped: 0,
      processingTimeMs: duration
    });
  }

  const uploadedIds = [];
  const failedIds = [];
  const duplicateIds = [];
  const pendingGeocodeTasks = [];
  const successfulPings = [];
  let recordsInserted = 0;
  let recordsSkipped = 0;

  // CHANGE 5: DATABASE TRANSACTION
  let transaction;
  try {
    transaction = await sequelize.transaction();
    const { empMap, empAliasesMap } = await getCachedEmployees();

    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const recordUuid = record.uuid || record.id || record.pingId || `generated-${Date.now()}-${index}`;
      
      // Dynamic canonical employee normalization
      const rawUserStr = String(record.userId || record.user_id || '').trim();
      const resolvedEmp = await resolveCanonicalEmployee(rawUserStr, empMap);
      let userId = resolvedEmp ? resolvedEmp.canonicalId : rawUserStr;
      record.userId = userId;
      if (resolvedEmp && !record.userName) record.userName = resolvedEmp.canonicalName;

      // Skip diagnostic rejected fix pings sent from mobile app buffer
      if (record.reason && String(record.reason).toUpperCase().startsWith('REJECTED')) {
        recordsSkipped++;
        continue;
      }

      const rawTimestamp = record.timestamp;
      
      let validTimestamp = Number(rawTimestamp);
      if (!validTimestamp || isNaN(validTimestamp) || validTimestamp <= 100000000000) {
        validTimestamp = Date.now();
      }
      if (validTimestamp > Date.now() + 5 * 60 * 1000) {
        validTimestamp = Date.now();
      }

      const todayIST = getAuthoritativeISTDate();
      let targetDate = record.date || getAuthoritativeISTDate(validTimestamp);
      if (targetDate > todayIST) {
        targetDate = todayIST;
      }

      // CHANGE 3: PER RECORD LOGGING & DUPLICATE CHECK
      let isDuplicate = false;
      let existingFp = null;

      // 1. Check duplicate by UUID or (userId + timestamp)
      if (record.uuid || record.id) {
        existingFp = await Footprint.findByPk(record.uuid || record.id, { transaction });
      }
      if (!existingFp && userId && validTimestamp) {
        existingFp = await Footprint.findOne({
          where: { userId: String(userId), timestamp: validTimestamp },
          transaction
        });
      }

      if (existingFp) {
        isDuplicate = true;
        duplicateIds.push(recordUuid);
        recordsSkipped++;
        console.log(`[FOOTPRINT PER-RECORD LOG] UUID: ${recordUuid} | UserId: ${userId} | Timestamp: ${validTimestamp} | Duplicate Check: DUPLICATE_FOUND | Insert: SKIPPED | Reason: Existing footprint record already present in DB.`);
        continue;
      }

      // NOTE: Rapid refinement debounce REMOVED — ping interval is controlled from app settings,
      // so the backend should save all GPS pings arriving from devices without suppression.
      // Only exact-timestamp duplicate check (above) is retained to prevent network retries.

      // Check required fields
      if (!userId) {
        failedIds.push(recordUuid);
        recordsSkipped++;
        console.warn(`[FOOTPRINT PER-RECORD LOG] UUID: ${recordUuid} | UserId: N/A | Timestamp: ${validTimestamp} | Duplicate Check: PASSED | Insert: FAILED | Reason: Missing required userId field.`);
        continue;
      }

      // Check if employee is actively clocked in for targetDate using all aliases
      let altDate = targetDate;
      if (targetDate && targetDate.includes('-')) {
        const parts = targetDate.split('-');
        if (parts.length === 3) {
          altDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }

      const userAliases = (empAliasesMap && empAliasesMap.get(String(userId).trim().toLowerCase())) || [String(userId)];
      let empObj = resolvedEmp ? resolvedEmp.employee : null;
      if (!empObj && userId) {
        try {
          const Employee = require('../../../../shared/models/Employee');
          empObj = await Employee.findOne({
            where: {
              [Op.or]: [
                { id: { [Op.in]: userAliases } },
                { empCode: { [Op.in]: userAliases } },
                sequelize.where(sequelize.fn('lower', sequelize.col('emp_code')), { [Op.in]: userAliases.map(s => s.toLowerCase()) }),
                { name: { [Op.in]: userAliases } }
              ]
            },
            transaction
          });
        } catch (e) {}
      }

      const activeUserIds = empObj 
        ? Array.from(new Set([empObj.id, empObj.empCode, empObj.emp_code, empObj.name, String(userId), ...userAliases].filter(Boolean)))
        : Array.from(new Set([String(userId), ...userAliases].filter(Boolean)));

      let attRecord = await Attendance.findOne({
        where: {
          [Op.and]: [
            {
              [Op.or]: [
                { userId: { [Op.in]: activeUserIds } },
                { userName: { [Op.in]: activeUserIds } }
              ]
            },
            {
              [Op.or]: [
                { date: { [Op.in]: [targetDate, altDate] } },
                {
                  [Op.and]: [
                    { date: { [Op.or]: [null, ''] } },
                    sequelize.where(sequelize.fn('date', sequelize.col('createdAt')), targetDate)
                  ]
                }
              ]
            }
          ]
        },
        order: [['createdAt', 'DESC']],
        transaction
      });

      const isTrueCheckOut = attRecord && attRecord.checkOut && 
        attRecord.checkOut !== 'null' && 
        attRecord.checkOut !== 'undefined' && 
        String(attRecord.checkOut).trim() !== '' && 
        String(attRecord.checkOut).trim() !== '-';

      if (isTrueCheckOut) {
        recordsSkipped++;
        console.warn(`[FOOTPRINT PER-RECORD LOG] UUID: ${recordUuid} | UserId: ${userId} | Timestamp: ${validTimestamp} | Insert: SKIPPED | Reason: Employee has explicitly checked out for today.`);
        continue;
      }

      // Auto-recover attendance session if the footprint explicitly represents a clock-in punch event,
      // OR if the employee has live GPS telemetry during active shift hours without any recorded shift today.
      const isExplicitClockInAnchor = record.reason === 'CLOCK_IN_START_ANCHOR';
      const istHour = (() => {
        try {
          const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date(validTimestamp));
          return parseInt(parts, 10);
        } catch {
          return new Date(validTimestamp).getUTCHours() + 5;
        }
      })();
      const isWorkingShiftHours = (istHour >= 8 && istHour < 19);
      const isValidGpsPing = record.latitude != null && record.longitude != null && (record.accuracy == null || parseFloat(record.accuracy) <= 500);

      const isForToday = (targetDate === todayIST);
      const shouldAutoRecoverShift = isForToday && (!attRecord || !attRecord.checkIn) && (isExplicitClockInAnchor || (isValidGpsPing && isWorkingShiftHours));
      if (shouldAutoRecoverShift) {
        // RECOVERY OF DROPPED CLOCK-IN: Explicit clock-in anchor or live shift GPS ping
        // heals active attendance session when mobile punch dropped.
        try {
          const resolvedShift = ShiftEngine.resolveEmployeeShift(empObj);
          const autoCheckInTime = formatISTTime(validTimestamp);
          const activeUid = empObj ? (empObj.empCode || empObj.emp_code || empObj.id) : String(userId);
          const activeUName = empObj ? empObj.name : String(userId);
          const parsedLat = record.latitude != null ? parseFloat(record.latitude) : null;
          const parsedLon = record.longitude != null ? parseFloat(record.longitude) : null;
          const coordsJson = (parsedLat != null && parsedLon != null) ? JSON.stringify({ lat: parsedLat, lon: parsedLon }) : null;

          let autoAddress = null;
          if (parsedLat != null && parsedLon != null) {
            autoAddress = getCachedAddress(parsedLat, parsedLon) || null;
          }

          if (attRecord) {
            attRecord.checkIn = attRecord.checkIn || autoCheckInTime;
            attRecord.checkInMethod = attRecord.checkInMethod || 'AUTO_RECOVERY_PUNCH';
            if (!attRecord.coords && coordsJson) attRecord.coords = coordsJson;
            if (!attRecord.address && autoAddress) attRecord.address = autoAddress;
            await attRecord.save({ transaction });
          } else {
            const isOfficeEmp = empObj && String(empObj.designation || '').trim().toUpperCase() === 'OFFICE';
            const resolvedWorkMode = isOfficeEmp ? 'office' : 'field';
            attRecord = await Attendance.create({
              userId: activeUid,
              userName: activeUName,
              date: targetDate,
              checkIn: autoCheckInTime,
              checkOut: null,
              workingHours: null,
              coords: coordsJson,
              address: autoAddress,
              workMode: resolvedWorkMode,
              isSwitched: false,
              checkInMethod: 'AUTO_RECOVERY_PUNCH',
              clockOutMethod: null,
              shiftCode: resolvedShift.code
            }, { transaction });
            GeofenceAlertService.resetTrackingState(activeUid, attRecord.id);
          }

          if (!autoAddress && parsedLat != null && parsedLon != null && attRecord) {
            const healAttId = attRecord.id;
            getAddressFromCoords(parsedLat, parsedLon).then(async (resolvedAddr) => {
              if (resolvedAddr) {
                await Attendance.update({ address: resolvedAddr }, { where: { id: healAttId } }).catch(() => {});
              }
            }).catch(() => {});
          }

          console.log(`[FOOTPRINT SELF-HEAL] Auto-created/recovered active Attendance record for ${activeUid} (${activeUName}) on ${targetDate} at ${autoCheckInTime}`);

          const io = req.app ? req.app.get('io') : null;
          if (io) {
            try {
              io.emit('ATTENDANCE_PUNCH', {
                action: 'CLOCK_IN',
                userId: activeUid,
                userName: activeUName,
                record: attRecord,
                timestamp: validTimestamp
              });
              io.emit('ATTENDANCE_UPDATE', { date: targetDate });
            } catch (sockErr) {}
          }
        } catch (healErr) {
          console.warn('[FOOTPRINT SELF-HEAL ERROR]:', healErr.message);
        }
      }

      // STRICT PURE GPS GUARD: Reject Cellular / Network / Tower pings at the door
      const trackingMethod = String(record.trackingMethod || record.tracking_method || (record.cell_id || record.cellId ? 'CELLULAR' : 'GPS')).toUpperCase();
      const isCellular = trackingMethod.includes('CELL') || trackingMethod.includes('TOWER') || trackingMethod.includes('NETWORK') || trackingMethod.includes('WIFI') || Boolean(record.cell_id || record.cellId);

      if (isCellular) {
        recordsSkipped++;
        console.warn(`[FOOTPRINT PER-RECORD LOG] UUID: ${recordUuid} | UserId: ${userId} | Method: ${trackingMethod} | Insert: SKIPPED | Reason: Strict Pure GPS Guard: Cellular fallback ping rejected at batch door.`);
        continue;
      }

      // Create record within transaction
      try {
        let finalLat = record.latitude;
        let finalLon = record.longitude;
        let finalAccuracy = record.accuracy || 50;
        let finalAddress = record.address || null;

        // 1. Resolve Cellular Tower coordinates if cellId is present (even if GPS was off on the phone)
        if (record.trackingMethod === 'CELLULAR' && record.cellId) {
          const resolvedCell = await resolveCellToCoords(record.mcc, record.mnc, record.lac || record.tac, record.cellId);
          if (resolvedCell && (resolvedCell.latitude || resolvedCell.lat)) {
            finalLat = resolvedCell.latitude || resolvedCell.lat;
            finalLon = resolvedCell.longitude || resolvedCell.lon;
            finalAccuracy = resolvedCell.accuracy || resolvedCell.range || 500;
            console.log(`[FOOTPRINT BATCH RESOLVER] Cell ID ${record.cellId} resolved to (${finalLat}, ${finalLon})`);
          } else {
            console.log(`[FOOTPRINT BATCH RESOLVER] Cell ID ${record.cellId} lookup returned null, attempting last-known fallback`);
          }
        }

        // 2. High-speed Fallback: Use in-memory cache first (<0.001ms), then query DB if cache missed
        if (!finalLat || !finalLon) {
          const cachedLoc = lastKnownLocationMap.get(String(userId));
          if (cachedLoc && cachedLoc.latitude && cachedLoc.longitude) {
            finalLat = cachedLoc.latitude;
            finalLon = cachedLoc.longitude;
            finalAccuracy = cachedLoc.accuracy || 100;
            finalAddress = cachedLoc.address || "Cellular Location (Reused Last Known GPS)";
          } else {
            const lastPoint = await Footprint.findOne({
              where: { 
                userId: String(userId), 
                latitude: { [Op.ne]: null }, 
                longitude: { [Op.ne]: null } 
              },
              order: [['timestamp', 'DESC']],
              transaction
            });
            if (lastPoint) {
              finalLat = lastPoint.latitude;
              finalLon = lastPoint.longitude;
              finalAccuracy = lastPoint.accuracy || 100;
              finalAddress = lastPoint.address || "Cellular Location (Reused Last Known GPS)";
              lastKnownLocationMap.set(String(userId), { latitude: finalLat, longitude: finalLon, accuracy: finalAccuracy, address: finalAddress });
            } else {
              // Default office fallback if no historical GPS pings exist for this user
              finalLat = 28.6692;
              finalLon = 77.4538;
              finalAccuracy = 100;
              finalAddress = "HRMS HQ Office, Sector 62, Noida, Uttar Pradesh, India";
            }
          }
        } else {
          if (!finalAddress && finalLat && finalLon) {
            finalAddress = getCachedAddress(finalLat, finalLon) || null;
          }
          // Update in-memory cache whenever valid coordinates arrive
          if (finalAddress) {
            lastKnownLocationMap.set(String(userId), { latitude: finalLat, longitude: finalLon, accuracy: finalAccuracy, address: finalAddress });
          }
        }

        const newFp = await Footprint.create({
          id: (record.uuid || record.id) ? (record.uuid || record.id) : undefined,
          userId: String(userId),
          latitude: finalLat,
          longitude: finalLon,
          timestamp: validTimestamp,
          date: targetDate,
          locationEnabled: record.locationEnabled !== undefined ? record.locationEnabled : true,
          isGpsOff: record.isGpsOff || record.isGpsOn === false || record.locationEnabled === false,
          trackingMethod: record.trackingMethod || record.provider || 'GPS',
          accuracy: finalAccuracy,
          address: finalAddress,
          cellId: record.cellId,
          lac: record.lac,
          tac: record.tac,
          mcc: record.mcc,
          mnc: record.mnc,
          signalStrength: record.signalStrength,
          batteryLevel: record.batteryLevel,
          batteryTemp: record.batteryTemp,
          networkType: record.networkType,
          reason: record.reason,
          isMockLocation: record.isMockLocation || false
        }, { transaction });

        if (!finalAddress && finalLat && finalLon) {
          pendingGeocodeTasks.push({
            id: newFp.id || recordUuid,
            userId: String(userId),
            lat: finalLat,
            lon: finalLon,
            accuracy: finalAccuracy
          });
        }

        uploadedIds.push(newFp.id || recordUuid);
        successfulPings.push({
          ...record,
          id: newFp.id || recordUuid,
          userId: String(userId),
          latitude: finalLat,
          longitude: finalLon,
          accuracy: finalAccuracy,
          timestamp: validTimestamp,
          date: targetDate,
          trackingMethod: record.trackingMethod || record.provider || 'GPS',
          isMockLocation: record.isMockLocation || false
        });
        recordsInserted++;
        console.log(`[FOOTPRINT PER-RECORD LOG] UUID: ${newFp.id || recordUuid} | UserId: ${userId} | Timestamp: ${validTimestamp} | Duplicate Check: PASSED | Insert: SUCCESS | Reason: Successfully inserted into location_footprints.`);
      } catch (recordError) {
        failedIds.push(recordUuid);
        recordsSkipped++;

        // CHANGE 6: DETAILED ERROR LOGGING
        console.error(`\n[FOOTPRINT ERROR LOG] ========================================`);
        console.error(`[FOOTPRINT ERROR LOG] UUID: ${recordUuid}`);
        console.error(`[FOOTPRINT ERROR LOG] Payload: ${JSON.stringify(record)}`);
        console.error(`[FOOTPRINT ERROR LOG] Is Duplicate: ${isDuplicate}`);
        console.error(`[FOOTPRINT ERROR LOG] Validation Error:`, recordError.errors ? recordError.errors.map(e => e.message) : 'None');
        console.error(`[FOOTPRINT ERROR LOG] SQL Error:`, recordError.original ? (recordError.original.sqlMessage || recordError.original.message) : 'None');
        console.error(`[FOOTPRINT ERROR LOG] Stacktrace:`, recordError.stack);
        console.error(`[FOOTPRINT ERROR LOG] ========================================\n`);
      }
    }

    await transaction.commit();
    console.log(`[FOOTPRINT BATCH TX] Transaction Committed Successfully.`);
    console.log(`[FOOTPRINT AUDIT] [POST /api/footprints/batch] -> 3. Database Insert Completed`);

    // ASYNC BACKGROUND GEOCODING: Resolve addresses asynchronously outside transaction with zero DB locks held
    if (pendingGeocodeTasks.length > 0) {
      setImmediate(async () => {
        for (const task of pendingGeocodeTasks) {
          try {
            const addr = await getAddressFromCoords(task.lat, task.lon);
            if (addr) {
              await Footprint.update({ address: addr }, { where: { id: task.id } }).catch(() => {});
              lastKnownLocationMap.set(task.userId, { latitude: task.lat, longitude: task.lon, accuracy: task.accuracy, address: addr });
            }
          } catch (_) {}
        }
      });
    }

    // CONSECUTIVE OUTSIDE GEOFENCE ALERT EVALUATION:
    // Evaluate valid GPS pings chronologically to monitor consecutive outside pings and trigger alerts
    if (successfulPings.length > 0) {
      try {
        const sortedPings = [...successfulPings].sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
        for (const pingItem of sortedPings) {
          const evalResult = await GeofenceAlertService.evaluatePing(pingItem).catch(err => {
            console.warn(`[Batch Geofence Alert Error for ${pingItem.userId}]:`, err.message);
            return null;
          });
          if (evalResult && evalResult.status === 'OUTSIDE') {
            console.log(`[Batch Geofence Evaluation] User ${evalResult.userId}: OUTSIDE (Consecutive: ${evalResult.consecutiveCount}, Distance: ${evalResult.distanceMeters}m, AlertSent: ${evalResult.alertSent}, AlertTriggered: ${evalResult.alertTriggered})`);
          }
        }
      } catch (evalErr) {
        console.warn('[Batch Geofence Evaluation Warning]:', evalErr.message);
      }
    }

    // Intercept batch footprints as tracking heartbeats for recovery logic
    try {
      const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
      const userTelemetryMap = new Map();
      for (const record of records) {
        const uId = record.userId || record.user_id;
        if (!uId) continue;
        const current = userTelemetryMap.get(uId) || {};
        userTelemetryMap.set(uId, {
          manufacturer: record.manufacturer || current.manufacturer,
          model: record.model || current.model,
          androidVersion: record.androidVersion || current.androidVersion,
          batteryLevel: record.batteryLevel !== undefined ? record.batteryLevel : (record.battery_level !== undefined ? record.battery_level : current.batteryLevel),
          networkType: record.networkType || record.network_type || current.networkType,
          gpsEnabled: record.gpsEnabled !== undefined ? record.gpsEnabled : (record.locationEnabled !== undefined ? record.locationEnabled : current.gpsEnabled),
          trackingReliabilityScore: record.trackingReliabilityScore || current.trackingReliabilityScore
        });
      }

      for (const [uId, tel] of userTelemetryMap.entries()) {
        HeartbeatMonitorService.registerHeartbeat(uId, tel).catch(err => {
          console.warn(`[Batch Heartbeat Intercept Error for ${uId}]:`, err.message);
        });
      }
    } catch (hbErr) {
      console.warn('[Heartbeat Service Batch Import Warning]:', hbErr.message);
    }
  } catch (batchError) {
    if (transaction) await transaction.rollback();
    console.error(`[FOOTPRINT BATCH TX ERROR] Transaction Rolled Back due to critical error:`, batchError);
  }

  const processingTimeMs = Date.now() - startTime;
  console.log(`[FOOTPRINT AUDIT] [POST /api/footprints/batch] -> 4. Processing Finished | 5. HTTP Response 200 | Duration: ${processingTimeMs}ms`);

  // STEP 10 & STEP 6: ACK RESPONSE & LOGGING
  const overallStatus = (failedIds.length === 0 && duplicateIds.length === 0) ? 'success' : (uploadedIds.length > 0 ? 'partial_success' : 'failed');

  console.log(`[FOOTPRINT BATCH LOG] === ACK Sent to Client ===`);
  console.log(`[FOOTPRINT BATCH LOG] Status: ${overallStatus} | Uploaded: ${uploadedIds.length} | Failed: ${failedIds.length} | Duplicates: ${duplicateIds.length} | Time: ${processingTimeMs}ms\n`);

  return res.status(200).json({
    status: overallStatus,
    uploadedIds,
    failedIds,
    duplicateIds,
    processingTimeMs,
    recordsReceived: records.length,
    recordsInserted,
    recordsSkipped
  });
});

router.post('/', async (req, res) => {
  const reqStart = Date.now();
  console.log(`\n[FOOTPRINT AUDIT] [POST /api/footprints] -> 1. Request Received | 2. Processing Started`);
  try {
    const { 
      userId, 
      latitude, 
      longitude, 
      timestamp, 
      date, 
      locationEnabled, 
      trackingMethod,
      accuracy,
      cellId,
      lac,
      tac,
      mcc,
      mnc,
      signalStrength,
      batteryLevel,
      batteryTemp,
      networkType,
      reason,
      isMockLocation
    } = req.body;

    // Filter out mobile internal diagnostic reject logs that should never be stored as active footprints
    if (reason && typeof reason === 'string' && reason.toUpperCase().startsWith('REJECTED')) {
      console.log(`[Footprint Router] Ignored diagnostic reject log '${reason}' for user ${userId}`);
      return res.status(200).json({ status: 'ignored_diagnostic', message: `Filtered out mobile internal log: ${reason}` });
    }

    // Dynamic canonical employee normalization
    const { empMap, empAliasesMap } = await getCachedEmployees();
    const resolvedEmp = await resolveCanonicalEmployee(userId, empMap);
    const activeUserId = resolvedEmp ? resolvedEmp.canonicalId : String(userId);
    const activeUserName = resolvedEmp ? resolvedEmp.canonicalName : req.body.userName;
    const userAliases = (empAliasesMap && empAliasesMap.get(String(userId).trim().toLowerCase())) || [String(userId)];

    // Check if employee is clocked out for the given date (or today)
    const todayIST = getAuthoritativeISTDate();
    let targetDate = date || todayIST;
    if (targetDate > todayIST) {
      targetDate = todayIST;
    }
    let altDate = targetDate;
    if (targetDate && targetDate.includes('-')) {
      const parts = targetDate.split('-');
      if (parts.length === 3) {
        altDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    let empObj = resolvedEmp ? resolvedEmp.employee : null;
    if (!empObj && userId) {
      const Employee = require('../../../../shared/models/Employee');
      try {
        empObj = await Employee.findOne({
          where: {
            [Op.or]: [
              { id: { [Op.in]: userAliases } },
              { empCode: { [Op.in]: userAliases } },
              { name: { [Op.in]: userAliases } }
            ]
          }
        });
      } catch (e) {}
    }

    const activeUserIds = empObj 
      ? Array.from(new Set([empObj.id, empObj.empCode, empObj.name, activeUserId, String(userId), ...userAliases].filter(Boolean)))
      : Array.from(new Set([activeUserId, String(userId), ...userAliases].filter(Boolean)));

    if (userId) {
      let todayAttendance = await Attendance.findOne({
        where: {
          [Op.or]: [
            { userId: { [Op.in]: activeUserIds } },
            { userName: { [Op.in]: activeUserIds } }
          ],
          date: { [Op.or]: [targetDate, altDate] }
        },
        order: [['createdAt', 'DESC']]
      });

      const isTrueCheckOut = todayAttendance && todayAttendance.checkOut && 
        todayAttendance.checkOut !== 'null' && 
        todayAttendance.checkOut !== 'undefined' && 
        String(todayAttendance.checkOut).trim() !== '' && 
        String(todayAttendance.checkOut).trim() !== '-';

      if (isTrueCheckOut) {
        console.log(`[Footprint Router] Ignored footprint ping for userId ${activeUserId} (raw: ${userId}) on ${targetDate}: Employee is CLOCKED OUT (checkOut: ${todayAttendance.checkOut})`);
        return res.status(200).json({
          status: 'ignored_clocked_out',
          message: 'Footprint ignored: Employee has clocked out for today.'
        });
      }

      // Auto-recover attendance session if the footprint explicitly represents a clock-in punch event,
      // OR if the employee has live GPS telemetry during active shift hours without any recorded shift today.
      let validTs = Number(timestamp);
      if (!validTs || isNaN(validTs) || validTs <= 100000000000) {
        validTs = Date.now();
      }
      if (validTs > Date.now() + 5 * 60 * 1000) {
        validTs = Date.now();
      }
      const isExplicitClockInAnchor = reason === 'CLOCK_IN_START_ANCHOR';
      const istHour = (() => {
        try {
          const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date(validTs));
          return parseInt(parts, 10);
        } catch {
          return new Date(validTs).getUTCHours() + 5;
        }
      })();
      const isWorkingShiftHours = (istHour >= 8 && istHour < 19);
      const isValidGpsPing = latitude != null && longitude != null && (accuracy == null || parseFloat(accuracy) <= 500);

      const isForToday = (targetDate === todayIST);
      const shouldAutoRecoverShift = isForToday && (!todayAttendance || !todayAttendance.checkIn) && (isExplicitClockInAnchor || (isValidGpsPing && isWorkingShiftHours));
      if (shouldAutoRecoverShift) {
        // RECOVERY OF DROPPED CLOCK-IN: Explicit clock-in anchor or live shift GPS ping
        // heals active attendance session when mobile punch dropped.
        try {
          const resolvedShift = ShiftEngine.resolveEmployeeShift(empObj);
          const autoCheckInTime = formatISTTime(validTs);
          const activeUid = activeUserId;
          const activeUName = activeUserName || (empObj ? empObj.name : String(userId));
          const parsedLat = latitude != null ? parseFloat(latitude) : null;
          const parsedLon = longitude != null ? parseFloat(longitude) : null;
          const coordsJson = (parsedLat != null && parsedLon != null) ? JSON.stringify({ lat: parsedLat, lon: parsedLon }) : null;

          if (todayAttendance) {
            todayAttendance.checkIn = todayAttendance.checkIn || autoCheckInTime;
            todayAttendance.checkInMethod = todayAttendance.checkInMethod || 'AUTO_RECOVERY_PUNCH';
            if (!todayAttendance.coords && coordsJson) todayAttendance.coords = coordsJson;
            await todayAttendance.save();
          } else {
            const isOfficeEmp = empObj && String(empObj.designation || '').trim().toUpperCase() === 'OFFICE';
            const resolvedWorkMode = isOfficeEmp ? 'office' : 'field';
            todayAttendance = await Attendance.create({
              userId: activeUid,
              userName: activeUName,
              date: targetDate,
              checkIn: autoCheckInTime,
              checkOut: null,
              workingHours: null,
              coords: coordsJson,
              workMode: resolvedWorkMode,
              isSwitched: false,
              checkInMethod: 'AUTO_RECOVERY_PUNCH',
              clockOutMethod: null,
              shiftCode: resolvedShift.code
            });
            GeofenceAlertService.resetTrackingState(activeUid, todayAttendance.id);
          }

          console.log(`[FOOTPRINT SELF-HEAL] Auto-created/recovered active Attendance record for ${activeUid} (${activeUName}) on ${targetDate} at ${autoCheckInTime}`);

          const io = req.app ? req.app.get('io') : null;
          if (io) {
            try {
              io.emit('ATTENDANCE_PUNCH', {
                action: 'CLOCK_IN',
                userId: activeUid,
                userName: activeUName,
                record: todayAttendance,
                timestamp: validTs
              });
              io.emit('ATTENDANCE_UPDATE', { date: targetDate });
            } catch (sockErr) {}
          }
        } catch (healErr) {
          console.warn('[FOOTPRINT SELF-HEAL ERROR]:', healErr.message);
        }
      }
    }

    let finalLat = latitude;
    let finalLon = longitude;
    let finalAccuracy = accuracy;
    let finalAddress = null;

    // 1. If tracking method is CELLULAR and cellId is present, try to resolve cellular tower coordinates
    if (trackingMethod === 'CELLULAR' && cellId) {
      const resolvedCell = await resolveCellToCoords(mcc, mnc, lac || tac, cellId);
      if (resolvedCell) {
        finalLat = resolvedCell.latitude;
        finalLon = resolvedCell.longitude;
        finalAccuracy = resolvedCell.accuracy;
        console.log(`[Footprint Router] Cellular resolved Cell ID ${cellId} to (${finalLat}, ${finalLon})`);
      } else {
        console.log(`[Footprint Router] Cellular resolver returned null for Cell ID ${cellId}, falling back to client coordinates`);
      }
    }

    // 2. If coordinates are still missing, fallback to last known coords or default office
    if (!finalLat || !finalLon) {
      // Find latest footprint with coordinates for this user
      const lastCoordPoint = await Footprint.findOne({
        where: {
          userId: { [Op.in]: activeUserIds },
          latitude: { [Op.ne]: null },
          longitude: { [Op.ne]: null }
        },
        order: [['timestamp', 'DESC']]
      });

      if (lastCoordPoint) {
        finalLat = lastCoordPoint.latitude;
        finalLon = lastCoordPoint.longitude;
        finalAccuracy = lastCoordPoint.accuracy || 50;
        finalAddress = lastCoordPoint.address;
        console.log(`[Footprint Geocode Backend Fallback] Reused last known coords (${finalLat}, ${finalLon}) and address for user ${activeUserId}`);
      } else {
        // Fallback to Noida Office
        finalLat = 28.6692;
        finalLon = 77.4538;
        finalAccuracy = 100;
        finalAddress = "HRMS HQ Office, Sector 62, Noida, Uttar Pradesh, India";
        console.log(`[Footprint Geocode Backend Fallback] No last coordinates. Defaulted to office coordinates for user ${activeUserId}`);
      }
    }
    
    let validTimestamp = Number(timestamp);
    if (!validTimestamp || isNaN(validTimestamp) || validTimestamp <= 100000000000) {
      validTimestamp = Date.now();
    }

    // 1. Guard against duplicate pings (same userId and exact timestamp from network retries)
    if (activeUserId && validTimestamp) {
      const existingFp = await Footprint.findOne({
        where: {
          userId: { [Op.in]: activeUserIds },
          timestamp: validTimestamp
        }
      });
      if (existingFp) {
        console.log(`[Footprint Router] Duplicate footprint ignored for user ${activeUserId} at timestamp ${validTimestamp}`);
        return res.status(200).json(existingFp);
      }
    }

    // NOTE: Rapid satellite refinement debounce REMOVED — ping interval is controlled from app settings,
    // so the backend should save all GPS pings arriving from devices without suppression.
    // Only exact-timestamp duplicate check (above) is retained to prevent network retries.

    // Register heartbeat signal for every incoming ping so stationary workers keep their tracking active
    try {
      const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
      HeartbeatMonitorService.registerHeartbeat(activeUserId, {
        manufacturer: req.body.manufacturer,
        model: req.body.model,
        androidVersion: req.body.androidVersion,
        batteryLevel: req.body.batteryLevel,
        networkType: req.body.networkType,
        gpsEnabled: req.body.gpsEnabled,
        trackingReliabilityScore: req.body.trackingReliabilityScore
      }).catch(err => console.warn('[Footprint Heartbeat Error]:', err.message));
    } catch (e) {
      console.warn('[Heartbeat Service Import Warning]:', e.message);
    }

    const newPoint = await Footprint.create({ 
      userId: activeUserId, 
      latitude: finalLat, 
      longitude: finalLon, 
      timestamp: validTimestamp, 
      date: targetDate, 
      locationEnabled, 
      trackingMethod,
      accuracy: finalAccuracy,
      address: finalAddress,
      cellId,
      lac,
      tac,
      mcc,
      mnc,
      signalStrength,
      batteryLevel,
      batteryTemp,
      networkType,
      reason,
      isMockLocation
    });

    // Intercept footprint creation as a tracking heartbeat for recovery logic (Phase 16)
    try {
      const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
      HeartbeatMonitorService.registerHeartbeat(activeUserId, {
        manufacturer: req.body.manufacturer,
        model: req.body.model,
        androidVersion: req.body.androidVersion,
        batteryLevel: req.body.batteryLevel,
        networkType: req.body.networkType,
        gpsEnabled: req.body.gpsEnabled,
        trackingReliabilityScore: req.body.trackingReliabilityScore
      }).catch(err => console.warn('[Footprint Heartbeat Intercept Error]:', err.message));
    } catch (e) {
      console.warn('[Heartbeat Service Import Warning]:', e.message);
    }

    if (finalLat && finalLon && !finalAddress) {
      getAddressFromCoords(finalLat, finalLon).then(async (addr) => {
        if (addr) {
          newPoint.address = addr;
          await newPoint.save();
          console.log(`[Footprint Geocode] Geocoded record ${newPoint.id} to: ${addr}`);
        }
      }).catch(err => {
        console.warn("[Footprint Geocode Error] Failed to resolve address:", err.message);
      });
    }

    // CONSECUTIVE OUTSIDE GEOFENCE ALERT EVALUATION:
    try {
      GeofenceAlertService.evaluatePing(newPoint).catch(err => {
        console.warn(`[Single Geofence Alert Error for ${activeUserId}]:`, err.message);
      });
    } catch (evalErr) {
      console.warn('[Single Geofence Evaluation Warning]:', evalErr.message);
    }

    return res.status(201).json(newPoint);
  } catch (error) {
    console.error('Error creating footprint:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    await Footprint.destroy({ where: {}, truncate: true });
    return res.status(200).json({ message: 'Footprint history cleared.' });
  } catch (error) {
    console.error('Error clearing footprints:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
