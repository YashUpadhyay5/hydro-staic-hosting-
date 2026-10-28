const multer = require('multer');
const path = require('path');
const fs = require('fs');

const getStoragePath = () => {
  return process.env.STORAGE_PATH || path.join(__dirname, '..', '..', '..', 'storage');
};

const createUploadMiddleware = (subfolder, allowedMimeTypes = null, maxFileSize = 10 * 1024 * 1024) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const targetDir = path.join(getStoragePath(), subfolder);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      cb(null, targetDir);
    },
    filename: (req, file, cb) => {
      // Security: Sanitize filename and use unique suffix
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      // Remove any dangerous characters from extension
      const safeExt = ext.replace(/[^a-z0-9.]/g, '');
      cb(null, `${subfolder}-${uniqueSuffix}${safeExt}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    // Basic MIME type validation
    if (allowedMimeTypes) {
      const isAllowed = allowedMimeTypes.some(type => {
        if (type.endsWith('/*')) {
          const prefix = type.split('/')[0];
          return file.mimetype.startsWith(prefix + '/');
        }
        return file.mimetype === type;
      });
      
      if (!isAllowed) {
        return cb(new Error(`Invalid file type. Allowed types are: ${allowedMimeTypes.join(', ')}`), false);
      }
    }
    
    // Security: Check for dangerous extensions
    const ext = path.extname(file.originalname).toLowerCase();
    const dangerousExts = ['.exe', '.bat', '.sh', '.js', '.vbs', '.scr', '.pif', '.cmd', '.msi', '.com', '.htm', '.html', '.php', '.jsp', '.asp', '.aspx', '.jar'];
    if (dangerousExts.includes(ext)) {
      return cb(new Error('Danger! File extension is blocked for security reasons.'), false);
    }

    cb(null, true);
  };

  return multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: maxFileSize }
  });
};

const defaultUpload = createUploadMiddleware('images', ['image/*', 'video/*'], 10 * 1024 * 1024);

// Override single method to automatically compress images with Sharp
const originalSingle = defaultUpload.single.bind(defaultUpload);
defaultUpload.single = function(name) {
  const multerSingle = originalSingle(name);
  return function(req, res, next) {
    multerSingle(req, res, async function(err) {
      if (err) return next(err);
      if (req.file && req.file.mimetype.startsWith('image/')) {
        try {
          const sharp = require('sharp');
          const newPath = req.file.path.replace(/\.[^/.]+$/, "") + '.webp';
          await sharp(req.file.path)
            .resize({ width: 1280, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(newPath);
          
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          
          req.file.path = newPath;
          req.file.filename = req.file.filename.replace(/\.[^/.]+$/, "") + '.webp';
          req.file.mimetype = 'image/webp';
          console.log(`[Storage] Compressed image to WebP: ${req.file.filename}`);
        } catch(e) {
          console.error("[Storage] Compression error:", e);
        }
      }
      next();
    });
  }
};

// Attach other configured middlewares to the default upload middleware
defaultUpload.getStoragePath = getStoragePath;
defaultUpload.imagesUpload = defaultUpload;
defaultUpload.documentsUpload = createUploadMiddleware('documents', null, 25 * 1024 * 1024);
defaultUpload.invoicesUpload = createUploadMiddleware('invoices', ['image/*', 'application/pdf'], 10 * 1024 * 1024);
defaultUpload.attendanceUpload = createUploadMiddleware('attendance', ['image/*'], 5 * 1024 * 1024);
defaultUpload.profileUpload = createUploadMiddleware('profile', ['image/*'], 5 * 1024 * 1024);

module.exports = defaultUpload;