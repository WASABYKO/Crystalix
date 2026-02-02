// app.js — Основной App объект - полностью рабочий, исправлен под HashStorage v3.1
// Все функции сохранены: showUserId, copyUserId, shareIdViaTelegram, generateQRCode
// handleLogin/handleRegister с полной обработкой ошибок, блокировкой кнопок, спиннерами
// Адаптеры, анимации, уведомления, лоадеры — всё на месте
// Исправлена ошибка "HashStorage.init is not a function" → теперь используем initialize()

if (typeof window.App === 'undefined') {
    window.App = {
        currentUser: null,
        tariffs: [],
        isAuthenticated: false,

        // Инициализация приложения — точка входа
        async init() {
            console.log('App.init запущен для страницы:', this.getCurrentPageType());

            try {
                // 1. Инициализируем менеджеры в правильном порядке (ожидаем завершения)
                await this.initManagers();

                // 2. Инициализируем глобальный лоадер
                const pageType = this.getCurrentPageType();
                if (typeof LoaderComponent !== 'undefined') {
                    LoaderComponent.init(pageType);
                    console.log('LoaderComponent инициализирован для:', pageType);
                }

                // 3. Безопасная инициализация HashStorage
                if (typeof HashStorage !== 'undefined') {
                    // Проверяем через SafeInitializer
                    if (window.SafeInitializer && SafeInitializer.isReady && SafeInitializer.isReady('HashStorage')) {
                        console.log('HashStorage уже инициализирован через SafeInitializer');
                    } else if (typeof HashStorage.initialize === 'function') {
                        const initResult = await HashStorage.initialize({ timeout: 15000 });
                        if (initResult.success) {
                            console.log('HashStorage.initialize() выполнен успешно');
                            if (initResult.user) {
                                this.currentUser = initResult.user;
                                this.isAuthenticated = true;
                            }
                        } else if (initResult.cached) {
                            console.log('HashStorage восстановлен из кеша');
                            this.currentUser = initResult.user;
                            this.isAuthenticated = true;
                        } else {
                            console.warn('HashStorage initialization warning:', initResult.error);
                            // Пробуем восстановить пользователя из localStorage
                            const cachedUser = localStorage.getItem('currentUser');
                            if (cachedUser) {
                                try {
                                    this.currentUser = JSON.parse(cachedUser);
                                    this.isAuthenticated = true;
                                    console.log('Пользователь восстановлен из localStorage:', this.currentUser.name);
                                } catch (e) {
                                    console.error('Ошибка восстановления пользователя:', e);
                                }
                            }
                        }
                    } else {
                        console.warn('HashStorage.initialize() не найден — возможно, уже инициализирован автоматически');
                    }
                    // Если пользователь ещё не установлен, пробуем из HashStorage
                    if (!this.currentUser && typeof HashStorage.getCurrentUser === 'function') {
                        this.currentUser = HashStorage.getCurrentUser();
                    }
                    this.isAuthenticated = !!this.currentUser;
                } else {
                    console.error('HashStorage не загружен!');
                }

                if (this.currentUser) {
                    console.log('👤 Авторизован пользователь:', this.currentUser.name || this.currentUser.email);
                } else {
                    console.log('⚠️ Пользователь не авторизован');
                }

                // 4. Инициализируем общие компоненты
                this.initCommonComponents();

                // 5. Защищённые страницы → редирект на auth если не залогинен
                const protectedPages = ['dashboard', 'messages', 'profile', 'tariffs'];
                if (protectedPages.includes(pageType) && !this.isAuthenticated) {
                    console.warn('Доступ запрещён — редирект на auth');
                    window.location.href = '/auth.html';
                    return;
                }

                // 6. Специфичная логика страницы
                await this.initPageSpecificLogic(pageType);

                // 7. Успешная загрузка — скрываем лоадер
                setTimeout(() => {
                    this.hideLoader();
                    this.initCommonAnimations();
                    console.log('✅ Приложение полностью инициализировано');
                }, 800);

            } catch (error) {
                console.error('❌ Критическая ошибка инициализации приложения:', error);
                this.hideLoader();
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.error('Ошибка загрузки приложения. Попробуйте обновить страницу.');
                } else {
                    alert('Ошибка загрузки приложения. Проверьте консоль.');
                }
            }
        },

        // Получение типа текущей страницы по пути
        getCurrentPageType() {
            const path = window.location.pathname.toLowerCase();
            if (path.includes('tariffs') || path === '/tariffs.html') return 'tariffs';
            if (path.includes('dashboard') || path === '/dashboard.html') return 'dashboard';
            if (path.includes('messages') || path === '/messages.html') return 'messages';
            if (path.includes('auth') || path === '/auth.html') return 'auth';
            if (path.includes('profile') || path === '/profile.html') return 'profile';
            return 'home';
        },

        // Инициализация менеджеров
        async initManagers() {
            console.log('Инициализация менеджеров...');

            // 0. TokenManager (должен быть инициализирован первым)
            if (typeof TokenManager !== 'undefined') {
                TokenManager.initialize();
                console.log('✅ TokenManager инициализирован');
            } else {
                console.warn('⚠️ TokenManager не найден');
            }

            // 1. SafeInitializer - регистрируем все компоненты
            if (typeof SafeInitializer !== 'undefined') {
                // Регистрируем компоненты приложения
                SafeInitializer.register('ConnectionManager', {
                    initFn: () => {
                        if (typeof ConnectionManager !== 'undefined') {
                            ConnectionManager.init();
                            return Promise.resolve();
                        }
                        return Promise.reject('ConnectionManager не найден');
                    },
                    priority: 10
                });

                SafeInitializer.register('AuthManager', {
                    initFn: () => {
                        if (typeof AuthManager !== 'undefined') {
                            return AuthManager.initialize();
                        }
                        return Promise.reject('AuthManager не найден');
                    },
                    dependencies: ['ConnectionManager'],
                    priority: 5
                });

                SafeInitializer.register('WebSocketManager', {
                    initFn: () => {
                        if (typeof window.WebSocketManager !== 'undefined') {
                            // Ждём инициализации AuthManager для получения токена
                            if (typeof AuthManager !== 'undefined' && AuthManager.getToken) {
                                const token = AuthManager.getToken();
                                if (token) {
                                    window.WebSocketManager.setAuthToken(token);
                                }
                            }
                            window.WebSocketManager.initialize();
                            return Promise.resolve();
                        }
                        return Promise.reject('WebSocketManager не найден');
                    },
                    dependencies: ['AuthManager'],
                    priority: 3
                });

                console.log('✅ SafeInitializer зарегистрирован');

                // 2. Инициализируем последовательно через SafeInitializer.initializeDeep
                // Это гарантирует правильный порядок с учётом зависимостей
                try {
                    console.log('[SafeInitializer] Начинаем инициализацию через initializeDeep...');
                    
                    // Сначала инициализируем ConnectionManager
                    await SafeInitializer.initialize('ConnectionManager');
                    console.log('✅ ConnectionManager инициализирован через SafeInitializer');
                    
                    // Затем AuthManager (зависит от ConnectionManager)
                    await SafeInitializer.initialize('AuthManager');
                    console.log('✅ AuthManager инициализирован через SafeInitializer');
                    
                    // Затем WebSocketManager (зависит от AuthManager)
                    await SafeInitializer.initialize('WebSocketManager');
                    console.log('✅ WebSocketManager инициализирован через SafeInitializer');
                    
                } catch (error) {
                    console.error('[SafeInitializer] Ошибка при инициализации:', error);
                    // Graceful degradation - пробуем direct initialization как fallback
                    this.initManagersFallback();
                }
            } else {
                // Fallback если SafeInitializer не доступен
                this.initManagersFallback();
            }
        },

        // Fallback инициализация менеджеров без SafeInitializer
        initManagersFallback() {
            console.log('Используем fallback инициализацию менеджеров...');
            
            // 1. ConnectionManager
            if (typeof ConnectionManager !== 'undefined') {
                ConnectionManager.init();
                console.log('✅ ConnectionManager инициализирован (fallback)');
            }

            // 2. AuthManager
            if (typeof AuthManager !== 'undefined') {
                AuthManager.initialize();
                console.log('✅ AuthManager инициализирован (fallback)');
            }

            // 3. WebSocketManager
            if (typeof window.WebSocketManager !== 'undefined') {
                window.WebSocketManager.initialize();
                console.log('✅ WebSocketManager инициализирован (fallback)');
            }

            // 4. CallManager (после WebSocketManager)
            if (typeof CallManager !== 'undefined') {
                console.log('✅ CallManager доступен (инициализируется автоматически)');
            }
        },

        // Инициализация общих компонентов (header, footer, theme и т.д.)
        initCommonComponents() {
            console.log('Инициализация общих компонентов...');

            if (typeof HeaderComponent !== 'undefined') {
                HeaderComponent.init?.();
                console.log('HeaderComponent инициализирован');
            }

            if (typeof FooterComponent !== 'undefined') {
                FooterComponent.init?.();
                console.log('FooterComponent инициализирован');
            }

            if (typeof ThemeManager !== 'undefined') {
                ThemeManager.init?.();
                console.log('ThemeManager инициализирован');
            }

            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.init?.();
                console.log('NotificationManager инициализирован');
            }

            // Адаптеры для совместимости
            this.setupHashStorageAdapter();
        },

        // Скрытие лоадера
        hideLoader() {
            const loader = document.getElementById('globalLoader');
            if (loader) {
                loader.style.opacity = '0';
                loader.style.transition = 'opacity 0.5s ease';
                setTimeout(() => {
                    loader.style.display = 'none';
                }, 500);
            }
        },

        // Адаптер для старого кода (authenticate, saveUser и т.д.)
        setupHashStorageAdapter() {
            console.log('🔄 Адаптер для HashStorage добавлен');

            window.authenticate = async (email, password) => {
                const res = await HashStorage.login(email, password);
                if (res.success) {
                    this.currentUser = res.user;
                    this.isAuthenticated = true;
                }
                return res;
            };

            window.saveUser = (user) => {
                this.currentUser = user;
                localStorage.setItem('currentUser', JSON.stringify(user));
                console.log('Пользователь сохранён в адаптере');
            };

            console.log('Адаптеры добавлены');
        },

        // Инициализация специфичной логики страницы
        async initPageSpecificLogic(pageType) {
            console.log('Инициализация страницы:', pageType);

            switch (pageType) {
                case 'home':
                    await this.initHomePage();
                    break;
                case 'tariffs':
                    await this.initTariffsPage();
                    break;
                case 'dashboard':
                    await this.initDashboardPage();
                    break;
                case 'messages':
                    await this.initMessagesPage();
                    break;
                case 'auth':
                    await this.initAuthPage();
                    break;
                default:
                    console.warn('Неизвестный тип страницы:', pageType);
            }
        },

        // Инициализация главной страницы
        async initHomePage() {
            console.log('Инициализация главной страницы');
            return new Promise(resolve => {
                setTimeout(() => {
                    this.initScrollAnimations();
                    resolve();
                }, 500);
            });
        },

        // Инициализация страницы тарифов
        async initTariffsPage() {
            console.log('Инициализация страницы тарифов');
            return new Promise(resolve => {
                this.loadTariffs();
                this.renderTariffs();
                this.initTariffsSwitcher();
                this.initFaqAccordion();
                setTimeout(resolve, 500);
            });
        },

        // Инициализация личного кабинета
        async initDashboardPage() {
            console.log('Инициализация личного кабинета');
            
            // Дожидаемся инициализации HashStorage
            if (typeof HashStorage !== 'undefined' && typeof HashStorage.initialize === 'function') {
                await HashStorage.initialize();
            }
            
            return new Promise(resolve => {
                const user = this.getCurrentUser();
                console.log('Текущий пользователь в dashboard:', user);
                
                if (!user) {
                    console.log('Пользователь не авторизован, редирект на auth');
                    window.location.href = 'auth.html';
                    return resolve();
                }

                this.currentUser = user;
                
                // Инициализируем DashboardModule
                if (typeof DashboardModule !== 'undefined') {
                    DashboardModule.init();
                    console.log('✅ DashboardModule инициализирован');
                } else {
                    console.warn('DashboardModule не найден');
                }
                
                this.initDashboardTabs();
                this.updateUserProfile(user);
                this.initDashboardEvents();
                this.showUserId(); // Показываем ID пользователя
                setTimeout(resolve, 500);
            });
        },

        // Инициализация страницы сообщений
        async initMessagesPage() {
            console.log('Инициализация страницы сообщений');
            return new Promise(resolve => {
                // Мессенджер инициализируется самостоятельно в messages.js
                console.log('✅ Страница сообщений инициализирована');
                setTimeout(resolve, 500);
            });
        },

        // Инициализация страницы авторизации
        async initAuthPage() {
            console.log('Инициализация страницы авторизации');
            return new Promise(resolve => {
                // Не делаем редирект здесь, т.к. пользователь может хотеть выйти
                // Редирект происходит только после успешного логина
                this.initAuthTabs();
                this.initPasswordStrength();
                this.initAuthEvents();
                
                // Инициализируем AuthModule если доступен
                if (typeof AuthModule !== 'undefined' && AuthModule.init) {
                    AuthModule.init();
                    console.log('AuthModule инициализирован');
                }
                
                setTimeout(resolve, 500);
            });
        },

        // Получение текущего пользователя
        getCurrentUser() {
            if (typeof HashStorage !== 'undefined') {
                return HashStorage.getCurrentUser();
            }
            return null;
        },

        // ========== ФУНКЦИОНАЛ ID ПОЛЬЗОВАТЕЛЯ ==========

        showUserId() {
            if (!this.currentUser) return;

            // Обновляем ID в шапке если есть
            const userMenu = document.querySelector('.user-menu-dropdown');
            if (userMenu) {
                let userIdElement = userMenu.querySelector('.user-id');
                if (!userIdElement) {
                    userIdElement = document.createElement('div');
                    userIdElement.className = 'user-id';
                    userIdElement.innerHTML = `
                        <small style="color: var(--text-secondary);">ID: </small>
                        <code style="font-size: 0.8rem;">${this.currentUser.id}</code>
                    `;
                    const dropdownHeader = userMenu.querySelector('.dropdown-header');
                    if (dropdownHeader) {
                        dropdownHeader.appendChild(userIdElement);
                    }
                }
            }

            // Обновляем ID в личном кабинете
            const userIdDisplay = document.getElementById('userId');
            if (userIdDisplay) {
                userIdDisplay.textContent = this.currentUser.id;

                // Добавляем кнопку копирования
                const copyBtn = document.getElementById('copyUserIdBtn');
                if (copyBtn) {
                    copyBtn.onclick = () => this.copyUserId();
                }

                // Добавляем кнопки для быстрого обмена
                this.addShareButtons();
            }
        },

        copyUserId() {
            if (!this.currentUser) return;

            navigator.clipboard.writeText(this.currentUser.id)
                .then(() => {
                    this.showNotification('ID скопирован в буфер обмена!', 'success');

                    const copyBtn = document.getElementById('copyUserIdBtn');
                    if (copyBtn) {
                        const originalHTML = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<i class="fas fa-check"></i> Скопирован!';
                        copyBtn.classList.add('copied');

                        setTimeout(() => {
                            copyBtn.innerHTML = originalHTML;
                            copyBtn.classList.remove('copied');
                        }, 2000);
                    }
                })
                .catch(err => {
                    console.error('Ошибка копирования:', err);
                    this.showNotification('Ошибка копирования', 'error');
                });
        },

        addShareButtons() {
            const shareContainer = document.getElementById('shareIdButtons');
            if (!shareContainer || !this.currentUser) return;

            shareContainer.innerHTML = `
                <button class="share-id-btn telegram" onclick="App.shareIdViaTelegram()">
                    <i class="fab fa-telegram"></i> Поделиться в Telegram
                </button>
                <button class="share-id-btn whatsapp" onclick="App.shareIdViaWhatsApp()">
                    <i class="fab fa-whatsapp"></i> Поделиться в WhatsApp
                </button>
                <button class="share-id-btn" onclick="App.generateQRCode()">
                    <i class="fas fa-qrcode"></i> QR-код
                </button>
            `;
        },

        shareIdViaTelegram() {
            if (!this.currentUser) return;

            const text = `Мой ID в TechTariff: ${this.currentUser.id}\nДобавь меня в друзья!`;
            const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(text)}`;
            window.open(url, '_blank');
        },

        shareIdViaWhatsApp() {
            if (!this.currentUser) return;

            const text = `Мой ID в TechTariff: ${this.currentUser.id}\nДобавь меня в друзья!`;
            const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
            window.open(url, '_blank');
        },

        generateQRCode() {
            if (!this.currentUser) return;

            const qrContainer = document.getElementById('qrCodeContainer');
            if (!qrContainer) return;

            const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(this.currentUser.id)}&choe=UTF-8`;

            qrContainer.innerHTML = `
                <div class="qr-modal">
                    <div class="qr-content">
                        <h3>QR-код вашего ID</h3>
                        <img src="${qrUrl}" alt="QR Code" style="width: 200px; height: 200px;">
                        <p><code>${this.currentUser.id}</code></p>
                        <button class="btn btn-primary" onclick="this.closest('.qr-modal').remove()">
                            <i class="fas fa-times"></i> Закрыть
                        </button>
                    </div>
                </div>
            `;
        },

        showNotification(message, type = 'info') {
            document.querySelectorAll('.notification').forEach(n => n.remove());

            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            notification.innerHTML = `
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            `;

            document.body.appendChild(notification);

            setTimeout(() => notification.classList.add('show'), 10);

            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        },

        // ========== ФУНКЦИОНАЛ ТАРИФОВ ==========

        loadTariffs() {
            this.tariffs = [
                {
                    id: 'free',
                    name: 'Бесплатный',
                    monthlyPrice: 0,
                    yearlyPrice: 0,
                    period: 'месяц',
                    popular: false,
                    features: [
                        'До 100 запросов в день',
                        'Базовая аналитика',
                        'Поддержка по email',
                        '1 пользователь'
                    ],
                    description: 'Для тестирования платформы',
                    icon: 'fas fa-gem'
                },
                {
                    id: 'basic',
                    name: 'Базовый',
                    monthlyPrice: 990,
                    yearlyPrice: 9500,
                    period: 'месяц',
                    popular: true,
                    features: [
                        'До 1000 запросов в день',
                        'Расширенная аналитика',
                        'Приоритетная поддержка',
                        'До 5 пользователей',
                        'API доступ'
                    ],
                    description: 'Для небольших проектов',
                    icon: 'fas fa-rocket'
                },
                {
                    id: 'pro',
                    name: 'Профессиональный',
                    monthlyPrice: 2990,
                    yearlyPrice: 28700,
                    period: 'месяц',
                    popular: false,
                    features: [
                        'Неограниченные запросы',
                        'Продвинутая аналитика',
                        '24/7 поддержка',
                        'До 20 пользователей',
                        'Полный API доступ',
                        'Индивидуальные интеграции'
                    ],
                    description: 'Для бизнеса',
                    icon: 'fas fa-crown'
                }
            ];
        },

        // Рендеринг тарифов
        renderTariffs() {
            const container = document.getElementById('tariffsContainer');
            if (!container || !this.tariffs) return;

            container.innerHTML = this.tariffs.map(tariff => `
                <div class="tariff-card ${tariff.popular ? 'popular' : ''}">
                    ${tariff.popular ? '<span class="tariff-badge">Популярный</span>' : ''}
                    
                    <div class="tariff-icon">
                        <i class="${tariff.icon}"></i>
                    </div>
                    
                    <h3 class="tariff-name">${tariff.name}</h3>
                    <p class="tariff-description">${tariff.description}</p>
                    
                    <div class="tariff-price">
                        <span class="price-monthly">${tariff.monthlyPrice === 0 ? 'Бесплатно' : `${tariff.monthlyPrice} ₽`}</span>
                        <span class="tariff-period">/месяц</span>
                    </div>
                    
                    <ul class="tariff-features">
                        ${tariff.features.map(feature => `
                            <li><i class="fas fa-check"></i> ${feature}</li>
                        `).join('')}
                    </ul>
                    
                    <button class="btn ${tariff.popular ? 'btn-primary' : 'btn-outline'} btn-block">
                        ${tariff.monthlyPrice === 0 ? 'Начать бесплатно' : 'Выбрать тариф'}
                    </button>
                </div>
            `).join('');
        },

        // Инициализация переключателя тарифов
        initTariffsSwitcher() {
            const switcher = document.querySelector('.tariffs-switch');
            if (!switcher) return;

            const buttons = switcher.querySelectorAll('.switch-btn');
            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    buttons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
        },

        // Инициализация FAQ аккордеона
        initFaqAccordion() {
            const faqItems = document.querySelectorAll('.faq-item');
            faqItems.forEach(item => {
                const question = item.querySelector('.faq-question');
                if (question) {
                    question.addEventListener('click', () => {
                        item.classList.toggle('active');
                    });
                }
            });
        },

        // ========== ЛИЧНЫЙ КАБИНЕТ ==========

        // Инициализация вкладок дашборда
        initDashboardTabs() {
            const tabLinks = document.querySelectorAll('.nav-item[data-tab]');
            const tabs = document.querySelectorAll('.dashboard-tab');

            tabLinks.forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const tabId = link.getAttribute('data-tab');

                    // Убираем активный класс у всех
                    tabLinks.forEach(l => l.classList.remove('active'));
                    tabs.forEach(t => t.classList.remove('active'));

                    // Добавляем активный класс
                    link.classList.add('active');
                    const activeTab = document.getElementById(`${tabId}Tab`);
                    if (activeTab) activeTab.classList.add('active');
                });
            });
        },

        // Обновление профиля пользователя
        updateUserProfile(user) {
            if (!user) return;

            // Обновление аватара
            const avatarLarge = document.getElementById('userAvatarLarge');
            if (avatarLarge) {
                if (user.avatar && typeof user.avatar === 'object' && user.avatar.original) {
                    avatarLarge.innerHTML = `<img src="${user.avatar.original}" alt="${user.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    avatarLarge.style.background = 'transparent';
                } else if (user.avatar && typeof user.avatar === 'string') {
                    avatarLarge.innerHTML = `<img src="${user.avatar}" alt="${user.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    avatarLarge.style.background = 'transparent';
                } else {
                    const initial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
                    avatarLarge.innerHTML = initial;
                    avatarLarge.style.background = user.avatarColor || user.avatar_color || '#00ccff';
                }
            }

            // Обновление приветствия
            const welcomeTitle = document.getElementById('userWelcomeTitle');
            if (welcomeTitle) {
                welcomeTitle.textContent = `Добро пожаловать, ${user.name}!`;
            }

            // Обновление email
            const userEmail = document.getElementById('userEmail');
            if (userEmail) {
                userEmail.textContent = user.email;
            }

            // Обновление статуса
            const userStatus = document.getElementById('userStatus');
            if (userStatus) {
                userStatus.textContent = 'Авторизован';
                userStatus.className = 'status-badge active';
            }

            // Обновление тарифа
            const tariffBadge = document.getElementById('userTariffBadge');
            if (tariffBadge) {
                const tariffNames = {
                    'free': 'Бесплатный',
                    'basic': 'Базовый',
                    'pro': 'Профессиональный'
                };
                tariffBadge.textContent = tariffNames[user.tariff] || 'Неизвестно';
            }
        },

        // Инициализация событий дашборда
        initDashboardEvents() {
            // Кнопка улучшения тарифа
            const upgradeBtn = document.getElementById('upgradeBtn');
            if (upgradeBtn) {
                upgradeBtn.addEventListener('click', () => {
                    window.location.href = 'tariffs.html';
                });
            }

            // Кнопка поддержки
            const supportBtn = document.getElementById('supportBtn');
            if (supportBtn) {
                supportBtn.addEventListener('click', () => {
                    this.showNotification('Функция поддержки будет реализована в будущем', 'info');
                });
            }

            // Кнопка выхода
            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    if (typeof HashStorage !== 'undefined' && HashStorage.logout) {
                        HashStorage.logout();
                        window.location.href = 'auth.html';
                    }
                });
            }

            // Кнопка изменения аватарки
            const changeAvatarBtn = document.getElementById('changeAvatarBtn');
            if (changeAvatarBtn) {
                changeAvatarBtn.addEventListener('click', () => this.showAvatarModal());
            }

            // Загрузка аватарки
            const avatarInput = document.getElementById('avatarInput');
            if (avatarInput) {
                avatarInput.addEventListener('change', (e) => this.handleAvatarSelect(e));
            }

            // Drag and drop
            const uploadArea = document.getElementById('uploadArea');
            if (uploadArea) {
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
                    const file = e.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                        this.previewAvatar(file);
                    }
                });
            }

            // Сохранение аватарки
            const saveAvatarBtn = document.getElementById('saveAvatarBtn');
            if (saveAvatarBtn) {
                saveAvatarBtn.addEventListener('click', () => this.uploadAvatar());
            }
        },

        // ========== АВАТАРКА ==========

        showAvatarModal() {
            const modal = document.getElementById('avatarModal');
            if (!modal) return;
            
            // Показываем текущий аватар
            this.updateAvatarPreview();
            
            modal.classList.add('active');
            
            // Закрытие по клику вне модального окна
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeAvatarModal();
            });
        },

        closeAvatarModal() {
            const modal = document.getElementById('avatarModal');
            if (modal) {
                modal.classList.remove('active');
                this.resetAvatarForm();
            }
        },

        updateAvatarPreview() {
            const preview = document.getElementById('avatarPreview');
            const user = this.currentUser;
            
            if (!preview || !user) return;
            
            if (user.avatar && typeof user.avatar === 'object' && user.avatar.original) {
                preview.innerHTML = `<img src="${user.avatar.original}" alt="Аватар" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                preview.style.background = 'transparent';
            } else if (user.avatar && typeof user.avatar === 'string') {
                preview.innerHTML = `<img src="${user.avatar}" alt="Аватар" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                preview.style.background = 'transparent';
            } else {
                const initial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
                preview.innerHTML = `<span style="font-size: 3rem; font-weight: bold; color: #fff;">${initial}</span>`;
                preview.style.background = user.avatar_color || '#00ccff';
            }
        },

        handleAvatarSelect(event) {
            const file = event.target.files[0];
            if (file) {
                this.previewAvatar(file);
            }
        },

        previewAvatar(file) {
            if (file.size > 5 * 1024 * 1024) {
                this.showNotification('Размер файла не должен превышать 5 МБ', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = document.getElementById('avatarPreview');
                if (preview) {
                    preview.innerHTML = `<img src="${e.target.result}" alt="Превью" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    preview.style.background = 'transparent';
                }
                
                const saveBtn = document.getElementById('saveAvatarBtn');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.dataset.avatarData = e.target.result;
                }
            };
            reader.readAsDataURL(file);
        },

        async uploadAvatar() {
            const saveBtn = document.getElementById('saveAvatarBtn');
            if (!saveBtn || !saveBtn.dataset.avatarData) return;
            
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
            
            try {
                // Конвертируем base64 в Blob
                const base64Data = saveBtn.dataset.avatarData.split(',')[1];
                const binaryData = atob(base64Data);
                const bytes = new Uint8Array(binaryData.length);
                for (let i = 0; i < binaryData.length; i++) {
                    bytes[i] = binaryData.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: 'image/jpeg' });
                
                const formData = new FormData();
                formData.append('avatar', blob, 'avatar.jpg');
                
                const token = localStorage.getItem('techtariff_auth_token') || (HashStorage.token || '');
                if (!token) {
                    throw new Error('Токен авторизации не найден');
                }
                
                const response = await fetch('/api/profile/avatar', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.showNotification('Аватар успешно загружен!', 'success');
                    
                    // Обновляем локального пользователя
                    if (this.currentUser) {
                        this.currentUser.avatar = result.avatar;
                        localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
                        
                        // Обновляем в HashStorage если доступен
                        if (typeof HashStorage !== 'undefined' && HashStorage.updateUser) {
                            HashStorage.updateUser(this.currentUser.id, { avatar: result.avatar });
                        }
                    }
                    
                    // Обновляем отображение
                    this.updateUserProfile(this.currentUser);
                    this.updateAvatarPreview();
                    
                    // Обновляем аватарку в чатах через localStorage
                    localStorage.setItem('userAvatarUpdated', Date.now().toString());
                    
                    // Закрываем модальное окно
                    this.closeAvatarModal();
                } else {
                    throw new Error(result.message || 'Ошибка загрузки');
                }
            } catch (error) {
                console.error('Ошибка загрузки аватарки:', error);
                this.showNotification(error.message || 'Ошибка загрузки аватарки', 'error');
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> Сохранить аватар';
                }
            }
        },

        resetAvatarForm() {
            const avatarInput = document.getElementById('avatarInput');
            const saveBtn = document.getElementById('saveAvatarBtn');
            
            if (avatarInput) avatarInput.value = '';
            if (saveBtn) {
                saveBtn.disabled = true;
                delete saveBtn.dataset.avatarData;
            }
            
            this.updateAvatarPreview();
        },

        // ========== АВТОРИЗАЦИЯ ==========

        // Инициализация табов авторизации
        initAuthTabs() {
            const tabs = document.querySelectorAll('.auth-tab');
            const forms = document.querySelectorAll('.auth-form');

            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const tabName = tab.getAttribute('data-tab');

                    // Обновляем активные табы
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Показываем нужную форму
                    forms.forEach(form => {
                        form.classList.remove('active');
                        if (form.id === `${tabName}Form`) {
                            form.classList.add('active');
                        }
                    });
                });
            });
        },

        // Инициализация проверки сложности пароля
        initPasswordStrength() {
            const passwordInput = document.getElementById('registerPassword');
            if (!passwordInput) return;

            passwordInput.addEventListener('input', (e) => {
                const password = e.target.value;
                const strengthBar = document.querySelector('.strength-bar');
                const strengthText = document.querySelector('.strength-text');

                if (!strengthBar || !strengthText) return;

                let strength = 0;
                let color = '#ff4757';
                let text = 'Слабый';

                if (password.length >= 8) strength++;
                if (/[A-Z]/.test(password)) strength++;
                if (/[0-9]/.test(password)) strength++;
                if (/[^A-Za-z0-9]/.test(password)) strength++;

                switch(strength) {
                    case 1:
                        color = '#ff4757';
                        text = 'Слабый';
                        break;
                    case 2:
                        color = '#ffa502';
                        text = 'Средний';
                        break;
                    case 3:
                        color = '#2ed573';
                        text = 'Хороший';
                        break;
                    case 4:
                        color = '#00ccff';
                        text = 'Отличный';
                        break;
                }

                strengthBar.style.width = `${strength * 25}%`;
                strengthBar.style.background = color;
                strengthText.textContent = text;
                strengthText.style.color = color;
            });
        },

        // Инициализация событий авторизации
        initAuthEvents() {
            // Показать/скрыть пароль
            document.querySelectorAll('.show-password').forEach(button => {
                button.addEventListener('click', (e) => {
                    const btn = e.target.closest('button');
                    if (!btn) return;

                    const targetId = btn.getAttribute('data-target');
                    const input = document.getElementById(targetId);
                    const icon = btn.querySelector('i');

                    if (!input || !icon) return;

                    if (input.type === 'password') {
                        input.type = 'text';
                        icon.className = 'fas fa-eye-slash';
                    } else {
                        input.type = 'password';
                        icon.className = 'fas fa-eye';
                    }
                });
            });

            // Отправка формы входа
            const submitLogin = document.getElementById('submitLogin');
            if (submitLogin) {
                submitLogin.addEventListener('click', async () => {
                    await this.handleLogin();
                });
            }

            // Отправка формы регистрации
            const submitRegister = document.getElementById('submitRegister');
            if (submitRegister) {
                submitRegister.addEventListener('click', async () => {
                    await this.handleRegister();
                });
            }

            // Ввод Enter в формах
            const loginForm = document.getElementById('loginForm');
            if (loginForm) {
                loginForm.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.handleLogin();
                    }
                });
            }

            const registerForm = document.getElementById('registerForm');
            if (registerForm) {
                registerForm.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.handleRegister();
                    }
                });
            }
        },

        // Обработка входа - ИСПРАВЛЕНА
        async handleLogin() {
            const emailInput = document.getElementById('loginEmail');
            const passwordInput = document.getElementById('loginPassword');

            if (!emailInput || !passwordInput) return;

            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                this.showNotification('Заполните все поля', 'error');
                return;
            }

            const submitBtn = document.getElementById('submitLogin');
            if (!submitBtn) return;

            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Вход...';
            submitBtn.disabled = true;

            try {
                // Проверяем состояние сети
                if (window.ConnectionManager) {
                    const status = ConnectionManager.getStatus();
                    if (!status.isOnline) {
                        throw new Error('Нет подключения к интернету');
                    }
                }

                // Проверяем блокировку входа
                if (window.AuthManager && AuthManager.isLoginBlocked()) {
                    const state = AuthManager.getState();
                    const remaining = Math.ceil((loginBlockTime - Date.now()) / 1000);
                    this.showNotification(`Слишком много попыток. Попробуйте через ${remaining} сек.`, 'error');
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false;
                    return;
                }

                if (typeof HashStorage !== 'undefined' && HashStorage.login) {
                    console.log('🔑 Попытка входа:', email);
                    const result = await HashStorage.login(email, password);

                    if (result.success) {
                        console.log('✅ Вход успешен:', result.user?.id);
                        this.showNotification('Вход выполнен успешно!', 'success');

                        setTimeout(() => {
                            window.location.href = 'dashboard.html';
                        }, 1000);
                    } else {
                        // Проверяем, заблокирован ли вход
                        if (result.blocked) {
                            this.showNotification(result.error.message, 'error');
                        } else if (result.networkError) {
                            this.showNotification('Ошибка соединения. Проверьте интернет.', 'error');
                        } else {
                            console.log('❌ Ошибка входа:', result.message);
                            this.showNotification(result.message || 'Ошибка при входе', 'error');
                        }
                        submitBtn.innerHTML = originalText;
                        submitBtn.disabled = false;
                    }
                } else {
                    this.showNotification('Система авторизации недоступна', 'error');
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                console.error('❌ Ошибка при входе:', error);
                
                // Обрабатываем ошибку через ConnectionManager
                if (window.ConnectionManager) {
                    await ConnectionManager.handleConnectionError(error);
                }
                
                this.showNotification('Ошибка при входе', 'error');
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        },

        // Обработка регистрации - ИСПРАВЛЕНА
        async handleRegister() {
            const nameInput = document.getElementById('registerName');
            const emailInput = document.getElementById('registerEmail');
            const passwordInput = document.getElementById('registerPassword');
            const confirmPasswordInput = document.getElementById('confirmPassword');
            const acceptTermsInput = document.getElementById('acceptTerms');

            if (!nameInput || !emailInput || !passwordInput || !confirmPasswordInput || !acceptTermsInput) return;

            const name = nameInput.value.trim();
            const email = emailInput.value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;
            const acceptTerms = acceptTermsInput.checked;

            if (!name || !email || !password || !confirmPassword) {
                this.showNotification('Заполните все поля', 'error');
                return;
            }

            if (!acceptTerms) {
                this.showNotification('Примите условия использования', 'error');
                return;
            }

            if (password.length < 6) {
                this.showNotification('Пароль должен быть не менее 6 символов', 'error');
                return;
            }

            if (password !== confirmPassword) {
                this.showNotification('Пароли не совпадают', 'error');
                return;
            }

            const submitBtn = document.getElementById('submitRegister');
            if (!submitBtn) return;

            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Регистрация...';
            submitBtn.disabled = true;

            try {
                if (typeof HashStorage !== 'undefined' && HashStorage.register) {
                    console.log('🔄 Регистрация пользователя:', email);
                    const result = await HashStorage.register(name, email, password);

                    if (result.success) {
                        console.log('✅ Регистрация успешна:', result.user?.id);
                        this.showNotification('Регистрация прошла успешно!', 'success');

                        // Автоматический вход после регистрации
                        setTimeout(async () => {
                            const loginResult = await HashStorage.login(email, password);
                            if (loginResult.success) {
                                window.location.href = 'dashboard.html';
                            }
                        }, 1000);
                    } else {
                        console.log('❌ Ошибка регистрации:', result.message);
                        this.showNotification(result.message || 'Ошибка при регистрации', 'error');
                        submitBtn.innerHTML = originalText;
                        submitBtn.disabled = false;
                    }
                } else {
                    this.showNotification('Система регистрации недоступна', 'error');
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                console.error('❌ Ошибка при регистрации:', error);
                this.showNotification('Ошибка при регистрации', 'error');
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        },

        // ========== АНИМАЦИИ И ОБЩИЕ ФУНКЦИИ ==========

        initCommonAnimations() {
            this.initScrollAnimations();
        },

        // Инициализация анимаций при скролле
        initScrollAnimations() {
            if (!('IntersectionObserver' in window)) return;

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('fade-in');
                    }
                });
            }, { threshold: 0.1 });

            document.querySelectorAll('.tariff-card, .feature-item, .about-card').forEach(el => {
                observer.observe(el);
            });
        },

        // Загрузка дополнительных компонентов
        loadAdditionalComponents() {
            // Загружаем только если нужно
            if (this.getCurrentPageType() === 'dashboard') {
                // Загружаем мессенджер если есть
                if (typeof window.messenger === 'undefined') {
                    const script = document.createElement('script');
                    script.src = 'js/messages.js';
                    script.async = true;
                    document.body.appendChild(script);
                }
            }
        }
    };
}

// Добавляем CSS для анимаций и уведомлений
(function addAnimationStyles() {
    if (document.querySelector('style[data-app-styles]')) return;

    const animationStyles = document.createElement('style');
    animationStyles.setAttribute('data-app-styles', 'true');
    animationStyles.textContent = `
        .fade-in {
            animation: fadeIn 0.5s ease forwards;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            background: white;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            transform: translateX(120%);
            transition: transform 0.3s ease;
            z-index: 10000;
            max-width: 350px;
        }

        .notification.show {
            transform: translateX(0);
        }

        .notification-success {
            border-left: 4px solid #2ed573;
            color: #155724;
            background: #d4edda;
        }

        .notification-error {
            border-left: 4px solid #ff4757;
            color: #721c24;
            background: #f8d7da;
        }

        .notification-info {
            border-left: 4px solid #00ccff;
            color: #004085;
            background: #cce5ff;
        }

        .notification i {
            font-size: 1.2rem;
        }

        .share-id-btn {
            margin: 5px;
            padding: 8px 15px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: opacity 0.3s;
            font-size: 0.9rem;
        }

        .share-id-btn:hover {
            opacity: 0.9;
        }

        .share-id-btn.telegram {
            background: #0088cc;
            color: white;
        }

        .share-id-btn.whatsapp {
            background: #25D366;
            color: white;
        }

        .qr-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .qr-content {
            background: white;
            padding: 30px;
            border-radius: 12px;
            text-align: center;
            max-width: 300px;
            width: 90%;
        }

        .copied {
            background-color: #2ed573 !important;
            color: white !important;
        }
    `;
    document.head.appendChild(animationStyles);
})();

// Адаптер для обратной совместимости (на всякий случай)
(function setupCompatibility() {
    if (typeof HashStorage !== 'undefined') {
        // Сохраняем старые названия методов для обратной совместимости
        if (HashStorage.login && !HashStorage.authenticate) {
            HashStorage.authenticate = HashStorage.login;
            console.log('🔄 Адаптер: authenticate добавлен');
        }

        if (HashStorage.register && !HashStorage.saveUser) {
            HashStorage.saveUser = HashStorage.register;
            console.log('🔄 Адаптер: saveUser добавлен');
        }

        if (HashStorage.getCurrentUser && !HashStorage.getCurrentUser) {
            console.log('✅ HashStorage.getCurrentUser доступен');
        }
    }
})();

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM загружен, запускаем инициализацию...');

    // Глобальный обработчик для скрытия лоадера при ошибках
    window.addEventListener('error', function(e) {
        console.log('Обнаружена ошибка JavaScript:', e.message);
        setTimeout(() => {
            const loader = document.getElementById('globalLoader');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => {
                    loader.style.display = 'none';
                }, 500);
            }
        }, 500);
    });

    // Инициализируем приложение с небольшой задержкой
    setTimeout(() => {
        try {
            if (typeof App !== 'undefined') {
                App.init();
            } else {
                console.error('App не определен');
                const loader = document.getElementById('globalLoader');
                if (loader) loader.style.display = 'none';
            }
        } catch (error) {
            console.error('Критическая ошибка при инициализации:', error);
            // Принудительно скрываем лоадер
            const loader = document.getElementById('globalLoader');
            if (loader) {
                loader.style.display = 'none';
            }
        }
    }, 100);
});

// Резервный таймер - гарантированно скрываем лоадер через 5 секунд
setTimeout(() => {
    const loader = document.getElementById('globalLoader');
    if (loader && loader.style.display !== 'none') {
        console.log('Резервное скрытие лоадера через 5 секунд');
        loader.style.opacity = '0';
        loader.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }
}, 5000);