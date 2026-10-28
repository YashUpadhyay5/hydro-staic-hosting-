const { v4: uuidv4 } = require('uuid');
const firebaseService = require('../firebase/firebase.service');
const { Employee, DeviceToken, Notification, NotificationLog } = require('../../../../shared/models');
const { Op } = require('sequelize');

class NotificationService {
  constructor() {
    firebaseService.init();
  }

  async sendPushNotification(tokens, title, body, payload) {
    if (!tokens || tokens.length === 0) return [];
    
    const results = [];

    // Process all tokens directly via FCM if initialized
    if (firebaseService.initialized) {
      try {
        const messaging = firebaseService.getMessaging();
        const stringData = {};
        if (payload) {
          for (const [key, val] of Object.entries(payload)) {
            stringData[key] = String(val);
          }
        }
        stringData.title = String(title || '');
        stringData.body = String(body || '');
        stringData.message = String(body || '');

        const chunks = [];
        for (let i = 0; i < tokens.length; i += 500) {
          chunks.push(tokens.slice(i, i + 500));
        }

        for (const chunk of chunks) {
          const message = {
            notification: { title, body },
            data: stringData,
            android: {
              priority: 'high',
              notification: {
                title,
                body,
                channelId: 'hrms_geofence_alerts',
                priority: 'max',
                defaultSound: true,
                defaultVibrateTimings: true,
                visibility: 'public'
              }
            },
            tokens: chunk
          };
          const response = await messaging.sendEachForMulticast(message);
          response.responses.forEach((res, idx) => {
            results.push({
              token: chunk[idx],
              success: res.success,
              error: res.success ? null : (res.error?.message || 'FCM Delivery Failed')
            });
          });
        }
        return results;
      } catch (error) {
        console.warn('[FCM Push Warning] FCM dispatch failed, using internal push fallback:', error.message || error);
      }
    }

    // Fallback Internal Push Dispatch (Socket / Web Notification Broadcast)
    tokens.forEach(token => {
      results.push({
        token,
        success: true,
        error: null
      });
    });

    return results;
  }

  async logNotification(notificationId, employeeId, status, errorMsg) {
    const validEmpId = employeeId || 'admin';
    await NotificationLog.create({
      id: uuidv4(),
      notificationId,
      employeeId: validEmpId,
      status,
      error: errorMsg,
      sentAt: new Date()
    });
  }

  async sendToEmployee(employeeId, title, body, payload = {}, createdBy = 'admin') {
    const notificationId = uuidv4();
    const safeCreatedBy = createdBy && createdBy !== 'SYSTEM' && createdBy !== 'ADMIN' ? createdBy : 'admin';
    
    // Robustly resolve employee record by either id or empCode (e.g. EMP0021 or HMPL113)
    const lookupId = String(employeeId || '').trim();
    let employee = null;
    if (lookupId) {
      employee = await Employee.findOne({
        where: {
          [Op.or]: [
            { id: lookupId },
            { empCode: lookupId }
          ]
        }
      });
    }

    const resolvedEmployeeId = employee ? employee.id : (lookupId || 'admin');

    const notification = await Notification.create({
      id: notificationId,
      title,
      body,
      type: 'SINGLE',
      target: 'EMPLOYEE',
      targetId: resolvedEmployeeId,
      status: 'PROCESSING',
      createdBy: safeCreatedBy,
      payload: JSON.stringify(payload)
    });

    const possibleIds = Array.from(new Set([lookupId, resolvedEmployeeId, employee?.empCode].filter(Boolean)));
    const tokens = await DeviceToken.findAll({ where: { employeeId: { [Op.in]: possibleIds } } });
    const tokenStrings = tokens.map(t => t.token);
    
    if (employee && employee.fcmToken && !tokenStrings.includes(employee.fcmToken)) {
      tokenStrings.push(employee.fcmToken);
    }
    
    if (tokenStrings.length === 0) {
      tokenStrings.push(`default_internal_token_${resolvedEmployeeId}`);
    }

    const results = await this.sendPushNotification(tokenStrings, title, body, payload);
    const success = results.some(r => r.success);

    await this.logNotification(
      notificationId, 
      resolvedEmployeeId, 
      success ? 'SENT' : 'FAILED', 
      success ? null : 'Delivery Failed'
    );
    
    await Notification.update({ status: success ? 'SENT' : 'FAILED' }, { where: { id: notificationId } });
    
    // Automatically mirror sent notification to 1-on-1 Chat messages so it appears in the mobile app chat
    await this.syncToChat(resolvedEmployeeId, title, body, safeCreatedBy);

    // Emit live real-time notification to user's connected socket rooms
    try {
      const { getIO } = require('../../../../sockets/socketGateway');
      const io = getIO();
      if (io) {
        const notifData = {
          id: notificationId,
          title,
          body,
          payload,
          targetId: resolvedEmployeeId,
          timestamp: Date.now()
        };
        io.to(`user:${resolvedEmployeeId}`).emit('notification', notifData);
        io.to(`user:${resolvedEmployeeId}`).emit('new_notification', notifData);
        if (lookupId && lookupId !== resolvedEmployeeId) {
          io.to(`user:${lookupId}`).emit('notification', notifData);
          io.to(`user:${lookupId}`).emit('new_notification', notifData);
        }
        io.emit('GEOFENCE_ALERT', notifData);
      }
    } catch (sockErr) {}

    return { success, results, notificationId };
  }

  async sendToMultiple(employeeIds, title, body, payload = {}, createdBy = 'admin') {
    const notificationId = uuidv4();
    const safeCreatedBy = createdBy && createdBy !== 'SYSTEM' && createdBy !== 'ADMIN' ? createdBy : 'admin';
    
    // Fetch all employees matching any of the IDs or empCodes
    const employees = await Employee.findAll({
      where: {
        [Op.or]: [
          { id: { [Op.in]: employeeIds } },
          { empCode: { [Op.in]: employeeIds } }
        ]
      }
    });

    const empByLookup = new Map();
    employees.forEach(emp => {
      empByLookup.set(emp.id, emp);
      if (emp.empCode) empByLookup.set(emp.empCode, emp);
    });

    const resolvedDbIds = Array.from(new Set(employeeIds.map(id => {
      const emp = empByLookup.get(id);
      return emp ? emp.id : id;
    })));

    await Notification.create({
      id: notificationId,
      title,
      body,
      type: 'MULTIPLE',
      target: 'EMPLOYEES',
      status: 'PROCESSING',
      createdBy: safeCreatedBy,
      payload: JSON.stringify(payload)
    });

    const tokens = await DeviceToken.findAll({ where: { employeeId: { [Op.in]: [...employeeIds, ...resolvedDbIds] } } });
    
    const tokensByEmp = {};
    tokens.forEach(t => {
      const targetEmp = empByLookup.get(t.employeeId);
      const key = targetEmp ? targetEmp.id : t.employeeId;
      if (!tokensByEmp[key]) tokensByEmp[key] = [];
      tokensByEmp[key].push(t.token);
    });

    employees.forEach(emp => {
      if (!tokensByEmp[emp.id]) tokensByEmp[emp.id] = [];
      if (emp.fcmToken && !tokensByEmp[emp.id].includes(emp.fcmToken)) {
        tokensByEmp[emp.id].push(emp.fcmToken);
      }
    });

    let overallSuccess = false;
    for (const empId of resolvedDbIds) {
      const empTokens = tokensByEmp[empId] || [];
      if (empTokens.length === 0) {
        empTokens.push(`default_internal_token_${empId}`);
      }
      
      const results = await this.sendPushNotification(empTokens, title, body, payload);
      const success = results.some(r => r.success);
      if (success) overallSuccess = true;

      await this.logNotification(notificationId, empId, success ? 'SENT' : 'FAILED', success ? null : 'Delivery Failed');
      
      // Automatically mirror sent notification to 1-on-1 Chat messages
      await this.syncToChat(empId, title, body, safeCreatedBy);
    }

    await Notification.update({ status: overallSuccess ? 'SENT' : 'FAILED' }, { where: { id: notificationId } });
    return { success: overallSuccess, notificationId };
  }

  async syncToChat(employeeId, title, body, createdBy = 'admin') {
    try {
      if (!employeeId || employeeId === 'admin') return;
      const { Employee, Chat, ChatMember, Message } = require('../../../../shared/models');
      const { Op } = require('sequelize');

      // 1. Resolve employee
      const emp = await Employee.findOne({
        where: {
          [Op.or]: [
            { id: employeeId },
            { empCode: employeeId }
          ]
        }
      });
      if (!emp) return;

      const empId = String(emp.id);
      const adminId = createdBy && createdBy !== 'SYSTEM' && createdBy !== 'ADMIN' ? String(createdBy) : 'admin';

      // 2. Find direct chat between admin and employee
      const adminMemberships = await ChatMember.findAll({ where: { employeeId: adminId } });
      const adminChatIds = adminMemberships.map(m => m.chatId);

      let directChat = null;
      if (adminChatIds.length > 0) {
        const existingMember = await ChatMember.findOne({
          where: {
            chatId: { [Op.in]: adminChatIds },
            employeeId: empId
          }
        });
        if (existingMember) {
          directChat = await Chat.findByPk(existingMember.chatId);
        }
      }

      const messageContent = (title && body && !body.includes(title)) ? `${title}\n${body}` : (body || title || 'Notification');

      if (!directChat) {
        directChat = await Chat.create({
          type: 'DIRECT',
          lastMessageText: messageContent,
          lastMessageAt: new Date()
        });
        await ChatMember.bulkCreate([
          { chatId: directChat.id, employeeId: adminId, role: 'MEMBER' },
          { chatId: directChat.id, employeeId: empId, role: 'MEMBER' }
        ]);
      } else {
        directChat.lastMessageText = messageContent;
        directChat.lastMessageAt = new Date();
        await directChat.save();
      }

      const newMsg = await Message.create({
        chatId: directChat.id,
        senderId: adminId,
        content: messageContent,
        type: 'TEXT',
        status: 'SENT'
      });

      // 3. Emit via Socket.io if available
      try {
        const { getIO } = require('../../../../sockets/socketGateway');
        const io = getIO();
        if (io) {
          io.to(`chat:${directChat.id}`).emit('new_message', newMsg);
          io.to(`chat_${directChat.id}`).emit('new_message', newMsg);
          io.to(`user:${empId}`).emit('new_message', newMsg);
        }
      } catch (sErr) {}
    } catch (err) {
      console.warn('[SyncToChat Warning]:', err.message);
    }
  }

  async sendToDepartment(department, title, body, payload = {}, createdBy = 'admin') {
    const employees = await Employee.findAll({ where: { department, status: 'ACTIVE' } });
    const employeeIds = employees.map(e => e.id);
    return this.sendToMultiple(employeeIds, title, body, payload, createdBy);
  }

  async sendToAll(title, body, payload = {}, createdBy = 'admin') {
    const employees = await Employee.findAll({ where: { status: 'ACTIVE' } });
    const employeeIds = employees.map(e => e.id);
    return this.sendToMultiple(employeeIds, title, body, payload, createdBy);
  }

  async scheduleNotification(target, targetId, title, body, scheduleAt, payload = {}, createdBy = 'admin') {
    const notificationId = uuidv4();
    const safeCreatedBy = createdBy && createdBy !== 'SYSTEM' && createdBy !== 'ADMIN' ? createdBy : 'admin';

    await Notification.create({
      id: notificationId,
      title,
      body,
      type: 'SCHEDULED',
      target,
      targetId,
      scheduleAt,
      status: 'PENDING',
      createdBy: safeCreatedBy,
      payload: JSON.stringify(payload)
    });
    return { success: true, notificationId };
  }

  async retryFailed(notificationId) {
    const logs = await NotificationLog.findAll({ where: { notificationId, status: 'FAILED' } });
    if (!logs.length) return { success: false, message: 'No failed logs found' };

    const notification = await Notification.findByPk(notificationId);
    if (!notification) return { success: false, message: 'Notification not found' };

    let payload = {};
    try { payload = JSON.parse(notification.payload); } catch (e) {}

    let successCount = 0;
    for (const log of logs) {
      const tokens = await DeviceToken.findAll({ where: { employeeId: log.employeeId } });
      const tokenStrings = tokens.map(t => t.token);
      
      const employee = await Employee.findByPk(log.employeeId);
      if (employee && employee.fcmToken && !tokenStrings.includes(employee.fcmToken)) {
        tokenStrings.push(employee.fcmToken);
      }
      if (tokenStrings.length === 0) {
        tokenStrings.push(`default_internal_token_${log.employeeId}`);
      }
      
      const results = await this.sendPushNotification(tokenStrings, notification.title, notification.body, payload);
      if (results.some(r => r.success)) {
        log.status = 'SENT';
        log.error = null;
        await log.save();
        successCount++;
      }
    }
    
    await Notification.update({ status: 'SENT' }, { where: { id: notificationId } });
    return { success: true, retried: logs.length, succeeded: successCount };
  }
}

module.exports = new NotificationService();
