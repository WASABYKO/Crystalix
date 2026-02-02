/**
 * CallHistory Component
 * Компонент истории звонков
 */

class CallHistory {
    constructor() {
        this.history = [];
        this.container = null;
    }
    
    /**
     * Получить историю звонков
     */
    getHistory() {
        try {
            return JSON.parse(localStorage.getItem('callHistory') || '[]');
        } catch (e) {
            return [];
        }
    }
    
    /**
     * Сохранить звонок в историю
     */
    addCall(callData) {
        this.history = this.getHistory();
        
        // Добавляем в начало
        this.history.unshift({
            ...callData,
            timestamp: callData.timestamp || Date.now()
        });
        
        // Ограничиваем 100 записями
        if (this.history.length > 100) {
            this.history.pop();
        }
        
        // Сохраняем
        localStorage.setItem('callHistory', JSON.stringify(this.history));
        
        // Уведомляем об обновлении
        window.dispatchEvent(new CustomEvent('callHistoryUpdate'));
        
        return this.history;
    }
    
    /**
     * Очистить историю
     */
    clearHistory() {
        localStorage.removeItem('callHistory');
        this.history = [];
        window.dispatchEvent(new CustomEvent('callHistoryUpdate'));
    }
    
    /**
     * Удалить запись из истории
     */
    removeCall(callId) {
        this.history = this.getHistory();
        this.history = this.history.filter(call => call.callId !== callId);
        localStorage.setItem('callHistory', JSON.stringify(this.history));
        window.dispatchEvent(new CustomEvent('callHistoryUpdate'));
    }
    
    /**
     * Получить иконку типа звонка
     */
    getCallIcon(type, status) {
        if (status === 'MISSED') return '📞'; // Пропущенный
        if (status === 'DECLINED') return '❌'; // Отклоненный
        if (type === 'video') return '📹'; // Видео
        return '📞'; // Голосовой
    }
    
    /**
     * Форматировать длительность
     */
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins > 0) {
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
        return `0:${secs.toString().padStart(2, '0')}`;
    }
    
    /**
     * Форматировать время
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (date.toDateString() === now.toDateString()) {
            return 'Сегодня ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Вчера ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        
        return date.toLocaleDateString('ru-RU', { 
            day: 'numeric', 
            month: 'short',
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    /**
     * Получить класс для статуса
     */
    getStatusClass(status, direction) {
        if (status === 'MISSED') return 'missed';
        if (status === 'DECLINED') return 'declined';
        if (direction === 'outgoing') return 'outgoing';
        return 'incoming';
    }
    
    /**
     * Создать элемент истории звонков
     */
    createHistoryItem(call) {
        const item = document.createElement('div');
        item.className = `call-history-item ${this.getStatusClass(call.status, call.direction)}`;
        item.dataset.callId = call.callId;
        
        const icon = this.getCallIcon(call.type, call.status);
        const duration = call.duration > 0 ? this.formatDuration(call.duration) : '';
        const time = this.formatTime(call.timestamp);
        
        item.innerHTML = `
            <div class="call-history-avatar chat-avatar ${this.getAvatarGradient(call.partnerId)}">
                <span class="avatar-initials">${this.getInitials(call.partnerName)}</span>
            </div>
            <div class="call-history-info">
                <div class="call-history-name">${this.escapeHtml(call.partnerName || 'Unknown')}</div>
                <div class="call-history-meta">
                    <span class="call-history-icon">${icon}</span>
                    ${duration ? `<span class="call-history-duration">${duration}</span>` : ''}
                    <span class="call-history-time">${time}</span>
                </div>
            </div>
            <div class="call-history-actions">
                <button class="btn-icon call-back-btn" title="Позвонить снова">
                    <i class="fas fa-phone"></i>
                </button>
                <button class="btn-icon call-delete-btn" title="Удалить">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        // Привязываем события
        item.querySelector('.call-back-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.callBack(call.partnerId, call.type === 'video');
        });
        
        item.querySelector('.call-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeCall(call.callId);
            item.remove();
        });
        
        return item;
    }
    
    /**
     * Позвонить снова
     */
    callBack(userId, isVideo) {
        if (typeof CallManager !== 'undefined') {
            CallManager.startCall(userId, isVideo);
        }
    }
    
    /**
     * Отобразить историю в контейнере
     */
    render(container) {
        this.container = container;
        this.history = this.getHistory();
        
        if (this.history.length === 0) {
            container.innerHTML = `
                <div class="empty-state-small">
                    <i class="fas fa-phone-history"></i>
                    <p>История звонков пуста</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = '';
        
        this.history.forEach(call => {
            container.appendChild(this.createHistoryItem(call));
        });
    }
    
    /**
     * Получить инициалы
     */
    getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
    }
    
    /**
     * Получить градиент для аватарки
     */
    getAvatarGradient(id) {
        if (!id) return 'avatar-gradient-1';
        const gradients = [
            'avatar-gradient-1', 'avatar-gradient-2', 'avatar-gradient-3',
            'avatar-gradient-4', 'avatar-gradient-5', 'avatar-gradient-6'
        ];
        const index = id.charCodeAt(id.length - 1) % gradients.length;
        return gradients[index];
    }
    
    /**
     * Экранировать HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Экспорт
window.CallHistory = new CallHistory();
