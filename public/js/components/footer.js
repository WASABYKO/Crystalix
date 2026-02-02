/**
 * FooterComponent v2.0 — Компонент подвала сайта
 */

const FooterComponent = (function() {
    'use strict';

    // Инициализация
    function init() {
        const footerElement = document.getElementById('siteFooter');
        if (!footerElement) {
            console.warn('Footer element not found');
            return;
        }

        const currentYear = new Date().getFullYear();

        footerElement.innerHTML = `
            <footer class="site-footer">
                <div class="container">
                    <div class="footer-content">
                        <div class="footer-section">
                            <h4><i class="fas fa-bolt"></i> TechTariff</h4>
                            <p>Современная платформа для управления тарифами и коммуникациями.</p>
                        </div>
                        
                        <div class="footer-section">
                            <h4>Навигация</h4>
                            <nav class="footer-nav">
                                <a href="/messages.html">Мессенджер</a>
                                <a href="/dashboard.html">Личный кабинет</a>
                                <a href="/tariffs.html">Тарифы</a>
                            </nav>
                        </div>
                        
                        <div class="footer-section">
                            <h4>Поддержка</h4>
                            <nav class="footer-nav">
                                <a href="#">FAQ</a>
                                <a href="#">Связаться с нами</a>
                                <a href="#">Политика конфиденциальности</a>
                            </nav>
                        </div>
                        
                        <div class="footer-section">
                            <h4>Контакты</h4>
                            <div class="social-links">
                                <a href="#" class="social-link"><i class="fab fa-telegram"></i></a>
                                <a href="#" class="social-link"><i class="fab fa-vk"></i></a>
                                <a href="#" class="social-link"><i class="fab fa-github"></i></a>
                            </div>
                        </div>
                    </div>
                    
                    <div class="footer-bottom">
                        <p>&copy; ${currentYear} TechTariff. Все права защищены.</p>
                    </div>
                </div>
            </footer>
        `;
    }

    // Публичный API
    return {
        init
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.FooterComponent = FooterComponent;
    console.log('🦶 FooterComponent v2.0 загружен');
}
