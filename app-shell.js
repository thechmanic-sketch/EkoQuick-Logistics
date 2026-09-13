/* Ekoquick native-app shell — turns the customer web pages into a
   tab-based app ONLY when running inside the Capacitor APK. The public
   website is untouched: window.Capacitor doesn't exist there, so
   isNative() is false and nothing below ever runs. */

(function () {
    function isNative() {
        if (navigator.userAgent.indexOf('EkoquickNativeApp') !== -1) return true;
        return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    }

    var TABS = [
        { icon: '🏠', label: 'Home', href: 'dashboard.html', match: ['dashboard.html', 'index.html', ''] },
        { icon: '🛒', label: 'Store', href: 'store.html', match: ['store.html', 'cart.html'] },
        { icon: '📦', label: 'Orders', href: 'my-orders.html', match: ['my-orders.html', 'live-tracking.html', 'new-delivery.html'] },
        { icon: '💬', label: 'Chat', href: 'chat-list.html', match: ['chat-list.html', 'chat.html'] },
        { icon: '👤', label: 'Profile', href: 'profile-settings.html', match: ['profile-settings.html', 'notifications.html', 'saved-addresses.html', 'payments.html'] },
    ];

    var FAB_PAGES = ['dashboard.html', 'my-orders.html', 'index.html', ''];

    function currentPage() {
        var path = window.location.pathname.split('/').pop();
        return path || '';
    }

    function buildTabbar() {
        var page = currentPage();
        var bar = document.createElement('div');
        bar.className = 'eq-tabbar';

        TABS.forEach(function (tab) {
            var isActive = tab.match.indexOf(page) !== -1;
            var a = document.createElement('a');
            a.className = 'eq-tab' + (isActive ? ' active' : '');
            a.href = tab.href;
            a.innerHTML =
                '<span class="eq-tab-icon">' + tab.icon + '</span>' +
                '<span class="eq-tab-badge" id="eqTabBadge-' + tab.label + '"></span>' +
                '<span class="eq-tab-label">' + tab.label + '</span>';
            bar.appendChild(a);
        });

        document.body.appendChild(bar);

        if (FAB_PAGES.indexOf(page) !== -1) {
            var fab = document.createElement('a');
            fab.className = 'eq-fab show';
            fab.href = 'new-delivery.html';
            fab.setAttribute('aria-label', 'Book a delivery');
            fab.textContent = '📦';
            document.body.appendChild(fab);
        }
    }

    async function updateChatBadge() {
        try {
            if (typeof supabase === 'undefined') return;
            var { data: { session } } = await supabase.auth.getSession();
            if (!session) return;
            var { count } = await supabase
                .from('chat_rooms')
                .select('*', { count: 'exact', head: true })
                .eq('customer_id', session.user.id)
                .eq('has_unread_customer', true);
            var badge = document.getElementById('eqTabBadge-Chat');
            if (badge && count > 0) {
                badge.textContent = count > 9 ? '9+' : String(count);
                badge.classList.add('show');
            }
        } catch (err) { /* best-effort — a missing column/table just skips the badge */ }
    }

    function init() {
        if (!isNative()) return;
        document.documentElement.classList.add('eq-native');
        buildTabbar();
        updateChatBadge();
        document.querySelectorAll('details.eq-advanced-settings[open]').forEach(function (d) {
            d.removeAttribute('open');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
