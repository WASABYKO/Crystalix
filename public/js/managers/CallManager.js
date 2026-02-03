/**
 * ==========================================
 * CALL MANAGER - Управление звонками (WebRTC)
 * ==========================================
 */

class CallManager {
    constructor() {
        this.wsManager = null;
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.callState = 'IDLE';
        this.currentCallId = null;
        this.currentUser = null;
        this.callPartner = null;
        this.callStartTime = null;
        this.callTimer = null;
        this.callDuration = 0;
        this.isVideo = false;
        this.isMuted = false;
        this.isCameraOff = false;
        this.queuedIceCandidates = []; // Буфер для ICE кандидатов
        this.ringtoneContext = null; // AudioContext для рингтона
        this.pendingOffer = null; // Сохраняем оффер для входящего звонка
        
        // ICE servers configuration
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        this.init();
    }
    
    init() {
        // Получаем WebSocketManager
        if (window.WebSocketManager) {
            this.wsManager = window.WebSocketManager;
        }
        
        // Инициализируем строку состояния звонка
        this.initCallStatusBar();
        
        // Подписываемся на события WebSocket
        this.bindWebSocketEvents();
    }
    
    initCallStatusBar() {
        // Ждём загрузки CallStatusBar
        const checkStatusBar = () => {
            if (window.CallStatusBar) {
                // Слушаем событие завершения звонка из строки состояния
                window.addEventListener('endCallFromStatusBar', () => {
                    this.endCall();
                });
            } else {
                setTimeout(checkStatusBar, 100);
            }
        };
        setTimeout(checkStatusBar, 100);
    }
    
    bindWebSocketEvents() {
        if (!this.wsManager) {
            // Пытаемся получить WebSocketManager позже
            this.waitForWebSocketManager();
            return;
        }
        
        this.wsManager.on('CALL_OFFER', (data) => this.handleIncomingOffer(data));
        this.wsManager.on('CALL_ANSWER', (data) => this.handleAnswer(data));
        this.wsManager.on('CALL_ICE_CANDIDATE', (data) => this.handleIceCandidate(data));
        this.wsManager.on('CALL_REJECT', (data) => this.handleReject(data));
        this.wsManager.on('CALL_END', (data) => this.handleCallEnd(data));
        this.wsManager.on('CALL_TIMEOUT', (data) => this.handleTimeout(data));
    }
    
    waitForWebSocketManager(maxAttempts = 50) {
        let attempts = 0;
        const check = () => {
            attempts++;
            if (window.WebSocketManager) {
                this.wsManager = window.WebSocketManager;
                this.bindWebSocketEvents();
            } else if (attempts < maxAttempts) {
                setTimeout(check, 100);
            }
        };
        setTimeout(check, 100);
    }
    
    // ============ УПРАВЛЕНИЕ СОСТОЯНИЕМ ============
    
    setCallState(state) {
        const previousState = this.callState;
        this.callState = state;
        
        // Обновляем UI
        this.updateCallUI(state);
        
        // Уведомляем подписчиков
        window.dispatchEvent(new CustomEvent('callStateChange', {
            detail: { previousState, currentState: state }
        }));
    }
    
    updateCallUI(state) {
        const videoCallModal = document.getElementById('videoCallModal');
        const incomingCallModal = document.getElementById('incomingCallModal');
        const callStatus = document.getElementById('callStatus');
        
        // Обновляем строку состояния звонка
        this.updateCallStatusBar(state);
        
        switch (state) {
            case 'INCOMING':
                if (incomingCallModal) incomingCallModal.classList.add('active');
                break;
            case 'CONNECTING':
            case 'RINGING':
                if (videoCallModal) {
                    videoCallModal.classList.add('active');
                    this.showConnectingState();
                }
                break;
            case 'ACTIVE':
                if (videoCallModal) {
                    videoCallModal.classList.add('active');
                    this.showActiveCallState();
                }
                if (incomingCallModal) incomingCallModal.classList.remove('active');
                break;
            case 'ENDING':
            case 'FAILED':
            case 'IDLE':
                this.closeAllCallModals();
                break;
        }
    }
    
    // ============ УПРАВЛЕНИЕ СТРОКОЙ СОСТОЯНИЯ ЗВОНКА ============
    
    updateCallStatusBar(state) {
        if (!window.CallStatusBar) return;
        
        const partnerName = this.callPartner?.name || 'Пользователь';
        
        switch (state) {
            case 'INCOMING':
                window.CallStatusBar.updatePartnerInfo(partnerName, false);
                window.CallStatusBar.show();
                break;
            case 'CONNECTING':
            case 'RINGING':
                window.CallStatusBar.updatePartnerInfo(partnerName, true);
                window.CallStatusBar.show();
                break;
            case 'ACTIVE':
                window.CallStatusBar.updatePartnerInfo(partnerName, this.callPartner?.isOutgoing !== false);
                window.CallStatusBar.show();
                break;
            case 'ENDING':
            case 'FAILED':
            case 'IDLE':
                window.CallStatusBar.hide();
                break;
        }
    }
    
    closeAllCallModals() {
        const videoCallModal = document.getElementById('videoCallModal');
        const incomingCallModal = document.getElementById('incomingCallModal');
        
        if (videoCallModal) videoCallModal.classList.remove('active');
        if (incomingCallModal) incomingCallModal.classList.remove('active');
        
        // Останавливаем локальный поток
        this.stopLocalStream();
        
        // Закрываем соединение
        this.closePeerConnection();
        
        // Очищаем таймер
        this.stopCallTimer();
    }
    
    // ============ ИНИЦИАЦИЯ ЗВОНКА ============
    
    async startCall(userId, isVideo = false) {
        if (this.callState !== 'IDLE') {
            return;
        }
        
        this.isVideo = isVideo;
        this.currentCallId = 'call_' + Date.now();
        this.callPartner = { id: userId };
        
        try {
            // Получаем медиапоток
            this.localStream = await this.getMediaStream(isVideo);
            
            // Устанавливаем состояние
            this.setCallState('CONNECTING');
            
            // Создаём RTCPeerConnection
            this.createPeerConnection();
            
            // Добавляем локальный трек
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            // Создаём оффер
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            // Отправляем через WebSocket
            this.sendCallOffer(offer);
            
            // Запускаем таймер ожидания
            this.startCallTimeout();
            
        } catch (error) {
            this.handleCallError(error);
        }
    }
    
    async getMediaStream(isVideo) {
        const constraints = isVideo ? {
            audio: true,
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            }
        } : {
            audio: true,
            video: false
        };
        
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
            throw error;
        }
    }
    
    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Обработка ICE кандидатов
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendIceCandidate(event.candidate);
            }
        };
        
        // Обработка удалённого потока
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            this.attachRemoteStream();
        };
        
        // Обработка изменений состояния соединения
        this.peerConnection.onconnectionstatechange = () => {
            if (this.peerConnection.connectionState === 'disconnected' ||
                this.peerConnection.connectionState === 'failed') {
                this.handleConnectionLost();
            }
        };
        
        // Обработка ICE состояния
        this.peerConnection.oniceconnectionstatechange = () => {
            // ICE состояние изменено
        };
        
        // Применяем буферизованные ICE кандидаты
        if (this.queuedIceCandidates.length > 0) {
            this.queuedIceCandidates.forEach(async (candidate) => {
                try {
                    await this.peerConnection.addIceCandidate(candidate);
                } catch (error) {
                    // Игнорируем ошибку
                }
            });
            this.queuedIceCandidates = [];
        }
    }
    
    // ============ ВХОДЯЩИЙ ЗВОНОК ============
    
    async handleIncomingOffer(data) {
        if (this.callState !== 'IDLE') {
            // Заняты, отклоняем звонок
            this.sendReject(data.callId, 'BUSY');
            return;
        }
        
        this.currentCallId = data.callId;
        this.callPartner = { id: data.from, name: data.fromName };
        this.isVideo = data.isVideo;
        this.pendingOffer = data.offer;
        
        // Показываем уведомление о входящем звонке
        this.showIncomingCallNotification(data);
        
        // Воспроизводим звук
        this.playRingtone();
        
        // Запускаем вибрацию на мобильных
        this.vibrateDevice();
    }
    
    showIncomingCallNotification(data) {
        let modal = document.getElementById('incomingCallModal');
        
        if (!modal) {
            modal = this.createIncomingCallModal();
            document.body.appendChild(modal);
        }
        
        // Заполняем информацию
        const callerName = modal.querySelector('#incomingCallerName');
        const callerAvatar = modal.querySelector('#incomingCallerAvatar');
        const callType = modal.querySelector('#incomingCallType');
        
        if (callerName) callerName.textContent = data.fromName || 'Пользователь';
        if (callType) callType.textContent = data.isVideo ? '📹 Видеозвонок' : '📞 Голосовой звонок';
        
        // Аватарка
        if (callerAvatar) {
            const initials = this.getInitials(data.fromName || 'U');
            callerAvatar.innerHTML = `<span class="avatar-initials">${initials}</span>`;
            callerAvatar.className = 'chat-avatar ' + this.getAvatarGradient(data.from);
        }
        
        // Показываем модальное окно
        modal.classList.add('active');
        this.setCallState('INCOMING');
    }
    
    createIncomingCallModal() {
        const modal = document.createElement('div');
        modal.id = 'incomingCallModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content incoming-call-modal">
                <div class="incoming-call-content">
                    <div class="incoming-call-avatar" id="incomingCallerAvatar">
                        <span class="avatar-initials">?</span>
                    </div>
                    <h3 id="incomingCallerName">Пользователь</h3>
                    <p id="incomingCallType">📞 Звонок</p>
                    <div class="incoming-call-actions">
                        <button class="btn btn-success btn-lg" id="acceptCallBtn">
                            <i class="fas fa-phone"></i>
                        </button>
                        <button class="btn btn-danger btn-lg" id="rejectCallBtn">
                            <i class="fas fa-phone-slash"></i>
                        </button>
                    </div>
                    <button class="btn btn-outline btn-block" id="rejectWithMessageBtn">
                        Отклонить с сообщением
                    </button>
                </div>
            </div>
        `;
        
        // Привязываем события
        modal.querySelector('#acceptCallBtn').addEventListener('click', () => this.acceptCall());
        modal.querySelector('#rejectCallBtn').addEventListener('click', () => this.rejectCall());
        modal.querySelector('#rejectWithMessageBtn').addEventListener('click', () => this.rejectWithMessage());
        
        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.rejectCall();
        });
        
        return modal;
    }
    
    // ============ ПРИЁМ/ОТКЛОНЕНИЕ ЗВОНКА ============
    
    async acceptCall() {
        try {
            // Получаем медиапоток
            this.localStream = await this.getMediaStream(this.isVideo);
            
            // Создаём соединение
            this.createPeerConnection();
            
            // Устанавливаем удалённое описание (полученный оффер)
            if (this.pendingOffer) {
                await this.peerConnection.setRemoteDescription(this.pendingOffer);
                this.pendingOffer = null;
            }
            
            // Добавляем локальный трек
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            // Скрываем уведомление
            const modal = document.getElementById('incomingCallModal');
            if (modal) modal.classList.remove('active');
            
            // Останавливаем рингтон
            this.stopRingtone();
            
            // Показываем модальное окно звонка
            const videoCallModal = document.getElementById('videoCallModal');
            if (videoCallModal) {
                videoCallModal.classList.add('active');
            }
            
            this.setCallState('CONNECTING');
            
            // Создаём и отправляем ответ (CALL_ANSWER)
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.sendCallAnswer(answer);
            
        } catch (error) {
            this.rejectCall();
        }
    }
    
    async rejectCall(reason = 'DECLINED') {
        // Останавливаем рингтон
        this.stopRingtone();
        
        // Скрываем модальное окно
        const modal = document.getElementById('incomingCallModal');
        if (modal) modal.classList.remove('active');
        
        // Отправляем отказ
        this.sendReject(this.currentCallId, reason);
        
        // Сбрасываем состояние
        this.setCallState('IDLE');
    }
    
    async rejectWithMessage() {
        this.rejectCall('DECLINED_WITH_MESSAGE');
    }
    
    // ============ ОБРАБОТКА СИГНАЛИЗАЦИИ ============
    
    async handleAnswer(data) {
        if (data.callId !== this.currentCallId) return;
        
        // Если peerConnection ещё не создан, пропускаем
        if (!this.peerConnection) {
            return;
        }
        
        try {
            await this.peerConnection.setRemoteDescription(data.answer);
            
            this.setCallState('ACTIVE');
            this.startCallTimer();
            
        } catch (error) {
            // Игнорируем ошибку
        }
    }
    
    async handleIceCandidate(data) {
        if (data.callId !== this.currentCallId) return;
        
        // Если peerConnection ещё не создан, буферизируем кандидата
        if (!this.peerConnection) {
            this.queuedIceCandidates.push(data.candidate);
            return;
        }
        
        try {
            await this.peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            // Игнорируем ошибку
        }
    }
    
    handleReject(data) {
        if (data.callId !== this.currentCallId) return;
        
        this.stopRingtone();
        this.closeAllCallModals();
        
        let message = 'Звонок отклонён';
        if (data.reason === 'BUSY') {
            message = 'Абонент занят';
        } else if (data.reason === 'DECLINED_WITH_MESSAGE') {
            message = 'Звонок отклонён с сообщением';
        }
        
        this.showToast(message, 'info');
        this.setCallState('IDLE');
    }
    
    handleCallEnd(data) {
        if (data.callId !== this.currentCallId) return;
        
        this.stopRingtone();
        this.showCallEndedNotification(data.duration);
        this.closeAllCallModals();
        
        // Сохраняем в историю
        this.saveCallToHistory({
            callId: data.callId,
            partnerId: this.callPartner?.id,
            partnerName: this.callPartner?.name,
            type: this.isVideo ? 'video' : 'audio',
            status: 'COMPLETED',
            duration: data.duration || this.callDuration,
            timestamp: Date.now()
        });
        
        this.setCallState('IDLE');
    }
    
    handleTimeout(data) {
        if (data.callId !== this.currentCallId) return;
        
        this.stopRingtone();
        this.closeAllCallModals();
        
        this.showToast('Нет ответа', 'warning');
        this.setCallState('IDLE');
    }
    
    // ============ ОТПРАВКА СИГНАЛОВ ============
    
    sendCallOffer(offer) {
        if (!this.wsManager) return;
        
        this.wsManager.send({
            type: 'CALL_OFFER',
            callId: this.currentCallId,
            to: this.callPartner.id,
            offer: offer,
            isVideo: this.isVideo,
            timestamp: Date.now()
        });
    }
    
    sendCallAnswer(answer) {
        if (!this.wsManager) return;
        
        this.wsManager.send({
            type: 'CALL_ANSWER',
            callId: this.currentCallId,
            to: this.callPartner.id,
            answer: answer,
            timestamp: Date.now()
        });
    }
    
    sendIceCandidate(candidate) {
        if (!this.wsManager) return;
        
        this.wsManager.send({
            type: 'CALL_ICE_CANDIDATE',
            callId: this.currentCallId,
            to: this.callPartner.id,
            candidate: candidate,
            timestamp: Date.now()
        });
    }
    
    sendReject(callId, reason) {
        if (!this.wsManager) return;
        
        this.wsManager.send({
            type: 'CALL_REJECT',
            callId: callId,
            reason: reason,
            timestamp: Date.now()
        });
    }
    
    sendCallEnd() {
        if (!this.wsManager || !this.currentCallId) return;
        
        this.wsManager.send({
            type: 'CALL_END',
            callId: this.currentCallId,
            to: this.callPartner.id,
            duration: this.callDuration,
            timestamp: Date.now()
        });
    }
    
    // ============ УПРАВЛЕНИЕ ЗВОНКОМ ============
    
    toggleMute() {
        this.isMuted = !this.isMuted;
        
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
        }
        
        // Обновляем UI
        const muteBtn = document.getElementById('toggleMicBtn');
        if (muteBtn) {
            muteBtn.classList.toggle('mic-off', this.isMuted);
            muteBtn.innerHTML = this.isMuted 
                ? '<i class="fas fa-microphone-slash"></i>' 
                : '<i class="fas fa-microphone"></i>';
        }
        
        window.dispatchEvent(new CustomEvent('callMuteChange', { detail: { isMuted: this.isMuted } }));
    }
    
    toggleCamera() {
        if (!this.isVideo) return;
        
        this.isCameraOff = !this.isCameraOff;
        
        if (this.localStream) {
            this.localStream.getVideoTracks().forEach(track => {
                track.enabled = !this.isCameraOff;
            });
        }
        
        // Обновляем UI
        const cameraBtn = document.getElementById('toggleCameraBtn');
        if (cameraBtn) {
            cameraBtn.classList.toggle('camera-off', this.isCameraOff);
            cameraBtn.innerHTML = this.isCameraOff 
                ? '<i class="fas fa-video-slash"></i>' 
                : '<i class="fas fa-video"></i>';
        }
        
        // Скрываем/показываем превью
        const selfVideo = document.querySelector('.video-call-self video');
        if (selfVideo) {
            selfVideo.style.display = this.isCameraOff ? 'none' : 'block';
        }
    }
    
    switchCamera() {
        if (!this.localStream || !this.isVideo) return;
        
        // Переключаем между передней и задней камерой
        const videoTrack = this.localStream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        const facingMode = settings.facingMode === 'user' ? 'environment' : 'user';
        
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { facingMode: facingMode }
        }).then(newStream => {
            const newVideoTrack = newStream.getVideoTracks()[0];
            
            // Заменяем трек в соединении
            const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
                sender.replaceTrack(newVideoTrack);
            }
            
            // Обновляем локальный поток
            this.localStream.removeTrack(videoTrack);
            this.localStream.addTrack(newVideoTrack);
            videoTrack.stop();
            
            // Обновляем превью
            const selfVideo = document.querySelector('.video-call-self video');
            if (selfVideo) {
                selfVideo.srcObject = this.localStream;
            }
            
        }).catch(error => {
            console.error('[CallManager] Ошибка переключения камеры:', error);
        });
    }
    
    endCall() {
        // Отправляем сигнал завершения
        this.sendCallEnd();
        
        // Показываем уведомление
        this.showCallEndedNotification(this.callDuration);
        
        // Закрываем
        this.closeAllCallModals();
        this.setCallState('IDLE');
    }
    
    // ============ UI МЕТОДЫ ============
    
    showConnectingState() {
        const nameEl = document.getElementById('videoCallName');
        const statusEl = document.querySelector('.video-call-info');
        
        if (nameEl) nameEl.textContent = this.callPartner?.name || 'Подключение...';
        if (statusEl) statusEl.innerHTML = '<span class="dot connecting"></span> Подключение...';
        
        // Показываем локальное превью
        this.attachLocalStream();
    }
    
    showActiveCallState() {
        const nameEl = document.getElementById('videoCallName');
        const statusEl = document.querySelector('.video-call-info');
        
        if (nameEl) nameEl.textContent = this.callPartner?.name || 'Звонок';
        if (statusEl) statusEl.innerHTML = '<span class="dot connected"></span> Активный звонок';
        
        // Показываем удалённое видео
        this.attachRemoteStream();
        this.attachLocalStream();
    }
    
    attachLocalStream() {
        if (!this.localStream) return;
        
        const selfVideo = document.getElementById('localVideo');
        if (selfVideo) {
            selfVideo.srcObject = this.localStream;
            selfVideo.style.display = this.isVideo && !this.isCameraOff ? 'block' : 'none';
            
            // Пытаемся воспроизвести видео
            const playPromise = selfVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn('[CallManager] Не удалось воспроизвести локальное видео:', error);
                });
            }
        }
        
        // Отправляем событие для CallRoom и других компонентов
        window.dispatchEvent(new CustomEvent('callLocalStreamUpdate', {
            detail: { stream: this.localStream }
        }));
    }
    
    attachRemoteStream() {
        if (!this.remoteStream) return;
        
        const remoteVideo = document.getElementById('remoteVideo');
        const noVideoPlaceholder = document.getElementById('noVideoPlaceholder');
        
        if (remoteVideo) {
            remoteVideo.srcObject = this.remoteStream;
            remoteVideo.style.display = 'block';
            
            // Пытаемся воспроизвести видео
            const playPromise = remoteVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn('[CallManager] Не удалось воспроизвести удалённое видео:', error);
                });
            }
        }
        
        // Скрываем плейсхолдер когда есть видео
        if (noVideoPlaceholder) {
            noVideoPlaceholder.style.display = 'none';
        }
        
        // Отправляем событие для CallRoom и других компонентов
        window.dispatchEvent(new CustomEvent('callRemoteStreamUpdate', {
            detail: { stream: this.remoteStream }
        }));
    }
    
    showCallEndedNotification(duration) {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        this.showToast(`Звонок завершён (${formatted})`, 'info');
    }
    
    startCallTimer() {
        this.callStartTime = Date.now();
        this.callDuration = 0;
        
        const durationEl = document.querySelector('.video-call-duration');
        
        this.callTimer = setInterval(() => {
            this.callDuration = Math.floor((Date.now() - this.callStartTime) / 1000);
            
            const minutes = Math.floor(this.callDuration / 60);
            const seconds = this.callDuration % 60;
            
            if (durationEl) {
                durationEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    stopCallTimer() {
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
        this.callStartTime = null;
    }
    
    startCallTimeout() {
        // Таймаут 30 секунд
        setTimeout(() => {
            if (this.callState === 'CONNECTING' || this.callState === 'RINGING') {
                this.sendCallEnd();
                this.showToast('Нет ответа', 'warning');
                this.closeAllCallModals();
                this.setCallState('IDLE');
            }
        }, 30000);
    }
    
    handleConnectionLost() {
        if (this.callState === 'ACTIVE') {
            this.showToast('Соединение потеряно', 'error');
            this.closeAllCallModals();
            this.setCallState('FAILED');
        }
    }
    
    handleCallError(error) {
        let message = 'Ошибка звонка';
        
        if (error.name === 'NotAllowedError') {
            message = 'Нет доступа к микрофону/камере';
        } else if (error.name === 'NotFoundError') {
            message = 'Устройство не найдено';
        } else if (error.name === 'NotReadableError') {
            message = 'Устройство уже используется';
        }
        
        this.showToast(message, 'error');
        this.closeAllCallModals();
        this.setCallState('FAILED');
    }
    
    // ============ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ============
    
    stopLocalStream() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }
    
    closePeerConnection() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.remoteStream = null;
        this.queuedIceCandidates = []; // Очищаем буфер ICE кандидатов
        this.pendingOffer = null; // Очищаем оффер
    }
    
    // ============ ЗВУКИ И УВЕДОМЛЕНИЯ ============
    
    playRingtone() {
        // Используем AudioContext для генерации рингтона
        try {
            this.ringtoneContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Создаём осциллятор для рингтона
            this.ringtoneOscillator = this.ringtoneContext.createOscillator();
            this.ringtoneGain = this.ringtoneContext.createGain();
            
            this.ringtoneOscillator.type = 'sine';
            this.ringtoneOscillator.frequency.setValueAtTime(440, this.ringtoneContext.currentTime); // A4
            this.ringtoneOscillator.frequency.setValueAtTime(520, this.ringtoneContext.currentTime + 0.4);
            this.ringtoneOscillator.frequency.setValueAtTime(440, this.ringtoneContext.currentTime + 0.8);
            
            this.ringtoneGain.gain.setValueAtTime(0.3, this.ringtoneContext.currentTime);
            
            this.ringtoneOscillator.connect(this.ringtoneGain);
            this.ringtoneGain.connect(this.ringtoneContext.destination);
            
            this.ringtoneOscillator.start();
            
            // Зацикливаем рингтон
            this.ringtoneInterval = setInterval(() => {
                if (this.ringtoneOscillator) {
                    this.ringtoneOscillator.frequency.setValueAtTime(440, this.ringtoneContext.currentTime);
                    this.ringtoneOscillator.frequency.setValueAtTime(520, this.ringtoneContext.currentTime + 0.4);
                    this.ringtoneOscillator.frequency.setValueAtTime(440, this.ringtoneContext.currentTime + 0.8);
                }
            }, 1600);
            
        } catch (e) {
            console.log('[CallManager] AudioContext не поддерживается, используем fallback');
            // Fallback на Audio element
            this.playRingtoneFallback();
        }
    }
    
    playRingtoneFallback() {
        try {
            this.ringtoneAudio = new Audio();
            // Попробуем загрузить рингтон
            this.ringtoneAudio.src = '/sounds/ringtone.mp3';
            this.ringtoneAudio.loop = true;
            this.ringtoneAudio.volume = 0.5;
            this.ringtoneAudio.play().catch(() => {
                console.log('[CallManager] Не удалось воспроизвести рингтон (fallback)');
            });
        } catch (e) {
            console.log('[CallManager] Аудио не поддерживается');
        }
    }
    
    stopRingtone() {
        if (this.ringtoneInterval) {
            clearInterval(this.ringtoneInterval);
            this.ringtoneInterval = null;
        }
        if (this.ringtoneOscillator) {
            try {
                this.ringtoneOscillator.stop();
            } catch (e) {}
            this.ringtoneOscillator = null;
        }
        if (this.ringtoneGain) {
            this.ringtoneGain = null;
        }
        if (this.ringtoneContext) {
            try {
                this.ringtoneContext.close();
            } catch (e) {}
            this.ringtoneContext = null;
        }
        if (this.ringtoneAudio) {
            this.ringtoneAudio.pause();
            this.ringtoneAudio = null;
        }
    }
    
    vibrateDevice() {
        if (navigator.vibrate) {
            navigator.vibrate([500, 200, 500, 200, 500]);
        }
    }
    
    showToast(message, type = 'info') {
        if (window.messengerApp?.ui?.showToast) {
            window.messengerApp.ui.showToast(message, type);
        }
    }
    
    getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
    }
    
    getAvatarGradient(id) {
        if (!id) return 'avatar-gradient-1';
        const gradients = [
            'avatar-gradient-1', 'avatar-gradient-2', 'avatar-gradient-3',
            'avatar-gradient-4', 'avatar-gradient-5', 'avatar-gradient-6'
        ];
        const index = id.charCodeAt(id.length - 1) % gradients.length;
        return gradients[index];
    }
    
    // ============ ИСТОРИЯ ЗВОНКОВ ============
    
    saveCallToHistory(callData) {
        try {
            const history = JSON.parse(localStorage.getItem('callHistory') || '[]');
            history.unshift(callData);
            
            // Ограничиваем 100 записями
            if (history.length > 100) {
                history.pop();
            }
            
            localStorage.setItem('callHistory', JSON.stringify(history));
            
            // Уведомляем об обновлении истории
            window.dispatchEvent(new CustomEvent('callHistoryUpdate'));
            
        } catch (e) {
            console.warn('[CallManager] Не удалось сохранить историю звонков:', e);
        }
    }
    
    getCallHistory() {
        try {
            return JSON.parse(localStorage.getItem('callHistory') || '[]');
        } catch (e) {
            return [];
        }
    }
    
    clearCallHistory() {
        localStorage.removeItem('callHistory');
        window.dispatchEvent(new CustomEvent('callHistoryUpdate'));
    }
}

// Создаём глобальный экземпляр
window.CallManager = new CallManager();
