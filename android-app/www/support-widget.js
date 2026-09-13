(function () {
    var WHATSAPP_LINK = 'https://wa.me/27676659966?text=Hi%20Ekoquick,%20I%20need%20some%20help.';
    var STORAGE_KEY = 'ekoquick-support-balloon-pos';

    document.addEventListener('DOMContentLoaded', function () {
        var balloon = document.createElement('a');
        balloon.href = WHATSAPP_LINK;
        balloon.target = '_blank';
        balloon.rel = 'noopener';
        balloon.className = 'support-balloon';
        balloon.setAttribute('aria-label', 'Chat with support on WhatsApp');
        balloon.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.71.45 3.38 1.3 4.85L2.05 22l5.36-1.4a9.9 9.9 0 0 0 4.63 1.18h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.67c2.19 0 4.25.85 5.8 2.4a8.18 8.18 0 0 1 2.4 5.81c0 4.53-3.69 8.22-8.22 8.22a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.18.83.85-3.1-.2-.32a8.15 8.15 0 0 1-1.26-4.35c0-4.53 3.7-8.22 8.24-8.22Zm-4.42 3.98c-.16 0-.42.06-.64.31-.22.25-.85.83-.85 2.02 0 1.19.87 2.34.99 2.5.12.16 1.7 2.7 4.2 3.68 2.07.82 2.49.66 2.94.62.45-.04 1.45-.59 1.66-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28-.24-.12-1.45-.72-1.68-.8-.22-.08-.39-.12-.55.12-.16.25-.63.8-.77.96-.14.16-.28.18-.53.06-.24-.12-1.03-.38-1.96-1.21-.72-.65-1.21-1.44-1.35-1.68-.14-.25-.02-.38.11-.5.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.42-.55-.42Z"/></svg>';

        document.body.appendChild(balloon);
        restorePosition(balloon);
        makeDraggable(balloon);
    });

    function restorePosition(el) {
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
                el.style.left = clamp(saved.left, 0, window.innerWidth - el.offsetWidth) + 'px';
                el.style.top = clamp(saved.top, 0, window.innerHeight - el.offsetHeight) + 'px';
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        } catch (e) { /* ignore corrupt storage */ }
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function makeDraggable(el) {
        var dragging = false;
        var moved = false;
        var startX, startY, startLeft, startTop;

        el.addEventListener('pointerdown', function (e) {
            dragging = true;
            moved = false;
            var rect = el.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            el.setPointerCapture(e.pointerId);
        });

        el.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
            if (!moved) return;

            var newLeft = clamp(startLeft + dx, 0, window.innerWidth - el.offsetWidth);
            var newTop = clamp(startTop + dy, 0, window.innerHeight - el.offsetHeight);
            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        });

        el.addEventListener('pointerup', function (e) {
            dragging = false;
            if (moved) {
                e.preventDefault();
                var rect = el.getBoundingClientRect();
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
            }
        });

        el.addEventListener('click', function (e) {
            if (moved) { e.preventDefault(); moved = false; }
        });
    }
})();
