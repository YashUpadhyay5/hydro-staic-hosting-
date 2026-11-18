const Footprint = require('../../../../shared/models/Footprint');
const Employee = require('../../../../shared/models/Employee');
const Attendance = require('../../../../shared/models/Attendance');
const Setting = require('../../../../shared/models/Setting');
const SettingAuditLog = require('../../../../shared/models/SettingAuditLog');
const { Op } = require('sequelize');
const http = require('http');
const https = require('https');

// In-memory cache for OSRM routes (TTL: 30 days)
const osrmCache = new Map(); // key -> { legs, timestamp }
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The public OSRM server answers 403 to requests that carry no User-Agent.
const OSRM_USER_AGENT = 'HydroHRMS-RouteReplay/1.0';
const osrmBaseUrl = () => (process.env.OSRM_URL || 'http://router.project-osrm.org').replace(/\/+$/, '');

// Distance rules. The ping interval is set on the dashboard (Settings → Location Update Interval), has changed
// over time and is not followed by every phone, so these rules never assume a fixed interval.
const MIN_MOVE_METERS = 30;              // a fix nearer than this (or than twice its accuracy) to the last counted fix is GPS wobble
const STOP_MAX_ACCURACY_M = 100;         // fixes less accurate than this neither start nor end a stop
const ROAD_ROUTE_MIN_LEG_METERS = 250;   // dense pings already follow the road; only longer hops are filled in by OSRM
const MAX_PLAUSIBLE_KMH = 150;           // a road leg faster than this over its ping gap is a routing detour
const OSRM_MAX_LEGS_PER_CALL = 25;
const GPS_GAP_INTERVALS = 3;             // no fix for 3 ping intervals (and at least 3 minutes) is a GPS gap
const MIN_GPS_GAP_SECONDS = 180;
const DEFAULT_INTERVAL_SECONDS = 300;
const STOP_RADIUS_METERS = 50;
const STOP_MIN_MINUTES = 5;

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

  // GPS ground distance (km, 0.1 precision) for the Expenses Excel report: per day, the sum of straight hops
  // between consecutive GPS fixes from dateFromStr to dateToStr (YYYY-MM-DD, inclusive), skipping non-GPS, mock
  // and >500 m accuracy fixes and any hop faster than 140 km/h. employeeId may be one footprint userId or a list
  // (footprints are stored under the internal id or the empCode). Some older rows hold a full ISO timestamp in
  // `date`, so the day is its first 10 characters.
  static async computeGroundDistanceKm(employeeId, dateFromStr, dateToStr) {
    if (!employeeId || !dateFromStr || !dateToStr) return 0;
    const [y, m, d] = String(dateToStr).split('-').map(Number);
    const dayAfterTo = new Date(Date.UTC(y, m - 1, d + 1));
    const upperBound = isNaN(dayAfterTo.getTime())
      ? { [Op.lte]: dateToStr }
      : { [Op.lt]: dayAfterTo.toISOString().slice(0, 10) };
    const points = await Footprint.findAll({
      where: {
        userId: employeeId,
        date: { [Op.gte]: dateFromStr, ...upperBound }
      },
      order: [['timestamp', 'ASC']],
      raw: true
    });
    if (points.length < 2) return 0;

    const byDay = new Map();
    points.forEach(p => {
      if (p.trackingMethod !== 'GPS') return;
      if (p.latitude === null || p.longitude === null) return;
      if (p.isMockLocation) return;
      if (p.accuracy !== null && p.accuracy > 500) return;
      const day = String(p.date).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(p);
    });

    let totalKm = 0;
    byDay.forEach(dayPoints => {
      for (let i = 1; i < dayPoints.length; i++) {
        const prev = dayPoints[i - 1];
        const cur = dayPoints[i];
        const segmentKm = RouteReplayService.haversineDistanceKm(prev.latitude, prev.longitude, cur.latitude, cur.longitude);
        // Basic teleport filter: a bad GPS fix shouldn't be able to inflate
        // the total with one implausible jump.
        const hours = Math.max((cur.timestamp - prev.timestamp) / 3600000, 1 / 3600);
        if (segmentKm / hours <= 140) {
          totalKm += segmentKm;
        }
      }
    });
    return Math.round(totalKm * 10) / 10;
  }

  // Fetch one OSRM driving route through coords ([[lat, lon], ...], in order) with caching.
  // Resolves to one { distanceMeters, durationSeconds, geometry, steps } per leg, or null when OSRM gives no route.
  static async fetchOsrmRoute(coords) {
    const key = coords.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join('_');
    const cached = osrmCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.legs;
    }

    // continue_straight=false lets the route turn back at a ping, as a person can
    const path = coords.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const url = `${osrmBaseUrl()}/route/v1/driving/${path}?overview=false&steps=true&geometries=geojson&continue_straight=false`;
    const client = url.startsWith('https:') ? https : http;

    return new Promise((resolve) => {
      const req = client.get(url, { timeout: 8000, headers: { 'User-Agent': OSRM_USER_AGENT } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const legs = data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].legs;
            if (legs && legs.length === coords.length - 1) {
              const result = legs.map((leg, i) => {
                const geometry = [];
                for (const step of leg.steps || []) {
                  for (const c of (step.geometry && step.geometry.coordinates) || []) {
                    const last = geometry[geometry.length - 1];
                    if (!last || last[0] !== c[1] || last[1] !== c[0]) geometry.push([c[1], c[0]]);
                  }
                }
                return {
                  distanceMeters: leg.distance || 0,
                  durationSeconds: leg.duration || 0,
                  geometry: geometry.length > 1 ? geometry : [coords[i], coords[i + 1]],
                  steps: leg.steps || []
                };
              });
              osrmCache.set(key, { legs: result, timestamp: Date.now() });
              return resolve(result);
            }
          } catch (e) {}
          resolve(null);
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  // "900 Seconds" as saved by the dashboard; plain numbers are seconds, "N Minutes"/"N Hours" are also read
  static parseIntervalSeconds(raw) {
    if (raw === null || raw === undefined) return null;
    const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*([a-z]*)/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!(n > 0)) return null;
    const unit = m[2].toLowerCase();
    if (!unit || unit.startsWith('s')) return n;
    if (unit.startsWith('m')) return n * 60;
    if (unit.startsWith('h')) return n * 3600;
    return null;
  }

  // Tracking settings as they stood at the end of isoDate. Every settings save is kept in setting_audit_logs with
  // the values it replaced, so the first save after that day holds them; with no later save the current settings apply.
  static async configuredPingSettings(isoDate) {
    let values = null;
    let source = 'current settings';
    try {
      const endOfDay = isoDate ? new Date(`${isoDate}T23:59:59.999+05:30`) : null;
      if (endOfDay && !isNaN(endOfDay.getTime())) {
        const later = await SettingAuditLog.findOne({
          where: { createdAt: { [Op.gt]: endOfDay } },
          order: [['createdAt', 'ASC']]
        });
        if (later) {
          const changes = JSON.parse(later.changes_json);
          if (changes && changes.previous && changes.previous.location_update_interval) {
            values = changes.previous;
            source = 'settings history';
          }
        }
      }
      if (!values) values = await Setting.findOne({ where: { id: 1 }, raw: true });
    } catch (e) {
      console.warn('[RouteReplay] Reading tracking settings failed:', e.message);
    }

    const intervalSeconds = values ? RouteReplayService.parseIntervalSeconds(values.location_update_interval) : null;
    if (!intervalSeconds) return null;

    // With "GPS + Cellular" only gps_ratio_count of every (gps + cellular) pings is a GPS fix
    const provider = String(values.location_provider || 'GPS Only');
    let gpsEverySeconds = intervalSeconds;
    if (provider === 'GPS + Cellular') {
      const gps = Math.max(1, parseInt(values.gps_ratio_count, 10) || 1);
      const cell = Math.max(0, parseInt(values.cellular_ratio_count, 10) || 0);
      gpsEverySeconds = intervalSeconds * (gps + cell) / gps;
    }
    return { intervalSeconds, provider, gpsEverySeconds, source };
  }

  // Typical gap between this day's GPS fixes in seconds (median), or null with fewer than 3 gaps
  static observedGapSeconds(points) {
    const gaps = [];
    for (let i = 1; i < points.length; i++) {
      const gap = (points[i].timestamp - points[i - 1].timestamp) / 1000;
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length < 3) return null;
    gaps.sort((a, b) => a - b);
    return Math.round(gaps[Math.floor(gaps.length / 2)]);
  }

  // The interval the rules use: what the phone really did that day, else the dashboard setting for that day
  static pingTiming(points, configured) {
    const observedSeconds = RouteReplayService.observedGapSeconds(points);
    const usedSeconds = observedSeconds || (configured && configured.gpsEverySeconds) || DEFAULT_INTERVAL_SECONDS;
    return {
      configuredSeconds: configured ? configured.intervalSeconds : null,
      configuredProvider: configured ? configured.provider : null,
      configuredSource: configured ? configured.source : null,
      expectedGpsSeconds: configured ? Math.round(configured.gpsEverySeconds) : null,
      observedSeconds,
      usedSeconds,
      basis: observedSeconds ? 'observed' : (configured ? 'settings' : 'default'),
      gpsGapAfterSeconds: Math.max(MIN_GPS_GAP_SECONDS, GPS_GAP_INTERVALS * usedSeconds)
    };
  }

  static fixDistanceMeters(a, b) {
    return RouteReplayService.haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
  }

  // The fixes that count for distance: a fix counts once it is farther from the last counted fix than
  // MIN_MOVE_METERS and than twice the worse of the two accuracies. Measured from the last counted fix (not the
  // previous fix), so wobble never adds up while slow real movement still does, at any ping interval. Inaccurate
  // fixes still count when the move is far bigger than their error (poor GPS on a highway or a train).
  static buildTrack(points) {
    const track = [];
    for (const p of points) {
      const anchor = track[track.length - 1];
      if (!anchor || RouteReplayService.fixDistanceMeters(anchor, p) > Math.max(MIN_MOVE_METERS, 2 * Math.max(anchor.accuracy || 0, p.accuracy || 0))) {
        track.push(p);
      }
    }
    return track;
  }

  // Stops from position (phones do not report speed): consecutive fixes staying near the first one for STOP_MIN_MINUTES
  static detectStops(points) {
    const stops = [];
    let start = null;
    let last = null;
    const close = () => {
      if (!start) return;
      const durationMinutes = Math.round((last.point.timestamp - start.point.timestamp) / 60000);
      if (durationMinutes >= STOP_MIN_MINUTES) {
        stops.push({
          startTime: start.point.timestamp,
          endTime: last.point.timestamp,
          latitude: start.point.latitude,
          longitude: start.point.longitude,
          address: start.point.address || 'Stopped Location',
          startIndex: start.index,
          durationMinutes,
          displayDuration: `${durationMinutes} mins`
        });
      }
    };
    points.forEach((p, index) => {
      if ((p.accuracy || 0) > STOP_MAX_ACCURACY_M) return;
      if (start && RouteReplayService.fixDistanceMeters(start.point, p) <= Math.max(STOP_RADIUS_METERS, start.point.accuracy || 0, p.accuracy || 0)) {
        last = { point: p, index };
        return;
      }
      close();
      start = last = { point: p, index };
    });
    close();
    return stops;
  }

  // One leg per pair of consecutive counted fixes. A leg is a GPS gap when the longest wait between any two fixes
  // inside it (points = every fix, in time order) is over timing.gpsGapAfterSeconds; its moving time leaves out the
  // time spent in stops. In 'osrm' mode legs of ROAD_ROUTE_MIN_LEG_METERS or more are routed on roads,
  // OSRM_MAX_LEGS_PER_CALL per request; shorter legs, and any OSRM failure, stay straight lines.
  static async measureLegs(track, timing, mode = 'osrm', points = track, stops = []) {
    const legs = [];
    let p = 0;
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      const straightKm = RouteReplayService.haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude);

      let longestNoFixSeconds = 0;
      while (p < points.length && points[p].timestamp < a.timestamp) p++;
      for (let q = p + 1; q < points.length && points[q - 1].timestamp < b.timestamp; q++) {
        longestNoFixSeconds = Math.max(longestNoFixSeconds, (points[q].timestamp - points[q - 1].timestamp) / 1000);
      }

      const stoppedMs = stops.reduce((sum, s) => sum + Math.max(0, Math.min(s.endTime, b.timestamp) - Math.max(s.startTime, a.timestamp)), 0);
      const movingSeconds = Math.max((b.timestamp - a.timestamp - stoppedMs) / 1000, 0);

      legs.push({
        from: a,
        to: b,
        straightKm,
        km: straightKm,
        gapSeconds: movingSeconds,
        longestNoFixSeconds,
        geometry: [[a.latitude, a.longitude], [b.latitude, b.longitude]],
        durationSeconds: 0,
        steps: [],
        routing: 'straight',
        isGpsLost: longestNoFixSeconds > timing.gpsGapAfterSeconds
      });
    }

    const routing = { osrmCalls: 0, osrmFailures: 0 };
    if (mode === 'fast') return { legs, ...routing };

    const routable = (leg) => leg.straightKm * 1000 >= ROAD_ROUTE_MIN_LEG_METERS;
    let i = 0;
    while (i < legs.length) {
      if (!routable(legs[i])) { i++; continue; }
      const run = [];
      while (i < legs.length && routable(legs[i]) && run.length < OSRM_MAX_LEGS_PER_CALL) run.push(legs[i++]);

      const coords = [[run[0].from.latitude, run[0].from.longitude], ...run.map(l => [l.to.latitude, l.to.longitude])];
      routing.osrmCalls++;
      const routed = await RouteReplayService.fetchOsrmRoute(coords);
      if (!routed) { routing.osrmFailures++; continue; }

      run.forEach((leg, k) => {
        const roadKm = routed[k].distanceMeters / 1000;
        const hours = leg.gapSeconds / 3600;
        // Extreme Mountain / Unmapped Road Detour Safety Guard, and roads too long for the time between the pings
        const detour = leg.straightKm > 0.1 && (roadKm / leg.straightKm) > 5.0;
        const tooFast = hours > 0 && (roadKm / hours) > MAX_PLAUSIBLE_KMH;
        if (detour || tooFast) {
          leg.km = leg.straightKm * 1.3;
          leg.routing = 'estimated';
          return;
        }
        leg.km = roadKm;
        leg.geometry = routed[k].geometry;
        leg.durationSeconds = routed[k].durationSeconds;
        leg.steps = routed[k].steps;
        leg.routing = 'road';
      });
    }
    return { legs, ...routing };
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
    let isoDate = null;
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
        isoDate = `${yStr}-${mPad}-${dPad}`;

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

    const pingSettings = await RouteReplayService.configuredPingSettings(isoDate);

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
        pingInterval: RouteReplayService.pingTiming([], pingSettings),
        statistics: { totalLogs: rawFootprints.length, usedGps: 0 },
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

    // 3. Counted track, legs and speeds. GPS gaps follow the day's real ping interval (see pingTiming).
    const timing = RouteReplayService.pingTiming(activeGpsPoints, pingSettings);
    const track = RouteReplayService.buildTrack(activeGpsPoints);

    // 4. Stop Detection (staying within STOP_RADIUS_METERS for STOP_MIN_MINUTES)
    const stops = RouteReplayService.detectStops(activeGpsPoints);

    const { legs, osrmCalls, osrmFailures } = await RouteReplayService.measureLegs(track, timing, mode === 'fast' ? 'fast' : 'osrm', activeGpsPoints, stops);

    const segments = legs.map((leg, i) => {
      const timeDiffHours = Math.max(leg.gapSeconds / 3600, 0.0001);
      const calculatedSpeed = Math.round(leg.km / timeDiffHours);
      const actualSpeed = Math.min(Math.max(calculatedSpeed, leg.to.speed || 0), 140); // Cap at realistic 140 km/h

      // Assign speed color
      let segmentColor = '#10b981'; // Green (Fast >40km/h)
      if (actualSpeed < 15) segmentColor = '#ef4444'; // Red (Slow <15km/h)
      else if (actualSpeed <= 40) segmentColor = '#f97316'; // Orange (Medium 15-40km/h)
      if (leg.isGpsLost) segmentColor = '#a855f7'; // Purple dashed for a GPS gap

      return {
        index: i,
        fromIndex: i,
        toIndex: i + 1,
        fromCoords: [leg.from.latitude, leg.from.longitude],
        toCoords: [leg.to.latitude, leg.to.longitude],
        geometry: leg.geometry,
        distanceKm: Number(leg.km.toFixed(2)),
        durationSeconds: leg.durationSeconds,
        movingMinutes: Math.round(leg.gapSeconds / 60),
        gapMinutes: Math.round(leg.longestNoFixSeconds / 60),
        averageSpeedKmH: actualSpeed,
        color: segmentColor,
        isGpsLost: leg.isGpsLost,
        routing: leg.routing,
        steps: leg.steps
      };
    });

    const fullRoadGeometry = [];
    for (const seg of segments) {
      // Skip first point of each later segment: it repeats the previous segment's end
      fullRoadGeometry.push(...(fullRoadGeometry.length === 0 ? seg.geometry : seg.geometry.slice(1)));
    }

    // Speeds leave out GPS gaps (their timing says nothing about speed) unless every leg is one
    const timedSegments = segments.some(s => !s.isGpsLost) ? segments.filter(s => !s.isGpsLost) : segments;
    const timedKm = timedSegments.reduce((sum, s) => sum + legs[s.index].km, 0);
    const timedHours = timedSegments.reduce((sum, s) => sum + legs[s.index].gapSeconds, 0) / 3600;
    const avgSpeedKmH = timedHours > 0 ? Math.min(Math.round(timedKm / timedHours), 140) : 0;
    const maxSpeedKmH = timedSegments.reduce((max, s) => Math.max(max, s.averageSpeedKmH), 0);

    // 5. Compute Final Metrics

    const firstPoint = gpsPoints[0];
    const lastPoint = gpsPoints[gpsPoints.length - 1];
    const totalTimeMs = Math.max(lastPoint.timestamp - firstPoint.timestamp, 0);

    const totalRoadKm = legs.reduce((sum, l) => sum + l.km, 0);
    const trackStraightKm = legs.reduce((sum, l) => sum + l.straightKm, 0);

    // Point-to-point path through every fix, wobble included (what the replay used to report)
    let rawPathKm = 0;
    for (let i = 0; i < activeGpsPoints.length - 1; i++) {
      rawPathKm += RouteReplayService.haversineDistanceKm(
        activeGpsPoints[i].latitude, activeGpsPoints[i].longitude,
        activeGpsPoints[i + 1].latitude, activeGpsPoints[i + 1].longitude
      );
    }

    const netDisplacementKm = RouteReplayService.haversineDistanceKm(
      firstPoint.latitude, firstPoint.longitude,
      lastPoint.latitude, lastPoint.longitude
    );

    const idleTimeMinutes = stops.reduce((acc, s) => acc + s.durationMinutes, 0);
    const totalTimeMinutes = Math.round(totalTimeMs / 60000);
    const movingTimeMinutes = Math.max(totalTimeMinutes - idleTimeMinutes, 0);

    const statistics = {
      totalLogs: rawFootprints.length,
      usedGps: gpsPoints.length,
      countedPoints: track.length,
      roadDistanceKm: Number(totalRoadKm.toFixed(2)),
      straightDistanceKm: Number(trackStraightKm.toFixed(2)),
      netDisplacementKm: Number(netDisplacementKm.toFixed(2)),
      distanceDifferenceKm: Number((totalRoadKm - trackStraightKm).toFixed(2)),
      avgAccuracyMeters: gpsPoints.length ? Math.round(gpsPoints.reduce((s, p) => s + (p.accuracy || 0), 0) / gpsPoints.length) : 0,
      rawPathKm: Number(rawPathKm.toFixed(2)),
      ignoredWobbleKm: Number(Math.max(rawPathKm - trackStraightKm, 0).toFixed(2)),
      roadRoutedLegs: legs.filter(l => l.routing === 'road').length,
      estimatedLegs: legs.filter(l => l.routing === 'estimated').length,
      straightLegs: legs.filter(l => l.routing === 'straight').length,
      osrmCalls,
      osrmFailures
    };

    const common = {
      employeeId: String(userId),
      employeeName,
      date,
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
      stops,
      pingInterval: timing
    };

    // Fast Mode (straight lines between the counted fixes, no OSRM)
    if (mode === 'fast') {
      return {
        mode: 'fast',
        ...common,
        roadDistance: Number(trackStraightKm.toFixed(2)),
        straightDistance: Number(trackStraightKm.toFixed(2)),
        netDisplacement: Number(netDisplacementKm.toFixed(2)),
        geometry: { type: 'LineString', coordinates: activeGpsPoints.map(p => [p.longitude, p.latitude]) },
        segments: [],
        statistics,
        hasOsrmData: false
      };
    }

    return {
      ...common,
      roadDistance: Number(totalRoadKm.toFixed(2)),
      straightDistance: Number(trackStraightKm.toFixed(2)),
      netDisplacement: Number(netDisplacementKm.toFixed(2)),
      geometry: {
        type: 'LineString',
        coordinates: fullRoadGeometry.map(c => [c[1], c[0]])
      },
      roadCoordinates: fullRoadGeometry,
      segments,
      statistics,
      hasOsrmData: statistics.roadRoutedLegs > 0
    };
  }
}

module.exports = RouteReplayService;
