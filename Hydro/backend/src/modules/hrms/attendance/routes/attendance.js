const express = require('express');
const router = express.Router();
const Attendance = require('../../../../shared/models/Attendance');
const Employee = require('../../../../shared/models/Employee');
const Footprint = require('../../../../shared/models/Footprint');
const ShiftEngine = require('../../../../shared/services/ShiftEngine');
const sequelize = require('../../../../config/database');
const { Op } = require('sequelize');
const { getAddressFromCoords } = require('../../../../core/utils/geocoder');
const { getCachedEmployees, resolveCanonicalEmployee } = require('../../../../core/utils/employeeCache');
const GeofenceAlertService = require('../../../../shared/services/GeofenceAlertService');
const SpecialEarnedCreditService = require('../../leave/services/SpecialEarnedCreditService');

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

const cleanTimestamp = (val) => {
  if (!val) return null;
  const s = String(val).trim();
  if (s === '' || s === 'null' || s === 'undefined' || s === '-' || s.toLowerCase() === 'null') {
    return null;
  }
  return s;
};

// Helper to find employee by id, emp_code, or name dynamically
async function findEmployee(identifier, name) {
  if (!identifier && !name) return null;
  const { empMap } = await getCachedEmployees();
  
  if (identifier) {
    const res = await resolveCanonicalEmployee(identifier, empMap);
    if (res && res.employee) return res.employee;
  }
  if (name) {
    const res = await resolveCanonicalEmployee(name, empMap);
    if (res && res.employee) return res.employee;
  }

  // Database fallback if employee was just created and not in cache
  const rawSearchTerms = [identifier, name].filter(Boolean).map(s => String(s).trim().toLowerCase());
  for (const term of rawSearchTerms) {
    if (!term) continue;
    const emp = await Employee.findOne({
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('id')), term),
          sequelize.where(sequelize.fn('lower', sequelize.col('emp_code')), term),
          sequelize.where(sequelize.fn('lower', sequelize.col('name')), term)
        ]
      }
    });
    if (emp) return emp;
  }
  return null;
}

// Helper to enrich a batch of attendance records with employee details and session battery telemetry
async function enrichRecordsBatch(records, empMap, empAliasesMap) {
  if (!records || records.length === 0) return [];

  const plainRecords = records.map(r => (r && r.toJSON ? r.toJSON() : { ...r }));
  const dates = new Set();
  const queryUserIds = new Set();
  const needsBattery = plainRecords.some(r => r.batteryLevel == null);

  if (needsBattery) {
    plainRecords.forEach(r => {
      if (!r || r.batteryLevel != null) return;
      if (r.date) {
        const d = String(r.date).trim();
        dates.add(d);
        if (d.includes('-')) {
          const parts = d.split('-');
          if (parts.length === 3) dates.add(`${parts[2]}-${parts[1]}-${parts[0]}`);
        }
      }
      if (r.createdAt) {
        try {
          const cd = new Date(r.createdAt);
          if (!isNaN(cd.getTime())) {
            dates.add(cd.toISOString().split('T')[0]);
          }
        } catch (e) {}
      }
      const u1 = r.userId ? String(r.userId).trim() : null;
      const u2 = r.userName ? String(r.userName).trim() : null;
      if (u1) {
        queryUserIds.add(u1);
        queryUserIds.add(u1.toLowerCase());
        queryUserIds.add(u1.toUpperCase());
        if (empAliasesMap && empAliasesMap.has(u1.toLowerCase())) {
          empAliasesMap.get(u1.toLowerCase()).forEach(a => queryUserIds.add(a));
        }
      }
      if (u2) {
        queryUserIds.add(u2);
        queryUserIds.add(u2.toLowerCase());
        queryUserIds.add(u2.toUpperCase());
        if (empAliasesMap && empAliasesMap.has(u2.toLowerCase())) {
          empAliasesMap.get(u2.toLowerCase()).forEach(a => queryUserIds.add(a));
        }
      }
    });
  }

  const fpMap = new Map();
  if (needsBattery && queryUserIds.size > 0) {
    try {
      const todayStartMs = Date.now() - (48 * 60 * 60 * 1000);
      const fps = await sequelize.query(`
        SELECT user_id as userId, date, battery_level as batteryLevel, battery_temp as batteryTemp, timestamp
        FROM location_footprints
        WHERE timestamp >= ${todayStartMs}
          AND battery_level IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 200
      `, { type: sequelize.QueryTypes.SELECT }).catch(() => []);

      fps.forEach(f => {
        const u = String(f.userId || '').trim().toLowerCase();
        const d = String(f.date || '').trim();
        const key = `${u}_${d}`;
        if (!fpMap.has(key)) {
          fpMap.set(key, f);
        }
        if (!fpMap.has(u)) {
          fpMap.set(u, f);
        }
      });
    } catch (fpErr) {
      console.warn('Warning fetching footprints for attendance enrichment:', fpErr.message);
    }
  }

  return plainRecords.map(rec => {
    try {
      const plain = { ...rec };
      const uKey1 = String(plain.userId || '').trim().toLowerCase();
      const uKey2 = String(plain.userName || '').trim().toLowerCase();
      const uKey3 = String(plain.empCode || '').trim().toLowerCase();
      
      const emp = empMap ? (
        empMap.get(uKey1) || 
        empMap.get(uKey2) || 
        empMap.get(uKey3)
      ) : null;

      if (emp) {
        plain.userId = emp.empCode || emp.emp_code || emp.id;
        plain.empCode = emp.empCode || emp.emp_code || emp.id;
        plain.userName = emp.name || plain.userName;
        plain.employeeName = emp.name || plain.userName;
        plain.employeeId = emp.id;
        plain.jobTitle = emp.jobTitle || emp.designation || 'Team Member';
        plain.designation = emp.designation || emp.jobTitle || 'Team Member';
        plain.department = emp.department || 'Company';
        plain.email = emp.email || '';
        plain.phone = emp.phone || emp.mobile || '';
        plain.profilePhotoUrl = emp.profilePhotoUrl || emp.avatar || null;
        const isOfficeEmp = String(emp.designation || '').trim().toUpperCase() === 'OFFICE';
        const effectiveWorkMode = plain.isSwitched 
          ? (plain.workMode || 'field') 
          : (isOfficeEmp ? 'office' : (plain.workMode || 'field'));
        plain.workMode = effectiveWorkMode;

        plain.employee = {
          id: emp.id,
          empCode: emp.empCode || emp.emp_code || emp.id,
          name: emp.name,
          jobTitle: emp.jobTitle || emp.designation || 'Team Member',
          designation: emp.designation || emp.jobTitle || 'Team Member',
          department: emp.department || 'Company',
          email: emp.email || '',
          phone: emp.phone || emp.mobile || '',
          profilePhotoUrl: emp.profilePhotoUrl || emp.avatar || null,
          workMode: effectiveWorkMode
        };
      } else {
        plain.empCode = plain.empCode || plain.userId;
        plain.employeeName = plain.userName || plain.userId;
        plain.jobTitle = plain.jobTitle || plain.designation || 'Team Member';
        plain.designation = plain.designation || plain.jobTitle || 'Team Member';
        plain.department = plain.department || 'Company';
      }
      plain.checkIn = cleanTimestamp(plain.checkIn);
      plain.checkOut = cleanTimestamp(plain.checkOut);

      // Resolve Shift details
      const shift = ShiftEngine.resolveEmployeeShift(emp);
      plain.shiftCode = plain.shiftCode || shift.code;
      plain.shiftLabel = shift.label;

      // Inverted / Zero-Duration Punch Sanitization:
      if (plain.checkIn && plain.checkOut) {
        const inMins = ShiftEngine.parseTimeToMinutes(plain.checkIn);
        const outMins = ShiftEngine.parseTimeToMinutes(plain.checkOut);
        if (inMins != null && outMins != null && outMins <= inMins) {
          if (inMins === outMins) {
            // Identical punch (e.g. 0-second session or immediate clock-out)
            plain.workingHours = '00:00:00';
          } else {
            // Strictly inverted punch (checkOut earlier than checkIn)
            plain.clockOutMethod = plain.clockOutMethod || 'INVALID_INVERTED_PUNCH';
            plain.workingHours = '00:00:00';
          }
        }
      }

      // Resolve Punch Method & Source
      if (plain.checkIn && !plain.checkInMethod) {
        plain.checkInMethod = plain.coords ? 'MANUAL_APP' : 'MANUAL_WEB';
      }

      if (plain.checkOut && !plain.clockOutMethod) {
        if (plain.checkOut === '19:00:00' || plain.checkOut === '19:00') {
          plain.clockOutMethod = 'AUTO_STALE_CLEANUP';
        } else if (plain.checkOut === shift.end) {
          plain.clockOutMethod = 'AUTO_SHIFT_END';
        } else {
          plain.clockOutMethod = plain.coords ? 'MANUAL_APP' : 'MANUAL_WEB';
        }
      }

      // Dynamic Working Hours Calculation if missing
      if (!plain.workingHours && plain.checkIn && plain.checkOut) {
        plain.workingHours = ShiftEngine.calculateWorkingHours(plain.checkIn, plain.checkOut);
      }

      if (plain.batteryLevel == null) {
        const uLower = String(plain.userId || '').toLowerCase();
        const unLower = String(plain.userName || '').toLowerCase();
        const aliases = new Set([uLower, unLower]);
        if (empAliasesMap && empAliasesMap.has(uLower)) empAliasesMap.get(uLower).forEach(a => aliases.add(String(a).toLowerCase()));
        if (empAliasesMap && empAliasesMap.has(unLower)) empAliasesMap.get(unLower).forEach(a => aliases.add(String(a).toLowerCase()));

        let safeCreatedDate = null;
        if (plain.createdAt) {
          try {
            const cd = new Date(plain.createdAt);
            if (!isNaN(cd.getTime())) {
              safeCreatedDate = cd.toISOString().split('T')[0];
            }
          } catch (e) {}
        }

        const candidateDates = [
          plain.date ? String(plain.date).trim() : null,
          safeCreatedDate
        ].filter(Boolean);

        for (const d of candidateDates) {
          for (const a of aliases) {
            const key = `${a}_${d}`;
            if (fpMap.has(key)) {
              const matched = fpMap.get(key);
              plain.batteryLevel = matched.batteryLevel;
              plain.batteryTemp = matched.batteryTemp;
              plain.lastBatteryTime = matched.timestamp;
              break;
            }
          }
          if (plain.batteryLevel != null) break;
        }
      }

      return plain;
    } catch (recErr) {
      console.warn('Error processing individual attendance record in batch:', recErr.message);
      return rec;
    }
  });
}

router.get('/', async (req, res) => {
  try {
    const { userId, date, month, page, limit, chunked } = req.query;
    const whereClause = {};

    // Month filter (YYYY-MM) — used by payroll compliance forms for full-month attendance
    if (month && !date) {
      whereClause.date = { [Op.like]: `${month}%` };
      SpecialEarnedCreditService.syncCreditsForMonth(month).catch(err => console.warn('[SpecialEarnedCreditSync] Warning:', err.message));
    } else if (date) {
      const istTargetDate = getAuthoritativeISTDate(date);
      const dateVariants = new Set([date, istTargetDate]);
      [date, istTargetDate].forEach(d => {
        if (d && d.includes('-')) {
          const parts = d.split('-');
          if (parts.length === 3) {
            dateVariants.add(`${parts[2]}-${parts[1]}-${parts[0]}`); // DD-MM-YYYY
            dateVariants.add(`${parseInt(parts[0], 10)}-${parseInt(parts[1], 10)}-${parseInt(parts[2], 10)}`);
            dateVariants.add(`${parseInt(parts[2], 10)}-${parseInt(parts[1], 10)}-${parseInt(parts[0], 10)}`);
          }
        }
      });

      whereClause.date = { [Op.in]: Array.from(dateVariants) };
    }

    // Fetch employee mapping for enrichment from high-speed in-memory cache
    const { employees, empMap, empAliasesMap } = await getCachedEmployees();

    if (userId) {
      const rawUserStr = String(userId).trim();
      const emp = empMap.get(rawUserStr.toLowerCase());
      const rawIds = [rawUserStr];
      if (emp) {
        if (emp.id) rawIds.push(emp.id);
        if (emp.empCode) rawIds.push(emp.empCode);
        if (emp.emp_code) rawIds.push(emp.emp_code);
        if (emp.name) rawIds.push(emp.name);
      }
      const possibleIds = new Set();
      rawIds.forEach(id => {
        if (id) {
          possibleIds.add(String(id));
          possibleIds.add(String(id).toUpperCase());
          possibleIds.add(String(id).toLowerCase());
        }
      });
      const idArray = Array.from(possibleIds);
      const userCondition = [
        { userId: { [Op.in]: idArray } },
        { userName: { [Op.in]: idArray } }
      ];
      if (whereClause[Op.or]) {
        whereClause[Op.and] = [
          { [Op.or]: whereClause[Op.or] },
          { [Op.or]: userCondition }
        ];
        delete whereClause[Op.or];
      } else {
        whereClause[Op.or] = userCondition;
      }
    }

    if (chunked === 'true' || (page && !date)) {
      const p = Math.max(1, parseInt(page || 1, 10));
      const l = Math.min(500, Math.max(1, parseInt(limit || 20, 10)));
      const offset = (p - 1) * l;

      const { count, rows } = await Attendance.findAndCountAll({
        where: whereClause,
        limit: l,
        offset,
        order: [['createdAt', 'DESC']]
      });

      const enrichedRows = await enrichRecordsBatch(rows, empMap, empAliasesMap);

      return res.status(200).json({
        data: enrichedRows,
        page: p,
        limit: l,
        totalRecords: count,
        totalPages: Math.ceil(count / l),
        hasMore: p * l < count
      });
    }

    const history = await Attendance.findAll({ 
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: limit ? parseInt(limit, 10) : undefined
    });
    const enrichedHistory = await enrichRecordsBatch(history, empMap, empAliasesMap);
    return res.status(200).json(enrichedHistory);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { userId, userName, date, checkIn, checkOut, workingHours, coords, workMode } = req.body;
    const rawUserId = userId || (req.user && req.user.id);
    const { empAliasesMap } = await getCachedEmployees();
    const resolvedCanonical = await resolveCanonicalEmployee(rawUserId);
    const emp = resolvedCanonical ? resolvedCanonical.employee : await findEmployee(rawUserId, userName);
    const activeUserId = resolvedCanonical ? resolvedCanonical.canonicalId : (emp ? (emp.empCode || emp.emp_code || emp.id) : rawUserId);
    const activeUserName = resolvedCanonical ? resolvedCanonical.canonicalName : (emp ? emp.name : (userName || 'Employee'));
    const cachedAliases = (empAliasesMap && rawUserId) ? (empAliasesMap.get(String(rawUserId).trim().toLowerCase()) || []) : [];
    const possibleUserIds = emp 
      ? Array.from(new Set([emp.id, emp.empCode, emp.emp_code, rawUserId, activeUserId, ...cachedAliases].filter(Boolean))) 
      : Array.from(new Set([rawUserId, ...cachedAliases].filter(Boolean)));

    const cleanCheckIn = cleanTimestamp(checkIn);
    const cleanCheckOut = cleanTimestamp(checkOut);
    
    // Parse coordinates safely
    let parsedCoords = null;
    if (coords) {
      try {
        parsedCoords = typeof coords === 'string' ? JSON.parse(coords) : coords;
      } catch (e) {
        parsedCoords = coords;
      }
    }
    const latVal = parsedCoords ? (parsedCoords.lat != null ? parsedCoords.lat : parsedCoords.latitude) : null;
    const lonVal = parsedCoords ? (parsedCoords.lon != null ? parsedCoords.lon : (parsedCoords.lng != null ? parsedCoords.lng : parsedCoords.longitude)) : null;

    const authoritativeToday = getAuthoritativeISTDate();
    const requestedDate = date ? (date.length === 10 ? date : getAuthoritativeISTDate(date)) : authoritativeToday;
    const todayDate = requestedDate > authoritativeToday ? authoritativeToday : requestedDate;

    // Safeguard 0: Auto-close any dangling unclosed sessions from previous dates for this employee dynamically
    try {
      const stalePastRecords = await Attendance.findAll({
        where: {
          userId: { [Op.in]: possibleUserIds },
          date: { [Op.lt]: todayDate },
          [Op.or]: [
            { checkOut: null },
            { checkOut: '' },
            { checkOut: 'null' },
            { checkOut: 'undefined' }
          ]
        }
      });

      if (stalePastRecords.length > 0) {
        const empShift = ShiftEngine.resolveEmployeeShift(emp);
        for (const staleRec of stalePastRecords) {
          const autoRes = await ShiftEngine.resolveAutoCheckOutTime(possibleUserIds, staleRec.date, empShift, Footprint);
          staleRec.checkOut = autoRes.checkOutTime;
          staleRec.clockOutMethod = autoRes.method || 'AUTO_STALE_CLEANUP';
          staleRec.shiftCode = empShift.code;
          staleRec.workingHours = ShiftEngine.calculateWorkingHours(staleRec.checkIn, autoRes.checkOutTime);
          await staleRec.save().catch(e => console.warn('[Auto-Close Past Session Save Warning]:', e.message));
        }
      }
    } catch (staleErr) {
      console.warn('[Auto-Close Past Sessions Warning]:', staleErr.message);
    }

    // Check if this is a clock-out update (since valid cleanCheckOut is provided)
    if (cleanCheckOut) {
      let activeRecord = await Attendance.findOne({
        where: {
          userId: { [Op.in]: possibleUserIds },
          [Op.or]: [
            { date: todayDate },
            { date: getAuthoritativeISTDate() },
            sequelize.where(sequelize.fn('date', sequelize.col('createdAt')), todayDate)
          ],
          [Op.or]: [
            { checkOut: null },
            { checkOut: '' },
            { checkOut: 'null' },
            { checkOut: 'undefined' }
          ]
        },
        order: [['createdAt', 'DESC']]
      });

      // Fallback: If no unclosed session found, check today's most recent session to update clock-out
      if (!activeRecord) {
        activeRecord = await Attendance.findOne({
          where: {
            userId: { [Op.in]: possibleUserIds },
            [Op.or]: [
              { date: todayDate },
              { date: getAuthoritativeISTDate() },
              sequelize.where(sequelize.fn('date', sequelize.col('createdAt')), todayDate)
            ]
          },
          order: [['updatedAt', 'DESC']]
        });
      }

      if (activeRecord) {
        const empShift = ShiftEngine.resolveEmployeeShift(emp);
        activeRecord.userId = activeUserId;
        activeRecord.userName = activeUserName;
        activeRecord.checkOut = cleanCheckOut;
        activeRecord.clockOutMethod = req.body.clockOutMethod || (latVal != null && lonVal != null ? 'MANUAL_APP' : 'MANUAL_WEB');
        activeRecord.shiftCode = activeRecord.shiftCode || empShift.code;
        activeRecord.workingHours = workingHours || ShiftEngine.calculateWorkingHours(activeRecord.checkIn, cleanCheckOut);
        if (coords) activeRecord.coords = typeof coords === 'string' ? coords : JSON.stringify(coords);
        await activeRecord.save();
        GeofenceAlertService.resetTrackingState(activeUserId, null);

        // Create Clock-Out GPS End Anchor Footprint
        if (latVal != null && lonVal != null) {
          try {
            const clockOutTs = new Date(cleanCheckOut).getTime();
            await Footprint.create({
              userId: String(activeUserId),
              latitude: parseFloat(latVal),
              longitude: parseFloat(lonVal),
              timestamp: !isNaN(clockOutTs) ? clockOutTs : Date.now(),
              date: todayDate,
              trackingMethod: 'GPS',
              accuracy: 10,
              reason: 'CLOCK_OUT_END_ANCHOR',
              locationEnabled: true,
              isMockLocation: false
            });
            console.log(`[Clock-Out GPS Anchor] Created strict Clock-Out GPS footprint anchor for user ${activeUserId}`);
          } catch (fpErr) {
            console.warn("[Clock-Out GPS Anchor Error]:", fpErr.message);
          }

          getAddressFromCoords(parseFloat(latVal), parseFloat(lonVal)).then(async (addr) => {
            if (addr) {
              activeRecord.address = addr;
              await activeRecord.save();
            }
          }).catch(err => console.warn(err.message));
        }

        console.log(`[Attendance Clock-Out] Successfully updated session ${activeRecord.id} for user ${activeUserId} to clocked-out at ${cleanCheckOut} (${activeRecord.clockOutMethod}).`);
        if (emp) {
          SpecialEarnedCreditService.evaluateAndCredit(activeRecord, emp).catch(err => console.warn('[SpecialEarnedCredit ClockOut] Warning:', err.message));
        }

        const io = req.app ? req.app.get('io') : null;
        if (io) {
          try {
            io.emit('ATTENDANCE_PUNCH', {
              action: 'CLOCK_OUT',
              userId: activeUserId,
              userName: activeUserName,
              record: activeRecord,
              timestamp: Date.now()
            });
            io.emit('ATTENDANCE_UPDATE', { date: todayDate });
          } catch (sockErr) {
            console.warn('[Socket Broadcast Warning]:', sockErr.message);
          }
        }

        return res.status(200).json(activeRecord);
      } else {
        // Clock-out requested, but no attendance record exists for today
        return res.status(400).json({
          error: 'No active clock-in session found for today. Please clock in first.'
        });
      }
    }

    // Prepare Clock-In parameters & Authoritative Server Timestamp
    const resolvedShift = ShiftEngine.resolveEmployeeShift(emp);
    const inMethod = req.body.checkInMethod || (latVal != null && lonVal != null ? 'MANUAL_APP' : 'MANUAL_WEB');

    // Authoritative check-in timestamp: prevent replaying yesterday's stale cached check-in
    const serverISTTime = formatISTTime();
    let authoritativeCheckIn = serverISTTime;
    if (cleanCheckIn) {
      const clientMins = ShiftEngine.parseTimeToMinutes(cleanCheckIn);
      const serverMins = ShiftEngine.parseTimeToMinutes(serverISTTime);
      // If client timestamp is within 30 minutes of server IST time, allow client timestamp; otherwise enforce server time
      if (clientMins != null && serverMins != null && Math.abs(clientMins - serverMins) <= 30) {
        authoritativeCheckIn = cleanCheckIn;
      }
    }

    // Single Active Session Guarantee: An employee can NEVER have multiple concurrent open shifts for the same day
    const existingActive = await Attendance.findOne({
      where: {
        userId: { [Op.in]: possibleUserIds },
        [Op.or]: [
          { date: todayDate },
          { date: getAuthoritativeISTDate() },
          sequelize.where(sequelize.fn('date', sequelize.col('createdAt')), todayDate)
        ],
        [Op.or]: [
          { checkOut: null },
          { checkOut: '' },
          { checkOut: 'null' },
          { checkOut: 'undefined' }
        ]
      },
      order: [['createdAt', 'DESC']]
    });

    if (existingActive) {
      // If the open session was an AUTO_RECOVERY_PUNCH and the user is now explicitly punching in from the app, upgrade it
      if (existingActive.checkInMethod === 'AUTO_RECOVERY_PUNCH') {
        console.log(`[Attendance Clock-In Upgrade] Upgraded auto-recovery session ${existingActive.id} to manual clock-in for user ${activeUserId}.`);
        existingActive.checkIn = authoritativeCheckIn;
        existingActive.checkInMethod = inMethod;
        if (coords) existingActive.coords = typeof coords === 'string' ? coords : JSON.stringify(coords);
        if (!existingActive.isSwitched) {
          const isOffice = emp && String(emp.designation || '').trim().toUpperCase() === 'OFFICE';
          existingActive.workMode = isOffice ? 'office' : 'field';
        }
        await existingActive.save();
        if (emp) {
          SpecialEarnedCreditService.evaluateAndCredit(existingActive, emp).catch(err => console.warn('[SpecialEarnedCredit Upgrade] Warning:', err.message));
        }
        return res.status(200).json(existingActive);
      }

      console.log(`[Attendance Clock-In Exists] Employee ${activeUserId} already has an active open session ${existingActive.id} for today.`);
      return res.status(200).json(existingActive);
    }

    // Auto-Merge Reconnection Safeguard:
    // If a session was closed very recently (< 5 minutes ago) due to an offline sync or reconnection,
    // merge this clock-in back into that session to preserve one continuous active shift.
    const recentClosed = await Attendance.findOne({
      where: {
        userId: { [Op.in]: possibleUserIds },
        [Op.or]: [
          { date: todayDate },
          { date: getAuthoritativeISTDate() },
          sequelize.where(sequelize.fn('date', sequelize.col('createdAt')), todayDate)
        ],
        checkOut: { [Op.ne]: null }
      },
      order: [['updatedAt', 'DESC']]
    });

    if (recentClosed && recentClosed.checkOut) {
      const timeSinceClosed = Date.now() - new Date(recentClosed.updatedAt || recentClosed.createdAt).getTime();
      if (timeSinceClosed < 300000) {
        console.log(`[Attendance Session Merge] Merged clock-in into existing session ${recentClosed.id} (closed ${Math.round(timeSinceClosed / 1000)}s ago) to maintain continuous shift.`);
        recentClosed.checkOut = null;
        recentClosed.workingHours = null;
        if (coords) recentClosed.coords = typeof coords === 'string' ? coords : JSON.stringify(coords);
        await recentClosed.save();

        const io = req.app ? req.app.get('io') : null;
        if (io) {
          try {
            io.emit('ATTENDANCE_PUNCH', {
              action: 'CLOCK_IN',
              userId: activeUserId,
              userName: activeUserName,
              record: recentClosed,
              timestamp: Date.now()
            });
            io.emit('ATTENDANCE_UPDATE', { date: todayDate });
          } catch (sockErr) {}
        }
        return res.status(200).json(recentClosed);
      }
    }

    // Resolve authoritative default work mode from employee master profile
    const isOffice = emp && String(emp.designation || '').trim().toUpperCase() === 'OFFICE';
    const initialWorkMode = isOffice ? 'office' : 'field';

    // Create record (Clock In)
    const newRecord = await Attendance.create({ 
      userId: activeUserId, 
      userName: activeUserName, 
      date: todayDate, 
      checkIn: authoritativeCheckIn, 
      checkOut: null, 
      workingHours: null, 
      coords: coords ? (typeof coords === 'string' ? coords : JSON.stringify(coords)) : null,
      workMode: initialWorkMode,
      isSwitched: false,
      checkInMethod: inMethod,
      clockOutMethod: null,
      shiftCode: resolvedShift.code
    });

    GeofenceAlertService.resetTrackingState(activeUserId, newRecord.id);

    if (latVal != null && lonVal != null) {
      // Create strict Pin #1 Clock-In GPS Start Anchor Footprint
      try {
        const Footprint = require('../../../../shared/models/Footprint');
        const clockInTs = cleanCheckIn ? new Date(cleanCheckIn).getTime() : Date.now();
        const targetDate = date || getAuthoritativeISTDate(clockInTs);
        
        await Footprint.create({
          userId: String(activeUserId),
          latitude: parseFloat(latVal),
          longitude: parseFloat(lonVal),
          timestamp: !isNaN(clockInTs) ? clockInTs : Date.now(),
          date: targetDate,
          trackingMethod: 'GPS', // Strictly Hardware GPS for Pin #1
          accuracy: 10,
          reason: 'CLOCK_IN_START_ANCHOR',
          locationEnabled: true,
          isMockLocation: false
        });
        console.log(`[Clock-In GPS Anchor] Created strict Pin #1 GPS footprint anchor for user ${activeUserId}`);
      } catch (fpErr) {
        console.warn("[Clock-In GPS Anchor Error]:", fpErr.message);
      }

      getAddressFromCoords(parseFloat(latVal), parseFloat(lonVal)).then(async (addr) => {
        if (addr) {
          newRecord.address = addr;
          await newRecord.save();
          console.log(`[Attendance Geocode] Geocoded record ${newRecord.id} to: ${addr}`);
        }
      }).catch(err => {
        console.warn("[Attendance Geocode Error] Failed to resolve address:", err.message);
      });
    }

    const io = req.app ? req.app.get('io') : null;
    if (io) {
      try {
        io.emit('ATTENDANCE_PUNCH', {
          action: 'CLOCK_IN',
          userId: activeUserId,
          userName: activeUserName,
          record: newRecord,
          timestamp: Date.now()
        });
        io.emit('ATTENDANCE_UPDATE', { date: todayDate });
      } catch (sockErr) {
        console.warn('[Socket Broadcast Warning]:', sockErr.message);
      }
    }

    if (emp) {
      SpecialEarnedCreditService.evaluateAndCredit(newRecord, emp).catch(err => console.warn('[SpecialEarnedCredit NewRecord] Warning:', err.message));
    }
    return res.status(201).json(newRecord);
  } catch (error) {
    console.error('Error creating/updating attendance:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /switch-mode : Switch active work mode mid-shift (Office <-> Field for Office staff only)
router.post('/switch-mode', async (req, res) => {
  try {
    const rawUserId = req.body.userId || (req.user && req.user.id);
    if (!rawUserId) {
      return res.status(400).json({ error: 'User context or userId parameter required.' });
    }

    const emp = await findEmployee(rawUserId);
    const activeUserId = emp ? (emp.empCode || emp.emp_code || emp.id) : rawUserId;
    const isOffice = emp && String(emp.designation || '').trim().toUpperCase() === 'OFFICE';

    // Restriction: Field staff cannot switch to office mode
    if (!isOffice) {
      return res.status(403).json({ error: 'Field staff are not permitted to switch to Office mode.' });
    }

    const possibleUserIds = emp ? [emp.id, emp.empCode, emp.emp_code, rawUserId].filter(Boolean) : [rawUserId].filter(Boolean);
    const activeSession = await Attendance.findOne({
      where: {
        userId: { [Op.in]: possibleUserIds },
        [Op.or]: [
          { checkOut: null },
          { checkOut: '' },
          { checkOut: '-' },
          { checkOut: 'null' },
          { checkOut: 'undefined' }
        ]
      },
      order: [['createdAt', 'DESC']]
    });

    if (!activeSession) {
      return res.status(404).json({ error: 'No active clock-in session found to switch.' });
    }

    const requestedMode = req.body.mode ? String(req.body.mode).trim().toLowerCase() : null;
    let newMode;
    let isSwitched;

    if (requestedMode === 'office') {
      newMode = 'office';
      isSwitched = false;
    } else if (requestedMode === 'field') {
      newMode = 'field';
      isSwitched = true;
    } else {
      // Toggle logic: If currently field, toggle to office; if currently office, toggle to field
      if (activeSession.workMode === 'field') {
        newMode = 'office';
        isSwitched = false;
      } else {
        newMode = 'field';
        isSwitched = true;
      }
    }

    activeSession.workMode = newMode;
    activeSession.isSwitched = isSwitched;
    await activeSession.save();

    console.log(`[Shift Switch] Switched active session ${activeSession.id} to ${newMode} mode (isSwitched: ${isSwitched}) for user ${activeUserId}`);

    const io = req.app ? req.app.get('io') : null;
    if (io) {
      try {
        io.emit('ATTENDANCE_UPDATE', { date: activeSession.date });
      } catch (sockErr) {}
    }

    return res.status(200).json({ 
      message: `Switched to ${newMode === 'field' ? 'Field' : 'Office'} mode successfully.`, 
      session: activeSession 
    });
  } catch (error) {
    console.error('Error switching work mode:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Heartbeat Recovery
router.post('/heartbeat', async (req, res) => {
  try {
    const userId = req.user.id;
    const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
    const session = await HeartbeatMonitorService.registerHeartbeat(userId, req.body);
    if (!session) {
      return res.status(404).json({ error: 'No active session found to register heartbeat.' });
    }
    return res.status(200).json({ message: 'Heartbeat registered successfully.', session });
  } catch (error) {
    console.error('Error handling heartbeat endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/sync-special-credits', async (req, res) => {
  try {
    const { month } = req.body;
    const result = await SpecialEarnedCreditService.syncCreditsForMonth(month);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error syncing special credits:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
    const report = await HeartbeatMonitorService.getAnalyticsReport();
    return res.status(200).json(report);
  } catch (error) {
    console.error('Error compiling analytics:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/health', async (req, res) => {
  try {
    const interrupted = await Attendance.findAll({
      where: {
        checkOut: null,
        trackingStatus: ['INTERRUPTED', 'MISSING', 'WARNING']
      }
    });
    return res.status(200).json({
      status: interrupted.length > 0 ? 'WARNING' : 'HEALTHY',
      interruptedSessionsCount: interrupted.length,
      sessions: interrupted
    });
  } catch (error) {
    console.error('Error checking tracking health:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/status/:sessionId', async (req, res) => {
  try {
    const session = await Attendance.findByPk(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    return res.status(200).json({
      status: session.trackingStatus,
      lastHeartbeat: session.lastHeartbeat,
      missedCount: session.missedHeartbeatCount
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/recovery/:sessionId', async (req, res) => {
  try {
    const session = await Attendance.findByPk(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    return res.status(200).json({
      recoveryTime: session.recoveryTime,
      interruptedDurationSeconds: session.trackingInterruptedDuration
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/notifications/:sessionId', async (req, res) => {
  try {
    const session = await Attendance.findByPk(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    return res.status(200).json({
      notificationCount: session.notificationCount,
      lastNotificationTime: session.lastNotificationTime
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:sessionId', async (req, res) => {
  try {
    const session = await Attendance.findByPk(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    return res.status(200).json(session);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    await Attendance.destroy({ where: {}, truncate: true });
    return res.status(200).json({ message: 'Attendance history cleared.' });
  } catch (error) {
    console.error('Error clearing attendance:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
