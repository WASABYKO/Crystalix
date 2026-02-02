// server.js — безопасная версия (2025 год, production-ready)

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const Database = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('┌──────────────────────────────────────────────────────┐');
  console.error('│  ОШИБКА: JWT_SECRET отсутствует или слишком короткий  │');
  console.error('│  Укажи в .env: JWT_SECRET=очень_длинный_случайный_ключ │');
  console.error('└──────────────────────────────────────────────────────┘');
  process.exit(1);
}

// ────────────────────────────────────────────────
//  Middleware — безопасность
// ────────────────────────────────────────────────

// Helmet — базовая защита заголовков
app.use(helmet());

// CORS — в dev разрешаем localhost, в проде — только доверенные домены
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://your-domain.com']
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting — защита от brute-force и спама
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // лимит 100 запросов с одного IP
  message: { success: false, message: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', apiLimiter);

// Парсинг JSON и urlencoded
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы — ТОЛЬКО из public/
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// ────────────────────────────────────────────────
//  Multer — безопасная загрузка файлов
// ────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, `${randomName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt', '.mp4'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый тип файла'));
    }
  }
});

// ────────────────────────────────────────────────
//  WebSocket — безопасное подключение
// ────────────────────────────────────────────────
const clients = new Map(); // userId → ws

wss.on('connection', (ws, req) => {
  let userId = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Авторизация по токену (обязательна)
      if (msg.type === 'auth') {
        console.log('[WS] Получен запрос авторизации, токен:', msg.token ? msg.token.substring(0, 20) + '...' : 'null');
        try {
          const decoded = jwt.verify(msg.token, JWT_SECRET);
          userId = decoded.userId;
          clients.set(userId, ws);
          ws.send(JSON.stringify({ type: 'auth_success', userId }));
          console.log(`[WS] Пользователь ${userId} подключился`);
        } catch (e) {
          console.error('[WS] Ошибка верификации токена:', e.message);
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Недействительный токен' }));
          ws.close(1008, 'Invalid token');
        }
        return;
      }

      // Все остальные сообщения требуют авторизации
      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Требуется авторизация' }));
        return;
      }

      // Обработка сообщений (твой код)
      if (msg.type === 'message') {
        const { chatId, content, type = 'text' } = msg;
        const result = Database.addMessage(chatId, userId, content, type);
        if (!result.success) return;

        const sender = Database.getUserById(userId);
        const broadcastMsg = {
          type: 'message',
          messageId: result.messageId,
          chatId,
          senderId: userId,
          senderName: sender?.name || 'Unknown',
          senderAvatar: sender?.avatar_color,
          content,
          messageType: type,
          timestamp: Date.now(),
          status: 'delivered'
        };

        Database.getChatParticipants(chatId).forEach(pid => {
          const client = clients.get(pid);
          if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(broadcastMsg));
          }
        });
      }

      if (msg.type === 'typing') {
        if (!msg.chatId) return;
        Database.getChatParticipants(msg.chatId).forEach(pid => {
          if (pid !== userId) {
            const client = clients.get(pid);
            if (client?.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ ...msg, userId }));
            }
          }
        });
      }
    } catch (e) {
      console.error('[WS] Ошибка:', e.message);
    }
  });

  ws.on('close', () => {
    if (userId) {
      clients.delete(userId);
      console.log(`[WS] Пользователь ${userId} отключился`);
    }
  });
});

// ────────────────────────────────────────────────
//  JWT middleware
// ────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Токен отсутствует' });
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Недействительный токен' });
    }
    req.user = decoded;
    next();
  });
};

// ────────────────────────────────────────────────
//  API роуты (без изменений, но с auth)
// ────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Все поля обязательны' });
  }

  const result = Database.createUser({ name, email, password });
  res.json(result);
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = Database.getUserByEmail(email);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' }); // ← сократил до 1 дня

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_color: user.avatar_color,
      tariff: user.tariff || 'free',
      role: user.role || 'user'
    }
  });
});

// Остальные роуты
app.get('/api/me', authMiddleware, (req, res) => {
  const user = Database.getUserById(req.user.userId);
  if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  
  // Убираем пароль из ответа
  const { password_hash, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// ────────────────────────────────────────────────
//  API: Пользователи
// ────────────────────────────────────────────────

app.get('/api/users', authMiddleware, (req, res) => {
  const users = Database.getUsers().map(u => {
    const { password_hash, ...safeUser } = u;
    return safeUser;
  });
  res.json({ success: true, users });
});

app.get('/api/users/search', authMiddleware, (req, res) => {
  const query = req.query.q || '';
  if (query.length < 2) {
    return res.json({ success: true, users: [] });
  }
  
  const users = Database.searchUsers(query, req.user.userId).map(u => {
    const { password_hash, ...safeUser } = u;
    return safeUser;
  });
  res.json({ success: true, users });
});

app.get('/api/users/:id', authMiddleware, (req, res) => {
  const user = Database.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  
  const { password_hash, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.put('/api/profile', authMiddleware, (req, res) => {
  const { name, avatar_color } = req.body;
  const users = Database.getUsers();
  const userIndex = users.findIndex(u => u.id === req.user.userId);
  
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  }
  
  if (name) users[userIndex].name = name;
  if (avatar_color) users[userIndex].avatar_color = avatar_color;
  
  Database.saveUsers(users);
  
  const { password_hash, ...safeUser } = users[userIndex];
  res.json({ success: true, user: safeUser });
});

// ────────────────────────────────────────────────
//  API: Друзья
// ────────────────────────────────────────────────

app.get('/api/friends', authMiddleware, (req, res) => {
  const friends = Database.getFriends(req.user.userId);
  
  // Добавляем информацию о друзьях
  const friendsWithInfo = friends.map(f => {
    const friendUser = Database.getUserById(f.friendId);
    return {
      ...f,
      friend_id: f.friendId,
      friend_name: friendUser?.name || 'Unknown',
      email: friendUser?.email,
      avatar_color: friendUser?.avatar_color
    };
  });
  
  res.json({ success: true, friends: friendsWithInfo });
});

app.get('/api/friends/status', authMiddleware, (req, res) => {
  const { user1, user2 } = req.query;
  const friendships = Database.getFriendships();
  
  const friendship = friendships.find(f => 
    (f.user1 === user1 && f.user2 === user2) || 
    (f.user1 === user2 && f.user2 === user1)
  );
  
  res.json({ success: true, status: friendship?.status || 'none' });
});

app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { receiverId, message } = req.body;
  
  if (!receiverId) {
    return res.status(400).json({ success: false, message: 'ID получателя обязателен' });
  }
  
  if (receiverId === req.user.userId) {
    return res.status(400).json({ success: false, message: 'Нельзя отправить заявку самому себе' });
  }
  
  const result = Database.sendFriendRequest(req.user.userId, receiverId, message || '');
  res.json(result);
});

app.post('/api/friends/request/:requestId/respond', authMiddleware, (req, res) => {
  const { requestId } = req.params;
  const { response } = req.body;
  
  if (!['accepted', 'rejected'].includes(response)) {
    return res.status(400).json({ success: false, message: 'Неверный ответ' });
  }
  
  const result = Database.respondToFriendRequest(requestId, req.user.userId, response);
  res.json(result);
});

app.get('/api/friends/requests', authMiddleware, (req, res) => {
  const type = req.query.type || 'incoming';
  const requests = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'data', 'friend_requests.json'), 'utf8'));
  
  let filtered;
  if (type === 'incoming') {
    filtered = requests.filter(r => r.receiver === req.user.userId && r.status === 'pending');
  } else {
    filtered = requests.filter(r => r.sender === req.user.userId && r.status === 'pending');
  }
  
  // Добавляем информацию об отправителях/получателях
  const requestsWithInfo = filtered.map(r => {
    const otherUser = Database.getUserById(type === 'incoming' ? r.sender : r.receiver);
    return {
      ...r,
      user_name: otherUser?.name || 'Unknown',
      user_email: otherUser?.email,
      avatar_color: otherUser?.avatar_color
    };
  });
  
  res.json({ success: true, requests: requestsWithInfo });
});

app.delete('/api/friends/:friendId', authMiddleware, (req, res) => {
  const { friendId } = req.params;
  const friendships = Database.getFriendships();
  
  const index = friendships.findIndex(f => 
    (f.user1 === req.user.userId && f.user2 === friendId) ||
    (f.user1 === friendId && f.user2 === req.user.userId)
  );
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Дружба не найдена' });
  }
  
  friendships.splice(index, 1);
  Database.saveFriendships(friendships);
  
  res.json({ success: true, message: 'Друг удалён' });
});

// ────────────────────────────────────────────────
//  API: Чаты
// ────────────────────────────────────────────────

app.get('/api/chats', authMiddleware, (req, res) => {
  const chats = Database.getUserChats(req.user.userId);
  
  // Добавляем информацию о последнем сообщении и участниках
  const chatsWithInfo = chats.map(chat => {
    const messages = Database.getChatMessages(chat.id, 1);
    const lastMessage = messages[messages.length - 1];
    
    // Для приватных чатов получаем имя собеседника
    let chatName = chat.name;
    let avatarColor = '#00ccff';
    
    if (chat.type === 'private') {
      const otherUserId = chat.participants.find(p => p !== req.user.userId);
      const otherUser = Database.getUserById(otherUserId);
      chatName = otherUser?.name || 'Unknown';
      avatarColor = otherUser?.avatar_color || '#00ccff';
    }
    
    return {
      ...chat,
      name: chatName,
      avatarColor,
      lastMessage: lastMessage?.content || '',
      lastMessageTime: lastMessage?.timestamp || chat.lastActivity
    };
  });
  
  res.json({ success: true, chats: chatsWithInfo });
});

app.post('/api/chats', authMiddleware, (req, res) => {
  console.log('[API] POST /api/chats', { body: req.body, user: req.user });
  const { participantId, type = 'private' } = req.body;
  
  if (type === 'private') {
    if (!participantId) {
      console.log('[API] Ошибка: participantId отсутствует');
      return res.status(400).json({ success: false, message: 'ID участника обязателен' });
    }
    
    const result = Database.createPrivateChat(req.user.userId, participantId);
    console.log('[API] Результат создания чата:', result);
    res.json(result);
  } else {
    // Групповой чат
    const { name, participants } = req.body;
    const chats = Database.getChats();
    
    const chatId = `chat_${Date.now()}`;
    const chat = {
      id: chatId,
      type: 'group',
      name: name || 'Новая группа',
      participants: [req.user.userId, ...(participants || [])],
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      createdBy: req.user.userId
    };
    
    chats.push(chat);
    Database.saveChats(chats);
    
    res.json({ success: true, chatId });
  }
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const { chatId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  
  // Проверяем, что пользователь участник чата
  const participants = Database.getChatParticipants(chatId);
  if (!participants.includes(req.user.userId)) {
    return res.status(403).json({ success: false, message: 'Нет доступа к чату' });
  }
  
  const messages = Database.getChatMessages(chatId, limit, offset);
  
  // Добавляем информацию об отправителях
  const messagesWithInfo = messages.map(msg => {
    const sender = Database.getUserById(msg.senderId);
    return {
      ...msg,
      senderName: sender?.name || 'Unknown',
      senderAvatar: sender?.avatar_color
    };
  });
  
  res.json({ success: true, messages: messagesWithInfo });
});

app.post('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const { chatId } = req.params;
  const { content, type = 'text' } = req.body;
  
  if (!content) {
    return res.status(400).json({ success: false, message: 'Сообщение не может быть пустым' });
  }
  
  // Проверяем, что пользователь участник чата
  const participants = Database.getChatParticipants(chatId);
  if (!participants.includes(req.user.userId)) {
    return res.status(403).json({ success: false, message: 'Нет доступа к чату' });
  }
  
  const result = Database.addMessage(chatId, req.user.userId, content, type);
  res.json(result);
});

// ────────────────────────────────────────────────
//  API: Тарифы
// ────────────────────────────────────────────────

const tariffs = [
  {
    id: 'free',
    name: 'Бесплатный',
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: ['До 100 запросов в день', 'Базовая аналитика', 'Поддержка по email', '1 пользователь'],
    description: 'Для тестирования платформы'
  },
  {
    id: 'basic',
    name: 'Базовый',
    monthlyPrice: 990,
    yearlyPrice: 9500,
    popular: true,
    features: ['До 1000 запросов в день', 'Расширенная аналитика', 'Приоритетная поддержка', 'До 5 пользователей', 'API доступ'],
    description: 'Для небольших проектов'
  },
  {
    id: 'pro',
    name: 'Профессиональный',
    monthlyPrice: 2990,
    yearlyPrice: 28700,
    features: ['Неограниченные запросы', 'Продвинутая аналитика', '24/7 поддержка', 'До 20 пользователей', 'Полный API доступ', 'Индивидуальные интеграции'],
    description: 'Для бизнеса'
  }
];

app.get('/api/tariffs', (req, res) => {
  res.json({ success: true, tariffs });
});

app.post('/api/tariffs/subscribe', authMiddleware, (req, res) => {
  const { tariffId } = req.body;
  
  const tariff = tariffs.find(t => t.id === tariffId);
  if (!tariff) {
    return res.status(404).json({ success: false, message: 'Тариф не найден' });
  }
  
  const users = Database.getUsers();
  const userIndex = users.findIndex(u => u.id === req.user.userId);
  
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  }
  
  users[userIndex].tariff = tariffId;
  users[userIndex].tariff_updated_at = new Date().toISOString();
  Database.saveUsers(users);
  
  res.json({ success: true, message: `Тариф "${tariff.name}" успешно активирован` });
});

// ────────────────────────────────────────────────
//  API: Загрузка файлов
// ────────────────────────────────────────────────

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Файл не загружен' });
  }
  
  res.json({
    success: true,
    file: {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`
    }
  });
});

// Статика для загруженных файлов
app.use('/uploads', express.static(uploadDir));

// SPA fallback — все остальные GET запросы отдают index.html
app.get('*', (req, res, next) => {
  // Не перенаправляем API запросы
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 обработчик
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Ресурс не найден' });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
});

// Запуск
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
  console.log(`Статические файлы: ${publicPath}`);
});