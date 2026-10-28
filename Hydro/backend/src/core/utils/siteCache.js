const Site = require('../../shared/models/Site');

let cachedSites = [];

/**
 * Loads all sites from database into memory cache
 */
async function loadSites() {
  try {
    const sites = await Site.findAll();
    cachedSites = sites.map(s => s.get({ plain: true }));
    console.log(`[Site Cache] Successfully loaded ${cachedSites.length} sites into memory cache.`);
  } catch (err) {
    console.error('[Site Cache Error] Failed to load sites:', err.message);
  }
}

/**
 * Calculates distance between two points in meters using Haversine formula
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const toRad = x => x * Math.PI / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Classifies coordinates to the nearest matching site within its radius
 * Includes a 10m buffer zone for GPS drift.
 */
function findNearestSite(latitude, longitude) {
  if (latitude === null || longitude === null || latitude === undefined || longitude === undefined) {
    return null;
  }

  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);
  if (isNaN(lat) || isNaN(lon)) return null;

  let nearestSite = null;
  let minDistance = Infinity;

  const GPS_BUFFER = 10; // 10 meter buffer zone for GPS drift

  for (const site of cachedSites) {
    const dist = getDistance(lat, lon, site.latitude, site.longitude);
    const maxAllowedDistance = site.radius + GPS_BUFFER;

    if (dist <= maxAllowedDistance) {
      if (dist < minDistance) {
        minDistance = dist;
        nearestSite = site;
      }
    }
  }

  return nearestSite;
}

module.exports = {
  loadSites,
  findNearestSite,
  getDistance,
  getCachedSites: () => cachedSites
};
