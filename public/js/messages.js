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
        this.updateConnectionStatus('waiting', 'Ожидание авторизации...');
        return;
      }
      
      this.updateConnectionStatus('connecting', 'Подключение...');
      
      // Определяем URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      const wsUrl = `${protocol}//${host}:${port}/ws`;
      
      try {
        this.ws = new WebSocket(`${wsUrl}?token=${token}`);
        this.wsToken = token;
        
        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.isConnected = true;
          this.isConnecting = false;
          this.updateConnectionStatus('connected', 'Подключено');
          this.ws.send(JSON.stringify({ type: 'auth', token: this.wsToken }));
          this.emit('connected', {});
        };
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (e) {
            // Игнорируем ошибки парсинга
          }
        };
        
        this.ws.onclose = (event) => {
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
          this.updateConnectionStatus('error', 'Ошибка соединения');
          this.emit('error', {});
        };
        
      } catch (error) {
        this.updateConnectionStatus('error', 'Ошибка подключения');
      }
    },
    
    // Переподключение
    attemptReconnect() {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
      
      this.updateConnectionStatus('reconnecting', `Переподключение ${this.reconnectAttempts}...`);
      
      setTimeout(() => {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.connect();
        } else {
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
          this.isAuthorized = true;
          this.updateConnectionStatus('authorized', 'Авторизован');
          break;
        case 'auth_error':
          this.isAuthorized = false;
          this.updateConnectionStatus('error', 'Ошибка авторизации');
          break;
        case 'user_status':
          window.dispatchEvent(new CustomEvent('userStatus', { detail: data }));
          break;
        case 'pong':
          break;
        case 'error':
          break;
        // ============ ЗАЯВКИ В ДРУЗЬЯ ============
        case 'FRIEND_REQUEST':
          window.dispatchEvent(new CustomEvent('friendRequest', { detail: data }));
          this.updateRequestsBadge();
          break;
        case 'FRIEND_ACCEPT':
          window.dispatchEvent(new CustomEvent('friendAccepted', { detail: data }));
          break;
        case 'FRIEND_REJECT':
          window.dispatchEvent(new CustomEvent('friendRejected', { detail: data }));
          break;
        case 'CALL_OFFER':
        case 'CALL_ANSWER':
        case 'CALL_ICE_CANDIDATE':
        case 'CALL_REJECT':
        case 'CALL_END':
        case 'CALL_TIMEOUT':
          break;
        default:
          break;
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
    
    // Обновление бейджа заявок
    updateRequestsBadge() {
      const badge = document.getElementById('requestsBadge');
      if (badge) {
        let count = parseInt(badge.textContent) || 0;
        badge.textContent = count + 1;
        badge.style.display = 'inline-flex';
      }
    },
    
    // Показать уведомление (toast)
    showToast(message, type = 'info') {
      // Удаляем существующие toast
      const existingToast = document.getElementById('ws-toast-notification');
      if (existingToast) {
        existingToast.remove();
      }
      
      const toast = document.createElement('div');
      toast.id = 'ws-toast-notification';
      toast.className = `toast-notification toast-${type}`;
      toast.textContent = message;
      
      // Добавляем стили если нет
      if (!document.getElementById('ws-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'ws-toast-styles';
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
    // Используем глобальный WebSocketManager если доступен
    this.wsManager = (typeof window.WebSocketManager !== 'undefined') 
      ? window.WebSocketManager 
      : getWebSocketManager();
    this.activeChatId = null;
    this.typingTimeout = null;
    this.currentUser = null;
    this.friends = [];
    this.chats = [];
    this.messages = {};
    
    // ИСПРАВЛЕНО: Debounce для refreshRequests
    this.refreshRequestsDebounced = this.debounce(() => this.refreshRequests(), 500);
    this.refreshBadgeDebounced = this.debounce(() => this.refreshRequestsBadgeOnly(), 300);
    
    // ИСПРАВЛЕНО: Флаг для предотвращения повторных обновлений
    this.isRefreshingRequests = false;
    
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
      
    } catch (error) {
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
    
    // WebSocket events - используем глобальный события через window
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
    
    // ============ ОБРАБОТЧИКИ ЗАЯВОК В ДРУЗЬЯ ============
    window.addEventListener('friendRequest', (e) => {
      this.handleFriendRequest(e.detail);
    });
    
    window.addEventListener('friendAccepted', (e) => {
      this.handleFriendAccepted(e.detail);
    });
    
    window.addEventListener('friendRejected', (e) => {
      this.handleFriendRejected(e.detail);
    });
    
    // ИСПРАВЛЕНО: Слушаем изменения localStorage для синхронизации между вкладками
    window.addEventListener('storage', (e) => {
      if (e.key === 'friendRequestsSync') {
        this.refreshRequestsDebounced();
      }
    });
    
    // ИСПРАВЛЕНО: Слушаем BroadcastChannel для синхронизации между вкладками
    this.setupBroadcastChannel();
    
    // ============ ЗАЯВКИ В ДРУЗЬЯ ============
    
    // Sub-tabs для заявок
    document.querySelectorAll('.requests-tabs .sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.requests-tabs .sub-tab-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        e.target.classList.add('active');
        e.target.setAttribute('aria-pressed', 'true');
        
        // Загружаем соответствующие заявки
        const subtab = e.target.dataset.subtab;
        this.loadFriendRequests().then(requests => {
          if (subtab === 'incoming') {
            // Входящие заявки - это массив incoming
            this.renderRequestsList(requests.incoming || []);
          } else {
            // Исходящие заявки - это массив outgoing
            this.renderRequestsList(requests.outgoing || []);
          }
        });
      });
    });
    
    // Фильтры заявок
    document.querySelectorAll('.requests-filters .filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.requests-filters .filter-btn').forEach(b => {
          b.classList.remove('active');
        });
        e.target.classList.add('active');
        
        const filter = e.target.dataset.filter;
        this.loadFriendRequests().then(requests => {
          this.renderRequestsList(requests.incoming || [], filter);
        });
      });
    });
    
    // ============ ПОИСК ПОЛЬЗОВАТЕЛЕЙ ============
    
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', async () => {
        const input = document.getElementById('userSearchInput');
        const query = input?.value || '';
        const users = await this.searchUsers(query);
        this.renderSearchResults(users);
      });
    }
    
    // ============ ВЫБОР МИКРОФОНА ============
    
    const micDeviceBtn = document.getElementById('micDeviceBtn');
    if (micDeviceBtn) {
      micDeviceBtn.addEventListener('click', () => this.toggleMicDeviceDropdown());
    }
    
    // ============ СБРОС ЗВОНКА ============
    
    const resetCallBtn = document.getElementById('resetCallBtn');
    if (resetCallBtn) {
      resetCallBtn.addEventListener('click', () => this.handleResetCall());
    }
    
    // Привязываем premium события
    this.bindPremiumEvents();
    
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
      
      // Получаем количество непрочитанных сообщений
      const unreadCount = this.getUnreadCount(chat.id);
      const unreadBadge = unreadCount > 0 
        ? `<div class="unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</div>` 
        : '';
      
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
            ${unreadBadge}
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
    
    // Очищаем счетчик непрочитанных сообщений
    this.clearUnreadCount(chatId);
    
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
          
          this.saveMessagesToLocalStorage(this.activeChatId);
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
    } else if (tabId === 'requests') {
      // Загружаем входящие заявки при переходе на вкладку
      this.loadFriendRequests().then(requests => {
        this.renderRequestsList(requests.incoming || []);
        // Обновляем счётчик
        const badge = document.getElementById('requestsBadge');
        if (badge) {
          const incomingCount = (requests.incoming || []).length;
          badge.textContent = incomingCount;
          badge.style.display = incomingCount > 0 ? 'inline-flex' : 'none';
        }
      });
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
        // Получаем статус дружбы для каждого пользователя
        const currentUserId = this.currentUser?.id;
        
        searchResults.innerHTML = await Promise.all(data.users.map(async user => {
          // Получаем статус отношений с пользователем
          let friendshipStatus = 'none';
          if (currentUserId) {
            try {
              const statusData = await apiRequest(`/friends/status?user1=${currentUserId}&user2=${user.id}`);
              friendshipStatus = statusData.status || 'none';
            } catch (e) {
              console.warn('[searchUsers] Не удалось получить статус дружбы:', e);
            }
          }
          
          // Определяем текст и состояние кнопки
          let friendBtnText = 'В друзья';
          let friendBtnDisabled = false;
          let friendBtnClass = 'btn-outline';
          
          if (friendshipStatus === 'accepted') {
            friendBtnText = 'Друзья';
            friendBtnDisabled = true;
            friendBtnClass = 'btn-success';
          } else if (friendshipStatus === 'pending') {
            friendBtnText = 'Заявка отправлена';
            friendBtnDisabled = true;
            friendBtnClass = 'btn-secondary';
          } else if (friendshipStatus === 'incoming') {
            friendBtnText = 'Принять заявку';
            friendBtnDisabled = false;
            friendBtnClass = 'btn-success';
          }
          
          return `
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
                <button class="btn btn-sm ${friendBtnClass}" 
                        onclick="sendFriendRequest('${user.id}')" 
                        ${friendBtnDisabled ? 'disabled' : ''}>
                  <i class="fas fa-user-plus"></i> ${friendBtnText}
                </button>
                <button class="btn btn-sm btn-primary" onclick="startDirectChat('${user.id}')">
                  <i class="fas fa-comment"></i> Чат
                </button>
              </div>
            </div>
          `;
        }));
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
      console.log(`[sendFriendRequest] Отправка заявки пользователю ${userId}...`);
      const result = await UserService.sendFriendRequest(userId);
      
      if (result.success) {
        console.log('[sendFriendRequest] Заявка отправлена успешно, requestId:', result.requestId);
        this.showToast('Заявка отправлена!', 'success');
        
        // Обновляем список исходящих заявок
        const data = await this.loadFriendRequests();
        this.renderRequestsList(data.outgoing || []);
        
        // Обновляем бейдж счётчика
        const badge = document.getElementById('requestsBadge');
        const outgoingCount = (data.outgoing || []).length;
        if (badge) {
          badge.textContent = outgoingCount;
          badge.style.display = outgoingCount > 0 ? 'inline-flex' : 'none';
        }
      } else {
        console.warn('[sendFriendRequest] Ошибка:', result.message);
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
    console.log('[handleNewMessage] 🔔 Получено событие newMessage:', data);
    console.log('[handleNewMessage] activeChatId:', this.activeChatId);
    
    // Поддерживаем разные форматы входящих данных
    const messageId = data.messageId || data.id || data.msgId;
    const chatId = data.chatId || data.chat_id;
    const senderId = data.senderId || data.sender_id || data.from;
    const content = data.content || data.text || data.message;
    const createdAt = data.createdAt || data.timestamp || data.created_at || Date.now();
    
    console.log('[handleNewMessage] Извлечено:', { messageId, chatId, senderId, content, createdAt });
    
    if (!chatId || !messageId) {
      console.warn('[handleNewMessage] ❌ Нет chatId или messageId:', data);
      return;
    }
    
    // Проверяем, что chatId совпадает с активным чатом
    if (chatId !== this.activeChatId) {
      console.log('[handleNewMessage] ℹ️ Сообщение для другого чата (not active)');
    }
    
    // Инициализируем массив сообщений для этого чата
    if (!this.messages[chatId]) {
      this.messages[chatId] = [];
      console.log(`[handleNewMessage] 📂 Создан новый массив для чата: ${chatId}`);
    }
    
    // Проверяем, не дубликат ли это
    const exists = this.messages[chatId].some(m => 
      m.id === messageId || 
      (m.content === content && Math.abs(m.createdAt - createdAt) < 1000)
    );
    
    if (exists) {
      console.log('[handleNewMessage] ⚠️ Сообщение уже существует, пропускаем');
      return;
    }
    
    const newMessage = {
      id: messageId,
      senderId: senderId,
      content: content,
      createdAt: createdAt,
      status: 'delivered'
    };
    
    this.messages[chatId].push(newMessage);
    console.log(`[handleNewMessage] ✅ Сообщение ${messageId} добавлено в чат ${chatId}, всего: ${this.messages[chatId].length}`);
    
    // Сохраняем в localStorage
    this.saveMessagesToLocalStorage(chatId);
    
    // Если это текущий чат, обновляем отображение
    if (chatId === this.activeChatId) {
      console.log(`[handleNewMessage] 🎯 Это активный чат, обновляем отображение`);
      this.renderMessages(chatId);
      this.scrollToBottom();
      
      // Отправляем подтверждение о прочтении
      if (this.wsManager && this.wsManager.isConnected) {
        this.wsManager.send({
          type: 'message_read',
          messageId,
          chatId
        });
      }
    } else {
      console.log(`[handleNewMessage] 📭 Это НЕ активный чат (active=${this.activeChatId}), обновляем только индикатор`);
      // Показываем уведомление
      const senderName = data.senderName || data.sender_name || senderId;
      this.showToast(`Новое сообщение от ${senderName}`, 'info');
      
      // Обновляем индикатор непрочитанных сообщений в списке чатов
      this.updateUnreadIndicator(chatId);
    }
    
    // Обновляем список чатов
    this.renderChatsList();
    console.log('[handleNewMessage] 🏁 Обработка завершена');
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
  
  // Обновление индикатора непрочитанных сообщений
  updateUnreadIndicator(chatId) {
    // Увеличиваем счетчик непрочитанных сообщений
    const unreadKey = `unread_${chatId}`;
    let unreadCount = parseInt(localStorage.getItem(unreadKey)) || 0;
    unreadCount++;
    localStorage.setItem(unreadKey, unreadCount.toString());
    
    // Обновляем отображение списка чатов
    this.renderChatsList();
  }
  
  // Получение количества непрочитанных сообщений для чата
  getUnreadCount(chatId) {
    const unreadKey = `unread_${chatId}`;
    return parseInt(localStorage.getItem(unreadKey)) || 0;
  }
  
  // Сброс счетчика непрочитанных сообщений
  clearUnreadCount(chatId) {
    const unreadKey = `unread_${chatId}`;
    localStorage.removeItem(unreadKey);
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
  
  // ============ ЗАЯВКИ В ДРУЗЬЯ ============
  
  /**
   * Утилита debounce для предотвращения частых обновлений
   * ИСПРАВЛЕНО: Добавлена функция debounce
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  async loadFriendRequests() {
    try {
      console.log('[loadFriendRequests] Загрузка заявок...');
      const data = await UserService.getFriendRequests();
      console.log('[loadFriendRequests] Ответ сервера:', data);
      if (data.success) {
        // Сервер возвращает { success: true, incoming: [...], outgoing: [...] }
        return {
          incoming: data.incoming || [],
          outgoing: data.outgoing || []
        };
      }
      return { incoming: [], outgoing: [] };
    } catch (error) {
      console.error('Ошибка загрузки заявок:', error);
      return { incoming: [], outgoing: [] };
    }
  }
  
  /**
   * Обработка входящей заявки (через WebSocket)
   * ИСПРАВЛЕНО: Используем debounced refresh и правильное обновление бейджа
   */
  handleFriendRequest(data) {
    console.log('[handleFriendRequest] Новая заявка:', data);
    this.showToast(`Новая заявка от ${data.fromName || 'Пользователя'}!`, 'info');
    
    // Воспроизводим звук уведомления
    this.playNotificationSound();
    
    // Используем debounced refresh для предотвращения частых обновлений
    this.refreshRequestsDebounced();
    
    // Обновляем бейдж сразу (синхронно)
    this.updateBadgeImmediately();
  }
  
  /**
   * Обновление бейджа сразу при получении заявки
   * ИСПРАВЛЕНО: Немедленное обновление бейджа
   */
  updateBadgeImmediately() {
    const badge = document.getElementById('requestsBadge');
    if (badge) {
      let count = parseInt(badge.textContent) || 0;
      badge.textContent = count + 1;
      badge.style.display = 'inline-flex';
      
      // Добавляем визуальный эффект
      badge.style.transform = 'scale(1.2)';
      setTimeout(() => {
        badge.style.transform = 'scale(1)';
      }, 200);
    }
  }
  
  /**
   * Только обновление бейджа (без перерисовки списка)
   * ИСПРАВЛЕНО: Добавлен метод для оптимизации
   */
  async refreshRequestsBadgeOnly() {
    try {
      const data = await this.loadFriendRequests();
      const incomingCount = (data.incoming || []).length;
      
      const badge = document.getElementById('requestsBadge');
      if (badge) {
        badge.textContent = incomingCount;
        badge.style.display = incomingCount > 0 ? 'inline-flex' : 'none';
      }
      
      const incomingCountEl = document.getElementById('incomingRequestsCount');
      if (incomingCountEl) {
        incomingCountEl.textContent = incomingCount;
        incomingCountEl.style.display = incomingCount > 0 ? 'inline-flex' : 'none';
      }
    } catch (error) {
      console.error('[refreshRequestsBadgeOnly] Ошибка:', error);
    }
  }
  
  // Обработка принятия заявки
  handleFriendAccepted(data) {
    console.log('[handleFriendAccepted] Заявка принята:', data);
    this.showToast(`${data.fromName || 'Пользователь'} теперь ваш друг!`, 'success');
    this.refreshRequestsDebounced();
    this.loadUserData().then(() => {
      this.renderFriendsList();
    });
  }
  
  // Обработка отклонения заявки
  handleFriendRejected(data) {
    console.log('[handleFriendRejected] Заявка отклонена:', data);
    this.refreshRequestsDebounced();
  }
  
  /**
   * Обновление списка заявок
   * ИСПРАВЛЕНО: Добавлена защита от повторных обновлений
   */
  async refreshRequests() {
    // Защита от повторных вызовов
    if (this.isRefreshingRequests) {
      console.log('[refreshRequests] Пропуск - уже обновляется');
      return;
    }
    
    this.isRefreshingRequests = true;
    console.log('[refreshRequests] Обновление заявок...');
    
    try {
      const data = await this.loadFriendRequests();
      
      // Обновляем в зависимости от активной вкладки
      const incomingTab = document.querySelector('.sub-tab-btn[data-subtab="incoming"]');
      if (incomingTab?.classList.contains('active')) {
        this.renderRequestsList(data.incoming || []);
      } else {
        this.renderRequestsList(data.outgoing || []);
      }
      
      // Обновляем бейдж входящих заявок
      const badge = document.getElementById('requestsBadge');
      const incomingCount = (data.incoming || []).length;
      if (badge) {
        badge.textContent = incomingCount;
        badge.style.display = incomingCount > 0 ? 'inline-flex' : 'none';
      }
      
      // Обновляем счётчик входящих заявок
      const incomingCountEl = document.getElementById('incomingRequestsCount');
      if (incomingCountEl) {
        incomingCountEl.textContent = incomingCount;
        incomingCountEl.style.display = incomingCount > 0 ? 'inline-flex' : 'none';
      }
      
      console.log('[refreshRequests] Заявки обновлены');
    } catch (error) {
      console.error('[refreshRequests] Ошибка:', error);
    } finally {
      this.isRefreshingRequests = false;
    }
  }
  
  /**
   * Воспроизведение звука уведомления
   * ИСПРАВЛЕНО: Добавлен метод для звуковых уведомлений
   */
  playNotificationSound() {
    try {
      const audio = new Audio('/sounds/friend-request.mp3');
      audio.volume = 0.5;
      audio.play().catch(e => console.log('[UIManager] Не удалось воспроизвести звук:', e));
    } catch (e) {
      console.log('[UIManager] Аудио не поддерживается');
    }
  }
  
  /**
   * Настройка BroadcastChannel для синхронизации между вкладками
   * ИСПРАВЛЕНО: Добавлен метод для межвкладочной синхронизации
   */
  setupBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel('messenger_sync');
      
      this.broadcastChannel.onmessage = (event) => {
        const { type, data } = event.data;
        
        if (type === 'friendRequestsUpdate') {
          console.log('[UIManager] Получен сигнал обновления заявок через BroadcastChannel');
          this.refreshRequestsDebounced();
        }
        
        if (type === 'messagesUpdate') {
          console.log('[UIManager] Получен сигнал обновления сообщений через BroadcastChannel:', data.chatId);
          // Перезагружаем сообщения для этого чата
          if (data.chatId === this.activeChatId) {
            this.loadMessages(data.chatId);
          }
        }
      };
      
      console.log('[UIManager] BroadcastChannel настроен для синхронизации');
    } catch (e) {
      console.log('[UIManager] BroadcastChannel не поддерживается:', e);
    }
  }
   
  /**
   * Уведомить другие вкладки об обновлении сообщений
   */
  notifyMessagesUpdated(chatId) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: 'messagesUpdate',
        chatId
      });
    }
  }

  renderRequestsList(requests, filter = 'all') {
    const container = document.getElementById('requestsList');
    if (!container) return;
    
    // Фильтрация заявок
    let filteredRequests = requests;
    if (filter !== 'all') {
      filteredRequests = requests.filter(r => r.status === filter);
    }
    
    if (filteredRequests.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px;">
          <i class="fas fa-user-plus" style="font-size: 48px; opacity: 0.5; margin-bottom: 16px;"></i>
          <p>Заявок нет</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = filteredRequests.map(request => {
      // Проверяем, входящая или исходящая заявка
      const isIncoming = request.fromUserId !== undefined;
      const userId = isIncoming ? request.fromUserId : request.toUserId;
      const userName = isIncoming ? request.fromUserName : request.toUserName;
      
      return `
      <div class="request-item" data-request-id="${request.id}" data-from="${userId}" data-status="${request.status}">
        <div class="request-avatar ${this.getAvatarGradient(userId)}">
          <span class="avatar-initials">${this.getInitials(userName || 'Пользователь')}</span>
        </div>
        <div class="request-info">
          <h4>${escapeHtml(userName || 'Пользователь')}</h4>
          <p class="request-time">${formatTime(request.createdAt, 'full')}</p>
          ${request.message ? `<p class="request-message">${escapeHtml(request.message)}</p>` : ''}
        </div>
        <div class="request-actions">
          ${isIncoming ? `
            <button class="btn btn-success btn-sm accept-request" data-request-id="${request.id}" aria-label="Принять заявку">
              <i class="fas fa-check"></i>
            </button>
            <button class="btn btn-danger btn-sm reject-request" data-request-id="${request.id}" aria-label="Отклонить заявку">
              <i class="fas fa-times"></i>
            </button>
          ` : `
            <span class="request-status pending">⏳ Ожидает</span>
            <button class="btn btn-primary btn-sm" onclick="startDirectChat('${userId}')" aria-label="Написать сообщение">
              <i class="fas fa-comment"></i>
            </button>
          `}
        </div>
      </div>
    `;
    }).join('');
    
    // Привязываем события
    container.querySelectorAll('.accept-request').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleAcceptRequest(e.target.closest('.request-item')));
    });
    
    container.querySelectorAll('.reject-request').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleRejectRequest(e.target.closest('.request-item')));
    });
  }
  
  async handleAcceptRequest(requestItem) {
    const requestId = requestItem.dataset.requestId;
    // Получаем fromUserId из data атрибута
    const fromUserId = requestItem.dataset.from;
    
    try {
      const data = await UserService.respondToRequest(requestId, 'accepted');
      if (data.success) {
        this.showToast('Пользователь добавлен в друзья!', 'success');
        
        // Уведомляем отправителя через WebSocket
        const wsManager = getWebSocketManager();
        wsManager.send({
          type: 'FRIEND_ACCEPT',
          to: fromUserId,
          timestamp: Date.now()
        });
        
        // Обновляем список заявок
        this.refreshRequests();
        
        // Обновляем список друзей
        await this.loadUserData();
        this.renderFriendsList();
        
        // Создаём чат с новым другом
        const chatData = await ChatService.createPrivateChat(fromUserId);
        if (chatData.success) {
          const chatsData = await ChatService.getChats();
          if (chatsData.success) {
            this.chats = chatsData.chats || [];
          }
          this.renderChatsList();
          this.openChat(chatData.chatId || chatData.chat?.id);
          this.showToast('Чат создан!', 'success');
        }
      }
    } catch (error) {
      this.showToast('Ошибка при принятии заявки', 'error');
    }
  }
  
  async handleRejectRequest(requestItem) {
    const requestId = requestItem.dataset.requestId;
    // Получаем fromUserId из data атрибута
    const fromUserId = requestItem.dataset.from;
    
    try {
      const data = await UserService.respondToRequest(requestId, 'rejected');
      if (data.success) {
        this.showToast('Заявка отклонена', 'info');
        
        // Уведомляем отправителя через WebSocket
        const wsManager = getWebSocketManager();
        wsManager.send({
          type: 'FRIEND_REJECT',
          to: fromUserId,
          timestamp: Date.now()
        });
        
        // Обновляем список заявок
        this.refreshRequests();
      }
    } catch (error) {
      this.showToast('Ошибка при отклонении заявки', 'error');
    }
  }
  
  // ============ ВЫБОР МИКРОФОНА ============
  
  toggleMicDeviceDropdown() {
    const dropdown = document.getElementById('micDeviceDropdown');
    if (!dropdown) return;
    
    const isHidden = dropdown.style.display === 'none';
    
    if (isHidden) {
      this.populateMicDeviceList();
      dropdown.style.display = 'block';
    } else {
      dropdown.style.display = 'none';
    }
  }
  
  async populateMicDeviceList() {
    const list = document.getElementById('micDeviceList');
    if (!list) return;
    
    // Используем MediaDeviceManager если доступен
    let devices = [];
    if (window.MediaDeviceManager) {
      devices = window.MediaDeviceManager.getAudioInputs();
    } else {
      // Fallback: получаем устройства напрямую
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        devices = allDevices.filter(d => d.kind === 'audioinput');
      } catch (e) {
        console.error('Ошибка получения устройств:', e);
      }
    }
    
    if (devices.length === 0) {
      list.innerHTML = `
        <div class="mic-device-item">
          <i class="fas fa-microphone-slash"></i>
          <span>Устройства не найдены</span>
        </div>
      `;
      return;
    }
    
    const currentDevice = window.MediaDeviceManager?.currentAudioDevice;
    
    list.innerHTML = devices.map(device => `
      <div class="mic-device-item ${currentDevice?.deviceId === device.deviceId ? 'active' : ''}" 
           data-device-id="${device.deviceId}">
        <i class="fas fa-microphone"></i>
        <span>${device.label || `Микрофон ${device.deviceId.slice(0, 8)}`}</span>
        ${currentDevice?.deviceId === device.deviceId ? '<i class="fas fa-check check-icon"></i>' : ''}
      </div>
    `).join('');
    
    // Привязываем события
    list.querySelectorAll('.mic-device-item').forEach(item => {
      item.addEventListener('click', () => this.selectMicrophone(item));
    });
  }
  
  async selectMicrophone(item) {
    const deviceId = item.dataset.deviceId;
    
    try {
      if (window.MediaDeviceManager) {
        await window.MediaDeviceManager.switchMicrophone(deviceId);
      }
      
      // Обновляем UI
      this.populateMicDeviceList();
      
      // Закрываем dropdown
      const dropdown = document.getElementById('micDeviceDropdown');
      if (dropdown) dropdown.style.display = 'none';
      
      this.showToast('Микрофон изменён', 'success');
    } catch (error) {
      this.showToast('Ошибка переключения микрофона', 'error');
    }
  }
  
  // ============ СБРОС ЗВОНКА ============
  
  async handleResetCall() {
    if (!window.CallManager) {
      this.showToast('CallManager не доступен', 'error');
      return;
    }
    
    const partnerId = window.CallManager.callPartner?.id;
    const isVideo = window.CallManager.isVideo;
    
    if (!partnerId) {
      this.showToast('Нет активного звонка', 'error');
      return;
    }
    
    // Завершаем текущий звонок
    window.CallManager.endCall();
    
    // Показываем уведомление
    this.showToast('Начинаем новый звонок...', 'info');
    
    // Начинаем новый звонок через небольшую задержку
    setTimeout(() => {
      window.CallManager.startCall(partnerId, isVideo);
    }, 500);
  }
  
  // ============ ПОИСК ПОЛЬЗОВАТЕЛЕЙ ============
  
  async searchUsers(query) {
    if (!query.trim()) return [];
    
    try {
      const data = await UserService.searchUsers(query);
      if (data.success) {
        return data.users || [];
      }
      return [];
    } catch (error) {
      console.error('Ошибка поиска:', error);
      return [];
    }
  }
  
  renderSearchResults(users) {
    const container = document.getElementById('searchResults');
    if (!container) return;
    
    if (users.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 20px; text-align: center;">
          <p>Пользователи не найдены</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = users.map(user => `
      <div class="search-result-item" data-user-id="${user.id}">
        <div class="search-result-avatar ${this.getAvatarGradient(user.id)}">
          <span class="avatar-initials">${this.getInitials(user.name)}</span>
        </div>
        <div class="search-result-info">
          <h4>${escapeHtml(user.name)}</h4>
          <p>${escapeHtml(user.email)}</p>
        </div>
        <div class="search-result-actions">
          <button class="btn btn-primary btn-sm add-friend-btn" data-user-id="${user.id}" aria-label="Добавить в друзья">
            <i class="fas fa-user-plus"></i>
          </button>
        </div>
      </div>
    `).join('');
    
    // Привязываем события к кнопкам добавления в друзья
    container.querySelectorAll('.add-friend-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleAddFriend(e.target.closest('.add-friend-btn')));
    });
  }
  
  async handleAddFriend(btn) {
    const userId = btn.dataset.userId;
    
    // Меняем состояние кнопки
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    try {
      const data = await UserService.sendFriendRequest(userId);
      
      if (data.success) {
        // Отправляем через WebSocket
        const wsManager = getWebSocketManager();
        wsManager.send({
          type: 'FRIEND_REQUEST',
          to: userId,
          timestamp: Date.now()
        });
        
        // Меняем кнопку на "Запрос отправлен"
        btn.innerHTML = '<i class="fas fa-clock"></i>';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
        btn.title = 'Запрос отправлен';
        
        this.showToast('Запрос в друзья отправлен!', 'success');
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-user-plus"></i>';
        this.showToast(data.message || 'Ошибка отправки запроса', 'error');
      }
    } catch (error) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-user-plus"></i>';
      this.showToast('Ошибка отправки запроса', 'error');
    }
  }
  
  // ============ ПРАВАЯ ПАНЕЛЬ: КНОПКИ ============
  
  // Поиск в чате
  toggleChatSearch() {
    const searchBar = document.getElementById('chatHeaderSearch');
    if (!searchBar) return;
    
    const isActive = searchBar.classList.contains('active');
    
    if (isActive) {
      searchBar.classList.remove('active');
      this.exitSearchInChat();
    } else {
      searchBar.classList.add('active');
      document.getElementById('chatSearchInput')?.focus();
      this.enterSearchInChat();
    }
  }
  
  enterSearchInChat() {
    const messagesArea = document.getElementById('messagesArea');
    if (messagesArea) messagesArea.classList.add('searching');
  }
  
  exitSearchInChat() {
    const messagesArea = document.getElementById('messagesArea');
    const searchInput = document.getElementById('chatSearchInput');
    
    if (messagesArea) messagesArea.classList.remove('searching');
    if (searchInput) searchInput.value = '';
    
    document.querySelectorAll('.message.highlighted').forEach(el => el.classList.remove('highlighted'));
  }
  
  searchInChat(query) {
    if (!query.trim()) {
      document.querySelectorAll('.message').forEach(el => el.classList.remove('hidden'));
      return;
    }
    
    const messages = document.querySelectorAll('.message');
    const lowerQuery = query.toLowerCase();
    
    messages.forEach(msg => {
      const textEl = msg.querySelector('.message-bubble');
      if (textEl) {
        const text = textEl.textContent.toLowerCase();
        if (text.includes(lowerQuery)) {
          msg.classList.remove('hidden');
          msg.classList.add('highlighted');
        } else {
          msg.classList.add('hidden');
          msg.classList.remove('highlighted');
        }
      }
    });
  }
  
  // Закрепить чат
  togglePinChat() {
    if (!this.activeChatId) return;
    
    const btn = document.getElementById('pinChatBtn');
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${this.activeChatId}"]`);
    
    if (!btn || !chatItem) return;
    
    const isPinned = chatItem.classList.contains('pinned');
    
    chatItem.classList.toggle('pinned');
    
    if (isPinned) {
      btn.innerHTML = '<i class="fas fa-thumbtack"></i> Закрепить чат';
      btn.classList.remove('active');
      this.showToast('Чат откреплён', 'info');
    } else {
      btn.innerHTML = '<i class="fas fa-thumbtack"></i> Открепить чат';
      btn.classList.add('active');
      this.showToast('Чат закреплён', 'success');
      
      const chatsList = document.getElementById('chatsList');
      if (chatsList && chatsList.firstChild) {
        chatsList.insertBefore(chatItem, chatsList.firstChild);
      }
    }
    
    this.savePinnedChats();
  }
  
  savePinnedChats() {
    const pinnedChats = [];
    document.querySelectorAll('.chat-item.pinned').forEach(item => {
      pinnedChats.push(item.dataset.chatId);
    });
    localStorage.setItem('pinnedChats', JSON.stringify(pinnedChats));
  }
  
  loadPinnedChats() {
    const pinned = JSON.parse(localStorage.getItem('pinnedChats') || '[]');
    pinned.forEach(chatId => {
      const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
      if (item) {
        item.classList.add('pinned');
        if (chatId === this.activeChatId) {
          const btn = document.getElementById('pinChatBtn');
          if (btn) {
            btn.innerHTML = '<i class="fas fa-thumbtack"></i> Открепить чат';
            btn.classList.add('active');
          }
        }
      }
    });
  }
  
  // Без звука
  toggleMuteChat(duration = null) {
    if (!this.activeChatId) return;
    
    const btn = document.getElementById('muteChatBtn');
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${this.activeChatId}"]`);
    
    if (!btn || !chatItem) return;
    
    const isMuted = chatItem.classList.contains('muted');
    
    if (duration) {
      chatItem.classList.add('muted');
      btn.innerHTML = '<i class="fas fa-bell"></i> Включить звук';
      btn.classList.add('active');
      
      const muteUntil = duration === 'forever' ? 'forever' : Date.now() + this.parseDuration(duration);
      localStorage.setItem(`mute_${this.activeChatId}`, muteUntil);
      
      const durationText = duration === 'forever' ? 'навсегда' : this.formatMuteTime(duration);
      this.showToast(`Уведомления отключены ${durationText}`, 'info');
      return;
    }
    
    chatItem.classList.toggle('muted');
    
    if (isMuted) {
      btn.innerHTML = '<i class="fas fa-bell-slash"></i> Без звука';
      btn.classList.remove('active');
      localStorage.removeItem(`mute_${this.activeChatId}`);
      this.showToast('Звук включён', 'success');
    } else {
      btn.innerHTML = '<i class="fas fa-bell"></i> Включить звук';
      btn.classList.add('active');
      localStorage.setItem(`mute_${this.activeChatId}`, Date.now() + 3600000);
      this.showToast('Уведомления отключены на 1 час', 'info');
    }
  }
  
  parseDuration(duration) {
    const durations = { '1h': 3600000, '8h': 28800000, '24h': 86400000 };
    return durations[duration] || 3600000;
  }
  
  formatMuteTime(duration) {
    const times = { '1h': 'на 1 час', '8h': 'на 8 часов', '24h': 'на 24 часа', 'forever': 'навсегда' };
    return times[duration] || '';
  }
  
  loadMutedChats() {
    document.querySelectorAll('.chat-item').forEach(item => {
      const chatId = item.dataset.chatId;
      const muteUntil = localStorage.getItem(`mute_${chatId}`);
      
      if (muteUntil) {
        if (muteUntil === 'forever' || parseInt(muteUntil) > Date.now()) {
          item.classList.add('muted');
        } else {
          item.classList.remove('muted');
          localStorage.removeItem(`mute_${chatId}`);
        }
      }
    });
  }
  
  showMuteTooltip(btn) {
    const tooltip = document.getElementById('muteTooltip');
    if (!tooltip) return;
    
    const rect = btn.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 8}px`;
    tooltip.style.display = 'block';
    
    tooltip.querySelectorAll('.mute-option').forEach(opt => {
      opt.onclick = () => {
        this.toggleMuteChat(opt.dataset.duration);
        tooltip.style.display = 'none';
      };
    });
  }
  
  hideMuteTooltip() {
    const tooltip = document.getElementById('muteTooltip');
    if (tooltip) tooltip.style.display = 'none';
  }
  
  // Очистить историю
  showClearChatConfirm() {
    const modal = document.getElementById('confirmClearChatModal');
    if (modal) modal.classList.add('active');
  }
  
  async clearChatHistory() {
    if (!this.activeChatId) return;
    
    const messagesList = document.getElementById('messagesList');
    
    if (messagesList) {
      const messages = messagesList.querySelectorAll('.message');
      messages.forEach((msg, index) => {
        setTimeout(() => {
          msg.style.opacity = '0';
          msg.style.transform = 'translateX(-20px)';
          setTimeout(() => msg.remove(), 300);
        }, index * 50);
      });
    }
    
    const modal = document.getElementById('confirmClearChatModal');
    if (modal) modal.classList.remove('active');
    
    setTimeout(() => {
      this.messages[this.activeChatId] = [];
      if (messagesList) {
        messagesList.innerHTML = `<div class="empty-state-small"><i class="fas fa-comment-alt"></i><p>История очищена</p><p class="text-muted">Новых сообщений пока нет</p></div>`;
      }
      this.showToast('История чата очищена', 'success');
    }, messagesList?.querySelectorAll('.message').length * 50 + 300 || 500);
  }
  
  // Показать все медиа
  openMediaGallery() {
    const modal = document.getElementById('mediaGalleryModal');
    const grid = document.getElementById('mediaGalleryGrid');
    
    if (!modal || !grid || !this.activeChatId) return;
    
    const messages = this.messages[this.activeChatId] || [];
    const mediaMessages = messages.filter(m => m.type === 'image' || m.type === 'video' || m.type === 'file');
    
    if (mediaMessages.length === 0) {
      grid.innerHTML = `<div class="empty-state-small" style="grid-column: 1/-1;"><i class="fas fa-image"></i><p>Медиафайлы не найдены</p></div>`;
    } else {
      grid.innerHTML = mediaMessages.map(m => `<div class="media-gallery-item" role="listitem"><img src="${m.content}" alt="Медиа" loading="lazy"></div>`).join('');
    }
    
    modal.classList.add('active');
  }
  
  // ============ ХЕДЕР ЧАТА: КНОПКИ ============
  
  toggleRightPanel() {
    const rightPanel = document.getElementById('rightPanel');
    const btn = document.getElementById('chatInfoBtn');
    
    if (!rightPanel) return;
    
    const isActive = rightPanel.classList.contains('active');
    
    if (isActive) {
      rightPanel.classList.remove('active');
      btn?.classList.remove('active');
    } else {
      rightPanel.classList.add('active');
      btn?.classList.add('active');
    }
  }
  
  toggleChatSettings() {
    const dropdown = document.getElementById('chatSettingsDropdown');
    if (!dropdown) return;
    
    const isActive = dropdown.classList.contains('active');
    
    if (isActive) {
      dropdown.classList.remove('active');
    } else {
      document.querySelectorAll('.dropdown-menu.active').forEach(d => d.classList.remove('active'));
      dropdown.classList.add('active');
    }
  }
  
  handleChatSettingsAction(action) {
    const dropdown = document.getElementById('chatSettingsDropdown');
    if (dropdown) dropdown.classList.remove('active');
    
    switch (action) {
      case 'rename': this.renameChat(); break;
      case 'add-member': this.showToast('Добавление участников скоро будет доступно', 'info'); break;
      case 'export': this.exportChatHistory(); break;
      case 'leave': this.leaveChat(); break;
    }
  }
  
  renameChat() {
    const chatTitle = document.getElementById('chatTitle');
    if (!chatTitle) return;
    
    const newName = prompt('Введите новое название чата:', chatTitle.textContent);
    if (newName && newName.trim()) {
      chatTitle.textContent = newName.trim();
      this.showToast('Чат переименован', 'success');
    }
  }
  
  exportChatHistory() {
    if (!this.activeChatId) return;
    
    const messages = this.messages[this.activeChatId] || [];
    const exportData = { chatId: this.activeChatId, exportedAt: new Date().toISOString(), messages };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-history-${this.activeChatId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.showToast('История экспортирована', 'success');
  }
  
  leaveChat() {
    if (!this.activeChatId) return;
    
    if (confirm('Вы уверены, что хотите покинуть этот чат?')) {
      this.showToast('Вы покинули чат', 'info');
      this.activeChatId = null;
      this.closeChat();
    }
  }
  
  closeChat() {
    const emptyState = document.getElementById('emptyState');
    const messagesList = document.getElementById('messagesList');
    
    if (emptyState) emptyState.style.display = 'flex';
    if (messagesList) messagesList.style.display = 'none';
    
    ['videoCallBtn', 'voiceCallBtn', 'chatInfoBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = true;
    });
    
    const rightPanel = document.getElementById('rightPanel');
    if (rightPanel) rightPanel.classList.remove('active');
    
    document.querySelectorAll('.chat-item.active').forEach(item => item.classList.remove('active'));
  }
  
  // ============ ОБЛАСТЬ ВВОДА: КНОПКИ ============
  
  toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    
    const isActive = picker.classList.contains('active');
    
    if (isActive) {
      picker.classList.remove('active');
    } else {
      document.querySelectorAll('.attach-menu.active, .dropdown-menu.active').forEach(m => m.classList.remove('active'));
      picker.classList.add('active');
    }
  }
  
  insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    
    input.value += emoji;
    input.focus();
    
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.classList.remove('active');
  }
  
  toggleAttachMenu() {
    const menu = document.getElementById('attachMenu');
    if (!menu) return;
    
    const isActive = menu.classList.contains('active');
    
    if (isActive) {
      menu.classList.remove('active');
    } else {
      document.querySelectorAll('.emoji-picker.active, .dropdown-menu.active').forEach(m => m.classList.remove('active'));
      menu.classList.add('active');
    }
  }
  
  handleAttach(type) {
    const menu = document.getElementById('attachMenu');
    if (menu) menu.classList.remove('active');
    
    switch (type) {
      case 'photo': this.openFilePicker('image/*'); break;
      case 'file': this.openFilePicker('*'); break;
      case 'contact': this.showToast('Отправка контакта скоро будет доступна', 'info'); break;
      case 'location': this.showToast('Отправка местоположения скоро будет доступна', 'info'); break;
    }
  }
  
  openFilePicker(accept) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) this.showToast(`Файл выбран: ${file.name}`, 'success');
    };
    
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }
  
  // Голосовые сообщения
  startVoiceRecording() {
    const overlay = document.getElementById('voiceRecordingOverlay');
    if (!overlay) return;
    
    if (!navigator.mediaDevices?.getUserMedia) {
      this.showToast('Голосовые сообщения не поддерживаются', 'error');
      return;
    }
    
    overlay.classList.add('active');
    this.voiceRecordingStartTime = Date.now();
    this.voiceRecordingTimer = setInterval(() => this.updateVoiceTimer(), 1000);
  }
  
  stopVoiceRecording(cancel = false) {
    const overlay = document.getElementById('voiceRecordingOverlay');
    if (!overlay) return;
    
    overlay.classList.remove('active');
    
    if (this.voiceRecordingTimer) {
      clearInterval(this.voiceRecordingTimer);
    }
    
    if (!cancel) {
      const duration = Math.floor((Date.now() - this.voiceRecordingStartTime) / 1000);
      if (duration > 1) {
        this.showToast(`Голосовое сообщение (${duration} сек.) отправлено`, 'success');
      }
    }
    
    this.voiceRecordingStartTime = null;
  }
  
  updateVoiceTimer() {
    const timer = document.getElementById('voiceTimer');
    if (!timer || !this.voiceRecordingStartTime) return;
    
    const seconds = Math.floor((Date.now() - this.voiceRecordingStartTime) / 1000);
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    timer.textContent = `${mins}:${secs}`;
  }
  
  // ============ ИНТЕРАКТИВНЫЕ СООБЩЕНИЯ ============
  
  showContextMenu(messageEl, messageId) {
    const menu = document.getElementById('messageContextMenu');
    if (!menu) return;
    
    this.selectedMessageId = messageId;
    
    const rect = messageEl.getBoundingClientRect();
    menu.style.left = `${rect.right + 8}px`;
    menu.style.top = `${rect.top}px`;
    menu.classList.add('active');
  }
  
  hideContextMenu() {
    const menu = document.getElementById('messageContextMenu');
    if (menu) {
      menu.classList.remove('active');
      this.selectedMessageId = null;
    }
  }
  
  handleContextMenuAction(action) {
    const messageId = this.selectedMessageId;
    
    this.hideContextMenu();
    
    if (!messageId) return;
    
    switch (action) {
      case 'reply': this.showToast('Режим ответа', 'info'); break;
      case 'forward': this.showToast('Пересылка сообщения', 'info'); break;
      case 'copy': this.copyMessage(messageId); break;
      case 'delete': this.deleteMessage(messageId); break;
    }
  }
  
  copyMessage(messageId) {
    const message = document.querySelector(`.message[data-message-id="${messageId}"]`);
    const bubble = message?.querySelector('.message-bubble');
    
    if (bubble) {
      navigator.clipboard.writeText(bubble.textContent).then(() => {
        this.showToast('Текст скопирован', 'success');
      }).catch(() => {
        this.showToast('Не удалось скопировать', 'error');
      });
    }
  }
  
  deleteMessage(messageId) {
    const message = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (!message) return;
    
    message.style.opacity = '0';
    message.style.transform = 'translateX(-20px)';
    
    setTimeout(() => {
      message.remove();
      this.showToast('Сообщение удалено', 'info');
    }, 300);
  }
  
  showReactionsBubble(messageEl) {
    const bubble = document.getElementById('reactionsBubble');
    if (!bubble) return;
    
    const rect = messageEl.getBoundingClientRect();
    bubble.style.left = `${rect.left + rect.width / 2}px`;
    bubble.style.top = `${rect.top}px`;
    bubble.classList.add('active');
    
    this.selectedMessageId = messageEl.dataset.messageId;
  }
  
  hideReactionsBubble() {
    const bubble = document.getElementById('reactionsBubble');
    if (bubble) bubble.classList.remove('active');
  }
  
  addReaction(messageId, reaction) {
    const message = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (!message) return;
    
    let reactionsContainer = message.querySelector('.message-reactions');
    
    if (!reactionsContainer) {
      reactionsContainer = document.createElement('div');
      reactionsContainer.className = 'message-reactions';
      message.querySelector('.message-content').appendChild(reactionsContainer);
    }
    
    const existingReaction = reactionsContainer.querySelector(`[data-reaction="${reaction}"]`);
    
    if (existingReaction) {
      const count = existingReaction.querySelector('.reaction-count');
      if (count) {
        count.textContent = parseInt(count.textContent) + 1;
      } else {
        existingReaction.innerHTML = `${reaction}<span class="reaction-count">1</span>`;
      }
      existingReaction.classList.add('active');
    } else {
      reactionsContainer.innerHTML += `<div class="reaction active" data-reaction="${reaction}">${reaction}<span class="reaction-count">1</span></div>`;
    }
    
    this.hideReactionsBubble();
    this.showToast(`Реакция ${reaction} добавлена`, 'success');
  }
  
  initMessageInteractions() {
    let longPressTimer = null;
    let pressStartTime = 0;
    
    document.addEventListener('mousedown', (e) => {
      const message = e.target.closest('.message');
      if (message) {
        pressStartTime = Date.now();
        longPressTimer = setTimeout(() => {
          const duration = Date.now() - pressStartTime;
          if (duration >= 500) {
            this.showContextMenu(message, message.dataset.messageId);
          }
        }, 500);
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    document.addEventListener('click', (e) => {
      const message = e.target.closest('.message');
      
      const contextMenu = document.getElementById('messageContextMenu');
      if (contextMenu && !e.target.closest('.message-context-menu')) {
        this.hideContextMenu();
      }
      
      const reactionsBubble = document.getElementById('reactionsBubble');
      if (reactionsBubble && !e.target.closest('.reactions-bubble') && !e.target.closest('.reaction')) {
        this.hideReactionsBubble();
      }
    });
  }
  
  // ============ TOAST УВЕДОМЛЕНИЯ ============
  
  showToast(message, type = 'info', avatar = null, title = '') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    
    const iconClass = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' }[type] || 'fa-info-circle';
    
    toast.innerHTML = `
      <button class="toast-close"><i class="fas fa-times"></i></button>
      ${avatar ? `<div class="toast-avatar" style="background: linear-gradient(135deg, #6366f1, #8b5cf6);">${avatar}</div>` : ''}
      <div class="toast-content">
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        <div class="toast-message">${message}</div>
      </div>
    `;
    
    container.appendChild(toast);
    
    toast.querySelector('.toast-close').onclick = () => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    };
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
      }
    }, 4000);
  }
  
  // ============ СИСТЕМНЫЕ СООБЩЕНИЯ ============
  
  showSystemMessage(text) {
    const messagesArea = document.getElementById('messagesList');
    if (!messagesArea) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'system-message';
    messageEl.innerHTML = `<div class="system-message-content"><i class="fas fa-info-circle"></i> ${text}</div>`;
    
    messagesArea.appendChild(messageEl);
    this.scrollToBottom();
  }
  
  // ============ SKELETON LOADING ============
  
  showSkeletonLoading(container, count = 3) {
    const template = document.getElementById('skeletonTemplate');
    if (!template) return;
    
    container.innerHTML = '';
    
    for (let i = 0; i < count; i++) {
      const clone = template.content.cloneNode(true);
      container.appendChild(clone);
    }
  }
  
  hideSkeletonLoading(container) {
    container.querySelectorAll('.skeleton').forEach(el => el.remove());
  }
  
  // ============ LAZY LOADING ============
  
  initLazyLoading() {
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              img.removeAttribute('data-src');
            }
            observer.unobserve(img);
          }
        });
      });
      
      document.querySelectorAll('img[loading="lazy"]').forEach(img => observer.observe(img));
    }
  }
  
  // ============ PULL TO REFRESH ============
  
  initPullToRefresh() {
    const container = document.getElementById('requestsTab');
    if (!container) return;
    
    let startY = 0;
    let isRefreshing = false;
    
    container.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; });
    
    container.addEventListener('touchmove', (e) => {
      if (isRefreshing) return;
      
      const currentY = e.touches[0].clientY;
      if (currentY - startY > 100 && container.scrollTop === 0) {
        isRefreshing = true;
        this.refreshRequests();
        
        setTimeout(() => { isRefreshing = false; }, 1000);
      }
    });
  }
  
  // ============ ПРИВЯЗКА PREMIUM СОБЫТИЙ ============
  
  bindPremiumEvents() {
    // Кнопки правой панели
    document.getElementById('searchInChatBtn')?.addEventListener('click', () => this.toggleChatSearch());
    document.getElementById('pinChatBtn')?.addEventListener('click', () => this.togglePinChat());
    document.getElementById('muteChatBtn')?.addEventListener('click', (e) => {
      if (e.shiftKey) {
        this.showMuteTooltip(e.target.closest('#muteChatBtn'));
      } else {
        this.toggleMuteChat();
      }
    });
    document.getElementById('clearChatBtn')?.addEventListener('click', () => this.showClearChatConfirm());
    document.getElementById('viewAllMediaBtn')?.addEventListener('click', () => this.openMediaGallery());
    
    // Кнопки хедера
    document.getElementById('chatInfoBtn')?.addEventListener('click', () => this.toggleRightPanel());
    document.getElementById('chatSettingsBtn')?.addEventListener('click', () => this.toggleChatSettings());
    
    // Кнопки ввода
    document.getElementById('emojiBtn')?.addEventListener('click', () => this.toggleEmojiPicker());
    document.getElementById('attachBtn')?.addEventListener('click', () => this.toggleAttachMenu());
    document.getElementById('voiceBtn')?.addEventListener('mousedown', () => this.startVoiceRecording());
    document.getElementById('voiceBtn')?.addEventListener('mouseup', () => this.stopVoiceRecording());
    document.getElementById('voiceBtn')?.addEventListener('mouseleave', () => this.stopVoiceRecording());
    document.getElementById('voiceBtn')?.addEventListener('touchstart', (e) => { e.preventDefault(); this.startVoiceRecording(); });
    document.getElementById('voiceBtn')?.addEventListener('touchend', (e) => { e.preventDefault(); this.stopVoiceRecording(); });
    
    // Emoji picker
    document.querySelectorAll('.emoji-item').forEach(item => {
      item.addEventListener('click', () => this.insertEmoji(item.textContent));
    });
    
    // Attach menu
    document.querySelectorAll('.attach-menu-item').forEach(item => {
      item.addEventListener('click', () => this.handleAttach(item.dataset.type));
    });
    
    // Chat settings dropdown
    document.querySelectorAll('#chatSettingsDropdown .dropdown-item').forEach(item => {
      item.addEventListener('click', () => this.handleChatSettingsAction(item.dataset.action));
    });
    
    // Message context menu
    document.querySelectorAll('#messageContextMenu .context-menu-item').forEach(item => {
      item.addEventListener('click', () => this.handleContextMenuAction(item.dataset.action));
    });
    
    // Reactions bubble
    document.querySelectorAll('.reaction-emoji').forEach(item => {
      item.addEventListener('click', () => {
        if (this.selectedMessageId) {
          this.addReaction(this.selectedMessageId, item.dataset.reaction);
        }
      });
    });
    
    // Voice recording buttons
    document.getElementById('voiceCancelBtn')?.addEventListener('click', () => this.stopVoiceRecording(true));
    document.getElementById('voiceSendBtn')?.addEventListener('click', () => this.stopVoiceRecording(false));
    
    // Confirm clear chat
    document.getElementById('cancelClearChatBtn')?.addEventListener('click', () => {
      document.getElementById('confirmClearChatModal')?.classList.remove('active');
    });
    document.getElementById('confirmClearChatBtn')?.addEventListener('click', () => this.clearChatHistory());
    
    // Search in chat
    document.getElementById('chatSearchInput')?.addEventListener('input', (e) => this.searchInChat(e.target.value));
    document.getElementById('closeChatSearchBtn')?.addEventListener('click', () => this.toggleChatSearch());
    
    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-menu') && !e.target.closest('#chatSettingsBtn')) {
        document.getElementById('chatSettingsDropdown')?.classList.remove('active');
      }
      if (!e.target.closest('.emoji-picker') && !e.target.closest('#emojiBtn')) {
        document.getElementById('emojiPicker')?.classList.remove('active');
      }
      if (!e.target.closest('.attach-menu') && !e.target.closest('#attachBtn')) {
        document.getElementById('attachMenu')?.classList.remove('active');
      }
    });
    
    // Инициализируем взаимодействия с сообщениями
    this.initMessageInteractions();
    
    // Загружаем закрепленные и заглушенные чаты
    this.loadPinnedChats();
    this.loadMutedChats();
    
    // Инициализируем pull-to-refresh
    this.initPullToRefresh();
    
    // Инициализируем lazy loading
    this.initLazyLoading();
    
    // Инициализируем Emoji Picker
    this.emojiPicker = new EmojiPicker();
    
    // Инициализируем File Uploader
    this.fileUploader = new FileUploader();
  }
}

// ============ ГЛАВНОЕ ПРИЛОЖЕНИЕ ============

class MessengerApp {
  constructor() {
    this.ui = null;
    this.wsManager = window.WebSocketManager || getWebSocketManager();
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
    
    // Загружаем заявки в друзья при запуске
    setTimeout(async () => {
      if (this.ui) {
        const requests = await this.ui.loadFriendRequests();
        const incomingCount = (requests.incoming || []).length;
        const badge = document.getElementById('requestsBadge');
        if (badge) {
          badge.textContent = incomingCount;
          badge.style.display = incomingCount > 0 ? 'inline-flex' : 'none';
        }
      }
    }, 1000);
    
    // ============ ОБРАБОТЧИКИ WEBOCKET ДЛЯ ЗАЯВОК В ДРУЗЬЯ ============
    
    // Подписываемся на FRIEND_REQUEST
    if (this.wsManager.on) {
      this.wsManager.on('FRIEND_REQUEST', async (data) => {
        console.log('[MessengerApp] Получена заявка в друзья:', data);
        
        // Обновляем счётчик заявок
        const badge = document.getElementById('requestsBadge');
        if (badge) {
          let count = parseInt(badge.textContent) || 0;
          badge.textContent = count + 1;
          badge.style.display = 'inline-flex';
        }
        
        // Показываем desktop notification
        if (Notification.permission === 'granted') {
          new Notification('Новая заявка в друзья', {
            body: `${data.fromName || 'Пользователь'} хочет добавить вас в друзья`,
            icon: '/favicon.ico'
          });
        }
        
        // Воспроизводим звук
        this.playNotificationSound();
        
        // Обновляем список заявок если вкладка активна
        const requestsTab = document.getElementById('requestsTab');
        if (requestsTab?.classList.contains('active')) {
          await this.ui.refreshRequests();
        }
      });
      
      // Подписываемся на FRIEND_ACCEPT
      this.wsManager.on('FRIEND_ACCEPT', async (data) => {
        console.log('[MessengerApp] Заявка принята:', data);
        
        if (this.ui) {
          this.ui.showToast(`${data.fromName || 'Пользователь'} принял вашу заявку!`, 'success');
          await this.ui.loadUserData();
          this.ui.renderFriendsList();
        }
      });
      
      // Подписываемся на FRIEND_REJECT
      this.wsManager.on('FRIEND_REJECT', async (data) => {
        console.log('[MessengerApp] Заявка отклонена:', data);
        
        if (this.ui) {
          this.ui.showToast(`${data.fromName || 'Пользователь'} отклонил заявку`, 'info');
        }
      });
    }
    
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
  
  /**
   * Воспроизведение звука уведомления
   */
  playNotificationSound() {
    try {
      const audio = new Audio('/sounds/notification.mp3');
      audio.volume = 0.5;
      audio.play().catch(e => console.log('[MessengerApp] Не удалось воспроизвести звук:', e));
    } catch (e) {
      console.log('[MessengerApp] Аудио не поддерживается');
    }
  }
}

/**
 * Emoji Picker - Выбор эмодзи
 */
class EmojiPicker {
  constructor() {
    this.emojiBtn = document.getElementById('emojiBtn');
    this.emojiPicker = document.getElementById('emojiPicker');
    this.emojiGrid = document.getElementById('emojiGrid');
    this.messageInput = document.getElementById('messageInput');
    this.emojiSearch = document.getElementById('emojiSearch');
    
    this.init();
  }
  
  init() {
    // Загружаем список популярных эмодзи
    this.popularEmojis = [
      '😀', '😂', '🥰', '😎', '🤔', '👍', '❤️', '🔥', '✨', '🎉',
      '💯', '👏', '🙏', '🤝', '💪', '🧠', '💖', '🌟', '🍕', '☕',
      '🎮', '📚', '💼', '🎵', '🌈', '😢', '😡', '😴', '🤒', '🥳',
      '🎂', '🎁', '✈️', '🚗', '🏠', '💻', '📱', '📸', '💾', '💿'
    ];
    
    // Наполняем сетку эмодзи
    this.renderEmojis();
    
    // Обработчики событий
    if (this.emojiBtn) {
      this.emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePicker();
      });
    }
    
    // Закрытие при клике вне пикера
    document.addEventListener('click', (e) => {
      if (this.emojiPicker && !this.emojiPicker.contains(e.target) && 
          (!this.emojiBtn || !this.emojiBtn.contains(e.target))) {
        this.hidePicker();
      }
    });
    
    // Поиск эмодзи
    if (this.emojiSearch) {
      this.emojiSearch.addEventListener('input', (e) => {
        this.filterEmojis(e.target.value);
      });
    }
  }
  
  renderEmojis(emojis = this.popularEmojis) {
    if (!this.emojiGrid) return;
    
    this.emojiGrid.innerHTML = '';
    emojis.forEach(emoji => {
      const button = document.createElement('button');
      button.className = 'emoji-item';
      button.textContent = emoji;
      button.setAttribute('aria-label', `Эмодзи ${emoji}`);
      button.addEventListener('click', () => this.insertEmoji(emoji));
      this.emojiGrid.appendChild(button);
    });
  }
  
  filterEmojis(searchTerm) {
    if (!searchTerm) {
      this.renderEmojis();
      return;
    }
    
    // Простой фильтр - ищем совпадение в названии эмодзи
    const filtered = this.popularEmojis.filter(emoji => true); // Для простоты показываем все
    this.renderEmojis(this.popularEmojis);
  }
  
  togglePicker() {
    if (!this.emojiPicker) return;
    
    this.emojiPicker.classList.toggle('active');
    if (this.emojiPicker.classList.contains('active')) {
      // Позиционируем над кнопкой
      const rect = this.emojiBtn.getBoundingClientRect();
      this.emojiPicker.style.bottom = `${window.innerHeight - rect.top + 10}px`;
      this.emojiPicker.style.left = `${rect.left}px`;
    }
  }
  
  hidePicker() {
    if (this.emojiPicker) {
      this.emojiPicker.classList.remove('active');
    }
  }
  
  insertEmoji(emoji) {
    if (!this.messageInput) return;
    
    const start = this.messageInput.selectionStart;
    const end = this.messageInput.selectionEnd;
    const text = this.messageInput.value;
    
    this.messageInput.value = text.substring(0, start) + emoji + text.substring(end);
    this.messageInput.focus();
    this.messageInput.selectionStart = this.messageInput.selectionEnd = start + emoji.length;
    
    // Скрываем пикер после вставки
    this.hidePicker();
  }
}

/**
 * File Uploader - Загрузка файлов
 */
class FileUploader {
  constructor() {
    this.fileInput = document.getElementById('fileInput');
    this.attachBtn = document.getElementById('attachBtn');
    this.dropZone = document.getElementById('dropZone');
    this.dropOverlay = document.getElementById('dropOverlay');
    this.messageInput = document.getElementById('messageInput');
    this.sendMessageBtn = document.getElementById('sendMessageBtn');
    
    this.pendingFiles = [];
    this.init();
  }
  
  init() {
    if (!this.fileInput || !this.attachBtn) return;
    
    // Открытие файлового диалога
    this.attachBtn.addEventListener('click', () => this.fileInput.click());
    
    // Обработка выбора файлов
    this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
    
    // Drag & Drop
    if (this.dropZone) {
      this.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this.dropOverlay) this.dropOverlay.style.display = 'flex';
      });
      
      this.dropZone.addEventListener('dragleave', () => {
        if (this.dropOverlay) this.dropOverlay.style.display = 'none';
      });
      
      this.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (this.dropOverlay) this.dropOverlay.style.display = 'none';
        this.handleFiles(e.dataTransfer.files);
      });
    }
  }
  
  handleFiles(files) {
    if (!files || files.length === 0) return;
    
    // Ограничиваем количество файлов
    const maxFiles = 10;
    const filesToProcess = Array.from(files).slice(0, maxFiles);
    
    filesToProcess.forEach(file => {
      if (this.isImageFile(file)) {
        this.previewImage(file);
      } else {
        this.previewFile(file);
      }
    });
    
    // Сбрасываем input
    if (this.fileInput) this.fileInput.value = '';
  }
  
  isImageFile(file) {
    return file && file.type.startsWith('image/');
  }
  
  previewImage(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      // Создаем миниатюру изображения
      this.createImagePreview(file, e.target.result);
      
      // Добавляем в список ожидающих файлов
      this.pendingFiles.push({
        file: file,
        dataUrl: e.target.result,
        type: 'image'
      });
    };
    
    reader.onerror = () => {
      console.error('Ошибка чтения файла:', file.name);
    };
    
    reader.readAsDataURL(file);
  }
  
  previewFile(file) {
    // Для не-изображений просто добавляем информацию
    this.pendingFiles.push({
      file: file,
      name: file.name,
      size: file.size,
      type: 'file'
    });
    
    // Можно показать уведомление
    console.log('Файл добавлен:', file.name);
  }
  
  createImagePreview(file, dataUrl) {
    if (!this.messageInput) return;
    
    // Создаем элемент предпросмотра
    const preview = document.createElement('div');
    preview.className = 'image-preview';
    
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = file.name;
    
    const info = document.createElement('div');
    info.className = 'image-info';
    info.innerHTML = `
      <span>${file.name}</span>
      <small>${this.formatFileSize(file.size)}</small>
    `;
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-preview';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => {
      preview.remove();
      // Удаляем из pendingFiles
      const index = this.pendingFiles.findIndex(f => f.file === file);
      if (index > -1) this.pendingFiles.splice(index, 1);
    });
    
    preview.appendChild(img);
    preview.appendChild(info);
    preview.appendChild(removeBtn);
    
    // Вставляем перед полем ввода
    this.messageInput.parentNode.insertBefore(preview, this.messageInput);
  }
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Отправка файлов через WebSocket
   */
  sendPendingFiles(chatId) {
    if (this.pendingFiles.length === 0) return;
    
    const wsManager = getWebSocketManager();
    if (!wsManager || !wsManager.isConnected) return;
    
    this.pendingFiles.forEach(fileData => {
      if (fileData.type === 'image') {
        const message = {
          type: 'image',
          data: fileData.dataUrl,
          filename: fileData.file.name,
          size: fileData.file.size,
          timestamp: Date.now(),
          chatId: chatId
        };
        wsManager.send(message);
      }
    });
    
    // Очищаем список
    this.pendingFiles = [];
    
    // Удаляем все превью
    document.querySelectorAll('.image-preview').forEach(el => el.remove());
  }
  
  /**
   * Очистка всех файлов
   */
  clearAll() {
    this.pendingFiles = [];
    document.querySelectorAll('.image-preview').forEach(el => el.remove());
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
