// src/server/logger.js - Централизованное логирование
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../logs/site.log');

// Создаём папку logs если не существует
const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Форматирование даты
function formatDate() {
    return new Date().toISOString();
}

// Запись в файл с UTF-8 кодировкой
function writeToFile(message) {
    const logMessage = `${formatDate()} ${message}\n`;
    fs.appendFileSync(LOG_FILE, logMessage, { encoding: 'utf8' });
}

// Перехват console.log
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

console.log = function(...args) {
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    writeToFile(`[LOG] ${message}`);
    originalLog.apply(console, args);
};

console.error = function(...args) {
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    writeToFile(`[ERROR] ${message}`);
    originalError.apply(console, args);
};

console.warn = function(...args) {
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    writeToFile(`[WARN] ${message}`);
    originalWarn.apply(console, args);
};

console.info = function(...args) {
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    writeToFile(`[INFO] ${message}`);
    originalInfo.apply(console, args);
};

// Логирование HTTP запросов
function requestLogger(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = `[HTTP] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`;
        writeToFile(log);
        originalLog(log);
    });
    
    next();
}

// Логирование WebSocket
function wsLogger(type, data) {
    const message = typeof data === 'object' ? JSON.stringify(data) : String(data);
    writeToFile(`[WS] ${type}: ${message}`);
    originalLog(`[WS] ${type}:`, data);
}

// Логирование базы данных
function dbLogger(operation, data) {
    const message = typeof data === 'object' ? JSON.stringify(data) : String(data);
    writeToFile(`[DB] ${operation}: ${message}`);
    originalLog(`[DB] ${operation}:`, data);
}

// Очистка лог-файла
function clearLogs() {
    fs.writeFileSync(LOG_FILE, '');
    originalLog('[LOGGER] Логи очищены');
}

// Получение логов
function getLogs(lines = 100) {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const allLines = content.split('\n').filter(l => l.trim());
    return allLines.slice(-lines);
}

module.exports = {
    requestLogger,
    wsLogger,
    dbLogger,
    clearLogs,
    getLogs,
    LOG_FILE
};
