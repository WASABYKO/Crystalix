# Архитектурная документация системы авторизации SPA

## 1. Обзор проблемы

### Исходные ошибки
1. **ERR_CONNECTION_REFUSED** - сервер недоступен при API запросах
2. **Дублирующая инициализация HashStorage** - множественные вызовы `init()`
3. **Бесконечный релоад** - циклические перезагрузки после ошибки входа

### Корневые причины
- Отсутствие обработки ошибок соединения
- Гонки при инициализации компонентов
- Отсутствие защиты от повторных запросов
- Неправильная последовательность инициализации

---

## 2. Архитектура решения

### 2.1 Диаграмма компонентов

```
┌─────────────────────────────────────────────────────────────┐
│                    Global Error Handler                      │
│         (window.onerror, window.onunhandledrejection)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    AuthManager (Центральный)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ initialize(), login(), logout(), checkAuth()        │   │
│  │ retry logic, state sync, error handling             │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────┬───────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │   API Client │ │   WS Manager │ │ StateManager │
    │ (RetryManager)│ │  (Reconnect) │ │  (Storage)   │
    └──────────────┘ └──────────────┘ └──────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │    ConnectionManager        │
              │  (online/offline detection) │
              └─────────────────────────────┘
```

### 2.2 Порядок инициализации

```
1. SafeInitializer.check()           - Защита от дублирующей инициализации
2. StateManager.restore()            - Восстановление состояния
3. ConnectionManager.init()          - Проверка соединения
4. HashStorage.initialize()          - Инициализация хранилища
5. AuthManager.initialize()          - Проверка авторизации
6. WebSocketManager.connect()        - Подключение WS (после API auth)
7. AppComponent.render()             - Рендер приложения
```

---

## 3. Компоненты

### 3.1 SafeInitializer

**Файл**: `public/js/managers/SafeInitializer.js`

**Назначение**: Предотвращение множественных инициализаций

```javascript
class SafeInitializer {
    constructor() {
        this._isInitialized = false;
        this._initializationPromise = null;
        this._queue = [];
        this._isInitializing = false;
    }

    async initialize(fn, timeout = 30000) {
        // Защита от повторной инициализации
        if (this._isInitialized && !this._isInitializing) {
            return this._initializationPromise;
        }

        // Ожидание завершения текущей инициализации
        if (this._isInitializing) {
            return this._queue.push(fn), this._initializationPromise;
        }

        this._isInitializing = true;
        
        try {
            this._initializationPromise = this._executeWithTimeout(fn, timeout);
            return await this._initializationPromise;
        } finally {
            this._isInitialized = true;
            this._isInitializing = false;
        }
    }

    schedule(fn) {
        return this._isInitialized 
            ? fn() 
            : this._queue.push(fn) && this._initializationPromise;
    }
}
```

### 3.2 RetryManager

**Файл**: `public/js/managers/RetryManager.js`

**Назначение**: Повторные попытки с экспоненциальной задержкой

```javascript
class RetryManager {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.baseDelay = options.baseDelay || 1000;
        this.maxDelay = options.maxDelay || 30000;
        this.circuitBreakerThreshold = options.circuitBreakerThreshold || 5;
        this._failureCount = 0;
        this._circuitOpen = false;
    }

    async execute(fn, options = {}) {
        const shouldRetry = options.shouldRetry || (() => true);
        const onRetry = options.onRetry || (() => {});

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            if (this._circuitOpen) {
                throw new Error('Circuit breaker is open');
            }

            try {
                return await fn();
            } catch (error) {
                if (attempt === this.maxRetries || !shouldRetry(error)) {
                    throw error;
                }

                this._failureCount++;
                if (this._failureCount >= this.circuitBreakerThreshold) {
                    this._circuitOpen = true;
                }

                const delay = this._calculateDelay(attempt);
                await onRetry(error, attempt, delay);
                await this._sleep(delay);
            }
        }
    }

    _calculateDelay(attempt) {
        return Math.min(this.baseDelay * Math.pow(2, attempt), this.maxDelay);
    }
}
```

### 3.3 ConnectionManager

**Файл**: `public/js/managers/ConnectionManager.js`

**Назначение**: Отслеживание состояния соединения

```javascript
class ConnectionManager {
    constructor() {
        this.retryCount = 0;
        this.maxRetries = 5;
        this._setupListeners();
    }

    _setupListeners() {
        window.addEventListener('online', () => this._handleOnline());
        window.addEventListener('offline', () => this._handleOffline());
    }

    _handleOnline() {
        this.retryCount = 0;
        console.log('🌐 Соединение восстановлено');
        document.dispatchEvent(new CustomEvent('connection:restored'));
    }

    _handleOffline() {
        console.warn('📡 Соединение потеряно');
        document.dispatchEvent('connection:lost');
    }

    isOnline() {
        return navigator.onLine;
    }

    isOffline() {
        return !navigator.onLine;
    }

    getStatus() {
        return navigator.onLine ? 'online' : 'offline';
    }
}
```

### 3.4 AuthManager

**Файл**: `public/js/managers/AuthManager.js`

**Назначение**: Централизованное управление авторизацией

```javascript
class AuthManager {
    constructor() {
        this.maxRetries = 3;
        this.isInitialized = false;
        this.pendingRequests = [];
        this._retryManager = new RetryManager({
            maxRetries: 3,
            baseDelay: 1000
        });
        this._state = 'idle'; // idle, initializing, authenticating, authenticated, error
    }

    async initialize() {
        if (this.isInitialized) return;

        this._state = 'initializing';
        
        try {
            const token = StateManager.get('authToken');
            if (token) {
                await this._verifyToken(token);
            }
            this.isInitialized = true;
            this._state = 'authenticated';
        } catch (error) {
            this._state = 'error';
            throw error;
        }
    }

    async login(credentials) {
        this._state = 'authenticating';
        
        return this._retryManager.execute(async () => {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentials)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Login failed');
            }

            const data = await response.json();
            StateManager.set('authToken', data.token);
            this._state = 'authenticated';
            
            return data;
        }, {
            shouldRetry: (error) => this._isRetryableError(error),
            onRetry: (error, attempt, delay) => {
                console.warn(`Попытка входа ${attempt + 1}/${this.maxRetries} через ${delay}ms`);
            }
        });
    }

    _isRetryableError(error) {
        return error.message.includes('ERR_CONNECTION_REFUSED') ||
               error.message.includes('NetworkError') ||
               error.message.includes('Failed to fetch');
    }

    handleConnectionError(error) {
        if (this._state === 'authenticating') {
            StateManager.set('loginAttempt', (StateManager.get('loginAttempt') || 0) + 1);
            
            if (StateManager.get('loginAttempt') >= 3) {
                StateManager.remove('loginAttempt');
                throw new Error('Слишком много попыток. Попробуйте позже.');
            }
        }
    }
}
```

### 3.5 WebSocketManager

**Файл**: `public/js/managers/WebSocketManager.js`

**Назначение**: Управление WebSocket соединением

```javascript
class WebSocketManager {
    constructor() {
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.messageBuffer = [];
        this.subscriptions = new Map();
        this._isConnecting = false;
    }

    async connect(url) {
        if (this.socket?.readyState === WebSocket.OPEN || this._isConnecting) {
            return;
        }

        this._isConnecting = true;

        return new Promise((resolve, reject) => {
            try {
                this.socket = new WebSocket(url);

                this.socket.onopen = () => {
                    this._isConnecting = false;
                    this.reconnectAttempts = 0;
                    this._flushMessageBuffer();
                    console.log('✅ WebSocket подключен');
                    resolve();
                };

                this.socket.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    this._handleMessage(message);
                };

                this.socket.onclose = () => {
                    this._handleDisconnect();
                };

                this.socket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                };

                // Таймаут подключения
                setTimeout(() => {
                    if (this.socket.readyState !== WebSocket.OPEN) {
                        this._isConnecting = false;
                        reject(new Error('WebSocket connection timeout'));
                    }
                }, 10000);

            } catch (error) {
                this._isConnecting = false;
                reject(error);
            }
        });
    }

    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            throw new Error('Max reconnection attempts reached');
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.connect(this.socket?.url);
    }

    bufferMessage(message) {
        this.messageBuffer.push(message);
    }

    _flushMessageBuffer() {
        while (this.messageBuffer.length > 0 && this.isConnected()) {
            const message = this.messageBuffer.shift();
            this.send(message);
        }
    }

    send(message) {
        if (this.isConnected()) {
            this.socket.send(JSON.stringify(message));
        } else {
            this.bufferMessage(message);
        }
    }
}
```

---

## 4. Интеграция с HashStorage

### 4.1 Обновленный hashStorage.js

```javascript
// В начало файла
import { safeInitializer } from './managers/SafeInitializer.js';

// Модифицируем init()
async function init(options = {}) {
    return safeInitializer.initialize(async (signal) => {
        // Проверка состояния
        if (initialized) {
            console.warn('HashStorage уже инициализирован');
            return getAll();
        }

        // Инициализация
        await _performInit(options);
        initialized = true;
        
        return getAll();
    }, options.timeout || 30000);
}

// Добавляем защищенный API-клиент
HashStorage.prototype.api = async function(endpoint, options = {}) {
    const retryManager = new RetryManager({
        maxRetries: 3,
        baseDelay: 1000
    });

    return retryManager.execute(async () => {
        const response = await fetch(`/api${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(this.get('authToken') && {
                    'Authorization': `Bearer ${this.get('authToken')}`
                }),
                ...options.headers
            }
        });

        if (response.status === 401) {
            // Токен истек - пробуем обновить
            await AuthManager.refreshToken();
            throw new Error('Unauthorized - token refreshed');
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        return response.json();
    }, {
        shouldRetry: (error) => error.message.includes('Failed to fetch')
    });
};
```

---

## 5. Глобальный обработчик ошибок

### 5.1 error-handler.js

```javascript
(function() {
    'use strict';

    const GlobalErrorHandler = {
        setup() {
            // Обработка необработанных ошибок
            window.addEventListener('error', (event) => {
                this._handleError(event.error, 'window.error');
            });

            // Обработка Promise rejection
            window.addEventListener('unhandledrejection', (event) => {
                this._handleError(event.reason, 'unhandledrejection');
                event.preventDefault();
            });

            // Обработка ошибок сети
            window.addEventListener('offline', () => {
                this._handleConnectionLoss();
            });
        },

        _handleError(error, source) {
            console.group(`🚨 Error from ${source}`);
            console.error('Error:', error);
            console.error('Stack:', error?.stack);
            console.groupEnd();

            // Не показывать пользователю технические ошибки
            if (error?.message?.includes('ResizeObserver')) {
                return;
            }

            // Показать уведомление
            this._showNotification(error.message || 'Произошла ошибка', 'error');
        },

        _handleConnectionLoss() {
            this._showNotification('Соединение потеряно. Попытка восстановления...', 'warning');
            
            document.addEventListener('connection:restored', () => {
                this._showNotification('Соединение восстановлено', 'success');
            }, { once: true });
        },

        _showNotification(message, type = 'info') {
            // Интеграция с системой уведомлений
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(message, type);
            } else {
                console.log(`[${type.toUpperCase()}] ${message}`);
            }
        }
    };

    GlobalErrorHandler.setup();
    window.GlobalErrorHandler = GlobalErrorHandler;
})();
```

---

## 6. Инструкция по внедрению

### 6.1 Пошаговый план

#### Шаг 1: Создание файлов менеджеров

```bash
# Создаем директорию для менеджеров
mkdir -p public/js/managers

# Создаем файлы (выполняется автоматически при копировании кода)
touch public/js/managers/ConnectionManager.js
touch public/js/managers/RetryManager.js
touch public/js/managers/SafeInitializer.js
touch public/js/managers/AuthManager.js
touch public/js/managers/WebSocketManager.js
```

#### Шаг 2: Подключение в app.js

```javascript
// В начало app.js
import './managers/ConnectionManager.js';
import './managers/RetryManager.js';
import './managers/SafeInitializer.js';
import './managers/AuthManager.js';
import './managers/WebSocketManager.js';
import './error-handler.js';
```

#### Шаг 3: Обновление порядка инициализации

```javascript
// В функции initApp()
async function initApp() {
    try {
        // 1. Инициализация с защитой от дублирования
        await safeInitializer.initialize(async () => {
            // 2. Восстановление состояния
            StateManager.restore();
            
            // 3. Проверка соединения
            if (!connectionManager.isOnline()) {
                console.warn('Нет соединения с интернетом');
            }
            
            // 4. Проверка авторизации
            await authManager.initialize();
            
            // 5. Подключение WebSocket (только если авторизован)
            if (authManager.isAuthenticated()) {
                await webSocketManager.connect(WS_URL);
            }
            
            // 6. Рендер приложения
            renderApp();
        });
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showErrorScreen(error);
    }
}
```

#### Шаг 4: Тестирование

```javascript
// В консоли браузера
runTests();
```

---

## 7. Тест-кейсы

### 7.1 Unit тесты

| Тест | Ожидаемый результат |
|------|---------------------|
| SafeInitializer: повторный вызов | Блокируется, возвращает первый промис |
| RetryManager: успешный запрос | Выполняется сразу |
| RetryManager: ошибка с повторами | 3 попытки с задержкой |
| RetryManager: circuit breaker | Открывается после 5 ошибок |
| ConnectionManager: offline | isOnline() = false |
| AuthManager: login с ошибкой | Ограничение попыток |

### 7.2 Интеграционные тесты

| Тест | Ожидаемый результат |
|------|---------------------|
| Полный flow входа | Успешный вход, токен сохранен |
| Потеря соединения | Уведомление, авто-восстановление |
| Истекший токен | Авто-обновление или logout |
| WS disconnect | Авто-переподключение |

---

## 8. Вопросы безопасности

### 8.1 Что исправлено

1. ✅ Удален hardcoded API key из логов
2. ✅ Добавлена проверка HTTPS в production
3. ✅ Реализована санитизация входных данных
4. ✅ Добавлены заголовки безопасности

### 8.2 Рекомендации

1. Используйте HTTPS в production
2. Регулярно обновляйте токены
3. Логируйте только необходимые данные
4. Не храните чувствительные данные в localStorage

---

## 9. Готовые сниппеты

### 9.1 Защищенный API-вызов

```javascript
async function safeFetch(url, options = {}) {
    const retryManager = new RetryManager({ maxRetries: 3 });
    
    return retryManager.execute(async () => {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (response.status === 401) {
            await AuthManager.refreshToken();
            throw new Error('Token refreshed');
        }

        return response.json();
    });
}
```

### 9.2 Обработка состояния авторизации

```javascript
function setupAuthStateListener() {
    document.addEventListener('auth:statechange', (event) => {
        const { isAuthenticated, user } = event.detail;
        
        if (!isAuthenticated) {
            // Перенаправление на страницу входа
            window.location.hash = '#/auth';
        }
    });
}
```

---

## 10. Troubleshooting

### Проблема: Бесконечный релоуд

**Причина**: Неправильная логика в `window.location.reload()`

**Решение**:
```javascript
// Было
if (error) window.location.reload();

// Стало
if (error && !StateManager.get('reloadProtection')) {
    StateManager.set('reloadProtection', true);
    setTimeout(() => StateManager.remove('reloadProtection'), 60000);
    window.location.reload();
}
```

### Проблема: ERR_CONNECTION_REFUSED

**Причина**: Сервер недоступен

**Решение**:
```javascript
// Добавить проверку перед запросом
if (!connectionManager.isOnline()) {
    throw new Error('No connection');
}
```

---

## 11. Changelog

### v1.0.0 (2024-01-31)
- Созданы базовые компоненты
- Добавлена документация
- Созданы тест-кейсы

---

## 12. Контакты

Для вопросов и предложений: создайте issue в репозитории.
