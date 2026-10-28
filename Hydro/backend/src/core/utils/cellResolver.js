const axios = require('axios');

// Local mapping for test/mock Cell IDs to Noida coordinates
const MOCK_CELL_MAPPING = {
  162566930: {
    latitude: 28.5099302,
    longitude: 77.3807299,
    accuracy: 50
  },
  162566940: {
    latitude: 28.5125,
    longitude: 77.3845,
    accuracy: 50
  },
  239366970: {
    latitude: 28.507542,
    longitude: 77.377810,
    accuracy: 80
  },
  234709545: {
    latitude: 28.5160,
    longitude: 77.3880,
    accuracy: 75
  }
};

const OPENCELLID_API_KEY = 'pk.689d849289c8c63708068b2ff1f63b2d';

/**
 * Resolves cellular network info to latitude and longitude.
 * 
 * @param {number|string} mcc Mobile Country Code
 * @param {number|string} mnc Mobile Network Code
 * @param {number|string} lac Local Area Code / Tracking Area Code
 * @param {number|string} cellId Cell Tower Identifier
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}|null>}
 */
let isOpenCellIdQuotaExceeded = false;
let quotaExceededResetTime = 0;

/**
 * Resolves cellular network info to latitude and longitude.
 * 
 * @param {number|string} mcc Mobile Country Code
 * @param {number|string} mnc Mobile Network Code
 * @param {number|string} lac Local Area Code / Tracking Area Code
 * @param {number|string} cellId Cell Tower Identifier
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}|null>}
 */
async function resolveCellToCoords(mcc, mnc, lac, cellId) {
  if (!cellId) {
    return null;
  }

  const parsedCellId = parseInt(cellId, 10);
  if (isNaN(parsedCellId)) {
    return null;
  }

  // 1. Check local mock mapping first to support offline/local test scenarios instantly
  if (MOCK_CELL_MAPPING[parsedCellId]) {
    console.log(`[CellResolver] Resolved test Cell ID ${parsedCellId} from local mock database`);
    return MOCK_CELL_MAPPING[parsedCellId];
  }

  // Circuit breaker check: If OpenCellID daily limit was exceeded, skip network lookup for 1 hour
  if (isOpenCellIdQuotaExceeded && Date.now() < quotaExceededResetTime) {
    return null;
  }

  // 2. Resolve via OpenCellID API
  // Use defaults for standard Indian networks if params are not provided
  const queryMcc = parseInt(mcc, 10) || 404;
  const queryMnc = parseInt(mnc, 10) || 10;
  const queryLac = parseInt(lac, 10) || 0;

  try {
    console.log(`[CellResolver] Querying OpenCellID for Cell ID: ${parsedCellId}, MCC: ${queryMcc}, MNC: ${queryMnc}, LAC: ${queryLac}`);
    const response = await axios.get('https://opencellid.org/cell/get', {
      params: {
        key: OPENCELLID_API_KEY,
        mcc: queryMcc,
        mnc: queryMnc,
        lac: queryLac,
        cellid: parsedCellId,
        format: 'json'
      },
      timeout: 1000
    });

    if (response.data && response.data.lat && response.data.lon) {
      const result = {
        latitude: parseFloat(response.data.lat),
        longitude: parseFloat(response.data.lon),
        accuracy: parseFloat(response.data.range) || 500
      };
      console.log(`[CellResolver] OpenCellID Success: Resolved Cell ID ${parsedCellId} to (${result.latitude}, ${result.longitude})`);
      isOpenCellIdQuotaExceeded = false;
      return result;
    }
  } catch (err) {
    const errorData = err.response && err.response.data ? err.response.data : {};
    const errorMsg = typeof errorData === 'object' ? JSON.stringify(errorData) : err.message;
    console.warn(`[CellResolver] OpenCellID Lookup failed for Cell ID ${parsedCellId}: ${errorMsg}`);
    
    // Check if error is due to daily limit exceeded or unauthorized API key
    if (errorData.code === 7 || (errorMsg && errorMsg.includes("limit exceeded"))) {
      console.warn(`[CellResolver Circuit Breaker] Daily API limit exceeded. Bypassing OpenCellID network calls for 1 hour to maintain low latency.`);
      isOpenCellIdQuotaExceeded = true;
      quotaExceededResetTime = Date.now() + (60 * 60 * 1000); // 1 hour cooldown
    }
  }

  return null;
}

module.exports = { resolveCellToCoords };
