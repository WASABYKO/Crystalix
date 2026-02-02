/**
 * GlobalErrorHandler — Глобальный обработчик ошибок
 * Перехватывает все типы ошибок в приложении и обеспечивает
 * корректное восстановление после сбоев
 */

class GlobalErrorHandler {
    constructor() {
        this.errorQueue = [];
        this.isHandling = false;
        this.maxQueueSize = 100;
        this.recoveryStrategies = new Map();
        this.ignorePatterns = [
            /ResizeObserver/,
            /non-composed/,
            /favicon\.ico/,
            /404/,
            /net::ERR/  // Сетевые ошибки обрабатываем отдельно
        ];
        
        this.init();
    }
    
    init() {
        // Глобальные обработчики
        window.addEventListener('error', (event) => this.handleWindowError(event));
        window.addEventListener('unhandledrejection', (event) => this.handleUnhandledRejection(event));
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Обработчик для fetch
        const originalFetch = window.fetch;
        window.fetch = (...args) => this.wrapFetch(originalFetch, ...args);
        
        // Обработчик для XMLHttpRequest
        this.wrapXHR();
        
        console.log('✅ GlobalErrorHandler инициализирован');
    }
    
    /**
     * Обработка window.error события
     */
    handleWindowError(event) {
        const error = event.error || new Error(event.message);
        
        // Игнорируем некоторые типы ошибок
        if (this.shouldIgnoreError(error)) {
            return;
        }
        
        // Для критических ошибок - пытаемся восстановиться
        if (this.isCriticalError(error)) {
            this.handleCriticalError(error);
        } else {
            this.handleError(error, 'window.error');
        }
    }
    
    /**
     * Обработка unhandled promise rejection
     */
    handleUnhandledRejection(event) {
        const error = event.reason instanceof Error 
            ? event.reason 
            : new Error(String(event.reason));
        
        if (this.shouldIgnoreError(error)) {
            return;
        }
        
        this.handleError(error, 'unhandledrejection');
        
        // Предотвращаем краш браузера
        event.preventDefault();
    }
    
    /**
     * Обработка восстановления соединения
     */
    handleOnline() {
        console.log('🌐 Соединение восстановлено');
        this.showNotification('Соединение восстановлено', 'success');
        
        // Уведомляем ConnectionManager
        if (typeof ConnectionManager !== 'undefined') {
            ConnectionManager.handleOnline();
        }
        
        // Повторяем зафейленные запросы
        this.retryQueuedRequests();
    }
    
    /**
     * Обработка потери соединения
     */
    handleOffline() {
        console.log('🌐 Соединение потеряно');
        this.showNotification('Нет подключения к интернету', 'warning');
        
        // Уведомляем ConnectionManager
        if (typeof ConnectionManager !== 'undefined') {
            ConnectionManager.handleOffline();
        }
    }
    
    /**
     * Обёртка для fetch
     */
    wrapFetch(originalFetch, ...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        
        // Пропускаем неважные запросы
        if (this.shouldIgnoreUrl(url)) {
            return originalFetch(...args);
        }
        
        return originalFetch(...args).catch(async (error) => {
            // Проверяем ошибки соединения
            if (this.isConnectionError(error)) {
                this.queueRequest(url, args);
                
                // Уведомляем ConnectionManager
                if (typeof ConnectionManager !== 'undefined') {
                    ConnectionManager.handleConnectionError(error);
                }
                
                throw error;
            }
            
            this.handleError(error, `fetch: ${url}`);
            throw error;
        });
    }
    
    /**
     * Обёртка для XMLHttpRequest
     */
    wrapXHR() {
        const self = this;
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            this._method = method;
            return originalOpen.apply(this, arguments);
        };
        
        XMLHttpRequest.prototype.send = function(data) {
            this.addEventListener('error', () => {
                if (self.shouldIgnoreUrl(this._url)) return;
                
                self.queueRequest(this._url, [this._method, this._url]);
                
                if (typeof ConnectionManager !== 'undefined') {
                    ConnectionManager.handleConnectionError(new Error('XHR connection error'));
                }
            });
            
            return originalSend.apply(this, arguments);
        };
    }
    
    /**
     * Основной метод обработки ошибок
     */
    handleError(error, source) {
        const errorInfo = {
            timestamp: new Date().toISOString(),
            message: error.message,
            stack: error.stack,
            source,
            type: this.classifyError(error)
        };
        
        console.error('❌ Ошибка:', errorInfo);
        
        // Добавляем в очередь
        this.errorQueue.push(errorInfo);
        
        // Ограничиваем размер очереди
        if (this.errorQueue.length > this.maxQueueSize) {
            this.errorQueue.shift();
        }
        
        // Выбираем стратегию восстановления
        this.applyRecoveryStrategy(errorInfo);
    }
    
    /**
     * Обработка критических ошибок
     */
    handleCriticalError(error) {
        console.error('💥 Критическая ошибка:', error);
        
        // Показываем пользователю сообщение
        this.showNotification('Произошла критическая ошибка. Попробуйте обновить страницу.', 'error');
        
        // Пытаемся восстановить состояние приложения
        this.attemptRecovery();
    }
    
    /**
     * Классификация типа ошибки
     */
    classifyError(error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('network') || message.includes('fetch')) {
            return 'network';
        }
        if (message.includes('timeout')) {
            return 'timeout';
        }
        if (message.includes('auth') || message.includes('login') || message.includes('unauthorized')) {
            return 'auth';
        }
        if (message.includes('hashstorage')) {
            return 'storage';
        }
        if (message.includes('websocket')) {
            return 'websocket';
        }
        return 'unknown';
    }
    
    /**
     * Проверка на критическую ошибку
     */
    isCriticalError(error) {
        const criticalPatterns = [
            /cannot read property/,
            /undefined is not a function/,
            /maximum call stack/,
            /out of memory/,
            /sessionstorage|localstorage/
        ];
        
        return criticalPatterns.some(pattern => pattern.test(error.message));
    }
    
    /**
     * Проверка на ошибку соединения
     */
    isConnectionError(error) {
        return error.name === 'TypeError' && 
               (error.message.includes('fetch') || 
                error.message.includes('network') ||
                error.message.includes('Failed to fetch'));
    }
    
    /**
     * Проверка нужно ли игнорировать ошибку
     */
    shouldIgnoreError(error) {
        return this.ignorePatterns.some(pattern => pattern.test(error.message));
    }
    
    /**
     * Проверка URL на игнорирование
     */
    shouldIgnoreUrl(url) {
        const ignoreUrls = [
            /favicon/,
            /google-analytics/,
            /googletagmanager/,
            /hotjar/,
            /browserupdate/
        ];
        
        return ignoreUrls.some(pattern => pattern.test(url));
    }
    
    /**
     * Добавление запроса в очередь для повтора
     */
    queueRequest(url, args) {
        const queuedRequest = {
            url,
            args,
            timestamp: Date.now(),
            retries: 0
        };
        
        // Сохраняем в localStorage для персистентности
        const queue = this.getRequestQueue();
        queue.push(queuedRequest);
        localStorage.setItem('errorRequestQueue', JSON.stringify(queue.slice(-50)));
    }
    
    /**
     * Получение очереди запросов
     */
    getRequestQueue() {
        try {
            return JSON.parse(localStorage.getItem('errorRequestQueue')) || [];
        } catch {
            return [];
        }
    }
    
    /**
     * Повтор зафейленных запросов
     */
    async retryQueuedRequests() {
        const queue = this.getRequestQueue();
        
        if (queue.length === 0) return;
        
        console.log(`🔄 Повтор ${queue.length} запросов...`);
        
        for (const item of queue) {
            try {
                await fetch(item.url, item.args[1] || {});
                console.log(`✅ Запрос выполнен: ${item.url}`);
            } catch (error) {
                console.warn(`❌ Повторный фейл: ${item.url}`);
            }
        }
        
        // Очищаем очередь
        localStorage.removeItem('errorRequestQueue');
    }
    
    /**
     * Применение стратегии восстановления
     */
    applyRecoveryStrategy(errorInfo) {
        const strategies = {
            'network': () => {
                if (typeof ConnectionManager !== 'undefined') {
                    ConnectionManager.handleConnectionError(new Error(errorInfo.message));
                }
            },
            'auth': () => {
                // Редирект на страницу авторизации
                if (!window.location.pathname.includes('auth.html')) {
                    localStorage.setItem('authError', 'true');
                    window.location.href = '/auth.html';
                }
            },
            'storage': () => {
                // Перезагрузка storage
                if (typeof HashStorage !== 'undefined' && HashStorage.reinitialize) {
                    HashStorage.reinitialize();
                }
            }
        };
        
        const strategy = strategies[errorInfo.type];
        if (strategy) {
            strategy();
        }
    }
    
    /**
     * Попытка восстановления после критической ошибки
     */
    attemptRecovery() {
        // Очищаем таймеры
        const highestId = setTimeout(() => {}, 0);
        for (let i = 0; i < highestId; i++) {
            clearTimeout(i);
            clearInterval(i);
        }
        
        // Сбрасываем состояние загрузки
        this.hideAllLoaders();
        
        // Показываем кнопку перезагрузки
        this.showRecoveryUI();
    }
    
    /**
     * Скрытие всех лоадеров
     */
    hideAllLoaders() {
        const loaders = document.querySelectorAll('.loader, #globalLoader, .loading-overlay');
        loaders.forEach(loader => {
            loader.style.display = 'none';
            loader.style.opacity = '0';
        });
    }
    
    /**
     * Показ UI восстановления
     */
    showRecoveryUI() {
        const recoveryDiv = document.createElement('div');
        recoveryDiv.id = 'recoveryUI';
        recoveryDiv.innerHTML = `
            <div class="recovery-modal">
                <h3>⚠️ Произошла ошибка</h3>
                <p>Приложение столкнулось с проблемой. Попробуйте обновить страницу.</p>
                <button onclick="window.location.reload()" class="btn btn-primary">
                    🔄 Обновить страницу
                </button>
            </div>
        `;
        
        // Добавляем стили если их нет
        if (!document.getElementById('recoveryStyles')) {
            const style = document.createElement('style');
            style.id = 'recoveryStyles';
            style.textContent = `
                #recoveryUI {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.8);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999;
                }
                .recovery-modal {
                    background: white;
                    padding: 30px;
                    border-radius: 12px;
                    text-align: center;
                    max-width: 400px;
                }
                .recovery-modal h3 { margin-top: 0; }
                .recovery-modal button { margin-top: 15px; }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(recoveryDiv);
    }
    
    /**
     * Показ уведомления
     */
    showNotification(message, type = 'info') {
        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show?.(message, type);
            return;
        }
        
        // Простой fallback
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            background: ${type === 'error' ? '#e74c3c' : type === 'success' ? '#2ecc71' : '#3498db'};
            color: white;
            border-radius: 8px;
            z-index: 999999;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    /**
     * Получение истории ошибок
     */
    getErrorHistory() {
        return this.errorQueue;
    }
    
    /**
     * Очистка истории ошибок
     */
    clearErrorHistory() {
        this.errorQueue = [];
        localStorage.removeItem('errorRequestQueue');
    }
    
    /**
     * Регистрация кастомной стратегии восстановления
     */
    registerRecoveryStrategy(errorType, strategyFn) {
        this.recoveryStrategies.set(errorType, strategyFn);
    }
}

// Инициализация при загрузке
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        window.GlobalErrorHandler = new GlobalErrorHandler();
    });
}

// Export для модульных систем
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GlobalErrorHandler;
}
