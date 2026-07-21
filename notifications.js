let currentUser = null;
let currentProfile = null;
let myRole = null;
let allNotifs = [];
let filter = 'all';

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile) return;
    myRole = currentProfile.role === 'driver' ? 'driver' : currentProfile.role === 'admin' ? 'admin' : 'customer';
    document.getElementById('backLink').href = myRole === 'driver' ? 'driver-dashboard.html' : myRole === 'admin' ? 'admin-dashboard.html' : 'dashboard.html';

    document.getElementById('pPush').checked = currentProfile.push_enabled !== false;
    document.getElementById('pSound').checked = currentProfile.notif_sound !== false;
    document.getElementById('pVibration').checked = currentProfile.notif_vibration !== false;
    renderEventToggles();
    document.getElementById('savePrefsBtn').addEventListener('click', savePrefs);
    document.getElementById('markAllReadBtn').addEventListener('click', markAllRead);

    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            filter = btn.dataset.filter;
            render();
        });
    });

    if (typeof NotifSound !== 'undefined') NotifSound.loadPreference(currentUser.id);

    await loadAll();
    supabase.channel('notifications-' + currentUser.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: myRole === 'admin' ? 'user_type=eq.admin' : 'user_id=eq.' + currentUser.id }, function () {
            if (typeof NotifSound !== 'undefined') NotifSound.play();
            loadAll();
        })
        .subscribe();
});

async function loadAll() {
    let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
    query = myRole === 'admin' ? query.eq('user_type', 'admin') : query.eq('user_id', currentUser.id);
    const { data } = await query;
    allNotifs = data || [];
    render();
}

const DRIVER_EVENT_TOGGLES = [
    ['dnotif_new_job', 'New Job'], ['dnotif_job_cancelled', 'Job Cancelled'], ['dnotif_payment_received', 'Payment Received'],
    ['dnotif_weekly_summary', 'Weekly Summary'], ['dnotif_support_reply', 'Support Reply'], ['dnotif_promotion', 'Promotions'],
    ['dnotif_maintenance_reminder', 'Maintenance Reminder'], ['dnotif_document_expiring', 'Document Expiring'], ['dnotif_account_status', 'Account Approved/Suspended'],
];
const CUSTOMER_EVENT_TOGGLES = [
    ['notif_driver_assigned', 'Driver Assigned'], ['notif_driver_near_pickup', 'Driver Near Pickup'], ['notif_parcel_picked_up', 'Parcel Picked Up'],
    ['notif_driver_near_destination', 'Driver Near Destination'], ['notif_delivery_completed', 'Delivery Completed'],
    ['notif_promotions', 'Promotions'], ['notif_support_replies', 'Support Replies'],
];

function renderEventToggles() {
    if (myRole === 'admin') return;
    const toggles = myRole === 'driver' ? DRIVER_EVENT_TOGGLES : CUSTOMER_EVENT_TOGGLES;
    document.getElementById('eventTogglesWrap').innerHTML = toggles.map(function (t) {
        const checked = currentProfile[t[0]] !== false;
        return '<label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" data-field="' + t[0] + '" ' + (checked ? 'checked' : '') + ' style="width:auto;"> ' + t[1] + '</label>';
    }).join('');
}

async function savePrefs() {
    const fields = {
        push_enabled: document.getElementById('pPush').checked,
        notif_sound: document.getElementById('pSound').checked,
        notif_vibration: document.getElementById('pVibration').checked,
    };
    document.querySelectorAll('#eventTogglesWrap input[data-field]').forEach(function (el) { fields[el.dataset.field] = el.checked; });
    const { error } = await supabase.from('profiles').update(fields).eq('id', currentUser.id);
    document.getElementById('prefsMsg').textContent = error ? 'Could not save.' : 'Saved. (Push notifications still aren\'t connected to any provider yet — this only controls what\'s shown here and in the in-app bell.)';
}

async function markAllRead() {
    const ids = allNotifs.filter(function (n) { return !n.is_read; }).map(function (n) { return n.id; });
    if (!ids.length) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', ids);
    await loadAll();
}

function render() {
    let list = allNotifs;
    if (filter === 'unread') list = list.filter(function (n) { return !n.is_read; });
    else if (filter !== 'all') list = list.filter(function (n) { return n.type === filter; });

    const wrap = document.getElementById('notifList');
    const empty = document.getElementById('emptyState');
    if (!list.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    wrap.innerHTML = list.map(function (n) {
        return '<div class="notif-row ' + (n.is_read ? '' : 'unread') + '" data-id="' + n.id + '">' +
            '<div class="dot ' + (n.is_read ? 'read' : '') + '"></div>' +
            '<div class="body">' +
                '<div class="title">' + escapeHtml(n.title) + (n.priority === 'high' || n.priority === 'urgent' ? '<span class="priority-tag ' + n.priority + '">' + n.priority + '</span>' : '') + '</div>' +
                '<div class="msg">' + escapeHtml(n.body || '') + '</div>' +
                '<div class="time">' + formatTime(n.created_at) + '</div>' +
            '</div>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('.notif-row').forEach(function (el) {
        el.addEventListener('click', function () { handleClick(list.find(function (n) { return n.id === el.dataset.id; })); });
    });
}

async function handleClick(n) {
    if (!n.is_read) await supabase.from('notifications').update({ is_read: true }).eq('id', n.id);

    if (n.action_type === 'open_chat' && n.delivery_id) window.location.href = 'chat.html?job=' + n.delivery_id;
    else if (n.action_type === 'open_delivery' && n.delivery_id) window.location.href = myRole === 'driver' ? 'driver-active-deliveries.html' : 'my-orders.html';
    else if (n.action_type === 'open_driver_admin_chat') window.location.href = myRole === 'admin' ? 'admin-chat.html' : 'driver-admin-chat.html';
    else if (n.action_type === 'open_complaint') window.location.href = 'admin-reviews.html';
    else if (n.action_type === 'open_admin_drivers') window.location.href = 'admin-drivers.html';
    else if (n.action_type === 'open_admin_users') window.location.href = myRole === 'admin' ? 'admin-customers.html' : 'dashboard.html';
    else loadAll();
}
