// Site & Geofence Resolver for Field Day Activities
// Resolves the exact Site / Cluster / Locality name from GPS coordinates,
// and evaluates whether a field worker is currently INSIDE or OUTSIDE the site geofence.
const Geofence = require('../../../../shared/models/Geofence');
const Site = require('../../../../shared/models/Site');
const Cluster = require('../../../../shared/models/Cluster');

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371e3; // Earth radius in meters
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class SiteResolver {
  /**
   * Resolves the verified Site / Cluster / Locality name from coordinates.
   * Returns: { siteName, siteType, centerLat, centerLng, radius, distanceMeters }
   */
  static async resolveSite(lat, lon, employee = null) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum) && (latNum !== 0 || lonNum !== 0);

    if (hasCoords) {
      // 1. Check against Office Geofences (157 official site boundaries from location_geofence_settings)
      try {
        const geofences = await Geofence.findAll();
        let closestGeofence = null;
        let minGeofenceDist = Infinity;
        for (const g of geofences) {
          const gLat = Number(g.latitude);
          const gLng = Number(g.longitude);
          const radius = Number(g.radius) || 300;
          const dist = getDistanceMeters(latNum, lonNum, gLat, gLng);
          // Match if worker is within site boundary (+ 50m buffer) or closest within 1.2 km
          const maxAllowed = Math.max(radius + 50, 1200);
          if (dist <= maxAllowed && dist < minGeofenceDist) {
            minGeofenceDist = dist;
            closestGeofence = {
              siteName: g.name,
              siteType: 'OFFICE_GEOFENCE',
              centerLat: gLat,
              centerLng: gLng,
              radius,
              distanceMeters: Math.round(dist)
            };
          }
        }
        if (closestGeofence) return closestGeofence;
      } catch (err) {
        console.warn('[SiteResolver] Office Geofences query failed:', err.message);
      }

      // 2. Check against official Sites (e.g., Lwss Renuka Badon, etc.)
      try {
        const sites = await Site.findAll();
        let closestSite = null;
        let minSiteDist = Infinity;
        for (const s of sites) {
          const sLat = Number(s.latitude);
          const sLng = Number(s.longitude);
          const radius = Number(s.radius) || 1000;
          const dist = getDistanceMeters(latNum, lonNum, sLat, sLng);
          if (dist <= radius + 50 && dist < minSiteDist) {
            minSiteDist = dist;
            closestSite = {
              siteName: s.name,
              siteType: 'SITE',
              centerLat: sLat,
              centerLng: sLng,
              radius,
              distanceMeters: Math.round(dist)
            };
          }
        }
        if (closestSite) return closestSite;
      } catch (err) {
        console.warn('[SiteResolver] Sites query failed:', err.message);
      }

      // 2. Check against Clusters (e.g., Galluwal, Bal, Amritsar, Punjab, etc.)
      try {
        const clusters = await Cluster.findAll();
        let closestCluster = null;
        let minClusterDist = Infinity;
        for (const c of clusters) {
          const cLat = Number(c.center_lat !== undefined ? c.center_lat : c.centerLatitude);
          const cLng = Number(c.center_lng !== undefined ? c.center_lng : c.centerLongitude);
          const radius = Number(c.radius) || 500;
          const dist = getDistanceMeters(latNum, lonNum, cLat, cLng);
          // Match within cluster radius or within 1.2 km
          const maxAllowed = Math.max(radius + 100, 1200);
          if (dist <= maxAllowed && dist < minClusterDist) {
            minClusterDist = dist;
            closestCluster = {
              siteName: c.name,
              siteType: 'CLUSTER',
              centerLat: cLat,
              centerLng: cLng,
              radius,
              distanceMeters: Math.round(dist)
            };
          }
        }
        if (closestCluster) return closestCluster;
      } catch (err) {
        console.warn('[SiteResolver] Clusters query failed:', err.message);
      }

      // 3. Fallback: Check location_footprints for a recent reverse-geocoded address near this location
      try {
        const Footprint = require('../../../../shared/models/Footprint');
        if (Footprint && employee) {
          const recentPoint = await Footprint.findOne({
            where: {
              userId: String(employee.id || employee.empCode),
              address: { [require('sequelize').Op.ne]: null }
            },
            order: [['timestamp', 'DESC']]
          });
          if (recentPoint && recentPoint.address) {
            const pLat = Number(recentPoint.latitude);
            const pLng = Number(recentPoint.longitude);
            if (getDistanceMeters(latNum, lonNum, pLat, pLng) < 1500) {
              // Clean address to a concise locality name (first 2 segments)
              const cleanLocality = recentPoint.address.split(',').slice(0, 2).join(', ').trim();
              if (cleanLocality) {
                return {
                  siteName: cleanLocality,
                  siteType: 'LOCALITY',
                  centerLat: pLat,
                  centerLng: pLng,
                  radius: 1000,
                  distanceMeters: 0
                };
              }
            }
          }
        }
      } catch (err) {}
    }

    // 4. Fallback to Employee's assigned place of duty or location
    const fallbackPlace = employee?.place_of_duty || employee?.location || employee?.holidayDetails || null;
    if (fallbackPlace) {
      return {
        siteName: String(fallbackPlace).trim(),
        siteType: 'ASSIGNED_DUTY',
        centerLat: latNum || null,
        centerLng: lonNum || null,
        radius: 1000,
        distanceMeters: null
      };
    }

    return {
      siteName: 'Site Location',
      siteType: 'DEFAULT',
      centerLat: latNum || null,
      centerLng: lonNum || null,
      radius: 1000,
      distanceMeters: null
    };
  }

  /**
   * Checks whether the current coordinates are STILL INSIDE the site geofence.
   * If the worker has moved outside the radius, returns false.
   */
  static isStillInsideGeofence(currentLat, currentLon, siteInfo) {
    if (!siteInfo || !siteInfo.centerLat || !siteInfo.centerLng) {
      // If no center reference, default to true (to ensure the worker receives the dispatch guidance)
      return true;
    }
    const latNum = Number(currentLat);
    const lonNum = Number(currentLon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum) || (latNum === 0 && lonNum === 0)) {
      return true;
    }

    const dist = getDistanceMeters(latNum, lonNum, siteInfo.centerLat, siteInfo.centerLng);
    const radius = Number(siteInfo.radius) || 1000;
    // 50m GPS drift buffer
    return dist <= radius + 50;
  }
}

module.exports = SiteResolver;
