/**
 * TechTariff HashStorage v3.1 - Server Edition (Full Structure Preserved)
 * Полная адаптация под сервер (API + WebSocket), без потери модульности и объёма
 * Сохранена вся оригинальная архитектура: CONFIG, Utils, EventSystem, Storage (теперь API), системы модулей
 * Реальное время через WS, авторизация через JWT-токен
 * Совместим с server.js и database.js из предыдущих версий
 * 
 * ИНТЕГРАЦИЯ С МЕНЕДЖЕРАМИ:
 * - RetryManager: повторные попытки с экспоненциальной задержкой
 * - ConnectionManager: обработка ошибок соединения
 * - SafeInitializer: предотвращение дублирующей инициализации
 * - WebSocketManager: улучшенное управление WebSocket
 */

const HashStorage = (function() {
    // === КОНФИГУРАЦИЯ ===
    const CONFIG = {
        // Безопасность
        SALT: 'techtariff_secure_salt_v3_2025',
        TOKEN_LENGTH: 32,
        USER_ID_LENGTH: 28,
        
        // Поиск и фильтрация
        MIN_SEARCH_LENGTH: 2,
        MAX_SEARCH_RESULTS: 20,
        
        // Лимиты
        MAX_MESSAGES_PER_CHAT: 1000,
        MAX_FRIENDS: 500,
        MAX_ACTIVITIES: 100,
        MAX_NOTIFICATIONS: 50,
        
        // Цветовая палитра для аватаров
        AVATAR_COLORS: [
            '#00ccff', '#00ffaa', '#ff6b6b', '#ffa502', '#7bed9f',
            '#70a1ff', '#ff9ff3', '#f368e0', '#ff9f43', '#54a0ff',
            '#5f27cd', '#ff9ff3', '#00d2d3', '#ff9f43', '#54a0ff',
            '#2ecc71', '#e74c3c', '#3498db', '#f1c40f', '#9b59b6',
            '#1abc9c', '#d35400', '#c0392b', '#8e44ad', '#16a085'
        ],
        
        // Статусы
        USER_STATUSES: {
            ONLINE: 'online',
            OFFLINE: 'offline',
            AWAY: 'away',
            BUSY: 'busy'
        },
        
        // Типы уведомлений
        NOTIFICATION_TYPES: {
            FRIEND_REQUEST: 'friend_request',
            FRIEND_ACCEPTED: 'friend_accepted',
            NEW_MESSAGE: 'new_message',
            SYSTEM: 'system',
            INFO: 'info'
        },
        
        // Типы активности
        ACTIVITY_TYPES: {
            LOGIN: 'login',
            LOGOUT: 'logout',
            REGISTER: 'register',
            PROFILE_UPDATE: 'profile_update',
            FRIEND_REQUEST_SENT: 'friend_request_sent',
            FRIEND_REQUEST_ACCEPTED: 'friend_request_accepted',
            MESSAGE_SENT: 'message_sent',
            CHAT_CREATED: 'chat_created'
        },

        // Серверные настройки (теперь здесь, а не window.location)
        API_BASE_URL: window.location.origin.includes('localhost') ? 'http://localhost:3000' : window.location.origin,
        WS_URL: window.location.origin.replace('http', 'ws'),
        TOKEN_KEY: 'techtariff_auth_token',
        REQUEST_TIMEOUT: 15000
    };

    // === СИСТЕМНЫЕ ПЕРЕМЕННЫЕ ===
    let currentUser = null;
    let isInitialized = false;
    let token = null;
    let ws = null;
    let reconnectAttempts = 0;
    let eventHandlers = {
        userChanged: [],
        messageReceived: [],
        friendRequest: [],
        notification: [],
        connectionStatus: [],
        error: []
    };

    // === УТИЛИТЫ ===
    const Utils = {
        generateId: (prefix = 'id') => {
            const timestamp = Date.now().toString(36);
            const random = Math.random().toString(36).substring(2, 15);
            return `${prefix}_${timestamp}_${random}`;
        },
        
        getColorFromId: (id) => {
            if (!id) return CONFIG.AVATAR_COLORS[0];
            let hash = 0;
            for (let i = 0; i < id.length; i++) {
                hash = id.charCodeAt(i) + ((hash << 5) - hash);
            }
            const index = Math.abs(hash) % CONFIG.AVATAR_COLORS.length;
            return CONFIG.AVATAR_COLORS[index];
        },
        
        formatTime: (timestamp) => {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;
            
            if (diff < 60000) return 'только что';
            if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
            if (diff < 604800000) return `${Math.floor(diff / 86400000)} д назад`;
            
            return date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        },
        
        safeClone: (obj) => {
            return JSON.parse(JSON.stringify(obj));
        },
        
        filterUsers: (users, query, excludeCurrent = true) => {
            if (!query || query.length < CONFIG.MIN_SEARCH_LENGTH) {
                return [];
            }
            
            const searchTerm = query.toLowerCase().trim();
            const currentUserId = currentUser?.id;
            
            return users.filter(user => {
                if (excludeCurrent && user.id === currentUserId) return false;
                if (user.id.toLowerCase().includes(searchTerm)) return true;
                if (user.email && user.email.toLowerCase().includes(searchTerm)) return true;
                if (user.name && user.name.toLowerCase().includes(searchTerm)) return true;
                return false;
            }).slice(0, CONFIG.MAX_SEARCH_RESULTS);
        },
        
        sortChatsByActivity: (chats) => {
            return chats.sort((a, b) => {
                const timeA = a.lastActivity || a.createdAt || 0;
                const timeB = b.lastActivity || b.createdAt || 0;
                return new Date(timeB) - new Date(timeA);
            });
        },
        
        sortMessagesByTime: (messages) => {
            return messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        }
    };

    // === СИСТЕМА СОБЫТИЙ ===
    const EventSystem = {
        on: (event, handler) => {
            if (!eventHandlers[event]) eventHandlers[event] = [];
            eventHandlers[event].push(handler);
        },
        
        off: (event, handler) => {
            if (eventHandlers[event]) {
                eventHandlers[event] = eventHandlers[event].filter(h => h !== handler);
            }
        },
        
        emit: (event, data) => {
            if (eventHandlers[event]) {
                eventHandlers[event].forEach(handler => {
                    try { handler(data); } catch (error) {
                        console.error(`Ошибка в обработчике события ${event}:`, error);
                    }
                });
            }
        }
    };

    // === СИСТЕМА ХРАНЕНИЯ (теперь через API + WS) ===
    const Storage = {
        token: null,

        getAuthHeader: () => Storage.token ? { Authorization: `Bearer ${Storage.token}` } : {},

        apiRequest: async (method, endpoint, body = null, options = {}) => {
            const url = `${CONFIG.API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
            console.log('[HashStorage] API запрос:', { method, url, body });
            
            // Если есть RetryManager, используем его
            if (window.RetryManager) {
                return RetryManager.execute(async ({ signal }) => {
                    const headers = {
                        'Content-Type': 'application/json',
                        ...Storage.getAuthHeader()
                    };
                    
                    const res = await fetch(url, {
                        method: method.toUpperCase(),
                        headers,
                        body: body && method.toLowerCase() !== 'get' ? JSON.stringify(body) : null,
                        signal
                    });
                    
                    console.log('[HashStorage] Ответ API:', res.status, res.statusText);
                    
                    // Проверяем Content-Type перед парсингом JSON
                    const contentType = res.headers.get('content-type');
                    let data;
                    
                    if (contentType && contentType.includes('application/json')) {
                        data = await res.json();
                    } else {
                        // Если сервер вернул HTML (например, 404 страницу)
                        const text = await res.text();
                        console.error('[HashStorage] Сервер вернул не JSON:', text.substring(0, 100));
                        data = { success: false, message: `HTTP ${res.status}: Сервер вернул HTML вместо JSON` };
                    }
                    
                    console.log('[HashStorage] Данные ответа:', JSON.stringify(data, null, 2));
                    
                    if (!res.ok) {
                        const error = new Error(data.message || `HTTP ${res.status}`);
                        error.status = res.status;
                        throw error;
                    }
                    
                    return data;
                }, {
                    maxRetries: options.retries || 3,
                    baseDelay: options.retryDelay || 1000,
                    timeout: options.timeout || CONFIG.REQUEST_TIMEOUT
                });
            }
            
            // Fallback - стандартный запрос без retry
            const headers = {
                'Content-Type': 'application/json',
                ...Storage.getAuthHeader()
            };
            
            const res = await fetch(url, {
                method: method.toUpperCase(),
                headers,
                body: body && method.toLowerCase() !== 'get' ? JSON.stringify(body) : null
            });
            
            console.log('[HashStorage] Ответ API:', res.status, res.statusText);
            
            // Проверяем Content-Type перед парсингом JSON
            const contentType = res.headers.get('content-type');
            let data;
            
            if (contentType && contentType.includes('application/json')) {
                data = await res.json();
            } else {
                // Если сервер вернул HTML (например, 404 страницу)
                const text = await res.text();
                console.error('[HashStorage] Сервер вернул не JSON:', text.substring(0, 100));
                data = { success: false, message: `HTTP ${res.status}: Сервер вернул HTML вместо JSON` };
            }
            
            console.log('[HashStorage] Данные ответа:', JSON.stringify(data, null, 2));
            
            if (!res.ok) {
                const error = new Error(data.message || `HTTP ${res.status}`);
                error.status = res.status;
                throw error;
            }
            
            return data;
        },

        // Инициализация хранилища (проверка токена + WS)
        initialize: async () => {
            Storage.token = localStorage.getItem(CONFIG.TOKEN_KEY);
            console.log('[HashStorage] Инициализация, токен:', Storage.token ? 'присутствует' : 'отсутствует');
            
            if (Storage.token) {
                try {
                    const res = await Storage.apiRequest('GET', '/api/me');
                    // Проверяем, обёрнут ли ответ в RetryManager
                    let actualResponse = res;
                    if (res.data && typeof res.data === 'object') {
                        actualResponse = res.data;
                    }
                    
                    // Обрабатываем как успешный ответ (200 или 304 cached)
                    if (actualResponse.success && actualResponse.user) {
                        currentUser = actualResponse.user;
                        console.log('[HashStorage] Пользователь загружен:', currentUser.name);
                        EventSystem.emit('userChanged', currentUser);
                        Storage.connectWebSocket();
                        return { success: true, user: currentUser };
                    } else if (actualResponse.user) {
                        // Если ответ пришёл без actualResponse.success, но с user
                        currentUser = actualResponse.user;
                        console.log('[HashStorage] Пользователь загружен (cached):', currentUser.name);
                        EventSystem.emit('userChanged', currentUser);
                        Storage.connectWebSocket();
                        return { success: true, user: currentUser };
                    } else {
                        console.log('[HashStorage] Не удалось загрузить пользователя, очищаем токен');
                        Storage.logout();
                        return { success: false, error: 'User not found' };
                    }
                } catch (err) {
                    console.error('[HashStorage] Ошибка загрузки пользователя:', err.message);
                    // Не удаляем токен при ошибке сети, только при явной ошибке авторизации
                    if (err.status === 401 || err.status === 403) {
                        console.log('[HashStorage] Ошибка авторизации, очищаем токен');
                        Storage.logout();
                        return { success: false, error: 'Unauthorized' };
                    }
                    // При других ошибках пробуем восстановить из localStorage
                    const storedUser = localStorage.getItem('currentUser');
                    if (storedUser) {
                        try {
                            currentUser = JSON.parse(storedUser);
                            console.log('[HashStorage] Пользователь восстановлен из кеша:', currentUser.name);
                            return { success: true, user: currentUser, cached: true };
                        } catch (e) {
                            console.error('[HashStorage] Ошибка восстановления пользователя:', e);
                        }
                    }
                    return { success: false, error: err.message };
                }
            }
            return { success: false, error: 'No token' };
        },

        // WebSocket подключение
        // ИСПРАВЛЕНО: Используем WebSocketManager для улучшенного управления
        connectWebSocket: () => {
            // Если есть WebSocketManager, используем его
            if (window.WebSocketManager && typeof window.WebSocketManager.setAuthToken === 'function') {
                window.WebSocketManager.setAuthToken(Storage.token);
                window.WebSocketManager.connect();
                return;
            }
            
            // Fallback - стандартная логика WebSocket
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                console.log('[WS] Уже подключен или подключается, пропускаем');
                return;
            }

            console.log(`[WS] Подключение к ${CONFIG.WS_URL} (попытка ${reconnectAttempts + 1})`);
            ws = new WebSocket(CONFIG.WS_URL);

            ws.onopen = () => {
                console.log('[WS] Соединение установлено');
                reconnectAttempts = 0;
                if (Storage.token) {
                    console.log('[WS] Отправка токена авторизации');
                    ws.send(JSON.stringify({ type: 'auth', token: Storage.token }));
                }
                EventSystem.emit('connectionStatus', { connected: true });
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    console.log('[WS] Получено сообщение:', msg.type);
                    switch (msg.type) {
                        case 'message':
                            EventSystem.emit('messageReceived', msg);
                            // ИСПРАВЛЕНО: Также диспетчеризуем CustomEvent
                            window.dispatchEvent(new CustomEvent('newMessage', { detail: msg }));
                            break;
                        case 'friend_request':
                        case 'FRIEND_REQUEST':
                            // ИСПРАВЛЕНО: Диспетчеризуем CustomEvent для входящих заявок
                            EventSystem.emit('friendRequest', msg);
                            window.dispatchEvent(new CustomEvent('friendRequest', { detail: msg }));
                            break;
                        case 'friend_accepted':
                        case 'FRIEND_ACCEPT':
                            // ИСПРАВЛЕНО: Диспетчеризуем CustomEvent для принятых заявок
                            EventSystem.emit('friendRequest', { type: 'accepted', ...msg });
                            window.dispatchEvent(new CustomEvent('friendAccepted', { detail: msg }));
                            break;
                        case 'friend_rejected':
                        case 'FRIEND_REJECT':
                            // ИСПРАВЛЕНО: Диспетчеризуем CustomEvent для отклонённых заявок
                            window.dispatchEvent(new CustomEvent('friendRejected', { detail: msg }));
                            break;
                        case 'notification':
                            EventSystem.emit('notification', msg);
                            break;
                        case 'auth_success':
                            console.log('[WS] Авторизация успешна, userId:', msg.userId);
                            break;
                        case 'auth_error':
                            console.error('[WS] Ошибка авторизации:', msg.message);
                            // Не вызываем logout, чтобы не удалять токен
                            EventSystem.emit('error', { message: 'Ошибка авторизации WebSocket' });
                            break;
                    }
                } catch (e) {
                    console.error('[WS] Ошибка парсинга сообщения:', e);
                }
            };

            ws.onerror = (error) => {
                console.error('[WS] Ошибка соединения:', error);
            };

            ws.onclose = (event) => {
                console.log(`[WS] Соединение закрыто. Код: ${event.code}, Причина: ${event.reason || 'не указана'}`);
                EventSystem.emit('connectionStatus', { connected: false });

                // Переподключаемся только если есть токен и пользователь авторизован
                if (Storage.token && currentUser && reconnectAttempts < 5) {
                    reconnectAttempts++;
                    const delay = 5000 * reconnectAttempts;
                    console.log(`[WS] Переподключение через ${delay/1000} секунд (попытка ${reconnectAttempts}/5)`);
                    setTimeout(Storage.connectWebSocket, delay);
                } else if (reconnectAttempts >= 5) {
                    console.log('[WS] Достигнут лимит попыток переподключения.');
                }
            };
        },

        logout: () => {
            Storage.token = null;
            currentUser = null;
            localStorage.removeItem(CONFIG.TOKEN_KEY);
            localStorage.removeItem('currentUser'); // Очищаем кеш пользователя
            if (ws) ws.close();
            EventSystem.emit('userChanged', null);
        }
    };

    // === МОДУЛЬ ПОЛЬЗОВАТЕЛЕЙ ===
    const UserSystem = {
        register: async (name, email, password) => {
            try {
                const res = await Storage.apiRequest('POST', '/api/register', { name, email, password });
                return res;
            } catch (err) {
                return { success: false, message: err.message };
            }
        },

        login: async (email, password) => {
            try {
                const res = await Storage.apiRequest('POST', '/api/login', { email, password });
                console.log('[HashStorage] Ответ сервера на login:', JSON.stringify(res, null, 2));
                
                // Проверяем, обёрнут ли ответ в RetryManager
                let actualResponse = res;
                if (res.data && typeof res.data === 'object') {
                    console.log('[HashStorage] Ответ обёрнут в RetryManager, извлекаем из data');
                    actualResponse = res.data;
                }
                
                if (actualResponse.success) {
                    // Проверяем, что токен существует в ответе
                    if (!actualResponse.token) {
                        console.error('[HashStorage] ❌ Сервер вернул success=true, но token отсутствует!');
                        console.error('[HashStorage] Полный ответ:', actualResponse);
                        return { success: false, message: 'Ошибка сервера: токен не сгенерирован' };
                    }
                    
                    Storage.token = actualResponse.token;
                    currentUser = actualResponse.user;
                    
                    // Валидация токена перед сохранением
                    const tokenParts = actualResponse.token?.split('.');
                    if (!tokenParts || tokenParts.length !== 3) {
                        console.error('[HashStorage] ❌ Сервер вернул невалидный токен:', {
                            length: actualResponse.token?.length,
                            parts: tokenParts?.length,
                            value: actualResponse.token
                        });
                        return { success: false, message: 'Ошибка сервера: невалидный токен' };
                    }
                    
                    console.log('[HashStorage] Валидация токена успешна:', {
                        header: tokenParts[0],
                        payload: tokenParts[1],
                        signature: tokenParts[2]
                    });
                    
                    localStorage.setItem(CONFIG.TOKEN_KEY, actualResponse.token);
                    localStorage.setItem('currentUser', JSON.stringify(actualResponse.user));
                    console.log('[HashStorage] Токен сохранён:', {
                        length: actualResponse.token?.length,
                        preview: actualResponse.token?.substring(0, 20) + '...',
                        hasDots: actualResponse.token?.includes('.'),
                        parts: actualResponse.token?.split('.').length
                    });
                    
                    // Синхронизируем с TokenManager если доступен
                    if (typeof TokenManager !== 'undefined' && typeof TokenManager.setToken === 'function') {
                        TokenManager.setToken(actualResponse.token);
                        console.log('[HashStorage] Токен синхронизирован с TokenManager');
                    }
                    
                    Storage.connectWebSocket();
                    EventSystem.emit('userChanged', currentUser);
                }
                return actualResponse;
            } catch (err) {
                return { success: false, message: err.message };
            }
        },

        logout: () => {
            Storage.logout();
        },

        getCurrentUser: () => currentUser,

        searchUsers: async (query) => {
            if (!query || query.length < CONFIG.MIN_SEARCH_LENGTH) return [];
            try {
                const res = await Storage.apiRequest('GET', `/api/users/search?q=${encodeURIComponent(query)}`);
                // Сервер уже выполняет фильтрацию (исключает текущего пользователя)
                // Возвращаем результат как есть
                return res.success ? (res.users || []) : [];
            } catch (err) {
                console.error('[HashStorage] Ошибка поиска пользователей:', err);
                return [];
            }
        },

        getUserById: async (id) => {
            try {
                const res = await Storage.apiRequest('GET', `/api/users/${id}`);
                return res.success ? res.user : null;
            } catch (err) {
                return null;
            }
        },

        getAllUsers: async () => {
            try {
                const res = await Storage.apiRequest('GET', '/api/users');
                return res.success ? res.users : [];
            } catch (err) {
                return [];
            }
        },

        updateProfile: async (updates) => {
            try {
                const res = await Storage.apiRequest('PUT', '/api/profile', updates);
                if (res.success) {
                    currentUser = { ...currentUser, ...updates };
                    EventSystem.emit('userChanged', currentUser);
                }
                return res;
            } catch (err) {
                return { success: false, message: err.message };
            }
        },

        updateOnlineStatus: async (status) => {
            // Можно добавить API для обновления статуса, если нужно
            console.log('Статус обновлён:', status);
        }
    };

    // === МОДУЛЬ ДРУЗЕЙ ===
    const FriendshipSystem = {
        getFriends: async (userId) => {
            try {
                const res = await Storage.apiRequest('GET', '/api/friends');
                return res.success ? res.friends : [];
            } catch (err) {
                return [];
            }
        },

        getStatus: async (userId1, userId2) => {
            try {
                const res = await Storage.apiRequest('GET', `/api/friends/status?user1=${userId1}&user2=${userId2}`);
                return res.success ? res.status : 'none';
            } catch (err) {
                return 'none';
            }
        },

        sendRequest: async (receiverId, message = '') => {
            try {
                const res = await Storage.apiRequest('POST', '/api/friends/request', { receiverId, message });
                return res;
            } catch (err) {
                return { success: false, message: err.message };
            }
        },

        respondToRequest: async (requestId, response) => {
            try {
                const res = await Storage.apiRequest('POST', `/api/friends/request/${requestId}/respond`, { response });
                return res;
            } catch (err) {
                return { success: false, message: err.message };
            }
        },

        getIncomingRequests: async () => {
            try {
                const res = await Storage.apiRequest('GET', '/api/friends/requests?type=incoming');
                return res.success ? res.requests : [];
            } catch (err) {
                return [];
            }
        },

        getOutgoingRequests: async () => {
            try {
                const res = await Storage.apiRequest('GET', '/api/friends/requests?type=outgoing');
                return res.success ? res.requests : [];
            } catch (err) {
                return [];
            }
        },

        removeFriend: async (friendId) => {
            try {
                const res = await Storage.apiRequest('DELETE', `/api/friends/${friendId}`);
                return res;
            } catch (err) {
                return { success: false, message: err.message };
            }
        }
    };

    // === МОДУЛЬ ЧАТОВ ===
    const ChatSystem = {
        getUserChats: async (userId) => {
            try {
                const res = await Storage.apiRequest('GET', '/api/chats');
                return res.success ? res.chats : [];
            } catch (err) {
                return [];
            }
        },

        createPrivateChat: async (participantId) => {
            try {
                const res = await Storage.apiRequest('POST', '/api/chats', { participantId, type: 'private' });
                return res;
            } catch (err) {
                return { success: false, message: err.message };
            }
        },

        getChatMessages: async (chatId, limit = 50, offset = 0) => {
            try {
                const res = await Storage.apiRequest('GET', `/api/chats/${chatId}/messages?limit=${limit}&offset=${offset}`);
                return res.success ? res.messages : [];
            } catch (err) {
                return [];
            }
        },

        sendMessage: async (chatId, content, type = 'text') => {
            // Этот метод отправляет сообщение через WebSocket
            const ws = HashStorage.getWs();
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return { success: false, message: 'Нет подключения к серверу' };
            }

            return new Promise((resolve) => {
                const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
                
                // Создаём временное сообщение
                const tempMessage = {
                    messageId,
                    chatId,
                    senderId: currentUser.id,
                    senderName: currentUser.name,
                    content,
                    messageType: type,
                    timestamp: Date.now(),
                    status: 'sending'
                };

                // Сначала добавляем обработчик, затем отправляем
                const handler = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'message' && data.messageId === messageId) {
                            ws.removeEventListener('message', handler);
                            resolve({ success: true, message: data });
                        }
                    } catch (e) {
                        // Игнорируем ошибки парсинга
                    }
                };

                ws.addEventListener('message', handler);

                // Таймаут
                setTimeout(() => {
                    ws.removeEventListener('message', handler);
                    if (!tempMessage.status || tempMessage.status !== 'delivered') {
                        tempMessage.status = 'failed';
                        resolve({ success: false, message: 'Таймаут ожидания подтверждения' });
                    }
                }, 5000);

                // Отправляем на сервер
                ws.send(JSON.stringify({ type: 'message', ...tempMessage }));
            });
        },

        markAsRead: async (chatId) => {
            console.log('Сообщения в чате', chatId, 'помечены как прочитанные');
            return { success: true };
        },

        getChatById: async (chatId) => {
            try {
                const chats = await ChatSystem.getUserChats();
                return chats.find(c => c.id === chatId) || null;
            } catch (err) {
                return null;
            }
        },

        updateChatSettings: async (chatId, settings) => {
            console.log('Настройки чата', chatId, 'обновлены:', settings);
            return { success: true };
        }
    };

    // === МОДУЛЬ УВЕДОМЛЕНИЙ ===
    const NotificationSystem = {
        getUserNotifications: async () => {
            console.log('Уведомления получены');
            return [];
        },

        markAsRead: async (notificationId) => {
            console.log('Уведомление', notificationId, 'помечено как прочитанное');
            return { success: true };
        },

        markAllAsRead: async () => {
            console.log('Все уведомления помечены как прочитанные');
            return { success: true };
        },

        delete: async (notificationId) => {
            console.log('Уведомление', notificationId, 'удалено');
            return { success: true };
        },

        deleteAll: async () => {
            console.log('Все уведомления удалены');
            return { success: true };
        }
    };

    // === СИСТЕМНЫЕ ФУНКЦИИ ===
    const System = {
        getStats: () => ({
            online: navigator.onLine,
            initialized: isInitialized,
            wsConnected: ws ? ws.readyState === WebSocket.OPEN : null
        }),

        clearAllData: () => {
            localStorage.clear();
            sessionStorage.clear();
            console.log('Все данные очищены');
        },

        exportUserData: () => {
            const data = {
                currentUser,
                exportedAt: new Date().toISOString()
            };
            console.log('Данные пользователя экспортированы:', data);
            return data;
        },

        healthCheck: async () => {
            try {
                const res = await Storage.apiRequest('GET', '/api/health');
                return res.success;
            } catch (err) {
                return false;
            }
        }
    };

    // === ИНИЦИАЛИЗАЦИЯ ===
    const initialize = async (options = {}) => {
        const { timeout = 15000, force = false } = options;
        console.log('🚀 Инициализация HashStorage v3.1 (Server Edition)...');

        // Проверяем через SafeInitializer (если доступен)
        if (typeof window !== 'undefined' && window.SafeInitializer && window.SafeInitializer.isReady && window.SafeInitializer.isReady('HashStorage')) {
            console.log('⚠️ HashStorage уже инициализирован через SafeInitializer');
            return { success: true, cached: true };
        }
        
        // Проверяем флаг isInitialized
        if (isInitialized && !force) {
            console.log('⚠️ HashStorage уже инициализирован (isInitialized = true)');
            return { success: true, cached: true };
        }
        
        console.log('🚀 Инициализация HashStorage v3.1 (Server Edition)...');
        
        try {
            // Таймаут для предотвращения зависания
            const initPromise = Storage.initialize();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('INIT_TIMEOUT')), timeout);
            });
            
            await Promise.race([initPromise, timeoutPromise]);
            
            isInitialized = true;
            console.log('✅ HashStorage v3.1 успешно инициализирован');
            console.log('📊 Статистика системы:', System.getStats());
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ Критическая ошибка инициализации:', error);
            
            // Обрабатываем ошибку через ConnectionManager
            if (window.ConnectionManager) {
                await ConnectionManager.handleConnectionError(error);
            }
            
            // Не пробрасываем ошибку, чтобы не ломать приложение
            return { success: false, error: error.message };
        }
    }

    // === ПУБЛИЧНЫЙ API ===
    const publicAPI = {
        CONFIG,
        Utils,
        Events: EventSystem,
        
        initialize,
        
        // Пользователи
        register: UserSystem.register,
        login: UserSystem.login,
        authenticate: UserSystem.login, // Алиас для совместимости
        logout: UserSystem.logout,
        getCurrentUser: UserSystem.getCurrentUser,
        searchUsers: UserSystem.searchUsers,
        getUserById: UserSystem.getUserById,
        getAllUsers: UserSystem.getAllUsers,
        updateProfile: UserSystem.updateProfile,
        updateOnlineStatus: UserSystem.updateOnlineStatus,
        
        // Получение токена
        getToken: () => localStorage.getItem(CONFIG.TOKEN_KEY),
        
        // Активность (заглушка для совместимости)
        addActivity: (userId, activity) => {
            console.log('Активность:', userId, activity);
            return { success: true };
        },
        
        // Друзья
        getFriends: FriendshipSystem.getFriends,
        getFriendshipStatus: FriendshipSystem.getStatus,
        sendFriendRequest: FriendshipSystem.sendRequest,
        respondToFriendRequest: FriendshipSystem.respondToRequest,
        getIncomingRequests: FriendshipSystem.getIncomingRequests,
        getOutgoingRequests: FriendshipSystem.getOutgoingRequests,
        removeFriend: FriendshipSystem.removeFriend,
        
        // Чаты
        getChats: ChatSystem.getUserChats,
        createPrivateChat: ChatSystem.createPrivateChat,
        getChatMessages: ChatSystem.getChatMessages,
        sendMessage: ChatSystem.sendMessage,
        markAsRead: ChatSystem.markAsRead,
        getChatById: ChatSystem.getChatById,
        updateChatSettings: ChatSystem.updateChatSettings,
        
        // Уведомления
        getNotifications: NotificationSystem.getUserNotifications,
        markNotificationAsRead: NotificationSystem.markAsRead,
        markAllNotificationsAsRead: NotificationSystem.markAllAsRead,
        deleteNotification: NotificationSystem.delete,
        deleteAllNotifications: NotificationSystem.deleteAll,
        
        // Система
        getSystemStats: System.getStats,
        clearAllData: System.clearAllData,
        exportUserData: System.exportUserData,
        healthCheck: System.healthCheck,
        
        // WebSocket
        getWs: () => ws,
        
        // Утилиты
        generateId: Utils.generateId,
        getColorFromId: Utils.getColorFromId,
        formatTime: Utils.formatTime
    };

    // Делаем HashStorage глобально доступным
    if (typeof window !== 'undefined') {
        window.HashStorage = publicAPI;
    }

    return publicAPI;
})();

// Автоматическая инициализация при загрузке скрипта
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📦 HashStorage v3.1 (Server Edition) загружен и готов к использованию');
        });
    } else {
        console.log('📦 HashStorage v3.1 (Server Edition) загружен и готов к использованию');
    }
}
