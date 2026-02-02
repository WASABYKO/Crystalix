# Документация по интеграции системы авторизации

## Обзор архитектуры

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend Application                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  AuthManager│  │ WSManager   │  │ConnectionMgr│             │
│  │  (Центральн.│  │ (WebSocket) │  │ (Ошибки)    │             │
│  │   управление)│  │             │  │             │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                    │
│         └────────────────┼────────────────┘                    │
│                          │                                     │
│                   ┌──────▼──────┐                              │
│                   │ HashStorage │                              │
│                   │   v3.1      │                              │
│                   │ (Глобальный)│                              │
│                   └──────┬──────┘                              │
└──────────────────────────┼─────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Backend API                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Auth Routes │  │ WebSocket   │  │ Database    │             │
│  │ /api/login  │  │ Server      │  │ (Users)     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## Порядок инициализации

### 1. Загрузка скриптов (в index.html)

```html
<!-- 1. Зависимости -->
<script src="js/hashStorage.js"></script>

<!-- 2. Менеджеры (в алфавитном порядке) -->
<script src="js/managers/SafeInitializer.js"></script>
<script src="js/managers/RetryManager.js"></script>
<script src="js/managers/ConnectionManager.js"></script>
<script src="js/managers/WebSocketManager.js"></script>
<script src="js/managers/AuthManager.js"></script>

<!-- 3. Глобальные обработчики -->
<script src="js/managers/errorHandler.js"></script>

<!-- 4. Основное приложение -->
<script src="js/app.js"></script>
```

### 2. Инициализация в app.js

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Инициализируем HashStorage
        await HashStorage.initialize();
        
        // 2. Инициализируем менеджеры
        await AuthManager.initialize();
        await WebSocketManager.initialize();
        
        // 3. Проверяем состояние авторизации
        if (AuthManager.isAuthenticated()) {
            AppRouter.navigate('dashboard');
        } else {
            AppRouter.navigate('auth');
        }
    } catch (error) {
        ErrorHandler.handle(error, 'INIT');
    }
});
```

## API Reference

### AuthManager

#### Методы

| Метод | Параметры | Возвращает | Описание |
|-------|-----------|------------|----------|
| `login(credentials)` | `{email, password}` | `Promise<User>` | Авторизация с повторными попытками |
| `logout()` | - | `Promise<void>` | Выход из системы |
| `register(data)` | `{email, password, name}` | `Promise<User>` | Регистрация |
| `refreshToken()` | - | `Promise<string>` | Обновление токена |
| `isAuthenticated()` | - | `boolean` | Проверка авторизации |
| `handleConnectionError(error)` | `Error` | `void` | Обработка ошибки соединения |

#### События

```javascript
AuthManager.on('login:success', (user) => {
    console.log('Пользователь вошел:', user.email);
});

AuthManager.on('login:error', (error) => {
    console.error('Ошибка входа:', error.message);
});

AuthManager.on('session:expired', () => {
    console.log('Сессия истекла, требуется повторный вход');
});
```

### WebSocketManager

#### Методы

| Метод | Параметры | Возвращает | Описание |
|-------|-----------|------------|----------|
| `connect()` | - | `Promise<void>` | Подключение к WebSocket |
| `disconnect()` | - | `void` | Отключение |
| `send(message)` | `Object` | `void` | Отправка сообщения |
| `subscribe(channel)` | `string` | `Promise<void>` | Подписка на канал |
| `unsubscribe(channel)` | `string` | `Promise<void>` | Отписка от канала |

#### События

```javascript
WebSocketManager.on('connected', () => {
    console.log('WebSocket подключен');
});

WebSocketManager.on('disconnected', (reason) => {
    console.log('WebSocket отключен:', reason);
});

WebSocketManager.on('message', (data) => {
    console.log('Получено сообщение:', data);
});
```

### ConnectionManager

#### Методы

| Метод | Параметры | Возвращает | Описание |
|-------|-----------|------------|----------|
| `getErrorType(error)` | `Error` | `string` | Определение типа ошибки |
| `shouldRetry(error)` | `Error` | `boolean` | Нужна ли повторная попытка |
| `getRetryDelay(error, attempt)` | `Error, number` | `number` | Задержка для повтора |
| `handleOffline()` | - | `void` | Обработка перехода в офлайн |
| `handleOnline()` | - | `void` | Обработка перехода в онлайн |

## Конфигурация

### Глобальные настройки (app.js)

```javascript
const AppConfig = {
    // API
    apiBaseUrl: '/api',
    apiTimeout: 30000,
    
    // Retry
    maxRetries: 3,
    baseRetryDelay: 1000,
    maxRetryDelay: 10000,
    retryFactor: 2,
    
    // WebSocket
    wsUrl: `ws://${window.location.host}/ws`,
    wsReconnectInterval: 5000,
    wsMaxReconnectAttempts: 10,
    
    // Auth
    tokenRefreshInterval: 300000, // 5 минут
    sessionTimeout: 3600000, // 1 час
    
    // UI
    showErrorToast: true,
    blockUIOnError: true
};
```

## Обработка ошибок

### Типы ошибок

```javascript
const ErrorTypes = {
    CONNECTION_REFUSED: {
        retryable: true,
        message: 'Сервер недоступен. Попытка повторного подключения...',
        severity: 'warning'
    },
    CONNECTION_RESET: {
        retryable: true,
        message: 'Соединение прервано. Восстановление...',
        severity: 'warning'
    },
    TIMEOUT: {
        retryable: true,
        message: 'Превышено время ожидания. Повторная попытка...',
        severity: 'info'
    },
    AUTH_ERROR: {
        retryable: false,
        message: 'Ошибка авторизации. Пожалуйста, войдите снова.',
        severity: 'error'
    },
    SERVER_ERROR: {
        retryable: true,
        message: 'Ошибка сервера. Повторная попытка...',
        severity: 'error'
    },
    NETWORK_OFFLINE: {
        retryable: true,
        message: 'Нет подключения к интернету. Ожидание соединения...',
        severity: 'warning'
    }
};
```

## Интеграция с HashStorage v3.1

### Сохранение состояния

```javascript
// При успешной авторизации
HashStorage.setItem('auth', {
    token: authResult.token,
    userId: authResult.user.id,
    expiresAt: authResult.expiresAt,
    refreshToken: authResult.refreshToken
});

// При выходе
HashStorage.removeItem('auth');
HashStorage.removeItem('user');

// Проверка при загрузке
const authData = HashStorage.getItem('auth');
if (authData && authData.expiresAt > Date.now()) {
    // Токен валиден
    AuthManager.setToken(authData.token);
} else {
    // Токен истек
    HashStorage.removeItem('auth');
}
```

## Offline Mode

### Активация

```javascript
// При потере соединения
ConnectionManager.on('offline', () => {
    AppState.setOfflineMode(true);
    UI.showNotification('Вы работаете в офлайн-режиме', 'warning');
});

// При восстановлении соединения
ConnectionManager.on('online', () => {
    AppState.setOfflineMode(false);
    SyncManager.syncPendingChanges();
    UI.showNotification('Соединение восстановлено', 'success');
});
```

### Синхронизация после офлайна

```javascript
class SyncManager {
    async syncPendingChanges() {
        const pending = HashStorage.getItem('pendingChanges') || [];
        
        for (const change of pending) {
            try {
                await this.syncChange(change);
                this.removeFromPending(change.id);
            } catch (error) {
                console.error('Ошибка синхронизации:', error);
            }
        }
    }
    
    async syncChange(change) {
        const response = await fetch(change.url, {
            method: change.method,
            body: JSON.stringify(change.data)
        });
        
        if (!response.ok) {
            throw new Error('Sync failed');
        }
    }
}
```

## Миграция с текущей версии

### Шаг 1: Добавьте новые файлы

Скопируйте папку `js/managers/` в ваш проект.

### Шаг 2: Обновите index.html

Добавьте новые скрипты перед `app.js`.

### Шаг 3: Обновите app.js

Замените старую логику инициализации на новую.

### Шаг 4: Обновите auth.js

Используйте `AuthManager` вместо прямых вызовов API.

### Шаг 5: Обновите hashStorage.js

Добавьте защиту от дублирующей инициализации.

## Troubleshooting

### Проблема: "HashStorage уже инициализирован"

**Причина**: Множественные вызовы `initialize()`.

**Решение**: Используйте `SafeInitializer`:

```javascript
const storageInitializer = new SafeInitializer();
await storageInitializer.safeInitialize(() => HashStorage.initialize());
```

### Проблема: Бесконечный релоад

**Причина**: Ошибка в обработчике `onerror` или `onunhandledrejection`.

**Решение**: Проверьте `errorHandler.js` и убедитесь, что:

1. Все ошибки логируются, но не вызывают рекурсивный релоад.
2. Есть защита от множественных вызовов `location.reload()`.
3. Используется `ErrorBoundary` для перехвата React/JS ошибок.

### Проблема: WebSocket не переподключается

**Причина**: Неправильная обработка события `close`.

**Решение**:

```javascript
ws.onclose = (event) => {
    if (!event.wasClean) {
        WebSocketManager.scheduleReconnect();
    }
};
```

### Проблема: Утечки памяти

**Причина**: Не очищаются обработчики событий и таймеры.

**Решение**: Всегда вызывайте `dispose()` при уничтожении компонентов:

```javascript
componentWillUnmount() {
    AuthManager.dispose();
    WebSocketManager.dispose();
    ConnectionManager.dispose();
}
```

## Тестирование

### Запуск unit-тестов

```bash
# В браузере
open public/js/managers/tests/test.html

# В Node.js (требуется Jest)
npm test
```

### Тестовые сценарии

1. **Успешная авторизация**: `login:success`
2. **Ошибка соединения**: `login:error` → `retry` → `login:success`
3. **Истечение сессии**: `session:expired` → `refreshToken`
4. **Разрыв WebSocket**: `disconnected` → `reconnect` → `connected`
5. **Переход в офлайн**: `offline` → `online` → `sync`

## Производительность

### Рекомендации

1. **Ленивая загрузка**: Загружайте менеджеры только когда нужно

```javascript
// Вместо
import { AuthManager } from './managers';

// Используйте
const loadAuthManager = async () => {
    const module = await import('./managers/AuthManager.js');
    return module.AuthManager;
};
```

2. **Мемоизация**: Кэшируйте результаты проверок

```javascript
AuthManager.isAuthenticated = _.memoize(AuthManager.isAuthenticated);
```

3. **Debounce**: Для частых обновлений состояния

```javascript
HashStorage.setItem = _.debounce(HashStorage.setItem, 100);
```

## Совместимость

| Компонент | Минимальная версия |
|-----------|-------------------|
| Browser | Chrome 60+, Firefox 55+, Safari 11+ |
| HashStorage | v3.1 |
| Node.js (сервер) | v14+ |
| WebSocket API | RFC 6455 |

## Лицензия

MIT License - см. файл LICENSE
