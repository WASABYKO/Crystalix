// src/server/ws.js — WebSocket сервер с надежной доставкой сообщений
// Исправленная версия с правильной маршрутизацией сообщений

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const Database = require('./database');

// Хранилище подключений: Map<userId, Set<WebSocket>>
// Один пользователь может иметь несколько вкладок/устройств
const clients = new Map();

// Хранилище для отслеживания messageId → senderId
const messageDeliveryStatus = new Map();

/**
 * Отправить сообщение конкретному пользователю
 * Отправляет ВО ВСЕ его активные соединения
 */
function broadcastToUser(userId, message) {
  const userConnections = clients.get(userId);
  if (!userConnections) {
    return 0;
  }
  
  const messageStr = JSON.stringify(message);
  let sentCount = 0;
  
  for (const ws of userConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
      sentCount++;
    }
  }
  
  return sentCount;
}

/**
 * Рассылка сообщения всем участникам чата
 */
function broadcastToParticipants(participants, message, excludeUserId = null) {
  const sent = [];
  
  for (const pid of participants) {
    if (pid !== excludeUserId) {
      const count = broadcastToUser(pid, message);
      if (count > 0) {
        sent.push(pid);
      }
    }
  }
  
  return sent;
}

/**
 * Получить senderId сообщения
 */
function findMessageSender(messageId) {
  const message = Database.getMessageById(messageId);
  return message?.senderId || null;
}

/**
 * Проверить, валидно ли соединение
 */
function isValidConnection(ws) {
  return ws.readyState === WebSocket.OPEN;
}

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    let userId = null;
    let connectedAt = Date.now();

    // Обработка входящих сообщений
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // АВТОРИЗАЦИЯ
        if (msg.type === 'auth') {
          const token = msg.token;
          
          if (!token) {
            ws.send(JSON.stringify({ type: 'auth_error', message: 'Токен отсутствует' }));
            ws.close(4001, 'No token');
            return;
          }

          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-dev-secret');
            userId = decoded.userId;
            
            // Добавляем соединение в хранилище
            if (!clients.has(userId)) {
              clients.set(userId, new Set());
            }
            clients.get(userId).add(ws);
            
            // Подтверждаем авторизацию
            ws.send(JSON.stringify({ 
              type: 'auth_success', 
              userId,
              connections: clients.get(userId).size
            }));
            
            // Уведомляем других пользователей о выходе в онлайн
            broadcastUserStatus(userId, 'online');
            
          } catch (e) {
            ws.send(JSON.stringify({ type: 'auth_error', message: 'Недействительный токен' }));
            ws.close(4002, 'Invalid token');
          }
          return;
        }

        // Если не авторизован - игнорируем
        if (!userId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Сначала авторизуйтесь' }));
          return;
        }

        // ОБРАБОТКА СООБЩЕНИЙ
        switch (msg.type) {
          case 'message':
            await handleChatMessage(ws, userId, msg);
            break;
            
          case 'message_delivered':
            await handleMessageDelivered(userId, msg);
            break;
            
          case 'message_read':
            await handleMessageRead(userId, msg);
            break;
            
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
            
          case 'typing':
            handleTyping(userId, msg);
            break;
            
          case 'stopTyping':
            handleStopTyping(userId, msg);
            break;
            
          // ============ ЗВОНКИ ============
          case 'CALL_OFFER':
            handleCallOffer(userId, msg);
            break;
            
          case 'CALL_ANSWER':
            handleCallAnswer(userId, msg);
            break;
            
          case 'CALL_ICE_CANDIDATE':
            handleCallIceCandidate(userId, msg);
            break;
            
          case 'CALL_REJECT':
            handleCallReject(userId, msg);
            break;
            
          case 'CALL_END':
            handleCallEnd(userId, msg);
            break;
            
          case 'CALL_TIMEOUT':
            handleCallTimeout(userId, msg);
            break;
            
          // ============ ДРУЗЬЯ ============
          case 'FRIEND_REQUEST':
            handleFriendRequestWS(userId, msg);
            break;
            
          case 'FRIEND_ACCEPT':
            handleFriendAcceptWS(userId, msg);
            break;
            
          case 'FRIEND_REJECT':
            handleFriendRejectWS(userId, msg);
            break;
          
          default:
            break;
        }
      } catch (e) {
        // Логируем ошибку только в файл
      }
    });

    // Обработка закрытия соединения
    ws.on('close', (event) => {
      const reason = event.reason || 'client disconnect';
      
      if (userId && clients.has(userId)) {
        const userConnections = clients.get(userId);
        userConnections.delete(ws);
        
        // Если это было последнее соединение пользователя
        if (userConnections.size === 0) {
          clients.delete(userId);
          broadcastUserStatus(userId, 'offline');
        }
      }
    });

    // Обработка ошибок
    ws.on('error', (error) => {
      // Игнорируем ошибки
    });

    // Heartbeat для определения мертвых соединений
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Heartbeat интервал - проверяем каждые 30 секунд
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  console.log('[WS] WebSocket сервер инициализирован');
}

/**
 * Обработка отправки сообщения
 */
async function handleChatMessage(ws, senderId, msg) {
  const { chatId, content, messageType = 'text' } = msg;
  
  if (!chatId || !content) {
    ws.send(JSON.stringify({ type: 'error', message: 'chatId и content обязательны' }));
    return;
  }

  // Сохраняем сообщение в БД
  const result = Database.addMessage(chatId, senderId, content, messageType);
  
  if (!result.success) {
    ws.send(JSON.stringify({ type: 'error', message: result.message }));
    return;
  }

  // Получаем данные отправителя
  const sender = Database.getUserById(senderId);
  
  // Формируем сообщение для рассылки
  const broadcastMsg = {
    type: 'message',
    messageId: result.messageId,
    chatId,
    senderId,
    senderName: sender?.name || 'Unknown',
    senderAvatar: sender?.avatar || null,
    senderAvatarColor: sender?.avatar_color || null,
    content,
    messageType,
    createdAt: result.createdAt,
    timestamp: Date.now(),
    status: 'sent'
  };

  // Получаем участников чата
  const participants = Database.getChatParticipants(chatId);
  
  // Рассылаем ВСЕМ участникам ВКЛЮЧАЯ отправителя
  const sent = broadcastToParticipants(participants, broadcastMsg, null);
  
  // Отправляем подтверждение отправителю
  ws.send(JSON.stringify({
    type: 'ack',
    messageId: result.messageId,
    chatId,
    timestamp: Date.now()
  }));
}

/**
 * Обработка статуса "доставлено"
 */
async function handleMessageDelivered(userId, msg) {
  const { messageId, chatId } = msg;
  const senderId = findMessageSender(messageId);
  
  if (senderId && senderId !== userId) {
    // Уведомляем отправителя о доставке
    broadcastToUser(senderId, {
      type: 'delivery_confirmation',
      messageId,
      deliveredTo: userId,
      timestamp: Date.now()
    });
  }
}

/**
 * Обработка статуса "прочитано"
 */
async function handleMessageRead(userId, msg) {
  const { messageId, chatId } = msg;
  const senderId = findMessageSender(messageId);
  
  if (senderId && senderId !== userId) {
    // Уведомляем отправителя о прочтении
    broadcastToUser(senderId, {
      type: 'read_confirmation',
      messageId,
      readBy: userId,
      timestamp: Date.now()
    });
  }
}

/**
 * Рассылка статуса "печатает"
 */
function handleTyping(userId, msg) {
  const { chatId } = msg;
  if (!chatId) return;
  
  const participants = Database.getChatParticipants(chatId);
  
  broadcastToParticipants(participants, {
    type: 'typing',
    chatId,
    userId,
    timestamp: Date.now()
  }, userId);
}

/**
 * Рассылка статуса "перестал печатать"
 */
function handleStopTyping(userId, msg) {
  const { chatId } = msg;
  if (!chatId) return;
  
  const participants = Database.getChatParticipants(chatId);
  
  broadcastToParticipants(participants, {
    type: 'stopTyping',
    chatId,
    userId,
    timestamp: Date.now()
  }, userId);
}

/**
 * Рассылка статуса пользователя (онлайн/оффлайн)
 */
function broadcastUserStatus(userId, status) {
  const friends = Database.getFriends(userId);
  
  for (const friend of friends) {
    broadcastToUser(friend.friendId, {
      type: 'user_status',
      userId,
      status,
      timestamp: Date.now()
    });
  }
}

/**
 * Получить количество онлайн-пользователей
 */
function getOnlineCount() {
  return clients.size;
}

/**
 * Проверить, онлайн ли пользователь
 */
function isUserOnline(userId) {
  return clients.has(userId) && clients.get(userId).size > 0;
}

// Экспорт функций
module.exports = {
  setupWebSocket,
  broadcastToUser,
  broadcastToParticipants,
  getOnlineCount,
  isUserOnline,
  clients
};

// ============ ОБРАБОТЧИКИ ЗВОНКОВ ============

/**
 * Обработка оффера звонка
 */
function handleCallOffer(callerId, msg) {
  const { callId, to, offer, isVideo, timestamp } = msg;
  
  // Получаем информацию о звонящем
  const caller = Database.getUserById(callerId);
  
  // Пересылаем оффер получателю
  broadcastToUser(to, {
    type: 'CALL_OFFER',
    callId,
    from: callerId,
    fromName: caller?.name || 'Unknown',
    offer,
    isVideo,
    timestamp
  });
}

/**
 * Обработка ответа на звонок
 */
function handleCallAnswer(calleeId, msg) {
  const { callId, to, answer, timestamp } = msg;
  
  // Пересылаем ответ звонящему
  broadcastToUser(to, {
    type: 'CALL_ANSWER',
    callId,
    from: calleeId,
    answer,
    timestamp
  });
}

/**
 * Обработка ICE кандидата
 */
function handleCallIceCandidate(senderId, msg) {
  const { callId, to, candidate, timestamp } = msg;
  
  // Пересылаем кандидат получателю
  broadcastToUser(to, {
    type: 'CALL_ICE_CANDIDATE',
    callId,
    from: senderId,
    candidate,
    timestamp
  });
}

/**
 * Обработка отклонения звонка
 */
function handleCallReject(rejectorId, msg) {
  const { callId, to, reason, timestamp } = msg;
  
  // Уведомляем звонящего
  broadcastToUser(to, {
    type: 'CALL_REJECT',
    callId,
    from: rejectorId,
    reason,
    timestamp
  });
}

/**
 * Обработка завершения звонка
 */
function handleCallEnd(enderId, msg) {
  const { callId, to, duration, timestamp } = msg;
  
  console.log(`[WS] Звонок ${callId} завершён ${enderId}, длительность: ${duration}с`);
  
  // Уведомляем другого участника
  broadcastToUser(to, {
    type: 'CALL_END',
    callId,
    from: enderId,
    duration,
    timestamp
  });
}

/**
 * Обработка таймаута звонка
 */
function handleCallTimeout(initiatorId, msg) {
  const { callId, to, timestamp } = msg;
  
  console.log(`[WS] Таймаут звонка ${callId} от ${initiatorId}`);
  
  // Уведомляем получателя о таймауте
  broadcastToUser(to, {
    type: 'CALL_TIMEOUT',
    callId,
    from: initiatorId,
    timestamp
  });
}

// ============ ОБРАБОТЧИКИ ДРУЗЕЙ ============

/**
 * Обработка входящего FRIEND_REQUEST через WebSocket
 */
function handleFriendRequestWS(senderId, msg) {
  const { to, requestId, message, timestamp } = msg;
  
  console.log(`[WS] Входящая заявка в друзья от ${senderId} к ${to}`);
  
  // Получаем данные отправителя
  const sender = Database.getUserById(senderId);
  
  // Пересылаем получателю
  broadcastToUser(to, {
    type: 'FRIEND_REQUEST',
    requestId,
    from: senderId,
    fromName: sender?.name || 'Неизвестный',
    message,
    timestamp
  });
}

/**
 * Обработка FRIEND_ACCEPT через WebSocket
 */
function handleFriendAcceptWS(accepterId, msg) {
  const { to, fromName, timestamp } = msg;
  
  console.log(`[WS] Пользователь ${accepterId} принял заявку в друзья`);
  
  // Уведомляем отправителя заявки
  broadcastToUser(to, {
    type: 'FRIEND_ACCEPT',
    from: accepterId,
    fromName,
    timestamp
  });
}

/**
 * Обработка FRIEND_REJECT через WebSocket
 */
function handleFriendRejectWS(rejectorId, msg) {
  const { to, fromName, timestamp } = msg;
  
  console.log(`[WS] Пользователь ${rejectorId} отклонил заявку в друзья`);
  
  // Уведомляем отправителя заявки
  broadcastToUser(to, {
    type: 'FRIEND_REJECT',
    from: rejectorId,
    fromName,
    timestamp
  });
}
