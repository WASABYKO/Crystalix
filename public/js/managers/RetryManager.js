/**
 * RetryManager v1.0 — Менеджер повторных попыток
 * Экспоненциальная задержка, jitter, ограничение попыток
 */

const RetryManager = (function() {
    'use strict';

    // Конфигурация по умолчанию
    const DEFAULT_CONFIG = {
        maxRetries: 3,
        baseDelay: 1000, // Базовая задержка в мс
        maxDelay: 30000, // Максимальная задержка
        factor: 2, // Множитель для экспоненциальной задержки
        jitter: true, // Добавлять случайность
        jitterFactor: 0.3, // 30% случайности
        retryOn: [408, 429, 500, 502, 503, 504], // Коды для повтора
        abortOn: [401, 403, 404, 422], // Коды для остановки
        timeout: 15000 // Таймаут запроса
    };

    // Вычисление задержки с jitter
    function calculateDelay(attempt, baseDelay, factor, maxDelay, jitter, jitterFactor) {
        let delay = baseDelay * Math.pow(factor, attempt);

        // Ограничиваем максимальной задержкой
        delay = Math.min(delay, maxDelay);

        // Добавляем jitter для предотвращения thundering herd
        if (jitter) {
            const jitterAmount = delay * jitterFactor;
            delay = delay - jitterAmount + (Math.random() * jitterAmount * 2);
        }

        return Math.floor(delay);
    }

    // Выполнение операции с повторными попытки
    async function execute(asyncFn, options = {}) {
        const config = { ...DEFAULT_CONFIG, ...options };
        let lastError = null;
        let lastAttempt = 0;

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            lastAttempt = attempt;

            try {
                // Создаем AbortController для таймаута
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.timeout);

                const result = await asyncFn({ attempt, signal: controller.signal });

                clearTimeout(timeoutId);

                // Успех - возвращаем результат
                return {
                    success: true,
                    data: result,
                    attempts: attempt + 1,
                    totalTime: 0 // Можно добавить замер времени
                };
            } catch (error) {
                lastError = error;

                // Проверяем, нужно ли повторять
                const status = error.status || error.statusCode;

                // Не повторяем для определенных кодов
                if (config.abortOn.includes(status)) {
                    console.log(`[RetryManager] Ошибка ${status} - не повторяем`);
                    break;
                }

                // Проверяем, нужно ли повторять
                const shouldRetry = config.retryOn.includes(status) ||
                                   error.name === 'AbortError' ||
                                   error.name === 'TypeError' ||
                                   error.message.includes('network') ||
                                   error.message.includes('fetch');

                if (!shouldRetry || attempt >= config.maxRetries) {
                    console.log(`[RetryManager] Превышено количество попыток или ошибка не retryable`);
                    break;
                }

                // Вычисляем задержку
                const delay = calculateDelay(
                    attempt + 1,
                    config.baseDelay,
                    config.factor,
                    config.maxDelay,
                    config.jitter,
                    config.jitterFactor
                );

                console.log(`[RetryManager] Попытка ${attempt + 1}/${config.maxRetries} не удалась. Повтор через ${delay}мс`);

                // Ждем перед следующей попыткой
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // Все попытки исчерпаны
        return {
            success: false,
            error: lastError,
            attempts: lastAttempt + 1,
            failed: true
        };
    }

    // Retry-декоратор для функций
    function withRetry(asyncFn, options = {}) {
        return async function(...args) {
            return execute(async ({ signal }) => {
                return asyncFn(...args, signal);
            }, options);
        };
    }

    // Цепочка retry для зависимых операций
    async function chain(operations, options = {}) {
        const config = { ...DEFAULT_CONFIG, ...options };
        const results = [];
        let chainFailed = false;

        for (const [name, operation] of operations) {
            if (chainFailed) break;

            const result = await execute(operation, { ...config, maxRetries: 1 }); // 1 попытка для промежуточных шагов

            if (result.success) {
                results.push({ name, success: true, data: result.data });
            } else {
                results.push({ name, success: false, error: result.error });
                chainFailed = true;
            }
        }

        return {
            success: !chainFailed,
            results,
            completed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        };
    }

    // Параллельные retry с ограничением
    async function parallel(tasks, options = {}) {
        const config = { ...DEFAULT_CONFIG, ...options };
        const limit = options.concurrency || 5;

        const results = [];
        const queue = [...tasks];

        async function worker() {
            while (queue.length > 0) {
                const task = queue.shift();
                const result = await execute(task.fn, { ...config, maxRetries: 1 });
                results.push({ name: task.name, ...result });
            }
        }

        // Запускаем limited concurrent workers
        const workers = [];
        for (let i = 0; i < Math.min(limit, tasks.length); i++) {
            workers.push(worker());
        }

        await Promise.all(workers);

        return {
            success: results.every(r => r.success),
            results,
            completed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        };
    }

    // Утилита: retry с экспоненциальной задержкой (простой API)
    async function withExponentialBackoff(fn, maxRetries = 3, baseDelay = 1000) {
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;

                if (attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    // Утилита: retry с linear backoff
    async function withLinearBackoff(fn, maxRetries = 3, baseDelay = 1000) {
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;

                if (attempt < maxRetries - 1) {
                    const delay = baseDelay * (attempt + 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    // Публичный API
    return {
        execute,
        withRetry,
        chain,
        parallel,
        withExponentialBackoff,
        withLinearBackoff,

        // Конфигурация
        DEFAULT_CONFIG,

        // Утилиты
        calculateDelay
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.RetryManager = RetryManager;
    console.log('🔄 RetryManager v1.0 загружен');
}
