/**
 * CallNotification Component
 * Компонент уведомлений о входящих звонках
 */

class CallNotification {
    constructor() {
        this.notification = null;
        this.ringtone = null;
    }
    
    /**
     * Показать уведомление о входящем звонке
     */
    show(callerData) {
        // Создаём уведомление если его нет
        if (!this.notification) {
            this.notification = this.createNotificationElement();
            document.body.appendChild(this.notification);
        }
        
        // Заполняем данные
        const avatar = this.notification.querySelector('.call-notification-avatar');
        const name = this.notification.querySelector('.call-notification-name');
        const text = this.notification.querySelector('.call-notification-text');
        
        if (avatar) {
            avatar.innerHTML = `<span class="avatar-initials">${this.getInitials(callerData.name)}</span>`;
            avatar.className = 'call-notification-avatar chat-avatar ' + this.getAvatarGradient(callerData.id);
        }
        
        if (name) name.textContent = callerData.name || 'Неизвестный';
        if (text) text.textContent = callerData.isVideo ? 'Видеозвонок' : 'Голосовой звонок';
        
        // Показываем уведомление
        this.notification.classList.add('active');
        
        // Воспроизводим звук
        this.playRingtone();
        
        // Вибрация на мобильных
        this.vibrate();
        
        // Автоматически скрываем через 30 секунд (timeout)
        this.hideTimeout = setTimeout(() => {
            this.hide();
        }, 30000);
    }
    
    /**
     * Скрыть уведомление
     */
    hide() {
        if (this.notification) {
            this.notification.classList.remove('active');
            this.notification.classList.add('hiding');
            
            setTimeout(() => {
                this.notification.classList.remove('hiding');
            }, 300);
        }
        
        this.stopRingtone();
        
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }
    
    /**
     * Воспроизвести рингтон
     */
    playRingtone() {
        try {
            // Создаём AudioContext для воспроизведения
            this.ringtoneAudio = new (window.AudioContext || window.webkitAudioContext)();
            
            // Создаём осциллятор для звука
            this.oscillator = this.ringtoneAudio.createOscillator();
            this.gainNode = this.ringtoneAudio.createGain();
            
            this.oscillator.connect(this.gainNode);
            this.gainNode.connect(this.ringtoneAudio.destination);
            
            this.oscillator.frequency.value = 440; // A4
            this.oscillator.type = 'sine';
            
            this.gainNode.gain.value = 0.1;
            
            this.oscillator.start();
            
            // Создаём рингтон паттерн
            this.ringtonePattern = setInterval(() => {
                if (this.oscillator) {
                    this.oscillator.frequency.value = 
                        this.oscillator.frequency.value === 440 ? 520 : 440;
                }
            }, 500);
            
        } catch (e) {
            console.log('[CallNotification] Не удалось воспроизвести рингтон:', e);
        }
    }
    
    /**
     * Остановить рингтон
     */
    stopRingtone() {
        if (this.ringtonePattern) {
            clearInterval(this.ringtonePattern);
            this.ringtonePattern = null;
        }
        
        if (this.oscillator) {
            try {
                this.oscillator.stop();
            } catch (e) {}
            this.oscillator = null;
        }
        
        if (this.ringtoneAudio) {
            try {
                this.ringtoneAudio.close();
            } catch (e) {}
            this.ringtoneAudio = null;
        }
    }
    
    /**
     * Вибрация
     */
    vibrate() {
        if (navigator.vibrate) {
            navigator.vibrate([500, 200, 500, 200, 500]);
        }
    }
    
    /**
     * Создать элемент уведомления
     */
    createNotificationElement() {
        const el = document.createElement('div');
        el.className = 'call-notification';
        el.innerHTML = `
            <div class="call-notification-avatar">
                <span class="avatar-initials">?</span>
            </div>
            <div class="call-notification-content">
                <div class="call-notification-name">Имя</div>
                <div class="call-notification-text">Звонок</div>
            </div>
            <div class="call-notification-actions">
                <button class="btn btn-success" id="acceptCallBtn">
                    <i class="fas fa-phone"></i>
                </button>
                <button class="btn btn-danger" id="rejectCallBtn">
                    <i class="fas fa-phone-slash"></i>
                </button>
            </div>
        `;
        
        // Привязываем события
        el.querySelector('#acceptCallBtn').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('acceptIncomingCall'));
            this.hide();
        });
        
        el.querySelector('#rejectCallBtn').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('rejectIncomingCall'));
            this.hide();
        });
        
        return el;
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
}

// Экспорт
window.CallNotification = new CallNotification();
