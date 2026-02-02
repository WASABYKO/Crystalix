/**
 * MediaDeviceManager v1.0
 * Управление медиаустройствами (микрофоны, камеры)
 * Поддержка выбора устройства и переключения без разрыва звонка
 */

class MediaDeviceManager {
    constructor() {
        this.audioInputs = [];
        this.videoInputs = [];
        this.currentAudioDevice = null;
        this.currentVideoDevice = null;
        this.localStream = null;
        this.deviceChangeListeners = new Set();
        this.isSupported = 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
        
        this.init();
    }
    
    init() {
        if (!this.isSupported) {
            console.warn('[MediaDeviceManager] Media Devices API не поддерживается');
            return;
        }
        
        // Загружаем сохранённое устройство из localStorage
        this.loadSavedDevice();
        
        // Подписываемся на изменения устройств
        navigator.mediaDevices.addEventListener('devicechange', () => {
            this.enumerateDevices();
            this.deviceChangeListeners.forEach(cb => cb());
        });
        
        // Первоначальное перечисление устройств
        this.enumerateDevices();
    }
    
    /**
     * Перечисление всех доступных устройств
     */
    async enumerateDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            this.audioInputs = devices.filter(d => d.kind === 'audioinput');
            this.videoInputs = devices.filter(d => d.kind === 'videoinput');
            
            console.log('[MediaDeviceManager] Найдено аудиоустройств:', this.audioInputs.length);
            console.log('[MediaDeviceManager] Найдено видеоустройств:', this.videoInputs.length);
            
            return { audioInputs: this.audioInputs, videoInputs: this.videoInputs };
        } catch (error) {
            console.error('[MediaDeviceManager] Ошибка перечисления устройств:', error);
            return { audioInputs: [], videoInputs: [] };
        }
    }
    
    /**
     * Получение медиапотока с выбранным устройством
     */
    async getMediaStream(constraints = {}) {
        const deviceConstraints = { ...constraints };
        
        // Если есть сохранённое устройство, используем его
        if (!deviceConstraints.audio && this.currentAudioDevice) {
            deviceConstraints.audio = { deviceId: { exact: this.currentAudioDevice.deviceId } };
        }
        if (!deviceConstraints.video && this.currentVideoDevice) {
            deviceConstraints.video = { deviceId: { exact: this.currentVideoDevice.deviceId } };
        }
        
        // Добавляем дополнительные настройки для видео
        if (!deviceConstraints.video) {
            deviceConstraints.video = {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            };
        }
        
        if (!deviceConstraints.audio) {
            deviceConstraints.audio = true;
        }
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(deviceConstraints);
            return this.localStream;
        } catch (error) {
            console.error('[MediaDeviceManager] Ошибка получения медиапотока:', error);
            throw error;
        }
    }
    
    /**
     * Переключение микрофона без разрыва звонка
     */
    async switchMicrophone(deviceId) {
        const device = this.audioInputs.find(d => d.deviceId === deviceId);
        if (!device) {
            console.error('[MediaDeviceManager] Устройство не найдено:', deviceId);
            return null;
        }
        
        const oldTrack = this.localStream?.getAudioTracks()[0];
        
        try {
            // Создаём новый трек с выбранным устройством
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: deviceId } },
                video: false
            });
            
            const newTrack = newStream.getAudioTracks()[0];
            
            // Если есть локальный поток, заменяем трек
            if (this.localStream && oldTrack) {
                // Находим все пиры и заменяем трек
                if (window.CallManager?.peerConnection) {
                    const senders = window.CallManager.peerConnection.getSenders();
                    const audioSender = senders.find(s => s.track?.kind === 'audio');
                    if (audioSender) {
                        await audioSender.replaceTrack(newTrack);
                    }
                }
                
                // Удаляем старый трек
                oldTrack.stop();
                this.localStream.removeTrack(oldTrack);
                
                // Добавляем новый трек
                this.localStream.addTrack(newTrack);
            }
            
            this.currentAudioDevice = device;
            this.saveDevice('audio', device);
            
            console.log('[MediaDeviceManager] Микрофон переключён на:', device.label);
            
            return this.localStream;
        } catch (error) {
            console.error('[MediaDeviceManager] Ошибка переключения микрофона:', error);
            throw error;
        }
    }
    
    /**
     * Переключение камеры без разрыва звонка
     */
    async switchCamera(deviceId) {
        const device = this.videoInputs.find(d => d.deviceId === deviceId);
        if (!device) {
            console.error('[MediaDeviceManager] Устройство не найдено:', deviceId);
            return null;
        }
        
        const oldTrack = this.localStream?.getVideoTracks()[0];
        
        try {
            // Создаём новый трек с выбранным устройством
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { deviceId: { exact: deviceId } }
            });
            
            const newTrack = newStream.getVideoTracks()[0];
            
            // Если есть локальный поток, заменяем трек
            if (this.localStream && oldTrack) {
                // Находим все пиры и заменяем трек
                if (window.CallManager?.peerConnection) {
                    const senders = window.CallManager.peerConnection.getSenders();
                    const videoSender = senders.find(s => s.track?.kind === 'video');
                    if (videoSender) {
                        await videoSender.replaceTrack(newTrack);
                    }
                }
                
                // Обновляем локальное видео
                const localVideo = document.getElementById('localVideo');
                if (localVideo) {
                    localVideo.srcObject = this.localStream;
                }
                
                // Удаляем старый трек
                oldTrack.stop();
                this.localStream.removeTrack(oldTrack);
                
                // Добавляем новый трек
                this.localStream.addTrack(newTrack);
            }
            
            this.currentVideoDevice = device;
            this.saveDevice('video', device);
            
            console.log('[MediaDeviceManager] Камера переключена на:', device.label);
            
            return this.localStream;
        } catch (error) {
            console.error('[MediaDeviceManager] Ошибка переключения камеры:', error);
            throw error;
        }
    }
    
    /**
     * Сохранение выбранного устройства в localStorage
     */
    saveDevice(type, device) {
        try {
            const key = `mediaDevice_${type}`;
            localStorage.setItem(key, JSON.stringify({
                deviceId: device.deviceId,
                label: device.label,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.error('[MediaDeviceManager] Ошибка сохранения устройства:', error);
        }
    }
    
    /**
     * Загрузка сохранённого устройства из localStorage
     */
    loadSavedDevice() {
        try {
            const audioKey = localStorage.getItem('mediaDevice_audio');
            const videoKey = localStorage.getItem('mediaDevice_video');
            
            if (audioKey) {
                const data = JSON.parse(audioKey);
                this.currentAudioDevice = { deviceId: data.deviceId, label: data.label };
            }
            
            if (videoKey) {
                const data = JSON.parse(videoKey);
                this.currentVideoDevice = { deviceId: data.deviceId, label: data.label };
            }
        } catch (error) {
            console.error('[MediaDeviceManager] Ошибка загрузки устройств:', error);
        }
    }
    
    /**
     * Получение списка микрофонов
     */
    getAudioInputs() {
        return this.audioInputs;
    }
    
    /**
     * Получение списка камер
     */
    getVideoInputs() {
        return this.videoInputs;
    }
    
    /**
     * Подписка на изменения устройств
     */
    onDeviceChange(callback) {
        this.deviceChangeListeners.add(callback);
        return () => this.deviceChangeListeners.delete(callback);
    }
    
    /**
     * Проверка поддержки API
     */
    checkSupport() {
        if (!this.isSupported) {
            return {
                supported: false,
                audio: false,
                video: false,
                deviceSelect: false
            };
        }
        
        return {
            supported: true,
            audio: 'getUserMedia' in navigator.mediaDevices,
            video: 'getUserMedia' in navigator.mediaDevices,
            deviceSelect: 'enumerateDevices' in navigator.mediaDevices
        };
    }
    
    /**
     * Остановка всех треков
     */
    stopAllTracks() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }
}

// Создаём глобальный экземпляр
window.MediaDeviceManager = new MediaDeviceManager();
