const { Op } = require('sequelize');
const { Employee, Chat, ChatMember, Message, Attachment, ReadReceipt, PinnedChat, ArchivedChat } = require('../../../shared/models');
const path = require('path');
const fs = require('fs');

// 1. Directory Search
exports.getEmployees = async (req, res) => {
  try {
    const { search, department, currentUserId } = req.query;
    const currentId = currentUserId || req.user?.id;
    let whereClause = {};

    if (currentId) {
      whereClause.id = { [Op.ne]: String(currentId) };
    }

    if (department && department !== 'ALL') {
      whereClause.department = department;
    }

    if (search && search.trim()) {
      const isPostgres = Employee.sequelize?.options?.dialect === 'postgres';
      const likeOp = isPostgres ? Op.iLike : Op.like;
      const term = `%${search.trim()}%`;
      whereClause[Op.or] = [
        { name: { [likeOp]: term } },
        { id: { [likeOp]: term } },
        { department: { [likeOp]: term } },
        { designation: { [likeOp]: term } },
        { email: { [likeOp]: term } },
      ];
    }

    const employees = await Employee.findAll({
      where: whereClause,
      attributes: ['id', 'name', 'email', 'role', 'designation', 'department', 'gender', 'avatar', 'isOnline', 'lastSeen', 'status'],
      order: [['isOnline', 'DESC'], ['name', 'ASC']],
    });

    // Fallback: if search/filter isn't active and excluding currentId returned empty array, return all employees
    let resultList = employees;
    if (resultList.length === 0 && currentId && !search && (!department || department === 'ALL')) {
      resultList = await Employee.findAll({
        attributes: ['id', 'name', 'email', 'role', 'designation', 'department', 'gender', 'avatar', 'isOnline', 'lastSeen', 'status'],
        order: [['isOnline', 'DESC'], ['name', 'ASC']],
      });
    }

    return res.json({
      success: true,
      employees: resultList,
      data: resultList,
      users: resultList,
      result: resultList
    });
  } catch (error) {
    console.error('Error in getEmployees (chat):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 2. Active Conversations List
exports.getConversations = async (req, res) => {
  try {
    const rawId = req.query.employeeId || req.query.currentUserId || req.user?.id;
    if (!rawId) {
      const allChats = await Chat.findAll({ limit: 20 });
      return res.json({ success: true, conversations: allChats, data: allChats, chats: allChats });
    }

    const emp = await Employee.findOne({
      where: {
        [Op.or]: [
          { id: String(rawId) },
          { empCode: String(rawId) },
          { name: String(rawId) }
        ]
      }
    });

    const possibleIds = [String(rawId)];
    if (emp) {
      if (emp.id && !possibleIds.includes(String(emp.id))) possibleIds.push(String(emp.id));
      if (emp.empCode && !possibleIds.includes(String(emp.empCode))) possibleIds.push(String(emp.empCode));
    }

    const memberships = await ChatMember.findAll({
      where: { employeeId: { [Op.in]: possibleIds } },
      include: [{
        model: Chat,
        as: 'chat',
        include: [{
          model: ChatMember,
          as: 'members',
          include: [{
            model: Employee,
            as: 'employee',
            attributes: ['id', 'name', 'email', 'designation', 'department', 'gender', 'avatar', 'isOnline', 'lastSeen'],
          }],
        }],
      }],
      order: [[{ model: Chat, as: 'chat' }, 'lastMessageAt', 'DESC']],
    });

    const pinnedRecords = await PinnedChat.findAll({ where: { employeeId: { [Op.in]: possibleIds } } });
    const archivedRecords = await ArchivedChat.findAll({ where: { employeeId: { [Op.in]: possibleIds } } });
    const pinnedSet = new Set(pinnedRecords.map(p => p.chatId));
    const archivedSet = new Set(archivedRecords.map(a => a.chatId));

    const conversations = [];
    for (const mem of memberships) {
      if (!mem.chat) continue;
      const otherMember = mem.chat.members.find(m => !possibleIds.includes(String(m.employeeId))) || mem.chat.members[0];
      const otherEmployee = otherMember ? otherMember.employee : null;
      const unreadCount = await Message.count({
        where: {
          chatId: mem.chat.id,
          senderId: { [Op.notIn]: possibleIds },
          status: { [Op.ne]: 'READ' },
        },
      });

      conversations.push({
        chatId: mem.chat.id,
        id: mem.chat.id,
        type: mem.chat.type,
        title: mem.chat.title || (otherEmployee ? otherEmployee.name : 'Employee'),
        lastMessageText: mem.chat.lastMessageText || 'No messages yet',
        lastMessageAt: mem.chat.lastMessageAt,
        unreadCount,
        isPinned: pinnedSet.has(mem.chat.id),
        isArchived: archivedSet.has(mem.chat.id),
        otherUser: otherEmployee,
      });
    }

    return res.json({
      success: true,
      conversations,
      data: conversations,
      chats: conversations
    });
  } catch (error) {
    console.error('Error in getConversations (chat):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 3. Initiate or Get 1-on-1 Direct Chat
exports.getOrCreateDirectChat = async (req, res) => {
  try {
    const { currentUserId, targetEmployeeId } = req.body;
    const rawSender = currentUserId || req.user?.id;
    if (!rawSender || !targetEmployeeId) {
      return res.status(400).json({ success: false, error: 'Both senderId and targetEmployeeId are required' });
    }

    // Resolve sender and target employees
    const [senderEmp, targetEmp] = await Promise.all([
      Employee.findOne({ where: { [Op.or]: [{ id: String(rawSender) }, { empCode: String(rawSender) }] } }),
      Employee.findOne({ where: { [Op.or]: [{ id: String(targetEmployeeId) }, { empCode: String(targetEmployeeId) }] } })
    ]);

    const senderId = senderEmp ? String(senderEmp.id) : String(rawSender);
    const targetId = targetEmp ? String(targetEmp.id) : String(targetEmployeeId);

    const existingSenderMemberships = await ChatMember.findAll({
      where: { employeeId: { [Op.in]: [senderId, String(rawSender)] } },
      attributes: ['chatId'],
    });

    const senderChatIds = existingSenderMemberships.map(m => m.chatId);
    if (senderChatIds.length > 0) {
      const existingDirectMember = await ChatMember.findOne({
        where: {
          chatId: { [Op.in]: senderChatIds },
          employeeId: { [Op.in]: [targetId, String(targetEmployeeId)] },
        },
      });

      if (existingDirectMember) {
        const existingChat = await Chat.findByPk(existingDirectMember.chatId);
        const targetUser = await Employee.findByPk(targetId, {
          attributes: ['id', 'name', 'email', 'designation', 'department', 'gender', 'avatar', 'isOnline', 'lastSeen'],
        });

        return res.json({
          success: true,
          chatId: existingChat.id,
          id: existingChat.id,
          chat: existingChat,
          otherUser: targetUser,
          isNew: false,
        });
      }
    }

    const newChat = await Chat.create({
      type: 'DIRECT',
      lastMessageText: 'Chat initialized',
      lastMessageAt: new Date(),
    });

    await ChatMember.bulkCreate([
      { chatId: newChat.id, employeeId: String(senderId), role: 'MEMBER' },
      { chatId: newChat.id, employeeId: String(targetEmployeeId), role: 'MEMBER' },
    ]);

    const targetUser = await Employee.findByPk(targetEmployeeId, {
      attributes: ['id', 'name', 'email', 'designation', 'department', 'gender', 'avatar', 'isOnline', 'lastSeen'],
    });

    return res.json({
      success: true,
      chatId: newChat.id,
      id: newChat.id,
      chat: newChat,
      otherUser: targetUser,
      isNew: true,
    });
  } catch (error) {
    console.error('Error in getOrCreateDirectChat:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Message History Pagination
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const messages = await Message.findAll({
      where: { chatId },
      include: [
        { model: Attachment, as: 'attachments' },
        { model: Message, as: 'parentMessage', include: [{ model: Attachment, as: 'attachments' }] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    const reversed = messages.reverse();

    return res.json({
      success: true,
      messages: reversed,
      data: reversed
    });
  } catch (error) {
    console.error('Error in getMessages:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 5. Upload File Attachment
exports.uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const protocol = req.protocol;
    const host = req.get('host');
    const fileUrl = `${protocol}://${host}/static/uploads/chat/${req.file.filename}`;
    let fileType = 'PDF';
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) fileType = 'IMAGE';
    else if (['.xlsx', '.xls', '.csv'].includes(ext)) fileType = 'EXCEL';
    else if (['.doc', '.docx'].includes(ext)) fileType = 'WORD';
    else if (['.zip', '.rar', '.7z'].includes(ext)) fileType = 'ZIP';

    return res.json({
      success: true,
      attachment: {
        fileName: req.file.originalname,
        fileUrl,
        fileType,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
  } catch (error) {
    console.error('Error in uploadAttachment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 6. Delete Message
exports.deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    await Message.destroy({ where: { id } });
    return res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 7. Edit Message
exports.editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    await Message.update({ content }, { where: { id } });
    return res.json({ success: true, message: 'Message updated' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 8. Toggle Pin Chat
exports.togglePinChat = async (req, res) => {
  try {
    const { chatId, employeeId } = req.body;
    const currentEmpId = employeeId || req.user?.id;
    const existing = await PinnedChat.findOne({ where: { chatId, employeeId: String(currentEmpId) } });

    if (existing) {
      await existing.destroy();
      return res.json({ success: true, isPinned: false });
    } else {
      await PinnedChat.create({ chatId, employeeId: String(currentEmpId) });
      return res.json({ success: true, isPinned: true });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 9. Toggle Archive Chat
exports.toggleArchiveChat = async (req, res) => {
  try {
    const { chatId, employeeId } = req.body;
    const currentEmpId = employeeId || req.user?.id;
    const existing = await ArchivedChat.findOne({ where: { chatId, employeeId: String(currentEmpId) } });

    if (existing) {
      await existing.destroy();
      return res.json({ success: true, isArchived: false });
    } else {
      await ArchivedChat.create({ chatId, employeeId: String(currentEmpId) });
      return res.json({ success: true, isArchived: true });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
