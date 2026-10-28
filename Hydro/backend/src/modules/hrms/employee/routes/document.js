const express = require('express');
const router = express.Router();
const Document = require('../../../../shared/models/Document');
const Employee = require('../../../../shared/models/Employee');
const { Op } = require('sequelize');
const { documentsUpload: upload, getStoragePath } = require('../../../../core/middleware/upload');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const sequelize = require('../../../../config/database');

// Helper to find employee by id, emp_code, or name
async function findEmployee(identifier, name) {
  if (!identifier && !name) return null;
  let emp = null;
  if (identifier && identifier !== 'admin') {
    emp = await Employee.findOne({
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('id')), String(identifier).toLowerCase()),
          sequelize.where(sequelize.fn('lower', sequelize.col('emp_code')), String(identifier).toLowerCase())
        ]
      }
    });
  }
  if (!emp && name && name !== 'System Admin' && name !== 'Admin') {
    emp = await Employee.findOne({
      where: sequelize.where(sequelize.fn('lower', sequelize.col('name')), String(name).toLowerCase())
    });
  }
  return emp;
}

// GET /api/documents - Retrieve documents
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    const effectiveUserId = userId || (req.user && req.user.role === 'EMPLOYEE' ? (req.user.id || req.user.empCode) : null);

    const employees = await Employee.findAll();
    const empMap = new Map();
    employees.forEach(emp => {
      if (emp.id) empMap.set(String(emp.id).toLowerCase(), emp);
      if (emp.empCode) empMap.set(String(emp.empCode).toLowerCase(), emp);
      if (emp.name) empMap.set(String(emp.name).toLowerCase(), emp);
    });

    let whereClause = {};
    if (effectiveUserId && effectiveUserId !== 'admin') {
      const emp = empMap.get(String(effectiveUserId).toLowerCase());
      const rawId = String(effectiveUserId);
      const possibleIds = new Set([rawId, rawId.toUpperCase(), rawId.toLowerCase()]);
      if (emp) {
        if (emp.id) {
          possibleIds.add(String(emp.id));
          possibleIds.add(String(emp.id).toUpperCase());
          possibleIds.add(String(emp.id).toLowerCase());
        }
        if (emp.empCode) {
          possibleIds.add(String(emp.empCode));
          possibleIds.add(String(emp.empCode).toUpperCase());
          possibleIds.add(String(emp.empCode).toLowerCase());
        }
      }

      const idArray = Array.from(possibleIds);

      whereClause = {
        [Op.or]: [
          { uploaderId: { [Op.in]: idArray } },
          { targetType: 'ALL' },
          { targetUserId: { [Op.in]: idArray } }
        ]
      };
    }

    const documents = await Document.findAll({
      where: whereClause,
      order: [['uploadedAt', 'DESC']]
    });

    const enrichedDocs = documents.map(d => {
      const plain = d.toJSON();
      if (plain.uploaderId && plain.uploaderId !== 'admin') {
        const uploaderEmp = empMap.get(String(plain.uploaderId).toLowerCase()) || empMap.get(String(plain.uploaderName || '').toLowerCase());
        if (uploaderEmp) {
          plain.uploaderId = uploaderEmp.empCode || uploaderEmp.id;
          plain.uploaderEmpCode = uploaderEmp.empCode || uploaderEmp.id;
          plain.uploaderName = uploaderEmp.name || plain.uploaderName;
        }
      }
      if (plain.targetType === 'INDIVIDUAL' && plain.targetUserId) {
        const targetEmp = empMap.get(String(plain.targetUserId).toLowerCase()) || empMap.get(String(plain.targetUserName || '').toLowerCase());
        if (targetEmp) {
          plain.targetUserId = targetEmp.empCode || targetEmp.id;
          plain.targetEmpCode = targetEmp.empCode || targetEmp.id;
          plain.targetUserName = targetEmp.name || plain.targetUserName;
        }
      }
      return plain;
    });

    return res.status(200).json(enrichedDocs);
  } catch (error) {
    console.error('Error fetching documents:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/documents - Upload document
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file selected for upload.' });
    }

    const {
      title,
      uploaderId,
      uploaderName,
      targetType,
      targetUserId,
      targetUserName
    } = req.body;

    if (!title || !uploaderId || !uploaderName || !targetType) {
      // Clean up the uploaded file since DB record creation failed/skipped
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
        console.log(`[Storage Log] Deleted orphaned uploaded file: ${req.file.path}`);
      }
      return res.status(400).json({ error: 'Missing required document upload parameters.' });
    }

    // Build relative path for DB record
    const filePath = `documents/${req.file.filename}`;
    const fileType = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const fileSize = req.file.size;

    const newDoc = await Document.create({
      title,
      filePath,
      uploaderId,
      uploaderName,
      targetType,
      targetUserId: targetType === 'INDIVIDUAL' ? targetUserId : null,
      targetUserName: targetType === 'INDIVIDUAL' ? targetUserName : null,
      fileType,
      fileSize,
      uploadedAt: Date.now()
    });

    console.log(`[Storage Log] File uploaded successfully. Relative Path: ${filePath}, DB ID: ${newDoc.id}`);

    // --- PUSH NOTIFICATION LOGIC ---
    try {
      let tokens = [];
      if (targetType === 'INDIVIDUAL' && targetUserId) {
        const emp = await Employee.findByPk(targetUserId);
        if (emp && emp.fcmToken) {
          tokens.push(emp.fcmToken);
        }
      } else if (targetType === 'ALL') {
        const allEmployees = await Employee.findAll({ where: { status: 'ACTIVE', role: 'EMPLOYEE' } });
        allEmployees.forEach(emp => {
          if (emp.fcmToken) {
            tokens.push(emp.fcmToken);
          }
        });
      }

      if (tokens.length > 0) {
        const HeartbeatMonitorService = require('../../../../shared/services/HeartbeatMonitorService');
        for (const t of tokens) {
          await HeartbeatMonitorService.sendPush(
            t,
            'New Document Shared',
            `A new document "${title}" has been uploaded for you.`,
            { type: 'document_shared', documentId: newDoc.id }
          );
        }
      }
    } catch (notifError) {
      console.warn("Document notification dispatch failed:", notifError.message);
    }

    return res.status(201).json(newDoc);
  } catch (error) {
    console.error('Error uploading document:', error);
    // Clean up file if error occurs
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`[Storage Log] Deleted orphaned file after error: ${req.file.path}`);
    }
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/documents/:id - Delete a document
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findByPk(id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Resolve physical path dynamically
    let fullPath;
    if (document.filePath.startsWith('/static/uploads/')) {
      // Legacy upload path
      const filename = path.basename(document.filePath);
      fullPath = path.join(__dirname, '..', 'uploads', filename);
    } else {
      // New storage path
      fullPath = path.join(getStoragePath(), document.filePath);
    }

    // Attempt to delete physical file from disk
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`[Storage Log] Deleted file: ${fullPath}`);
      } catch (err) {
        console.error(`[Storage Log Error] Failed to delete file ${fullPath}:`, err.message);
      }
    } else {
      console.warn(`[Storage Log Warning] File not found on disk during deletion: ${fullPath}`);
    }

    await document.destroy();
    console.log(`[Storage Log] Document DB record deleted: ${id}`);
    return res.status(200).json({ message: 'Document deleted successfully.' });
  } catch (error) {
    console.error('Error deleting document:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET & POST /download-zip - High-Performance Streaming ZIP with DEFLATE Level 9 Compression
router.all('/download-zip', async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const idsParam = req.query.ids || req.body?.ids;
    let requestedIds = [];
    if (idsParam) {
      requestedIds = Array.isArray(idsParam) ? idsParam : idsParam.split(',').map(s => s.trim());
    }

    let whereClause = {};
    if (requestedIds.length > 0) {
      whereClause.id = { [Op.in]: requestedIds };
    } else if (userId && userId !== 'admin') {
      whereClause = {
        [Op.or]: [
          { targetType: 'ALL' },
          { targetUserId: String(userId) },
          { uploaderId: String(userId) }
        ]
      };
    }

    const documents = await Document.findAll({ where: whereClause });
    if (!documents || documents.length === 0) {
      return res.status(404).json({ error: 'No documents found to archive.' });
    }

    // Set streaming ZIP headers
    const zipFilename = `hrms_documents_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum DEFLATE compression level
      forceZip64: true
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('[Archiver Warning]:', err.message);
      } else {
        throw err;
      }
    });

    archive.on('error', (err) => {
      console.error('[Archiver Error]:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Archive compression failed.' });
      }
    });

    // Pipe archive directly into HTTP response stream (0ms disk write overhead)
    archive.pipe(res);

    for (const doc of documents) {
      if (!doc.filePath) continue;
      let fullPath;
      if (doc.filePath.startsWith('/static/uploads/')) {
        const filename = path.basename(doc.filePath);
        fullPath = path.join(__dirname, '..', 'uploads', filename);
      } else {
        fullPath = path.join(getStoragePath(), doc.filePath);
      }

      if (fs.existsSync(fullPath)) {
        const ext = path.extname(fullPath);
        const safeTitle = (doc.title || 'document').replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        const entryName = `${safeTitle}_${doc.id}${ext}`;
        archive.file(fullPath, { name: entryName });
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('ZIP generation error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
  }
});

module.exports = router;
