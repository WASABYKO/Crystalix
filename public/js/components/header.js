/**
 * HeaderComponent v2.0 — Компонент шапки сайта
 */

const HeaderComponent = (function() {
    'use strict';

    let lastScrollTop = 0;
    let scrollThreshold = 10;
    let isInitialized = false;

    // Инициализация
    function init() {
        const headerElement = document.getElementById('siteHeader');
        if (!headerElement) {
            console.warn('Header element not found');
            return;
        }

        isInitialized = true;

        // Проверка авторизации
        const currentUser = typeof HashStorage !== 'undefined' ? HashStorage.getCurrentUser() : null;
        const isAuthenticated = !!currentUser;

        headerElement.innerHTML = `
            <header class="site-header">
                <div class="container">
                    <div class="header-content">
                        <a href="/messages.html" class="header-logo">
                            <i class="fas fa-bolt"></i>
                            <span>TechTariff</span>
                        </a>
                        
                        <nav class="header-nav">
                            <a href="/messages.html" class="nav-link ${window.location.pathname.includes('messages') ? 'active' : ''}">
                                <i class="fas fa-comments"></i> Чаты
                            </a>
                            <a href="/dashboard.html" class="nav-link ${window.location.pathname.includes('dashboard') ? 'active' : ''}">
                                <i class="fas fa-user-circle"></i> Кабинет
                            </a>
                            <a href="/tariffs.html" class="nav-link ${window.location.pathname.includes('tariffs') ? 'active' : ''}">
                                <i class="fas fa-tags"></i> Тарифы
                            </a>
                        </nav>
                        
                        <div class="header-actions">
                            ${isAuthenticated ? `
                                <div class="user-info">
                                    <span class="user-name">${currentUser.name || currentUser.email}</span>
                                    <div class="user-avatar" style="background: ${currentUser.avatar_color || '#00ccff'}">
                                        ${(currentUser.name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <button class="btn-exit btn-sm" id="logoutBtn">
                                        <i class="fas fa-sign-out-alt"></i>
                                        <span>Выход</span>
                                    </button>
                                </div>
                            ` : `
                                <a href="/auth.html" class="btn-enter">
                                    <i class="fas fa-sign-in-alt"></i>
                                    <span>Вход</span>
                                </a>
                            `}
                        </div>
                    </div>
                </div>
            </header>
        `;

        // Привязка событий
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }

        // Инициализировать скролл-хендлер
        initScrollHandler();
    }

    // Обработка скролла - хедер прячется при скролле вниз, показывается при скролле вверх
    function initScrollHandler() {
        const headerElement = document.getElementById('siteHeader');
        if (!headerElement) return;

        let lastScrollTop = 0;
        const delta = 5;

        function handleScroll() {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

            // Добавить класс scrolled при наличии скролла
            if (scrollTop > 50) {
                headerElement.classList.add('scrolled');
            } else {
                headerElement.classList.remove('scrolled');
            }

            // Прячем хедер при скролле вниз, показываем при скролле вверх
            if (Math.abs(lastScrollTop - scrollTop) <= delta) return;

            if (scrollTop > lastScrollTop && scrollTop > 100) {
                // Скролл вниз - прячем хедер
                headerElement.classList.remove('visible');
                headerElement.classList.add('hidden');
            } else {
                // Скролл вверх - показываем хедер
                headerElement.classList.remove('hidden');
                headerElement.classList.add('visible');
            }

            lastScrollTop = scrollTop;
        }

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll(); // Проверить начальное состояние
    }

    // Выход из системы
    function handleLogout() {
        if (typeof HashStorage !== 'undefined') {
            HashStorage.logout();
        }
        window.location.href = '/auth.html';
    }

    // Обновление состояния (после авторизации/выхода)
    function updateAuthState(user) {
        const headerElement = document.getElementById('siteHeader');
        if (headerElement) {
            init();
        }
    }

    // Публичный API
    return {
        init,
        updateAuthState
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.HeaderComponent = HeaderComponent;
    console.log('🏠 HeaderComponent v2.0 загружен');
}
