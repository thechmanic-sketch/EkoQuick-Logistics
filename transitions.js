(function () {
    var style = document.createElement('style');
    style.textContent =
        'body{opacity:0;transition:opacity .12s ease;}' +
        'body.eq-ready{opacity:1;}' +
        'body.eq-leaving{opacity:0;transition:opacity .08s ease;}';
    document.head.appendChild(style);

    function markImage(img) {
        if (img.complete && img.naturalWidth) {
            img.classList.add('eq-loaded');
        } else {
            img.addEventListener('load', function () {
                img.classList.add('eq-loaded');
            });
        }
    }

    function ready() {
        var imgs = document.querySelectorAll('.hero-bg, .hero-photo img');
        for (var i = 0; i < imgs.length; i++) markImage(imgs[i]);

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                document.body.classList.add('eq-ready');
            });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready);
    } else {
        ready();
    }

    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('hamburgerBtn');
        var menu = document.getElementById('authMobileMenu');
        if (btn && menu) {
            btn.addEventListener('click', function () {
                var open = menu.classList.toggle('open');
                btn.classList.toggle('open', open);
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }
    });

    document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest('a');
        if (!a) return;
        var href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#' || a.target === '_blank' || a.hasAttribute('download')) return;
        if (href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 || href.indexOf('http') === 0) return;

        e.preventDefault();
        document.body.classList.remove('eq-ready');
        document.body.classList.add('eq-leaving');
        setTimeout(function () {
            window.location.href = href;
        }, 80);
    });

    window.addEventListener('pageshow', function (e) {
        if (e.persisted) {
            document.body.classList.remove('eq-leaving');
            document.body.classList.add('eq-ready');
        }
    });
})();
