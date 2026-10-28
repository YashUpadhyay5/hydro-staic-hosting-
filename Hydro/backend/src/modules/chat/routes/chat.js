const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const chatController = require('../controllers/chatController');

const chatUploadDir = path.join(__dirname, '../../../../uploads/chat');
if (!fs.existsSync(chatUploadDir)) {
  fs.mkdirSync(chatUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, chatUploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB file limit
});

router.get('/employees', chatController.getEmployees);
router.get('/conversations', chatController.getConversations);
router.post('/direct', chatController.getOrCreateDirectChat);
router.get('/messages/:chatId', chatController.getMessages);
router.post('/upload', upload.single('file'), chatController.uploadAttachment);
router.post('/messages/:id/delete', chatController.deleteMessage);
router.put('/messages/:id', chatController.editMessage);
router.post('/pin', chatController.togglePinChat);
router.post('/archive', chatController.toggleArchiveChat);

module.exports = router;
