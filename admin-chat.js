let allRooms = [];
let allDriverChats = [];
let jobsById = {};
let profilesById = {};
let currentId = null;
let currentSource = null; // 'room' | 'driverAdmin'
let roomFilter = 'all';
let unreadByRoom = {};
let unreadByDriverChat = {};
let currentAdminId = null;

const SUGGESTION_RULES = [
    [/not answer|no response|not responding/i, ['Wait 5 minutes and try again.', 'Call the customer.', 'Send an automated reminder.', 'Mark as Customer Unavailable if no response.']],
    [/wrong (pickup|address|location)/i, ['Ask driver to confirm exact pin location.', 'Contact customer to confirm the address.', 'Escalate to the delivery chat if unresolved.']],
    [/late|delay|traffic/i, ['Acknowledge the delay to the customer.', 'Ask driver for updated ETA.']],
    [/accident|breakdown/i, ['Confirm driver safety first.', 'Dispatch a replacement driver if needed.', 'File an incident report.']],
    [/refund|money|charge/i, ['Check payment status in Finances.', 'Escalate to Finance team if a refund is warranted.']],
];

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;
    currentAdminId = user.id;
    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') { await supabase.auth.signOut(); window.location.href = 'admin-login.html'; return; }
    window.currentAdminName = profile.full_name || profile.email || 'Admin';
    await loadAppSettings();
    window.chatFlaggedKeywords = appSetting('chat_flagged_keywords', '').split(',').map(function (s) { return s.trim(); });

    document.getElementById('logoutBtn').addEventListener('click', async function () { await supabase.auth.signOut(); window.location.href = 'login.html'; });
    document.getElementById('roomSearch').addEventListener('input', renderRoomList);
    document.getElementById('adminSendBtn').addEventListener('click', sendAdminMessage);
    document.getElementById('adminMessageInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendAdminMessage(); });
    document.getElementById('exportBtn').addEventListener('click', exportConversation);
    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
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
        if (currentSource === 'room' && payload.new.room_id === currentId) { appendMessageToView(payload.new); }
        else { unreadByRoom[payload.new.room_id] = (unreadByRoom[payload.new.room_id] || 0) + 1; renderRoomList(); }
    }).subscribe();
    supabase.channel('admin-driver-chats').on('postgres_changes', { event: '*', schema: 'public', table: 'driver_admin_chats' }, loadAll).subscribe();
    supabase.channel('admin-driver-messages').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_admin_messages' }, function (payload) {
        if (currentSource === 'driverAdmin' && payload.new.chat_id === currentId) { appendDriverMessageToView(payload.new); }
        else { unreadByDriverChat[payload.new.chat_id] = (unreadByDriverChat[payload.new.chat_id] || 0) + 1; renderRoomList(); }
    }).subscribe();
});

async function loadAll() {
    const { data: rooms } = await supabase.from('chat_rooms').select('*').order('updated_at', { ascending: false });
    allRooms = rooms || [];

    const { data: driverChats } = await supabase.from('driver_admin_chats').select('*').order('updated_at', { ascending: false });
    allDriverChats = driverChats || [];

    const jobIds = [].concat(allRooms.map(function (r) { return r.delivery_id; }), allDriverChats.map(function (c) { return c.delivery_id; })).filter(Boolean);
    const userIds = [].concat(
        allRooms.map(function (r) { return r.customer_id; }), allRooms.map(function (r) { return r.driver_id; }),
        allDriverChats.map(function (c) { return c.driver_id; })
    ).filter(Boolean);

    if (jobIds.length) {
        const { data: jobs } = await supabase.from('jobs').select('id, pickup, dropoff').in('id', [...new Set(jobIds)]);
        jobsById = {};
        (jobs || []).forEach(function (j) { jobsById[j.id] = j; });
    }
    if (userIds.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', [...new Set(userIds)]);
        profilesById = {};
        (profiles || []).forEach(function (p) { profilesById[p.id] = p; });
    }

    const roomIds = allRooms.map(function (r) { return r.id; });
    const chatIds = allDriverChats.map(function (c) { return c.id; });

    // Batched instead of one query per room/chat (was N+1 — see qa/ops review):
    // one recent-messages query per table, reduced client-side to "last per room",
    // plus one lightweight count-only query for unread.
    unreadByRoom = {};
    if (roomIds.length) {
        const { data: recentMsgs } = await supabase.from('chat_messages').select('room_id, message, message_type, created_at')
            .in('room_id', roomIds).order('created_at', { ascending: false }).limit(1000);
        const lastByRoom = {};
        (recentMsgs || []).forEach(function (m) { if (!lastByRoom[m.room_id]) lastByRoom[m.room_id] = m; });
        allRooms.forEach(function (room) { room._last = lastByRoom[room.id] || null; });

        const { data: unreadMsgs } = await supabase.from('chat_messages').select('room_id')
            .in('room_id', roomIds).is('read_at', null).neq('sender_type', 'admin');
        (unreadMsgs || []).forEach(function (m) { unreadByRoom[m.room_id] = (unreadByRoom[m.room_id] || 0) + 1; });
    }

    if (chatIds.length) {
        const { data: recentDriverMsgs } = await supabase.from('driver_admin_messages').select('chat_id, message, created_at')
            .in('chat_id', chatIds).order('created_at', { ascending: false }).limit(1000);
        const lastByChat = {};
        (recentDriverMsgs || []).forEach(function (m) { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m; });
        allDriverChats.forEach(function (chat) { chat._last = lastByChat[chat.id] || null; });
    }

    renderSummary();
    renderRoomList();
}

function renderSummary() {
    const escalatedCount = allRooms.filter(function (r) { return r.escalated; }).length;
    const waitingCount = allDriverChats.filter(function (c) { return c.status === 'waiting'; }).length;
    const unreadCount = Object.values(unreadByRoom).filter(Boolean).length + Object.values(unreadByDriverChat).filter(Boolean).length;
    const openDriverChats = allDriverChats.filter(function (c) { return c.status !== 'resolved'; }).length;

    document.getElementById('summaryCards').innerHTML =
        '<div class="cmd-panel" style="padding:14px;"><div style="font-size:22px; font-weight:700;">' + allRooms.length + '</div><div class="meta">Customer Chats</div></div>' +
        '<div class="cmd-panel" style="padding:14px;"><div style="font-size:22px; font-weight:700;">' + openDriverChats + '</div><div class="meta">Driver Chats Open</div></div>' +
        '<div class="cmd-panel" style="padding:14px;"><div style="font-size:22px; font-weight:700;">' + escalatedCount + '</div><div class="meta">Escalated</div></div>' +
        '<div class="cmd-panel" style="padding:14px;"><div style="font-size:22px; font-weight:700;">' + waitingCount + '</div><div class="meta">Waiting for Admin</div></div>' +
        '<div class="cmd-panel" style="padding:14px;"><div style="font-size:22px; font-weight:700;">' + unreadCount + '</div><div class="meta">Unread</div></div>';
}

function closeDrawer() {
    document.getElementById('chatDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
    currentId = null;
    currentSource = null;
}

function openDrawer() {
    document.getElementById('chatDrawer').classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');
}

function filteredItems() {
    const q = document.getElementById('roomSearch').value.trim().toLowerCase();
    let rooms = allRooms.map(function (r) { return Object.assign({ _source: 'room' }, r); });
    let driverChats = allDriverChats.map(function (c) { return Object.assign({ _source: 'driverAdmin' }, c); });

    if (roomFilter === 'customer') driverChats = [];
    if (roomFilter === 'driver') rooms = [];
    if (roomFilter === 'escalated') { rooms = rooms.filter(function (r) { return r.escalated; }); driverChats = []; }
    if (roomFilter === 'waiting') { rooms = []; driverChats = driverChats.filter(function (c) { return c.status === 'waiting'; }); }
    if (roomFilter === 'unread') { rooms = rooms.filter(function (r) { return unreadByRoom[r.id]; }); driverChats = driverChats.filter(function (c) { return unreadByDriverChat[c.id]; }); }
    if (roomFilter === 'archived') { rooms = []; driverChats = driverChats.filter(function (c) { return c.status === 'resolved'; }); }

    let combined = rooms.concat(driverChats);
    if (q) {
        combined = combined.filter(function (item) {
            if (item._source === 'room') {
                const cust = profilesById[item.customer_id];
                const drv = profilesById[item.driver_id];
                return (cust && cust.full_name.toLowerCase().includes(q)) || (drv && drv.full_name.toLowerCase().includes(q)) || item.delivery_id.toLowerCase().includes(q);
            } else {
                const drv = profilesById[item.driver_id];
                return (drv && drv.full_name.toLowerCase().includes(q)) || (item.delivery_id || '').toLowerCase().includes(q);
            }
        });
    }
    return combined;
}

function renderRoomList() {
    const list = filteredItems();
    const wrap = document.getElementById('roomListItems');
    if (!list.length) { wrap.innerHTML = '<div class="empty-state">No conversations found.</div>'; return; }

    wrap.innerHTML = list.map(function (item) {
        if (item._source === 'room') {
            const cust = profilesById[item.customer_id];
            const drv = profilesById[item.driver_id];
            const job = jobsById[item.delivery_id];
            const unread = unreadByRoom[item.id] || 0;
            return '<div class="room-item ' + (item.id === currentId && currentSource === 'room' ? 'active' : '') + '" data-id="' + item.id + '" data-source="room">' +
                '<div class="name">' + (cust ? escapeHtml(cust.full_name) : '—') + ' ↔ ' + (drv ? escapeHtml(drv.full_name) : 'Unassigned') + (unread ? '<span class="unread-dot"></span>' : '') + (item.escalated ? ' 🆘' : '') + '</div>' +
                '<div class="last">' + (item._last ? escapeHtml((item._last.message || '[attachment]')) : 'No messages yet') + '</div>' +
                '<div class="meta">Delivery ' + item.delivery_id.slice(0, 8) + (job ? ' · ' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) : '') + '</div>' +
            '</div>';
        } else {
            const drv = profilesById[item.driver_id];
            const job = jobsById[item.delivery_id];
            const unread = unreadByDriverChat[item.id] || 0;
            return '<div class="room-item ' + (item.id === currentId && currentSource === 'driverAdmin' ? 'active' : '') + '" data-id="' + item.id + '" data-source="driverAdmin">' +
                '<div class="name">🚚 ' + (drv ? escapeHtml(drv.full_name) : '—') + (unread ? '<span class="unread-dot"></span>' : '') + '</div>' +
                '<div class="last">' + (item._last ? escapeHtml(item._last.message) : 'No messages yet') + '</div>' +
                '<div class="meta">Driver Support · ' + item.status + (job ? ' · Delivery ' + item.delivery_id.slice(0, 8) : '') + '</div>' +
            '</div>';
        }
    }).join('');

    wrap.querySelectorAll('.room-item').forEach(function (el) {
        el.addEventListener('click', function () {
            if (el.dataset.source === 'room') openRoom(el.dataset.id);
            else openDriverChat(el.dataset.id);
        });
    });
}

async function openRoom(roomId) {
    currentId = roomId;
    currentSource = 'room';
    unreadByRoom[roomId] = 0;
    renderRoomList();
    openDrawer();

    const room = allRooms.find(function (r) { return r.id === roomId; });
    const cust = profilesById[room.customer_id];
    const drv = profilesById[room.driver_id];
    document.getElementById('adminChatTitle').innerHTML =
        (cust ? escapeHtml(cust.full_name) : '—') + ' <button class="btn btn-outline-blue" style="width:auto; font-size:11px; padding:2px 8px;" data-action="mute" data-id="' + room.customer_id + '">' + (room.muted_by_admin_user_id === room.customer_id ? 'Unmute' : 'Mute') + '</button>' +
        ' ↔ ' + (drv ? escapeHtml(drv.full_name) : 'Unassigned') + (drv ? ' <button class="btn btn-outline-blue" style="width:auto; font-size:11px; padding:2px 8px;" data-action="mute" data-id="' + room.driver_id + '">' + (room.muted_by_admin_user_id === room.driver_id ? 'Unmute' : 'Mute') + '</button>' : '') +
        ' — Delivery ' + room.delivery_id.slice(0, 8) +
        (room.escalated ? (room.assigned_admin_id === currentAdminId
            ? ' <button class="btn btn-outline-blue" style="width:auto; font-size:11px;" data-action="leave">Leave</button>'
            : ' <button class="btn btn-blue" style="width:auto; font-size:11px;" data-action="join">Join</button>') : '');

    document.getElementById('adminChatTitle').querySelectorAll('button[data-action="mute"]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleMute(room, btn.dataset.id); });
    });
    const joinBtn = document.getElementById('adminChatTitle').querySelector('button[data-action="join"]');
    if (joinBtn) joinBtn.addEventListener('click', function () { joinConversation(room); });
    const leaveBtn = document.getElementById('adminChatTitle').querySelector('button[data-action="leave"]');
    if (leaveBtn) leaveBtn.addEventListener('click', function () { leaveConversation(room); });

    document.getElementById('exportBtn').style.display = 'inline-block';
    document.getElementById('adminInputRow').style.display = 'flex';
    document.getElementById('suggestionsPanel').classList.add('hidden');

    const { data: messages } = await supabase.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
    const area = document.getElementById('adminMessageArea');
    area.innerHTML = '';
    (messages || []).forEach(function (m) { appendMessageToView(m, true); });
    area.scrollTop = area.scrollHeight;
}

async function joinConversation(room) {
    await supabase.from('chat_rooms').update({ assigned_admin_id: currentAdminId }).eq('id', room.id);
    await supabase.from('chat_messages').insert({ room_id: room.id, sender_type: 'system', message: 'Support Agent ' + (window.currentAdminName || 'Admin') + ' joined the conversation.', message_type: 'system' });
    room.assigned_admin_id = currentAdminId;
    openRoom(room.id);
}

async function leaveConversation(room) {
    await supabase.from('chat_rooms').update({ assigned_admin_id: null, escalated: false }).eq('id', room.id);
    await supabase.from('chat_messages').insert({ room_id: room.id, sender_type: 'system', message: 'Support Agent ' + (window.currentAdminName || 'Admin') + ' left the conversation.', message_type: 'system' });
    room.assigned_admin_id = null; room.escalated = false;
    openRoom(room.id);
}

function highlightFlagged(text) {
    const keywords = (window.chatFlaggedKeywords || []).filter(Boolean);
    if (!keywords.length) return escapeHtml(text);
    let escaped = escapeHtml(text);
    keywords.forEach(function (kw) {
        const re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        escaped = escaped.replace(re, '<mark style="background:#C0392B; color:#fff;">$1</mark>');
    });
    return escaped;
}

function appendMessageToView(m, skipCheck) {
    if (!skipCheck && m.room_id !== currentId) return;
    const area = document.getElementById('adminMessageArea');
    if (m.deleted_for_everyone) return;

    let body = '';
    if (m.message_type === 'image') body = '<img src="' + escapeHtml(m.image_url) + '" style="max-width:200px; border-radius:8px;">';
    else if (m.message_type === 'voice') body = '<audio controls src="' + escapeHtml(m.voice_url) + '" style="height:32px;"></audio>';
    else if (m.message_type === 'location') body = '📍 Shared location (' + m.location_lat + ', ' + m.location_lng + ')';
    else body = highlightFlagged(m.message || '');

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
    const input = document.getElementById('adminMessageInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    if (currentSource === 'room') {
        if (!currentId) return;
        await supabase.from('chat_messages').insert({ room_id: currentId, sender_id: currentAdminId, sender_type: 'admin', message: text, message_type: 'text' });
    } else if (currentSource === 'driverAdmin') {
        if (!currentId) return;
        await supabase.from('driver_admin_messages').insert({ chat_id: currentId, sender_id: currentAdminId, sender_type: 'admin', message: text });
        await supabase.from('driver_admin_chats').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', currentId);
    }
}

async function toggleMute(room, userId) {
    const newValue = room.muted_by_admin_user_id === userId ? null : userId;
    await supabase.from('chat_rooms').update({ muted_by_admin_user_id: newValue }).eq('id', room.id);
    room.muted_by_admin_user_id = newValue;
    openRoom(room.id);
}

async function openDriverChat(chatId) {
    currentId = chatId;
    currentSource = 'driverAdmin';
    unreadByDriverChat[chatId] = 0;
    renderRoomList();
    openDrawer();

    const chat = allDriverChats.find(function (c) { return c.id === chatId; });
    const drv = profilesById[chat.driver_id];
    document.getElementById('adminChatTitle').innerHTML =
        '🚚 ' + (drv ? escapeHtml(drv.full_name) : '—') + ' — Driver Support' +
        (chat.delivery_id ? ' · Delivery ' + chat.delivery_id.slice(0, 8) : '') +
        (chat.status !== 'resolved' ? ' <button class="btn btn-outline-blue" style="width:auto; font-size:11px;" data-action="resolve">Mark Resolved</button>' : '<span class="meta"> · Resolved</span>');

    const resolveBtn = document.getElementById('adminChatTitle').querySelector('button[data-action="resolve"]');
    if (resolveBtn) resolveBtn.addEventListener('click', function () { resolveDriverChat(chat); });

    document.getElementById('exportBtn').style.display = 'none';
    document.getElementById('adminInputRow').style.display = 'flex';

    const { data: messages } = await supabase.from('driver_admin_messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
    const area = document.getElementById('adminMessageArea');
    area.innerHTML = '';
    (messages || []).forEach(function (m) { appendDriverMessageToView(m, true); });
    area.scrollTop = area.scrollHeight;

    renderSuggestions(messages || []);
}

async function resolveDriverChat(chat) {
    await supabase.from('driver_admin_chats').update({ status: 'resolved' }).eq('id', chat.id);
    chat.status = 'resolved';
    openDriverChat(chat.id);
}

function appendDriverMessageToView(m, skipCheck) {
    if (!skipCheck && m.chat_id !== currentId) return;
    const area = document.getElementById('adminMessageArea');
    const div = document.createElement('div');
    div.className = 'msg-row ' + (m.sender_type === 'driver' ? 'customer' : m.sender_type === 'admin' ? 'driver' : 'system');
    div.innerHTML = '<div class="bubble">' + highlightFlagged(m.message) + '<div class="msg-meta"><span>' + formatTime(m.created_at) + '</span></div></div>';
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
    if (currentSource === 'driverAdmin') renderSuggestions(null, m);
}

function renderSuggestions(messages, latestOnly) {
    const panel = document.getElementById('suggestionsPanel');
    const latest = latestOnly || (messages && messages.length ? messages[messages.length - 1] : null);
    if (!latest || latest.sender_type !== 'driver') { panel.classList.add('hidden'); return; }

    const rule = SUGGESTION_RULES.find(function (r) { return r[0].test(latest.message); });
    if (!rule) { panel.classList.add('hidden'); return; }

    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="meta" style="margin-bottom:4px;">Quick Suggestions (rule-based, not AI):</div>' +
        rule[1].map(function (s) { return '<button class="btn btn-outline-blue" style="width:auto; font-size:11px; margin:2px;" data-text="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>'; }).join('');
    panel.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.getElementById('adminMessageInput').value = btn.dataset.text;
        });
    });
}

async function exportConversation() {
    if (currentSource !== 'room' || !currentId) return;
    const { data: messages } = await supabase.from('chat_messages').select('*').eq('room_id', currentId).order('created_at', { ascending: true });
    const room = allRooms.find(function (r) { return r.id === currentId; });
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
