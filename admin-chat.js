let allRooms = [];
let jobsById = {};
let profilesById = {};
let currentRoomId = null;
let roomFilter = 'all';
let unreadByRoom = {};

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;
    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') { await supabase.auth.signOut(); window.location.href = 'admin-login.html'; return; }
    window.currentAdminName = profile.full_name || profile.email || 'Admin';

    document.getElementById('logoutBtn').addEventListener('click', async function () { await supabase.auth.signOut(); window.location.href = 'login.html'; });
    document.getElementById('roomSearch').addEventListener('input', renderRoomList);
    document.getElementById('adminSendBtn').addEventListener('click', sendAdminMessage);
    document.getElementById('adminMessageInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendAdminMessage(); });
    document.getElementById('exportBtn').addEventListener('click', exportConversation);
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            roomFilter = btn.dataset.filter;
            renderRoomList();
        });
    });

    await loadAll();
    supabase.channel('admin-chat-rooms').on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms' }, loadAll).subscribe();
    supabase.channel('admin-chat-messages').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, function (payload) {
        if (payload.new.room_id === currentRoomId) { appendMessageToView(payload.new); }
        else { unreadByRoom[payload.new.room_id] = (unreadByRoom[payload.new.room_id] || 0) + 1; renderRoomList(); }
    }).subscribe();
});

async function loadAll() {
    const { data: rooms } = await supabase.from('chat_rooms').select('*').order('updated_at', { ascending: false });
    allRooms = rooms || [];

    const jobIds = allRooms.map(function (r) { return r.delivery_id; });
    const userIds = [].concat(allRooms.map(function (r) { return r.customer_id; }), allRooms.map(function (r) { return r.driver_id; })).filter(Boolean);

    if (jobIds.length) {
        const { data: jobs } = await supabase.from('jobs').select('id, pickup, dropoff').in('id', jobIds);
        jobsById = {};
        (jobs || []).forEach(function (j) { jobsById[j.id] = j; });
    }
    if (userIds.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', [...new Set(userIds)]);
        profilesById = {};
        (profiles || []).forEach(function (p) { profilesById[p.id] = p; });
    }

    for (const room of allRooms) {
        const { data: last } = await supabase.from('chat_messages').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(1);
        room._last = last && last[0];
        const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('room_id', room.id).is('read_at', null).eq('sender_type', 'customer');
        unreadByRoom[room.id] = count || 0;
    }

    renderRoomList();
}

function filteredRooms() {
    const q = document.getElementById('roomSearch').value.trim().toLowerCase();
    return allRooms.filter(function (r) {
        if (roomFilter === 'unread' && !unreadByRoom[r.id]) return false;
        if (roomFilter === 'pinned' && !r._pinned) return false;
        if (!q) return true;
        const cust = profilesById[r.customer_id];
        const drv = profilesById[r.driver_id];
        return (cust && cust.full_name.toLowerCase().includes(q)) || (drv && drv.full_name.toLowerCase().includes(q)) || r.delivery_id.toLowerCase().includes(q);
    });
}

function renderRoomList() {
    const list = filteredRooms();
    const wrap = document.getElementById('roomListItems');
    if (!list.length) { wrap.innerHTML = '<div class="empty-state">No conversations found.</div>'; return; }

    wrap.innerHTML = list.map(function (r) {
        const cust = profilesById[r.customer_id];
        const drv = profilesById[r.driver_id];
        const job = jobsById[r.delivery_id];
        const unread = unreadByRoom[r.id] || 0;
        return '<div class="room-item ' + (r.id === currentRoomId ? 'active' : '') + '" data-id="' + r.id + '">' +
            '<div class="name">' + (cust ? escapeHtml(cust.full_name) : '—') + ' ↔ ' + (drv ? escapeHtml(drv.full_name) : 'Unassigned') + (unread ? '<span class="unread-dot"></span>' : '') + '</div>' +
            '<div class="last">' + (r._last ? escapeHtml((r._last.message || '[attachment]')) : 'No messages yet') + '</div>' +
            '<div class="meta">Delivery ' + r.delivery_id.slice(0, 8) + (job ? ' · ' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) : '') + '</div>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('.room-item').forEach(function (el) {
        el.addEventListener('click', function () { openRoom(el.dataset.id); });
    });
}

async function openRoom(roomId) {
    currentRoomId = roomId;
    unreadByRoom[roomId] = 0;
    renderRoomList();

    const room = allRooms.find(function (r) { return r.id === roomId; });
    const cust = profilesById[room.customer_id];
    const drv = profilesById[room.driver_id];
    document.getElementById('adminChatTitle').textContent = (cust ? cust.full_name : '—') + ' ↔ ' + (drv ? drv.full_name : 'Unassigned') + ' — Delivery ' + room.delivery_id.slice(0, 8);
    document.getElementById('exportBtn').style.display = 'inline-block';
    document.getElementById('adminInputRow').style.display = 'flex';

    const { data: messages } = await supabase.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
    const area = document.getElementById('adminMessageArea');
    area.innerHTML = '';
    (messages || []).forEach(function (m) { appendMessageToView(m, true); });
    area.scrollTop = area.scrollHeight;
}

function appendMessageToView(m, skipCheck) {
    if (!skipCheck && m.room_id !== currentRoomId) return;
    const area = document.getElementById('adminMessageArea');
    if (m.deleted_for_everyone) return;

    let body = '';
    if (m.message_type === 'image') body = '<img src="' + escapeHtml(m.image_url) + '" style="max-width:200px; border-radius:8px;">';
    else if (m.message_type === 'voice') body = '<audio controls src="' + escapeHtml(m.voice_url) + '" style="height:32px;"></audio>';
    else if (m.message_type === 'location') body = '📍 Shared location (' + m.location_lat + ', ' + m.location_lng + ')';
    else body = escapeHtml(m.message || '');

    const div = document.createElement('div');
    div.className = 'msg-row ' + m.sender_type;
    div.innerHTML = '<div class="bubble">' + body +
        '<div class="msg-meta"><span>' + formatTime(m.created_at) + '</span>' +
        (m.message_type === 'text' && !m.deleted ? '<span data-action="delete" data-id="' + m.id + '">Delete</span>' : '') +
        '</div></div>';
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;

    const delBtn = div.querySelector('[data-action="delete"]');
    if (delBtn) delBtn.addEventListener('click', function () { deleteAbusiveMessage(m.id, div); });
}

async function deleteAbusiveMessage(messageId, el) {
    if (!confirm('Delete this message for everyone? This is intended for abusive/policy-violating content.')) return;
    await supabase.from('chat_messages').update({ deleted_for_everyone: true, message: null }).eq('id', messageId);
    el.remove();
}

async function sendAdminMessage() {
    if (!currentRoomId) return;
    const input = document.getElementById('adminMessageInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const user = await requireSession('admin-login.html');
    await supabase.from('chat_messages').insert({ room_id: currentRoomId, sender_id: user.id, sender_type: 'admin', message: text, message_type: 'text' });
}

async function exportConversation() {
    if (!currentRoomId) return;
    const { data: messages } = await supabase.from('chat_messages').select('*').eq('room_id', currentRoomId).order('created_at', { ascending: true });
    const room = allRooms.find(function (r) { return r.id === currentRoomId; });
    const lines = (messages || []).map(function (m) {
        return '[' + formatTime(m.created_at) + '] ' + m.sender_type + ': ' + (m.message || '[' + m.message_type + ']');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'chat-' + room.delivery_id.slice(0, 8) + '.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
