/**
 * SafeInitializer v1.0 — Безопасная инициализация компонентов
 * Предотвращение дублирующей инициализации, очередь вызовов, graceful degradation
 */

const SafeInitializer = (function() {
    'use strict';

    // Приватное состояние
    const registry = new Map(); // name -> { initialized, initializing, queue, error, instance }
    const globalState = {
        isInitialized: false,
        isInitializing: false,
        initializationOrder: [],
        errors: []
    };

    // Конфигурация
    const CONFIG = {
        MAX_INIT_TIME: 30000, // Максимальное время инициализации
        GRACEFUL_DEGRADATION: true, // Graceful degradation при ошибках
        AUTO_RETRY: false, // Автоматический повтор при ошибках
        RETRY_DELAY: 2000, // Задержка перед повтором
        MAX_RETRIES: 2 // Максимальное количество повторов
    };

    // Регистрация компонента
    function register(name, options = {}) {
        if (registry.has(name)) {
            console.warn(`[SafeInitializer] Компонент ${name} уже зарегистрирован`);
            return registry.get(name);
        }

        const component = {
            name,
            initialized: false,
            initializing: false,
            error: null,
            instance: null,
            dependencies: options.dependencies || [],
            initFn: options.initFn || null,
            priority: options.priority || 0,
            retries: 0,
            queue: [],
            state: 'pending' // pending, initializing, ready, error, destroyed
        };

        registry.set(name, component);
        console.log(`[SafeInitializer] Зарегистрирован: ${name}`);

        return component;
    }

    // Удаление компонента
    function unregister(name) {
        const component = registry.get(name);
        if (component) {
            component.state = 'destroyed';
            registry.delete(name);
            console.log(`[SafeInitializer] Удалён: ${name}`);
        }
    }

    // Проверка зависимостей
    function checkDependencies(name) {
        const component = registry.get(name);
        if (!component) return false;

        for (const depName of component.dependencies) {
            const dep = registry.get(depName);
            if (!dep || !dep.initialized) {
                console.warn(`[SafeInitializer] Зависимость ${depName} не готова для ${name}`);
                return false;
            }
        }

        return true;
    }

    // Инициализация компонента
    async function initialize(name, initFn = null) {
        const component = registry.get(name);

        if (!component) {
            console.error(`[SafeInitializer] Компонент ${name} не зарегистрирован`);
            return { success: false, error: 'NOT_REGISTERED' };
        }

        // Проверяем состояние
        if (component.initialized && component.state === 'ready') {
            console.log(`[SafeInitializer] ${name} уже инициализирован, пропускаем`);
            return { success: true, cached: true, instance: component.instance };
        }

        // Уже инициализируется - добавляем в очередь
        if (component.initializing) {
            console.log(`[SafeInitializer] ${name} уже инициализируется, добавляем в очередь`);
            return new Promise((resolve) => {
                component.queue.push(resolve);
            });
        }

        // Проверяем зависимости
        if (!checkDependencies(name)) {
            console.warn(`[SafeInitializer] Зависимости не готовы для ${name}`);
            return { success: false, error: 'MISSING_DEPENDENCIES' };
        }

        // Начинаем инициализацию
        component.initializing = true;
        component.state = 'initializing';
        globalState.initializationOrder.push(name);

        console.log(`[SafeInitializer] Начало инициализации: ${name}`);

        try {
            // Таймаут инициализации
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('INIT_TIMEOUT')), CONFIG.MAX_INIT_TIME);
            });

            // Выполняем инициализацию
            const initFunction = initFn || component.initFn;
            const instance = initFunction
                ? await Promise.race([initFunction(), timeoutPromise])
                : null;

            component.instance = instance;
            component.initialized = true;
            component.initializing = false;
            component.state = 'ready';
            component.error = null;

            console.log(`[SafeInitializer] ✅ ${name} инициализирован`);

            // Выполняем очередь
            component.queue.forEach(resolve => resolve({ success: true, cached: true }));
            component.queue = [];

            // Уведомляем об успехе
            emit('componentReady', { name, instance });

            return { success: true, instance };
        } catch (error) {
            component.initializing = false;
            component.error = error;
            globalState.errors.push({ name, error });

            console.error(`[SafeInitializer] ❌ Ошибка инициализации ${name}:`, error);

            // Попытка повтора
            if (CONFIG.AUTO_RETRY && component.retries < CONFIG.MAX_RETRIES) {
                component.retries++;
                console.log(`[SafeInitializer] Попытка повтора ${component.retries}/${CONFIG.MAX_RETRIES} для ${name}`);

                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));

                // Очищаем состояние для повторной попытки
                component.initialized = false;
                component.state = 'pending';

                return initialize(name, initFn);
            }

            // Graceful degradation
            if (CONFIG.GRACEFUL_DEGRADATION) {
                component.state = 'degraded';
                console.warn(`[SafeInitializer] ${name} работает в режиме degraded`);
                emit('componentDegraded', { name, error });
                return { success: true, degraded: true, error };
            }

            component.state = 'error';
            emit('componentError', { name, error });

            return { success: false, error: error.message };
        }
    }

    // Параллельная инициализация нескольких компонентов
    async function initializeAll(names, options = {}) {
        const { order = 'parallel', timeout = CONFIG.MAX_INIT_TIME } = options;

        if (order === 'sequential') {
            // Последовательная инициализация
            const results = [];
            for (const name of names) {
                const result = await initialize(name);
                results.push({ name, ...result });
            }
            return results;
        }

        // Параллельная инициализация
        const promises = names.map(name => initialize(name));
        const results = await Promise.all(promises);

        return names.map((name, index) => ({ name, ...results[index] }));
        // timeoutPromise будет полезен для прерывания затянувшейся инициализации
    }

    // Инициализация по приоритету
    async function initializeByPriority() {
        const sorted = Array.from(registry.values())
            .sort((a, b) => b.priority - a.priority);

        const names = sorted.filter(c => c.state === 'pending').map(c => c.name);
        return initializeAll(names, { order: 'sequential' });
    }

    // Глубокая инициализация с зависимостями
    async function initializeDeep(name) {
        const component = registry.get(name);
        if (!component) {
            return { success: false, error: 'NOT_REGISTERED' };
        }

        // Сначала инициализируем зависимости
        for (const depName of component.dependencies) {
            await initializeDeep(depName);
        }

        // Затем сам компонент
        return initialize(name);
    }

    // Получение состояния
    function getState(name = null) {
        if (name) {
            const component = registry.get(name);
            return component ? { ...component, queue: undefined } : null;
        }

        return {
            global: {
                ...globalState,
                totalComponents: registry.size,
                readyComponents: Array.from(registry.values()).filter(c => c.state === 'ready').length,
                errorComponents: Array.from(registry.values()).filter(c => c.state === 'error').length,
                degradedComponents: Array.from(registry.values()).filter(c => c.state === 'degraded').length
            },
            components: Array.from(registry.entries()).map(([name, comp]) => ({
                name,
                state: comp.state,
                initialized: comp.initialized,
                error: comp.error?.message,
                priority: comp.priority,
                dependencies: comp.dependencies
            }))
        };
    }

    // Сброс состояния
    function reset(name = null) {
        if (name) {
            const component = registry.get(name);
            if (component) {
                component.initialized = false;
                component.initializing = false;
                component.state = 'pending';
                component.instance = null;
                component.error = null;
                console.log(`[SafeInitializer] Сброшен: ${name}`);
            }
        } else {
            registry.forEach((component, name) => {
                component.initialized = false;
                component.initializing = false;
                component.state = 'pending';
                component.instance = null;
                component.error = null;
            });
            globalState.isInitialized = false;
            globalState.initializationOrder = [];
            console.log('[SafeInitializer] Все сброшено');
        }
    }

    // Проверка готовности
    function isReady(name) {
        const component = registry.get(name);
        return component && component.state === 'ready';
    }

    function isAllReady() {
        return Array.from(registry.values()).every(c => c.state === 'ready' || c.state === 'degraded');
    }

    // Event system
    const listeners = new Map();

    function on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(callback);
        return () => off(event, callback);
    }

    function off(event, callback) {
        if (listeners.has(event)) listeners.get(event).delete(callback);
    }

    function emit(event, data) {
        if (listeners.has(event)) {
            listeners.get(event).forEach(cb => {
                try { cb(data); } catch (e) { console.error(e); }
            });
        }
    }

    // Публичный API
    return {
        register,
        unregister,
        initialize,
        initializeAll,
        initializeByPriority,
        initializeDeep,
        getState,
        reset,
        isReady,
        isAllReady,
        on,
        off,
        CONFIG
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.SafeInitializer = SafeInitializer;
    console.log('🛡️ SafeInitializer v1.0 загружен');
}
