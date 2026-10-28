const express = require('express');
const compression = require('compression');
const zlib = require('zlib');
const corsManager = require('./core/middleware/corsManager');
const path = require('path');
const fs = require('fs');

// --- ROUTES IMPORTS (MODULAR ARCHITECTURE) ---
const authRoutes = require('./modules/auth/routes/auth');
const expenseRoutes = require('./modules/hrms/expense/routes/expense');
const attendanceRoutes = require('./modules/hrms/attendance/routes/attendance');
const footprintRoutes = require('./modules/hrms/attendance/routes/footprint');
const mediaRoutes = require('./modules/hrms/attendance/routes/media');
const leaveRoutes = require('./modules/hrms/leave/routes/leave');
const documentRoutes = require('./modules/hrms/employee/routes/document');
const employeeRoutes = require('./modules/hrms/employee/routes/employee');
const geofenceRoutes = require('./modules/hrms/organization/routes/geofence');
const ledgerRoutes = require('./modules/hrms/expense/routes/ledger');
const siteRoutes = require('./modules/hrms/organization/routes/site');
const clusterRoutes = require('./modules/hrms/organization/routes/cluster');
const ruleRoutes = require('./modules/hrms/organization/routes/rule');
const verifyToken = require('./core/middleware/verifyToken');
const payrollRoutes = require('./modules/payroll/routes/payroll');
const notificationRoutes = require('./modules/hrms/notification/routes/notification');
const chatRoutes = require('./modules/chat/routes/chat');
const dashboardSummaryRoutes = require('./modules/hrms/dashboard/routes/summary');
const settingsRoutes = require('./modules/system/routes/settings');
const acknowledgmentRoutes = require('./modules/system/routes/acknowledgments');
const whatsappNotificationRoutes = require('./modules/system/routes/notification');
// Register database models and associations
require('./shared/models/index');

const app = express();

// Native Zstandard (zstd) Compression Middleware for high-performance API responses
app.use((req, res, next) => {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (!acceptEncoding.includes('zstd') || req.method === 'HEAD') return next();

    const oldSend = res.send;
    res.send = function(body) {
        if (!body) return oldSend.call(this, body);
        let buf;
        if (typeof body === 'string') {
            buf = Buffer.from(body);
        } else if (Buffer.isBuffer(body)) {
            buf = body;
        } else if (typeof body === 'object') {
            buf = Buffer.from(JSON.stringify(body));
            if (!this.get('Content-Type')) {
                this.set('Content-Type', 'application/json; charset=utf-8');
            }
        } else {
            return oldSend.call(this, body);
        }

        if (buf.length < 256 || this.get('Content-Encoding')) {
            return oldSend.call(this, body);
        }

        try {
            const compressed = zlib.zstdCompressSync(buf, {
                params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 }
            });
            this.set('Content-Encoding', 'zstd');
            this.set('Vary', 'Accept-Encoding');
            this.removeHeader('Content-Length');
            return oldSend.call(this, compressed);
        } catch (e) {
            return oldSend.call(this, body);
        }
    };
    next();
});

// Fallback compression for older clients
app.use(compression());

// Essential for running behind GitHub's reverse proxy structure
app.set('trust proxy', 1);

// Global robust CORS Manager
app.use(corsManager);


// The custom corsManager handles all CORS and preflight logic above

// Proxy invoice extractor endpoints directly to python FastAPI service on port 8080
const { createProxyMiddleware } = require('http-proxy-middleware');
const { handleInvoiceExpressFallback } = require('./modules/invoice/routes/invoiceExpressFallback');

const invoiceProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    timeout: 120000,
    proxyTimeout: 120000,
    pathRewrite: (pathStr, req) => {
        let orig = (req && req.originalUrl) || pathStr;
        orig = orig.replace(/^\/api\/v1\/invoice/, '/api');
        orig = orig.replace(/^\/api\/v1\//, '/api/');
        return orig;
    },
    onProxyReq: (proxyReq, req, res) => {
        if (req.body && Object.keys(req.body).length && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Type', 'application/json');
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
        }
    },
    onError: (err, req, res) => {
        console.error(`[InvoiceProxy Error] target unreachable: ${err.message}`);
        return handleInvoiceExpressFallback(req, res);
    }
});

app.use((req, res, next) => {
    const url = req.originalUrl || req.url;
    if (
        url.startsWith('/api/v1/invoice') ||
        url.startsWith('/api/invoice') ||
        url.startsWith('/api/export') ||
        url.startsWith('/api/v1/export') ||
        url.startsWith('/api/inventory') ||
        url.startsWith('/api/v1/inventory') ||
        url.startsWith('/api/templates') ||
        url.startsWith('/api/v1/templates') ||
        /\/api\/documents\/[^\/]+\/(preview-image|file|ocr-crop|status|time|retry)/.test(url)
    ) {
        return invoiceProxy(req, res, next);
    }
    next();
});


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '..', 'uploads');
const chatUploadDir = path.join(__dirname, '..', 'uploads', 'chat');

if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(chatUploadDir)){
    fs.mkdirSync(chatUploadDir, { recursive: true });
}

const uploadsStaticOptions = {
    setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
};

// Initialize new local storage directory and subdirectories
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
const BACKEND_STORAGE_PATH = path.join(__dirname, '..', 'storage');

if (!fs.existsSync(STORAGE_PATH)){
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
}
if (!fs.existsSync(BACKEND_STORAGE_PATH)){
    fs.mkdirSync(BACKEND_STORAGE_PATH, { recursive: true });
}

const ROOT_STORAGE_PATH = path.join(__dirname, '..', '..', 'storage');
const subfolders = ['images', 'attendance', 'profile', 'documents', 'invoices', 'payslips', 'temp'];
subfolders.forEach(folder => {
    const folderPath = path.join(STORAGE_PATH, folder);
    if (!fs.existsSync(folderPath)){
        fs.mkdirSync(folderPath, { recursive: true });
    }
    const bFolderPath = path.join(BACKEND_STORAGE_PATH, folder);
    if (!fs.existsSync(bFolderPath)){
        fs.mkdirSync(bFolderPath, { recursive: true });
    }
});

// Expose storage directory statically (supports both root storage and backend/storage) with 7-day cache
const staticOptions = {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    }
};

// No-cache static options specifically for payslips to prevent stale cached versions in browser
const payslipStaticOptions = {
    maxAge: 0,
    etag: false,
    lastModified: true,
    setHeaders: (res, filePath) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
};

// Document directory paths across all possible deployment structures
const rootDocumentsDir = path.join(__dirname, '..', '..', 'documents');
const backendDocumentsDir = path.join(__dirname, '..', 'documents');
const srcDocumentsDir = path.join(__dirname, 'documents');
const uploadsDocumentsDir = path.join(__dirname, '..', 'uploads', 'documents');

[rootDocumentsDir, backendDocumentsDir, srcDocumentsDir, uploadsDocumentsDir].forEach(dir => {
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Static route for /static/uploads and alias /uploads
app.use('/static/uploads', express.static(uploadDir, staticOptions));
app.use('/uploads', express.static(uploadDir, staticOptions));

// Expose documents statically across all storage locations (/documents, /static/documents, /uploads/documents)
app.use('/documents', express.static(rootDocumentsDir, staticOptions));
app.use('/documents', express.static(backendDocumentsDir, staticOptions));
app.use('/documents', express.static(srcDocumentsDir, staticOptions));
app.use('/documents', express.static(uploadsDocumentsDir, staticOptions));
app.use('/documents', express.static(path.join(STORAGE_PATH, 'documents'), staticOptions));
app.use('/documents', express.static(path.join(BACKEND_STORAGE_PATH, 'documents'), staticOptions));

app.use('/static/documents', express.static(rootDocumentsDir, staticOptions));
app.use('/static/documents', express.static(backendDocumentsDir, staticOptions));
app.use('/static/documents', express.static(srcDocumentsDir, staticOptions));
app.use('/static/documents', express.static(uploadsDocumentsDir, staticOptions));
app.use('/static/documents', express.static(path.join(STORAGE_PATH, 'documents'), staticOptions));
app.use('/static/documents', express.static(path.join(BACKEND_STORAGE_PATH, 'documents'), staticOptions));

app.use('/uploads/documents', express.static(uploadsDocumentsDir, staticOptions));
app.use('/uploads/documents', express.static(rootDocumentsDir, staticOptions));
app.use('/uploads/documents', express.static(backendDocumentsDir, staticOptions));
app.use('/uploads/documents', express.static(srcDocumentsDir, staticOptions));
app.use('/uploads/documents', express.static(path.join(STORAGE_PATH, 'documents'), staticOptions));
app.use('/uploads/documents', express.static(path.join(BACKEND_STORAGE_PATH, 'documents'), staticOptions));

// Dynamic no-cache serving for payslips
app.use('/storage/payslips', express.static(path.join(STORAGE_PATH, 'payslips'), payslipStaticOptions));
app.use('/storage/payslips', express.static(path.join(BACKEND_STORAGE_PATH, 'payslips'), payslipStaticOptions));
app.use('/storage/payslips', express.static(path.join(ROOT_STORAGE_PATH, 'payslips'), payslipStaticOptions));

app.use('/storage', express.static(STORAGE_PATH, staticOptions));
app.use('/storage', express.static(BACKEND_STORAGE_PATH, staticOptions));
app.use('/storage', express.static(ROOT_STORAGE_PATH, staticOptions));

// Expose storage subfolders directly at root level for mobile app compatibility
app.use('/images', express.static(path.join(STORAGE_PATH, 'images'), staticOptions));
app.use('/images', express.static(path.join(BACKEND_STORAGE_PATH, 'images'), staticOptions));

app.use('/attendance', express.static(path.join(STORAGE_PATH, 'attendance'), staticOptions));
app.use('/attendance', express.static(path.join(BACKEND_STORAGE_PATH, 'attendance'), staticOptions));

app.use('/profile', express.static(path.join(STORAGE_PATH, 'profile'), staticOptions));
app.use('/profile', express.static(path.join(BACKEND_STORAGE_PATH, 'profile'), staticOptions));

app.use('/invoices', express.static(path.join(STORAGE_PATH, 'invoices'), staticOptions));
app.use('/invoices', express.static(path.join(BACKEND_STORAGE_PATH, 'invoices'), staticOptions));

app.use('/payslips', express.static(path.join(STORAGE_PATH, 'payslips'), payslipStaticOptions));
app.use('/payslips', express.static(path.join(BACKEND_STORAGE_PATH, 'payslips'), payslipStaticOptions));
app.use('/payslips', express.static(path.join(ROOT_STORAGE_PATH, 'payslips'), payslipStaticOptions));

// --- API ROUTE ENDPOINTS (ALL MERGED & PROTECTED) ---
const registerRoutes = (prefix) => {
    app.use(`${prefix}/auth`, authRoutes);
    app.use(`${prefix}/expenses`, verifyToken, expenseRoutes);
    app.use(`${prefix}/attendance`, verifyToken, attendanceRoutes);
    app.use(`${prefix}/footprints`, verifyToken, footprintRoutes);
    app.use(`${prefix}/footprint`, verifyToken, footprintRoutes);
    app.use(`${prefix}/media`, verifyToken, mediaRoutes);
    app.use(`${prefix}/leaves`, verifyToken, leaveRoutes);
    app.use(`${prefix}/documents`, verifyToken, documentRoutes);
    app.use(`${prefix}/hrms-documents`, verifyToken, documentRoutes);
    app.use(`${prefix}/employees`, verifyToken, employeeRoutes);
    app.use(`${prefix}/geofence`, verifyToken, geofenceRoutes);
    app.use(`${prefix}/ledger`, verifyToken, ledgerRoutes);   // Preserved from v1
    app.use(`${prefix}/sites`, verifyToken, siteRoutes);       // Preserved from v2
    app.use(`${prefix}/rules`, verifyToken, ruleRoutes);
    app.use(`${prefix}/clusters`, verifyToken, clusterRoutes); // Preserved from v2
    const databaseGuard = require('./modules/system/routes/databaseGuard');
    app.use(`${prefix}/system/database`, databaseGuard);
    app.use(`${prefix}/payroll`, verifyToken, payrollRoutes);
    app.use(`${prefix}/notifications/whatsapp`, whatsappNotificationRoutes);
    app.use(`${prefix}/notifications`, verifyToken, notificationRoutes);
    app.use(`${prefix}/chat`, verifyToken, chatRoutes);
    app.use(`${prefix}/dashboard`, dashboardSummaryRoutes);
    app.use(`${prefix}/settings`, verifyToken, settingsRoutes);
    app.use(`${prefix}/acknowledgments`, verifyToken, acknowledgmentRoutes);

    const calendarRoutes = require('./modules/hrms/organization/routes/calendar');
    app.use(`${prefix}/holidays`, calendarRoutes);
    app.use(`/api/v1/holidays`, calendarRoutes);

    app.get(`${prefix}/announcements`, verifyToken, (req, res) => {
        return res.json([
            { id: 'a1', title: 'Q3 Enterprise Policy Revision 2026', description: 'Updated flexible work guidelines and healthcare allowance caps are now active in the portal.', datePosted: 'Aug 10, 2026', priority: 'Policy' },
            { id: 'a2', title: 'Scheduled HRMS Portal Maintenance', description: 'Systems will undergo routine maintenance on Aug 18 from 02:00 AM to 04:00 AM IST.', datePosted: 'Aug 12, 2026', priority: 'Urgent' }
        ]);
    });
};

registerRoutes('/api');
registerRoutes('/api/v1');

app.get('/api', (req, res) => res.json({ status: 'ONLINE', message: 'Hydro HRMS REST API is running successfully!', database: 'PostgreSQL 16 Cluster' }));

// Production Static Frontend Hosting with Multi-Core PM2 Cluster
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
    app.use(express.static(frontendDistPath, {
        maxAge: '1y',
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
                res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
            } else if (filePath.includes('assets') || filePath.match(/\.(js|css|woff2?|ttf|png|jpe?g|svg|ico)$/i)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        }
    }));
    
    // SPA Fallback for browser client routing
    app.get('*', (req, res, next) => {
        const url = req.originalUrl || req.url;
        if (
            url.startsWith('/api') || 
            url.startsWith('/v1/invoice') || 
            url.startsWith('/storage') || 
            url.startsWith('/uploads') || 
            url.startsWith('/images') || 
            url.startsWith('/attendance') || 
            url.startsWith('/profile') || 
            url.startsWith('/invoices') || 
            url.startsWith('/payslips')
        ) {
            return next();
        }
        // Strict 404 for missing static assets to prevent serving index.html as JS/CSS
        if (url.startsWith('/assets/') || url.match(/\.(js|css|woff2?|ttf|png|jpe?g|svg|ico|map)$/i)) {
            return res.status(404).type('text/plain').send('Asset Not Found');
        }
        res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
} else {
    app.get('/', (req, res) => res.json({ status: 'ONLINE', message: 'Hydro HRMS REST API is running successfully!', database: 'PostgreSQL 16 Cluster' }));
}

// Global CORS Error Handler to ensure error responses always return CORS headers
app.use((err, req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, Origin, x-access-token');

    console.error('Unhandled Application Error:', err);
    res.status(err.status || err.statusCode || 500).json({
        error: err.message || 'An unexpected internal server error occurred.'
    });
});

module.exports = app;
