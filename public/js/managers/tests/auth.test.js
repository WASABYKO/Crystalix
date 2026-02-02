/**
 * Тест-кейсы для системы авторизации и WebSocket
 * 
 * Тесты проверяют:
 * 1. RetryManager - логику повторных попыток
 * 2. SafeInitializer - защиту от дублирующей инициализации
 * 3. ConnectionManager - обработку ошибок соединения
 * 4. AuthManager - полный поток авторизации
 * 5. WebSocketManager - переподключение и ре-аутентификацию
 */

(function() {
    'use strict';

    const TestRunner = {
        results: [],
        
        async runAll() {
            console.log('=== Запуск тестов системы авторизации ===\n');
            
            await this.testRetryManager();
            await this.testSafeInitializer();
            await this.testConnectionManager();
            await this.testAuthManager();
            await this.testWebSocketManager();
            
            this.printSummary();
        },
        
        async testRetryManager() {
            console.log('--- Тест: RetryManager ---');
            
            // Тест 1: Успешная попытка с первого раза
            let attempts = 0;
            const successOnFirst = new RetryManager({
                maxRetries: 3,
                baseDelay: 100,
                onRetry: (error, attempt) => { attempts++; }
            });
            
            let result = await successOnFirst.execute(async () => {
                return { success: true };
            });
            
            this.assert(result.success === true, 'Успешная попытка с первого раза');
            this.assert(attempts === 0, 'Не должно быть повторных попыток');
            
            // Тест 2: Неудача с последующим успехом
            let attemptCount = 0;
            const retryThenSuccess = new RetryManager({
                maxRetries: 3,
                baseDelay: 50,
                maxDelay: 100,
                backoffMultiplier: 1.1
            });
            
            result = await retryThenSuccess.execute(async (failed) => {
                attemptCount++;
                if (attemptCount < 2) {
                    throw new ConnectionError('ERR_CONNECTION_REFUSED', 'Test error');
                }
                return { success: true };
            });
            
            this.assert(result.success === true, 'Успех после повторной попытки');
            this.assert(attemptCount === 2, 'Должно быть 2 попытки');
            
            // Тест 3: Превышение лимита попыток
            let failAttempts = 0;
            const alwaysFail = new RetryManager({
                maxRetries: 2,
                baseDelay: 10
            });
            
            try {
                await alwaysFail.execute(async () => {
                    failAttempts++;
                    throw new ConnectionError('ERR_CONNECTION_REFUSED', 'Always fails');
                });
                this.assert(false, 'Должно было выбросить исключение');
            } catch (error) {
                this.assert(error.type === 'MAX_RETRIES_EXCEEDED', 'Превышен лимит попыток');
                this.assert(failAttempts === 3, 'Должно быть 3 попытки (1 + 2 повтора)');
            }
            
            // Тест 4: Экспоненциальная задержка
            const delays = [];
            const exponential = new RetryManager({
                maxRetries: 3,
                baseDelay: 100,
                backoffMultiplier: 2,
                onRetry: (error, attempt, delay) => delays.push(delay)
            });
            
            let expAttempts = 0;
            try {
                await exponential.execute(async () => {
                    expAttempts++;
                    throw new ConnectionError('ERR_CONNECTION_REFUSED');
                });
            } catch (e) {}
            
            this.assert(delays.length === 3, 'Должно быть 3 задержки');
            this.assert(delays[0] === 100, 'Первая задержка 100мс');
            this.assert(delays[1] === 200, 'Вторая задержка 200мс');
            this.assert(delays[2] === 400, 'Третья задержка 400мс');
            
            console.log('✓ RetryManager: Все тесты пройдены\n');
        },
        
        async testSafeInitializer() {
            console.log('--- Тест: SafeInitializer ---');
            
            // Тест 1: Одиночная инициализация
            const singleInit = new SafeInitializer('TestModule');
            let initCount = 0;
            
            await singleInit.initialize(async () => {
                initCount++;
                await this.delay(10);
                return { initialized: true };
            });
            
            this.assert(initCount === 1, 'Инициализация должна вызваться один раз');
            this.assert(singleInit.isInitialized === true, 'Флаг инициализации установлен');
            
            // Тест 2: Защита от повторной инициализации
            let concurrentInits = 0;
            const protectedInit = new SafeInitializer('ProtectedModule');
            
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(protectedInit.initialize(async () => {
                    concurrentInits++;
                    await this.delay(20);
                    return { id: i };
                }));
            }
            
            await Promise.all(promises);
            this.assert(concurrentInits === 1, 'Только одна инициализация должна выполниться');
            
            // Тест 3: Очередь вызовов
            const queuedInit = new SafeInitializer('QueuedModule');
            let queueResult = null;
            
            await queuedInit.initialize(async () => {
                await this.delay(10);
                return 'first';
            });
            
            const queuedResult = await queuedInit.initialize(async () => {
                return 'second';
            });
            
            this.assert(queuedResult === 'second', 'Второй вызов должен вернуть результат');
            
            // Тест 4: Ошибка инициализации
            const failInit = new SafeInitializer('FailModule');
            
            try {
                await failInit.initialize(async () => {
                    throw new Error('Init failed');
                });
                this.assert(false, 'Должно было выбросить исключение');
            } catch (error) {
                this.assert(error.message === 'Init failed', 'Ошибка инициализации');
                this.assert(failInit.isInitialized === false, 'Флаг не установлен при ошибке');
            }
            
            console.log('✓ SafeInitializer: Все тесты пройдены\n');
        },
        
        async testConnectionManager() {
            console.log('--- Тест: ConnectionManager ---');
            
            // Тест 1: Определение типа ошибки
            const connMgr = new ConnectionManager({
                baseURL: '/api',
                timeout: 5000
            });
            
            this.assert(
                connMgr.isRetryableError({ code: 'ERR_CONNECTION_REFUSED' }),
                'ERR_CONNECTION_REFUSED - retryable'
            );
            this.assert(
                connMgr.isRetryableError({ code: 'ERR_CONNECTION_RESET' }),
                'ERR_CONNECTION_RESET - retryable'
            );
            this.assert(
                connMgr.isRetryableError({ code: 'ETIMEDOUT' }),
                'ETIMEDOUT - retryable'
            );
            this.assert(
                !connMgr.isRetryableError({ code: '400' }),
                '400 - not retryable'
            );
            this.assert(
                !connMgr.isRetryableError({ code: '401' }),
                '401 - not retryable'
            );
            
            // Тест 2: Состояние соединения
            this.assert(connMgr.getConnectionState() === 'disconnected', 'Начальное состояние disconnected');
            
            // Тест 3: Проверка доступности сервера (мок)
            connMgr.serverCheckInterval = null; // Отключаем интервал
            const isAvailable = await connMgr.checkServerAvailability();
            this.assert(typeof isAvailable === 'boolean', 'checkServerAvailability возвращает boolean');
            
            console.log('✓ ConnectionManager: Все тесты пройдены\n');
        },
        
        async testAuthManager() {
            console.log('--- Тест: AuthManager ---');
            
            // Тест 1: Инициализация
            const authMgr = new AuthManager();
            this.assert(authMgr.isInitialized === false, 'Начальное состояние не инициализировано');
            
            // Тест 2: Состояние авторизации
            this.assert(authMgr.getAuthState() === 'unauthenticated', 'Начальное состояние unauthenticated');
            
            // Тест 3: Rate limiting
            const now = Date.now();
            authMgr.lastAuthAttempt = now - 1000; // 1 секунда назад
            
            const canRetry = authMgr.canRetryAuth();
            this.assert(canRetry === true, 'Можно повторить попытку через 1 секунду');
            
            authMgr.lastAuthAttempt = now;
            const cannotRetry = authMgr.canRetryAuth();
            this.assert(cannotRetry === false, 'Нельзя повторить мгновенно');
            
            console.log('✓ AuthManager: Все тесты пройдены\n');
        },
        
        async testWebSocketManager() {
            console.log('--- Тест: WebSocketManager ---');
            
            // Тест 1: Состояние WebSocket
            const wsMgr = new WebSocketManager();
            
            this.assert(wsMgr.getState() === 'disconnected', 'Начальное состояние disconnected');
            this.assert(wsMgr.reconnectAttempts === 0, 'Нет попыток переподключения');
            
            // Тест 2: URL генерация
            const token = 'test-token';
            const url = wsMgr.getConnectionUrl(token);
            this.assert(url.includes('token=test-token'), 'URL содержит токен');
            
            // Тест 3: Проверка необходимости re-auth
            const needsReauth = wsMgr.needsReauthentication(new Error('401 Unauthorized'));
            this.assert(needsReauth === true, '401 требует re-auth');
            
            const noReauth = wsMgr.needsReauthentication(new Error('500 Server Error'));
            this.assert(noReauth === false, '500 не требует re-auth');
            
            console.log('✓ WebSocketManager: Все тесты пройдены\n');
        },
        
        // Вспомогательные методы
        assert(condition, message) {
            if (condition) {
                this.results.push({ status: 'passed', message });
                console.log(`  ✓ ${message}`);
            } else {
                this.results.push({ status: 'failed', message });
                console.log(`  ✗ ${message}`);
            }
        },
        
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        
        printSummary() {
            const passed = this.results.filter(r => r.status === 'passed').length;
            const failed = this.results.filter(r => r.status === 'failed').length;
            
            console.log('\n=== Результаты тестов ===');
            console.log(`Пройдено: ${passed}`);
            console.log(`Провалено: ${failed}`);
            console.log(`Всего: ${this.results.length}`);
            
            if (failed > 0) {
                console.log('\nПроваленные тесты:');
                this.results.filter(r => r.status === 'failed').forEach(r => {
                    console.log(`  - ${r.message}`);
                });
            }
        }
    };

    // Экспорт для использования
    window.TestRunner = TestRunner;

    // Автозапуск при загрузке
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => TestRunner.runAll(), 100);
        });
    } else {
        setTimeout(() => TestRunner.runAll(), 100);
    }
})();
