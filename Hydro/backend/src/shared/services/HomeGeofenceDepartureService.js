const { Op } = require('sequelize');
const Geofence = require('../models/Geofence');
const Attendance = require('../models/Attendance');
const { getDistance } = require('../../core/utils/siteCache');

const GPS_HOME_BUFFER_METERS = 25; // Buffer for indoor GPS drift

const formatISTTime = (ts) => {
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
};

class HomeGeofenceDepartureService {
  /**
   * Resolve an employee's assigned HOUSE geofence
   * Checks against all canonical aliases (ID, empCode, name)
   */
  static async resolveHomeGeofence(userAliases) {
    if (!userAliases || !userAliases.length) return null;
    const aliases = Array.isArray(userAliases) ? userAliases.filter(Boolean).map(String) : [String(userAliases)];
    if (!aliases.length) return null;

    try {
      const sequelize = require('../../config/database');
      const cleanLower = aliases.map(a => a.trim().toLowerCase());

      // 1. Primary match: Case-insensitive employeeId matching across all canonical aliases (ID, empCode)
      let homeGf = await Geofence.findOne({
        where: {
          category: 'HOUSE',
          [Op.or]: [
            { employeeId: { [Op.in]: aliases } },
            sequelize.where(sequelize.fn('lower', sequelize.col('employee_id')), { [Op.in]: cleanLower })
          ]
        }
      });

      // 2. Resilient Fallback: Match by employee name inside geofence name (e.g. "Kajal Singh House" if employeeId wasn't linked)
      if (!homeGf) {
        for (const alias of aliases) {
          if (alias.length >= 3 && !/^\d+$/.test(alias)) {
            const isPg = sequelize.options.dialect === 'postgres';
            const likeOp = isPg ? Op.iLike : Op.like;
            homeGf = await Geofence.findOne({
              where: {
                category: 'HOUSE',
                name: { [likeOp]: `%${alias}%` }
              }
            });
            if (homeGf) break;
          }
        }
      }

      return homeGf;
    } catch (err) {
      console.warn('[HomeGeofenceDepartureService] Error resolving house geofence:', err.message);
      return null;
    }
  }

  /**
   * Checks if coordinate is inside home geofence
   */
  static isInsideHome(lat, lon, homeGf, bufferMeters = GPS_HOME_BUFFER_METERS) {
    if (!homeGf || lat == null || lon == null) return false;
    const pLat = parseFloat(lat);
    const pLon = parseFloat(lon);
    const gLat = parseFloat(homeGf.latitude);
    const gLon = parseFloat(homeGf.longitude);
    if (isNaN(pLat) || isNaN(pLon) || isNaN(gLat) || isNaN(gLon)) return false;

    const dist = getDistance(pLat, pLon, gLat, gLon);
    const radius = parseFloat(homeGf.radius) || 100;
    const threshold = radius + bufferMeters;

    return {
      isInside: dist <= threshold,
      distance: dist,
      radius,
      threshold
    };
  }

  /**
   * Evaluates Clock-In punch location to determine if it is from Home
   */
  static async evaluateClockIn(lat, lon, userAliases) {
    if (lat == null || lon == null) {
      return { isHomeClockIn: false, homeGeofenceId: null };
    }

    const homeGf = await this.resolveHomeGeofence(userAliases);
    if (!homeGf) {
      return { isHomeClockIn: false, homeGeofenceId: null };
    }

    const check = this.isInsideHome(lat, lon, homeGf);
    if (check && check.isInside) {
      console.log(`[HomeGeofenceDepartureService] Clock-In classified as HOME for aliases [${userAliases.join(', ')}] | Geofence: "${homeGf.name}" (ID: ${homeGf.id}, Dist: ${Math.round(check.distance)}m <= ${check.threshold}m)`);
      return {
        isHomeClockIn: true,
        homeGeofenceId: homeGf.id,
        homeGeofence: homeGf
      };
    }

    return { isHomeClockIn: false, homeGeofenceId: null, homeGeofence: homeGf };
  }

  /**
   * Evaluates an incoming background GPS ping for an active attendance session
   * Updates departure time while inside; locks departure and checkIn upon exit
   */
  static async evaluateFootprintPing(ping, userAliases, activeAttendance, io = null) {
    if (!activeAttendance || !activeAttendance.isHomeClockIn || activeAttendance.hasExitedHome) {
      return null;
    }

    if (ping.latitude == null || ping.longitude == null) {
      return null;
    }

    // Resolve home geofence
    let homeGf = null;
    if (activeAttendance.homeGeofenceId) {
      homeGf = await Geofence.findByPk(activeAttendance.homeGeofenceId).catch(() => null);
    }
    if (!homeGf) {
      homeGf = await this.resolveHomeGeofence(userAliases);
    }
    if (!homeGf) {
      return null;
    }

    const pingTs = Number(ping.timestamp) || Date.now();
    const pingTimeIST = formatISTTime(pingTs);
    const check = this.isInsideHome(ping.latitude, ping.longitude, homeGf);

    if (check.isInside) {
      // Employee is STILL at home:
      // Update homeDepartureTime and checkIn to this latest inside ping
      const prevCheckIn = activeAttendance.checkIn;
      activeAttendance.homeDepartureTime = pingTimeIST;
      activeAttendance.checkIn = pingTimeIST;
      if (ping.address && !activeAttendance.address) {
        activeAttendance.address = ping.address;
      }
      await activeAttendance.save();

      console.log(`[HomeGeofenceDepartureService] Still at home for user ${activeAttendance.userId}. Updated last home ping to ${pingTimeIST} (prev: ${prevCheckIn}, dist: ${Math.round(check.distance)}m)`);
      return { status: 'INSIDE_HOME', departureTime: pingTimeIST };
    } else {
      // Employee has EXITED home geofence!
      // Freeze homeDepartureTime at the last recorded ping at home.
      // If homeDepartureTime wasn't set, default to appCheckIn or pingTimeIST.
      const finalDepartureTime = activeAttendance.homeDepartureTime || activeAttendance.appCheckIn || pingTimeIST;
      activeAttendance.hasExitedHome = true;
      activeAttendance.homeDepartureTime = finalDepartureTime;
      activeAttendance.checkIn = finalDepartureTime; // Lock effective check-in
      await activeAttendance.save();

      console.log(`[HomeGeofenceDepartureService] 🚀 DEPARTED home geofence for user ${activeAttendance.userId}! Official checkIn locked to ${finalDepartureTime} (App punch: ${activeAttendance.appCheckIn}, dist: ${Math.round(check.distance)}m > ${check.threshold}m)`);

      // Broadcast live update across dashboard
      if (io) {
        try {
          io.emit('ATTENDANCE_PUNCH', {
            action: 'HOME_DEPARTURE',
            userId: activeAttendance.userId,
            userName: activeAttendance.userName,
            record: activeAttendance,
            departureTime: finalDepartureTime,
            appCheckIn: activeAttendance.appCheckIn,
            timestamp: pingTs
          });
          io.emit('ATTENDANCE_UPDATE', { date: activeAttendance.date });
        } catch (sockErr) {
          console.warn('[HomeGeofenceDepartureService] Socket emit error:', sockErr.message);
        }
      }

      return { status: 'DEPARTED_HOME', departureTime: finalDepartureTime };
    }
  }
}

module.exports = HomeGeofenceDepartureService;
