/**
 * High-Performance Production Static & Reverse-Proxy Server
 * Replaces Vite Preview on Port 5173 to eliminate 1.1s latency bottleneck.
 * Features: Gzip compression, 1-year immutable caching, HTTP keepalive pooling, SPA fallback.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const zlib = require('zlib');

// Resolve dependencies from backend node_modules
const express = require('D:/hydro-copy/Hydro/backend/node_modules/express');
const compression = require('D:/hydro-copy/Hydro/backend/node_modules/compression');
const { createProxyMiddleware } = require('D:/hydro-copy/Hydro/backend/node_modules/http-proxy-middleware');

const app = express();
const DIST_PATH = path.resolve(__dirname, 'dist');
const TARGET_API = 'http://127.0.0.1:8000';

// 1. zstd is served from the pre-built .zst files (scripts/precompress.cjs) and by the backend for API data.
//    A live zstd wrapper used to sit here; it crashed with ERR_HTTP_HEADERS_SENT and was removed.

// Dynamic compression (Brotli/Gzip) only for responses that have no pre-built file
app.use(compression({
    threshold: 512,
    level: 6
}));

// 2. High-Performance Keep-Alive Agent for API proxying (eliminates TCP handshake delay)
const keepAliveAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 20,
    timeout: 60000
});

const apiProxy = createProxyMiddleware({
    target: TARGET_API,
    changeOrigin: true,
    agent: keepAliveAgent,
    timeout: 120000,
    proxyTimeout: 120000,
    onError: (err, req, res) => {
        console.error('[PROD-PROXY ERROR]:', err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Backend API unavailable', details: err.message });
        }
    }
});

// Route all API requests to the Express backend on port 8000 preserving full URL
const API_PREFIXES = [
    '/api',
    '/v1/invoice',
    '/documents',
    '/static',
    '/storage',
    '/uploads',
    '/images',
    '/invoices',
    '/profile',
    '/attendance',
    '/payslips'
];

app.use((req, res, next) => {
    const rawUrl = req.url || '';
    if (API_PREFIXES.some(prefix => rawUrl.startsWith(prefix))) {
        return apiProxy(req, res, next);
    }
    next();
});

// 2.5. Zero-Copy Pre-compressed Brotli (.br) and Gzip (.gz) Streaming
const mimeTypes = {
    '.js': 'application/javascript; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.html': 'text/html; charset=UTF-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=UTF-8'
};

app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    
    const cleanPath = (req.path || '').replace(/^\//, '');
    const diskPath = path.join(DIST_PATH, cleanPath);
    const ext = path.extname(cleanPath).toLowerCase();
    const contentType = mimeTypes[ext];

    if (!contentType) return next();

    const acceptEncoding = req.headers['accept-encoding'] || '';

    // 1. Try Zstandard (.zst) FIRST (Meta's ultra-fast algorithm, superior speed & ratios)
    if (acceptEncoding.includes('zstd') && fs.existsSync(diskPath + '.zst')) {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', 'zstd');
        res.setHeader('Vary', 'Accept-Encoding');
        if (cleanPath.startsWith('assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
        return res.sendFile(diskPath + '.zst');
    }

    // 2. Try Brotli (.br)
    if (acceptEncoding.includes('br') && fs.existsSync(diskPath + '.br')) {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Vary', 'Accept-Encoding');
        if (cleanPath.startsWith('assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
        return res.sendFile(diskPath + '.br');
    }

    // 3. Try Gzip (.gz) fallback
    if (acceptEncoding.includes('gzip') && fs.existsSync(diskPath + '.gz')) {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        if (cleanPath.startsWith('assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
        return res.sendFile(diskPath + '.gz');
    }

    next();
});

// 3. Ultra-Fast Static Asset Serving with Immutable Caching
app.use(express.static(DIST_PATH, {
    index: false,
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        } else if (filePath.includes('assets') || filePath.match(/\.(js|css|woff2?|ttf|png|jpe?g|svg|ico)$/i)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// 4. Strict 404 Guard for Missing Assets (prevents MIME-type script injection error)
app.use((req, res, next) => {
    const url = req.path || '';
    if (url.startsWith('/assets/') || url.match(/\.(js|css|woff2?|ttf|png|jpe?g|svg|ico|map)$/i)) {
        return res.status(404).type('text/plain').send('Asset Not Found');
    }
    next();
});

// 5. SPA Fallback: Route all client navigation to index.html
app.get('*', (req, res) => {
    // Serve the pre-built index.html.zst/.br/.gz so the main page never needs live compression.
    const indexPath = path.join(DIST_PATH, 'index.html');
    const accept = req.headers['accept-encoding'] || '';
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    for (const [token, ext] of [['zstd', '.zst'], ['br', '.br'], ['gzip', '.gz']]) {
        if (accept.includes(token) && fs.existsSync(indexPath + ext)) {
            res.setHeader('Content-Encoding', token);
            return res.sendFile(indexPath + ext);
        }
    }
    return res.sendFile(indexPath);
});

// 6. Listen on Port 5173 (Production Grade)
const PORT_PRIMARY = process.env.PORT || 5173;
app.listen(PORT_PRIMARY, '0.0.0.0', () => {
    console.log(`[PROD-SERVER] Ultra-fast production frontend online at http://0.0.0.0:${PORT_PRIMARY}`);
});

// 7. Optional Port 80 Listener (standard web port if available)
try {
    const serverPort80 = http.createServer(app);
    serverPort80.listen(80, '0.0.0.0', () => {
        console.log(`[PROD-SERVER] Also listening on standard HTTP port 80 (http://0.0.0.0:80)`);
    });
    serverPort80.on('error', (err) => {
        // Silently skip if port 80 requires elevated privileges or is already bound
        console.log(`[PROD-SERVER] Port 80 not bound (${err.code || err.message}). Port ${PORT_PRIMARY} active.`);
    });
} catch (e) {
    // Ignore
}
