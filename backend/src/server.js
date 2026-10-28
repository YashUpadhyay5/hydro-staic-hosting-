require('dotenv').config();
const http = require('http');
const app = require('./app');
const sequelize = require('./config/database');
const { initSocketGateway } = require('./sockets/socketGateway');
const { runMigrations } = require('./shared/database/migrations');
const { runSeeders } = require('./shared/database/seeders');
const { loadSites } = require('./core/utils/siteCache');
const HeartbeatMonitorService = require('./shared/services/HeartbeatMonitorService');
const CronScheduler = require('./shared/services/CronScheduler');
const NotificationScheduler = require('./modules/hrms/notification/scheduler/cron');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

// Production Socket Lifecycle & Keep-Alive Settings (Ensures mobile sockets close cleanly)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;

let bindAttempts = 0;
const MAX_BIND_ATTEMPTS = 5;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    bindAttempts++;
    if (bindAttempts <= MAX_BIND_ATTEMPTS) {
      console.warn(`[Port Busy]: Port ${PORT} is currently held by flushing sockets. Retrying bind in 2.5s (Attempt ${bindAttempts}/${MAX_BIND_ATTEMPTS})...`);
      setTimeout(() => {
        try {
          server.close();
        } catch(e) {}
        server.listen(PORT);
      }, 2500);
    } else {
      console.error(`[Fatal Server Error]: Port ${PORT} remained busy after ${MAX_BIND_ATTEMPTS} retry attempts.`);
      process.exit(1);
    }
  } else {
    console.error('[Server Socket Error]:', err);
  }
});

// Initialize Socket.IO Gateway
const io = initSocketGateway(server);
app.set('io', io);
HeartbeatMonitorService.setIO(io);

const startServer = async () => {
  try {
    await sequelize.sync();
    if (sequelize.options.dialect === 'sqlite') {
      await sequelize.query('PRAGMA journal_mode=WAL;').catch(() => {});
      await sequelize.query('PRAGMA busy_timeout=5000;').catch(() => {});
    }
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_footprints_user_ts ON location_footprints(user_id, timestamp DESC);').catch(() => {});
    console.log(`Database architecture connected (${sequelize.options.dialect}) with schema sync enabled.`);
    
    await runMigrations(sequelize);
    await runSeeders(sequelize);
    await loadSites();
    
    server.listen(PORT, '0.0.0.0', () => {
      bindAttempts = 0;
      if (typeof process.send === 'function') process.send('ready');
      console.log(`Server executing active connection interface protocols across port: ${PORT} (0.0.0.0)`);

      // CHANGE 7 & CHANGE 1: SERVER STARTUP REPORT & ROUTE AUDIT LOGS
      try {
        const expressPkg = require('express/package.json');
        console.log(`\n==========================================================`);
        console.log(`               ENTERPRISE SERVER STARTUP REPORT           `);
        console.log(`==========================================================`);
        console.log(` Express Version   : v${expressPkg.version}`);
        console.log(` Node Version      : ${process.version}`);
        console.log(` Listening Port    : ${PORT}`);
        console.log(` API Base URL      : http://0.0.0.0:${PORT}/api`);
        console.log(` Database Connected: ONLINE (Sequelize SQLite/MySQL)`);
        console.log(`----------------------------------------------------------`);
        console.log(` REGISTERED ROUTE AUDIT LOGS:`);
        console.log(`----------------------------------------------------------`);
        console.log(` [POST] /api/footprints         -> modules/hrms/attendance/routes/footprint.js`);
        console.log(` [POST] /api/footprints/batch   -> modules/hrms/attendance/routes/footprint.js`);
        console.log(` [GET]  /api/footprints/history -> modules/hrms/attendance/routes/footprint.js`);
        console.log(` [GET]  /api/footprints/live    -> modules/hrms/attendance/routes/footprint.js`);
        console.log(` [GET]  /api/footprints/latest-all -> modules/hrms/attendance/routes/footprint.js`);
        console.log(` [GET]  /api/footprints/route-replay -> modules/hrms/attendance/routes/footprint.js`);
        console.log(` [POST] /api/attendance         -> modules/hrms/attendance/routes/attendance.js`);
        console.log(` [GET]  /api/attendance         -> modules/hrms/attendance/routes/attendance.js`);
        console.log(` [GET]  /api/employees          -> modules/hrms/employee/routes/employee.js`);
        console.log(` [POST] /api/auth/login         -> modules/auth/routes/auth.js`);
        console.log(`==========================================================\n`);
      } catch (rptErr) {
        console.warn('[Startup Report Warning]:', rptErr.message);
      }
      
      // Leader Gating for PM2 Cluster Mode (only primary worker 0 runs schedulers)
      const isLeaderWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
      if (isLeaderWorker) {
        console.log(`[PM2 Cluster] Worker ${process.env.NODE_APP_INSTANCE || '0'} designated as Cluster Leader for schedulers.`);
        
        // Start background heartbeat tracking monitor loop
        setTimeout(() => {
          HeartbeatMonitorService.runBackgroundCheck().catch(err => console.error('[HeartbeatService Loop Error]:', err.message));
        }, 5000);
        
        setInterval(() => {
          HeartbeatMonitorService.runBackgroundCheck().catch(err => console.error('[HeartbeatService Loop Error]:', err.message));
        }, 60000);
        
        // Start background daily scheduled notifications and database backup service
        CronScheduler.start();
        NotificationScheduler.start();
        const { initDailyWhatsAppCron } = require('./shared/services/jobs/dailyAttendanceWhatsAppJob');
        initDailyWhatsAppCron();
        const backupService = require('./core/services/backupService');
        backupService.startAutoBackupInterval(6);

        // Auto-sync salary structures with employee master records on boot
        const { syncAllSalaryStructures } = require('./shared/database/syncSalaryStructures');
        syncAllSalaryStructures().catch(err => console.warn('[Startup SalaryStructure Sync Warning]:', err.message));
      } else {
        console.log(`[PM2 Cluster] Worker ${process.env.NODE_APP_INSTANCE} active in high-throughput API processing mode.`);
      }
    });

    // Graceful Shutdown Handlers for PM2 and Windows Process Management
    const gracefulShutdown = () => {
      console.log('Received shutdown signal, closing server sockets gracefully...');
      try {
        if (io && typeof io.close === 'function') io.close();
      } catch (e) {}
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close(() => {
        console.log('HTTP server closed.');
        sequelize.close().then(() => {
          console.log('Database connection closed.');
          process.exit(0);
        }).catch(() => process.exit(0));
      });
      setTimeout(() => process.exit(0), 2000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    process.on('message', (msg) => {
      if (msg === 'shutdown') gracefulShutdown();
    });
  } catch (err) {
    console.error('Critical database initialization fault mapped:', err);
    process.exit(1);
  }
};

startServer();
