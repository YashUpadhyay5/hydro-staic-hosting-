const fs = require('fs');
const path = require('path');

class BackupService {
    constructor() {
        this.backupDir = path.resolve(__dirname, '../../../../storage/backups');
        this.dbPath = path.resolve(__dirname, '../../../../storage/database.sqlite');
        this.ensureBackupDir();
    }

    ensureBackupDir() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    createBackup(reason = 'scheduled') {
        try {
            if (!fs.existsSync(this.dbPath)) {
                console.warn('[BACKUP] Database file does not exist to back up.');
                return null;
            }

            this.ensureBackupDir();

            // Throttle startup backups: skip if a backup was created less than 15 minutes ago
            if (reason === 'startup') {
                const existing = fs.readdirSync(this.backupDir)
                    .filter(f => f.startsWith('database_backup_') && f !== 'database_backup_LATEST.sqlite')
                    .map(f => ({
                        mtime: fs.statSync(path.join(this.backupDir, f)).mtimeMs
                    }))
                    .sort((a, b) => b.mtime - a.mtime);

                if (existing.length > 0 && (Date.now() - existing[0].mtime) < 15 * 60 * 1000) {
                    console.log('[BACKUP] Recent backup exists (< 15m old). Skipping startup backup.');
                    return null;
                }
            }

            const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `database_backup_${reason}_${dateStr}.sqlite`;
            const targetPath = path.join(this.backupDir, fileName);
            const latestPath = path.join(this.backupDir, 'database_backup_LATEST.sqlite');

            // Asynchronous non-blocking file copy to prevent event loop freezes
            fs.promises.copyFile(this.dbPath, targetPath).then(async () => {
                try {
                    await fs.promises.copyFile(this.dbPath, latestPath);
                    const stats = await fs.promises.stat(targetPath);
                    console.log(`[BACKUP SUCCESS] Created async backup: ${fileName} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
                    this.cleanupOldBackups(30);
                } catch (e) {
                    console.warn('[BACKUP WARNING] Error in secondary latest backup:', e.message);
                }
            }).catch(copyErr => {
                console.error('[BACKUP ERROR] Failed async backup copy:', copyErr.message);
            });

            return { fileName, timestamp: new Date() };
        } catch (err) {
            console.error('[BACKUP ERROR] Failed to create backup:', err);
            return null;
        }
    }

    cleanupOldBackups(maxKeep = 2) {
        try {
            const files = fs.readdirSync(this.backupDir)
                .filter(f => f.startsWith('database_backup_') && f !== 'database_backup_LATEST.sqlite')
                .map(f => ({
                    name: f,
                    path: path.join(this.backupDir, f),
                    mtime: fs.statSync(path.join(this.backupDir, f)).mtimeMs
                }))
                .sort((a, b) => b.mtime - a.mtime);

            if (files.length > maxKeep) {
                const toRemove = files.slice(maxKeep);
                toRemove.forEach(f => {
                    fs.unlinkSync(f.path);
                    console.log(`[BACKUP CLEANUP] Removed old backup file: ${f.name}`);
                });
            }
        } catch (err) {
            console.error('[BACKUP CLEANUP ERROR]:', err);
        }
    }

    startAutoBackupInterval(intervalHours = 6) {
        this.createBackup('startup');
        const ms = intervalHours * 60 * 60 * 1000;
        setInterval(() => {
            console.log('[AUTO-BACKUP] Triggering scheduled database backup...');
            this.createBackup('auto');
        }, ms);
    }
}

module.exports = new BackupService();
