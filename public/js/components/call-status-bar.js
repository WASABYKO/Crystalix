/**
 * CallStatusBar Component
 * Компонент строки состояния активного звонка сверху экрана
 */

class CallStatusBar {
    constructor() {
        this.bar = null;
        this.timerInterval = null;
        this.callStartTime = null;
        this.init();
    }
    
    init() {
        this.createBar();
        this.bindEvents();
    }
    
    createBar() {
        // Проверяем, существует ли уже бар
        if (document.getElementById('callStatusBar')) {
            this.bar = document.getElementById('callStatusBar');
            return;
        }
        
        this.bar = document.createElement('div');
        this.bar.id = 'callStatusBar';
        this.bar.className = 'call-status-bar';
        this.bar.innerHTML = `
            <div class="call-status-bar-content">
                <div class="call-status-icon">
                    <i class="fas fa-phone-alt"></i>
                </div>
                <div class="call-status-info">
                    <div class="call-status-name" id="callStatusName">Звонок</div>
                    <div class="call-status-duration" id="callStatusDuration">00:00</div>
                </div>
                <div class="call-status-actions">
                    <button class="call-status-btn end-call-btn" id="callStatusEndBtn" title="Завершить звонок">
                        <i class="fas fa-phone-slash"></i>
                    </button>
                </div>
            </div>
            <div class="call-status-progress">
                <div class="call-status-progress-bar" id="callStatusProgress"></div>
            </div>
        `;
        
        // Добавляем стили
        this.addStyles();
        
        // Вставляем в начало body
        document.body.insertBefore(this.bar, document.body.firstChild);
        
        // Привязываем события
        this.bindBarEvents();
    }
    
    addStyles() {
        if (document.getElementById('callStatusBarStyles')) {
            return;
        }
        
        const style = document.createElement('style');
        style.id = 'callStatusBarStyles';
        style.textContent = `
            .call-status-bar {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                height: 56px;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
                z-index: 9999;
                transform: translateY(-100%);
                transition: transform 0.3s ease;
                font-family: inherit;
            }
            
            .call-status-bar.active {
                transform: translateY(0);
            }
            
            .call-status-bar-content {
                display: flex;
                align-items: center;
                height: 100%;
                padding: 0 20px;
                gap: 16px;
            }
            
            .call-status-icon {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                animation: callStatusPulse 1.5s ease-in-out infinite;
            }
            
            @keyframes callStatusPulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }
            
            .call-status-info {
                flex: 1;
                min-width: 0;
            }
            
            .call-status-name {
                font-size: 15px;
                font-weight: 600;
                color: white;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .call-status-duration {
                font-size: 13px;
                color: rgba(255, 255, 255, 0.8);
                display: flex;
                align-items: center;
                gap: 6px;
            }
            
            .call-status-duration::before {
                content: '•';
                animation: callStatusBlink 1s ease-in-out infinite;
            }
            
            @keyframes callStatusBlink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
            }
            
            .call-status-actions {
                display: flex;
                gap: 8px;
            }
            
            .call-status-btn {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                transition: all 0.2s ease;
            }
            
            .end-call-btn {
                background: rgba(239, 68, 68, 0.9);
                color: white;
            }
            
            .end-call-btn:hover {
                background: #dc2626;
                transform: scale(1.1);
            }
            
            .call-status-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: rgba(255, 255, 255, 0.2);
            }
            
            .call-status-progress-bar {
                height: 100%;
                background: rgba(255, 255, 255, 0.8);
                width: 0%;
                transition: width 1s linear;
            }
            
            /* Адаптивность */
            @media (max-width: 480px) {
                .call-status-bar {
                    height: 48px;
                }
                
                .call-status-bar-content {
                    padding: 0 12px;
                    gap: 12px;
                }
                
                .call-status-icon {
                    width: 32px;
                    height: 32px;
                    font-size: 14px;
                }
                
                .call-status-name {
                    font-size: 14px;
                }
                
                .call-status-duration {
                    font-size: 12px;
                }
                
                .call-status-btn {
                    width: 36px;
                    height: 36px;
                    font-size: 14px;
                }
            }
            
            /* Для мобильных устройств с notch */
            @supports (padding-top: env(safe-area-inset-top)) {
                .call-status-bar {
                    padding-top: env(safe-area-inset-top);
                    height: calc(56px + env(safe-area-inset-top));
                }
            }
        `;
        
        document.head.appendChild(style);
    }
    
    bindEvents() {
        // Слушаем события изменения состояния звонка
        window.addEventListener('callStateChange', (e) => {
            this.handleStateChange(e.detail);
        });
    }
    
    bindBarEvents() {
        const endBtn = this.bar.querySelector('#callStatusEndBtn');
        if (endBtn) {
            endBtn.addEventListener('click', () => {
                this.endCall();
            });
        }
    }
    
    handleStateChange(detail) {
        const { previousState, currentState } = detail;
        
        // Показываем бар при активном звонке
        if (currentState === 'ACTIVE' || currentState === 'CONNECTING' || currentState === 'RINGING') {
            this.show();
        } else {
            this.hide();
        }
        
        // Запускаем/останавливаем таймер
        if (currentState === 'ACTIVE') {
            this.startTimer();
        } else {
            this.stopTimer();
        }
    }
    
    show() {
        this.bar.classList.add('active');
        document.body.classList.add('call-status-bar-active');
    }
    
    hide() {
        this.bar.classList.remove('active');
        document.body.classList.remove('call-status-bar-active');
        this.stopTimer();
        this.resetDuration();
    }
    
    setPartnerName(name) {
        const nameEl = this.bar.querySelector('#callStatusName');
        if (nameEl) {
            nameEl.textContent = name || 'Звонок';
        }
    }
    
    startTimer() {
        this.callStartTime = Date.now();
        this.stopTimer(); // Останавливаем предыдущий таймер
        
        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
            this.updateDuration(elapsed);
            this.updateProgress(elapsed);
        }, 1000);
    }
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    updateDuration(seconds) {
        const durationEl = this.bar.querySelector('#callStatusDuration');
        if (durationEl) {
            durationEl.textContent = this.formatDuration(seconds);
        }
    }
    
    updateProgress(seconds) {
        const progressEl = this.bar.querySelector('#callStatusProgress');
        if (progressEl) {
            // Максимум 1 час для полосы прогресса
            const maxSeconds = 3600;
            const percent = Math.min((seconds / maxSeconds) * 100, 100);
            progressEl.style.width = percent + '%';
        }
    }
    
    resetDuration() {
        const durationEl = this.bar.querySelector('#callStatusDuration');
        if (durationEl) {
            durationEl.textContent = '00:00';
        }
        const progressEl = this.bar.querySelector('#callStatusProgress');
        if (progressEl) {
            progressEl.style.width = '0%';
        }
    }
    
    formatDuration(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    endCall() {
        // Отправляем событие для завершения звонка
        window.dispatchEvent(new CustomEvent('endCallFromStatusBar'));
        
        // Если есть CallManager, используем его
        if (window.CallManager) {
            window.CallManager.endCall();
        }
    }
    
    // Обновить имя звонящего/принимающего
    updatePartnerInfo(name, isOutgoing = true) {
        const nameEl = this.bar.querySelector('#callStatusName');
        if (nameEl) {
            if (isOutgoing) {
                nameEl.textContent = `Вызов: ${name || '...'}`;
            } else {
                nameEl.textContent = `Входящий от ${name || '...'}`;
            }
        }
    }
}

// Создаём глобальный экземпляр
window.CallStatusBar = new CallStatusBar();
