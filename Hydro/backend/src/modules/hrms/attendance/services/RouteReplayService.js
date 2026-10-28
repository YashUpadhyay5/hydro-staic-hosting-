const Footprint = require('../../../../shared/models/Footprint');
const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const { Op } = require('sequelize');
const http = require('http');

// In-memory cache for OSRM route segments (TTL: 30 days)
const osrmCache = new Map(); // key -> { geometry, distance, duration, steps, timestamp }
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class RouteReplayService {

  // Haversine formula to compute distance in kilometers
  static haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371; // Earth radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Fetch OSRM driving geometry between two coordinates with caching
  static async fetchOsrmSegment(lat1, lon1, lat2, lon2) {
    const key = `${lat1.toFixed(5)},${lon1.toFixed(5)}_${lat2.toFixed(5)},${lon2.toFixed(5)}`;
    
    // Check cache
    const cached = osrmCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached;
    }

    const url = `http://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson&steps=true&annotations=true`;

    return new Promise((resolve) => {
      const req = http.get(url, { timeout: 4000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
              const route = data.routes[0];
              const result = {
                geometry: route.geometry?.coordinates?.map(coord => [coord[1], coord[0]]) || [[lat1, lon1], [lat2, lon2]],
                distanceMeters: route.distance || (RouteReplayService.haversineDistanceKm(lat1, lon1, lat2, lon2) * 1000),
                durationSeconds: route.duration || 0,
                steps: route.legs?.[0]?.steps || []
              };
              
              // Store in cache
              osrmCache.set(key, { ...result, timestamp: Date.now() });
              return resolve(result);
            }
          } catch (e) {}
          // Fallback to straight line
          resolve(RouteReplayService.getFallbackSegment(lat1, lon1, lat2, lon2));
        });
      });

      req.on('error', () => resolve(RouteReplayService.getFallbackSegment(lat1, lon1, lat2, lon2)));
      req.on('timeout', () => {
        req.destroy();
        resolve(RouteReplayService.getFallbackSegment(lat1, lon1, lat2, lon2));
      });
    });
  }

  static getFallbackSegment(lat1, lon1, lat2, lon2) {
    const distKm = RouteReplayService.haversineDistanceKm(lat1, lon1, lat2, lon2);
    return {
      geometry: [[lat1, lon1], [lat2, lon2]],
      distanceMeters: distKm * 1000,
      durationSeconds: Math.round((distKm / 30) * 3600), // assume 30 km/h avg speed
      steps: []
    };
  }

  static async getEnterpriseRouteReplay(userId, date, mode = 'osrm') {
    return this.processReplay(userId, date, mode);
  }

  // Main processing pipeline
  static async processReplay(userId, date, mode = 'osrm') {
    let employee = null;
    try {
      if (Employee && typeof Employee.findOne === 'function') {
        employee = await Employee.findOne({
          where: {
            [Op.or]: [
              { id: String(userId) },
              { empCode: String(userId) },
              { name: String(userId) }
            ]
          }
        });
      }
    } catch (err) {
      console.warn('[RouteReplay] Employee alias lookup warning:', err.message);
    }

    const employeeName = employee ? employee.name : (String(userId) || 'Employee');
    const targetUserIds = employee 
      ? Array.from(new Set([employee.id, employee.empCode, employee.name, String(userId)].filter(Boolean)))
      : [String(userId)];

    // Universal Multi-Format Date Normalizer for DB queries
    const dateVariants = new Set();
    if (date) {
      const rawDateStr = String(date).split('T')[0].split(' ')[0].trim();
      dateVariants.add(rawDateStr);
      dateVariants.add(String(date));

      let year = null, month = null, day = null;
      if (rawDateStr.includes('-')) {
        const parts = rawDateStr.split('-');
        if (parts.length === 3) {
          if (parts[0].length === 4) {
            year = parts[0]; month = parts[1]; day = parts[2];
          } else if (parts[2].length === 4) {
            day = parts[0]; month = parts[1]; year = parts[2];
          }
        }
      } else if (rawDateStr.includes('/')) {
        const parts = rawDateStr.split('/');
        if (parts.length === 3) {
          if (parts[2].length === 4) {
            day = parts[0]; month = parts[1]; year = parts[2];
          } else if (parts[0].length === 4) {
            year = parts[0]; month = parts[1]; day = parts[2];
          }
        }
      }

      if (year && month && day) {
        const yStr = String(year);
        const mPad = String(month).padStart(2, '0');
        const dPad = String(day).padStart(2, '0');
        const mRaw = String(parseInt(month, 10));
        const dRaw = String(parseInt(day, 10));

        dateVariants.add(`${yStr}-${mPad}-${dPad}`);
        dateVariants.add(`${dPad}-${mPad}-${yStr}`);
        dateVariants.add(`${dRaw}-${mRaw}-${yStr}`);
        dateVariants.add(`${yStr}-${mRaw}-${dRaw}`);
        dateVariants.add(`${dPad}/${mPad}/${yStr}`);
        dateVariants.add(`${dRaw}/${mRaw}/${yStr}`);
        dateVariants.add(`${yStr}/${mPad}/${dPad}`);
        dateVariants.add(`${yStr}/${mRaw}/${dRaw}`);
      }
    }
    const allDateVariants = Array.from(dateVariants).filter(Boolean);

    // Fetch attendance for time-boundary checking safely
    let checkInTs = null;
    let checkOutTs = null;
    let attendanceRecord = null;
    try {
      if (Attendance && typeof Attendance.findOne === 'function') {
        attendanceRecord = await Attendance.findOne({
          where: {
            userId: { [Op.or]: targetUserIds },
            date: { [Op.or]: allDateVariants }
          },
          order: [['createdAt', 'DESC']]
        });

        if (attendanceRecord) {
          if (attendanceRecord.checkIn) checkInTs = new Date(attendanceRecord.checkIn).getTime();
          if (attendanceRecord.checkOut) checkOutTs = new Date(attendanceRecord.checkOut).getTime();
        }
      }
    } catch (e) {
      console.warn('[RouteReplay] Attendance boundary check warning:', e.message);
    }

    // 1. Load raw footprint logs for target user and date using all aliases
    let rawFootprints = await Footprint.findAll({
      where: { 
        userId: { [Op.or]: targetUserIds }, 
        date: { [Op.or]: allDateVariants },
        latitude: { [Op.ne]: null },
        longitude: { [Op.ne]: null }
      },
      order: [['timestamp', 'ASC']]
    });

    // Fallback: If 0 footprints recorded but employee has clocked in today, use clock-in coords
    if (rawFootprints.length === 0 && attendanceRecord && attendanceRecord.coords) {
      let parsedCoords = null;
      try {
        parsedCoords = typeof attendanceRecord.coords === 'string' ? JSON.parse(attendanceRecord.coords) : attendanceRecord.coords;
      } catch (e) {}

      const lat = parsedCoords ? (parsedCoords.lat || parsedCoords.latitude) : null;
      const lon = parsedCoords ? (parsedCoords.lon || parsedCoords.lng || parsedCoords.longitude) : null;
      if (lat && lon) {
        rawFootprints = [{
          id: attendanceRecord.id,
          userId: attendanceRecord.userId || userId,
          userName: attendanceRecord.userName || employeeName,
          timestamp: new Date(attendanceRecord.updatedAt || attendanceRecord.createdAt).getTime() || Date.now(),
          date: attendanceRecord.date || date,
          trackingMethod: 'GPS',
          latitude: Number(lat),
          longitude: Number(lon),
          address: attendanceRecord.address || null,
          accuracy: 15,
          speed: null,
          heading: null,
          altitude: null,
          cellId: null,
          locationEnabled: true,
          batteryLevel: attendanceRecord.batteryLevel != null ? Number(attendanceRecord.batteryLevel) : 75,
          batteryTemp: 30,
          reason: 'CLOCK_IN_FALLBACK'
        }];
      }
    }

    // Parse timestamp to epoch ms helper
    const parseTs = (f) => {
      if (!f) return 0;
      if (typeof f.timestamp === 'number') return f.timestamp;
      const parsed = new Date(f.timestamp || f.createdAt).getTime();
      return isNaN(parsed) ? 0 : parsed;
    };

    // Sort by timestamp
    rawFootprints = rawFootprints.sort((a, b) => parseTs(a) - parseTs(b));

    // Dynamic GPS Off Duration Calculation Engine
    let gpsOffMinutes = 0;
    let lastOffTime = null;

    const isExplicitGpsOff = (f) => {
      if (!f) return false;
      const method = String(f.trackingMethod || f.tracking_method || (f.cell_id || f.cellId ? 'CELLULAR' : 'GPS')).toUpperCase();
      if (method.includes('CELL') || method.includes('TOWER') || method.includes('NETWORK') || method.includes('WIFI') || Boolean(f.cell_id || f.cellId)) {
        return false;
      }
      return (
        f.isGpsOff === true || f.isGpsOff === 'true' ||
        f.isGpsOn === false || f.isGpsOn === 'false' || f.isGpsOn === 0 ||
        f.locationEnabled === false || f.locationEnabled === 'false' || f.locationEnabled === 0 || 
        f.location_enabled === 0 || f.location_enabled === '0' || f.location_enabled === false ||
        String(f.gpsStatus || '').toUpperCase() === 'OFF'
      );
    };

    for (let i = 0; i < rawFootprints.length; i++) {
      const f = rawFootprints[i];
      const ts = parseTs(f);
      if (ts === 0) continue;

      if (isExplicitGpsOff(f)) {
        if (!lastOffTime) lastOffTime = ts;
      } else {
        if (lastOffTime) {
          gpsOffMinutes += (ts - lastOffTime) / 60000;
          lastOffTime = null;
        }
      }
    }

    if (lastOffTime) {
      const targetDayStr = String(date || '').split('T')[0];
      const endOfDayTime = new Date(targetDayStr + 'T23:59:59').getTime();
      const nowTime = Date.now();
      const capTime = isNaN(endOfDayTime) ? nowTime : Math.min(endOfDayTime, nowTime);
      if (capTime > lastOffTime) {
        gpsOffMinutes += (capTime - lastOffTime) / 60000;
      }
    }

    const gpsOffDurationMinutes = Math.round(gpsOffMinutes * 10) / 10;
    let gpsOffDurationLabel = '0m';
    if (gpsOffMinutes > 0) {
      const hrs = Math.floor(gpsOffMinutes / 60);
      const mins = Math.round(gpsOffMinutes % 60);
      gpsOffDurationLabel = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    }

    // 2. Strict GPS Filtering & Categorization Pipeline
    const gpsPoints = [];
    let ignoredCellular = 0;
    let ignoredWifi = 0;
    let ignoredNetwork = 0;
    let ignoredInvalid = 0;

    const formattedLogs = [];

    for (let i = 0; i < rawFootprints.length; i++) {
      const f = rawFootprints[i];
      const lat = parseFloat(f.latitude);
      const lon = parseFloat(f.longitude);
      const accuracy = parseFloat(f.accuracy || 10);
      const ts = parseTs(f);
      const method = (f.trackingMethod || f.tracking_method || (f.cell_id || f.cellId ? 'CELLULAR' : 'GPS')).toUpperCase();
      const isCellularOrNetwork = method.includes('CELL') || method.includes('TOWER') || method.includes('NETWORK') || method.includes('WIFI') || Boolean(f.cell_id || f.cellId);
      const isValidCoords = !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && (lat !== 0 || lon !== 0);

      let logStatus = 'USED';
      let statusBadge = '🛰️ GPS (Used)';

      if (checkInTs && ts < checkInTs) {
        ignoredInvalid++;
        logStatus = 'IGNORED_NOT_CLOCKED_IN';
        statusBadge = '⏳ Before Clock-In (Ignored)';
      } else if (checkOutTs && ts > checkOutTs) {
        ignoredInvalid++;
        logStatus = 'IGNORED_CLOCKED_OUT';
        statusBadge = '⏹️ After Clock-Out (Ignored)';
      } else if (!isValidCoords) {
        ignoredInvalid++;
        logStatus = 'IGNORED_INVALID';
        statusBadge = '⚠️ Invalid (Ignored)';
      } else if (isCellularOrNetwork) {
        // STRICT RULE: ALL Cellular & Network pings are 100% IGNORED for distance computation!
        ignoredCellular++;
        logStatus = 'IGNORED_CELLULAR';
        statusBadge = '📱 Cellular (Ignored)';
      } else if (accuracy > 500) {
        ignoredInvalid++;
        logStatus = 'IGNORED_ACCURACY';
        statusBadge = '⚠️ Low Accuracy (>500m Ignored)';
      } else if (gpsPoints.length > 0) {
        // Dynamic Teleportation Spike Guard: Filter out wild jumps requiring >100 km/h travel speed
        const lastGps = gpsPoints[gpsPoints.length - 1];
        const distKm = RouteReplayService.haversineDistanceKm(lastGps.latitude, lastGps.longitude, lat, lon);
        const timeDiffHours = (ts - lastGps.timestamp) / (1000 * 3600);

        if (timeDiffHours > 0 && (distKm / timeDiffHours) > 100) {
          ignoredInvalid++;
          logStatus = 'IGNORED_SPIKE';
          statusBadge = '⚡ Teleportation Jump (Ignored)';
        }
      }

      if (logStatus === 'USED') {
        gpsPoints.push({
          id: f.id,
          latitude: lat,
          longitude: lon,
          accuracy: accuracy,
          speed: parseFloat(f.speed || 0),
          heading: parseFloat(f.heading || 0),
          timestamp: ts,
          address: f.address,
          batteryLevel: f.batteryLevel
        });
      }

      formattedLogs.push({
        id: f.id || `log-${i}`,
        latitude: lat,
        longitude: lon,
        accuracy: accuracy,
        trackingMethod: method,
        status: logStatus,
        statusBadge: statusBadge,
        isUsedForRouting: logStatus === 'USED',
        timestamp: ts,
        address: f.address,
        batteryLevel: f.batteryLevel,
        speed: parseFloat(f.speed || 0)
      });
    }

    // If no valid GPS points exist, return empty route payload safely
    if (gpsPoints.length === 0) {
      return {
        employeeId: String(userId),
        employeeName,
        date,
        roadDistance: 0,
        straightDistance: 0,
        duration: 0,
        movingTime: 0,
        idleTime: 0,
        averageSpeed: 0,
        maximumSpeed: 0,
        gpsOffDurationMinutes,
        gpsOffDurationLabel,
        gpsPoints: [],
        rawLogs: formattedLogs,
        rawFootprints: formattedLogs,
        ignoredCellular,
        ignoredWifi,
        ignoredNetwork,
        ignoredInvalid,
        geometry: [],
        segments: [],
        stops: [],
        timeline: [],
        statistics: { totalLogs: rawFootprints.length, usedGps: 0 },
        hasOsrmData: false
      };
    }

    // Fast Mode (Straight line GPS playback < 1ms)
    if (mode === 'fast') {
      const fastCoords = gpsPoints.map(p => [p.longitude, p.latitude]);
      let straightDistKm = 0;
      for (let i = 0; i < gpsPoints.length - 1; i++) {
        straightDistKm += RouteReplayService.haversineDistanceKm(gpsPoints[i].latitude, gpsPoints[i].longitude, gpsPoints[i+1].latitude, gpsPoints[i+1].longitude);
      }

      return {
        mode: 'fast',
        employeeId: String(userId),
        employeeName,
        date,
        roadDistance: Number(straightDistKm.toFixed(2)),
        straightDistance: Number(straightDistKm.toFixed(2)),
        durationMinutes: gpsPoints.length > 1 ? Math.round((gpsPoints[gpsPoints.length - 1].timestamp - gpsPoints[0].timestamp) / 60000) : 0,
        movingTimeMinutes: 0,
        idleTimeMinutes: 0,
        averageSpeed: 0,
        maximumSpeed: 0,
        gpsOffDurationMinutes,
        gpsOffDurationLabel,
        gpsPoints,
        rawLogs: formattedLogs,
        rawFootprints: formattedLogs,
        ignoredCellular,
        ignoredWifi,
        ignoredNetwork,
        ignoredInvalid,
        geometry: { type: 'LineString', coordinates: fastCoords },
        segments: [],
        stops: [],
        statistics: {
          totalLogs: rawFootprints.length,
          usedGps: gpsPoints.length,
          roadDistanceKm: Number(straightDistKm.toFixed(2)),
          straightDistanceKm: Number(straightDistKm.toFixed(2))
        },
        hasOsrmData: false
      };
    }

    // Spatial Outlier Guard (Mountain Tower Jump Filter):
    // Discards isolated V-shaped clusters that stray >5 km away from main trajectory while direct distance between prev & next distinct locations is <5 km.
    // Plain area city driving pings (<0.5 km apart) bypass this check 100% untouched.
    const filteredGpsPoints = [];
    for (let k = 0; k < gpsPoints.length; k++) {
      const curr = gpsPoints[k];
      
      // Find previous distinct location (>300m away)
      let prev = null;
      for (let p = k - 1; p >= 0; p--) {
        if (RouteReplayService.haversineDistanceKm(gpsPoints[p].latitude, gpsPoints[p].longitude, curr.latitude, curr.longitude) > 0.3) {
          prev = gpsPoints[p];
          break;
        }
      }

      // Find next distinct location (>300m away)
      let next = null;
      for (let n = k + 1; n < gpsPoints.length; n++) {
        if (RouteReplayService.haversineDistanceKm(gpsPoints[n].latitude, gpsPoints[n].longitude, curr.latitude, curr.longitude) > 0.3) {
          next = gpsPoints[n];
          break;
        }
      }

      if (prev && next) {
        const dPrev = RouteReplayService.haversineDistanceKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        const dNext = RouteReplayService.haversineDistanceKm(curr.latitude, curr.longitude, next.latitude, next.longitude);
        const dDirect = RouteReplayService.haversineDistanceKm(prev.latitude, prev.longitude, next.latitude, next.longitude);

        if (dPrev > 5 && dNext > 5 && dDirect < 5) {
          const rawLog = formattedLogs.find(l => l.id === curr.id);
          if (rawLog) {
            rawLog.status = 'IGNORED_SPIKE';
            rawLog.statusBadge = '⚡ Spatial Outlier (Ignored)';
            rawLog.isUsedForRouting = false;
          }
          continue; // Exclude mountain spatial outlier
        }
      }
      filteredGpsPoints.push(curr);
    }
    const activeGpsPoints = filteredGpsPoints.length > 0 ? filteredGpsPoints : gpsPoints;

    // 3. OSRM Route Segment Merging & Speed Calculation
    const segments = [];
    let fullRoadGeometry = [];
    let totalRoadMeters = 0;
    let totalOsrmSeconds = 0;
    let maxSpeedKmH = 0;
    let totalSpeedSum = 0;

    for (let i = 0; i < activeGpsPoints.length - 1; i++) {
      const p1 = activeGpsPoints[i];
      const p2 = activeGpsPoints[i + 1];
      const straightKm = RouteReplayService.haversineDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);

      let segmentDistKm = 0;
      let segmentGeometry = [[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]];
      let osrmDuration = 0;
      let osrmSteps = [];

      // Process OSRM road segment for all consecutive GPS pings
      if (straightKm > 0.001) {
        const osrmRes = await RouteReplayService.fetchOsrmSegment(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        let rawSegmentDistKm = osrmRes.distanceMeters / 1000;
        segmentDistKm = rawSegmentDistKm;
        segmentGeometry = osrmRes.geometry;
        osrmDuration = osrmRes.durationSeconds;
        osrmSteps = osrmRes.steps || [];

        // Extreme Mountain / Unmapped Road Detour Safety Guard
        if (straightKm > 0.1 && (rawSegmentDistKm / straightKm) > 5.0) {
          segmentDistKm = straightKm * 1.3;
          segmentGeometry = [[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]];
        }
      }

      const timeDiffHours = Math.max((p2.timestamp - p1.timestamp) / (1000 * 3600), 0.0001);
      const calculatedSpeed = Math.round(segmentDistKm / timeDiffHours);
      const actualSpeed = Math.min(Math.max(calculatedSpeed, p2.speed || 0), 140); // Cap at realistic 140 km/h

      if (actualSpeed > maxSpeedKmH) maxSpeedKmH = actualSpeed;
      totalSpeedSum += actualSpeed;

      // Assign speed color
      let segmentColor = '#10b981'; // Green (Fast >40km/h)
      if (actualSpeed < 15) segmentColor = '#ef4444'; // Red (Slow <15km/h)
      else if (actualSpeed <= 40) segmentColor = '#f97316'; // Orange (Medium 15-40km/h)

      // Detect GPS signal loss gap > 5 mins (300,000 ms)
      const isGpsLost = (p2.timestamp - p1.timestamp) > 300000;
      if (isGpsLost) segmentColor = '#a855f7'; // Purple dashed for signal loss gap

      segments.push({
        index: i,
        fromIndex: i,
        toIndex: i + 1,
        fromCoords: [p1.latitude, p1.longitude],
        toCoords: [p2.latitude, p2.longitude],
        geometry: segmentGeometry,
        distanceKm: Number(segmentDistKm.toFixed(2)),
        durationSeconds: osrmDuration,
        averageSpeedKmH: actualSpeed,
        color: segmentColor,
        isGpsLost,
        steps: osrmSteps
      });

      totalRoadMeters += Math.round(segmentDistKm * 1000);
      totalOsrmSeconds += osrmDuration;

      // Append geometry coordinates ensuring smooth continuity
      if (fullRoadGeometry.length === 0) {
        fullRoadGeometry.push(...segmentGeometry);
      } else {
        // Skip first point if identical to last
        const coordsToAppend = segmentGeometry.slice(1);
        fullRoadGeometry.push(...coordsToAppend);
      }
    }

    // 4. Stop Detection (Speed < 2 km/h for > 2 minutes = 120,000 ms)
    const stops = [];
    let currentStop = null;

    for (let i = 0; i < gpsPoints.length; i++) {
      const pt = gpsPoints[i];
      const speed = pt.speed || 0;

      if (speed < 2) {
        if (!currentStop) {
          currentStop = {
            startTime: pt.timestamp,
            endTime: pt.timestamp,
            latitude: pt.latitude,
            longitude: pt.longitude,
            address: pt.address || 'Stopped Location',
            startIndex: i
          };
        } else {
          currentStop.endTime = pt.timestamp;
        }
      } else {
        if (currentStop) {
          const durationMinutes = Math.round((currentStop.endTime - currentStop.startTime) / 60000);
          if (durationMinutes >= 2) {
            stops.push({
              ...currentStop,
              durationMinutes,
              displayDuration: `${durationMinutes} mins`
            });
          }
          currentStop = null;
        }
      }
    }
    if (currentStop) {
      const durationMinutes = Math.round((currentStop.endTime - currentStop.startTime) / 60000);
      if (durationMinutes >= 2) {
        stops.push({
          ...currentStop,
          durationMinutes,
          displayDuration: `${durationMinutes} mins`
        });
      }
    }

    // 5. Compute Final Metrics

    const firstPoint = gpsPoints[0];
    const lastPoint = gpsPoints[gpsPoints.length - 1];
    const totalTimeMs = Math.max(lastPoint.timestamp - firstPoint.timestamp, 0);

    // Calculate cumulative point-to-point straight-line path distance across all consecutive GPS points
    let cumulativeStraightKm = 0;
    for (let i = 0; i < gpsPoints.length - 1; i++) {
      cumulativeStraightKm += RouteReplayService.haversineDistanceKm(
        gpsPoints[i].latitude, gpsPoints[i].longitude,
        gpsPoints[i + 1].latitude, gpsPoints[i + 1].longitude
      );
    }

    const netDisplacementKm = RouteReplayService.haversineDistanceKm(
      firstPoint.latitude, firstPoint.longitude,
      lastPoint.latitude, lastPoint.longitude
    );

    let totalRoadKm = totalRoadMeters / 1000;
    if (totalRoadKm === 0 && cumulativeStraightKm > 0) {
      totalRoadKm = cumulativeStraightKm;
    }

    const idleTimeMinutes = stops.reduce((acc, s) => acc + s.durationMinutes, 0);
    const totalTimeMinutes = Math.round(totalTimeMs / 60000);
    const movingTimeMinutes = Math.max(totalTimeMinutes - idleTimeMinutes, 0);
    const avgSpeedKmH = segments.length > 0 ? Math.round(totalSpeedSum / segments.length) : 0;

    return {
      employeeId: String(userId),
      employeeName,
      date,
      roadDistance: Number(totalRoadKm.toFixed(2)),
      straightDistance: Number(cumulativeStraightKm.toFixed(2)),
      netDisplacement: Number(netDisplacementKm.toFixed(2)),
      durationMinutes: totalTimeMinutes,
      movingTimeMinutes: movingTimeMinutes,
      idleTimeMinutes: idleTimeMinutes,
      averageSpeed: avgSpeedKmH,
      maximumSpeed: maxSpeedKmH,
      gpsOffDurationMinutes,
      gpsOffDurationLabel,
      gpsPoints,
      rawLogs: formattedLogs,
      rawFootprints: formattedLogs,
      ignoredCellular,
      ignoredWifi,
      ignoredNetwork,
      ignoredInvalid,
      geometry: {
        type: 'LineString',
        coordinates: fullRoadGeometry.map(c => [c[1], c[0]])
      },
      roadCoordinates: fullRoadGeometry,
      segments,
      stops,
      statistics: {
        totalLogs: rawFootprints.length,
        usedGps: gpsPoints.length,
        roadDistanceKm: Number(totalRoadKm.toFixed(2)),
        straightDistanceKm: Number(cumulativeStraightKm.toFixed(2)),
        netDisplacementKm: Number(netDisplacementKm.toFixed(2)),
        distanceDifferenceKm: Number((totalRoadKm - cumulativeStraightKm).toFixed(2)),
        avgAccuracyMeters: gpsPoints.length ? Math.round(gpsPoints.reduce((s, p) => s + (p.accuracy || 0), 0) / gpsPoints.length) : 0
      },
      hasOsrmData: true
    };
  }
}

module.exports = RouteReplayService;
