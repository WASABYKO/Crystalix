/**
 * CallRoom.js - UI компонент для страницы видеозвонка
 * Управляет отображением видео-потоков, элементов управления и состояния звонка
 */

class CallRoom {
    constructor(options = {}) {
        // Настройки по умолчанию
        this.options = {
            remoteStream: options.remoteStream || null,
            localStream: options.localStream || null,
            callerName: options.callerName || 'Неизвестный',
            callerAvatar: options.callerAvatar || null,
            onEndCall: options.onEndCall || (() => {}),
            onToggleMic: options.onToggleMic || (() => {}),
            onToggleCamera: options.onToggleCamera || (() => {}),
            isAudioMuted: options.isAudioMuted || false,
            isVideoMuted: options.isVideoMuted || false,
            isConnected: options.isConnected || false
        };

        // Состояние звонка
        this.state = {
            startTime: null,
            timerInterval: null,
            isPanelVisible: true,
            panelTimeout: null,
            mouseMoving: false
        };

        // Ссылки на DOM элементы
        this.elements = {};

        this.init();
    }

    /**
     * Инициализация компонента
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        this.setupUI();
        this.startPanelAutoHide();
    }

    /**
     * Кэширование DOM элементов
     */
    cacheElements() {
        this.elements = {
            // Контейнеры видео
            callRoom: document.getElementById('callRoom'),
            remoteVideo: document.getElementById('remoteVideo'),
            localVideo: document.getElementById('localVideo'),

            // Заглушки
            remotePlaceholder: document.getElementById('remotePlaceholder'),
            avatarInitial: document.getElementById('avatarInitial'),
            remoteName: document.getElementById('remoteName'),
            remoteNameDisplay: document.getElementById('remoteNameDisplay'),

            // Информация
            connectionStatus: document.getElementById('connectionStatus'),
            callTimer: document.getElementById('callTimer'),

            // Индикаторы
            remoteVideoOffIndicator: document.getElementById('remoteVideoOffIndicator'),
            localAudioOffIndicator: document.getElementById('localAudioOffIndicator'),
            localVideoOffIndicator: document.getElementById('localVideoOffIndicator'),

            // Кнопки управления
            micBtn: document.getElementById('micBtn'),
            cameraBtn: document.getElementById('cameraBtn'),
            endCallBtn: document.getElementById('endCallBtn'),

            // Лоадер
            callLoader: document.getElementById('callLoader')
        };
    }

    /**
     * Привязка событий
     */
    bindEvents() {
        // Кнопки управления
        if (this.elements.micBtn) {
            this.elements.micBtn.addEventListener('click', () => this.toggleMicrophone());
        }
        if (this.elements.cameraBtn) {
            this.elements.cameraBtn.addEventListener('click', () => this.toggleCamera());
        }
        if (this.elements.endCallBtn) {
            this.elements.endCallBtn.addEventListener('click', () => this.endCall());
        }

        // Управление видимостью панели
        if (this.elements.callRoom) {
            this.elements.callRoom.addEventListener('mousemove', () => this.onMouseMove());
            this.elements.callRoom.addEventListener('click', () => this.showPanelTemporarily());
        }

        // Клавиатурные shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));

        // Проблемы с видео
        if (this.elements.remoteVideo) {
            this.elements.remoteVideo.addEventListener('error', () => this.handleVideoError());
        }

        // Слушаем обновления потоков от CallManager
        this.bindCallManagerEvents();
    }

    /**
     * Привязка событий CallManager
     */
    bindCallManagerEvents() {
        // Слушаем обновление локального потока
        window.addEventListener('callLocalStreamUpdate', (e) => {
            if (e.detail && e.detail.stream && this.elements.localVideo) {
                this.elements.localVideo.srcObject = e.detail.stream;
                this.playVideo(this.elements.localVideo);
            }
        });

        // Слушаем обновление удалённого потока
        window.addEventListener('callRemoteStreamUpdate', (e) => {
            if (e.detail && e.detail.stream && this.elements.remoteVideo) {
                this.elements.remoteVideo.srcObject = e.detail.stream;
                this.playVideo(this.elements.remoteVideo);
                this.hideRemotePlaceholder();
            }
        });

        // Слушаем изменение состояния соединения
        window.addEventListener('callStateChange', (e) => {
            if (e.detail && (e.detail.currentState === 'ACTIVE' || e.detail.state === 'ACTIVE')) {
                this.updateConnectionStatus(true);
                this.startTimer();
            }
        });
    }

    /**
     * Настройка UI
     */
    setupUI() {
        this.updateCallerInfo();
        this.updateConnectionStatus(this.options.isConnected);
        this.updateMuteState();
        this.attachStreams();
        this.showLoader(!this.options.isConnected);
    }

    /**
     * Обновление информации о собеседнике
     */
    updateCallerInfo() {
        const name = this.options.callerName;

        // Обновляем имя в заглушке и в информации
        if (this.elements.remoteName) {
            this.elements.remoteName.textContent = name;
        }
        if (this.elements.remoteNameDisplay) {
            this.elements.remoteNameDisplay.textContent = name;
        }

        // Обновляем инициалы аватарки
        if (this.elements.avatarInitial) {
            const initials = this.getInitials(name);
            this.elements.avatarInitial.textContent = initials;
        }
    }

    /**
     * Получение инициалов из имени
     */
    getInitials(name) {
        return name
            .split(' ')
            .map(part => part.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    /**
     * Прикрепление медиа-потоков к видео элементам
     */
    attachStreams() {
        // Локальный поток
        if (this.options.localStream && this.elements.localVideo) {
            this.elements.localVideo.srcObject = this.options.localStream;
            this.playVideo(this.elements.localVideo);
        }

        // Удаленный поток
        if (this.options.remoteStream && this.elements.remoteVideo) {
            this.elements.remoteVideo.srcObject = this.options.remoteStream;
            this.elements.remoteVideo.onloadedmetadata = () => {
                this.playVideo(this.elements.remoteVideo);
                this.hideRemotePlaceholder();
            };
        }
    }

    /**
     * Воспроизведение видео с обработкой ошибок
     */
    playVideo(videoElement) {
        if (!videoElement) return;
        
        const playPromise = videoElement.play();
        
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn('[CallRoom] Автовоспроизведение заблокировано:', error);
                // Показываем кнопку для ручного запуска
                this.showPlayButton(videoElement);
            });
        }
    }

    /**
     * Показ кнопки для ручного запуска видео
     */
    showPlayButton(videoElement) {
        if (!videoElement) return;
        
        // Создаём overlay с кнопкой
        let overlay = videoElement.parentElement?.querySelector('.video-play-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'video-play-overlay';
            overlay.innerHTML = `
                <button class="play-btn">
                    <i class="fas fa-play"></i>
                </button>
                <p>Нажмите для воспроизведения видео</p>
            `;
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.5);
                z-index: 100;
            `;
            videoElement.parentElement?.appendChild(overlay);
            
            overlay.querySelector('.play-btn').addEventListener('click', () => {
                videoElement.play();
                overlay.remove();
            });
        }
    }

    /**
     * Скрытие заглушки удаленного видео
     */
    hideRemotePlaceholder() {
        if (this.elements.remotePlaceholder) {
            this.elements.remotePlaceholder.classList.add('hidden');
        }
    }

    /**
     * Показ заглушки удаленного видео
     */
    showRemotePlaceholder() {
        if (this.elements.remotePlaceholder) {
            this.elements.remotePlaceholder.classList.remove('hidden');
        }
    }

    /**
     * Обновление статуса соединения
     */
    updateConnectionStatus(connected) {
        if (!this.elements.connectionStatus) return;

        const statusText = this.elements.connectionStatus.querySelector('span');
        const statusIcon = this.elements.connectionStatus.querySelector('i');

        if (connected) {
            this.elements.connectionStatus.classList.add('connected');
            this.elements.connectionStatus.classList.remove('disconnected');
            if (statusText) statusText.textContent = 'Звонок идет';
            if (statusIcon) {
                statusIcon.className = 'fas fa-wifi';
            }
            this.hideLoader();
        } else {
            this.elements.connectionStatus.classList.remove('connected');
            this.elements.connectionStatus.classList.add('disconnected');
            if (statusText) statusText.textContent = 'Подключение...';
            if (statusIcon) {
                statusIcon.className = 'fas fa-spinner fa-spin';
            }
            this.showLoader(true);
        }
    }

    /**
     * Обновление состояния mute
     */
    updateMuteState() {
        // Микрофон
        if (this.elements.micBtn) {
            if (this.options.isAudioMuted) {
                this.elements.micBtn.classList.add('muted');
                this.elements.micBtn.classList.remove('active');
            } else {
                this.elements.micBtn.classList.remove('muted');
                this.elements.micBtn.classList.add('active');
            }
        }

        // Камера
        if (this.elements.cameraBtn) {
            if (this.options.isVideoMuted) {
                this.elements.cameraBtn.classList.add('muted');
                this.elements.cameraBtn.classList.remove('active');
            } else {
                this.elements.cameraBtn.classList.remove('muted');
                this.elements.cameraBtn.classList.add('active');
            }
        }

        // Индикаторы на локальном видео
        if (this.elements.localAudioOffIndicator) {
            this.elements.localAudioOffIndicator.classList.toggle('hidden', !this.options.isAudioMuted);
        }
        if (this.elements.localVideoOffIndicator) {
            this.elements.localVideoOffIndicator.classList.toggle('hidden', !this.options.isVideoMuted);
        }
    }

    /**
     * Переключение микрофона
     */
    toggleMicrophone() {
        this.options.isAudioMuted = !this.options.isAudioMuted;
        this.updateMuteState();

        if (this.options.onToggleMic) {
            this.options.onToggleMic(this.options.isAudioMuted);
        }

        this.showPanelTemporarily();
    }

    /**
     * Переключение камеры
     */
    toggleCamera() {
        this.options.isVideoMuted = !this.options.isVideoMuted;
        this.updateMuteState();

        // Показываем/скрываем локальное видео
        if (this.elements.localVideo) {
            this.elements.localVideo.style.opacity = this.options.isVideoMuted ? '0' : '1';
        }

        if (this.options.onToggleCamera) {
            this.options.onToggleCamera(this.options.isVideoMuted);
        }

        this.showPanelTemporarily();
    }

    /**
     * Завершение звонка
     */
    endCall() {
        this.cleanup();
        if (this.options.onEndCall) {
            this.options.onEndCall();
        }
    }

    /**
     * Запуск таймера звонка
     */
    startTimer() {
        this.state.startTime = Date.now();
        this.state.timerInterval = setInterval(() => this.updateTimer(), 1000);
    }

    /**
     * Обновление таймера
     */
    updateTimer() {
        if (!this.state.startTime || !this.elements.callTimer) return;

        const elapsed = Math.floor((Date.now() - this.state.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');

        this.elements.callTimer.textContent = `${minutes}:${seconds}`;
    }

    /**
     * Остановка таймера
     */
    stopTimer() {
        if (this.state.timerInterval) {
            clearInterval(this.state.timerInterval);
            this.state.timerInterval = null;
        }
    }

    /**
     * Показ/скрытие лоадера
     */
    showLoader(show) {
        if (this.elements.callLoader) {
            this.elements.callLoader.classList.toggle('hidden', !show);
        }
    }

    hideLoader() {
        this.showLoader(false);
    }

    /**
     * Автоматическое скрытие панели управления
     */
    startPanelAutoHide() {
        this.resetPanelTimeout();
    }

    resetPanelTimeout() {
        if (this.state.panelTimeout) {
            clearTimeout(this.state.panelTimeout);
        }

        this.state.panelTimeout = setTimeout(() => {
            this.hidePanel();
        }, 3000);
    }

    showPanelTemporarily() {
        this.showPanel();
        this.resetPanelTimeout();
    }

    showPanel() {
        this.state.isPanelVisible = true;
        if (this.elements.controlPanel) {
            this.elements.controlPanel.classList.remove('hiding');
        }
    }

    hidePanel() {
        this.state.isPanelVisible = false;
        if (this.elements.controlPanel) {
            this.elements.controlPanel.classList.add('hiding');
        }
    }

    /**
     * Обработчик движения мыши
     */
    onMouseMove() {
        this.showPanelTemporarily();
    }

    /**
     * Обработка нажатий клавиш
     */
    handleKeyPress(e) {
        switch (e.key.toLowerCase()) {
            case 'm':
                this.toggleMicrophone();
                break;
            case 'v':
                this.toggleCamera();
                break;
            case 'escape':
            case 'q':
                this.endCall();
                break;
        }
    }

    /**
     * Обработка ошибок видео
     */
    handleVideoError() {
        if (this.elements.callRoom) {
            this.elements.callRoom.classList.add('video-error');
        }
        this.showRemotePlaceholder();
    }

    /**
     * Очистка ресурсов
     */
    cleanup() {
        // Остановка таймера
        this.stopTimer();

        // Остановка видео-потоков
        this.stopMediaTracks(this.options.localStream);
        this.stopMediaTracks(this.options.remoteStream);

        // Очистка timeout
        if (this.state.panelTimeout) {
            clearTimeout(this.state.panelTimeout);
        }

        // Удаление обработчиков событий
        document.removeEventListener('keydown', (e) => this.handleKeyPress(e));
    }

    /**
     * Остановка медиа-треков
     */
    stopMediaTracks(stream) {
        if (stream && stream.getTracks) {
            stream.getTracks().forEach(track => {
                track.stop();
            });
        }
    }

    /**
     * Обновление потоков (для внешних обновлений)
     */
    updateStreams(localStream, remoteStream) {
        this.options.localStream = localStream;
        this.options.remoteStream = remoteStream;
        this.attachStreams();
    }

    /**
     * Переход в полноэкранный режим
     */
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            this.elements.callRoom?.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Получение текущего состояния
     */
    getState() {
        return {
            isAudioMuted: this.options.isAudioMuted,
            isVideoMuted: this.options.isVideoMuted,
            isConnected: this.options.isConnected,
            callDuration: this.state.startTime
                ? Math.floor((Date.now() - this.state.startTime) / 1000)
                : 0
        };
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    // Проверяем наличие необходимых данных
    const urlParams = new URLSearchParams(window.location.search);
    const callId = urlParams.get('callId');
    const peerId = urlParams.get('peerId');

    // Ждём готовности CallManager
    const waitForCallManager = () => {
        if (window.CallManager) {
            initializeCallRoom();
        } else {
            setTimeout(waitForCallManager, 100);
        }
    };
    
    const initializeCallRoom = () => {
        const callManager = window.CallManager;
        
        // Получаем данные из CallManager
        const localStream = callManager.localStream || null;
        const remoteStream = callManager.remoteStream || null;
        const callerName = callManager.callPartner?.name || 'Собеседник';
        const isConnected = callManager.callState === 'ACTIVE';
        
        console.log('[CallRoom] Инициализация:', {
            hasLocalStream: !!localStream,
            localStreamActive: localStream?.active,
            hasRemoteStream: !!remoteStream,
            callState: callManager.callState
        });
        
        // Опции для CallRoom
        const callRoomOptions = {
            localStream,
            remoteStream,
            callerName,
            isConnected,
            onEndCall: () => {
                callManager.endCall();
                window.location.href = 'messages.html';
            },
            onToggleMic: (muted) => {
                console.log('Микрофон:', muted ? 'выключен' : 'включен');
                callManager.toggleMute();
            },
            onToggleCamera: () => {
                console.log('Камера переключена');
                callManager.toggleCamera();
            }
        };

        // Создаем экземпляр CallRoom
        window.callRoom = new CallRoom(callRoomOptions);

        // Если есть удалённый поток, сразу показываем соединение
        if (remoteStream) {
            window.callRoom.updateConnectionStatus(true);
            window.callRoom.startTimer();
        }
        
        // Всегда пробуем привязать локальный поток после создания
        const attachLocalVideo = () => {
            if (callManager.localStream && window.callRoom.elements.localVideo) {
                window.callRoom.elements.localVideo.srcObject = callManager.localStream;
                window.callRoom.playVideo(window.callRoom.elements.localVideo);
                console.log('[CallRoom] Локальное видео привязано');
            }
        };
        
        if (localStream && localStream.active) {
            // Поток уже готов
            attachLocalVideo();
        } else {
            // Ждём пока поток станет активным
            let attempts = 0;
            const checkStream = () => {
                attempts++;
                if (callManager.localStream && callManager.localStream.active) {
                    window.callRoom.options.localStream = callManager.localStream;
                    attachLocalVideo();
                } else if (attempts < 50) {
                    setTimeout(checkStream, 100);
                } else {
                    console.warn('[CallRoom] Поток не стал активным после 5 секунд');
                }
            };
            setTimeout(checkStream, 100);
        }
    };
    
    // Начинаем ожидание
    waitForCallManager();
});

// Экспорт для использования в других модулях
window.CallRoom = CallRoom;
