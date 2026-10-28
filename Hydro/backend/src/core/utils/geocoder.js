const axios = require('axios');

// Persistent spatial proximity cache (holds up to 2000 resolved location points)
const geocodeCache = [];

// Rate-limiting queue configuration
let isProcessingQueue = false;
const requestQueue = [];

// Haversine distance in meters to accurately calculate spatial proximity (<50m)
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Process the geocoding request queue sequentially with a 600ms throttle
async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const item = requestQueue.shift();
    try {
      const address = await performGeocode(item.lat, item.lon);
      item.resolve(address);
    } catch (err) {
      item.resolve(null);
    }
    // Throttle 600ms between requests
    await new Promise(r => setTimeout(r, 600));
  }

  isProcessingQueue = false;
}

// Perform multi-provider reverse geocoding
async function performGeocode(latNum, lonNum) {
  // Provider 1: OpenStreetMap Nominatim (Primary - Exact Street Address)
  try {
    const response = await axios.get(`https://nominatim.openstreetmap.org/reverse`, {
      params: {
        lat: latNum,
        lon: lonNum,
        format: 'json',
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'HydroHRMS/1.0 (admin@hydro.com)'
      },
      timeout: 4000
    });

    if (response.data && response.data.display_name) {
      const addr = response.data.display_name;
      geocodeCache.push({ lat: latNum, lon: lonNum, address: addr });
      if (geocodeCache.length > 2000) geocodeCache.shift();
      console.log(`[Geocoder Nominatim Success] Resolved (${latNum}, ${lonNum}) to: ${addr}`);
      return addr;
    }
  } catch (err) {
    console.warn(`[Geocoder Nominatim Warn] (${latNum}, ${lonNum}):`, err.message);
  }

  // Provider 2: Photon Komoot (Secondary)
  try {
    const response = await axios.get(`https://photon.komoot.io/reverse`, {
      params: { lat: latNum, lon: lonNum },
      timeout: 4000
    });
    if (response.data && response.data.features && response.data.features.length > 0) {
      const prop = response.data.features[0].properties;
      const parts = [
        prop.name,
        prop.district || prop.suburb || prop.locality,
        prop.city || prop.town,
        prop.state,
        prop.postcode,
        prop.country
      ].filter(Boolean);
      
      if (parts.length > 0) {
        const address = parts.join(', ');
        geocodeCache.push({ lat: latNum, lon: lonNum, address });
        if (geocodeCache.length > 2000) geocodeCache.shift();
        console.log(`[Geocoder Photon Success] Resolved (${latNum}, ${lonNum}) to: ${address}`);
        return address;
      }
    }
  } catch (err) {
    console.warn(`[Geocoder Photon Warn] (${latNum}, ${lonNum}):`, err.message);
  }

  // Provider 3: BigDataCloud Locality API (Tertiary Fallback)
  try {
    const response = await axios.get(`https://api.bigdatacloud.net/data/reverse-geocode-client`, {
      params: {
        latitude: latNum,
        longitude: lonNum,
        localityLanguage: 'en'
      },
      timeout: 3000
    });
    if (response.data) {
      const d = response.data;
      const parts = [
        d.locality || d.city,
        d.principalSubdivision,
        d.countryName
      ].filter(Boolean);
      if (parts.length > 0) {
        const address = parts.join(', ');
        geocodeCache.push({ lat: latNum, lon: lonNum, address });
        if (geocodeCache.length > 2000) geocodeCache.shift();
        console.log(`[Geocoder BigDataCloud Success] Resolved (${latNum}, ${lonNum}) to: ${address}`);
        return address;
      }
    }
  } catch (fallbackErr) {
    console.error(`[Geocoder All Providers Failed] (${latNum}, ${lonNum}):`, fallbackErr.message);
  }

  return null;
}

async function getAddressFromCoords(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) {
    return null;
  }
  
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (isNaN(latNum) || isNaN(lonNum)) {
    return null;
  }

  // Hardcoded office location check
  if (Math.abs(latNum - 28.6692) < 0.0005 && Math.abs(lonNum - 77.4538) < 0.0005) {
    return "HRMS HQ Office, Sector 62, Noida, Uttar Pradesh, India";
  }

  // 50-meter Spatial Proximity Cache Lookup (Instant 0ms)
  const cached = geocodeCache.find(c => getDistanceMeters(c.lat, c.lon, latNum, lonNum) <= 50);
  if (cached) {
    console.log(`[Geocoder Spatial Cache Hit 0ms] Reused address for (${latNum}, ${lonNum}): ${cached.address}`);
    return cached.address;
  }

  // Queue request with multi-provider fallback
  return new Promise((resolve, reject) => {
    requestQueue.push({ lat: latNum, lon: lonNum, resolve, reject });
    processQueue();
  });
}

function getCachedAddress(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null;
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (isNaN(latNum) || isNaN(lonNum)) return null;
  if (Math.abs(latNum - 28.6692) < 0.0005 && Math.abs(lonNum - 77.4538) < 0.0005) {
    return "HRMS HQ Office, Sector 62, Noida, Uttar Pradesh, India";
  }
  const cached = geocodeCache.find(c => getDistanceMeters(c.lat, c.lon, latNum, lonNum) <= 50);
  return cached ? cached.address : null;
}

module.exports = { getAddressFromCoords, getCachedAddress };
