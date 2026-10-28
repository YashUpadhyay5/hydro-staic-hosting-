const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { Employee, Message, Chat, ChatMember, Attachment, ReadReceipt } = require('../shared/models');
const JWT_SECRET = process.env.JWT_SECRET || 'hrms_jwt_secret_key_2026_super_secure';
const activeConnections = new Map(); // employeeId -> Set of socketIds

function initSocketGateway(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // JWT Middleware for Socket Authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        const fallbackEmpId = socket.handshake.auth?.employeeId || socket.handshake.query?.employeeId;
        if (fallbackEmpId) {
          socket.user = { id: fallbackEmpId };
          return next();
        }
        return next(new Error('Authentication failed: Token required'));
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded;
      } catch (err) {
        const empId = socket.handshake.auth?.employeeId || socket.handshake.query?.employeeId;
        if (empId) {
          socket.user = { id: empId };
        } else {
          return next(new Error('Authentication failed: Invalid token'));
        }
      }
      return next();
    } catch (error) {
      console.error('[Socket Auth Error]', error.message);
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    const employeeId = socket.user?.id;
    if (!employeeId) {
      socket.disconnect(true);
      return;
    }
    console.log(`[Socket Connected] Employee: ${employeeId}, SocketId: ${socket.id}`);

    // Register active connection
    if (!activeConnections.has(employeeId)) {
      activeConnections.set(employeeId, new Set());
    }
    activeConnections.get(employeeId).add(socket.id);

    // Join personal notification room
    socket.join(`user:${employeeId}`);

    // Update presence status to online
    try {
      await Employee.update(
        { isOnline: true, lastSeen: new Date() },
        { where: { id: employeeId } }
      );
      io.emit('user_presence', { employeeId, isOnline: true, lastSeen: new Date() });
    } catch (err) {
      console.warn('[Socket Presence Update Error]', err.message);
    }

    // Join specific chat room
    socket.on('join_chat', (chatId) => {
      if (chatId) {
        socket.join(`chat:${chatId}`);
        console.log(`[Socket Join Room] Employee ${employeeId} joined chat:${chatId}`);
      }
    });

    // Leave specific chat room
    socket.on('leave_chat', (chatId) => {
      if (chatId) {
        socket.leave(`chat:${chatId}`);
      }
    });

    // Typing start
    socket.on('typing_start', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('user_typing', { chatId, employeeId, isTyping: true });
    });

    // Typing stop
    socket.on('typing_stop', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('user_typing', { chatId, employeeId, isTyping: false });
    });

    // Send realtime message
    socket.on('send_message', async (data) => {
      try {
        const { chatId, content, type = 'TEXT', parentMessageId = null, tempId, attachments = [] } = data;
        const message = await Message.create({
          chatId,
          senderId: employeeId,
          content,
          type,
          parentMessageId,
          status: 'SENT',
        });

        let savedAttachments = [];
        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const createdAtt = await Attachment.create({
              messageId: message.id,
              fileName: att.fileName || 'file',
              fileUrl: att.fileUrl,
              fileType: att.fileType || 'DOCUMENT',
              fileSize: att.fileSize || 0,
              mimeType: att.mimeType || 'application/octet-stream',
            });
            savedAttachments.push(createdAtt);
          }
        }

        await Chat.update(
          { lastMessageText: content || `[${type}]`, lastMessageAt: new Date() },
          { where: { id: chatId } }
        );

        const fullMsg = {
          ...message.toJSON(),
          senderId: employeeId,
          tempId,
          attachments: savedAttachments,
          createdAt: message.createdAt,
        };

        // 1. Broadcast to chat room
        io.to(`chat:${chatId}`).emit('receive_message', fullMsg);

        // Fetch sender details for WhatsApp-standard push notification
        const sender = await Employee.findByPk(employeeId);
        const senderName = sender ? sender.name : 'Team Member';
        
        let notifBody = content;
        if (type === 'IMAGE' || (savedAttachments[0] && savedAttachments[0].fileType === 'IMAGE')) {
          notifBody = '📷 Photo';
        } else if (savedAttachments[0]) {
          notifBody = `📄 ${savedAttachments[0].fileName || 'File'}`;
        } else if (!notifBody || !notifBody.trim()) {
          notifBody = 'Sent a message';
        }

        const chatPayload = {
          type: 'CHAT',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          chatId: String(chatId),
          senderId: String(employeeId),
          senderName: String(senderName),
          message: String(notifBody),
          timestamp: new Date().toISOString()
        };

        // 2. Notify chat members on personal user rooms & Send WhatsApp-Standard FCM Push Notification
        const members = await ChatMember.findAll({ where: { chatId } });
        for (const member of members) {
          if (String(member.employeeId) !== String(employeeId)) {
            // A) Dispatch notification event to recipient's personal user room
            io.to(`user:${member.employeeId}`).emit('new_message_notification', {
              chatId,
              message: fullMsg,
            });
            // B) Direct message stream to recipient's personal room
            io.to(`user:${member.employeeId}`).emit('receive_message', fullMsg);

            // C) Send WhatsApp-standard FCM push notification to recipient's registered device
            try {
              const NotificationService = require('../modules/hrms/notification/services/NotificationService');
              NotificationService.sendToEmployee(
                member.employeeId,
                senderName,
                notifBody,
                chatPayload,
                employeeId
              ).catch(err => console.error('[Chat Push Notif Error]', err.message));
            } catch (pushErr) {
              console.error('[Chat Push Service Error]', pushErr.message);
            }
          }
        }
      } catch (err) {
        console.error('[Socket send_message Error]', err.message);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    // Mark messages read
    socket.on('mark_read', async ({ chatId, messageId }) => {
      try {
        if (messageId) {
          await ReadReceipt.findOrCreate({
            where: { messageId, employeeId },
            defaults: { readAt: new Date() },
          });
          await Message.update(
            { status: 'READ' },
            { where: { id: messageId } }
          );
          io.to(`chat:${chatId}`).emit('message_read', { chatId, messageId, employeeId, readAt: new Date() });
        }
      } catch (err) {
        console.error('[Socket mark_read Error]', err.message);
      }
    });

    // Disconnect & Presence Handling
    socket.on('disconnect', async () => {
      console.log(`[Socket Disconnected] Employee: ${employeeId}, SocketId: ${socket.id}`);
      const userSockets = activeConnections.get(employeeId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          activeConnections.delete(employeeId);
          try {
            const now = new Date();
            await Employee.update(
              { isOnline: false, lastSeen: now },
              { where: { id: employeeId } }
            );
            io.emit('user_presence', { employeeId, isOnline: false, lastSeen: now });
          } catch (err) {
            console.warn('[Socket Disconnect Presence Error]', err.message);
          }
        }
      }
    });
  });

  return io;
}

module.exports = { initSocketGateway };
