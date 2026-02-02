# Инструкция по внедрению исправлений

## Файлы для изменения

### 1. Обновление HTML файлов

Добавьте загрузку менеджеров в `index.html`, `auth.html`, `dashboard.html` и другие страницы:

```html
<!-- Перед закрытием </body> -->
<script src="js/managers/RetryManager.js"></script>
<script src="js/managers/SafeInitializer.js"></script>
<script src="js/managers/ConnectionManager.js"></script>
<script src="js/managers/WebSocketManager.js"></script>
<script src="js/managers/AuthManager.js"></script>
<script src="js/managers/GlobalErrorHandler.js"></script>
```

### 2. Обновление server.js (src/server/index.js)

Убедитесь, что WebSocket настроен правильно:

```javascript
// src/server/index.js
const { setupWebSocket } = require('./ws');
const http = require('http');
const app = require('./app');

const server = http.createServer(app);

// WebSocket должен быть настроен ПОСЛЕ создания сервера
setupWebSocket(server);

server.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен на порту ${process.env.PORT || 3000}`);
});
```

### 3. Обновление CORS для WebSocket

Убедитесь, что в `src/server/app.js` есть правильные настройки CORS:

```javascript
// CORS для WebSocket
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://your-domain.com'])
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
```

## Порядок загрузки скриптов

Важен правильный порядок загрузки:

```
1. js/managers/RetryManager.js       (базовые утилиты)
2. js/managers/SafeInitializer.js    (управление инициализацией)
3. js/managers/ConnectionManager.js  (обработка ошибок сети)
4. js/managers/WebSocketManager.js   (управление WebSocket)
5. js/managers/AuthManager.js        (авторизация)
6. js/managers/GlobalErrorHandler.js (глобальные ошибки)
7. js/hashStorage.js                 (использует менеджеры)
8. js/app.js                         (использует HashStorage)
9. js/auth.js                        (использует HashStorage)
```

## Быстрое внедрение (одна строка)

Для быстрого внедрения добавьте в `index.html`:

```html
<script src="js/managers/index.js"></script>
```

Файл `js/managers/index.js` автоматически загружает все менеджеры в правильном порядке.

## Проверка после внедрения

### 1. Проверьте консоль на наличие ошибок

Должны появиться сообщения:
```
📦 Managers Bundle загружен
📡 ConnectionManager v1.0 загружен
🔄 RetryManager v1.0 загружен
🛡️ SafeInitializer v1.0 загружен
🔐 AuthManager v1.0 загружен
🔌 WebSocketManager v1.0 загружен
🛡️ GlobalErrorHandler v1.0 загружен
🌐 HashStorage v3.1 (Server Edition) доступен глобально
```

### 2. Проверьте работу в offline-режиме

1. Остановите сервер
2. Обновите страницу
3. Проверьте, что приложение не уходит в бесконечный релоад

### 3. Проверьте блокировку входа

1. 5 раз введите неверный пароль
2. Убедитесь, что появилось сообщение о блокировке

## Откат изменений

Если что-то пошло не так:

1. Удалите загрузку менеджеров из HTML
2. Восстановите `hashStorage.js` и `app.js` из резервной копии
3. Очистите кеш браузера

## Совместимость

- **HashStorage v3.1**: Полная совместимость, все методы сохранены
- **LoaderComponent v2.0**: Совместим
- **Существующий API**: Изменения обратно совместимы
- **Browser history**: Работает корректно
- **Memory leaks**: Предотвращены через cleanup в GlobalErrorHandler
