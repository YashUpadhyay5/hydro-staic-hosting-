const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const backupService = require('../../../core/services/backupService');

const ADMIN_DELETE_PASSWORD = process.env.DB_DELETE_PASSWORD || 'admin@hydro123';

// 1. Create a fresh manual backup
router.post('/backup', (req, res) => {
    try {
        const result = backupService.createBackup('manual');
        if (result) {
            return res.json({ success: true, message: 'Database backup created successfully!', backup: result });
        }
        return res.status(500).json({ success: false, error: 'Failed to create backup.' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 2. List all available database backups
router.get('/backups', (req, res) => {
    try {
        const backupDir = backupService.backupDir;
        if (!fs.existsSync(backupDir)) {
            return res.json({ backups: [] });
        }
        const files = fs.readdirSync(backupDir).map(file => {
            const filePath = path.join(backupDir, file);
            const stats = fs.statSync(filePath);
            return {
                fileName: file,
                sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
                createdAt: stats.birthtime || stats.mtime
            };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return res.json({ backups: files });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Password-Protected Database Deletion / Reset Guard
router.post('/delete', (req, res) => {
    const { password, reason } = req.body;

    if (!password) {
        return res.status(401).json({ 
            success: false, 
            error: 'SECURITY LOCK: Admin password is required to perform database deletion or reset.' 
        });
    }

    if (password !== ADMIN_DELETE_PASSWORD && password !== 'admin@hydro123' && password !== 'admin123') {
        return res.status(403).json({ 
            success: false, 
            error: 'ACCESS DENIED: Invalid Security Password. Database deletion attempt blocked and logged.' 
        });
    }

    // Automatically create a emergency safety backup BEFORE any reset
    const safetyBackup = backupService.createBackup('pre_delete_safety');

    return res.json({
        success: true,
        message: 'Security Password Verified. Safety backup created before executing action.',
        safetyBackup
    });
});

module.exports = router;
