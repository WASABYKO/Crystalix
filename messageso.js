/**
 * ==========================================
 * MESSENGER APPLICATION - Исправленная версия
 * Полнофункциональный мессенджер с серверным API
 * ==========================================
 */

// Единый WebSocket менеджер - использует глобальный или создает свой
let wsManager = null;

function getWebSocketManager() {
  if (wsManager) return wsManager;
  
  wsManager = {
    ws: null,
    wsToken: null,
    isAuthorized: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    listeners: new Map(),
    isConnected: false,
    isConnecting: false,
    
    // Подключение к WebSocket
    connect() {
      const token = getAuthToken();
      if (!token) {
        console.log('[WS] Токен не найден, отложено подключение');
        this.updateConnectionStatus('waiting', 'Ожидание авторизации...');
        return;
      }
      
      this.updateConnectionStatus('connecting', 'Подключение...');
      
      // Определяем URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      const wsUrl = `${protocol}//${host}:${port}/ws`;
      
      console.log('[WS] Подключение к:', wsUrl);
      
      try {
        this.ws = new WebSocket(`${wsUrl}?token=${token}`);
        this.wsToken = token; // Сохраняем токен для авторизации
        
        this.ws.onopen = () => {
          console.log('[WS] Подключено, отправляем авторизацию...');
          this.reconnectAttempts = 0;
          this.isConnected = true;
          this.isConnecting = false;
          this.updateConnectionStatus('connected', 'Подключено');
          // Отправляем сообщение авторизации
          this.ws.send(JSON.stringify({ type: 'auth', token: this.wsToken }));
          this.emit('connected', {});
        };
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[WS] Получено:', data.type, data);
            this.handleMessage(data);
          } catch (e) {
            console.error('[WS] Ошибка парсинга:', e);
          }
        };
        
        this.ws.onclose = (event) => {
          console.log('[WS] Отключено:', event.code, event.reason);
          this.isConnected = false;
          this.isAuthorized = false;
          this.isConnecting = false;
          
          if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          } else {
            this.updateConnectionStatus('disconnected', 'Отключено');
          }
          
          this.emit('disconnected', {});
        };
        
        this.ws.onerror = (error) => {
          console.error('[WS] Ошибка:', error);
          this.updateConnectionStatus('error', 'Ошибка соединения');
          this.emit('error', {});
        };
        
      } catch (error) {
        console.error('[WS] Не удалось подключиться:', error);
        this.updateConnectionStatus('error', 'Ошибка подключения');
      }
    },
    
    // Переподключение
    attemptReconnect() {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
      
      console.log(`[WS] Переподключение через ${delay}мс (попытка ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.updateConnectionStatus('reconnecting', `Переподключение ${this.reconnectAttempts}...`);
      
      setTimeout(() => {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.connect();
        } else {
          console.log('[WS] Максимальное количество попыток подключения');
          this.updateConnectionStatus('failed', 'Не удалось подключиться');
        }
      }, delay);
    },
    
    // Обновление статуса соединения
    updateConnectionStatus(status, text) {
      const connectionDot = document.getElementById('connectionDot');
      const connectionStatus = document.getElementById('connectionStatus');
      
      if (connectionStatus) {
        connectionStatus.textContent = text;
      }
      
      if (connectionDot) {
        connectionDot.className = 'dot ' + status;
      }
      
      const rightPanelStatus = document.getElementById('rightPanelStatus');
      if (rightPanelStatus) {
        rightPanelStatus.innerHTML = `<span class="dot ${status}"></span><span>${text}</span>`;
      }
    },
    
    // Обработка входящих сообщений
    handleMessage(data) {
      const { type } = data;
      
      switch (type) {
        case 'message':
          window.dispatchEvent(new CustomEvent('newMessage', { detail: data }));
          break;
        case 'ack':
          console.log('[WS] Подтверждение доставки:', data.messageId);
          window.dispatchEvent(new CustomEvent('messageAck', { detail: data }));
          break;
        case 'typing':
          window.dispatchEvent(new CustomEvent('userTyping', { detail: data }));
          break;
        case 'stopTyping':
          window.dispatchEvent(new CustomEvent('userStopTyping', { detail: data }));
          break;
        case 'messageRead':
        case 'read_confirmation':
          window.dispatchEvent(new CustomEvent('messageRead', { detail: data }));
          break;
        case 'delivery_confirmation':
          window.dispatchEvent(new CustomEvent('messageDelivered', { detail: data }));
          break;
        case 'auth_success':
          console.log('[WS] Авторизация успешна, userId:', data.userId);
          this.isAuthorized = true;
          this.updateConnectionStatus('authorized', 'Авторизован');
          break;
        case 'auth_error':
          console.error('[WS] Ошибка авторизации:', data.message);
          this.isAuthorized = false;
          this.updateConnectionStatus('error', 'Ошибка авторизации');
          break;
        case 'user_status':
          window.dispatchEvent(new CustomEvent('userStatus', { detail: data }));
          break;
        case 'pong':
          // Ответ на ping
          break;
        case 'error':
          console.error('[WS] Ошибка сервера:', data.message);
          break;
        default:
          console.log('[WS] Неизвестный тип:', type);
      }
      
      // Уведомляем подписчиков
      if (this.listeners.has(type)) {
        this.listeners.get(type).forEach(callback => callback(data));
      }
      if (this.listeners.has('*')) {
        this.listeners.get('*').forEach(callback => callback(data));
      }
    },
    
    // Отправка сообщения
    send(data) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
        return true;
      }
      console.warn('[WS] Не подключен, невозможно отправить');
      return false;
    },
    
    // Подписка на события
    on(type, callback) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(callback);
    },
    
    // Отписка от событий
    off(type, callback) {
      if (this.listeners.has(type)) {
        const callbacks = this.listeners.get(type);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    },
    
    // Уведомление подписчиков
    emit(type, data) {
      if (this.listeners.has(type)) {
        this.listeners.get(type).forEach(callback => callback(data));
      }
    },
    
    // Отключение
    disconnect() {
      if (this.ws) {
        this.ws.close(1000, 'Пользователь отключился');
        this.ws = null;
      }
      this.isConnected = false;
    }
  };
  
  return wsManager;
}

// ============ КОНФИГУРАЦИЯ ============
const MESSENGER_CONFIG = {
  APP_NAME: 'TechTariff Messenger',
  VERSION: '2.1.0',
  API_BASE: '/api',
  MESSAGES_PER_PAGE: 50,
  TYPING_TIMEOUT: 3000,
  AUTO_SCROLL_THRESHOLD: 100,
  MESSAGE_STATUS: {
    SENDING: 'sending',
    SENT: 'sent',
    DELIVERED: 'delivered',
    READ: 'read',
    FAILED: 'failed'
  }
};

// ============ HELPER ФУНКЦИИ ============

/**
 * Форматирование timestamp
 */
const formatTime = (timestamp, format = 'short') => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (format === 'full') {
    return date.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  if (isToday) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Экранирование HTML
 */
const escapeHtml = (text) => {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Получение токена
 */
const getAuthToken = () => {
  if (window.TokenManager) {
    return TokenManager.getToken();
  }
  return localStorage.getItem('auth_token') || localStorage.getItem('techtariff_auth_token');
};

/**
 * API запрос с авторизацией
 */
const apiRequest = async (endpoint, options = {}) => {
  const token = getAuthToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };
  
  try {
    const response = await fetch(`${MESSENGER_CONFIG.API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Ошибка запроса');
    }
    
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};

// ============ API СЕРВИСЫ ============

const UserService = {
  async getCurrent() {
    return apiRequest('/me');
  },
  
  async getFriends() {
    return apiRequest('/friends');
  },
  
  async searchUsers(query) {
    return apiRequest(`/users/search?q=${encodeURIComponent(query)}`);
  },
  
  async sendFriendRequest(receiverId, message = '') {
    return apiRequest('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ receiverId, message })
    });
  },
  
  async getFriendRequests() {
    return apiRequest('/friends/requests');
  },
  
  async respondToRequest(requestId, response) {
    return apiRequest(`/friends/request/${requestId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ response })
    });
  }
};

const ChatService = {
  async getChats() {
    return apiRequest('/chats');
  },
  
  async createChat(participantId) {
    return apiRequest('/chats', {
      method: 'POST',
      body: JSON.stringify({ participantId })
    });
  },
  
  async createPrivateChat(friendId) {
    return apiRequest('/chats/private', {
      method: 'POST',
      body: JSON.stringify({ friendId })
    });
  },
  
  async getMessages(chatId, limit = 50, offset = 0) {
    return apiRequest(`/chats/${chatId}/messages?limit=${limit}&offset=${offset}`);
  },
  
  async sendMessage(chatId, content, type = 'text') {
    return apiRequest(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, type })
    });
  }
};

// ============ UI MANAGER ============

class UIManager {
  constructor() {
    this.wsManager = getWebSocketManager();
    this.activeChatId = null;
    this.typingTimeout = null;
    this.currentUser = null;
    this.friends = [];
    this.chats = [];
    this.messages = {};
    
    this.init();
  }
  
  async init() {
    await this.loadUserData();
    this.bindEvents();
    this.renderFriendsList();
  }
  
  async loadUserData() {
    try {
      // Загружаем текущего пользователя
      const userData = await UserService.getCurrent();
      if (userData.success) {
        this.currentUser = userData.user;
      }
      
      // Загружаем друзей
      const friendsData = await UserService.getFriends();
      if (friendsData.success) {
        this.friends = friendsData.friends || [];
      }
      
      // Загружаем чаты
      const chatsData = await ChatService.getChats();
      if (chatsData.success) {
        this.chats = chatsData.chats || [];
        this.chats.forEach(chat => {
          this.messages[chat.id] = [];
        });
      }
      
      console.log('[UIManager] Данные загружены:', {
        user: this.currentUser?.name,
        friendsCount: this.friends.length,
        chatsCount: this.chats.length
      });
      
    } catch (error) {
      console.error('Ошибка загрузки данных:', error);
      this.showToast('Ошибка загрузки данных', 'error');
    }
  }
  
  bindEvents() {
    // Поиск чатов
    const chatSearch = document.getElementById('chatSearch');
    if (chatSearch) {
      chatSearch.addEventListener('input', (e) => {
        this.filterChats(e.target.value);
      });
    }
    
    // Ввод сообщения
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      
      messageInput.addEventListener('input', () => {
        this.handleTyping();
      });
    }
    
    // Кнопка отправки
    const sendBtn = document.getElementById('sendMessageBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendMessage());
    }
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchTab(e.target.closest('.tab-btn'));
      });
    });
    
    // New chat button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
      newChatBtn.addEventListener('click', () => {
        this.openModal('newChatModal');
        this.populateFriendSelect();
      });
    }
    
    // Search users button
    const searchUsersBtn = document.getElementById('searchUsersBtn');
    if (searchUsersBtn) {
      searchUsersBtn.addEventListener('click', () => {
        this.openModal('searchUsersModal');
      });
    }
    
    // Start chat button
    const startChatBtn = document.getElementById('startChatBtn');
    if (startChatBtn) {
      startChatBtn.addEventListener('click', async () => {
        const friendSelect = document.getElementById('friendSelect');
        const friendId = friendSelect?.value;
        if (friendId) {
          await this.startChatWithFriend(friendId);
        }
      });
    }
    
    // Search users in modal
    const userSearchInput = document.getElementById('userSearchInput');
    if (userSearchInput) {
      userSearchInput.addEventListener('input', (e) => {
        this.searchUsers(e.target.value);
      });
    }
    
    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });
    
    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        this.closeAllModals();
      });
    });
    
    // Modal overlay click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeAllModals();
        }
      });
    });
    
    // WebSocket events
    window.addEventListener('newMessage', (e) => {
      this.handleNewMessage(e.detail);
    });
    
    window.addEventListener('messageAck', (e) => {
      this.handleMessageAck(e.detail);
    });
    
    window.addEventListener('userTyping', (e) => {
      this.handleUserTyping(e.detail);
    });
    
    window.addEventListener('userStopTyping', (e) => {
      this.handleUserStopTyping(e.detail);
    });
    
    console.log('[UIManager] События привязаны');
  }
  
  renderFriendsList(filter = '') {
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) return;
    
    let friends = this.friends;
    
    if (filter) {
      const q = filter.toLowerCase();
      friends = friends.filter(f => 
        f.friendName?.toLowerCase().includes(q) ||
        f.friendEmail?.toLowerCase().includes(q)
      );
    }
    
    if (friends.length === 0) {
      friendsList.innerHTML = `
        <div class="empty-state-small">
          <i class="fas fa-user-friends"></i>
          <p>${filter ? 'Друзья не найдены' : 'У вас пока нет друзей'}</p>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('searchUsersBtn').click()">
            <i class="fas fa-search"></i> Найти друзей
          </button>
        </div>
      `;
      return;
    }
    
    friendsList.innerHTML = friends.map(friend => {
      const initials = this.getInitials(friend.friendName);
      const avatarGradient = this.getAvatarGradient(friend.friendId);
      const avatarUrl = friend.friendAvatar?.original || friend.friendAvatar;
      
      return `
        <div class="friend-item" data-user-id="${friend.friendId}" role="listitem" tabindex="0">
          <div class="chat-avatar ${avatarGradient}" style="width: 44px; height: 44px; font-size: 14px;">
            ${avatarUrl 
              ? `<img src="${avatarUrl}" alt="${friend.friendName}">`
              : `<span class="avatar-initials">${initials}</span>`
            }
          </div>
          <div class="chat-info">
            <div class="chat-name">${escapeHtml(friend.friendName)}</div>
            <div class="user-email">${escapeHtml(friend.friendEmail)}</div>
          </div>
          <div class="user-actions">
            <button class="btn btn-sm btn-primary" onclick="openChatWithFriend('${friend.friendId}')">
              <i class="fas fa-comment"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
  
  renderChatsList(filter = '') {
    const chatsList = document.getElementById('chatsList');
    if (!chatsList) return;
    
    let chats = this.chats;
    
    if (filter) {
      const q = filter.toLowerCase();
      chats = chats.filter(chat => {
        const friend = this.friends.find(f => f.id === chat.participantId || f.friendId === chat.participantId);
        return friend && friend.friendName?.toLowerCase().includes(q);
      });
    }
    
    if (chats.length === 0) {
      chatsList.innerHTML = `
        <div class="empty-state-small">
          <i class="fas fa-comments"></i>
          <p>${filter ? 'Чаты не найдены' : 'У вас пока нет чатов'}</p>
          <button class="btn btn-primary" onclick="document.getElementById('newChatBtn').click()">
            <i class="fas fa-plus"></i> Начать чат
          </button>
        </div>
      `;
      return;
    }
    
    chatsList.innerHTML = chats.map(chat => {
      const friend = this.friends.find(f => f.id === chat.participantId || f.friendId === chat.participantId);
      if (!friend) return '';
      
      const lastMessage = chat.lastMessage || {};
      const initials = this.getInitials(friend.friendName || chat.name);
      const avatarGradient = this.getAvatarGradient(friend.friendId || chat.participantId);
      const avatarUrl = (friend.friendAvatar?.original || friend.friendAvatar || chat.avatar?.original || chat.avatar);
      const isActive = chat.id === this.activeChatId;
      
      return `
        <div class="chat-item ${isActive ? 'active' : ''}" 
             data-chat-id="${chat.id}" 
             role="listitem" 
             tabindex="0"
             aria-selected="${isActive}">
          <div class="chat-avatar ${avatarGradient}">
            ${avatarUrl
              ? `<img src="${avatarUrl}" alt="${friend.friendName || chat.name}">`
              : `<span class="avatar-initials">${initials}</span>`
            }
          </div>
          <div class="chat-info">
            <div class="chat-name">${escapeHtml(friend.friendName || chat.name)}</div>
            <div class="chat-preview">${escapeHtml(lastMessage?.content || 'Нет сообщений')}</div>
          </div>
          <div class="chat-meta">
            ${lastMessage?.createdAt ? `<div class="chat-time">${formatTime(lastMessage.createdAt)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    // Re-bind click events
    document.querySelectorAll('#chatsList .chat-item').forEach(item => {
      item.addEventListener('click', () => {
        const chatId = item.dataset.chatId;
        if (chatId) this.openChat(chatId);
      });
    });
  }
  
  filterChats(query) {
    this.renderChatsList(query);
  }
  
  async openChat(chatId) {
    this.activeChatId = chatId;
    const chat = this.chats.find(c => c.id === chatId);
    const friend = this.friends.find(f => f.id === chat?.participantId || f.friendId === chat?.participantId);
    
    if (!friend && !chat) {
      console.warn('[openChat] Чат не найден');
      return;
    }
    
    // Обновляем UI чата
    const chatTitle = document.getElementById('chatTitle');
    const chatAvatar = document.getElementById('chatAvatar');
    
    const displayName = friend?.friendName || chat?.name || 'Unknown';
    const displayAvatar = friend?.friendAvatar?.original || friend?.friendAvatar || chat?.avatar?.original || chat?.avatar;
    const avatarId = friend?.friendId || chat?.participantId || chatId;
    
    if (chatTitle) chatTitle.textContent = displayName;
    
    if (chatAvatar) {
      chatAvatar.innerHTML = displayAvatar 
        ? `<img src="${displayAvatar}" alt="${displayName}">`
        : `<span class="avatar-initials">${this.getInitials(displayName)}</span>`;
      chatAvatar.className = `chat-avatar ${this.getAvatarGradient(avatarId)}`;
    }
    
    // Включаем кнопки
    const videoCallBtn = document.getElementById('videoCallBtn');
    const voiceCallBtn = document.getElementById('voiceCallBtn');
    const chatInfoBtn = document.getElementById('chatInfoBtn');
    if (videoCallBtn) videoCallBtn.disabled = false;
    if (voiceCallBtn) voiceCallBtn.disabled = false;
    if (chatInfoBtn) chatInfoBtn.disabled = false;
    
    // Обновляем правую панель
    this.updateRightPanel({ 
      id: avatarId,
      name: displayName,
      avatar: displayAvatar 
    });
    
    // Загружаем сообщения
    await this.loadMessages(chatId);
    
    // Активируем чат в списке
    document.querySelectorAll('.chat-item').forEach(item => {
      item.classList.toggle('active', item.dataset.chatId === chatId);
      item.setAttribute('aria-selected', item.dataset.chatId === chatId);
    });
    
    // Скрываем empty state, показываем messages
    const emptyState = document.getElementById('emptyState');
    const messagesList = document.getElementById('messagesList');
    if (emptyState) emptyState.style.display = 'none';
    if (messagesList) messagesList.style.display = 'flex';
    
    // Фокус на поле ввода
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
      messageInput.disabled = false;
      messageInput.focus();
    }
    
    const sendBtn = document.getElementById('sendMessageBtn');
    if (sendBtn) sendBtn.disabled = false;
    
    this.scrollToBottom();
  }
  
  async loadMessages(chatId) {
    const messagesList = document.getElementById('messagesList');
    if (!messagesList) return;
    
    // Пытаемся загрузить из localStorage
    const cachedMessages = this.loadMessagesFromLocalStorage(chatId);
    if (cachedMessages && cachedMessages.length > 0) {
      this.messages[chatId] = cachedMessages;
      this.renderMessages(chatId);
      console.log(`[loadMessages] Загружено из кэша: ${cachedMessages.length} сообщений`);
    }
    
    try {
      // Загружаем с сервера
      const data = await ChatService.getMessages(chatId);
      
      if (data.success && data.messages && data.messages.length > 0) {
        this.messages[chatId] = data.messages;
        this.saveMessagesToLocalStorage(chatId);
        this.renderMessages(chatId);
        console.log(`[loadMessages] Загружено с сервера: ${data.messages.length} сообщений`);
      } else if (!cachedMessages) {
        this.messages[chatId] = [];
        this.renderMessages(chatId);
      }
    } catch (error) {
      console.error('Ошибка загрузки сообщений:', error);
      if (!cachedMessages) {
        this.messages[chatId] = [];
        this.renderMessages(chatId);
      }
    }
  }
  
  renderMessages(chatId) {
    const messagesList = document.getElementById('messagesList');
    const messages = this.messages[chatId] || [];
    const chat = this.chats.find(c => c.id === chatId);
    const friend = this.friends.find(f => f.id === chat?.participantId || f.friendId === chat?.participantId);
    
    if (!messagesList) return;
    
    if (messages.length === 0) {
      messagesList.innerHTML = `
        <div class="empty-state-small">
          <i class="fas fa-comment-alt"></i>
          <p>Пока нет сообщений</p>
          <p class="text-muted">Напишите первое сообщение!</p>
        </div>
      `;
      return;
    }
    
    messagesList.innerHTML = messages.map(msg => {
      const isOutgoing = msg.senderId === this.currentUser?.id;
      const userId = isOutgoing ? this.currentUser?.id : (friend?.friendId || chat?.participantId);
      const userName = isOutgoing ? this.currentUser?.name : (friend?.friendName || chat?.name);
      const userAvatar = isOutgoing 
        ? (this.currentUser?.avatar?.original || this.currentUser?.avatar) 
        : (friend?.friendAvatar?.original || friend?.friendAvatar);
      
      return this.renderMessage(msg, {
        id: userId,
        name: userName,
        avatar: userAvatar
      }, isOutgoing);
    }).join('');
    
    this.scrollToBottom();
  }
  
  renderMessage(msg, user, isOutgoing) {
    const statusIcon = this.getStatusIcon(msg.status);
    
    return `
      <div class="message ${isOutgoing ? 'outgoing' : 'incoming'}" data-message-id="${msg.id}">
        ${!isOutgoing ? `
          <div class="chat-avatar ${this.getAvatarGradient(user?.id || 'unknown')}" 
               style="width: 36px; height: 36px; font-size: 12px;">
            ${user?.avatar 
              ? `<img src="${user.avatar}" alt="${user.name}">`
              : `<span class="avatar-initials">${this.getInitials(user?.name || '?')}</span>`
            }
          </div>
        ` : ''}
        <div class="message-content">
          ${!isOutgoing ? `<div class="message-sender">${escapeHtml(user?.name || 'Unknown')}</div>` : ''}
          <div class="message-bubble">
            ${escapeHtml(msg.content || msg.text || '')}
          </div>
          <div class="message-meta" style="display: flex; align-items: center; gap: 8px; ${isOutgoing ? 'justify-content: flex-end;' : ''}">
            <span class="message-time">${formatTime(msg.createdAt)}</span>
            ${isOutgoing ? `
              <div class="message-status ${msg.status}">
                <i class="fas ${statusIcon}"></i>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }
  
  async sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input?.value.trim();
    
    if (!text || !this.activeChatId) {
      console.warn('[sendMessage] Нет текста или activeChatId');
      return;
    }
    
    try {
      // Оптимистичное добавление сообщения
      if (!this.messages[this.activeChatId]) {
        this.messages[this.activeChatId] = [];
      }
      
      const tempId = 'temp_' + Date.now();
      const newMessage = {
        id: tempId,
        senderId: this.currentUser?.id,
        content: text,
        createdAt: Date.now(),
        status: 'sending'
      };
      
      this.messages[this.activeChatId].push(newMessage);
      this.renderMessages(this.activeChatId);
      this.renderChatsList();
      
      // Пытаемся отправить через WebSocket (только если авторизованы)
      if (this.wsManager.isConnected && this.wsManager.isAuthorized) {
        this.wsManager.send({
          type: 'message',
          chatId: this.activeChatId,
          content: text,
          messageType: 'text'
        });
        
        // Обновляем статус на "отправлено" (подтверждение придет от сервера)
        newMessage.status = 'sent';
        input.value = '';
        this.stopTyping();
        
        console.log('[sendMessage] Отправлено через WebSocket');
      } else {
        // WebSocket не авторизован, используем HTTP API
        console.log('[sendMessage] WebSocket не авторизован, используем HTTP API');
        const data = await ChatService.sendMessage(this.activeChatId, text);
        
        if (data.success) {
          // Заменяем временное сообщение на реальное
          const index = this.messages[this.activeChatId].findIndex(m => m.id === tempId);
          if (index !== -1) {
            this.messages[this.activeChatId][index] = {
              ...newMessage,
              id: data.messageId,
              status: 'sent'
            };
          }
          
          this.renderMessages(this.activeChatId);
          this.renderChatsList();
          input.value = '';
          this.stopTyping();
          
          console.log('[sendMessage] Отправлено через HTTP API');
        } else {
          // Ошибка - удаляем временное сообщение
          this.messages[this.activeChatId] = this.messages[this.activeChatId].filter(m => m.id !== tempId);
          this.renderMessages(this.activeChatId);
          this.showToast('Не удалось отправить сообщение', 'error');
        }
      }
    } catch (error) {
      console.error('Ошибка отправки:', error);
      this.showToast('Ошибка отправки сообщения', 'error');
    }
  }
  
  handleTyping() {
    if (this.activeChatId && this.wsManager.isConnected) {
      this.wsManager.send({
        type: 'typing',
        chatId: this.activeChatId
      });
      
      if (this.typingTimeout) {
        clearTimeout(this.typingTimeout);
      }
      
      this.typingTimeout = setTimeout(() => {
        this.stopTyping();
      }, MESSENGER_CONFIG.TYPING_TIMEOUT);
    }
  }
  
  stopTyping() {
    if (this.activeChatId && this.wsManager.isConnected) {
      this.wsManager.send({
        type: 'stopTyping',
        chatId: this.activeChatId
      });
    }
  }
  
  switchTab(tabBtn) {
    const tabId = tabBtn.dataset.tab;
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    
    tabBtn.classList.add('active');
    tabBtn.setAttribute('aria-selected', 'true');
    
    const tabContent = document.getElementById(tabId + 'Tab');
    if (tabContent) {
      tabContent.classList.add('active');
    }
    
    if (tabId === 'friends') {
      this.renderFriendsList();
    } else if (tabId === 'chats') {
      this.renderChatsList();
    }
  }
  
  updateRightPanel(user) {
    const rightPanel = document.getElementById('rightPanel');
    if (!rightPanel) return;
    
    rightPanel.style.display = 'block';
    
    const rightPanelAvatar = document.getElementById('rightPanelAvatar');
    const rightPanelTitle = document.getElementById('rightPanelTitle');
    const rightPanelStatus = document.getElementById('rightPanelStatus');
    
    if (rightPanelAvatar) {
      rightPanelAvatar.innerHTML = user?.avatar 
        ? `<img src="${user.avatar}" alt="${user.name}">`
        : `<span class="avatar-initials">${this.getInitials(user?.name || '?')}</span>`;
      rightPanelAvatar.className = `right-panel-avatar ${this.getAvatarGradient(user?.id || 'unknown')}`;
    }
    
    if (rightPanelTitle) rightPanelTitle.textContent = user?.name || 'Неизвестно';
    
    if (rightPanelStatus) {
      rightPanelStatus.innerHTML = `<span class="dot online"></span><span>онлайн</span>`;
    }
  }
  
  openModal(modalId) {
    this.closeAllModals();
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      const firstInput = modal.querySelector('input, button, select');
      if (firstInput) firstInput.focus();
    }
  }
  
  closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.classList.remove('active');
    });
  }
  
  scrollToBottom() {
    const messagesArea = document.getElementById('messagesArea');
    if (messagesArea) {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  }
  
  async populateFriendSelect() {
    const friendSelect = document.getElementById('friendSelect');
    if (!friendSelect) return;
    
    if (this.friends.length === 0) {
      friendSelect.innerHTML = '<option value="">Сначала добавьте друзей</option>';
      return;
    }
    
    friendSelect.innerHTML = '<option value="">Выберите друга...</option>' +
      this.friends.map(friend => 
        `<option value="${friend.friendId}">${escapeHtml(friend.friendName)} (${escapeHtml(friend.friendEmail)})</option>`
      ).join('');
  }
  
  async startChatWithFriend(friendId) {
    try {
      // Проверяем, существует ли уже чат
      const existingChat = this.chats.find(c => 
        c.participants && c.participants.includes(friendId)
      );
      
      if (existingChat) {
        this.closeAllModals();
        this.renderChatsList();
        this.openChat(existingChat.id);
        return;
      }
      
      // Создаем новый чат
      const data = await ChatService.createPrivateChat(friendId);
      
      if (data.success) {
        // Обновляем список чатов
        const chatsData = await ChatService.getChats();
        if (chatsData.success) {
          this.chats = chatsData.chats || [];
        }
        
        this.closeAllModals();
        this.renderChatsList();
        this.openChat(data.chatId || data.chat?.id);
        
        this.showToast('Чат создан!', 'success');
      }
    } catch (error) {
      console.error('Ошибка создания чата:', error);
      this.showToast('Не удалось создать чат', 'error');
    }
  }
  
  async searchUsers(query) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) return;
    
    if (!query || query.length < 2) {
      searchResults.innerHTML = '';
      return;
    }
    
    try {
      const data = await UserService.searchUsers(query);
      
      if (data.success && data.users && data.users.length > 0) {
        searchResults.innerHTML = data.users.map(user => `
          <div class="search-result-item" role="listitem" tabindex="0">
            <div class="search-result-avatar ${this.getAvatarGradient(user.id)}" style="width: 50px; height: 50px; font-size: 16px;">
              ${user.avatar?.original || user.avatar
                ? `<img src="${user.avatar?.original || user.avatar}" alt="${user.name}">`
                : `<span class="avatar-initials">${this.getInitials(user.name)}</span>`
              }
            </div>
            <div class="search-result-info">
              <div class="search-result-name">${escapeHtml(user.name)}</div>
              <div class="search-result-email">${escapeHtml(user.email)}</div>
              <div class="search-result-id">ID: ${user.id}</div>
            </div>
            <div class="search-actions">
              <button class="btn btn-sm btn-outline" onclick="sendFriendRequest('${user.id}')">
                <i class="fas fa-user-plus"></i> В друзья
              </button>
              <button class="btn btn-sm btn-primary" onclick="startDirectChat('${user.id}')">
                <i class="fas fa-comment"></i> Чат
              </button>
            </div>
          </div>
        `).join('');
      } else {
        searchResults.innerHTML = `
          <div class="empty-state-small">
            <i class="fas fa-search"></i>
            <p>Пользователи не найдены</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Ошибка поиска:', error);
      searchResults.innerHTML = `
        <div class="empty-state-small">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Ошибка поиска</p>
        </div>
      `;
    }
  }
  
  async sendFriendRequest(userId) {
    try {
      const result = await UserService.sendFriendRequest(userId);
      
      if (result.success) {
        this.showToast('Заявка отправлена!', 'success');
      } else {
        this.showToast(result.message || 'Ошибка отправки заявки', 'error');
      }
    } catch (error) {
      console.error('Ошибка отправки заявки:', error);
      this.showToast('Ошибка отправки заявки', 'error');
    }
  }
  
  async startDirectChat(userId) {
    // Сначала создаем чат напрямую
    try {
      const data = await ChatService.createChat(userId);
      
      if (data.success) {
        // Обновляем список чатов
        const chatsData = await ChatService.getChats();
        if (chatsData.success) {
          this.chats = chatsData.chats || [];
        }
        
        this.closeAllModals();
        this.renderChatsList();
        this.openChat(data.chatId || data.chat?.id);
      }
    } catch (error) {
      console.error('Ошибка создания чата:', error);
      this.showToast('Не удалось создать чат', 'error');
    }
  }
  
  handleNewMessage(data) {
    const { chatId, messageId, senderId, content, createdAt, timestamp } = data;
    
    if (!chatId || !messageId) {
      console.warn('[handleNewMessage] Нет chatId или messageId:', data);
      return;
    }
    
    // Инициализируем массив сообщений для этого чата
    if (!this.messages[chatId]) {
      this.messages[chatId] = [];
    }
    
    // Проверяем, не дубликат ли это
    const exists = this.messages[chatId].some(m => 
      m.id === messageId || 
      (m.content === content && Math.abs(m.createdAt - (createdAt || timestamp)) < 1000)
    );
    
    if (!exists) {
      const newMessage = {
        id: messageId,
        senderId: senderId,
        content: content,
        createdAt: createdAt || timestamp || Date.now(),
        status: 'delivered'
      };
      
      this.messages[chatId].push(newMessage);
      
      // Сохраняем в localStorage
      this.saveMessagesToLocalStorage(chatId);
      
      // Если это текущий чат, обновляем отображение
      if (chatId === this.activeChatId) {
        this.renderMessages(chatId);
        this.scrollToBottom();
        
        // Отправляем подтверждение о прочтении
        this.wsManager.send({
          type: 'message_read',
          messageId,
          chatId
        });
      } else {
        // Показываем уведомление
        this.showToast(`Новое сообщение от ${senderId}`, 'info');
      }
      
      // Обновляем список чатов
      this.renderChatsList();
      
      console.log('[handleNewMessage] Сообщение добавлено:', messageId);
    }
  }
  
  handleMessageAck(data) {
    const { messageId, chatId } = data;
    
    // Ищем временное сообщение и заменяем на реальное
    if (this.activeChatId && this.messages[this.activeChatId]) {
      const msg = this.messages[this.activeChatId].find(m => m.id.startsWith('temp_'));
      if (msg) {
        msg.id = messageId;
        msg.status = 'delivered';
        this.renderMessages(this.activeChatId);
        this.saveMessagesToLocalStorage(this.activeChatId);
        console.log('[handleMessageAck] Сообщение подтверждено:', messageId);
      }
    }
  }
  
  handleUserTyping(data) {
    const { chatId, userId } = data;
    if (chatId !== this.activeChatId) return;
    
    const chatStatus = document.getElementById('chatStatus');
    if (chatStatus) {
      chatStatus.innerHTML = `<span class="dot typing"></span><span>печатает...</span>`;
    }
    
    // Скрываем индикатор через 3 секунды
    setTimeout(() => {
      if (chatStatus) {
        chatStatus.innerHTML = `<span class="dot online"></span><span>онлайн</span>`;
      }
    }, 3000);
  }
  
  handleUserStopTyping(data) {
    const { chatId, userId } = data;
    if (chatId !== this.activeChatId) return;
    
    const chatStatus = document.getElementById('chatStatus');
    if (chatStatus) {
      chatStatus.innerHTML = `<span class="dot online"></span><span>онлайн</span>`;
    }
  }
  
  // LocalStorage методы
  saveMessagesToLocalStorage(chatId) {
    try {
      const messagesKey = `messages_${chatId}`;
      localStorage.setItem(messagesKey, JSON.stringify(this.messages[chatId] || []));
    } catch (e) {
      console.warn('[localStorage] Не удалось сохранить сообщения:', e);
    }
  }
  
  loadMessagesFromLocalStorage(chatId) {
    try {
      const messagesKey = `messages_${chatId}`;
      const messages = localStorage.getItem(messagesKey);
      
      if (messages) {
        return JSON.parse(messages);
      }
    } catch (e) {
      console.warn('[localStorage] Не удалось загрузить сообщения:', e);
    }
    return null;
  }
  
  // Toast уведомления
  showToast(message, type = 'info') {
    // Удаляем существующие toast
    const existingToast = document.getElementById('toast-notification');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    
    // Добавляем стили если нет
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        .toast-notification {
          position: fixed;
          bottom: 100px;
          left: 50%;
          transform: translateX(-50%);
          padding: 12px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 10000;
          animation: toastIn 0.3s ease, toastOut 0.3s ease 2.7s forwards;
          font-family: inherit;
        }
        .toast-success { background: #10b981; color: white; }
        .toast-error { background: #ef4444; color: white; }
        .toast-info { background: #3b82f6; color: white; }
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes toastOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 3000);
  }
  
  // Вспомогательные методы
  getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  }
  
  getAvatarGradient(id) {
    if (!id) return 'avatar-gradient-1';
    const gradients = [
      'avatar-gradient-1', 'avatar-gradient-2', 'avatar-gradient-3',
      'avatar-gradient-4', 'avatar-gradient-5', 'avatar-gradient-6'
    ];
    const index = id.charCodeAt(id.length - 1) % gradients.length;
    return gradients[index];
  }
  
  getStatusIcon(status) {
    const icons = {
      'sending': 'fa-clock',
      'sent': 'fa-check',
      'delivered': 'fa-check-double',
      'read': 'fa-check-double',
      'failed': 'fa-exclamation-circle'
    };
    return icons[status] || icons.sent;
  }
}

// ============ ГЛАВНОЕ ПРИЛОЖЕНИЕ ============

class MessengerApp {
  constructor() {
    this.ui = null;
    this.wsManager = getWebSocketManager();
    this.initialized = false;
    this.init();
  }
  
  async init() {
    console.log(`${MESSENGER_CONFIG.APP_NAME} v${MESSENGER_CONFIG.VERSION}`);
    
    // Ждем пока App инициализируется (максимум 10 секунд)
    await this.waitForApp();
    
    // Если App уже имеет текущего пользователя, используем его
    if (window.App && window.App.currentUser) {
      this.ui = new UIManager();
      this.ui.currentUser = window.App.currentUser;
      
      // Загружаем данные друзей и чатов через API
      await this.ui.loadUserData();
    } else {
      // App не готов, создаем UIManager который загрузит данные сам
      this.ui = new UIManager();
    }
    
    this.initialized = true;
    
    // Скрываем лоадер
    setTimeout(() => {
      const loader = document.getElementById('globalLoader');
      if (loader) {
        loader.style.opacity = '0';
        loader.style.pointerEvents = 'none';
        setTimeout(() => loader.remove(), 300);
      }
    }, 800);
    
    // Подключаем WebSocket
    this.wsManager.connect();
    
    console.log('[MessengerApp] Готов к работе');
  }
  
  async waitForApp() {
    const maxWait = 10000;
    const checkInterval = 100;
    let waited = 0;
    
    // Проверяем существует ли App и его currentUser
    const checkApp = () => {
      return window.App && 
             window.App.currentUser && 
             typeof window.App.init === 'function';
    };
    
    while (!checkApp() && waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }
    
    if (checkApp()) {
      console.log('[MessengerApp] App найден после ожидания', waited + 'ms');
    } else {
      console.log('[MessengerApp] App не найден, используем автономный режим');
    }
  }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
  window.messengerApp = new MessengerApp();
});

// Глобальные функции для HTML onclick
window.openChatWithFriend = (friendId) => {
  if (window.messengerApp && window.messengerApp.ui) {
    window.messengerApp.ui.startChatWithFriend(friendId);
  } else {
    // Если messengerApp не готов, ждем его инициализации
    const checkReady = setInterval(() => {
      if (window.messengerApp && window.messengerApp.ui) {
        clearInterval(checkReady);
        window.messengerApp.ui.startChatWithFriend(friendId);
      }
    }, 100);
    // Таймаут через 5 секунд
    setTimeout(() => clearInterval(checkReady), 5000);
  }
};

window.sendFriendRequest = (userId) => {
  if (window.messengerApp && window.messengerApp.ui) {
    window.messengerApp.ui.sendFriendRequest(userId);
  }
};

window.startDirectChat = (userId) => {
  if (window.messengerApp && window.messengerApp.ui) {
    window.messengerApp.ui.startDirectChat(userId);
  }
};
