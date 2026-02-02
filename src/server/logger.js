// src/server/logger.js - Централизованное логирование (только в файл)
// В консоль логи НЕ выводятся для безопасности
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

// Логирование HTTP запросов
function requestLogger(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = `[HTTP] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`;
        writeToFile(log);
    });
    
    next();
}

// Логирование WebSocket
function wsLogger(type, data) {
    const message = typeof data === 'object' ? JSON.stringify(data) : String(data);
    writeToFile(`[WS] ${type}: ${message}`);
}

// Логирование базы данных
function dbLogger(operation, data) {
    const message = typeof data === 'object' ? JSON.stringify(data) : String(data);
    writeToFile(`[DB] ${operation}: ${message}`);
}

// Очистка лог-файла
function clearLogs() {
    fs.writeFileSync(LOG_FILE, '');
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
