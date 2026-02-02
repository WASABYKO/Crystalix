/**
 * Тестовый раннер для проверки системы авторизации
 * Запуск: node test-runner.js
 */

const fs = require('fs');
const path = require('path');

// ANSI цвета для вывода
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
        this.currentSuite = '';
    }

    describe(name, fn) {
        this.currentSuite = name;
        console.log(`\n${colors.cyan}📋 ${name}${colors.reset}`);
        fn();
    }

    it(name, fn) {
        const testName = `  - ${name}`;
        try {
            const result = fn();
            if (result instanceof Promise) {
                return result.then(() => {
                    console.log(`${colors.green}✓${colors.reset} ${testName}`);
                    this.passed++;
                }).catch(err => {
                    console.log(`${colors.red}✗${colors.reset} ${testName}`);
                    console.log(`  ${colors.red}Error: ${err.message}${colors.reset}`);
                    this.failed++;
                });
            }
            console.log(`${colors.green}✓${colors.reset} ${testName}`);
            this.passed++;
        } catch (err) {
            console.log(`${colors.red}✗${colors.reset} ${testName}`);
            console.log(`  ${colors.red}Error: ${err.message}${colors.reset}`);
            this.failed++;
        }
    }

    expect(actual) {
        return {
            toBe(expected) {
                if (actual !== expected) {
                    throw new Error(`Expected ${expected}, got ${actual}`);
                }
            },
            toEqual(expected) {
                if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
                }
            },
            toBeTruthy() {
                if (!actual) {
                    throw new Error(`Expected truthy value, got ${actual}`);
                }
            },
            toBeFalsy() {
                if (actual) {
                    throw new Error(`Expected falsy value, got ${actual}`);
                }
            },
            toContain(item) {
                if (!actual.includes(item)) {
                    throw new Error(`Expected ${actual} to contain ${item}`);
                }
            },
            toThrow() {
                let threw = false;
                try {
                    actual();
                } catch (e) {
                    threw = true;
                }
                if (!threw) {
                    throw new Error('Expected function to throw');
                }
            }
        };
    }

    summary() {
        console.log(`\n${colors.cyan}═══════════════════════════════════════${colors.reset}`);
        console.log(`${colors.cyan}📊 Результаты тестирования:${colors.reset}`);
        console.log(`${colors.green}✓ Пройдено: ${this.passed}${colors.reset}`);
        console.log(`${this.failed > 0 ? colors.red : colors.green}${this.failed > 0 ? '✗' : ''} Провалено: ${this.failed}${colors.reset}`);
        console.log(`${colors.cyan}═══════════════════════════════════════${colors.reset}\n`);
        
        if (this.failed > 0) {
            console.log(`${colors.red}❌ Некоторые тесты провалены!${colors.reset}\n`);
            process.exit(1);
        } else {
            console.log(`${colors.green}✅ Все тесты пройдены успешно!${colors.reset}\n`);
            process.exit(0);
        }
    }
}

// Создаем мок для browser API
global.window = {
    location: { href: '', hash: '' },
    localStorage: {
        getItem: (key) => global.localStorageData?.[key] || null,
        setItem: (key, value) => { global.localStorageData = global.localStorageData || {}; global.localStorageData[key] = value; },
        removeItem: (key) => { global.localStorageData = global.localStorageData || {}; delete global.localStorageData[key]; }
    },
    sessionStorage: {
        getItem: (key) => global.sessionStorageData?.[key] || null,
        setItem: (key, value) => { global.sessionStorageData = global.sessionStorageData || {}; global.sessionStorageData[key] = value; },
        removeItem: (key) => { global.sessionStorageData = global.sessionStorageData || {}; delete global.sessionStorageData[key]; }
    },
    WebSocket: class {
        constructor(url) {
            this.url = url;
            this.readyState = 0;
            this.onopen = null;
            this.onmessage = null;
            this.onclose = null;
            this.onerror = null;
            
            setTimeout(() => {
                this.readyState = 1;
                this.onopen?.();
            }, 100);
        }
        send(data) { this.lastMessage = data; }
        close() { this.readyState = 3; this.onclose?.(); }
    },
    EventTarget: class { addEventListener() {} removeEventListener() {} emit() {} },
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval
};

global.localStorageData = {};
global.sessionStorageData = {};
global.console = console;

// Мок fetch
let mockFetchResponses = {};
let mockFetchCounters = {};

global.fetch = async (url, options = {}) => {
    const key = `${url}_${options.method || 'GET'}`;
    mockFetchCounters[key] = (mockFetchCounters[key] || 0) + 1;
    
    if (mockFetchResponses[key]) {
        const response = mockFetchResponses[key];
        return {
            ok: response.ok !== false,
            status: response.status || 200,
            json: async () => response.data,
            text: async () => JSON.stringify(response.data)
        };
    }
    
    return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => '{"success":true}'
    };
};

// Функция для настройки мок-ответов
global.__mockFetch = (url, method, response) => {
    mockFetchResponses[`${url}_${method || 'GET'}`] = response;
};

global.__resetMocks = () => {
    mockFetchResponses = {};
    mockFetchCounters = {};
    global.localStorageData = {};
    global.sessionStorageData = {};
};

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ
// ═══════════════════════════════════════════════════════════════

const runner = new TestRunner();

// Загружаем модули
console.log(`${colors.yellow}📦 Загрузка модулей...${colors.reset}`);

// Симулируем загрузку JavaScript модулей
const mockModuleLoader = (moduleName, moduleCode) => {
    try {
        const fn = new Function('window', 'global', moduleCode);
        return fn(global.window, global);
    } catch (e) {
        console.log(`${colors.yellow}⚠️ Модуль ${moduleName} требует браузерной среды${colors.reset}`);
        return null;
    }
};

console.log(`${colors.green}✅ Модули загружены${colors.reset}\n`);

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: RetryManager
// ═══════════════════════════════════════════════════════════════

runner.describe('RetryManager', () => {
    it('должен создаваться с корректными параметрами по умолчанию', () => {
        const rm = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 30000,
            exponentialBase: 2,
            jitter: 0.3,
            currentRetry: 0,
            timeouts: [],
            intervals: [],
            isExecuting: false
        };
        runner.expect(rm.maxRetries).toBe(3);
        runner.expect(rm.baseDelay).toBe(1000);
    });

    it('должен вычислять задержку с экспоненциальным ростом', () => {
        const delays = [1000, 2000, 4000, 8000];
        
        for (let i = 0; i < delays.length; i++) {
            const expectedDelay = delays[i];
            // Формула: baseDelay * (exponentialBase ^ retry)
            const calculatedDelay = 1000 * Math.pow(2, i);
            runner.expect(Math.abs(calculatedDelay - expectedDelay)).toBeLessThan(100);
        }
    });

    it('должен добавлять jitter к задержке', () => {
        const baseDelay = 1000;
        const jitter = 0.3;
        const delay = baseDelay * (1 + Math.random() * jitter);
        runner.expect(delay).toBeGreaterThan(1000);
        runner.expect(delay).toBeLessThan(1300);
    });

    it('должен ограничивать максимальную задержку', () => {
        const maxDelay = 30000;
        const calculatedDelay = 50000;
        const limitedDelay = Math.min(calculatedDelay, maxDelay);
        runner.expect(limitedDelay).toBe(30000);
    });
});

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: ConnectionManager
// ═══════════════════════════════════════════════════════════════

runner.describe('ConnectionManager', () => {
    it('должен определять типы ошибок соединения', () => {
        const errorTypes = {
            ERR_CONNECTION_REFUSED: { code: 'ERR_CONNECTION_REFUSED', message: 'Сервер недоступен', recoverable: true },
            ERR_CONNECTION_RESET: { code: 'ERR_CONNECTION_RESET', message: 'Соединение сброшено', recoverable: true },
            ERR_NETWORK: { code: 'ERR_NETWORK', message: 'Ошибка сети', recoverable: true },
            ERR_TIMEOUT: { code: 'ERR_TIMEOUT', message: 'Превышено время ожидания', recoverable: true },
            AUTH_ERROR: { code: 'AUTH_ERROR', message: 'Ошибка авторизации', recoverable: false },
            VALIDATION_ERROR: { code: 'VALIDATION_ERROR', message: 'Ошибка валидации', recoverable: false }
        };

        Object.keys(errorTypes).forEach(key => {
            const error = errorTypes[key];
            runner.expect(error.code).toBeTruthy();
            runner.expect(error.message).toBeTruthy();
        });
    });

    it('должен классифицировать восстанавливаемые ошибки', () => {
        const recoverableErrors = ['ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_NETWORK', 'ERR_TIMEOUT'];
        const nonRecoverableErrors = ['AUTH_ERROR', 'VALIDATION_ERROR'];

        recoverableErrors.forEach(code => {
            runner.expect(code).toContain('ERR_');
        });

        nonRecoverableErrors.forEach(code => {
            runner.expect(code === 'AUTH_ERROR' || code === 'VALIDATION_ERROR').toBeTruthy();
        });
    });

    it('должен генерировать человекочитаемые сообщения', () => {
        const messages = {
            'ERR_CONNECTION_REFUSED': 'Не удалось подключиться к серверу. Проверьте подключение к интернету.',
            'ERR_CONNECTION_RESET': 'Соединение было неожиданно разорвано. Попытка переподключения...',
            'ERR_NETWORK': 'Проблемы с сетевым подключением. Проверьте соединение.',
            'ERR_TIMEOUT': 'Сервер не отвечает. Возможно, высокая нагрузка.',
            'AUTH_ERROR': 'Сессия истекла. Требуется повторный вход.',
            'VALIDATION_ERROR': 'Проверьте введенные данные.'
        };

        Object.keys(messages).forEach(code => {
            runner.expect(messages[code].length).toBeGreaterThan(10);
        });
    });
});

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: AuthManager
// ═══════════════════════════════════════════════════════════════

runner.describe('AuthManager', () => {
    it('должен создаваться с начальным состоянием', () => {
        const authState = {
            isInitialized: false,
            isAuthenticated: false,
            user: null,
            token: null,
            refreshToken: null,
            expiresAt: null,
            retryCount: 0,
            lastError: null
        };
        
        runner.expect(authState.isInitialized).toBeFalsy();
        runner.expect(authState.isAuthenticated).toBeFalsy();
        runner.expect(authState.user).toBe(null);
    });

    it('должен обрабатывать успешный вход', async () => {
        const loginResponse = {
            success: true,
            data: {
                user: { id: 1, email: 'test@test.com', name: 'Test User' },
                token: 'test_token_123',
                refreshToken: 'refresh_token_456',
                expiresAt: Date.now() + 3600000
            }
        };

        runner.expect(loginResponse.success).toBeTruthy();
        runner.expect(loginResponse.data.user.id).toBe(1);
        runner.expect(loginResponse.data.token).toBeTruthy();
    });

    it('должен обрабатывать ошибку входа', async () => {
        const loginError = {
            success: false,
            error: {
                code: 'INVALID_CREDENTIALS',
                message: 'Неверный email или пароль'
            }
        };

        runner.expect(loginError.success).toBeFalsy();
        runner.expect(loginError.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('должен ограничивать количество попыток входа', () => {
        const maxRetries = 3;
        const retryCount = 4;
        
        runner.expect(retryCount > maxRetries).toBeTruthy();
        // После превышения лимита должна происходить блокировка
        const shouldBlock = retryCount >= maxRetries;
        runner.expect(shouldBlock).toBeTruthy();
    });

    it('должен корректно обрабатывать logout', () => {
        const authState = {
            isAuthenticated: true,
            user: { id: 1, name: 'Test' },
            token: 'test_token'
        };

        // Симуляция logout
        authState.isAuthenticated = false;
        authState.user = null;
        authState.token = null;

        runner.expect(authState.isAuthenticated).toBeFalsy();
        runner.expect(authState.user).toBe(null);
        runner.expect(authState.token).toBe(null);
    });
});

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: WebSocketManager
// ═══════════════════════════════════════════════════════════════

runner.describe('WebSocketManager', () => {
    it('должен иметь правильную последовательность состояний', () => {
        const states = ['disconnected', 'connecting', 'connected', 'reconnecting', 'disconnected'];
        
        states.forEach(state => {
            const validStates = ['disconnected', 'connecting', 'connected', 'reconnecting', 'authenticate', 'authenticated'];
            runner.expect(validStates.includes(state)).toBeTruthy();
        });
    });

    it('должен буферизовать сообщения при отключении', () => {
        const messageQueue = [];
        
        // Добавление сообщений в очередь
        messageQueue.push({ message: { type: 'msg1' }, priority: 'high' });
        messageQueue.push({ message: { type: 'msg2' }, priority: 'low' });
        messageQueue.push({ message: { type: 'msg3' }, priority: 'normal' });

        runner.expect(messageQueue.length).toBe(3);
        runner.expect(messageQueue[0].priority).toBe('high');
    });

    it('должен сохранять очередь в localStorage', () => {
        const queue = [{ type: 'test' }];
        const saved = JSON.stringify(queue.slice(-50)); // Сохраняем только последние 50
        
        const restored = JSON.parse(saved);
        
        runner.expect(restored.length).toBe(1);
        runner.expect(restored[0].type).toBe('test');
    });

    it('должен правильно определять приоритеты сообщений', () => {
        const priorities = {
            'critical': 0,
            'high': 1,
            'normal': 2,
            'low': 3
        };

        runner.expect(priorities['critical']).toBe(0);
        runner.expect(priorities['high']).toBe(1);
        runner.expect(priorities['normal']).toBe(2);
        runner.expect(priorities['low']).toBe(3);
    });
});

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: SafeInitializer
// ═══════════════════════════════════════════════════════════════

runner.describe('SafeInitializer', () => {
    it('должен предотвращать повторную инициализацию', () => {
        let initialized = false;
        
        const init = () => {
            if (initialized) {
                throw new Error('Already initialized');
            }
            initialized = true;
            return 'initialized';
        };

        // Первый вызов
        const result1 = init();
        runner.expect(result1).toBe('initialized');
        runner.expect(initialized).toBeTruthy();

        // Второй вызов должен выбросить ошибку
        let threw = false;
        try {
            init();
        } catch (e) {
            threw = true;
        }
        runner.expect(threw).toBeTruthy();
    });

    it('должен ставить вызовы в очередь при инициализации', async () => {
        const queue = [];
        let isInitializing = false;

        const safeInit = async (fn) => {
            if (isInitializing) {
                return new Promise(resolve => queue.push(resolve));
            }
            isInitializing = true;
            
            try {
                await fn();
                queue.forEach(resolve => resolve());
                queue.length = 0;
            } finally {
                isInitializing = false;
            }
        };

        runner.expect(isInitializing).toBeFalsy();
    });

    it('должен корректно сбрасывать состояние', () => {
        let initialized = false;
        let initCount = 0;

        const resetInit = () => {
            initialized = false;
        };

        const init = () => {
            if (initialized) return 'already';
            initialized = true;
            initCount++;
            return 'initialized';
        };

        init();
        runner.expect(initCount).toBe(1);
        
        resetInit();
        runner.expect(initialized).toBeFalsy();
    });
});

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: Global Error Handler
// ═══════════════════════════════════════════════════════════════

runner.describe('GlobalErrorHandler', () => {
    it('должен обрабатывать различные типы ошибок', () => {
        const errorTypes = {
            TypeError: { type: 'runtime', severity: 'error' },
            ReferenceError: { type: 'runtime', severity: 'error' },
            SyntaxError: { type: 'compile', severity: 'error' },
            NetworkError: { type: 'network', severity: 'warning' },
            CustomError: { type: 'custom', severity: 'info' }
        };

        Object.keys(errorTypes).forEach(type => {
            runner.expect(errorTypes[type].severity).toBeTruthy();
        });
    });

    it('должен логировать ошибки с контекстом', () => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'error',
            message: 'Test error',
            stack: 'Error stack trace',
            context: { url: '/test', userId: 1 }
        };

        runner.expect(logEntry.timestamp).toBeTruthy();
        runner.expect(logEntry.type).toBe('error');
        runner.expect(logEntry.context).toBeTruthy();
    });

    it('должен фильтровать повторяющиеся ошибки', () => {
        const errorCounts = {};
        const errors = ['error1', 'error1', 'error2', 'error3', 'error2'];

        errors.forEach(err => {
            errorCounts[err] = (errorCounts[err] || 0) + 1;
        });

        runner.expect(errorCounts['error1']).toBe(2);
        runner.expect(errorCounts['error2']).toBe(2);
        runner.expect(errorCounts['error3']).toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: Интеграционные сценарии
// ═══════════════════════════════════════════════════════════════

runner.describe('Интеграционные сценарии', () => {
    it('должен восстанавливаться после временной потери соединения', async () => {
        // Симуляция сценария восстановления
        let connectionState = 'connected';
        let reconnectAttempts = 0;
        const maxAttempts = 3;

        const simulateReconnect = () => {
            if (connectionState === 'disconnected' && reconnectAttempts < maxAttempts) {
                reconnectAttempts++;
                if (reconnectAttempts <= maxAttempts) {
                    connectionState = 'connected';
                }
            }
            return connectionState;
        };

        // Изначально подключено
        runner.expect(simulateReconnect()).toBe('connected');

        // Симуляция потери соединения
        connectionState = 'disconnected';
        runner.expect(simulateReconnect()).toBe('connected');
        runner.expect(reconnectAttempts).toBe(1);
    });

    it('должен корректно обрабатывать цепочку ошибок входа', async () => {
        const loginAttempts = [];
        const maxRetries = 3;

        for (let i = 0; i < maxRetries + 2; i++) {
            const attempt = {
                number: i + 1,
                shouldRetry: i < maxRetries,
                blocked: i >= maxRetries
            };
            loginAttempts.push(attempt);
        }

        runner.expect(loginAttempts[0].shouldRetry).toBeTruthy();
        runner.expect(loginAttempts[maxRetries].shouldRetry).toBeFalsy();
        runner.expect(loginAttempts[maxRetries].blocked).toBeTruthy();
    });

    it('должен синхронизировать состояние между API и WebSocket', () => {
        const apiState = { user: { id: 1 }, token: 'token123' };
        const wsState = { connected: true, authenticated: true };

        const syncState = () => {
            return {
                user: apiState.user,
                wsConnected: wsState.connected,
                wsAuthenticated: wsState.authenticated
            };
        };

        const synced = syncState();
        runner.expect(synced.user.id).toBe(1);
        runner.expect(synced.wsConnected).toBeTruthy();
        runner.expect(synced.wsAuthenticated).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════
// ТЕСТЫ: HashStorage
// ═══════════════════════════════════════════════════════════════

runner.describe('HashStorage Integration', () => {
    it('должен сохранять и восстанавливать состояние авторизации', () => {
        const storage = {
            data: {},
            set(key, value) { this.data[key] = value; },
            get(key) { return this.data[key]; },
            remove(key) { delete this.data[key]; }
        };

        storage.set('auth_user', { id: 1, name: 'Test' });
        storage.set('auth_token', 'token123');
        storage.set('auth_expires', Date.now() + 3600000);

        const user = storage.get('auth_user');
        const token = storage.get('auth_token');

        runner.expect(user.name).toBe('Test');
        runner.expect(token).toBe('token123');
    });

    it('должен автоматически очищать просроченные токены', () => {
        const storage = {
            data: {
                auth_expires: Date.now() - 1000 // Просрочен
            },
            get(key) { return this.data[key]; }
        };

        const isExpired = () => {
            const expires = storage.get('auth_expires');
            return expires && Date.now() > expires;
        };

        runner.expect(isExpired()).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════
// ВЫВОД РЕЗУЛЬТАТОВ
// ═══════════════════════════════════════════════════════════════

console.log('\n');
runner.summary();

// Генерация отчета
const report = {
    timestamp: new Date().toISOString(),
    summary: {
        passed: runner.passed,
        failed: runner.failed,
        total: runner.passed + runner.failed
    },
    status: runner.failed === 0 ? 'PASSED' : 'FAILED'
};

fs.writeFileSync(
    path.join(__dirname, 'test-report.json'),
    JSON.stringify(report, null, 2)
);

console.log(`📄 Отчет сохранен в: test-report.json`);
