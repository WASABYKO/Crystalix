// Модуль авторизации с исправлениями
const AuthModule = {
    init() {
        this.bindEvents();
        this.checkAuth();
    },

    bindEvents() {
        console.log('Инициализация AuthModule...');
        
        // Кнопки открытия модального окна
        const loginBtn = document.getElementById('loginBtn');
        const registerBtn = document.getElementById('registerBtn');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.showAuthModal('login'));
            console.log('Кнопка входа привязана');
        }
        
        if (registerBtn) {
            registerBtn.addEventListener('click', () => this.showAuthModal('register'));
            console.log('Кнопка регистрации привязана');
        }
        
        // Переключение между формами
        const switchToRegister = document.getElementById('switchToRegister');
        const switchToLogin = document.getElementById('switchToLogin');
        
        if (switchToRegister) {
            switchToRegister.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchForm('register');
            });
        }
        
        if (switchToLogin) {
            switchToLogin.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchForm('login');
            });
        }
        
        // Закрытие модального окна
        const modalClose = document.querySelector('.modal-close');
        const authModal = document.getElementById('authModal');
        
        if (modalClose) {
            modalClose.addEventListener('click', () => this.hideAuthModal());
        }
        
        if (authModal) {
            authModal.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) this.hideAuthModal();
            });
        }
        
        // Отправка форм
        const submitLogin = document.getElementById('submitLogin');
        const submitRegister = document.getElementById('submitRegister');
        
        if (submitLogin) {
            submitLogin.addEventListener('click', () => this.handleLogin());
        }
        
        if (submitRegister) {
            submitRegister.addEventListener('click', () => this.handleRegister());
        }
        
        // Enter для отправки
        const formIds = ['loginEmail', 'loginPassword', 'registerName', 'registerEmail', 'registerPassword'];
        formIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        if (id.startsWith('login')) this.handleLogin();
                        else this.handleRegister();
                    }
                });
            }
        });
        
        console.log('Все события привязаны');
    },

    showAuthModal(type = 'login') {
        const modal = document.getElementById('authModal');
        if (modal) {
            modal.classList.add('active');
            this.switchForm(type);
        }
    },

    hideAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) {
            modal.classList.remove('active');
            this.clearForms();
        }
    },

    switchForm(type) {
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const modalTitle = document.getElementById('modalTitle');
        
        if (!loginForm || !registerForm || !modalTitle) return;
        
        if (type === 'login') {
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
            modalTitle.textContent = 'Авторизация';
        } else {
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
            modalTitle.textContent = 'Регистрация';
        }
    },

    clearForms() {
        const ids = ['loginEmail', 'loginPassword', 'registerName', 'registerEmail', 'registerPassword'];
        ids.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
    },

    async handleLogin() {
        console.log('Обработка входа...');
        
        const email = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        
        if (!email || !password) {
            this.showNotification('Заполните все поля', 'error');
            return;
        }
        
        this.showLoading(true, 'login');
        
        try {
            const result = await HashStorage.login(email, password);
            console.log('Результат аутентификации:', result);
            
            this.showLoading(false, 'login');
            
            if (result.success) {
                this.showNotification('Вход выполнен успешно!', 'success');
                this.hideAuthModal();
                this.updateUIAfterAuth(result.user);
                
                HashStorage.addActivity(result.user.id, {
                    type: 'login',
                    ip: 'local'
                });
                
                // Редирект на страницу с чатами
                setTimeout(() => {
                    window.location.href = '/messages.html';
                }, 500);
            } else {
                this.showNotification(result.message || 'Ошибка при входе', 'error');
            }
        } catch (error) {
            console.error('Ошибка при входе:', error);
            this.showLoading(false, 'login');
            this.showNotification('Ошибка при входе. Попробуйте позже.', 'error');
        }
    },

    async handleRegister() {
        console.log('Обработка регистрации...');
        
        const name = document.getElementById('registerName')?.value.trim();
        const email = document.getElementById('registerEmail')?.value.trim();
        const password = document.getElementById('registerPassword')?.value;
        
        if (!name || !email || !password) {
            this.showNotification('Заполните все поля', 'error');
            return;
        }
        
        if (password.length < 8) {
            this.showNotification('Пароль должен быть не менее 8 символов', 'error');
            return;
        }
        
        if (!this.validateEmail(email)) {
            this.showNotification('Введите корректный email', 'error');
            return;
        }
        
        this.showLoading(true, 'register');
        
        try {
            console.log('Вызов HashStorage.register...', { name, email, password });
            const result = await HashStorage.register(name, email, password);
            console.log('Результат регистрации:', result);
            
            this.showLoading(false, 'register');
            
            if (result.success) {
                this.showNotification(result.message || 'Регистрация прошла успешно!', 'success');
                this.hideAuthModal();
                this.updateUIAfterAuth(result.user);
                
                HashStorage.addActivity(result.user.id, {
                    type: 'register',
                    ip: 'local'
                });
                
                // Редирект на страницу с чатами
                setTimeout(() => {
                    window.location.href = '/messages.html';
                }, 500);
            } else {
                this.showNotification(result.message || 'Ошибка при регистрации', 'error');
            }
        } catch (error) {
            console.error('Критическая ошибка при регистрации:', error);
            this.showLoading(false, 'register');
            this.showNotification('Критическая ошибка при регистрации', 'error');
        }
    },

    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    checkAuth() {
        const user = HashStorage.getCurrentUser();
        console.log('Проверка авторизации, текущий пользователь:', user);
        
        if (user) {
            this.updateUIAfterAuth(user);
        }
    },

    updateUIAfterAuth(user) {
        console.log('Обновление UI после авторизации:', user);
        
        const loginBtn = document.getElementById('loginBtn');
        const registerBtn = document.getElementById('registerBtn');
        const dashboardLink = document.getElementById('dashboardLink');
        const authButtons = document.querySelector('.auth-buttons');
        
        if (!user) return;
        
        if (loginBtn) loginBtn.style.display = 'none';
        if (registerBtn) registerBtn.style.display = 'none';
        
        if (authButtons) {
            const userInitial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
            const avatarColor = user.avatarColor || '#00ccff';
            
            authButtons.innerHTML = `
                <div class="user-menu" id="userMenu">
                    <span class="user-name">${user.name}</span>
                    <div class="user-avatar" style="background: ${avatarColor}">
                        ${userInitial}
                    </div>
                </div>
            `;
            
            // Добавляем обработчик для меню пользователя
            const userMenu = document.getElementById('userMenu');
            if (userMenu) {
                userMenu.addEventListener('click', () => {
                    if (dashboardLink) dashboardLink.click();
                });
            }
        }
        
        if (dashboardLink) {
            dashboardLink.style.display = 'block';
            dashboardLink.innerHTML = `<i class="fas fa-user-circle"></i> ${user.name.split(' ')[0]}`;
        }
        
        // Обновляем заголовок в ЛК
        const greeting = document.getElementById('userGreeting');
        if (greeting) {
            greeting.textContent = `Добро пожаловать, ${user.name}!`;
            greeting.style.color = user.avatarColor || '#00ccff';
        }
    },

    showLoading(show, type) {
        const loginBtn = document.getElementById('submitLogin');
        const registerBtn = document.getElementById('submitRegister');
        
        if (type === 'login' && loginBtn) {
            if (show) {
                loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Вход...';
                loginBtn.disabled = true;
            } else {
                loginBtn.innerHTML = 'Войти';
                loginBtn.disabled = false;
            }
        }
        
        if (type === 'register' && registerBtn) {
            if (show) {
                registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Регистрация...';
                registerBtn.disabled = true;
            } else {
                registerBtn.innerHTML = 'Создать аккаунт';
                registerBtn.disabled = false;
            }
        }
    },

    showNotification(message, type = 'info') {
        // Удаляем существующие уведомления
        document.querySelectorAll('.notification').forEach(n => n.remove());
        
        // Создаем уведомление
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        const icon = type === 'success' ? 'check-circle' : 
                    type === 'error' ? 'exclamation-circle' : 
                    type === 'warning' ? 'exclamation-triangle' : 'info-circle';
        
        notification.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;
        
        // Стили для уведомления
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#2ed573' : 
                        type === 'error' ? '#ff4757' : 
                        type === 'warning' ? '#ffa502' : '#3742fa'};
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            z-index: 3000;
            animation: slideInRight 0.3s ease, slideOutRight 0.3s ease 2.7s;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            min-width: 300px;
            max-width: 400px;
            font-weight: 500;
        `;
        
        document.body.appendChild(notification);
        
        // Удаляем через 3 секунды
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
};

// Добавляем стили для анимаций уведомлений
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    .user-menu {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
        padding: 0.5rem 1rem;
        border-radius: 50px;
        background: rgba(255, 255, 255, 0.05);
        transition: all 0.3s ease;
    }
    
    .user-menu:hover {
        background: rgba(255, 255, 255, 0.1);
        transform: translateY(-2px);
    }
    
    .user-name {
        font-weight: 600;
        color: var(--text);
    }
    
    .user-avatar {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        color: #000;
        font-size: 1.2rem;
        box-shadow: 0 4px 10px rgba(0, 204, 255, 0.3);
        transition: all 0.3s ease;
    }
    
    .user-menu:hover .user-avatar {
        transform: scale(1.1);
        box-shadow: 0 6px 15px rgba(0, 204, 255, 0.5);
    }
`;
document.head.appendChild(notificationStyles);