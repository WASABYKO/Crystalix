/**
 * TokenManager v1.0 — Централизованное управление токенами авторизации
 * Обеспечивает единый механизм хранения, получения и синхронизации токенов
 * между localStorage, sessionStorage и WebSocket
 */

const TokenManager = (function() {
    'use strict';

    // Конфигурация
    const CONFIG = {
        STORAGE_KEY: 'techtariff_auth_token',
        SESSION_KEY: 'techtariff_auth_token_session',
        TOKEN_REFRESH_THRESHOLD: 300000, // 5 минут до истечения
        SYNC_INTERVAL: 60000 // Синхронизация каждую минуту
    };

    // Состояние
    let currentToken = null;
    let tokenExpiry = null;
    let syncInterval = null;
    let listeners = new Map();

    // Event system
    function on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(callback);
        return () => off(event, callback);
    }

    function off(event, callback) {
        if (listeners.has(event)) listeners.get(event).delete(callback);
    }

    function emit(event, data) {
        if (listeners.has(event)) {
            listeners.get(event).forEach(cb => {
                try { cb(data); } catch (e) { console.error(e); }
            });
        }
    }

    /**
     * Сохранение токена в localStorage и sessionStorage
     */
    function setToken(token, options = {}) {
        const { persist = true, sync = true } = options;

        console.log('[TokenManager] Сохранение токена:', token ? 'присутствует' : 'отсутствует');

        currentToken = token;

        if (token) {
            // Сохраняем в localStorage для персистентности
            if (persist) {
                localStorage.setItem(CONFIG.STORAGE_KEY, token);
            }

            // Сохраняем в sessionStorage для текущей сессии
            sessionStorage.setItem(CONFIG.SESSION_KEY, token);

            // Пытаемся декодировать JWT для получения времени истечения
            try {
                const decoded = parseJWT(token);
                if (decoded && decoded.exp) {
                    tokenExpiry = decoded.exp * 1000; // Конвертируем в миллисекунды
                    console.log('[TokenManager] Токен истекает:', new Date(tokenExpiry).toLocaleString());
                }
            } catch (e) {
                console.warn('[TokenManager] Не удалось декодировать JWT:', e);
            }

            emit('tokenSet', { token });
        } else {
            // Очищаем токены
            localStorage.removeItem(CONFIG.STORAGE_KEY);
            sessionStorage.removeItem(CONFIG.SESSION_KEY);
            tokenExpiry = null;

            emit('tokenCleared');
        }

        // Синхронизируем с другими компонентами
        if (sync) {
            syncToken();
        }
    }

    /**
     * Получение токена из разных источников
     */
    function getToken() {
        // Сначала проверяем текущее значение в памяти
        if (currentToken) {
            return currentToken;
        }

        // Проверяем localStorage
        const localToken = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (localToken) {
            currentToken = localToken;
            return localToken;
        }

        // Проверяем sessionStorage
        const sessionToken = sessionStorage.getItem(CONFIG.SESSION_KEY);
        if (sessionToken) {
            currentToken = sessionToken;
            return sessionToken;
        }

        return null;
    }

    /**
     * Проверка наличия токена
     */
    function hasToken() {
        return getToken() !== null;
    }

    /**
     * Проверка валидности токена
     */
    function isTokenValid() {
        const token = getToken();
        if (!token) return false;

        // Проверяем время истечения
        if (tokenExpiry) {
            const now = Date.now();
            if (now >= tokenExpiry) {
                console.warn('[TokenManager] Токен истек');
                return false;
            }

            // Проверяем, нужно ли обновить токен
            if (now >= tokenExpiry - CONFIG.TOKEN_REFRESH_THRESHOLD) {
                console.log('[TokenManager] Токен скоро истечет, нужно обновить');
                emit('tokenRefreshNeeded');
            }
        }

        return true;
    }

    /**
     * Очистка токена
     */
    function clearToken() {
        console.log('[TokenManager] Очистка токена');
        setToken(null);
    }

    /**
     * Парсинг JWT токена
     */
    function parseJWT(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonPayload);
        } catch (e) {
            console.error('[TokenManager] Ошибка парсинга JWT:', e);
            return null;
        }
    }

    /**
     * Получение данных пользователя из токена
     */
    function getUserFromToken() {
        const token = getToken();
        if (!token) return null;

        const decoded = parseJWT(token);
        return decoded;
    }

    /**
     * Синхронизация токена с другими компонентами
     */
    function syncToken() {
        const token = getToken();

        // Синхронизируем с HashStorage
        if (typeof HashStorage !== 'undefined' && HashStorage.token !== undefined) {
            HashStorage.token = token;
        }

        // Синхронизируем с WebSocketManager
        if (typeof window.WebSocketManager !== 'undefined' && typeof window.WebSocketManager.setAuthToken === 'function') {
            window.WebSocketManager.setAuthToken(token);
        }

        // Синхронизируем с AuthManager
        if (typeof AuthManager !== 'undefined' && AuthManager.setToken) {
            AuthManager.setToken(token);
        }

        console.log('[TokenManager] Токен синхронизирован с компонентами');
    }

    /**
     * Получение заголовка авторизации для HTTP запросов
     */
    function getAuthHeader() {
        const token = getToken();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    /**
     * Получение строки авторизации для HTTP запросов
     */
    function getAuthString() {
        const token = getToken();
        return token ? `Bearer ${token}` : '';
    }

    /**
     * Запуск периодической синхронизации
     */
    function startSync() {
        if (syncInterval) {
            clearInterval(syncInterval);
        }

        syncInterval = setInterval(() => {
            syncToken();
            isTokenValid();
        }, CONFIG.SYNC_INTERVAL);

        console.log('[TokenManager] Периодическая синхронизация запущена');
    }

    /**
     * Остановка периодической синхронизации
     */
    function stopSync() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    }

    /**
     * Инициализация TokenManager
     */
    function initialize() {
        console.log('[TokenManager] Инициализация...');

        // Загружаем токен из хранилища
        const token = getToken();

        if (token) {
            console.log('[TokenManager] Токен найден:', token ? 'присутствует' : 'отсутствует');

            // Проверяем валидность токена
            if (isTokenValid()) {
                emit('tokenLoaded', { token });
            } else {
                console.warn('[TokenManager] Токен недействителен, очищаем');
                clearToken();
            }
        } else {
            console.log('[TokenManager] Токен не найден');
        }

        // Запускаем периодическую синхронизацию
        startSync();

        // Слушаем события изменения токена от других компонентов
        window.addEventListener('storage', (e) => {
            if (e.key === CONFIG.STORAGE_KEY || e.key === CONFIG.SESSION_KEY) {
                console.log('[TokenManager] Обнаружено изменение токена в storage');
                currentToken = null; // Сбрасываем кэш
                const newToken = getToken();
                if (newToken) {
                    emit('tokenChanged', { token: newToken });
                } else {
                    emit('tokenCleared');
                }
            }
        });

        return { success: true };
    }

    // Публичный API
    return {
        // Инициализация
        initialize,

        // Управление токеном
        setToken,
        getToken,
        hasToken,
        isTokenValid,
        clearToken,

        // JWT операции
        parseJWT,
        getUserFromToken,

        // Синхронизация
        syncToken,
        startSync,
        stopSync,

        // HTTP авторизация
        getAuthHeader,
        getAuthString,

        // События
        on,
        off,
        emit,

        // Конфигурация
        CONFIG
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.TokenManager = TokenManager;
    console.log('🔑 TokenManager v1.0 загружен');
}
