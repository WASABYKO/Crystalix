/**
 * AuthManager v1.0 — Улучшенная архитектура авторизации
 * Централизованное управление авторизацией, синхронизация с WebSocket,
 * ограничение попыток входа, предотвращение бесконечного релоада
 */

const AuthManager = (function() {
    'use strict';

    // Приватное состояние
    let currentUser = null;
    let isAuthenticated = false;
    let isInitializing = false;
    let loginAttempts = 0;
    let maxLoginAttempts = 5;
    let loginBlockTime = 0;
    let lastError = null;
    let pendingRedirect = null;

    // Конфигурация
    const CONFIG = {
        MAX_LOGIN_ATTEMPTS: 5,
        BLOCK_TIME: 60000, // 1 минута блокировки после 5 неудачных попыток
        LOGIN_TIMEOUT: 15000,
        SESSION_CHECK_INTERVAL: 60000, // Проверка сессии каждую минуту
        AUTO_REFRESH_TOKEN: true,
        TOKEN_REFRESH_BEFORE: 300000 // Обновляем токен за 5 минут до истечения
    };

    // Event listeners
    const listeners = new Map();

    // Проверка, заблокирован ли вход
    function isLoginBlocked() {
        return Date.now() < loginBlockTime;
    }

    // Блокировка входа после множественных неудачных попыток
    function blockLogin() {
        loginBlockTime = Date.now() + CONFIG.BLOCK_TIME;
        loginAttempts = 0;
        console.warn(`[AuthManager] Вход заблокирован до ${new Date(loginBlockTime).toLocaleTimeString()}`);
        emit('loginBlocked', { until: loginBlockTime });
    }

    // Сброс счетчика попыток
    function resetLoginAttempts() {
        loginAttempts = 0;
        loginBlockTime = 0;
    }

    // Увеличение счетчика попыток
    function incrementLoginAttempts() {
        loginAttempts++;
        const remaining = CONFIG.MAX_LOGIN_ATTEMPTS - loginAttempts;

        if (remaining <= 0) {
            blockLogin();
        } else {
            emit('loginAttempt', { attempts: loginAttempts, remaining });
        }

        return remaining;
    }

    // Безопасный вход с ограничением попыток
    async function login(email, password) {
        console.log(`[AuthManager] Попытка входа: ${email}`);

        // Проверяем блокировку
        if (isLoginBlocked()) {
            const remaining = Math.ceil((loginBlockTime - Date.now()) / 1000);
            const error = new Error(`Слишком много неудачных попыток. Попробуйте через ${remaining} секунд`);
            error.blocked = true;
            error.remainingTime = remaining;
            return { success: false, error, blocked: true };
        }

        // Проверяем валидность данных
        if (!email || !password) {
            return { success: false, message: 'Заполните все поля' };
        }

        // Блокируем UI
        emit('loginStart', { email });

        try {
            // Используем RetryManager для повторных попыток
            const result = await RetryManager.execute(async ({ signal }) => {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                    signal
                });

                const data = await response.json();

                if (!response.ok) {
                    const error = new Error(data.message || 'Ошибка входа');
                    error.status = response.status;
                    throw error;
                }

                return data;
            }, {
                maxRetries: 2,
                baseDelay: 1000,
                timeout: CONFIG.LOGIN_TIMEOUT,
                retryOn: [408, 429, 500, 502, 503, 504],
                abortOn: [401, 403, 422]
            });

            if (!result.success) {
                throw result.error;
            }

            // Успешный вход
            const { token, user } = result.data;

            // Сохраняем токен через TokenManager
            if (typeof TokenManager !== 'undefined') {
                TokenManager.setToken(token);
            } else {
                // Fallback: сохраняем напрямую
                localStorage.setItem('techtariff_auth_token', token);
            }

            currentUser = user;
            isAuthenticated = true;
            resetLoginAttempts();
            lastError = null;

            console.log(`[AuthManager] ✅ Вход успешен: ${user.id}`);

            // Подключаем WebSocket
            if (typeof Storage !== 'undefined') {
                Storage.connectWebSocket();
            }

            emit('loginSuccess', { user });

            return { success: true, user };
        } catch (error) {
            console.error(`[AuthManager] ❌ Ошибка входа:`, error);

            lastError = error;

            // Обрабатываем разные типы ошибок
            if (error.status === 401) {
                const remaining = incrementLoginAttempts();
                emit('loginFailed', { error, attempts: loginAttempts, remaining });

                return {
                    success: false,
                    message: error.message || 'Неверный email или пароль',
                    attemptsRemaining: remaining
                };
            }

            // Сетевые ошибки
            if (ConnectionManager) {
                await ConnectionManager.handleConnectionError(error);
            }

            emit('loginError', { error });

            return {
                success: false,
                message: error.message || 'Ошибка соединения',
                networkError: true
            };
        }
    }

    // Регистрация
    async function register(name, email, password) {
        console.log(`[AuthManager] Регистрация: ${email}`);

        emit('registerStart', { email });

        try {
            const result = await RetryManager.execute(async ({ signal }) => {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password }),
                    signal
                });

                const data = await response.json();

                if (!response.ok) {
                    const error = new Error(data.message || 'Ошибка регистрации');
                    error.status = response.status;
                    throw error;
                }

                return data;
            }, {
                maxRetries: 2,
                baseDelay: 1000,
                timeout: CONFIG.LOGIN_TIMEOUT
            });

            if (!result.success) {
                throw result.error;
            }

            console.log(`[AuthManager] ✅ Регистрация успешна: ${result.data.user.id}`);

            emit('registerSuccess', { user: result.data.user });

            // Автоматический вход после регистрации
            if (result.data.user) {
                const loginResult = await login(email, password);
                return loginResult;
            }

            return { success: true, user: result.data.user };
        } catch (error) {
            console.error(`[AuthManager] ❌ Ошибка регистрации:`, error);
            lastError = error;

            emit('registerError', { error });

            return {
                success: false,
                message: error.message || 'Ошибка регистрации'
            };
        }
    }

    // Выход
    function logout(options = {}) {
        const { redirect = true, clearAll = false } = options;

        console.log('[AuthManager] Выход');

        // Очищаем состояние
        currentUser = null;
        isAuthenticated = false;
        resetLoginAttempts();

        // Очищаем токен через TokenManager
        if (typeof TokenManager !== 'undefined') {
            TokenManager.clearToken();
        } else {
            // Fallback: очищаем напрямую
            localStorage.removeItem('techtariff_auth_token');
            if (typeof HashStorage !== 'undefined') {
                HashStorage.token = null;
            }
        }

        // Закрываем WebSocket
        if (typeof window.WebSocketManager !== 'undefined' && window.WebSocketManager.socket) {
            window.WebSocketManager.disconnect();
        }

        emit('logout', { redirect });

        // Редирект
        if (redirect) {
            pendingRedirect = setTimeout(() => {
                window.location.href = 'auth.html';
            }, 100);
        }
    }

    // Проверка сессии
    async function checkSession() {
        // Получаем токен через TokenManager
        const token = typeof TokenManager !== 'undefined' ? TokenManager.getToken() : localStorage.getItem('techtariff_auth_token');

        if (!token) {
            if (isAuthenticated) {
                logout({ redirect: false });
            }
            return { authenticated: false };
        }

        // Проверяем валидность токена через TokenManager
        if (typeof TokenManager !== 'undefined' && !TokenManager.isTokenValid()) {
            console.warn('[AuthManager] Токен недействителен или истек');
            logout({ redirect: false });
            return { authenticated: false, reason: 'token_expired' };
        }

        try {
            // Используем TokenManager для получения заголовка авторизации
            const headers = typeof TokenManager !== 'undefined'
                ? TokenManager.getAuthHeader()
                : { 'Authorization': `Bearer ${token}` };

            const response = await fetch('/api/me', { headers });

            if (response.ok) {
                const data = await response.json();

                if (data.success) {
                    currentUser = data.user;
                    isAuthenticated = true;

                    return { authenticated: true, user: data.user };
                }
            }

            // Токен недействителен
            logout({ redirect: false });
            return { authenticated: false, reason: 'invalid_token' };
        } catch (error) {
            console.error('[AuthManager] Ошибка проверки сессии:', error);

            // При ошибке считаем что сессия валидна (offline mode)
            if (isAuthenticated && currentUser) {
                return { authenticated: true, user: currentUser, offline: true };
            }

            return { authenticated: false, error: error.message };
        }
    }

    // Получение текущего пользователя
    function getCurrentUser() {
        return currentUser;
    }

    // Проверка авторизации
    function isLoggedIn() {
        return isAuthenticated;
    }

    // Получение токена авторизации
    function getToken() {
        // Используем TokenManager если доступен
        if (typeof TokenManager !== 'undefined') {
            return TokenManager.getToken();
        }
        // Fallback: получаем напрямую из localStorage
        return localStorage.getItem('techtariff_auth_token');
    }

    // Инициализация при загрузке
    async function initialize() {
        if (isInitializing) {
            console.log('[AuthManager] Уже инициализируется...');
            return;
        }

        isInitializing = true;
        console.log('[AuthManager] Инициализация...');

        try {
            // Проверяем существующую сессию
            const { authenticated, user } = await checkSession();

            if (authenticated) {
                console.log('[AuthManager] Сессия восстановлена:', user?.id);

                // Подключаем WebSocket через WebSocketManager
                if (typeof window.WebSocketManager !== 'undefined' && !window.WebSocketManager.isConnected) {
                    // WebSocketManager будет инициализирован через SafeInitializer в app.js
                    console.log('[AuthManager] WebSocketManager будет инициализирован через SafeInitializer');
                }
            }

            // Запускаем периодическую проверку сессии
            setInterval(checkSession, CONFIG.SESSION_CHECK_INTERVAL);
        } catch (error) {
            console.error('[AuthManager] Ошибка инициализации:', error);
        } finally {
            isInitializing = false;
        }
    }

    // Обработка ошибок и восстановление
    async function handleError(error) {
        console.log('[AuthManager] Обработка ошибки:', error);

        switch (error.type || error.name) {
            case 'AuthError':
            case 'Unauthorized':
                logout({ redirect: false });
                window.location.href = 'auth.html?reason=session_expired';
                break;

            case 'NetworkError':
                // Пробуем восстановить соединение
                if (ConnectionManager) {
                    const status = await ConnectionManager.checkServerStatus();
                    if (status === 'offline') {
                        emit('offlineMode');
                    }
                }
                break;

            default:
                // Логируем и продолжаем
                console.warn('[AuthManager] Необработанная ошибка:', error);
        }
    }

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

    // Публичный API
    return {
        // Инициализация
        initialize,

        // Авторизация
        login,
        register,
        logout,

        // Проверка
        checkSession,
        getCurrentUser,
        isLoggedIn,
        isLoginBlocked,
        getToken,

        // Состояние
        getState: () => ({
            isAuthenticated,
            currentUser,
            loginAttempts,
            isBlocked: isLoginBlocked(),
            lastError
        }),

        // События
        on,
        off,
        emit,

        // Обработка ошибок
        handleError,

        // Конфигурация
        CONFIG
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.AuthManager = AuthManager;
    console.log('🔐 AuthManager v1.0 загружен');
}
