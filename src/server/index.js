// src/server/index.js — ТОЧКА ВХОДА сервера
// Запускает Express + HTTP + WebSocket
// Запуск: node src/server/index.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Подключаем логгер ДО всего остального
require('./logger');

const http = require('http');
const app = require('./app'); // ← путь от index.js к app.js (в той же папке server/)
const { setupWebSocket } = require('./ws'); // ← путь от index.js к ws.js

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Подключаем WebSocket к HTTP-серверу
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`   Фронтенд: http://localhost:${PORT}/messages.html`);
  console.log(`   Окружение: ${process.env.NODE_ENV || 'development'}`);
});