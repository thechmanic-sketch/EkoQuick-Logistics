(function () {
    var style = document.createElement('style');
    style.textContent =
        'body{opacity:0;transition:opacity .12s ease;}' +
        'body.eq-ready{opacity:1;}' +
        'body.eq-leaving{opacity:0;transition:opacity .08s ease;}';
    document.head.appendChild(style);

    function onLoaded(img, cb) {
        if (img.complete && img.naturalWidth) {
            cb();
        } else {
            img.addEventListener('load', cb);
        }
    }

    function markImage(img) {
        onLoaded(img, function () {
            img.classList.add('eq-loaded');
        });
    }

    function wireBgRotation(wrap) {
        var imgs = wrap.querySelectorAll('.hero-bg');
        if (!imgs.length) return;

        if (imgs.length === 1) {
            onLoaded(imgs[0], function () {
                imgs[0].classList.add('eq-active');
            });
            return;
        }

        var idx = 0;
        onLoaded(imgs[0], function () {
            imgs[0].classList.add('eq-active');
            setInterval(function () {
                var next = (idx + 1) % imgs.length;
                imgs[next].classList.add('eq-active');
                imgs[idx].classList.remove('eq-active');
                idx = next;
            }, 7000);
        });
    }

    function ready() {
        var singleImgs = document.querySelectorAll('.hero-photo img');
        for (var i = 0; i < singleImgs.length; i++) markImage(singleImgs[i]);

        var wraps = document.querySelectorAll('.hero-bg-wrap');
        for (var j = 0; j < wraps.length; j++) wireBgRotation(wraps[j]);

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
