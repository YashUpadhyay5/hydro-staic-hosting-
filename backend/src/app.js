const express = require('express');
const compression = require('compression');
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
app.use(compression());

// Essential for running behind GitHub's reverse proxy structure
app.set('trust proxy', 1);

// Global robust CORS Manager
app.use(corsManager);


// The custom corsManager handles all CORS and preflight logic above

// Proxy invoice extractor endpoints directly to python FastAPI service on port 8080
const { createProxyMiddleware } = require('http-proxy-middleware');
const invoiceFilter = (pathname, req) => {
  const url = pathname || (req && (req.originalUrl || req.url || req.path)) || '';
  const method = req ? req.method : '';

  if (method === 'DELETE' && (url.includes('/documents/') || url.includes('/v1/invoice'))) {
    return true;
  }

  // If the request is for HRMS employee documents (e.g. GET /api/documents, /api/documents?userId=...), let Express handle it
  if (url === '/api/documents' || url === '/api/documents/' || (url.startsWith('/api/documents') && !url.includes('/file') && !url.includes('/time') && !url.includes('/archive'))) {
    return false;
  }
  return url.startsWith('/api/upload') || 
         url.startsWith('/upload') || 
         url.startsWith('/api/inventory') || 
         url.startsWith('/inventory') || 
         url.startsWith('/api/export') || 
         url.startsWith('/export') || 
         url.startsWith('/api/templates') || 
         url.startsWith('/templates') || 
         url.startsWith('/api/v1/invoice') ||
         (url.includes('/documents/') && (url.includes('/file') || url.includes('/time') || url.includes('/archive')));
};

const { handleInvoiceExpressFallback } = require('./modules/invoice/routes/invoiceExpressFallback');

const invoiceProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    pathRewrite: {
        '^/api/v1/invoice': '/api'
    },
    onError: (err, req, res) => {
        console.error(`[InvoiceProxy Error] target unreachable: ${err.message}`);
        return handleInvoiceExpressFallback(req, res);
    }
});

app.use((req, res, next) => {
    const fullUrl = req.originalUrl || req.url || req.path;
    if (invoiceFilter(fullUrl, req)) {
        return invoiceProxy(req, res, (err) => {
            if (err) return handleInvoiceExpressFallback(req, res);
            next();
        });
    }
    next();
});


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Synchronize verification context on file preservation system directories
const uploadDir = path.join(__dirname, '..', 'uploads');
const chatUploadDir = path.join(__dirname, '..', 'uploads', 'chat');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}
if (!fs.existsSync(chatUploadDir)){
    fs.mkdirSync(chatUploadDir, { recursive: true });
}

// Apply corsManager directly to the static route
app.use('/static/uploads', corsManager, express.static(uploadDir));

// Initialize new local storage directory and subdirectories
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
const BACKEND_STORAGE_PATH = path.join(__dirname, '..', 'storage');

if (!fs.existsSync(STORAGE_PATH)){
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
}
if (!fs.existsSync(BACKEND_STORAGE_PATH)){
    fs.mkdirSync(BACKEND_STORAGE_PATH, { recursive: true });
}

const subfolders = ['images', 'attendance', 'profile', 'documents', 'invoices', 'temp'];
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

// Expose storage directory statically (supports both root storage and backend/storage)
const staticOptions = {
    setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
};

app.use('/storage', express.static(STORAGE_PATH, staticOptions));
app.use('/storage', express.static(BACKEND_STORAGE_PATH, staticOptions));

// Expose storage subfolders directly at root level for mobile app compatibility
app.use('/images', express.static(path.join(STORAGE_PATH, 'images'), staticOptions));
app.use('/images', express.static(path.join(BACKEND_STORAGE_PATH, 'images'), staticOptions));

app.use('/attendance', express.static(path.join(STORAGE_PATH, 'attendance'), staticOptions));
app.use('/attendance', express.static(path.join(BACKEND_STORAGE_PATH, 'attendance'), staticOptions));

app.use('/documents', express.static(path.join(STORAGE_PATH, 'documents'), staticOptions));
app.use('/documents', express.static(path.join(BACKEND_STORAGE_PATH, 'documents'), staticOptions));

app.use('/profile', express.static(path.join(STORAGE_PATH, 'profile'), staticOptions));
app.use('/profile', express.static(path.join(BACKEND_STORAGE_PATH, 'profile'), staticOptions));

app.use('/invoices', express.static(path.join(STORAGE_PATH, 'invoices'), staticOptions));
app.use('/invoices', express.static(path.join(BACKEND_STORAGE_PATH, 'invoices'), staticOptions));

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

app.get('/', (req, res) => res.json({ status: 'ONLINE', message: 'Hydro HRMS REST API is running successfully!', database: 'Neon Cloud PostgreSQL' }));
app.get('/api', (req, res) => res.json({ status: 'ONLINE', message: 'Hydro HRMS REST API is running successfully!', database: 'Neon Cloud PostgreSQL' }));

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
