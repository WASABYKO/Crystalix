/**
 * ConnectionManager v1.0 — Управление сетевыми соединениями
 * Обработка ошибок соединения, определение типа ошибки, fallback-механизмы
 */

const ConnectionManager = (function() {
    'use strict';

    // Приватные переменные
    let isOnline = navigator.onLine;
    let serverStatus = 'unknown'; // 'unknown', 'healthy', 'degraded', 'offline'
    let lastServerCheck = 0;
    let checkInterval = null;
    let listeners = new Map();

    // Конфигурация
    const CONFIG = {
        CHECK_INTERVAL: 30000, // Проверка каждые 30 секунд
        HEALTHY_THRESHOLD: 200, // max ms для healthy
        DEGRADED_THRESHOLD: 1000, // max ms для degraded
        MAX_RETRIES: 3,
        FALLBACK_MODE: false
    };

    // Типы ошибок
    const ERROR_TYPES = {
        NETWORK: 'NETWORK',
        SERVER: 'SERVER',
        TIMEOUT: 'TIMEOUT',
        AUTH: 'AUTH',
        VALIDATION: 'VALIDATION',
        UNKNOWN: 'UNKNOWN'
    };

    // Определение типа ошибки
    function identifyError(error) {
        if (!error) return ERROR_TYPES.UNKNOWN;

        const message = error.message?.toLowerCase() || '';
        const status = error.status || error.statusCode;

        // Network errors
        if (!navigator.onLine || message.includes('network') || message.includes('fetch')) {
            return ERROR_TYPES.NETWORK;
        }

        // Server errors (5xx)
        if (status >= 500 || message.includes('internal server error') || message.includes('service unavailable')) {
            return ERROR_TYPES.SERVER;
        }

        // Timeout errors
        if (status === 408 || message.includes('timeout') || message.includes('aborted')) {
            return ERROR_TYPES.TIMEOUT;
        }

        // Auth errors (401, 403)
        if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('forbidden')) {
            return ERROR_TYPES.AUTH;
        }

        // Validation errors (4xx without auth)
        if (status >= 400 && status < 500) {
            return ERROR_TYPES.VALIDATION;
        }

        // Connection refused/reset
        if (message.includes('connection refused') || message.includes('connection reset') || message.includes('econnrefused')) {
            return ERROR_TYPES.SERVER;
        }

        return ERROR_TYPES.UNKNOWN;
    }

    // Проверка статуса сервера
    async function checkServerStatus() {
        const now = Date.now();
        
        // Пропускаем проверку на странице авторизации
        const path = window.location.pathname.toLowerCase();
        if (path.includes('auth') || path === '/auth.html') {
            serverStatus = 'healthy';
            return serverStatus;
        }

        if (now - lastServerCheck < CONFIG.CHECK_INTERVAL) {
            return serverStatus;
        }

        lastServerCheck = now;

        try {
            const start = Date.now();

            // Получаем токен авторизации
            const token = typeof TokenManager !== 'undefined' ? TokenManager.getToken() : null;
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch('/api/me', {
                method: 'HEAD',
                cache: 'no-store',
                headers
            });
            const latency = Date.now() - start;

            if (response.ok) {
                serverStatus = latency <= CONFIG.HEALTHY_THRESHOLD ? 'healthy' : 'degraded';
            } else if (response.status === 401) {
                // 401 - пользователь не авторизован, это нормально
                serverStatus = 'healthy';
            } else {
                serverStatus = 'degraded';
            }
        } catch (error) {
            console.warn('[ConnectionManager] Сервер недоступен:', error.message);
            serverStatus = 'offline';
        }

        emit('statusChange', { status: serverStatus, isOnline });
        return serverStatus;
    }

    // Вход в fallback-режим
    function enterFallbackMode() {
        if (CONFIG.FALLBACK_MODE) return;

        CONFIG.FALLBACK_MODE = true;
        console.warn('[ConnectionManager] Вход в fallback-режим');
        emit('fallbackEnter', { timestamp: Date.now() });

        // Показываем уведомление
        if (window.NotificationManager) {
            NotificationManager.warning('Сервер недоступен. Работа в офлайн-режиме');
        }
    }

    // Выход из fallback-режима
    function exitFallbackMode() {
        if (!CONFIG.FALLBACK_MODE) return;

        CONFIG.FALLBACK_MODE = false;
        console.log('[ConnectionManager] Выход из fallback-режима');
        emit('fallbackExit', { timestamp: Date.now() });

        if (window.NotificationManager) {
            NotificationManager.success('Соединение восстановлено');
        }
    }

    // Обработка ошибки соединения
    async function handleConnectionError(error) {
        const errorType = identifyError(error);
        console.log('[ConnectionManager] Ошибка соединения:', errorType, error);

        const context = {
            error,
            errorType,
            timestamp: Date.now(),
            isOnline,
            serverStatus
        };

        switch (errorType) {
            case ERROR_TYPES.NETWORK:
                enterFallbackMode();
                emit('networkError', context);
                return { recovered: false, fallback: true };

            case ERROR_TYPES.SERVER:
            case ERROR_TYPES.TIMEOUT:
                await checkServerStatus();
                if (serverStatus === 'offline') {
                    enterFallbackMode();
                }
                emit('serverError', context);
                return { recovered: false, fallback: serverStatus === 'offline' };

            case ERROR_TYPES.AUTH:
                // Очищаем токен и редиректим на логин
                if (window.HashStorage) {
                    HashStorage.logout();
                }
                emit('authError', context);
                return { recovered: false, redirect: '/auth.html' };

            case ERROR_TYPES.VALIDATION:
                emit('validationError', context);
                return { recovered: false, message: error.message };

            default:
                emit('unknownError', context);
                return { recovered: false, message: 'Неизвестная ошибка' };
        }
    }

    // Безопасный API-запрос
    async function safeRequest(url, options = {}) {
        const maxRetries = options.maxRetries || CONFIG.MAX_RETRIES;
        const retryDelay = options.retryDelay || 1000;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Проверяем онлайн-статус
                if (!isOnline) {
                    throw new Error('Нет подключения к интернету');
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    }
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const error = new Error(`HTTP ${response.status}`);
                    error.status = response.status;
                    throw error;
                }

                // Выходим из fallback при успешном запросе
                if (CONFIG.FALLBACK_MODE) {
                    exitFallbackMode();
                }

                return await response.json();
            } catch (error) {
                lastError = error;
                console.warn(`[ConnectionManager] Попытка ${attempt}/${maxRetries} не удалась:`, error.message);

                if (attempt < maxRetries) {
                    const delay = retryDelay * Math.pow(2, attempt - 1); // Экспоненциальная задержка
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // Все попытки исчерпаны
        await handleConnectionError(lastError);
        throw lastError;
    }

    // Подписка на события
    function on(event, callback) {
        if (!listeners.has(event)) {
            listeners.set(event, new Set());
        }
        listeners.get(event).add(callback);

        return () => off(event, callback);
    }

    function off(event, callback) {
        if (listeners.has(event)) {
            listeners.get(event).delete(callback);
        }
    }

    function emit(event, data) {
        if (listeners.has(event)) {
            listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[ConnectionManager] Ошибка в обработчике ${event}:`, error);
                }
            });
        }
    }

    // Инициализация
    function init() {
        console.log('[ConnectionManager] Инициализация...');

        // Слушаем online/offline события
        window.addEventListener('online', () => {
            isOnline = true;
            console.log('[ConnectionManager] Соединение восстановлено');
            checkServerStatus().then(() => {
                if (serverStatus !== 'offline') {
                    exitFallbackMode();
                }
            });
            emit('online', { timestamp: Date.now() });
        });

        window.addEventListener('offline', () => {
            isOnline = false;
            console.warn('[ConnectionManager] Соединение потеряно');
            emit('offline', { timestamp: Date.now() });
        });

        // Запускаем периодическую проверку
        checkInterval = setInterval(checkServerStatus, CONFIG.CHECK_INTERVAL);

        // Первичная проверка
        checkServerStatus();

        console.log('[ConnectionManager] Инициализирован');
    }

    // Публичный API
    return {
        init,
        ERROR_TYPES,

        // Статус
        getStatus: () => ({ isOnline, serverStatus, fallbackMode: CONFIG.FALLBACK_MODE }),

        // Проверка
        checkServerStatus,

        // Обработка ошибок
        handleConnectionError,
        identifyError,

        // Безопасные запросы
        safeRequest,

        // Fallback-режим
        enterFallbackMode,
        exitFallbackMode,

        // События
        on,
        off,
        emit
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.ConnectionManager = ConnectionManager;
    console.log('📡 ConnectionManager v1.0 загружен');
}
