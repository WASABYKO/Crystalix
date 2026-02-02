// src/server/app.js — СОЗДАНИЕ И НАСТРОЙКА Express-приложения
// Импортируется в src/server/index.js

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const Database = require('./database');
const { requestLogger } = require('./logger');

const app = express();

// Доверяем прокси для корректной работы rate limiting
app.set('trust proxy', 1);

// Логирование всех HTTP запросов
app.use(requestLogger);

// ────────────────────────────────────────────────
//  Безопасность заголовков (CSP, X-XSS и т.д.)
// ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/", "data:"],
      imgSrc: ["'self'", "data:", "https:", "http://localhost:3000"],
      connectSrc: ["'self'", "ws:", "wss:", "http://localhost:3000", "ws://localhost:3000"],
      frameAncestors: ["'none'"]
    }
  }
}));

// ────────────────────────────────────────────────
//  CORS — в dev разрешаем localhost, в проде — только доверенные домены
// ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://your-domain.com'])
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ────────────────────────────────────────────────
//  Rate limiting на все API-эндпоинты
// ────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 500, // 500 запросов с одного IP (увеличено для разработки)
  message: { success: false, message: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// ────────────────────────────────────────────────
//  Парсинг тела запросов (JSON + form-data)
// ────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ────────────────────────────────────────────────
//  Статические файлы — ТОЛЬКО из src/public
// ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../public'))); // ← от src/server/app.js → вверх в src → public

// ────────────────────────────────────────────────
//  Загрузка файлов (multer) — безопасные имена
// ────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Папка для аватарок
const avatarsDir = path.join(uploadDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

// История аватарок
const avatarsHistoryDir = path.join(avatarsDir, 'history');
if (!fs.existsSync(avatarsHistoryDir)) fs.mkdirSync(avatarsHistoryDir, { recursive: true });

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
//  JWT Middleware — проверка токена
// ────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Токен отсутствует' });
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Недействительный токен' });
    }
    req.user = decoded;
    next();
  });
};

// ────────────────────────────────────────────────
//  API-РОУТЫ (все твои эндпоинты)
// ────────────────────────────────────────────────

// Регистрация
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Все поля обязательны' });
  }

  const result = Database.createUser({ name, email, password });
  res.json(result);
});

// Логин
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  const user = Database.getUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
  }

  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET || 'default-dev-secret-change-in-production',
    { expiresIn: '1d' }
  );

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      avatar_color: user.avatar_color,
      tariff: user.tariff || 'free',
      role: user.role || 'user'
    }
  });
});

// Кто я (проверка токена)
app.get('/api/me', authMiddleware, (req, res) => {
  const user = Database.getUserById(req.user.userId);
  if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  res.json({ 
    success: true, 
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      avatar_color: user.avatar_color,
      tariff: user.tariff || 'free',
      role: user.role || 'user',
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    } 
  });
});

// Поиск пользователей
app.get('/api/users/search', authMiddleware, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ success: true, users: [] });
  const results = Database.searchUsers(q, req.user.userId);
  res.json({ success: true, users: results });
});

// Друзья
app.get('/api/friends', authMiddleware, (req, res) => {
  res.json({ success: true, friends: Database.getFriends(req.user.userId) });
});

app.get('/api/friends/status', authMiddleware, (req, res) => {
  const { user1, user2 } = req.query;
  const status = Database.getFriendshipStatus(user1, user2);
  res.json({ success: true, status });
});

app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { receiverId, message } = req.body;
  const result = Database.sendFriendRequest(req.user.userId, receiverId, message || '');
  
  res.json(result);
});

app.get('/api/friends/requests', authMiddleware, (req, res) => {
  const requests = Database.getFriendRequests(req.user.userId);
  res.json({ success: true, ...requests });
});

app.post('/api/friends/request/:id/respond', authMiddleware, (req, res) => {
  // Теперь дружба создаётся сразу при отправке заявки
  // Этот эндпоинт оставлен для обратной совместимости
  res.json({ success: true, message: 'Дружба уже создана' });
});

// Чаты
app.get('/api/chats', authMiddleware, (req, res) => {
  const chats = Database.getUserChats(req.user.userId);
  res.json({ success: true, chats });
});

app.post('/api/chats', authMiddleware, (req, res) => {
  const { participantId, type = 'private' } = req.body;
  if (!participantId) {
    return res.status(400).json({ success: false, message: ' participantId обязателен' });
  }
  const result = Database.createPrivateChat(req.user.userId, participantId);
  res.json(result);
});

app.post('/api/chats/private', authMiddleware, (req, res) => {
  const { friendId } = req.body;
  const result = Database.createPrivateChat(req.user.userId, friendId);
  res.json(result);
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const messages = Database.getChatMessages(req.params.chatId, Number(limit), Number(offset));
  res.json({ success: true, messages });
});

app.post('/api/chats/:chatId/messages', authMiddleware, async (req, res) => {
  const { content, type = 'text' } = req.body;
  const result = Database.addMessage(req.params.chatId, req.user.userId, content, type);
  
  if (!result.success) {
    return res.json(result);
  }
  
  // Если успешно - рассылаем сообщение через WebSocket всем участникам
  const sender = Database.getUserById(req.user.userId);
  const broadcastMsg = {
    type: 'message',
    messageId: result.messageId,
    chatId: req.params.chatId,
    senderId: req.user.userId,
    senderName: sender?.name || 'Unknown',
    senderAvatar: sender?.avatar || null,
    senderAvatarColor: sender?.avatar_color || null,
    content,
    messageType: type,
    createdAt: result.createdAt,
    timestamp: Date.now(),
    status: 'sent'
  };
  
  // Рассылаем всем участникам чата через WebSocket
  const { broadcastToParticipants } = require('./ws');
  const participants = Database.getChatParticipants(req.params.chatId);
  broadcastToParticipants(participants, broadcastMsg);
  
  res.json(result);
});

// Загрузка файлов
app.post('/api/files/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Файл не загружен' });
  const url = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    file: {
      url,
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype
    }
  });
});

// Статические файлы uploads
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads')));

// Обновление профиля пользователя
app.put('/api/profile', authMiddleware, (req, res) => {
  const { name, avatar } = req.body;
  const result = Database.updateUser(req.user.userId, { name, avatar });
  res.json(result);
});

// ────────────────────────────────────────────────
//  АВАТАРКИ ПОЛЬЗОВАТЕЛЕЙ
// ────────────────────────────────────────────────

// Валидация изображений для аватарок
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, avatarsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const userId = req.user?.userId || 'unknown';
      cb(null, `avatar_${userId}_${timestamp}_${random}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(file.mimetype) && allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый тип файла. Разрешены: JPG, PNG, GIF, WebP'));
    }
  }
});

// Загрузка/обновление аватарки
app.post('/api/profile/avatar', authMiddleware, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Файл не загружен' });
  }

  const user = Database.getUserById(req.user.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  }

  // Сохраняем старую аватарку в историю (если была)
  if (user.avatar?.original) {
    const oldAvatarPath = path.join(__dirname, '../../public', user.avatar.original);
    if (fs.existsSync(oldAvatarPath)) {
      const historyPath = path.join(avatarsHistoryDir, `${user.id}_${Date.now()}_old${path.extname(user.avatar.original)}`);
      try {
        fs.renameSync(oldAvatarPath, historyPath);
      } catch (err) {
        // Игнорируем ошибку
      }
    }
  }

  // Создаем структуру avatar
  const avatarData = {
    original: `/uploads/avatars/${req.file.filename}`,
    updatedAt: new Date().toISOString()
  };

  // Обновляем в БД
  const result = Database.updateUserAvatar(req.user.userId, avatarData);
  
  res.json({
    success: true,
    avatar: avatarData,
    message: 'Аватарка успешно загружена'
  });
});

// Получение аватарки пользователя
app.get('/api/profile/avatar/:userId', authMiddleware, (req, res) => {
  const user = Database.getUserById(req.params.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  }

  res.json({
    success: true,
    avatar: user.avatar || null
  });
});

// Удаление аватарки
app.delete('/api/profile/avatar', authMiddleware, (req, res) => {
  const user = Database.getUserById(req.user.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  }

  // Сохраняем старую в историю перед удалением
  if (user.avatar?.original) {
    const oldAvatarPath = path.join(__dirname, '../../public', user.avatar.original);
    if (fs.existsSync(oldAvatarPath)) {
      const historyPath = path.join(avatarsHistoryDir, `${user.id}_${Date.now()}_deleted${path.extname(user.avatar.original)}`);
      try {
        fs.renameSync(oldAvatarPath, historyPath);
      } catch (err) {
        // Игнорируем ошибку
      }
    }
  }

  const result = Database.updateUserAvatar(req.user.userId, null);
  
  res.json({
    success: true,
    message: 'Аватарка удалена, установлена默认ная заглушка'
  });
});

// ────────────────────────────────────────────────
//  Catch-all для фронтенда (SPA) — роутинг на нужные страницы
// ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

app.get(['/auth.html', '/login', '/register'], (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/auth.html'));
});

app.get(['/dashboard.html', '/dashboard'], (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

app.get(['/messages.html', '/messages', '/chat'], (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/messages.html'));
});

app.get(['/admin.html', '/admin'], (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin.html'));
});

app.get(['/tariffs.html', '/tariffs'], (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/tariffs.html'));
});

// Для всех остальных несуществующих путей — 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../../public/404.html'));
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
});

module.exports = app;
