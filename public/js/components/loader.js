/**
 * LoaderComponent v2.0 — Система загрузки с анимацией частиц
 */

const LoaderComponent = (function() {
    'use strict';

    // Приватные переменные
    let isInitialized = false;
    let animationFrameId = null;
    let particles = [];
    let particleCount = 50;
    let canvas = null;
    let ctx = null;
    let mouseX = 0;
    let mouseY = 0;

    // Конфигурация
    const CONFIG = {
        colors: [
            '#00ccff', '#00ffaa', '#ff6b6b', '#ffa502', '#7bed9f',
            '#70a1ff', '#ff9ff3', '#f368e0', '#ff9f43', '#54a0ff'
        ],
        connectionSpeed: 0.02,
        repulsionRadius: 150,
        connectionDistance: 120
    };

    // Инициализация
    function init(pageType = 'default') {
        if (isInitialized) return;

        console.log('LoaderComponent.init вызван для страницы:', pageType);

        const loader = document.getElementById('globalLoader');
        if (!loader) {
            console.warn('Loader element not found');
            return;
        }

        // Инициализация canvas для частиц
        const particlesContainer = document.getElementById('particles');
        if (particlesContainer) {
            canvas = document.createElement('canvas');
            canvas.id = 'particlesCanvas';
            canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
            particlesContainer.appendChild(canvas);
            ctx = canvas.getContext('2d');

            resizeCanvas();
            createParticles();
            animateParticles();

            // Отслеживание мыши
            document.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('resize', resizeCanvas);
        }

        // Анимация текста
        animateLoaderText();

        isInitialized = true;
        console.log('LoaderComponent инициализирован');
    }

    // Создание частиц
    function createParticles() {
        particles = [];
        const width = canvas.width;
        const height = canvas.height;

        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * CONFIG.connectionSpeed * 60,
                vy: (Math.random() - 0.5) * CONFIG.connectionSpeed * 60,
                radius: Math.random() * 2 + 1,
                color: CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)],
                originalX: 0,
                originalY: 0
            });
        }
    }

    // Анимация частиц
    function animateParticles() {
        if (!ctx || !canvas) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach((particle, index) => {
            // Движение к курсору мыши
            const dx = mouseX - particle.x;
            const dy = mouseY - particle.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < CONFIG.repulsionRadius) {
                const force = (CONFIG.repulsionRadius - distance) / CONFIG.repulsionRadius;
                particle.vx -= (dx / distance) * force * 0.5;
                particle.vy -= (dy / distance) * force * 0.5;
            }

            // Возврат к центру если мышь далеко
            if (distance > CONFIG.repulsionRadius) {
                const centerX = canvas.width / 2;
                const centerY = canvas.height / 2;
                const centerDx = centerX - particle.x;
                const centerDy = centerY - particle.y;
                particle.vx += (centerDx / distance) * 0.01;
                particle.vy += (centerDy / distance) * 0.01;
            }

            // Применение скорости
            particle.x += particle.vx;
            particle.y += particle.vy;

            // Границы
            if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
            if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;

            // Рисование частицы
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            ctx.fillStyle = particle.color;
            ctx.fill();

            // Соединительные линии
            particles.slice(index + 1).forEach(otherParticle => {
                const pdx = particle.x - otherParticle.x;
                const pdy = particle.y - otherParticle.y;
                const pDistance = Math.sqrt(pdx * pdx + pdy * pdy);

                if (pDistance < CONFIG.connectionDistance) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(0, 204, 255, ${1 - pDistance / CONFIG.connectionDistance})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(particle.x, particle.y);
                    ctx.lineTo(otherParticle.x, otherParticle.y);
                    ctx.stroke();
                }
            });
        });

        animationFrameId = requestAnimationFrame(animateParticles);
    }

    // Обработка движения мыши
    function handleMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
    }

    // Изменение размера canvas
    function resizeCanvas() {
        if (!canvas) return;
        const container = canvas.parentElement;
        canvas.width = container.offsetWidth;
        canvas.height = container.offsetHeight;
    }

    // Анимация текста загрузки
    function animateLoaderText() {
        const messages = [
            'Инициализация безопасности...',
            'Проверка подключения...',
            'Загрузка данных...',
            'Почти готово...'
        ];
        const messageElement = document.getElementById('loaderMessage');
        if (!messageElement) return;

        let messageIndex = 0;
        setInterval(() => {
            if (isInitialized && messageElement) {
                messageElement.style.opacity = 0;
                setTimeout(() => {
                    messageElement.textContent = messages[messageIndex];
                    messageElement.style.opacity = 1;
                    messageIndex = (messageIndex + 1) % messages.length;
                }, 300);
            }
        }, 2000);
    }

    // Скрытие лоадера
    function hide() {
        const loader = document.getElementById('globalLoader');
        if (loader) {
            loader.style.opacity = '0';
            loader.style.transition = 'opacity 0.5s ease';
            setTimeout(() => {
                loader.style.display = 'none';
            }, 500);
        }

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        document.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('resize', resizeCanvas);
    }

    // Показ лоадера
    function show() {
        const loader = document.getElementById('globalLoader');
        if (loader) {
            loader.style.display = 'flex';
            loader.style.opacity = '1';
        }

        if (!animationFrameId && canvas) {
            animateParticles();
        }
    }

    // Публичный API
    return {
        init,
        hide,
        show
    };
})();

// Глобальная доступность
if (typeof window !== 'undefined') {
    window.LoaderComponent = LoaderComponent;
    console.log('📦 LoaderComponent v2.0 загружен');
}
