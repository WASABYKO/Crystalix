const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

class Database {
  constructor() {
    this.dataPath = path.join(__dirname, '../data');
    if (!fs.existsSync(this.dataPath)) fs.mkdirSync(this.dataPath, { recursive: true });

    this.usersFile = path.join(this.dataPath, 'users.json');
    this.friendshipsFile = path.join(this.dataPath, 'friendships.json');
    this.chatsFile = path.join(this.dataPath, 'chats.json');
    this.messagesFile = path.join(this.dataPath, 'messages.json');
    this.requestsFile = path.join(this.dataPath, 'friend_requests.json');

    this.initFile(this.usersFile, []);
    this.initFile(this.friendshipsFile, []);
    this.initFile(this.chatsFile, []);
    this.initFile(this.messagesFile, []);
    this.initFile(this.requestsFile, []);

    console.log('📊 База данных инициализирована');
  }

  initFile(file, defaultValue) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
  }

  getUsers() { return JSON.parse(fs.readFileSync(this.usersFile, 'utf8')); }
  saveUsers(data) { fs.writeFileSync(this.usersFile, JSON.stringify(data, null, 2)); }

  getUserById(id) { return this.getUsers().find(u => u.id === id); }
  getUserByEmail(email) { return this.getUsers().find(u => u.email.toLowerCase() === email.toLowerCase()); }

  createUser({ name, email, password }) {
    const users = this.getUsers();
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      return { success: false, message: 'Email уже зарегистрирован' };
    }

    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const user = {
      id,
      name,
      email,
      password_hash: bcrypt.hashSync(password, 10),
      avatar_color: this.getRandomColor(),
      tariff: 'free',
      role: 'user',
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString()
    };

    users.push(user);
    this.saveUsers(users);
    return { success: true, userId: id };
  }

  // Друзья
  getFriendships() { return JSON.parse(fs.readFileSync(this.friendshipsFile, 'utf8')); }
  saveFriendships(data) { fs.writeFileSync(this.friendshipsFile, JSON.stringify(data, null, 2)); }

  getFriends(userId) {
    const friendships = this.getFriendships();
    const users = this.getUsers();
    
    return friendships
      .filter(f => f.status === 'accepted' && (f.user1 === userId || f.user2 === userId))
      .map(f => {
        const friendId = f.user1 === userId ? f.user2 : f.user1;
        const friend = users.find(u => u.id === friendId);
        return {
          id: f.id,                    // ID дружбы
          friendId: friendId,          // ID друга (используется клиентом)
          friendName: friend?.name || 'Неизвестный',
          friendEmail: friend?.email || '',
          friendAvatarColor: friend?.avatar_color || this.getRandomColor(),
          friendAvatar: friend?.avatar || null,
          since: f.acceptedAt
        };
      });
  }

  getFriendshipStatus(userId1, userId2) {
    const friendships = this.getFriendships();
    const requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    
    // Проверяем, есть ли принятая дружба
    const friendship = friendships.find(f => 
      f.status === 'accepted' &&
      ((f.user1 === userId1 && f.user2 === userId2) || (f.user1 === userId2 && f.user2 === userId1))
    );
    if (friendship) return 'accepted';
    
    // Проверяем, есть ли исходящая заявка
    const outgoingRequest = requests.find(r => r.sender === userId1 && r.receiver === userId2 && r.status === 'pending');
    if (outgoingRequest) return 'pending';
    
    // Проверяем, есть ли входящая заявка
    const incomingRequest = requests.find(r => r.sender === userId2 && r.receiver === userId1 && r.status === 'pending');
    if (incomingRequest) return 'incoming';
    
    return 'none';
  }

  sendFriendRequest(senderId, receiverId, message = '') {
    const requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    
    // Проверяем, уже ли есть дружба
    const friendships = this.getFriendships();
    const alreadyFriends = friendships.some(f => 
      f.status === 'accepted' &&
      ((f.user1 === senderId && f.user2 === receiverId) || (f.user1 === receiverId && f.user2 === senderId))
    );
    if (alreadyFriends) {
      return { success: false, message: 'Вы уже друзья' };
    }
    
    // Проверяем, есть ли уже заявка
    if (requests.some(r => r.sender === senderId && r.receiver === receiverId)) {
      return { success: false, message: 'Заявка уже отправлена' };
    }

    // ДВУСТОРОННЕЕ ДОБАВЛЕНИЕ В ДРУЗЬЯ (без подтверждения)
    // Сразу создаём дружбу без необходимости принятия заявки
    friendships.push({
      id: `friend_${Date.now()}`,
      user1: senderId,
      user2: receiverId,
      status: 'accepted',
      acceptedAt: new Date().toISOString()
    });
    this.saveFriendships(friendships);
    
    // Получаем данные о друге для возврата клиенту
    const friend = this.getUserById(receiverId);
    const friendData = {
      id: `friend_${Date.now()}`,
      friendId: receiverId,
      friendName: friend?.name || 'Неизвестный',
      friendEmail: friend?.email || '',
      friendAvatarColor: friend?.avatar_color || this.getRandomColor(),
      friendAvatar: friend?.avatar || null,
      since: new Date().toISOString()
    };
    
    return { success: true, friend: friendData, immediate: true };
  }

  respondToFriendRequest(requestId, userId, response) {
    const requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    const reqIndex = requests.findIndex(r => r.id === requestId && r.receiver === userId);
    if (reqIndex === -1) return { success: false, message: 'Заявка не найдена' };

    let friendData = null;
    
    if (response === 'accepted') {
      const friendships = this.getFriendships();
      const senderId = requests[reqIndex].sender;
      
      friendships.push({
        id: `friend_${Date.now()}`,
        user1: senderId,
        user2: userId,
        status: 'accepted',
        acceptedAt: new Date().toISOString()
      });
      this.saveFriendships(friendships);
      
      // Получаем данные о друге для возврата клиенту
      const friend = this.getUserById(senderId);
      friendData = {
        id: `friend_${Date.now()}`,
        friend_id: senderId,
        friend_name: friend?.name || 'Неизвестный',
        friend_email: friend?.email || '',
        friend_avatarColor: friend?.avatar_color || this.getRandomColor(),
        friend_avatar: friend?.avatar || null,
        created_at: new Date().toISOString()
      };
    }

    requests.splice(reqIndex, 1);
    fs.writeFileSync(this.requestsFile, JSON.stringify(requests, null, 2));
    
    return { 
      success: true, 
      friend: friendData 
    };
  }

  getFriendRequests(userId) {
    const requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    const incoming = requests
      .filter(r => r.receiver === userId && r.status === 'pending')
      .map(r => ({
        id: r.id,
        fromUserId: r.sender,
        fromUserName: this.getUserById(r.sender)?.name || 'Неизвестный',
        message: r.message,
        createdAt: r.createdAt,
        status: r.status
      }));
    
    const outgoing = requests
      .filter(r => r.sender === userId && r.status === 'pending')
      .map(r => ({
        id: r.id,
        toUserId: r.receiver,
        toUserName: this.getUserById(r.receiver)?.name || 'Неизвестный',
        message: r.message,
        createdAt: r.createdAt,
        status: r.status
      }));
    
    return { incoming, outgoing };
  }

  // Чаты
  getChats() { return JSON.parse(fs.readFileSync(this.chatsFile, 'utf8')); }
  saveChats(data) { fs.writeFileSync(this.chatsFile, JSON.stringify(data, null, 2)); }

  createPrivateChat(user1, user2) {
    const chats = this.getChats();
    const existing = chats.find(c => c.type === 'private' && c.participants.includes(user1) && c.participants.includes(user2));
    if (existing) return { success: true, chatId: existing.id };

    const id = `chat_${Date.now()}`;
    const chat = {
      id,
      type: 'private',
      participants: [user1, user2],
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    chats.push(chat);
    this.saveChats(chats);
    return { success: true, chatId: id };
  }

  getUserChats(userId) {
    const chats = this.getChats();
    const users = this.getUsers();
    const messages = this.getMessages();
    
    return chats.filter(c => c.participants.includes(userId)).map(chat => {
      // Находим другого участника чата
      const otherUserId = chat.participants.find(p => p !== userId);
      const otherUser = users.find(u => u.id === otherUserId);
      
      // Получаем последнее сообщение
      const chatMessages = messages.filter(m => m.chatId === chat.id);
      const lastMessage = chatMessages.length > 0 
        ? chatMessages[chatMessages.length - 1] 
        : null;
      
      return {
        ...chat,
        participantId: otherUserId,  // Добавляем participantId для совместимости с клиентом
        name: otherUser?.name || 'Неизвестный',
        avatar: otherUser?.avatar || null,
        avatarColor: otherUser?.avatar_color || this.getRandomColor(),
        lastMessage: lastMessage?.content || 'Нет сообщений',
        lastMessageTime: lastMessage?.createdAt || chat.createdAt,
        unreadCount: 0
      };
    });
  }

  getChatParticipants(chatId) {
    const chats = this.getChats();
    const chat = chats.find(c => c.id === chatId);
    return chat ? chat.participants : [];
  }

  // Сообщения
  getMessages() { return JSON.parse(fs.readFileSync(this.messagesFile, 'utf8')); }
  saveMessages(data) { fs.writeFileSync(this.messagesFile, JSON.stringify(data, null, 2)); }

  addMessage(chatId, senderId, content, type = 'text') {
    const messages = this.getMessages();
    const id = `msg_${Date.now()}`;
    const timestamp = new Date().toISOString();
    const message = {
      id,
      chatId,
      senderId,
      content,
      type,
      timestamp,
      createdAt: timestamp,
      status: 'sent'
    };

    messages.push(message);
    this.saveMessages(messages);

    // Обновляем lastActivity чата
    const chats = this.getChats();
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex !== -1) {
      chats[chatIndex].lastActivity = timestamp;
      this.saveChats(chats);
    }

    return { success: true, messageId: id, createdAt: timestamp };
  }

  getChatMessages(chatId, limit = 50, offset = 0) {
    const messages = this.getMessages()
      .filter(m => m.chatId === chatId)
      .sort((a, b) => new Date(a.createdAt || a.timestamp) - new Date(b.createdAt || b.timestamp));
    
    const users = this.getUsers();
    
    // Исправлено: правильное пагинирование с offset и limit
    return messages.slice(offset, offset + limit).map(message => {
      const sender = users.find(u => u.id === message.senderId);
      return {
        ...message,
        senderName: sender?.name || 'Неизвестный',
        senderAvatar: sender?.avatar || null,
        senderAvatarColor: sender?.avatar_color || this.getRandomColor()
      };
    });
  }

  getMessageById(messageId) {
    const messages = this.getMessages();
    const message = messages.find(m => m.id === messageId);
    if (!message) return null;
    
    const users = this.getUsers();
    const sender = users.find(u => u.id === message.senderId);
    
    return {
      ...message,
      senderName: sender?.name || 'Неизвестный',
      senderAvatar: sender?.avatar || null,
      senderAvatarColor: sender?.avatar_color || this.getRandomColor()
    };
  }

  searchUsers(query, excludeId) {
    const users = this.getUsers();
    const q = query.toLowerCase();
    return users.filter(u => {
      if (u.id === excludeId) return false;
      // Ищем по id, имени или email
      return u.id.toLowerCase().includes(q) || 
             u.name.toLowerCase().includes(q) || 
             u.email.toLowerCase().includes(q);
    }).slice(0, 20);
  }

  getRandomColor() {
    const colors = ['#00ccff', '#00ffaa', '#ff6b6b', '#ffa502', '#7bed9f'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  updateUserAvatar(userId, avatarData) {
    const users = this.getUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return { success: false, message: 'Пользователь не найден' };
    
    users[userIndex].avatar = avatarData; // Может быть null (удаление) или объект { original, updatedAt }
    this.saveUsers(users);
    return { success: true, avatar: avatarData };
  }

  updateUser(userId, updates) {
    const users = this.getUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return { success: false, message: 'Пользователь не найден' };
    
    // Разрешаем обновлять только определённые поля
    const allowedFields = ['name', 'avatar'];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        users[userIndex][field] = updates[field];
      }
    });
    
    this.saveUsers(users);
    return { success: true, user: users[userIndex] };
  }
}

module.exports = new Database();
