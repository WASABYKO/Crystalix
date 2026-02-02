/**
 * ТЕСТ-КЕЙСЫ И ДОКУМЕНТАЦИЯ
 * Для проверки исправления проблем с авторизацией и WebSocket
 * 
 * Run: node test-runner.js или直接在浏览器中打开test.html
 */

// ============================================================================
// ТЕСТ 1: ConnectionManager - Проверка определения типа ошибки
// ============================================================================

test('ConnectionManager должен корректно определять тип ошибки', async () => {
    const manager = new ConnectionManager();
    
    // Тест ERR_CONNECTION_REFUSED
    const refusedError = { code: 'ERR_CONNECTION_REFUSED', message: 'Connection refused' };
    const refusedType = manager.getErrorType(refusedError);
    expect(refusedType).toBe('CONNECTION_REFUSED');
    
    // Тест ERR_CONNECTION_RESET
    const resetError = { code: 'ERR_CONNECTION_RESET', message: 'Connection reset' };
    const resetType = manager.getErrorType(resetError);
    expect(resetType).toBe('CONNECTION_RESET');
    
    // Тест таймаута
    const timeoutError = { code: 'ECONNABORTED', message: 'Connection timed out' };
    const timeoutType = manager.getErrorType(timeoutError);
    expect(timeoutType).toBe('TIMEOUT');
    
    // Тест ошибки сервера
    const serverError = { status: 500, message: 'Internal Server Error' };
    const serverType = manager.getErrorType(serverError);
    expect(serverType).toBe('SERVER_ERROR');
});

// ============================================================================
// ТЕСТ 2: RetryManager - Проверка экспоненциальной задержки
// ============================================================================

test('RetryManager должен использовать экспоненциальную задержку', async () => {
    const retryManager = new RetryManager({
        maxRetries: 3,
        baseDelay: 100, // 100ms
        maxDelay: 1000, // 1s
        factor: 2
    });
    
    const delays = [];
    const startTime = Date.now();
    
    // Мокаем неудачную операцию
    let attemptCount = 0;
    const mockOperation = async () => {
        attemptCount++;
        if (attemptCount < 3) {
            throw new Error('Connection failed');
        }
        return 'success';
    };
    
    const result = await retryManager.execute(mockOperation);
    
    expect(result).toBe('success');
    expect(attemptCount).toBe(3);
    
    // Проверяем, что задержки растут экспоненциально
    const totalTime = Date.now() - startTime;
    expect(totalTime).toBeGreaterThanOrEqual(100 + 200); // Минимум 2 попытки
});

// ============================================================================
// ТЕСТ 3: SafeInitializer - Проверка защиты от дублирующей инициализации
// ============================================================================

test('SafeInitializer должен предотвращать дублирующую инициализацию', async () => {
    const initializer = new SafeInitializer();
    let initCount = 0;
    
    const initFunction = async () => {
        initCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'initialized';
    };
    
    // Запускаем несколько инициализаций параллельно
    const promises = [
        initializer.safeInitialize(initFunction),
        initializer.safeInitialize(initFunction),
        initializer.safeInitialize(initFunction)
    ];
    
    const results = await Promise.all(promises);
    
    // Все результаты должны быть успешными
    expect(results.every(r => r === 'initialized')).toBe(true);
    // Но initFunction должен быть вызван только один раз
    expect(initCount).toBe(1);
});

// ============================================================================
// ТЕСТ 4: AuthManager - Проверка потока авторизации с повторными попытками
// ============================================================================

test('AuthManager должен корректно обрабатывать ошибки авторизации', async () => {
    const authManager = new AuthManager();
    let loginAttempts = 0;
    
    // Мокаем API login
    global.fetch = jest.fn().mockImplementation((url, options) => {
        if (url.includes('/api/login')) {
            loginAttempts++;
            if (loginAttempts < 2) {
                return Promise.reject(new Error('Connection refused'));
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: 'test-token' }) });
        }
        return Promise.reject(new Error('Not found'));
    });
    
    const result = await authManager.login({ email: 'test@test.com', password: 'password' });
    
    expect(result.token).toBe('test-token');
    expect(loginAttempts).toBe(2);
});

// ============================================================================
// ТЕСТ 5: WebSocketManager - Проверка переподключения
// ============================================================================

test('WebSocketManager должен корректно обрабатывать разрыв соединения', async () => {
    const wsManager = new WebSocketManager({
        url: 'ws://localhost:8080',
        reconnectInterval: 100,
        maxReconnectAttempts: 3
    });
    
    // Мокаем WebSocket
    const mockWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn()
    };
    
    global.WebSocket = jest.fn().mockImplementation(() => mockWs);
    
    await wsManager.connect();
    
    // Симулируем разрыв соединения
    wsManager.handleClose({ code: 1006 });
    
    // Проверяем, что началось переподключение
    expect(wsManager.reconnectAttempts).toBe(1);
});

// ============================================================================
// ТЕСТ 6: Интеграция с HashStorage
// ============================================================================

test('HashStorage должен корректно интегрироваться с AuthManager', async () => {
    const hashStorage = new HashStorage();
    const authManager = new AuthManager();
    
    await hashStorage.initialize();
    await authManager.initialize();
    
    // Проверяем, что состояние синхронизируется
    expect(hashStorage.getItem('authState')).toBeDefined();
    expect(authManager.isInitialized).toBe(true);
});

// ============================================================================
// ТЕСТ 7: Проверка блокировки UI при ошибке
// ============================================================================

test('UI должен блокироваться при критической ошибке', async () => {
    const authManager = new AuthManager({
        maxRetries: 1,
        blockUIOnError: true
    });
    
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));
    
    const uiBlocker = {
        block: jest.fn(),
        unblock: jest.fn()
    };
    
    await expect(authManager.login({ email: 'test@test.com', password: 'password' }))
        .rejects.toThrow('Connection refused');
    
    // UI должен быть заблокирован во время запроса
    expect(uiBlocker.block).toHaveBeenCalled();
});

// ============================================================================
// ТЕСТ 8: Проверка восстановления состояния после сбоя
// ============================================================================

test('AuthManager должен восстанавливать состояние после сбоя', async () => {
    const authManager = new AuthManager();
    const mockState = { userId: '123', token: 'old-token' };
    
    authManager.setState(mockState);
    
    // Симулируем сбой
    authManager.handleConnectionError({ code: 'ECONNRESET' });
    
    // Состояние должно быть сброшено
    expect(authManager.getState().userId).toBeUndefined();
    
    // Но должна быть возможность восстановиться
    await authManager.recover();
    expect(authManager.getState().userId).toBe('123');
});

// ============================================================================
// ТЕСТ 9: Проверка буфера сообщений WebSocket
// ============================================================================

test('WebSocketManager должен буферизировать сообщения во время переподключения', async () => {
    const wsManager = new WebSocketManager();
    
    // Симулируем переподключение
    wsManager.reconnecting = true;
    
    // Отправляем сообщение во время переподключения
    wsManager.send({ type: 'message', data: 'test' });
    
    // Сообщение должно быть в буфере
    expect(wsManager.messageBuffer.length).toBe(1);
    
    // После переподключения сообщения должны быть отправлены
    wsManager.reconnecting = false;
    wsManager.flushBuffer();
    
    expect(wsManager.messageBuffer.length).toBe(0);
});

// ============================================================================
// ТЕСТ 10: Проверка очистки ресурсов
// ============================================================================

test('Все менеджеры должны корректно очищать ресурсы', async () => {
    const authManager = new AuthManager();
    const wsManager = new WebSocketManager();
    const retryManager = new RetryManager();
    
    // Устанавливаем таймеры и интервалы
    await authManager.login({ email: 'test@test.com', password: 'password' });
    
    // Очищаем ресурсы
    authManager.dispose();
    wsManager.dispose();
    
    // Проверяем, что все таймеры очищены
    expect(authManager.pendingRequests.length).toBe(0);
    expect(wsManager.reconnectInterval).toBeNull();
});

// ============================================================================
// ЗАПУСК ТЕСТОВ
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        runTests: () => {
            console.log('Запуск тестов...');
            // Здесь можно добавить код запуска тестов
        }
    };
}
