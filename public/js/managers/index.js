/**
 * Центральный экспорт всех менеджеров системы
 * 
 * Использование:
 * import { AuthManager, ConnectionManager, RetryManager } from './managers/index.js';
 */

export { ConnectionManager } from './ConnectionManager.js';
export { RetryManager } from './RetryManager.js';
export { SafeInitializer } from './SafeInitializer.js';
export { AuthManager } from './AuthManager.js';
export { WebSocketManager } from './WebSocketManager.js';

// Глобальные экземпляры
export const connectionManager = new ConnectionManager();
export const retryManager = new RetryManager({
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000
});
export const safeInitializer = new SafeInitializer();
export const authManager = new AuthManager();
export const webSocketManager = new WebSocketManager();

// Утилиты
export * from './error-handler.js';
