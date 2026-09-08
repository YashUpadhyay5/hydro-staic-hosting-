const express = require('express');
const router = express.Router();
const Attendance = require('../../../../shared/models/Attendance');
const Employee = require('../../../../shared/models/Employee');
const Footprint = require('../../../../shared/models/Footprint');
const ShiftEngine = require('../../../../shared/services/ShiftEngine');
const sequelize = require('../../../../config/database');
const { Op } = require('sequelize');
const { getAddressFromCoords } = require('../../../../core/utils/geocoder');
const { getCachedEmployees } = require('../../../../core/utils/employeeCache');

const LEGACY_ALIASES = {
  'emp0128': 'HMPL39',
  'mandeep': 'HMPL39',
  'mandeep singh': 'HMPL39'
};

const getAuthoritativeISTDate = (d = new Date()) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
  } catch {
    return new Date().toISOString().split('T')[0];
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

// Helper to find employee by id, emp_code, or name
async function findEmployee(identifier, name) {
  if (!identifier && !name) return null;
  let emp = null;
  const rawSearchTerms = [identifier, name].filter(Boolean).map(s => String(s).trim().toLowerCase());
  const searchTerms = [];
  rawSearchTerms.forEach(t => {
    searchTerms.push(t);
    if (LEGACY_ALIASES[t]) searchTerms.push(LEGACY_ALIASES[t].toLowerCase());
  });

  for (const term of searchTerms) {
    if (!term) continue;
    emp = await Employee.findOne({
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('id')), term),
          sequelize.where(sequelize.fn('lower', sequelize.col('emp_code')), term),
          sequelize.where(sequelize.fn('lower', sequelize.col('name')), term)
        ]
      }
    });
    if (emp) break;
  }
  return emp;
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
        FROM location_footprints INDEXED BY idx_footprints_ts_user
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
        empMap.get(uKey3) ||
        (LEGACY_ALIASES[uKey1] && empMap.get(LEGACY_ALIASES[uKey1].toLowerCase())) ||
        (LEGACY_ALIASES[uKey2] && empMap.get(LEGACY_ALIASES[uKey2].toLowerCase()))
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
          workMode: emp.workMode || emp.primaryWorkMode || plain.workMode || 'office'
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

      // Inverted Punch Sanitization (where checkOut <= checkIn on a completed past day):
      if (plain.checkIn && plain.checkOut) {
        const inMins = ShiftEngine.parseTimeToMinutes(plain.checkIn);
        const outMins = ShiftEngine.parseTimeToMinutes(plain.checkOut);
        if (inMins != null && outMins != null && outMins <= inMins) {
          // Inverted / invalid punch: auto-heal with shift end
          plain.checkOut = shift.end;
          plain.clockOutMethod = 'AUTO_SHIFT_END';
          plain.workingHours = ShiftEngine.calculateWorkingHours(plain.checkIn, plain.checkOut);
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
    const { userId, date, page, limit, chunked } = req.query;
    const whereClause = {};
    if (date) {
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
    const emp = await findEmployee(rawUserId, userName);
    const activeUserId = emp ? (emp.empCode || emp.emp_code || emp.id) : rawUserId;
    const activeUserName = emp ? emp.name : (userName || 'Employee');
    const possibleUserIds = emp ? [emp.id, emp.empCode, emp.emp_code, rawUserId].filter(Boolean) : [rawUserId].filter(Boolean);

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

    const todayDate = date ? (date.length === 10 ? date : getAuthoritativeISTDate(date)) : getAuthoritativeISTDate();

    // Safeguard 0: Auto-close any dangling unclosed sessions from previous dates for this employee dynamically
    try {
      const stalePastRecords = await Attendance.findAll({
        where: {
          userId: { [Op.in]: possibleUserIds },
          date: { [Op.ne]: todayDate },
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
      const activeRecord = await Attendance.findOne({
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
      }
    }

    // Debounce Safeguard: Prevent rapid double-tap duplicate sessions within 15 seconds
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

    if (existingActive && existingActive.createdAt) {
      const timeSinceCreated = Date.now() - new Date(existingActive.createdAt).getTime();
      if (timeSinceCreated < 15000) {
        console.log(`[Attendance Clock-In Debounce] Returned existing active session ${existingActive.id} created ${timeSinceCreated}ms ago.`);
        return res.status(200).json(existingActive);
      }
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

    // Create record (Clock In)
    const resolvedShift = ShiftEngine.resolveEmployeeShift(emp);
    const inMethod = req.body.checkInMethod || (latVal != null && lonVal != null ? 'MANUAL_APP' : 'MANUAL_WEB');
    const outMethod = cleanCheckOut ? (req.body.clockOutMethod || (latVal != null && lonVal != null ? 'MANUAL_APP' : 'MANUAL_WEB')) : null;

    const newRecord = await Attendance.create({ 
      userId: activeUserId, 
      userName: activeUserName, 
      date: todayDate, 
      checkIn: cleanCheckIn, 
      checkOut: cleanCheckOut, 
      workingHours: workingHours || (cleanCheckIn && cleanCheckOut ? ShiftEngine.calculateWorkingHours(cleanCheckIn, cleanCheckOut) : null), 
      coords: coords ? (typeof coords === 'string' ? coords : JSON.stringify(coords)) : null,
      workMode: workMode || 'office',
      isSwitched: false,
      checkInMethod: inMethod,
      clockOutMethod: outMethod,
      shiftCode: resolvedShift.code
    });

    if (latVal != null && lonVal != null) {
      // Create strict Pin #1 Clock-In GPS Start Anchor Footprint
      try {
        const Footprint = require('../../../../shared/models/Footprint');
        const clockInTs = cleanCheckIn ? new Date(cleanCheckIn).getTime() : Date.now();
        const targetDate = date || new Date(clockInTs).toISOString().split('T')[0];
        
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

    return res.status(201).json(newRecord);
  } catch (error) {
    console.error('Error creating/updating attendance:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /switch-mode : Switch active work mode mid-shift to field
router.post('/switch-mode', async (req, res) => {
  try {
    const userId = req.body.userId || (req.user && req.user.id);
    if (!userId) {
      return res.status(400).json({ error: 'User context or userId parameter required.' });
    }

    const activeSession = await Attendance.findOne({
      where: {
        userId,
        checkOut: null
      },
      order: [['createdAt', 'DESC']]
    });

    if (!activeSession) {
      return res.status(404).json({ error: 'No active clock-in session found to switch.' });
    }

    if (activeSession.workMode === 'field') {
      return res.status(400).json({ error: 'Session is already in Field Work mode.' });
    }

    activeSession.workMode = 'field';
    activeSession.isSwitched = true;
    await activeSession.save();

    console.log(`[Shift Switch] Switched active session ${activeSession.id} to Field mode for user ${userId}`);
    return res.status(200).json({ message: 'Switched to Field Work mode successfully.', session: activeSession });
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
