/**
 * Тест-кейсы для проверки системы авторизации
 * Запустить в консоли браузера: copy-paste этого файла
 */

(function() {
    'use strict';
    
    const TestRunner = {
        results: [],
        passed: 0,
        failed: 0,
        
        async run(name, testFn) {
            const result = { name, status: 'pending', error: null, time: 0 };
            const start = performance.now();
            
            try {
                await testFn();
                result.status = 'passed';
                this.passed++;
            } catch (error) {
                result.status = 'failed';
                result.error = error.message;
                this.failed++;
            } finally {
                result.time = Math.round((performance.now() - start) * 100) / 100;
            }
            
            this.results.push(result);
            console.log(
                result.status === 'passed' ? '✅' : '❌',
                result.name,
                result.status === 'failed' ? `(${result.error})` : ''
            );
        },
        
        async runGroup(groupName, tests) {
            console.group(`\n🔍 ${groupName}`);
            for (const [name, testFn] of Object.entries(tests)) {
                await this.run(name, testFn);
            }
            console.groupEnd();
        },
        
        report() {
            console.group('\n📊 Отчет о тестировании');
            console.log(`Всего: ${this.results.length}`);
            console.log(`✅ Пройдено: ${this.passed}`);
            console.log(`❌ Провалено: ${this.failed}`);
            console.log(`Процент успеха: ${Math.round((this.passed / this.results.length) * 100)}%`);
            console.groupEnd();
            
            if (this.failed > 0) {
                console.warn('\n⚠️ Проваленные тесты:');
                this.results.filter(r => r.status === 'failed').forEach(r => {
                    console.log(`  - ${r.name}: ${r.error}`);
                });
            }
            
            return this.failed === 0;
        }
    };
    
    // ========================================
    // ТЕСТЫ: SafeInitializer
    // ========================================
    async function testSafeInitializer() {
        await TestRunner.runGroup('SafeInitializer', {
            'Повторная инициализация должна блокироваться': async () => {
                let initCount = 0;
                const initializer = new SafeInitializer();
                
                await initializer.initialize(async () => {
                    initCount++;
                    return 'success';
                });
                
                await initializer.initialize(async () => {
                    initCount++;
                    return 'second';
                });
                
                if (initCount !== 1) {
                    throw new Error(`Ожидалось 1 вызов, получено ${initCount}`);
                }
            },
            
            'Очередь вызовов должна выполняться': async () => {
                const results = [];
                const initializer = new SafeInitializer();
                
                await initializer.initialize(async (signal) => {
                    results.push(1);
                    return 'first';
                });
                
                // Добавляем вызовы после инициализации
                const p1 = initializer.schedule(async () => {
                    results.push(2);
                    return 'second';
                });
                
                await p1;
                
                if (results.length !== 2 || results[1] !== 2) {
                    throw new Error('Очередь не выполнена');
                }
            },
            
            'isInitialized должен быть true после инициализации': async () => {
                const initializer = new SafeInitializer();
                
                if (initializer.isInitialized) {
                    throw new Error('Должен быть false до инициализации');
                }
                
                await initializer.initialize(async () => 'done');
                
                if (!initializer.isInitialized) {
                    throw new Error('Должен быть true после инициализации');
                }
            },
            
            'Отмена должна работать': async () => {
                const initializer = new SafeInitializer();
                let started = false;
                let cancelled = false;
                
                const promise = initializer.initialize(async (signal) => {
                    started = true;
                    await signal.waitForCancel?.();
                    cancelled = true;
                    return 'done';
                });
                
                // Даем время запуститься
                await new Promise(r => setTimeout(r, 10));
                initializer.cancel();
                
                try {
                    await promise;
                } catch (e) {
                    // Ожидаемое поведение
                }
                
                if (!cancelled) {
                    throw new Error('Отмена не сработала');
                }
            }
        });
    }
    
    // ========================================
    // ТЕСТЫ: RetryManager
    // ========================================
    async function testRetryManager() {
        await TestRunner.runGroup('RetryManager', {
            'Успешный запрос без повторов': async () => {
                let attempts = 0;
                const manager = new RetryManager();
                
                const result = await manager.execute(async () => {
                    attempts++;
                    return 'success';
                });
                
                if (attempts !== 1) {
                    throw new Error(`Ожидалось 1 попытка, получено ${attempts}`);
                }
                if (result !== 'success') {
                    throw new Error('Неверный результат');
                }
            },
            
            'Повторы при ошибках': async () => {
                let attempts = 0;
                const manager = new RetryManager({
                    maxRetries: 3,
                    baseDelay: 10
                });
                
                try {
                    await manager.execute(async () => {
                        attempts++;
                        if (attempts < 3) {
                            throw new Error('Temporary error');
                        }
                        return 'success';
                    }, { shouldRetry: (e) => e.message === 'Temporary error' });
                } catch (e) {
                    throw new Error('Повторы не сработали');
                }
                
                if (attempts !== 3) {
                    throw new Error(`Ожидалось 3 попытки, получено ${attempts}`);
                }
            },
            
            'Превышение лимита повторов': async () => {
                const manager = new RetryManager({
                    maxRetries: 2,
                    baseDelay: 5
                });
                
                let attempts = 0;
                
                try {
                    await manager.execute(async () => {
                        attempts++;
                        throw new Error('Always fails');
                    });
                    
                    throw new Error('Должна была быть ошибка');
                } catch (e) {
                    if (attempts !== 3) {
                        throw new Error(`Ожидалось 3 попытки, получено ${attempts}`);
                    }
                }
            },
            
            'Circuit breaker должен открываться': async () => {
                const manager = new RetryManager({
                    maxRetries: 2,
                    baseDelay: 5,
                    circuitBreakerThreshold: 2
                });
                
                try {
                    await manager.execute(async () => {
                        throw new Error('Always fails');
                    }, { shouldRetry: () => true });
                } catch (e) {
                    // Игнорируем
                }
                
                // Попытка после circuit break
                try {
                    await manager.execute(async () => 'success');
                    throw new Error('Circuit breaker не сработал');
                } catch (e) {
                    if (!e.message.includes('Circuit')) {
                        throw new Error('Неправильная ошибка circuit breaker');
                    }
                }
            }
        });
    }
    
    // ========================================
    // ТЕСТЫ: ConnectionManager
    // ========================================
    async function testConnectionManager() {
        await TestRunner.runGroup('ConnectionManager', {
            'Проверка статуса онлайн': () => {
                const manager = new ConnectionManager();
                // Статус зависит от реального состояния сети
                const status = manager.getStatus();
                if (!['online', 'offline'].includes(status)) {
                    throw new Error(`Неожиданный статус: ${status}`);
                }
            },
            
            'Проверка методов isOnline/isOffline': () => {
                const manager = new ConnectionManager();
                const online = manager.isOnline();
                const offline = manager.isOffline();
                
                if (online === offline) {
                    throw new Error('isOnline и isOffline должны возвращать разные значения');
                }
            },
            
            'Проверка retry count': () => {
                const manager = new ConnectionManager();
                manager.incrementRetryCount();
                manager.incrementRetryCount();
                
                if (manager.retryCount !== 2) {
                    throw new Error('Счетчик повторов не работает');
                }
            }
        });
    }
    
    // ========================================
    // ТЕСТЫ: AuthManager
    // ========================================
    async function testAuthManager() {
        await TestRunner.runGroup('AuthManager', {
            'Проверка структуры AuthManager': () => {
                if (typeof AuthManager !== 'function') {
                    throw new Error('AuthManager не найден или не является функцией');
                }
                
                const manager = new AuthManager();
                
                // Проверяем обязательные методы
                const requiredMethods = [
                    'initialize', 'login', 'logout', 'checkAuth',
                    'handleConnectionError', 'refreshToken'
                ];
                
                for (const method of requiredMethods) {
                    if (typeof manager[method] !== 'function') {
                        throw new Error(`Метод ${method} не найден`);
                    }
                }
            },
            
            'Проверка свойств по умолчанию': () => {
                const manager = new AuthManager();
                
                if (manager.maxRetries !== 3) {
                    throw new Error('maxRetries должно быть 3');
                }
                
                if (manager.isInitialized) {
                    throw new Error('isInitialized должен быть false до инициализации');
                }
            }
        });
    }
    
    // ========================================
    // ТЕСТЫ: WebSocketManager
    // ========================================
    async function testWebSocketManager() {
        await TestRunner.runGroup('WebSocketManager', {
            'Проверка структуры WebSocketManager': () => {
                if (typeof WebSocketManager !== 'function') {
                    throw new Error('WebSocketManager не найден или не является функцией');
                }
                
                const manager = new WebSocketManager();
                
                const requiredMethods = [
                    'connect', 'disconnect', 'send', 'reconnect',
                    'isConnected', 'subscribe', 'unsubscribe'
                ];
                
                for (const method of requiredMethods) {
                    if (typeof manager[method] !== 'function') {
                        throw new Error(`Метод ${method} не найден`);
                    }
                }
            },
            
            'Проверка буфера сообщений': () => {
                const manager = new WebSocketManager();
                
                manager.bufferMessage({ type: 'test', data: '123' });
                manager.bufferMessage({ type: 'test2', data: '456' });
                
                if (manager.messageBuffer.length !== 2) {
                    throw new Error('Буфер сообщений не работает');
                }
            },
            
            'Проверка подписок': () => {
                const manager = new WebSocketManager();
                let called = false;
                
                const unsubscribe = manager.subscribe('test', () => {
                    called = true;
                });
                
                if (typeof unsubscribe !== 'function') {
                    throw new Error('subscribe должен возвращать функцию отписки');
                }
                
                unsubscribe();
                
                if (manager.subscriptions.has('test')) {
                    throw new Error('Отписка не сработала');
                }
            }
        });
    }
    
    // ========================================
    // ТЕСТЫ: Интеграционные
    // ========================================
    async function testIntegration() {
        await TestRunner.runGroup('Интеграционные тесты', {
            'Все менеджеры должны быть доступны глобально': () => {
                const required = [
                    'SafeInitializer',
                    'RetryManager',
                    'ConnectionManager',
                    'AuthManager',
                    'WebSocketManager'
                ];
                
                for (const name of required) {
                    if (typeof window[name] !== 'function') {
                        throw new Error(`${name} не найден глобально`);
                    }
                }
            },
            
            'SafeInitializer должен быть в единственном экземпляре': () => {
                if (typeof window.safeInitializer === 'undefined') {
                    throw new Error('safeInitializer не создан');
                }
            },
            
            'StateManager должен быть доступен': () => {
                if (typeof window.StateManager === 'undefined') {
                    throw new Error('StateManager не найден');
                }
            }
        });
    }
    
    // ========================================
    // ЗАПУСК ТЕСТОВ
    // ========================================
    window.TestRunner = TestRunner;
    
    // Автоматический запуск при наличии всех компонентов
    async function runAllTests() {
        console.clear();
        console.log('🚀 Запуск тестов...\n');
        
        await testSafeInitializer();
        await testRetryManager();
        await testConnectionManager();
        await testAuthManager();
        await testWebSocketManager();
        await testIntegration();
        
        const success = TestRunner.report();
        
        console.log('\n📋 Рекомендации:');
        if (success) {
            console.log('✅ Все тесты прошли успешно!');
        } else {
            console.log('❌ Есть проваленные тесты. Проверьте реализацию.');
        }
        
        return success;
    }
    
    // Экспорт функции запуска
    window.runTests = runAllTests;
    
    // Автозапуск если все модули загружены
    if (document.readyState === 'complete') {
        setTimeout(runAllTests, 100);
    } else {
        window.addEventListener('load', () => setTimeout(runAllTests, 100));
    }
})();
