/**
 * StateManager v2.0
 * Централизованное управление состоянием приложения
 * С поддержкой persistence, subscriptions и middleware
 */

class StateManager {
    constructor(options = {}) {
        this.state = {};
        this.initialState = {
            // Статус приложения
            appStatus: 'initializing', // initializing, ready, error
            
            // Статус авторизации
            authStatus: 'unknown', // unknown, authenticated, unauthenticated, loading
            user: null,
            userId: null,
            token: null,
            
            // Состояние соединения
            connectionStatus: 'offline', // online, offline, connecting, error
            lastConnectionTime: null,
            
            // Навигация
            currentRoute: null,
            previousRoute: null,
            navigationHistory: [],
            
            // UI состояние
            isLoading: false,
            loadingMessage: '',
            modal: null, // { type, data }
            notifications: [],
            
            // Данные приложения
            data: {
                chats: [],
                messages: [],
                friends: [],
                tariffs: [],
                settings: {}
            },
            
            // Кэш
            cache: {},
            
            // Ошибки
            errors: [],
            lastError: null,
            
            // Meta
            initializedAt: null,
            version: '2.0'
        };
        
        this.state = { ...this.initialState };
        
        this.subscribers = new Map();
        this.middlewares = [];
        this.history = [];
        this.maxHistoryLength = options.maxHistoryLength || 50;
        this.isDebug = options.debug || false;
        
        // Инициализация persistence
        this.persistenceKey = options.persistenceKey || 'appState';
        this.persistKeys = options.persistKeys || ['auth', 'settings', 'user'];
        this.autoPersist = options.autoPersist !== false;
        
        this.initialized = false;
    }
    
    /**
     * Инициализация StateManager
     */
    async initialize() {
        if (this.initialized) {
            console.warn('⚠️ StateManager уже инициализирован');
            return this;
        }
        
        // Загружаем сохраненное состояние
        this.loadPersistedState();
        
        // Подписываемся на изменения HashStorage
        if (typeof HashStorage !== 'undefined') {
            HashStorage.on?.('change', (key, value) => {
                this.handleStorageChange(key, value);
            });
        }
        
        // Подписываемся на изменения ConnectionManager
        if (typeof ConnectionManager !== 'undefined') {
            ConnectionManager.on?.('online', () => this.setConnectionStatus('online'));
            ConnectionManager.on?.('offline', () => this.setConnectionStatus('offline'));
        }
        
        // Подписываемся на изменения AuthManager
        if (typeof AuthManager !== 'undefined') {
            AuthManager.on?.('authenticated', (user) => this.setAuthUser(user));
            AuthManager.on?.('unauthenticated', () => this.clearAuth());
            AuthManager.on?.('logout', () => this.clearAuth());
        }
        
        this.state.initializedAt = new Date().toISOString();
        this.initialized = true;
        
        console.log('✅ StateManager инициализирован');
        this.emit('initialized', this.state);
        
        return this;
    }
    
    /**
     * Получение значения состояния
     */
    get(path) {
        const keys = Array.isArray(path) ? path : path.split('.');
        let value = this.state;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return undefined;
            }
        }
        
        return value;
    }
    
    /**
     * Установка значения состояния
     */
    set(path, value, options = {}) {
        const keys = Array.isArray(path) ? path : this.parsePath(path);
        const oldValue = this.get(path);
        
        // Проверяем изменилось ли значение
        if (JSON.stringify(oldValue) === JSON.stringify(value)) {
            return this;
        }
        
        // Выполняем middleware
        const context = {
            path,
            oldValue,
            newValue: value,
            options,
            timestamp: Date.now()
        };
        
        for (const middleware of this.middlewares) {
            const result = middleware(context);
            if (result === false) {
                console.log(`🚫 Middleware отклонил изменение: ${path}`);
                return this;
            }
            if (result && result !== context) {
                value = result.newValue !== undefined ? result.newValue : value;
            }
        }
        
        // Обновляем состояние
        this.updateState(keys, value);
        
        // Сохраняем в историю
        if (options.saveToHistory !== false) {
            this.saveToHistory({
                action: 'set',
                path,
                oldValue,
                newValue: value,
                timestamp: context.timestamp
            });
        }
        
        // Уведомляем подписчиков
        this.emit(path, value, oldValue);
        this.emit('*', { path, value, oldValue });
        
        // Auto-persist для ключей
        if (this.autoPersist) {
            this.maybePersist(path, value);
        }
        
        // Логируем в debug режиме
        if (this.isDebug) {
            console.log(`📝 State[${path}]:`, oldValue, '→', value);
        }
        
        return this;
    }
    
    /**
     * Обновление вложенного состояния
     */
    update(path, updates, options = {}) {
        const current = this.get(path) || {};
        const merged = this.deepMerge(current, updates);
        return this.set(path, merged, options);
    }
    
    /**
     * Удаление ключа состояния
     */
    delete(path, options = {}) {
        const keys = Array.isArray(path) ? path : this.parsePath(path);
        const parentPath = keys.slice(0, -1);
        const key = keys[keys.length - 1];
        
        const parent = this.get(parentPath);
        if (parent && typeof parent === 'object') {
            const newParent = { ...parent };
            delete newParent[key];
            this.set(parentPath, newParent, options);
        }
        
        return this;
    }
    
    /**
     * Сброс состояния
     */
    reset(newState = null, options = {}) {
        const oldState = { ...this.state };
        this.state = newState ? { ...this.initialState, ...newState } : { ...this.initialState };
        
        this.emit('reset', { oldState, newState: this.state });
        this.emit('*', { action: 'reset', oldState, newState: this.state });
        
        return this;
    }
    
    /**
     * Добавление middleware
     */
    use(middleware) {
        if (typeof middleware === 'function') {
            this.middlewares.push(middleware);
        }
        return this;
    }
    
    /**
     * Подписка на изменения
     */
    subscribe(path, callback, options = {}) {
        const id = options.id || `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (!this.subscribers.has(path)) {
            this.subscribers.set(path, new Map());
        }
        
        const pathSubscribers = this.subscribers.get(path);
        pathSubscribers.set(id, {
            callback,
            options
        });
        
        // Возвращаем функцию отписки
        return () => this.unsubscribe(path, id);
    }
    
    /**
     * Отписка от изменений
     */
    unsubscribe(path, id) {
        if (this.subscribers.has(path)) {
            this.subscribers.get(path).delete(id);
        }
    }
    
    /**
     * Отписка от всех изменений пути
     */
    unsubscribeAll(path) {
        if (path) {
            this.subscribers.delete(path);
        } else {
            this.subscribers.clear();
        }
    }
    
    /**
     * Уведомление подписчиков
     */
    emit(path, value, oldValue) {
        const notifyPaths = [path, '*'];
        
        for (const notifyPath of notifyPaths) {
            if (this.subscribers.has(notifyPath)) {
                this.subscribers.get(notifyPath).forEach((subscription, id) => {
                    try {
                        subscription.callback(value, oldValue, {
                            path,
                            subscriptionId: id
                        });
                    } catch (error) {
                        console.error(`❌ Ошибка в подписчике ${id}:`, error);
                    }
                });
            }
        }
    }
    
    /**
     * Установка статуса авторизации
     */
    setAuthStatus(status, data = null) {
        return this.set('authStatus', status, { source: 'auth' })
            .set('lastAuthChange', Date.now(), { source: 'auth' });
    }
    
    /**
     * Установка данных пользователя
     */
    setAuthUser(user) {
        return this.set('user', user, { source: 'auth' })
            .set('userId', user?.id || null, { source: 'auth' })
            .set('authStatus', user ? 'authenticated' : 'unauthenticated', { source: 'auth' });
    }
    
    /**
     * Очистка данных авторизации
     */
    clearAuth(options = {}) {
        return this.set('authStatus', 'unauthenticated', { source: 'auth' })
            .set('user', null, { source: 'auth' })
            .set('userId', null, { source: 'auth' })
            .set('token', null, { source: 'auth' });
    }
    
    /**
     * Установка статуса соединения
     */
    setConnectionStatus(status) {
        const wasOffline = this.state.connectionStatus === 'offline';
        const isOnline = status === 'online';
        
        return this.set('connectionStatus', status, { source: 'connection' })
            .set('lastConnectionTime', isOnline && wasOffline ? Date.now() : null, { source: 'connection' });
    }
    
    /**
     * Установка loading состояния
     */
    setLoading(isLoading, message = '') {
        return this.set('isLoading', isLoading, { source: 'ui' })
            .set('loadingMessage', message, { source: 'ui' });
    }
    
    /**
     * Добавление уведомления
     */
    addNotification(notification) {
        const item = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            read: false,
            ...notification
        };
        
        const notifications = [...this.state.notifications, item];
        this.set('notifications', notifications, { source: 'ui' });
        
        // Автоматически удаляем старые уведомления
        this.cleanupOldNotifications();
        
        return item.id;
    }
    
    /**
     * Удаление уведомления
     */
    removeNotification(id) {
        const notifications = this.state.notifications.filter(n => n.id !== id);
        this.set('notifications', notifications, { source: 'ui' });
    }
    
    /**
     * Отметка уведомления как прочитанного
     */
    markNotificationRead(id) {
        const notifications = this.state.notifications.map(n => 
            n.id === id ? { ...n, read: true } : n
        );
        this.set('notifications', notifications, { source: 'ui' });
    }
    
    /**
     * Очистка старых уведомлений
     */
    cleanupOldNotifications() {
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней
        const cutoff = Date.now() - maxAge;
        
        const notifications = this.state.notifications.filter(
            n => n.timestamp > cutoff
        );
        
        if (notifications.length !== this.state.notifications.length) {
            this.set('notifications', notifications, { source: 'ui' });
        }
    }
    
    /**
     * Установка модального окна
     */
    openModal(type, data = null) {
        return this.set('modal', { type, data, openedAt: Date.now() }, { source: 'ui' });
    }
    
    /**
     * Закрытие модального окна
     */
    closeModal() {
        return this.set('modal', null, { source: 'ui' });
    }
    
    /**
     * Навигация
     */
    navigate(route, options = {}) {
        const previousRoute = this.state.currentRoute;
        
        // Пропускаем если тот же маршрут
        if (previousRoute === route && !options.force) {
            return this;
        }
        
        // Сохраняем в историю
        if (previousRoute && options.saveToHistory !== false) {
            const history = [...this.state.navigationHistory, {
                route: previousRoute,
                timestamp: Date.now()
            }];
            
            // Ограничиваем историю
            if (history.length > this.maxHistoryLength) {
                history.shift();
            }
            
            this.set('navigationHistory', history, { source: 'navigation' });
        }
        
        return this.set('previousRoute', previousRoute, { source: 'navigation' })
            .set('currentRoute', route, { source: 'navigation' });
    }
    
    /**
     * Назад в истории
     */
    goBack() {
        const history = this.state.navigationHistory;
        if (history.length === 0) {
            return null;
        }
        
        const lastEntry = history[history.length - 1];
        const newHistory = history.slice(0, -1);
        
        this.set('navigationHistory', newHistory, { source: 'navigation' });
        this.navigate(lastEntry.route, { force: true });
        
        return lastEntry.route;
    }
    
    /**
     * Добавление ошибки
     */
    addError(error, options = {}) {
        const item = {
            id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            read: false,
            fatal: options.fatal || false,
            ...(typeof error === 'string' ? { message: error } : error)
        };
        
        const errors = [...this.state.errors, item];
        this.set('errors', errors, { source: 'error' })
            .set('lastError', item, { source: 'error' });
        
        return item.id;
    }
    
    /**
     * Удаление ошибки
     */
    removeError(id) {
        const errors = this.state.errors.filter(e => e.id !== id);
        this.set('errors', errors, { source: 'error' });
        
        if (this.state.errors.length === 0) {
            this.set('lastError', null, { source: 'error' });
        }
    }
    
    /**
     * Очистка всех ошибок
     */
    clearErrors() {
        return this.set('errors', [], { source: 'error' })
            .set('lastError', null, { source: 'error' });
    }
    
    /**
     * Установка данных
     */
    setData(key, value, options = {}) {
        return this.set(`data.${key}`, value, { source: 'data', ...options });
    }
    
    /**
     * Получение данных
     */
    getData(key) {
        return this.get(`data.${key}`);
    }
    
    /**
     * Обновление данных
     */
    updateData(key, updates, options = {}) {
        return this.update(`data.${key}`, updates, { source: 'data', ...options });
    }
    
    /**
     * Сохранение в кэш
     */
    setCache(key, value, ttl = null) {
        const cacheItem = {
            value,
            timestamp: Date.now(),
            ttl: ttl || (60 * 60 * 1000) // 1 час по умолчанию
        };
        
        const cache = { ...this.state.cache, [key]: cacheItem };
        return this.set('cache', cache, { source: 'cache' });
    }
    
    /**
     * Получение из кэша
     */
    getCache(key) {
        const cacheItem = this.state.cache?.[key];
        if (!cacheItem) return null;
        
        const isExpired = Date.now() - cacheItem.timestamp > cacheItem.ttl;
        if (isExpired) {
            this.removeCache(key);
            return null;
        }
        
        return cacheItem.value;
    }
    
    /**
     * Удаление из кэша
     */
    removeCache(key) {
        const cache = { ...this.state.cache };
        delete cache[key];
        return this.set('cache', cache, { source: 'cache' });
    }
    
    /**
     * Очистка устаревшего кэша
     */
    cleanupCache() {
        const now = Date.now();
        const cache = { ...this.state.cache };
        
        Object.keys(cache).forEach(key => {
            if (now - cache[key].timestamp > cache[key].ttl) {
                delete cache[key];
            }
        });
        
        return this.set('cache', cache, { source: 'cache' });
    }
    
    /**
     * Получение полного состояния
     */
    getState() {
        return { ...this.state };
    }
    
    /**
     * Получение истории изменений
     */
    getHistory() {
        return [...this.history];
    }
    
    /**
     * Сохранение в историю
     */
    saveToHistory(entry) {
        this.history.push(entry);
        
        // Ограничиваем историю
        if (this.history.length > this.maxHistoryLength) {
            this.history = this.history.slice(-this.maxHistoryLength);
        }
        
        // Persist история
        try {
            localStorage.setItem(`${this.persistenceKey}History`, JSON.stringify(this.history));
        } catch (e) {
            // Игнорируем ошибки
        }
    }
    
    /**
     * Восстановление истории
     */
    restoreHistory() {
        try {
            const saved = localStorage.getItem(`${this.persistenceKey}History`);
            if (saved) {
                this.history = JSON.parse(saved);
            }
        } catch (e) {
            this.history = [];
        }
    }
    
    /**
     * Сериализация состояния
     */
    toJSON() {
        return {
            state: this.state,
            history: this.history,
            version: this.state.version,
            serializedAt: new Date().toISOString()
        };
    }
    
    /**
     * Восстановление состояния из JSON
     */
    fromJSON(json) {
        if (json.state) {
            this.state = { ...this.state, ...json.state };
        }
        if (json.history) {
            this.history = json.history;
        }
        return this;
    }
    
    /**
     * Сохранение состояния в localStorage
     */
    persist(keys = null) {
        const keysToPersist = keys || this.persistKeys;
        const data = {};
        
        keysToPersist.forEach(key => {
            const value = this.get(key);
            if (value !== undefined) {
                data[key] = value;
            }
        });
        
        try {
            localStorage.setItem(this.persistenceKey, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('❌ Ошибка сохранения состояния:', e);
            return false;
        }
    }
    
    /**
     * Загрузка состояния из localStorage
     */
    loadPersistedState() {
        try {
            const saved = localStorage.getItem(this.persistenceKey);
            if (saved) {
                const data = JSON.parse(saved);
                
                Object.keys(data).forEach(key => {
                    this.set(key, data[key], { source: 'persistence' });
                });
                
                console.log('✅ Загружено сохраненное состояние');
                return true;
            }
        } catch (e) {
            console.error('❌ Ошибка загрузки состояния:', e);
        }
        return false;
    }
    
    /**
     * Возможное сохранение при изменении
     */
    maybePersist(path, value) {
        const rootKey = Array.isArray(path) ? path[0] : path.split('.')[0];
        
        if (this.persistKeys.includes(rootKey)) {
            this.persist([rootKey]);
        }
    }
    
    /**
     * Обработка изменения HashStorage
     */
    handleStorageChange(key, value) {
        // Синхронизируем с нашим состоянием
        if (key.startsWith('state.')) {
            const stateKey = key.substring(6);
            this.set(stateKey, value, { source: 'hashStorage' });
        }
    }
    
    /**
     * Глубокое слияние объектов
     */
    deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] instanceof Object && key in target) {
                result[key] = this.deepMerge(target[key], source[key]);
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    }
    
    /**
     * Парсинг пути в массив ключей
     */
    parsePath(path) {
        if (Array.isArray(path)) return path;
        
        // Поддержка путей с точечной нотацией и bracket notation
        return path
            .replace(/\[(\w+)\]/g, '.$1')
            .replace(/^\./, '')
            .split('.');
    }
    
    /**
     * Утилита для computed значений
     */
    computed(dependencies, computeFn) {
        const paths = Array.isArray(dependencies) ? dependencies : [dependencies];
        
        // Начальное вычисление
        let value = computeFn(paths.map(p => this.get(p)));
        
        // Подписка на изменения
        const unsubscribe = this.subscribe('*', () => {
            const newValue = computeFn(paths.map(p => this.get(p)));
            if (JSON.stringify(newValue) !== JSON.stringify(value)) {
                value = newValue;
            }
        });
        
        return {
            get: () => value,
            unsubscribe
        };
    }
}

// Инициализация при загрузке
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        window.StateManager = new StateManager();
    });
}

// Export для модульных систем
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateManager;
}
