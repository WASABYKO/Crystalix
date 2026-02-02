/**
 * WebSocketManager v2.0
 * Улучшенное управление WebSocket соединением с автоматическим
 * переподключением, буферизацией сообщений и синхронизацией с AuthManager
 */

class WebSocketManager {
    constructor() {
        this.socket = null;
        this.url = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.baseReconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.reconnectDelay = this.baseReconnectDelay;
        
        this.messageQueue = [];
        this.pendingMessages = new Map();
        this.handlers = new Map();
        
        this.isConnected = false;
        this.isConnecting = false;
        this.isIntentionalClose = false;
        
        this.heartbeatInterval = null;
        this.heartbeatTimeout = null;
        this.heartbeatDelay = 30000;
        
        this.messageIdCounter = 0;
        
        this.authToken = null;
        this.reconnectTimer = null;
        
        this.initialized = false;
    }
    
    /**
     * Проверка, является ли текущая страница страницей авторизации
     */
    isAuthPage() {
        const path = window.location.pathname.toLowerCase();
        return path.includes('auth') || path === '/auth.html';
    }

    /**
     * Проверка, следует ли подключаться к WebSocket
     */
    shouldConnect() {
        // Не подключаемся на странице авторизации
        if (this.isAuthPage()) {
            console.log('[WebSocketManager] Страница авторизации - пропускаем подключение');
            return false;
        }

        // Не подключаемся, если нет токена
        if (!this.authToken) {
            console.log('[WebSocketManager] Токен отсутствует - пропускаем подключение');
            return false;
        }

        return true;
    }

    /**
     * Инициализация WebSocketManager
     */
    async initialize(url = null) {
        if (this.initialized) {
            console.warn('⚠️ WebSocketManager уже инициализирован');
            return this;
        }

        this.url = url || this.getDefaultUrl();
        this.authToken = this.getAuthToken();

        // Подписка на события AuthManager
        if (typeof AuthManager !== 'undefined') {
            AuthManager.on('tokenRefresh', (newToken) => {
                this.authToken = newToken;
                this.sendAuthRefresh();
            });

            AuthManager.on('logout', () => {
                this.handleLogout();
            });
        }

        // Подписка на события TokenManager
        if (typeof TokenManager !== 'undefined') {
            TokenManager.on('tokenChanged', ({ token }) => {
                console.log('[WebSocketManager] Токен изменен, обновляем');
                this.authToken = token;
                if (this.isConnected) {
                    this.sendAuthRefresh();
                } else if (this.shouldConnect()) {
                    // Если токен появился и можно подключаться - подключаемся
                    this.connect();
                }
            });

            TokenManager.on('tokenCleared', () => {
                console.log('[WebSocketManager] Токен очищен, отключаемся');
                this.disconnect();
            });
        }

        // Проверка online/offline
        window.addEventListener('online', () => {
            if (!this.isConnected && !this.isConnecting && this.shouldConnect()) {
                this.scheduleReconnect();
            }
        });

        window.addEventListener('offline', () => {
            this.handleDisconnect();
        });

        // Синхронизация между вкладками через BroadcastChannel
        this.setupTabSync();

        // Сохранение состояния при навигации
        this.setupNavigationHandler();

        this.initialized = true;
        console.log('✅ WebSocketManager инициализирован');

        // Автоматическое подключение только если есть токен и не страница авторизации
        if (this.shouldConnect()) {
            this.connect();
        } else {
            console.log('[WebSocketManager] Подключение отложено (нет токена или страница авторизации)');
        }

        return this;
    }

    /**
     * Настройка синхронизации между вкладками
     */
    setupTabSync() {
        try {
            this.broadcastChannel = new BroadcastChannel('websocket_sync');

            this.broadcastChannel.onmessage = (event) => {
                const { type, data } = event.data;

                switch (type) {
                    case 'connected':
                        console.log('[WebSocketManager] Другая вкладка подключилась к WebSocket');
                        // Если эта вкладка подключена, можно отключиться для экономии ресурсов
                        if (this.isConnected && !this.isPrimaryTab) {
                            console.log('[WebSocketManager] Отключаемся, т.к. другая вкладка уже подключена');
                            this.disconnect();
                        }
                        break;

                    case 'disconnected':
                        console.log('[WebSocketManager] Другая вкладка отключилась от WebSocket');
                        // Если эта вкладка является основной, переподключаемся
                        if (!this.isConnected && this.isPrimaryTab) {
                            console.log('[WebSocketManager] Переподключаемся как основная вкладка');
                            this.connect();
                        }
                        break;

                    case 'auth_success':
                        console.log('[WebSocketManager] Другая вкладка успешно авторизовалась');
                        break;
                }
            };

            console.log('[WebSocketManager] BroadcastChannel настроен');
        } catch (e) {
            console.warn('[WebSocketManager] BroadcastChannel не поддерживается:', e);
        }
    }

    /**
     * Настройка обработчика навигации
     */
    setupNavigationHandler() {
        // Сохраняем состояние перед навигацией
        window.addEventListener('beforeunload', () => {
            if (this.broadcastChannel && this.isConnected) {
                this.broadcastChannel.postMessage({
                    type: 'connected',
                    data: { timestamp: Date.now() }
                });
            }
        });

        // Восстанавливаем состояние после навигации
        window.addEventListener('load', () => {
            if (this.broadcastChannel) {
                this.broadcastChannel.postMessage({
                    type: 'check_primary',
                    data: { timestamp: Date.now() }
                });
            }
        });

        // Определяем основную вкладку
        this.isPrimaryTab = !sessionStorage.getItem('websocket_secondary_tab');
        if (!this.isPrimaryTab) {
            console.log('[WebSocketManager] Эта вкладка является вторичной');
        }
    }
    
    /**
     * Получение URL по умолчанию
     */
    getDefaultUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname;
        const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        return `${protocol}//${host}:${port}/ws`;
    }
    
    /**
     * Получение токена авторизации
     */
    getAuthToken() {
        // Используем TokenManager если доступен
        if (typeof TokenManager !== 'undefined') {
            const token = TokenManager.getToken();
            if (token) {
                console.log('[WebSocketManager] Токен получен через TokenManager:', {
                    length: token?.length,
                    preview: token?.substring(0, 30) + '...',
                    parts: token?.split('.').length,
                    isValidJWT: token?.split('.').length === 3
                });
                return token;
            }
        }

        // Fallback: пробуем разные источники токена
        if (typeof HashStorage !== 'undefined' && HashStorage.get) {
            const session = HashStorage.get('session');
            if (session?.token) {
                console.log('[WebSocketManager] Токен получен из HashStorage session');
                return session.token;
            }
        }

        // Проверяем techtariff_auth_token (используется AuthManager)
        const techtariffToken = localStorage.getItem('techtariff_auth_token');
        if (techtariffToken) {
            console.log('[WebSocketManager] Токен получен из localStorage techtariff_auth_token:', {
                length: techtariffToken?.length,
                preview: techtariffToken?.substring(0, 30) + '...',
                parts: techtariffToken?.split('.').length
            });
            return techtariffToken;
        }

        // Проверяем authToken (для обратной совместимости)
        const authToken = localStorage.getItem('authToken');
        if (authToken) {
            console.log('[WebSocketManager] Токен получен из localStorage authToken');
            return authToken;
        }

        // Проверяем sessionStorage
        const sessionToken = sessionStorage.getItem('authToken');
        if (sessionToken) {
            console.log('[WebSocketManager] Токен получен из sessionStorage');
            return sessionToken;
        }

        console.log('[WebSocketManager] Токен не найден нигде');
        return null;
    }
    
    /**
     * Извлечение токена из URL
     */
    extractTokenFromUrl() {
        const params = new URLSearchParams(window.location.hash.substring(1));
        return params.get('token');
    }
    
    /**
     * Установка токена вручную
     */
    setAuthToken(token) {
        this.authToken = token;
        localStorage.setItem('authToken', token);
    }
    
    /**
     * Подключение к WebSocket серверу
     */
    connect() {
        if (this.isConnected || this.isConnecting) {
            console.warn('⚠️ Уже подключено или выполняется подключение');
            return;
        }
        
        this.isConnecting = true;
        this.isIntentionalClose = false;
        
        try {
            // Добавляем токен к URL если есть
            const connectionUrl = this.authToken 
                ? `${this.url}?token=${encodeURIComponent(this.authToken)}`
                : this.url;
            
            this.socket = new WebSocket(connectionUrl);
            
            this.socket.onopen = (event) => this.handleOpen(event);
            this.socket.onmessage = (event) => this.handleMessage(event);
            this.socket.onclose = (event) => this.handleClose(event);
            this.socket.onerror = (event) => this.handleError(event);
            
            console.log('🔌 Попытка подключения к WebSocket...');
            
        } catch (error) {
            console.error('❌ Ошибка создания WebSocket:', error);
            this.handleConnectionError(error);
        }
    }
    
    /**
     * Обработка открытия соединения
     */
    handleOpen(event) {
        console.log('✅ WebSocket подключен');

        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = this.baseReconnectDelay;
        
        // Обновляем индикатор статуса
        this.updateConnectionStatus('connected', 'Подключено');

        // Отправляем авторизацию
        this.sendAuth();

        // Запускаем heartbeat
        this.startHeartbeat();

        // Отправляем забуферизованные сообщения
        this.flushMessageQueue();

        // Синхронизируем состояние с сервером
        this.syncState();

        // Уведомляем обработчики
        this.emit('connected', event);

        // Уведомляем AuthManager
        if (typeof AuthManager !== 'undefined') {
            AuthManager.emit('wsConnected');
        }

        // Уведомляем другие вкладки через BroadcastChannel
        if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({
                type: 'connected',
                data: { timestamp: Date.now() }
            });
        }
    }
    
    /**
     * Обработка входящего сообщения
     */
    handleMessage(event) {
        try {
            const data = typeof event.data === 'string' 
                ? JSON.parse(event.data) 
                : event.data;
            
            // Проверяем heartbeat ответ
            if (data.type === 'pong') {
                this.handlePong();
                return;
            }
            
            // Проверяем есть ли ожидающий обработчик (только для ack)
            if (data.type === 'ack' && data.id && this.pendingMessages.has(data.id)) {
                const pending = this.pendingMessages.get(data.id);
                pending.resolve(data);
                this.pendingMessages.delete(data.id);
                console.log(`[WebSocketManager] Получен ACK для сообщения ${data.id}`);
                return; // Не диспетчеризуем ACK сообщения
            }
            
            // Обрабатываем по типу сообщения
            this.dispatchMessage(data);
            
        } catch (error) {
            console.error('❌ Ошибка обработки сообщения:', error);
        }
    }
    
    /**
     * Диспетчеризация сообщения по типу
     */
    dispatchMessage(data) {
        const handlers = {
            'auth_required': () => this.handleAuthRequired(),
            'auth_success': () => this.handleAuthSuccess(data),
            'auth_error': () => this.handleAuthError(data),
            'state_update': () => this.handleStateUpdate(data),
            'notification': () => this.handleNotification(data),
            'error': () => this.handleServerError(data),
            'ping': () => this.sendPong(),
            'message': () => this.handleChatMessage(data),
            // Обработчики друзей
            'FRIEND_REQUEST': () => this.handleFriendRequestWS(data),
            'FRIEND_ACCEPT': () => this.handleFriendAcceptWS(data),
            'FRIEND_REJECT': () => this.handleFriendRejectWS(data),
            'friend_request': () => this.handleFriendRequest(data),
            'friend_accepted': () => this.handleFriendAccepted(data),
            'ack': () => this.handleAck(data),
            'delivery_confirmation': () => this.handleDeliveryConfirmation(data),
            'read_confirmation': () => this.handleReadConfirmation(data),
            // Обработчики звонков
            'CALL_OFFER': () => this.handleCallOffer(data),
            'CALL_ANSWER': () => this.handleCallAnswer(data),
            'CALL_ICE_CANDIDATE': () => this.handleCallIceCandidate(data),
            'CALL_REJECT': () => this.handleCallReject(data),
            'CALL_END': () => this.handleCallEnd(data),
            'CALL_TIMEOUT': () => this.handleCallTimeout(data)
        };
        
        const handler = handlers[data.type] || handlers['state_update'];
        if (handler) {
            handler();
        }
        
        // Уведомляем общие обработчики
        this.emit('message', data);
    }
    
    /**
     * Обработка подтверждения (ACK)
     */
    handleAck(data) {
        // ACK теперь обрабатывается в handleMessage, этот метод оставлен для совместимости
        console.log(`[WebSocketManager] ACK получен:`, data.messageId);
    }
    
    /**
     * Обработка входящего сообщения чата
     * ИСПРАВЛЕНО: Добавлена диспетчеризация CustomEvent 'newMessage' для совместимости с UIManager
     */
    handleChatMessage(data) {
        console.log('📩 Получено сообщение:', data);
        this.emit('chatMessage', data);
        
        // ДИСПЕТЧЕРИЗУЕМ CustomEvent 'newMessage' для совместимости с UIManager
        // Это обеспечивает работу со старым кодом, который ожидает событие 'newMessage'
        window.dispatchEvent(new CustomEvent('newMessage', { detail: data }));
        console.log('[WebSocketManager] CustomEvent newMessage отправлен для messageId:', data.messageId);
        
        // Уведомляем HashStorage для совместимости
        if (typeof HashStorage !== 'undefined') {
            HashStorage.Events?.emit?.('messageReceived', data);
        }
    }
    
    /**
     * Обработка входящей заявки в друзья
     */
    handleFriendRequest(data) {
        console.log('👥 Получена заявка в друзья:', data);
        this.emit('friendRequest', data);
        
        if (typeof HashStorage !== 'undefined') {
            HashStorage.Events?.emit?.('friendRequest', data);
        }
    }
    
    /**
     * Обработка принятия заявки в друзья
     */
    handleFriendAccepted(data) {
        console.log('✅ Заявка в друзья принята:', data);
        this.emit('friendAccepted', data);
        
        if (typeof HashStorage !== 'undefined') {
            HashStorage.Events?.emit?.('friendRequest', { type: 'accepted', ...data });
        }
    }
    
    /**
     * Обработка входящего FRIEND_REQUEST через WebSocket
     * ИСПРАВЛЕНО: Добавлена диспетчеризация CustomEvent для совместимости с UIManager
     */
    handleFriendRequestWS(data) {
        console.log('👥 Получен FRIEND_REQUEST:', data);
        
        // Уведомляем подписчиков через внутренний emit
        this.emit('FRIEND_REQUEST', data);
        
        // ДИСПЕТЧЕРИЗУЕМ CustomEvent для совместимости с window.addEventListener
        // Это обеспечивает работу с UIManager и другими компонентами
        window.dispatchEvent(new CustomEvent('friendRequest', { detail: data }));
        
        // Показываем уведомление
        this.showFriendRequestNotification(data);
        
        // Воспроизводим звук
        this.playFriendRequestSound();
        
        // Обновляем счётчик заявок
        this.updateRequestsBadge();
        
        // Синхронизируем между вкладками через localStorage
        this.syncFriendRequestsUpdate();
    }
    
    /**
     * Обработка FRIEND_ACCEPT через WebSocket
     * ИСПРАВЛЕНО: Добавлена диспетчеризация CustomEvent
     */
    handleFriendAcceptWS(data) {
        console.log('✅ Получен FRIEND_ACCEPT:', data);
        
        // Уведомляем подписчиков
        this.emit('FRIEND_ACCEPT', data);
        
        // Диспетчеризуем CustomEvent для совместимости
        window.dispatchEvent(new CustomEvent('friendAccepted', { detail: data }));
        
        // Показываем уведомление
        this.showToast(`Пользователь ${data.fromName || data.from} принял вашу заявку в друзья!`, 'success');
        
        // Синхронизируем между вкладками
        this.syncFriendRequestsUpdate();
    }
    
    /**
     * Обработка FRIEND_REJECT через WebSocket
     * ИСПРАВЛЕНО: Добавлена диспетчеризация CustomEvent
     */
    handleFriendRejectWS(data) {
        console.log('❌ Получен FRIEND_REJECT:', data);
        
        // Уведомляем подписчиков
        this.emit('FRIEND_REJECT', data);
        
        // Диспетчеризуем CustomEvent для совместимости
        window.dispatchEvent(new CustomEvent('friendRejected', { detail: data }));
        
        // Показываем уведомление
        this.showToast(`Пользователь ${data.fromName || data.from} отклонил вашу заявку в друзья`, 'info');
        
        // Синхронизируем между вкладками
        this.syncFriendRequestsUpdate();
    }
    
    /**
     * Синхронизация обновления заявок между вкладками через localStorage
     * ИСПРАВЛЕНО: Добавлен метод для синхронизации заявок в друзья
     */
    syncFriendRequestsUpdate() {
        try {
            // Сохраняем timestamp обновления в localStorage
            const syncData = {
                timestamp: Date.now(),
                type: 'friendRequestsUpdate'
            };
            localStorage.setItem('friendRequestsSync', JSON.stringify(syncData));
            
            // Также уведомляем через BroadcastChannel если доступен
            if (this.broadcastChannel) {
                this.broadcastChannel.postMessage({
                    type: 'friendRequestsUpdate',
                    data: syncData
                });
            }
        } catch (e) {
            console.log('[WebSocketManager] Не удалось синхронизировать заявки:', e);
        }
    }
    
    /**
     * Обновление бейджа с синхронизацией между вкладками
     * ИСПРАВЛЕНО: Улучшенное обновление бейджа с проверкой текущего состояния
     */
    updateRequestsBadge() {
        const badge = document.getElementById('requestsBadge');
        if (badge) {
            // Правильно увеличиваем счётчик на 1
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
     * Показ уведомления о новой заявке в друзья (toast)
     * ИСПРАВЛЕНО: Добавлен fallback если Notification API недоступен
     */
    showFriendRequestNotification(data) {
        // Пытаемся показать системное уведомление
        if (Notification.permission === 'granted') {
            new Notification('Новая заявка в друзья', {
                body: `${data.fromName || 'Пользователь'} хочет добавить вас в друзья`,
                icon: '/favicon.ico',
                tag: 'friend-request'
            });
        }
        
        // Показываем toast уведомление
        this.showToast(`Новая заявка от ${data.fromName || 'Пользователя'}!`, 'info');
    }
    
    /**
     * Показ toast уведомления
     * ИСПРАВЛЕНО: Добавлен метод showToast
     */
    showToast(message, type = 'info') {
        const toastId = 'ws-friend-toast';
        const existingToast = document.getElementById(toastId);
        if (existingToast) {
            existingToast.remove();
        }
        
        const toast = document.createElement('div');
        toast.id = toastId;
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
    }
    
    /**
     * Воспроизведение звука при новой заявке
     */
    playFriendRequestSound() {
        try {
            const audio = new Audio('/sounds/friend-request.mp3');
            audio.volume = 0.5;
            audio.play().catch(e => console.log('[WebSocketManager] Не удалось воспроизвести звук:', e));
        } catch (e) {
            console.log('[WebSocketManager] Аудио не поддерживается');
        }
    }
    
    /**
     * Обновление бейджа заявок
     */
    updateRequestsBadge() {
        const badge = document.getElementById('requestsBadge');
        if (badge) {
            let count = parseInt(badge.textContent) || 0;
            badge.textContent = count + 1;
            badge.style.display = 'inline-flex';
        }
    }
    
    // ============ ОБРАБОТЧИКИ ЗВОНКОВ ============
    
    /**
     * Обработка входящего звонка (offer)
     */
    handleCallOffer(data) {
        console.log('📞 Входящий звонок:', data);
        this.emit('CALL_OFFER', data);
        
        if (typeof HashStorage !== 'undefined') {
            HashStorage.Events?.emit?.('callOffer', data);
        }
    }
    
    /**
     * Обработка ответа на звонок (answer)
     */
    handleCallAnswer(data) {
        console.log('📞 Получен ответ на звонок:', data);
        this.emit('CALL_ANSWER', data);
    }
    
    /**
     * Обработка ICE кандидата
     */
    handleCallIceCandidate(data) {
        console.log('📞 ICE кандидат:', data);
        this.emit('CALL_ICE_CANDIDATE', data);
    }
    
    /**
     * Обработка отклонения звонка
     */
    handleCallReject(data) {
        console.log('📞 Звонок отклонён:', data);
        this.emit('CALL_REJECT', data);
    }
    
    /**
     * Обработка завершения звонка
     */
    handleCallEnd(data) {
        console.log('📞 Звонок завершён:', data);
        this.emit('CALL_END', data);
    }
    
    /**
     * Обработка таймаута звонка
     */
    handleCallTimeout(data) {
        console.log('📞 Таймаут звонка:', data);
        this.emit('CALL_TIMEOUT', data);
    }
    
    /**
     * Отправка оффера звонка
     */
    sendCallOffer(callId, to, offer, isVideo) {
        if (!this.isConnected) return false;
        
        this.send({
            type: 'CALL_OFFER',
            callId,
            to,
            offer,
            isVideo,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    /**
     * Отправка ответа на звонок
     */
    sendCallAnswer(callId, to, answer) {
        if (!this.isConnected) return false;
        
        this.send({
            type: 'CALL_ANSWER',
            callId,
            to,
            answer,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    /**
     * Отправка ICE кандидата
     */
    sendCallIceCandidate(callId, to, candidate) {
        if (!this.isConnected) return false;
        
        this.send({
            type: 'CALL_ICE_CANDIDATE',
            callId,
            to,
            candidate,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    /**
     * Отправка отклонения звонка
     */
    sendCallReject(callId, to, reason) {
        if (!this.isConnected) return false;
        
        this.send({
            type: 'CALL_REJECT',
            callId,
            to,
            reason,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    /**
     * Отправка завершения звонка
     */
    sendCallEnd(callId, to, duration) {
        if (!this.isConnected) return false;
        
        this.send({
            type: 'CALL_END',
            callId,
            to,
            duration,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    /**
     * Отправка таймаута звонка
     */
    sendCallTimeout(callId, to) {
        if (!this.isConnected) return false;
        
        this.send({
            type: 'CALL_TIMEOUT',
            callId,
            to,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    /**
     * Отправка сообщения чата
     */
    sendChatMessage(chatId, content, type = 'text') {
        if (!this.isConnected) {
            console.warn('⚠️ WebSocket не подключен');
            return false;
        }
        
        this.send({
            type: 'message',
            chatId,
            content,
            type
        });
        
        return true;
    }
    
    /**
     * Обработка закрытия соединения
     */
    handleClose(event) {
        const closeReason = this.getCloseReason(event.code);
        console.log(`🔌 WebSocket закрыт:`);
        console.log(`   Код: ${event.code} (${closeReason.code})`);
        console.log(`   Описание: ${closeReason.description}`);
        console.log(`   Причина: "${event.reason || 'не указана'}"`);
        console.log(`   Намеренное: ${this.isIntentionalClose}`);

        this.isConnected = false;
        this.isConnecting = false;

        // Останавливаем heartbeat
        this.stopHeartbeat();
        
        // Обновляем индикатор статуса
        if (this.isIntentionalClose) {
            this.updateConnectionStatus('disconnected', 'Отключено');
        } else if (event.code !== 1000) {
            this.updateConnectionStatus('disconnected', 'Соединение потеряно');
        } else {
            this.updateConnectionStatus('disconnected', 'Отключено');
        }

        // Очищаем ожидающие сообщения с ошибкой
        this.pendingMessages.forEach((pending, id) => {
            pending.reject(new Error('Connection closed'));
        });
        this.pendingMessages.clear();

        // Уведомляем обработчики с детальной информацией
        this.emit('disconnected', {
            code: event.code,
            reason: event.reason,
            description: closeReason.description,
            isIntentional: this.isIntentionalClose,
            shouldReconnect: !this.isIntentionalClose && event.code !== 1000
        });

        // Если не намеренное закрытие - планируем переподключение
        if (!this.isIntentionalClose && event.code !== 1000) {
            console.log('🔄 Планирование переподключения...');
            this.scheduleReconnect();
        } else if (this.isIntentionalClose) {
            console.log('✅ Намеренное закрытие соединения');
        } else if (event.code === 1000) {
            console.log('✅ Нормальное закрытие соединения');
        }
    }

    /**
     * Получение описания причины закрытия WebSocket
     */
    getCloseReason(code) {
        const closeCodes = {
            1000: { code: 'NORMAL_CLOSURE', description: 'Нормальное закрытие соединения' },
            1001: { code: 'GOING_AWAY', description: 'Клиент покидает страницу' },
            1002: { code: 'PROTOCOL_ERROR', description: 'Ошибка протокола' },
            1003: { code: 'UNSUPPORTED_DATA', description: 'Неподдерживаемый тип данных' },
            1004: { code: 'RESERVED', description: 'Зарезервировано' },
            1005: { code: 'NO_STATUS', description: 'Нет статуса' },
            1006: { code: 'ABNORMAL_CLOSURE', description: 'Аномальное закрытие (разрыв соединения)' },
            1007: { code: 'INVALID_FRAME', description: 'Неверные данные фрейма' },
            1008: { code: 'POLICY_VIOLATION', description: 'Нарушение политики' },
            1009: { code: 'MESSAGE_TOO_BIG', description: 'Сообщение слишком большое' },
            1010: { code: 'EXTENSION_REQUIRED', description: 'Требуется расширение' },
            1011: { code: 'INTERNAL_ERROR', description: 'Внутренняя ошибка сервера' },
            1012: { code: 'SERVICE_RESTART', description: 'Сервер перезагружается' },
            1013: { code: 'TRY_AGAIN_LATER', description: 'Попробуйте позже' },
            1014: { code: 'GATEWAY_ERROR', description: 'Ошибка шлюза' },
            1015: { code: 'TLS_ERROR', description: 'Ошибка TLS' },
            4000: { code: 'AUTH_FAILED', description: 'Ошибка авторизации' },
            4001: { code: 'TOKEN_EXPIRED', description: 'Токен истек' },
            4002: { code: 'INVALID_TOKEN', description: 'Недействительный токен' },
            4003: { code: 'USER_NOT_FOUND', description: 'Пользователь не найден' }
        };

        return closeCodes[code] || {
            code: 'UNKNOWN',
            description: 'Неизвестная причина закрытия'
        };
    }
    
    /**
     * Обработка ошибки WebSocket
     */
    handleError(event) {
        console.error('❌ WebSocket ошибка');
        this.emit('error', event);
    }
    
    /**
     * Обработка ошибки соединения
     */
    handleConnectionError(error) {
        console.error('❌ Ошибка соединения WebSocket:', error);

        this.emit('connectionError', error);

        // Уведомляем ConnectionManager
        if (typeof ConnectionManager !== 'undefined') {
            ConnectionManager.handleConnectionError(error);
        }

        // Не пытаемся переподключаться на странице авторизации
        if (!this.isAuthPage()) {
            this.scheduleReconnect();
        }
    }
    
    /**
     * Планирование переподключения
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Превышено максимальное количество попыток переподключения');
            this.emit('maxReconnectAttemptsReached');

            // Уведомляем пользователя
            if (typeof ConnectionManager !== 'undefined') {
                ConnectionManager.showReconnectionFailed();
            }

            return;
        }

        // Проверяем страницу авторизации
        if (this.isAuthPage()) {
            console.log('[WebSocketManager] Страница авторизации - отмена переподключения');
            return;
        }

        // Проверяем наличие токена перед переподключением
        const token = this.getAuthToken();
        if (!token) {
            console.warn('⚠️ Токен отсутствует, отмена переподключения');
            this.emit('authRequired');
            return;
        }

        // Экспоненциальная задержка с jitter
        const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15
        const delay = Math.min(this.reconnectDelay * jitter, this.maxReconnectDelay);

        console.log(`🔄 Переподключение через ${Math.round(delay)}мс (попытка ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempts++;
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);

            // Обновляем токен перед переподключением
            this.authToken = this.getAuthToken();

            console.log(`🔄 Попытка переподключения #${this.reconnectAttempts}`);
            this.connect();
        }, delay);

        this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    }
    
    /**
     * Отправка сообщения
     */
    send(data, priority = 'normal') {
        const message = {
            id: ++this.messageIdCounter,
            timestamp: Date.now(),
            ...(typeof data === 'object' ? data : { data })
        };
        
        if (!this.isConnected) {
            // Буферизируем сообщение
            this.enqueueMessage(message, priority);
            return Promise.reject(new Error('Not connected'));
        }
        
        // Отправляем сообщение
        try {
            this.socket.send(JSON.stringify(message));
            
            // Для критичных сообщений ждем подтверждения
            if (priority === 'high' || data.requireAck) {
                return this.waitForAck(message.id);
            }
            
            return Promise.resolve({ id: message.id, sent: true });
            
        } catch (error) {
            console.error('❌ Ошибка отправки сообщения:', error);
            this.enqueueMessage(message, priority);
            return Promise.reject(error);
        }
    }
    
    /**
     * Ожидание подтверждения получения
     */
    waitForAck(messageId, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingMessages.delete(messageId);
                console.warn(`⚠️ ACK timeout для сообщения id=${messageId} (${timeout}мс)`);
                reject(new Error(`ACK timeout for message id=${messageId}`));
            }, timeout);
            
            this.pendingMessages.set(messageId, {
                resolve: (data) => {
                    clearTimeout(timer);
                    resolve(data);
                },
                reject
            });
        });
    }
    
    /**
     * Добавление сообщения в очередь
     */
    enqueueMessage(message, priority = 'normal') {
        const queueItem = { message, priority, timestamp: Date.now() };
        
        if (priority === 'high') {
            this.messageQueue.unshift(queueItem);
        } else {
            this.messageQueue.push(queueItem);
        }
        
        // Ограничиваем размер очереди
        if (this.messageQueue.length > 100) {
            this.messageQueue = this.messageQueue.slice(-100);
        }
        
        // Сохраняем в localStorage для персистентности
        this.persistMessageQueue();
    }
    
    /**
     * Отправка забуферизованных сообщений
     */
    flushMessageQueue() {
        if (this.messageQueue.length === 0) return;
        
        console.log(`📤 Отправка ${this.messageQueue.length} забуферизованных сообщений`);
        
        const queue = [...this.messageQueue];
        this.messageQueue = [];
        
        queue.forEach(item => {
            this.send(item.message, item.priority);
        });
        
        localStorage.removeItem('wsMessageQueue');
    }
    
    /**
     * Сохранение очереди сообщений
     */
    persistMessageQueue() {
        try {
            localStorage.setItem('wsMessageQueue', JSON.stringify(
                this.messageQueue.slice(-50) // Сохраняем только последние 50
            ));
        } catch (e) {
            // Игнорируем ошибки кво localStorage
        }
    }
    
    /**
     * Восстановление очереди сообщений
     */
    restoreMessageQueue() {
        try {
            const saved = localStorage.getItem('wsMessageQueue');
            if (saved) {
                this.messageQueue = JSON.parse(saved);
            }
        } catch (e) {
            this.messageQueue = [];
        }
    }
    
    /**
     * Запуск heartbeat
     */
    startHeartbeat() {
        this.stopHeartbeat();
        
        this.heartbeatInterval = setInterval(() => {
            this.sendPing();
        }, this.heartbeatDelay);
    }
    
    /**
     * Остановка heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }
    
    /**
     * Отправка ping
     */
    sendPing() {
        if (!this.isConnected) return;
        
        try {
            this.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            
            // Ждем pong с таймаутом
            this.heartbeatTimeout = setTimeout(() => {
                console.warn('⚠️ Heartbeat timeout - переподключение');
                this.handleDisconnect();
                this.scheduleReconnect();
            }, 5000);
            
        } catch (error) {
            console.error('❌ Ошибка отправки ping:', error);
        }
    }
    
    /**
     * Отправка pong
     */
    sendPong() {
        if (this.isConnected) {
            try {
                this.socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            } catch (error) {
                console.error('❌ Ошибка отправки pong:', error);
            }
        }
    }
    
    /**
     * Обработка pong
     */
    handlePong() {
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }
    
    /**
     * Обработка disconnect
     */
    handleDisconnect() {
        this.isConnected = false;
        this.stopHeartbeat();
        
        this.emit('disconnect');
    }
    
    /**
     * Отправка авторизации
     */
    sendAuth() {
        // Получаем актуальный токен
        const token = this.getAuthToken();
        
        if (token) {
            // Валидация токена перед отправкой
            const parts = token.split('.');
            if (parts.length !== 3) {
                console.error('[WebSocketManager] ❌ Невалидный JWT токен: ожидается 3 части, получено', parts.length);
                console.error('[WebSocketManager] Токен:', token);
                return;
            }
            
            // Логируем структуру токена
            console.log('[WebSocketManager] Отправка токена:', {
                length: token.length,
                header: parts[0],
                payload: parts[1],
                signature: parts[2],
                isValid: true
            });

            // Отправляем без ожидания ACK, т.к. сервер отправляет auth_success вместо ack
            this.send({
                type: 'auth',
                token: token
            }, 'normal'); // normal приоритет - без ожидания ACK
            console.log('📤 Отправлено сообщение авторизации');
        } else {
            console.warn('⚠️ Токен авторизации отсутствует при отправке');
        }
    }
    
    /**
     * Отправка обновления токена
     */
    sendAuthRefresh() {
        if (this.isConnected && this.authToken) {
            this.send({
                type: 'auth_refresh',
                token: this.authToken
            });
        }
    }
    
    /**
     * Обработка требования авторизации
     */
    handleAuthRequired() {
        console.log('⚠️ WebSocket требует повторной авторизации');
        
        // Запрашиваем новый токен у AuthManager
        if (typeof AuthManager !== 'undefined') {
            AuthManager.refreshToken().then(() => {
                this.authToken = this.getAuthToken();
                this.sendAuthRefresh();
            }).catch(() => {
                this.handleLogout();
            });
        }
    }
    
    /**
     * Обработка успешной авторизации WS
     */
    handleAuthSuccess(data) {
        console.log('✅ WebSocket авторизация успешна', data);
        this.isAuthorized = true;
        this.emit('authSuccess', data);
    }
    
    /**
     * Обработка ошибки авторизации WS
     */
    handleAuthError(data) {
        console.error('❌ WebSocket ошибка авторизации:', data);

        // Если мы на странице авторизации - просто отключаемся без логаута
        if (this.isAuthPage()) {
            console.log('[WebSocketManager] Ошибка авторизации на странице auth - отключаемся');
            this.isIntentionalClose = true;
            this.disconnect();
            return;
        }

        // На других страницах - обрабатываем как ошибку авторизации
        this.handleLogout();
    }
    
    /**
     * Обработка обновления состояния
     */
    handleStateUpdate(data) {
        this.emit('stateUpdate', data);
        
        // Обновляем HashStorage если нужно
        if (typeof HashStorage !== 'undefined' && data.state) {
            Object.keys(data.state).forEach(key => {
                HashStorage.set(key, data.state[key]);
            });
        }
    }
    
    /**
     * Обработка уведомления
     */
    handleNotification(data) {
        this.emit('notification', data);
        
        // Показываем уведомление
        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show?.(data.message, data.type || 'info');
        }
    }
    
    /**
     * Отправка синхронного сообщения чата с подтверждением доставки
     * @param {string} chatId - ID чата
     * @param {string} content - Содержимое сообщения
     * @param {string} messageType - Тип сообщения (text, image, file)
     * @returns {Promise} - Промис с результатом отправки и подтверждением доставки
     */
    sendMessageSync(chatId, content, messageType = 'text') {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('WebSocket не подключен'));
                return;
            }
            
            // Генерируем уникальный строковый ID для сообщения
            const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const timestamp = Date.now();
            
            const message = {
                type: 'message',
                id: messageId,
                chatId,
                content,
                messageType,
                timestamp
            };
            
            console.log(`[WebSocketManager] Отправка сообщения sync: chatId=${chatId}, messageId=${messageId}`);
            
            // Устанавливаем таймаут ожидания подтверждения
            const timeout = setTimeout(() => {
                this.pendingMessages.delete(messageId);
                reject(new Error('Таймаут отправки сообщения'));
            }, 15000);
            
            // Сохраняем промис для ожидания
            this.pendingMessages.set(messageId, {
                resolve: (data) => {
                    clearTimeout(timeout);
                    resolve({
                        success: true,
                        messageId: data.messageId || messageId,
                        status: 'sent',
                        timestamp
                    });
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
            
            // Отправляем сообщение
            try {
                this.socket.send(JSON.stringify(message));
            } catch (error) {
                this.pendingMessages.delete(messageId);
                clearTimeout(timeout);
                reject(error);
            }
        });
    }
    
    /**
     * Отправка подтверждения получения сообщения
     * @param {string} messageId - ID сообщения
     * @param {string} chatId - ID чата
     */
    markMessageAsDelivered(messageId, chatId) {
        if (!this.isConnected) {
            console.warn('[WebSocketManager] Не подключен, невозможно отправить подтверждение доставки');
            return;
        }
        
        const message = {
            type: 'message_delivered',
            messageId,
            chatId,
            deliveredTo: this.getCurrentUserId(),
            timestamp: Date.now()
        };
        
        this.send(message);
        console.log(`[WebSocketManager] Отправлено подтверждение доставки: messageId=${messageId}`);
    }
    
    /**
     * Отправка подтверждения прочтения сообщения
     * @param {string} messageId - ID сообщения
     * @param {string} chatId - ID чата
     */
    markMessageAsRead(messageId, chatId) {
        if (!this.isConnected) {
            console.warn('[WebSocketManager] Не подключен, невозможно отправить подтверждение прочтения');
            return;
        }
        
        const message = {
            type: 'message_read',
            messageId,
            chatId,
            readBy: this.getCurrentUserId(),
            timestamp: Date.now()
        };
        
        this.send(message);
        console.log(`[WebSocketManager] Отправлено подтверждение прочтения: messageId=${messageId}`);
    }
    
    /**
     * Получение ID текущего пользователя
     * @returns {string|null}
     */
    getCurrentUserId() {
        if (typeof HashStorage !== 'undefined' && HashStorage.getCurrentUser) {
            const user = HashStorage.getCurrentUser();
            return user?.id || null;
        }
        
        // Пробуем из localStorage
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            try {
                const user = JSON.parse(stored);
                return user?.id || null;
            } catch (e) {
                return null;
            }
        }
        
        return null;
    }
    
    /**
     * Обработка подтверждения доставки
     */
    handleDeliveryConfirmation(data) {
        console.log(`[WebSocketManager] Подтверждение доставки:`, data);
        this.emit('messageDelivered', {
            messageId: data.messageId,
            deliveredTo: data.deliveredTo,
            timestamp: data.timestamp
        });
    }
    
    /**
     * Обработка подтверждения прочтения
     */
    handleReadConfirmation(data) {
        console.log(`[WebSocketManager] Подтверждение прочтения:`, data);
        this.emit('messageRead', {
            messageId: data.messageId,
            readBy: data.readBy,
            timestamp: data.timestamp
        });
    }
    
    /**
     * Обработка ошибки сервера
     */
    handleServerError(data) {
        console.error('❌ Ошибка от сервера:', data);
        this.emit('serverError', data);
    }
    
    /**
     * Синхронизация состояния с сервером
     */
    syncState() {
        this.send({
            type: 'sync_request',
            clientState: this.getClientState()
        });
    }
    
    /**
     * Получение состояния клиента
     */
    getClientState() {
        if (typeof HashStorage !== 'undefined') {
            // Получаем базовую информацию о пользователе
            const currentUser = HashStorage.getCurrentUser ? HashStorage.getCurrentUser() : null;
            const token = HashStorage.token || null;
            
            return {
                user: currentUser,
                hasToken: !!token,
                timestamp: Date.now()
            };
        }
        return {};
    }
    
    /**
     * Обработка выхода пользователя
     */
    handleLogout() {
        this.isIntentionalClose = true;
        this.disconnect();
        
        // Очищаем очередь сообщений
        this.messageQueue = [];
        localStorage.removeItem('wsMessageQueue');
        
        this.emit('logout');
    }
    
    /**
     * Отключение WebSocket
     */
    disconnect() {
        this.isIntentionalClose = true;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.socket) {
            this.socket.close(1000, 'Client logout');
        }
        
        this.stopHeartbeat();
        this.isConnected = false;
        this.isConnecting = false;
    }
    
    /**
     * Подписка на событие
     */
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event).push(handler);
    }
    
    /**
     * Отписка от события
     */
    off(event, handler) {
        if (this.handlers.has(event)) {
            const handlers = this.handlers.get(event);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    /**
     * Уведомление обработчиков
     */
    emit(event, data) {
        if (this.handlers.has(event)) {
            this.handlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`❌ Ошибка в обработчике ${event}:`, error);
                }
            });
        }
    }
    
    /**
     * Получение статуса соединения
     */
    getStatus() {
        return {
            connected: this.isConnected,
            connecting: this.isConnecting,
            reconnectAttempts: this.reconnectAttempts,
            pendingMessages: this.pendingMessages.size,
            queuedMessages: this.messageQueue.length
        };
    }
    
    /**
     * Обновление индикатора статуса подключения на странице
     */
    updateConnectionStatus(status, text) {
        const connectionDot = document.getElementById('connectionDot');
        const connectionStatus = document.getElementById('connectionStatus');
        
        if (connectionStatus) {
            connectionStatus.textContent = text;
        }
        
        if (connectionDot) {
            connectionDot.className = 'dot ' + status;
        }
    }
    
    /**
     * Показ уведомления (toast)
     */
    showToast(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else if (window.messengerApp?.ui?.showToast) {
            window.messengerApp.ui.showToast(message, type);
        } else {
            console.log(`[Toast ${type}]: ${message}`);
        }
    }
}

// Инициализация при загрузке
// Экспорт для браузера - сразу создаем экземпляр
if (typeof window !== 'undefined') {
    window.WebSocketManager = new WebSocketManager();
    // Инициализация после загрузки DOM
    document.addEventListener('DOMContentLoaded', () => {
        if (window.WebSocketManager && !window.WebSocketManager.initialized) {
            window.WebSocketManager.initialize();
        }
    });
}

// Export для модульных систем
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketManager;
}
