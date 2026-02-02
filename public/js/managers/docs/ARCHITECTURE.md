# Архитектура системы авторизации и WebSocket

## Обзор

Документация описывает архитектуру системы для SPA приложения с сервером, WebSocket и HashStorage v3.1.

## Проблемы, которые решает система

1. **ERR_CONNECTION_REFUSED / ERR_CONNECTION_RESET** - ошибки при недоступности сервера
2. **Дублирующая инициализация HashStorage** - множественные вызовы инициализации
3. **Бесконечный релоад после ошибки** - зацикливание при ошибках авторизации

---

## Архитектурные компоненты

### 1. RetryManager

**Назначение:** Управление повторными попытками с экспоненциальной задержкой.

**Конфигурация:**
```javascript
{
    maxRetries: 3,           // Максимальное количество попыток
    baseDelay: 1000,         // Базовая задержка в мс
    maxDelay: 30000,         // Максимальная задержка
    backoffMultiplier: 2,    // Множитель экспоненциальной задержки
    jitterFactor: 0.1,       // Фактор случайного разброса
    onRetry: (error, attempt, delay) => {}, // Коллбэк при повторной попытке
    retryCondition: (error) => true // Условие для повторной попытки
}
```

**Алгоритм работы:**
1. Выполнить запрос
2. При ошибке проверить условие `retryCondition`
3. Если можно повторить: вычислить задержку `baseDelay * (backoffMultiplier ^ attempt)`
4. Применить jitter для избежания thundering herd
5. Подождать и повторить
6. После исчерпания попыток выбросить `MaxRetriesExceededError`

**Пример использования:**
```javascript
const retryManager = new RetryManager({
    maxRetries: 3,
    baseDelay: 1000,
    backoffMultiplier: 2
});

try {
    const result = await retryManager.execute(async () => {
        const response = await fetch('/api/login', {
            method: 'POST',
            body: JSON.stringify(credentials)
        });
        if (!response.ok) throw new Error('Login failed');
        return response.json();
    });
} catch (error) {
    if (error.type === 'MAX_RETRIES_EXCEEDED') {
        // Показать пользователю сообщение об ошибке
    }
}
```

---

### 2. SafeInitializer

**Назначение:** Защита от дублирующей инициализации с поддержкой очереди вызовов.

**Конфигурация:**
```javascript
{
    name: 'ModuleName',      // Имя модуля для логирования
    timeout: 30000,          // Таймаут инициализации
    onInitError: (error) => {} // Обработчик ошибок инициализации
}
```

**Алгоритм работы:**
1. Проверить флаг `isInitialized`
2. Если инициализирован - вернуть кешированный результат
3. Установить флаг `initializing`
4. Выполнить инициализацию
5. При успехе: установить `isInitialized = true`, сохранить результат
6. При ошибке: сбросить флаги, выбросить исключение
7. Последующие вызовы получают результат из кеша

**Пример использования:**
```javascript
const storageInit = new SafeInitializer('HashStorage');

const result = await storageInit.initialize(async () => {
    const storage = new HashStorage();
    await storage.init({
        adapter: 'server',
        serverUrl: '/api/sync'
    });
    return storage;
});

// Все последующие вызовы получают тот же экземпляр
const storage2 = await storageInit.initialize(async () => {
    return new HashStorage(); // Этот код не выполнится
});
```

---

### 3. ConnectionManager

**Назначение:** Централизованное управление HTTP-соединениями и обработка ошибок.

**Конфигурация:**
```javascript
{
    baseURL: '/api',         // Базовый URL API
    timeout: 10000,          // Таймаут запросов
    retryConfig: {           // Конфигурация повторных попыток
        maxRetries: 3,
        baseDelay: 500
    },
    serverCheckInterval: 5000, // Интервал проверки сервера
    offlineMode: false       // Включить режим офлайн
}
```

**Основные методы:**

- `request(options)` - выполнить HTTP запрос с автоматическими повторами
- `get(url, options)` - GET запрос
- `post(url, data, options)` - POST запрос
- `checkServerAvailability()` - проверить доступность сервера
- `isRetryableError(error)` - определить, можно ли повторить запрос

**Типы ошибок:**

| Код ошибки | Повторяемая | Причина |
|------------|-------------|---------|
| ERR_CONNECTION_REFUSED | ✅ | Сервер недоступен |
| ERR_CONNECTION_RESET | ✅ | Соединение сброшено |
| ETIMEDOUT | ✅ | Таймаут соединения |
| ENETUNREACH | ✅ | Нет сети |
| 401 | ❌ | Требуется авторизация |
| 403 | ❌ | Доступ запрещен |
| 400 | ❌ | Неверный запрос |
| 500 | ❗ | Ошибка сервера (опционально) |

**Пример использования:**
```javascript
const connectionManager = new ConnectionManager({
    baseURL: '/api',
    timeout: 5000
});

// Выполнить запрос с автоматическими повторами
const user = await connectionManager.post('/login', {
    email: 'user@example.com',
    password: 'password123'
});

// Проверить доступность сервера
const isAvailable = await connectionManager.checkServerAvailability();
if (!isAvailable) {
    console.log('Сервер недоступен, включен офлайн-режим');
}
```

---

### 4. AuthManager

**Назначение:** Централизованное управление авторизацией с интеграцией WebSocket.

**Конфигурация:**
```javascript
{
    connectionManager: connectionManager,
    wsManager: wsManager,
    maxRetries: 3,
    retryDelay: 1000,
    rateLimitDelay: 5000,     // Задержка между попытками входа
    onAuthStateChange: (state) => {},
    onError: (error) => {}
}
```

**Состояния авторизации:**
- `unauthenticated` - пользователь не авторизован
- `authenticating` - процесс авторизации
- `authenticated` - пользователь авторизован
- `error` - ошибка авторизации
- `rate_limited` - слишком много попыток

**Основные методы:**

- `async initialize()` - инициализировать менеджер
- `async login(credentials)` - выполнить вход
- `async logout()` - выйти из системы
- `async refreshToken()` - обновить токен
- `getAuthState()` - получить текущее состояние
- `handleConnectionError(error)` - обработать ошибку соединения

**Пример использования:**
```javascript
const authManager = new AuthManager({
    connectionManager,
    wsManager,
    onAuthStateChange: (state) => {
        console.log('Состояние авторизации:', state);
        updateUI(state);
    },
    onError: (error) => {
        showError(error.message);
    }
});

// Инициализация
await authManager.initialize();

// Вход
try {
    const result = await authManager.login({
        email: 'user@example.com',
        password: 'password123'
    });
    if (result.success) {
        // Перенаправить на dashboard
        window.location.hash = '/dashboard';
    }
} catch (error) {
    if (error.type === 'RATE_LIMITED') {
        showMessage('Слишком много попыток. Подождите.');
    }
}
```

---

### 5. WebSocketManager

**Назначение:** Управление WebSocket соединением с автоматическим переподключением и ре-аутентификацией.

**Конфигурация:**
```javascript
{
    url: 'wss://example.com/ws',
    authManager: authManager,
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
    heartbeatMessage: { type: 'ping' },
    bufferMessages: true,
    bufferFlushInterval: 1000
}
```

**Состояния соединения:**
- `disconnected` - соединение закрыто
- `connecting` - процесс подключения
- `connected` - соединение установлено
- `reconnecting` - переподключение
- `failed` - не удалось подключиться

**Основные методы:**

- `async connect(token)` - установить соединение
- `async disconnect()` - закрыть соединение
- `send(data)` - отправить сообщение
- `reconnect()` - переподключиться
- `handleMessage(event)` - обработать входящее сообщение

**Пример использования:**
```javascript
const wsManager = new WebSocketManager({
    url: `wss://${window.location.host}/ws`,
    authManager,
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    heartbeatInterval: 25000
});

// Подключение после авторизации
await authManager.login(credentials);
await wsManager.connect(authManager.getToken());

// Обработка входящих сообщений
wsManager.onMessage('message', (data) => {
    console.log('Новое сообщение:', data);
});

// Отправка сообщения
wsManager.send({
    type: 'chat_message',
    content: 'Привет!'
});

// Отключение при выходе
await authManager.logout();
wsManager.disconnect();
```

---

## Потоки данных

### Поток авторизации

```
┌─────────────────┐
│  Пользователь   │
│  нажимает       │
│  "Войти"        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AuthManager.    │
│ login()         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ConnectionMgr.  │
│ request(POST    │
│ /api/login)     │
└────────┬────────┘
         │
         ▼
    ┌────┴────┐
    │  Успех  │ ────► Сохранить токен
    └────┬────┘               │
         │ Ошибка             ▼
         ▼            ┌───────────────┐
    ┌─────────┐      │ WebSocketMgr. │
    │ Retry   │      │ connect()     │
    │ Manager │      └───────────────┘
    └────┬────┘
         │
    ┌────┴────┐
    │ Успех   │ ────► Продолжить
    └────┬────┘
         │ Исчерпаны попытки
         ▼
    ┌─────────────────┐
    │ Показать ошибку │
    │ пользователю    │
    └─────────────────┘
```

### Поток переподключения WebSocket

```
┌─────────────────┐
│ WebSocket       │
│ разорван        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ WS Manager      │
│ detects disconnect
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Проверить тип   │
│ ошибки          │
└────────┬────────┘
         │
    ┌────┴────┐
    │ 401     │      ┌─────────────────┐
    └────┬────┘      │ AuthManager     │
         │           │ refreshToken()  │
         │           └────────┬────────┘
         │                    │
         ▼                    ▼
    ┌─────────┐         ┌─────────┐
    │ Другая  │         │ Успех   │ ──► Новый токен
    │ ошибка  │         └────┬────┘
    └────┬────┘              │
         │                   ▼
         ▼            ┌───────────────┐
    ┌─────────┐      │ WS Manager    │
    │ Wait    │      │ reconnect()   │
    │ interval│      └───────────────┘
    └────┬────┘
         │
         ▼
    ┌─────────────────┐
    │ reconnectAttempts++
    │ < maxAttempts   │
    └────────┬────────┘
         │
         ▼
    ┌─────────────────┐
    │ Попытка         │
    │ соединения      │
    └─────────────────┘
```

---

## Интеграция с HashStorage v3.1

### Паттерн инициализации

```javascript
// public/js/hashStorage.js

class HashStorage {
    constructor() {
        this.initializer = new SafeInitializer('HashStorage');
        this.connectionManager = null;
    }

    async init(config) {
        return this.initializer.initialize(async () => {
            // Одиночная инициализация
            this.connectionManager = new ConnectionManager({
                baseURL: config.serverUrl,
                timeout: config.timeout || 10000
            });

            // Загрузить данные с сервера
            await this.loadFromServer();
            
            // Настроить адаптеры
            this.setupAdapters();
            
            // Запустить синхронизацию
            this.startSync();
            
            return this;
        });
    }

    async loadFromServer() {
        try {
            const data = await this.connectionManager.get('/storage/load');
            this._storage = data;
        } catch (error) {
            console.warn('Не удалось загрузить данные с сервера, используем локальные');
            this._storage = this._loadLocal() || {};
        }
    }
}
```

---

## Глобальный обработчик ошибок

```javascript
// public/js/errorHandler.js

class GlobalErrorHandler {
    constructor() {
        this.connectionManager = new ConnectionManager({ baseURL: '/api' });
        this.setupListeners();
    }

    setupListeners() {
        // Ошибки сети
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Необработанные ошибки
        window.addEventListener('error', (event) => this.handleError(event));
        window.addEventListener('unhandledrejection', (event) => 
            this.handlePromiseError(event)
        );
    }

    handleOnline() {
        console.log('Соединение восстановлено');
        this.showNotification('Соединение восстановлено', 'success');
        // Попытаться синхронизировать данные
        if (window.authManager?.getAuthState() === 'authenticated') {
            window.hashStorage?.sync();
        }
    }

    handleOffline() {
        console.log('Нет соединения с интернетом');
        this.showNotification('Нет соединения. Работа в офлайн-режиме', 'warning');
    }

    handleError(event) {
        if (event.error instanceof ConnectionError) {
            event.preventDefault();
            this.handleConnectionError(event.error);
        }
    }

    handleConnectionError(error) {
        const state = error.type;
        
        switch (state) {
            case 'MAX_RETRIES_EXCEEDED':
                this.showNotification('Сервер недоступен. Повторите позже.', 'error');
                break;
            case 'NETWORK_OFFLINE':
                this.showNotification('Нет соединения с интернетом', 'warning');
                break;
            default:
                this.showNotification(error.message, 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Показать уведомление пользователю
        if (window.toastManager) {
            window.toastManager.show(message, type);
        } else {
            console[type](message);
        }
    }
}
```

---

## Offline Mode с последующей синхронизацией

```javascript
// public/js/offlineManager.js

class OfflineManager {
    constructor() {
        this.pendingOperations = [];
        this.isOnline = navigator.onLine;
        
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    handleOnline() {
        this.isOnline = true;
        this.syncPendingOperations();
    }

    handleOffline() {
        this.isOnline = false;
    }

    async queueOperation(operation) {
        // Сохранить операцию в localStorage
        const id = this.generateId();
        const op = {
            id,
            ...operation,
            timestamp: Date.now()
        };
        
        this.pendingOperations.push(op);
        this.saveToStorage();
        
        return id;
    }

    async syncPendingOperations() {
        if (!this.isOnline || this.pendingOperations.length === 0) {
            return;
        }

        const operations = [...this.pendingOperations];
        this.pendingOperations = [];
        
        for (const op of operations) {
            try {
                await this.executeOperation(op);
                this.removeFromStorage(op.id);
            } catch (error) {
                // Вернуть в очередь при ошибке
                this.pendingOperations.push(op);
                this.saveToStorage();
                throw error;
            }
        }
    }

    async executeOperation(op) {
        switch (op.type) {
            case 'create':
                return window.connectionManager.post(op.url, op.data);
            case 'update':
                return window.connectionManager.put(`${op.url}/${op.id}`, op.data);
            case 'delete':
                return window.connectionManager.delete(`${op.url}/${op.id}`);
        }
    }
}
```

---

## Тестирование

### Мок-сервер для тестирования

```javascript
// public/js/managers/tests/mockServer.js

class MockServer {
    constructor() {
        this.handlers = new Map();
        this.latency = 0;
    }

    handle(method, url, handler) {
        this.handlers.set(`${method}:${url}`, handler);
    }

    async request(options) {
        await this.delay(this.latency);
        
        const key = `${options.method}:${options.url}`;
        const handler = this.handlers.get(key);
        
        if (!handler) {
            throw new Error(`No handler for ${key}`);
        }
        
        return handler(options);
    }

    setLatency(ms) {
        this.latency = ms;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Пример использования
const mockServer = new MockServer();

mockServer.handle('POST', '/api/login', async (options) => {
    const { email, password } = JSON.parse(options.body);
    
    if (email === 'fail@test.com') {
        throw new ConnectionError('ERR_CONNECTION_REFUSED');
    }
    
    if (email === 'rate@test.com') {
        throw new Error('Too Many Requests', 429);
    }
    
    return {
        success: true,
        token: 'mock-jwt-token',
        user: { id: 1, email }
    };
});

// Перехват fetch
const originalFetch = window.fetch;
window.fetch = async (url, options) => {
    return mockServer.request({ url, ...options });
};
```

---

## Чек-лист внедрения

- [ ] Скопировать файлы менеджеров в проект
- [ ] Подключить файлы в `app.js` в порядке:
  1. `RetryManager.js`
  2. `SafeInitializer.js`
  3. `ConnectionManager.js`
  4. `AuthManager.js`
  5. `WebSocketManager.js`
- [ ] Обновить инициализацию HashStorage с SafeInitializer
- [ ] Заменить прямые вызовы fetch на ConnectionManager
- [ ] Интегрировать AuthManager в компоненты авторизации
- [ ] Настроить WebSocketManager для переподключения
- [ ] Добавить глобальный обработчик ошибок
- [ ] Протестировать все сценарии ошибок
- [ ] Проверить совместимость с существующим кодом

---

## Совместимость

| Компонент | Версия | Примечания |
|-----------|--------|------------|
| HashStorage | v3.1 | Полная совместимость |
| Browser | ES6+ | Используются async/await |
| Node.js | 12+ | Для серверной части |

---

## Лицензия

MIT License
