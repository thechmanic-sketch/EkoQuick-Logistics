let currentUser = null;
let myRole = null;
let allRooms = [];
let filter = 'all';

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    const daysDiff = Math.round((today - dd) / 86400000);
    if (daysDiff === 0) return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
    if (daysDiff === 1) return 'Yesterday';
    if (daysDiff < 14) return daysDiff + ' days ago';
    if (daysDiff < 60) return Math.round(daysDiff / 7) + ' weeks ago';
    return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;
    const profile = await getProfile(currentUser.id);
    if (!profile) return;
    myRole = profile.role === 'driver' ? 'driver' : 'customer';
    document.getElementById('backLink').href = myRole === 'driver' ? 'driver-dashboard.html' : 'dashboard.html';

    document.getElementById('chatSearch').addEventListener('input', render);
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            filter = btn.dataset.filter;
            render();
        });
    });

    await loadAll();
    supabase.channel('chat-list-' + currentUser.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms' }, loadAll)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, loadAll)
        .subscribe();
});

async function loadAll() {
    const col = myRole === 'driver' ? 'driver_id' : 'customer_id';
    const { data: rooms } = await supabase.from('chat_rooms').select('*').eq(col, currentUser.id).order('updated_at', { ascending: false });
    allRooms = rooms || [];

    const jobIds = allRooms.map(function (r) { return r.delivery_id; });
    const peerIds = allRooms.map(function (r) { return myRole === 'driver' ? r.customer_id : r.driver_id; }).filter(Boolean);

    let jobsById = {}, peersById = {};
    if (jobIds.length) {
        const { data: jobs } = await supabase.from('jobs').select('id, pickup, dropoff, status').in('id', jobIds);
        (jobs || []).forEach(function (j) { jobsById[j.id] = j; });
    }
    if (peerIds.length) {
        const { data: peers } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', [...new Set(peerIds)]);
        (peers || []).forEach(function (p) { peersById[p.id] = p; });
    }

    for (const room of allRooms) {
        room._job = jobsById[room.delivery_id];
        room._peer = peersById[myRole === 'driver' ? room.customer_id : room.driver_id];

        const { data: last } = await supabase.from('chat_messages').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(1);
        room._last = last && last[0];

        const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('room_id', room.id).is('read_at', null).neq('sender_id', currentUser.id);
        room._unread = count || 0;

        const { data: settingsRow } = await supabase.from('chat_participant_settings').select('*').eq('room_id', room.id).eq('user_id', currentUser.id).maybeSingle();
        room._settings = settingsRow || {};
    }

    render();
}

function matchesSearch(room, q) {
    if (!q) return true;
    if (room._peer && room._peer.full_name.toLowerCase().includes(q)) return true;
    if (room.delivery_id.toLowerCase().includes(q)) return true;
    if (room._last && room._last.message && room._last.message.toLowerCase().includes(q)) return true;
    if (room._job && ((room._job.pickup || '').toLowerCase().includes(q) || (room._job.dropoff || '').toLowerCase().includes(q))) return true;
    if (formatRelative(room.updated_at).toLowerCase().includes(q)) return true;
    return false;
}

function render() {
    const q = document.getElementById('chatSearch').value.trim().toLowerCase();
    const filtered = allRooms.filter(function (r) { return matchesSearch(r, q); });

    const active = filtered.filter(function (r) { return r._job && (r._job.status === 'to_pickup' || r._job.status === 'to_dropoff' || r._job.status === 'offered' || r._job.status === 'pending'); });
    const history = filtered.filter(function (r) { return !active.includes(r); });

    const showActive = filter === 'all' || filter === 'active';
    const showHistory = (filter === 'all' || filter === 'history') && !document.querySelector('[data-filter="archived"]').classList.contains('active');
    const archivedOnly = filter === 'archived';

    document.getElementById('activeLabel').classList.toggle('hidden', !showActive || !active.length);
    document.getElementById('historyLabel').classList.toggle('hidden', !showHistory || !history.length);

    document.getElementById('activeList').innerHTML = showActive ? active.map(renderRow).join('') : '';
    document.getElementById('historyList').innerHTML = (archivedOnly
        ? filtered.filter(function (r) { return r._settings.archived; }).map(renderRow).join('')
        : (showHistory ? history.filter(function (r) { return !r._settings.archived; }).map(renderRow).join('') : ''));

    document.getElementById('emptyState').classList.toggle('hidden', !!(active.length || history.length));

    document.querySelectorAll('.chat-row').forEach(function (el) {
        el.addEventListener('click', function () { window.location.href = 'chat.html?job=' + el.dataset.job + '&from=chat-list'; });
    });
}

function statusLabel(job) {
    if (!job) return '';
    const map = { pending: 'Pending', offered: 'Assigned', to_pickup: 'In Progress', to_dropoff: 'In Progress', delivered: 'Delivered', cancelled: 'Cancelled' };
    return map[job.status] || job.status;
}

function renderRow(room) {
    const peer = room._peer;
    const last = room._last;
    const lastText = last ? (last.message_type === 'text' ? last.message : last.message_type === 'image' ? '📷 Photo' : last.message_type === 'voice' ? '🎤 Voice message' : last.message_type === 'location' ? '📍 Location' : last.message) : 'No messages yet';

    return '<div class="chat-row" data-job="' + room.delivery_id + '">' +
        '<img src="' + (peer && peer.avatar_url ? escapeHtml(peer.avatar_url) : '') + '">' +
        '<div class="body">' +
            '<div class="top-line"><span class="name">' + (peer ? escapeHtml(peer.full_name) : 'Unassigned') + '</span><span class="date">' + formatRelative(room.updated_at) + '</span></div>' +
            '<div class="bottom-line">' +
                '<span class="last-msg">' + escapeHtml(lastText || '') + '</span>' +
                (room._unread ? '<span class="unread-badge">' + room._unread + '</span>' : '') +
            '</div>' +
            '<div class="delivery-tag">Delivery #' + room.delivery_id.slice(0, 8) + ' · ' + statusLabel(room._job) + '</div>' +
        '</div>' +
    '</div>';
}
