const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

class Database {
  constructor() {
    this.dataPath = path.join(__dirname, 'data');
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
    return friendships
      .filter(f => f.status === 'accepted' && (f.user1 === userId || f.user2 === userId))
      .map(f => ({
        friendId: f.user1 === userId ? f.user2 : f.user1,
        since: f.acceptedAt
      }));
  }

  sendFriendRequest(senderId, receiverId, message = '') {
    const requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    if (requests.some(r => r.sender === senderId && r.receiver === receiverId)) {
      return { success: false, message: 'Заявка уже отправлена' };
    }

    const id = `req_${Date.now()}`;
    requests.push({
      id,
      sender: senderId,
      receiver: receiverId,
      message,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    fs.writeFileSync(this.requestsFile, JSON.stringify(requests, null, 2));
    return { success: true, requestId: id };
  }

  respondToFriendRequest(requestId, userId, response) {
    const requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    const reqIndex = requests.findIndex(r => r.id === requestId && r.receiver === userId);
    if (reqIndex === -1) return { success: false, message: 'Заявка не найдена' };

    if (response === 'accepted') {
      const friendships = this.getFriendships();
      friendships.push({
        user1: requests[reqIndex].sender,
        user2: userId,
        status: 'accepted',
        acceptedAt: new Date().toISOString()
      });
      this.saveFriendships(friendships);
    }

    requests.splice(reqIndex, 1);
    fs.writeFileSync(this.requestsFile, JSON.stringify(requests, null, 2));
    return { success: true };
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
    return chats.filter(c => c.participants.includes(userId));
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
    const message = {
      id,
      chatId,
      senderId,
      content,
      type,
      timestamp: Date.now(),
      status: 'sent'
    };

    messages.push(message);
    this.saveMessages(messages);

    // Обновляем lastActivity чата
    const chats = this.getChats();
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex !== -1) {
      chats[chatIndex].lastActivity = new Date().toISOString();
      this.saveChats(chats);
    }

    return { success: true, messageId: id };
  }

  getChatMessages(chatId, limit = 50, offset = 0) {
    const messages = this.getMessages().filter(m => m.chatId === chatId);
    return messages.slice(-limit - offset, -offset || undefined);
  }

  searchUsers(query, excludeId) {
    const users = this.getUsers();
    const q = query.toLowerCase();
    return users.filter(u => {
      // Исключаем текущего пользователя
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
}

module.exports = new Database();