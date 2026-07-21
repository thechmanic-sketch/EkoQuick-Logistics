// Shared geolocation permission helper for customer and driver apps.
// Browsers only show the native permission prompt on the first real
// getCurrentPosition()/watchPosition() call, and never re-prompt after a
// denial — so silently calling it in the background (as driver-dashboard.js
// used to) means a driver who dismissed it once has no way to find out
// they're invisible on the Fleet Map. This shows an explanatory banner
// with a clear "Enable Location" action, and can report current status so
// pages can warn persistently when it's blocked.
const GeoPermission = (function () {
    function checkStatus(cb) {
        if (!navigator.geolocation) { cb('unsupported'); return; }
        if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: 'geolocation' }).then(function (result) {
                cb(result.state); // 'granted' | 'denied' | 'prompt'
                result.onchange = function () { cb(result.state); };
            }).catch(function () { cb('unknown'); });
        } else {
            cb('unknown');
        }
    }

    function request() {
        return new Promise(function (resolve, reject) {
            if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
            navigator.geolocation.getCurrentPosition(
                function (pos) { resolve(pos); },
                function (err) { reject(err); },
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
            );
        });
    }

    // Shows a dismissible-once-enabled banner at the top of containerEl
    // explaining why location matters, with a button that triggers the
    // real browser permission prompt. onEnable fires once granted.
    function showBanner(containerEl, message, onEnable) {
        if (!containerEl || containerEl.querySelector('.geo-permission-banner')) return;
        const bar = document.createElement('div');
        bar.className = 'geo-permission-banner';
        bar.innerHTML = '<span>📍 ' + message + '</span><button type="button" class="geo-permission-btn">Enable Location</button>';
        containerEl.insertAdjacentElement('afterbegin', bar);
        bar.querySelector('.geo-permission-btn').addEventListener('click', function () {
            request().then(function () {
                bar.remove();
                if (onEnable) onEnable();
            }).catch(function () {
                bar.querySelector('span').textContent = '📍 Location is blocked in your browser settings — enable it for this site in your browser settings, then reload.';
            });
        });
    }

    return { checkStatus: checkStatus, request: request, showBanner: showBanner };
})();
