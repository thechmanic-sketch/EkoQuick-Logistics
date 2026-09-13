// Shared notification bell for customer, driver, and admin pages — reads
// real, permanently-stored rows from the `notifications` table. Nothing is
// ever deleted or removed from view: opening a notification only marks it
// read (dims it in the list), it stays visible in the dropdown/history.
// New inserts play a beep via NotifSound and prepend live without a reload.
const NotifBell = (function () {
    let userId = null, role = null, items = [], ui = null;

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }
    function formatTime(iso) {
        return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    }

    function ensureUi() {
        // Customer/driver pages already have this markup (avatar/bell
        // navbar) — reuse it so existing page CSS keeps applying.
        let btn = document.getElementById('bellBtn');
        let count = document.getElementById('bellCount');
        let panel = document.getElementById('notifPanel');
        if (btn && count && panel) return { btn: btn, count: count, panel: panel };

        // Admin pages have no bell markup at all — inject one into the header.
        const header = document.querySelector('.cmd-header-right') || document.querySelector('.cmd-header');
        if (!header) return null;

        const wrap = document.createElement('div');
        wrap.style.position = 'relative';
        wrap.innerHTML =
            '<button class="cmd-bell-btn" id="bellBtn" type="button" aria-label="Notifications">🔔<span class="cmd-bell-count hidden" id="bellCount">0</span></button>' +
            '<div class="cmd-notif-panel" id="notifPanel"></div>';
        header.insertBefore(wrap, header.firstChild);
        return { btn: wrap.querySelector('#bellBtn'), count: wrap.querySelector('#bellCount'), panel: wrap.querySelector('#notifPanel') };
    }

    function render() {
        if (!ui) return;
        const unread = items.filter(function (n) { return !n.is_read; }).length;
        if (unread > 0) { ui.count.textContent = unread; ui.count.classList.remove('hidden'); }
        else ui.count.classList.add('hidden');

        ui.panel.innerHTML = items.length
            ? items.map(function (n) {
                return '<div class="notif-item" data-id="' + n.id + '" style="cursor:pointer; opacity:' + (n.is_read ? '0.55' : '1') + ';">' +
                    '<div style="font-weight:' + (n.is_read ? '400' : '700') + ';">' + escapeHtml(n.title) + '</div>' +
                    (n.body ? '<div style="color:var(--muted-dim); font-size:11px;">' + escapeHtml(n.body) + '</div>' : '') +
                    '<div style="color:var(--muted-dim); font-size:10px; margin-top:2px;">' + formatTime(n.created_at) + '</div>' +
                '</div>';
            }).join('')
            : '<div class="empty">No notifications.</div>';

        ui.panel.querySelectorAll('.notif-item').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                handleClick(el.dataset.id);
            });
        });
    }

    async function handleClick(id) {
        const n = items.find(function (x) { return x.id === id; });
        if (!n) return;
        if (!n.is_read) {
            await supabase.from('notifications').update({ is_read: true }).eq('id', id);
            n.is_read = true;
            render();
        }

        if (n.action_type === 'open_chat' && n.delivery_id) window.location.href = 'chat.html?job=' + n.delivery_id;
        else if (n.action_type === 'open_delivery' && n.delivery_id) window.location.href = role === 'driver' ? 'driver-active-deliveries.html' : role === 'admin' ? 'admin-jobs.html' : 'my-orders.html';
        else if (n.action_type === 'open_driver_admin_chat') window.location.href = role === 'admin' ? 'admin-chat.html' : 'driver-admin-chat.html';
        else if (n.action_type === 'open_complaint') window.location.href = 'admin-reviews.html';
        else if (n.action_type === 'open_admin_drivers') window.location.href = 'admin-drivers.html';
        else if (n.action_type === 'open_admin_users' && role === 'admin') window.location.href = 'admin-customers.html';
    }

    async function loadAll() {
        let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
        query = role === 'admin' ? query.eq('user_type', 'admin') : query.eq('user_id', userId);
        const { data } = await query;
        items = data || [];
        render();
    }

    function init(opts) {
        userId = opts.userId;
        role = opts.role;
        ui = ensureUi();
        if (!ui) return;

        ui.btn.addEventListener('click', function (e) {
            e.stopPropagation();
            ui.panel.classList.toggle('open');
        });
        document.addEventListener('click', function () { ui.panel.classList.remove('open'); });
        ui.panel.addEventListener('click', function (e) { e.stopPropagation(); });

        NotifSound.loadPreference(userId);
        loadAll();

        supabase.channel('notif-bell-' + userId)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'notifications',
                filter: role === 'admin' ? 'user_type=eq.admin' : 'user_id=eq.' + userId,
            }, function (payload) {
                items.unshift(payload.new);
                render();
                NotifSound.play();
            })
            .subscribe();
    }

    return { init: init };
})();
