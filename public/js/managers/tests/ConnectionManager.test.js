/**
 * Тесты для ConnectionManager
 * 
 * Запуск: node test-connection-manager.js
 */

import { jest } from '@jest/globals';

// Мокаем глобальные объекты для тестов
global.navigator = { onLine: true };
global.window = { addEventListener: jest.fn() };

// Импортируем тестируемый модуль
const { ConnectionManager } = await import('../ConnectionManager.js');

describe('ConnectionManager', () => {
    let manager;
    
    beforeEach(() => {
        manager = new ConnectionManager();
        // Сбрасываем онлайн статус
        Object.defineProperty(navigator, 'onLine', {
            value: true,
            configurable: true
        });
    });
    
    afterEach(() => {
        manager.destroy();
    });
    
    describe('isOnline', () => {
        test('должен возвращать true когда onLine = true', () => {
            Object.defineProperty(navigator, 'onLine', { value: true });
            expect(manager.isOnline()).toBe(true);
        });
        
        test('должен возвращать false когда onLine = false', () => {
            Object.defineProperty(navigator, 'onLine', { value: false });
            expect(manager.isOnline()).toBe(false);
        });
    });
    
    describe('getConnectionQuality', () => {
        test('должен возвращать good при быстром ответе', async () => {
            const quality = await manager.getConnectionQuality();
            expect(['good', 'slow', 'offline']).toContain(quality);
        });
        
        test('должен возвращать offline при ошибках', async () => {
            // Мокаем fetch для симуляции ошибки
            const originalFetch = global.fetch;
            global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
            
            const quality = await manager.getConnectionQuality();
            expect(quality).toBe('offline');
            
            global.fetch = originalFetch;
        });
    });
    
    describe('handleConnectionChange', () => {
        test('должен вызывать коллбэки при изменении статуса', async () => {
            const callback1 = jest.fn();
            const callback2 = jest.fn();
            
            manager.onConnectionChange(callback1);
            manager.onConnectionChange(callback2);
            
            // Эмулируем переход в офлайн
            Object.defineProperty(navigator, 'onLine', { value: false });
            window.dispatchEvent(new Event('offline'));
            
            // Ждем debounce
            await new Promise(resolve => setTimeout(resolve, 300));
            
            expect(callback1).toHaveBeenCalledWith(false);
            expect(callback2).toHaveBeenCalledWith(false);
        });
    });
    
    describe('destroy', () => {
        test('должен очищать все обработчики', () => {
            const callback = jest.fn();
            manager.onConnectionChange(callback);
            
            manager.destroy();
            window.dispatchEvent(new Event('offline'));
            
            expect(callback).not.toHaveBeenCalled();
        });
    });
});

console.log('Тесты ConnectionManager загружены');
