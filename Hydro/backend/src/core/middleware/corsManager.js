/**
 * Robust Global CORS Manager Middleware
 * Dynamically allows cross-origin requests from any static IP or domain
 * and ensures preflight OPTIONS requests return cleanly.
 */
const corsManager = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, Origin, x-access-token, cache-control');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
};

module.exports = corsManager;
