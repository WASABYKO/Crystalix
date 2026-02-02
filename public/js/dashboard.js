// Модуль личного кабинета
const DashboardModule = {
    selectedAvatarFile: null,
    
    init() {
        this.bindEvents();
        this.loadUserData();
    },

    bindEvents() {
        // Выход из системы
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.handleLogout());
        
        // Смена пароля
        document.getElementById('changePasswordBtn')?.addEventListener('click', () => this.showChangePasswordModal());
        
        // Редактирование профиля
        document.getElementById('editProfileBtn')?.addEventListener('click', () => this.showEditProfileModal());
        
        // Загрузка аватарки
        document.getElementById('changeAvatarBtn')?.addEventListener('click', () => this.showAvatarModal());
        
        // Навигация
        document.querySelectorAll('.nav-link[data-page="dashboard"]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.showDashboard();
            });
        });
    },

    loadUserData() {
        const user = HashStorage.getCurrentUser();
        
        if (!user) {
            window.location.hash = '#home';
            return;
        }
        
        this.renderProfile(user);
        this.renderActivity(user.activity || []);
        this.updateAvatarDisplay(user.avatar);
    },

    renderProfile(user) {
        const profileContainer = document.getElementById('userProfile');
        if (!profileContainer) return;
        
        const formattedDate = new Date(user.createdAt).toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        profileContainer.innerHTML = `
            <div class="profile-info">
                <div class="profile-item">
                    <span class="profile-label">Имя:</span>
                    <span class="profile-value">${user.name}</span>
                </div>
                <div class="profile-item">
                    <span class="profile-label">Email:</span>
                    <span class="profile-value">${user.email}</span>
                </div>
                <div class="profile-item">
                    <span class="profile-label">Тариф:</span>
                    <span class="profile-value tariff-badge-small">${this.getTariffName(user.tariff)}</span>
                </div>
                <div class="profile-item">
                    <span class="profile-label">Дата регистрации:</span>
                    <span class="profile-value">${formattedDate}</span>
                </div>
                <div class="profile-item">
                    <span class="profile-label">Последний вход:</span>
                    <span class="profile-value">${new Date(user.lastLogin).toLocaleString('ru-RU')}</span>
                </div>
            </div>
            
            <div class="profile-stats">
                <div class="stat-card">
                    <i class="fas fa-clock"></i>
                    <div class="stat-content">
                        <h4>${user.activity?.length || 0}</h4>
                        <p>Активностей</p>
                    </div>
                </div>
                <div class="stat-card">
                    <i class="fas fa-calendar-check"></i>
                    <div class="stat-content">
                        <h4>${Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))}</h4>
                        <p>Дней с нами</p>
                    </div>
                </div>
            </div>
        `;
    },

    renderActivity(activities) {
        const activityContainer = document.getElementById('userActivity');
        if (!activityContainer) return;
        
        if (activities.length === 0) {
            activityContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <p>Активности пока нет</p>
                </div>
            `;
            return;
        }
        
        const activityList = activities.slice(0, 10).map(activity => {
            const icon = this.getActivityIcon(activity.type);
            const text = this.getActivityText(activity);
            const time = new Date(activity.timestamp).toLocaleString('ru-RU');
            
            return `
                <div class="activity-item">
                    <div class="activity-icon">${icon}</div>
                    <div class="activity-content">
                        <p class="activity-text">${text}</p>
                        <span class="activity-time">${time}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        activityContainer.innerHTML = `
            <div class="activity-list">
                ${activityList}
            </div>
            ${activities.length > 10 ? 
                `<p class="activity-more">И еще ${activities.length - 10} активностей</p>` : 
                ''}
        `;
    },

    getActivityIcon(type) {
        const icons = {
            'login': '<i class="fas fa-sign-in-alt"></i>',
            'register': '<i class="fas fa-user-plus"></i>',
            'tariff_change': '<i class="fas fa-exchange-alt"></i>',
            'profile_update': '<i class="fas fa-user-edit"></i>',
            'payment': '<i class="fas fa-credit-card"></i>',
            'avatar_change': '<i class="fas fa-camera"></i>'
        };
        return icons[type] || '<i class="fas fa-circle"></i>';
    },

    getActivityText(activity) {
        const texts = {
            'login': 'Вход в систему',
            'register': 'Регистрация аккаунта',
            'tariff_change': `Смена тарифа на "${activity.details?.tariff || 'неизвестно'}"`,
            'profile_update': 'Обновление профиля',
            'payment': `Оплата тарифа "${activity.details?.tariff || ''}"`,
            'avatar_change': 'Изменение аватарки'
        };
        return texts[activity.type] || 'Действие в системе';
    },

    getTariffName(tariffCode) {
        const tariffs = {
            'free': 'Бесплатный',
            'basic': 'Базовый',
            'pro': 'Профессиональный',
            'enterprise': 'Корпоративный'
        };
        return tariffs[tariffCode] || tariffCode;
    },

    showDashboard() {
        const user = HashStorage.getCurrentUser();
        if (!user) {
            AuthModule.showAuthModal('login');
            return;
        }
        
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.getElementById('dashboardPage')?.classList.add('active');
        
        this.loadUserData();
    },

    async handleLogout() {
        if (confirm('Вы уверены, что хотите выйти?')) {
            HashStorage.addActivity(HashStorage.getCurrentUser().id, {
                type: 'logout',
                ip: 'local'
            });
            
            HashStorage.logout();
            window.location.reload();
        }
    },

    showChangePasswordModal() {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Смена пароля</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="currentPassword">Текущий пароль</label>
                        <input type="password" id="currentPassword" placeholder="••••••••">
                    </div>
                    <div class="form-group">
                        <label for="newPassword">Новый пароль</label>
                        <input type="password" id="newPassword" placeholder="Минимум 8 символов">
                    </div>
                    <div class="form-group">
                        <label for="confirmPassword">Подтвердите пароль</label>
                        <input type="password" id="confirmPassword" placeholder="••••••••">
                    </div>
                    <button id="submitPasswordChange" class="btn btn-primary btn-block">
                        Сменить пароль
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        modal.querySelector('#submitPasswordChange').addEventListener('click', async () => {
            await this.handlePasswordChange(modal);
        });
    },

    showEditProfileModal() {
        const user = HashStorage.getCurrentUser();
        if (!user) return;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Редактирование профиля</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="editName">Имя</label>
                        <input type="text" id="editName" value="${user.name || ''}" placeholder="Ваше имя">
                    </div>
                    <div class="form-group">
                        <label for="editEmail">Email</label>
                        <input type="email" id="editEmail" value="${user.email || ''}" placeholder="your@email.com" readonly style="background: var(--darker-bg); opacity: 0.7;">
                        <small style="color: var(--text-secondary);">Email нельзя изменить</small>
                    </div>
                    <button id="saveProfileBtn" class="btn btn-primary btn-block">
                        <i class="fas fa-save"></i> Сохранить изменения
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        modal.querySelector('#saveProfileBtn').addEventListener('click', async () => {
            await this.handleProfileSave(modal);
        });
    },

    async handleProfileSave(modal) {
        const name = modal.querySelector('#editName').value.trim();
        
        if (!name) {
            AuthModule.showNotification('Введите имя', 'error');
            return;
        }
        
        if (name.length < 2) {
            AuthModule.showNotification('Имя должно быть не менее 2 символов', 'error');
            return;
        }
        
        const user = HashStorage.getCurrentUser();
        
        try {
            const response = await fetch('/api/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${HashStorage.getToken()}`
                },
                body: JSON.stringify({ name })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Обновляем в локальном хранилище
                HashStorage.updateUser(user.id, { name });
                
                // Обновляем отображение на странице
                this.updateProfileDisplay(name);
                
                AuthModule.showNotification('Профиль успешно обновлён!', 'success');
                modal.remove();
                
                HashStorage.addActivity(user.id, {
                    type: 'profile_update',
                    details: { field: 'name', value: name }
                });
            } else {
                AuthModule.showNotification(result.message || 'Ошибка при сохранении', 'error');
            }
        } catch (error) {
            console.error('Ошибка сохранения профиля:', error);
            AuthModule.showNotification('Ошибка при сохранении профиля', 'error');
        }
    },

    updateProfileDisplay(name) {
        // Обновляем имя в шапке
        const userNameEl = document.getElementById('userName');
        if (userNameEl) userNameEl.textContent = name;
        
        // Обновляем приветствие
        const welcomeTitle = document.getElementById('userWelcomeTitle');
        if (welcomeTitle) welcomeTitle.textContent = `Привет, ${name}!`;
        
        // Обновляем хедер
        if (typeof HeaderComponent !== 'undefined' && HeaderComponent.updateUserInfo) {
            HeaderComponent.updateUserInfo();
        }
    },

    async handlePasswordChange(modal) {
        const currentPassword = modal.querySelector('#currentPassword').value;
        const newPassword = modal.querySelector('#newPassword').value;
        const confirmPassword = modal.querySelector('#confirmPassword').value;
        
        if (!currentPassword || !newPassword || !confirmPassword) {
            AuthModule.showNotification('Заполните все поля', 'error');
            return;
        }
        
        if (newPassword.length < 8) {
            AuthModule.showNotification('Новый пароль должен быть не менее 8 символов', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            AuthModule.showNotification('Пароли не совпадают', 'error');
            return;
        }
        
        const user = HashStorage.getCurrentUser();
        const result = await HashStorage.authenticate(user.email, currentPassword);
        
        if (!result.success) {
            AuthModule.showNotification('Неверный текущий пароль', 'error');
            return;
        }
        
        const hashedPassword = await HashStorage.hashPassword(newPassword);
        
        const updateResult = HashStorage.updateUser(user.id, {
            passwordHash: hashedPassword
        });
        
        if (updateResult.success) {
            AuthModule.showNotification('Пароль успешно изменен!', 'success');
            modal.remove();
            
            HashStorage.addActivity(user.id, {
                type: 'profile_update',
                details: { field: 'password' }
            });
        } else {
            AuthModule.showNotification('Ошибка при смене пароля', 'error');
        }
    },

    // ────────────────────────────────────────────────
    //  СИСТЕМА ЗАГРУЗКИ АВАТАРОК
    // ────────────────────────────────────────────────

    showAvatarModal() {
        this.selectedAvatarFile = null;
        
        const user = HashStorage.getCurrentUser();
        const currentAvatar = user?.avatar?.original || null;
        
        const modal = document.createElement('div');
        modal.className = 'modal active avatar-upload-modal';
        modal.innerHTML = `
            <div class="modal-content avatar-modal-content">
                <div class="modal-header">
                    <h3>Изменение аватарки</h3>
                    <button class="modal-close">&times;</button>
                </div>
                
                <div class="modal-body">
                    <!-- Превью аватарки -->
                    <div class="avatar-preview-container">
                        <div class="avatar-preview" id="avatarPreview">
                            ${currentAvatar 
                                ? `<img src="${currentAvatar}" alt="Текущая аватарка" id="previewImage">`
                                : '<i class="fas fa-user"></i>'
                            }
                        </div>
                    </div>
                    
                    <!-- Drag & Drop зона -->
                    <div class="upload-area" id="uploadArea">
                        <input type="file" id="avatarInput" accept="image/jpeg,image/png,image/gif,image/webp" style="display: none;">
                        <div class="upload-placeholder">
                            <i class="fas fa-cloud-upload-alt"></i>
                            <p>Перетащите изображение сюда или</p>
                            <button class="btn btn-outline" id="browseBtn">Выберите файл</button>
                        </div>
                        <div class="upload-requirements">
                            <small>JPG, PNG, GIF, WebP до 5MB</small>
                        </div>
                    </div>
                    
                    <!-- Прогресс загрузки -->
                    <div class="upload-progress" id="uploadProgress" style="display: none;">
                        <div class="progress-bar">
                            <div class="progress-fill" id="progressFill"></div>
                        </div>
                        <span class="progress-text" id="progressText">0%</span>
                    </div>
                    
                    <!-- Кнопки действий -->
                    <div class="avatar-actions">
                        <button class="btn btn-primary" id="saveAvatarBtn" disabled>
                            <i class="fas fa-save"></i> Сохранить
                        </button>
                        ${currentAvatar ? `
                            <button class="btn btn-danger" id="deleteAvatarBtn">
                                <i class="fas fa-trash"></i> Удалить
                            </button>
                        ` : ''}
                        <button class="btn btn-outline" id="cancelAvatarBtn">
                            Отмена
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.setupAvatarModalEvents(modal);
    },

    setupAvatarModalEvents(modal) {
        const uploadArea = modal.querySelector('#uploadArea');
        const avatarInput = modal.querySelector('#avatarInput');
        const browseBtn = modal.querySelector('#browseBtn');
        const saveBtn = modal.querySelector('#saveAvatarBtn');
        const deleteBtn = modal.querySelector('#deleteAvatarBtn');
        const cancelBtn = modal.querySelector('#cancelAvatarBtn');
        const previewContainer = modal.querySelector('#avatarPreview');
        
        // Закрытие модального окна
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        // Клик по зоне загрузки
        uploadArea.addEventListener('click', () => avatarInput.click());
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            avatarInput.click();
        });
        
        // Drag & Drop события
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files?.[0];
            if (file) this.processAvatarFile(file, modal);
        });
        
        // Выбор файла через input
        avatarInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) this.processAvatarFile(file, modal);
        });
        
        // Сохранение аватарки
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.uploadAvatar(modal));
        }
        
        // Удаление аватарки
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteAvatar(modal));
        }
        
        // Отмена
        cancelBtn.addEventListener('click', () => modal.remove());
    },

    processAvatarFile(file, modal) {
        // Валидация файла
        const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        const maxSize = 5 * 1024 * 1024; // 5MB
        
        if (!validTypes.includes(file.type)) {
            AuthModule.showNotification('Недопустимый формат. Разрешены: JPG, PNG, GIF, WebP', 'error');
            return;
        }
        
        if (file.size > maxSize) {
            AuthModule.showNotification('Размер файла не должен превышать 5MB', 'error');
            return;
        }
        
        this.selectedAvatarFile = file;
        
        // Показываем превью
        const reader = new FileReader();
        reader.onload = (e) => {
            const previewContainer = modal.querySelector('#avatarPreview');
            if (previewContainer) {
                previewContainer.innerHTML = `<img src="${e.target.result}" alt="Превью" id="previewImage">`;
            }
            
            // Активируем кнопку сохранения
            const saveBtn = modal.querySelector('#saveAvatarBtn');
            if (saveBtn) saveBtn.disabled = false;
        };
        reader.readAsDataURL(file);
    },

    async uploadAvatar(modal) {
        if (!this.selectedAvatarFile) return;
        
        const user = HashStorage.getCurrentUser();
        if (!user) return;
        
        const progressContainer = modal.querySelector('#uploadProgress');
        const progressFill = modal.querySelector('#progressFill');
        const progressText = modal.querySelector('#progressText');
        const saveBtn = modal.querySelector('#saveAvatarBtn');
        
        // Показываем прогресс
        progressContainer.style.display = 'block';
        saveBtn.disabled = true;
        
        try {
            const formData = new FormData();
            formData.append('avatar', this.selectedAvatarFile);
            
            const xhr = new XMLHttpRequest();
            
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    progressFill.style.width = percent + '%';
                    progressText.textContent = percent + '%';
                }
            };
            
            xhr.onload = async () => {
                const result = JSON.parse(xhr.responseText);
                
                if (result.success) {
                    // Обновляем в локальном хранилище
                    HashStorage.updateUser(user.id, { avatar: result.avatar });
                    
                    // Обновляем отображение
                    this.updateAvatarDisplay(result.avatar);
                    
                    AuthModule.showNotification('Аватарка успешно загружена!', 'success');
                    
                    HashStorage.addActivity(user.id, {
                        type: 'avatar_change',
                        details: { avatar: result.avatar }
                    });
                    
                    modal.remove();
                } else {
                    AuthModule.showNotification(result.message || 'Ошибка при загрузке', 'error');
                    saveBtn.disabled = false;
                }
            };
            
            xhr.onerror = () => {
                AuthModule.showNotification('Ошибка при загрузке', 'error');
                saveBtn.disabled = false;
            };
            
            xhr.open('POST', '/api/profile/avatar');
            xhr.setRequestHeader('Authorization', `Bearer ${HashStorage.getToken()}`);
            xhr.send(formData);
            
        } catch (error) {
            console.error('Ошибка загрузки аватарки:', error);
            AuthModule.showNotification('Ошибка при загрузке аватарки', 'error');
            saveBtn.disabled = false;
        }
    },

    async deleteAvatar(modal) {
        if (!confirm('Вы уверены, что хотите удалить аватарку?')) return;
        
        const user = HashStorage.getCurrentUser();
        if (!user) return;
        
        try {
            const response = await fetch('/api/profile/avatar', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${HashStorage.getToken()}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                HashStorage.updateUser(user.id, { avatar: null });
                this.updateAvatarDisplay(null);
                
                AuthModule.showNotification('Аватарка удалена', 'success');
                modal.remove();
            } else {
                AuthModule.showNotification(result.message || 'Ошибка при удалении', 'error');
            }
        } catch (error) {
            console.error('Ошибка удаления аватарки:', error);
            AuthModule.showNotification('Ошибка при удалении', 'error');
        }
    },

    updateAvatarDisplay(avatarData) {
        const avatarContainer = document.getElementById('userAvatarLarge');
        if (!avatarContainer) return;
        
        // Очищаем контейнер
        avatarContainer.innerHTML = '';
        
        if (avatarData?.original) {
            const img = document.createElement('img');
            img.src = avatarData.original;
            img.alt = 'Аватар';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            img.style.display = 'block';
            
            img.onload = () => {
                console.log('Аватарка загружена:', avatarData.original);
            };
            
            img.onerror = () => {
                console.error('Ошибка загрузки аватарки:', avatarData.original);
                this.showDefaultAvatar(avatarContainer);
            };
            
            avatarContainer.appendChild(img);
        } else {
            this.showDefaultAvatar(avatarContainer);
        }
    },

    showDefaultAvatar(container) {
        container.innerHTML = '<i class="fas fa-user" style="font-size: 3rem; color: white;"></i>';
        container.style.background = 'linear-gradient(135deg, var(--primary), var(--secondary))';
    }
};

// Стили для личного кабинета
const dashboardStyles = document.createElement('style');
dashboardStyles.textContent = `
    .profile-info {
        background: var(--darker-bg);
        padding: 1.5rem;
        border-radius: 8px;
        margin-bottom: 2rem;
    }
    
    .profile-item {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--border);
    }
    
    .profile-item:last-child {
        border-bottom: none;
    }
    
    .profile-label {
        color: var(--text-secondary);
    }
    
    .profile-value {
        font-weight: 500;
    }
    
    .tariff-badge-small {
        background: var(--primary);
        color: #000;
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-size: 0.875rem;
        font-weight: 600;
    }
    
    .profile-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
        margin-top: 2rem;
    }
    
    .stat-card {
        background: var(--darker-bg);
        padding: 1.5rem;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .stat-card i {
        font-size: 2rem;
        color: var(--primary);
    }
    
    .stat-card h4 {
        font-size: 1.5rem;
        margin: 0;
    }
    
    .stat-card p {
        color: var(--text-secondary);
        margin: 0;
        font-size: 0.875rem;
    }
    
    .activity-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    
    .activity-item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        background: var(--darker-bg);
        border-radius: 8px;
    }
    
    .activity-icon {
        width: 40px;
        height: 40px;
        background: rgba(0, 204, 255, 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--primary);
    }
    
    .activity-text {
        margin: 0;
        font-weight: 500;
    }
    
    .activity-time {
        color: var(--text-secondary);
        font-size: 0.875rem;
    }
    
    .empty-state {
        text-align: center;
        padding: 3rem;
        color: var(--text-secondary);
    }
    
    .empty-state i {
        font-size: 3rem;
        margin-bottom: 1rem;
        opacity: 0.5;
    }
    
    .activity-more {
        text-align: center;
        color: var(--text-secondary);
        font-size: 0.875rem;
        margin-top: 1rem;
    }
    
    /* ────────────────────────────────────────────────
       СТИЛИ ЗАГРУЗКИ АВАТАРОК
       ──────────────────────────────────────────────── */
    
    /* Модальное окно загрузки аватарки */
    .avatar-upload-modal .modal-content {
        max-width: 450px;
    }
    
    .avatar-modal-content {
        max-width: 450px;
        width: 90%;
    }
    
    /* Превью аватарки */
    .avatar-preview-container {
        display: flex;
        justify-content: center;
        margin-bottom: 1.5rem;
    }
    
    .avatar-preview {
        width: 150px;
        height: 150px;
        border-radius: 50%;
        background: var(--primary);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0, 204, 255, 0.3);
        transition: all 0.3s ease;
    }
    
    .avatar-preview i {
        font-size: 4rem;
        color: rgba(255, 255, 255, 0.8);
    }
    
    .avatar-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    
    /* Drag & Drop зона */
    .upload-area {
        border: 2px dashed var(--border);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-bottom: 1.5rem;
        background: var(--darker-bg);
    }
    
    .upload-area:hover,
    .upload-area.dragover {
        border-color: var(--primary);
        background: rgba(0, 204, 255, 0.05);
    }
    
    .upload-area.dragover {
        transform: scale(1.02);
    }
    
    .upload-placeholder i {
        font-size: 3rem;
        color: var(--primary);
        margin-bottom: 1rem;
    }
    
    .upload-placeholder p {
        color: var(--text-secondary);
        margin-bottom: 1rem;
    }
    
    .upload-requirements {
        margin-top: 1rem;
        color: var(--text-secondary);
    }
    
    /* Прогресс загрузки */
    .upload-progress {
        margin-bottom: 1.5rem;
    }
    
    .progress-bar {
        height: 8px;
        background: var(--darker-bg);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 0.5rem;
    }
    
    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--primary), var(--secondary));
        border-radius: 4px;
        transition: width 0.3s ease;
        width: 0%;
    }
    
    .progress-text {
        text-align: center;
        display: block;
        color: var(--text-secondary);
        font-size: 0.875rem;
    }
    
    /* Кнопки действий */
    .avatar-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
        flex-wrap: wrap;
    }
    
    .avatar-actions .btn {
        min-width: 120px;
    }
    
    .avatar-actions .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    
    /* Аватар в чатах и списках */
    .chat-avatar,
    .friend-avatar,
    .user-avatar {
        width: 45px;
        height: 45px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--primary);
        color: #000;
        font-weight: 600;
        font-size: 1.1rem;
        overflow: hidden;
        flex-shrink: 0;
    }
    
    .chat-avatar img,
    .friend-avatar img,
    .user-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    
    .user-avatar-small {
        width: 30px;
        height: 30px;
        font-size: 0.8rem;
    }
`;

document.head.appendChild(dashboardStyles);