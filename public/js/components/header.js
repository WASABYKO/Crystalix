/**
 * HeaderComponent v2.0 — Компонент шапки сайта
 */

const HeaderComponent = (function() {
    'use strict';

    // Инициализация
    function init() {
        const headerElement = document.getElementById('siteHeader');
        if (!headerElement) {
            console.warn('Header element not found');
            return;
        }

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
                                    <button class="btn btn-outline btn-sm" id="logoutBtn">
                                        <i class="fas fa-sign-out-alt"></i> Выход
                                    </button>
                                </div>
                            ` : `
                                <a href="/auth.html" class="btn btn-primary btn-sm">
                                    <i class="fas fa-sign-in-alt"></i> Вход
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
