let currentUser = null;
let currentProfile = null;
let myRole = null; // 'customer' | 'driver' | 'admin'
let job = null;
let room = null;
let peerProfile = null;
let messages = [];
let oldestLoadedAt = null;
let replyingTo = null;
let presenceChannel = null;
let typingTimeout = null;
let isBlocked = false;
let settings = { muted: false, archived: false, wallpaper: null };
let recorder = null;
let recordedChunks = [];
let recordStart = null;

const PAGE_SIZE = 30;

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : ''; }
function formatDateLabel(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    if (dd.getTime() === today.getTime()) return 'Today';
    if (dd.getTime() === yest.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile) return;
    myRole = currentProfile.role === 'driver' ? 'driver' : currentProfile.role === 'admin' ? 'admin' : 'customer';

    document.getElementById('backBtn').href = myRole === 'driver' ? 'driver-dashboard.html' : myRole === 'admin' ? 'admin-chat.html' : 'dashboard.html';

    const jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) { document.getElementById('peerName').textContent = 'No delivery specified.'; return; }

    const { data: jobData } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!jobData) { document.getElementById('peerName').textContent = 'Delivery not found.'; return; }
    job = jobData;

    if (myRole === 'customer' && job.customer_id !== currentUser.id) { document.getElementById('peerName').textContent = 'Not authorized.'; return; }
    if (myRole === 'driver' && job.driver_id !== currentUser.id) { document.getElementById('peerName').textContent = 'Not authorized.'; return; }

    await ensureRoom();
    if (!room) { document.getElementById('peerName').textContent = 'Chat not available yet — waiting for a driver to be assigned.'; return; }

    await loadPeer();
    await loadSettings();
    await checkBlocked();
    renderQuickReplies();
    wireUi();
    await loadInitialMessages();
    subscribeRealtime();
    setupPresence();
    markRoomRead();

    document.getElementById('jobTag').textContent = 'Delivery #' + job.id.slice(0, 8);
});

async function ensureRoom() {
    let { data } = await supabase.from('chat_rooms').select('*').eq('delivery_id', job.id).single();
    if (data) { room = data; return; }

    if (!job.driver_id) return;
    const { data: created } = await supabase.from('chat_rooms')
        .insert({ delivery_id: job.id, customer_id: job.customer_id, driver_id: job.driver_id })
        .select().single();
    room = created;
}

async function loadPeer() {
    const peerId = myRole === 'driver' ? room.customer_id : room.driver_id;
    if (!peerId) { document.getElementById('peerName').textContent = 'Waiting for driver'; return; }
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_url, last_seen_at, is_online').eq('id', peerId).single();
    peerProfile = data;
    document.getElementById('peerName').textContent = peerProfile ? peerProfile.full_name : 'Unknown';
    updatePeerStatus();
}

function updatePeerStatus(online) {
    const el = document.getElementById('peerStatus');
    if (online) { el.textContent = 'Online'; return; }
    if (peerProfile && peerProfile.last_seen_at) {
        const mins = Math.round((Date.now() - new Date(peerProfile.last_seen_at).getTime()) / 60000);
        el.textContent = mins < 1 ? 'Last seen just now' : 'Last seen ' + mins + ' min ago';
    } else {
        el.textContent = 'Offline';
    }
}

async function loadSettings() {
    const { data } = await supabase.from('chat_participant_settings').select('*').eq('room_id', room.id).eq('user_id', currentUser.id).single();
    if (data) settings = data;
    document.getElementById('muteBtn').textContent = settings.muted ? '🔔 Unmute' : '🔕 Mute';
    document.getElementById('archiveBtn').textContent = settings.archived ? '📤 Unarchive' : '📥 Archive';
    if (settings.wallpaper) document.getElementById('messageArea').style.backgroundImage = 'url(' + settings.wallpaper + ')';
}

async function checkBlocked() {
    const peerId = myRole === 'driver' ? room.customer_id : room.driver_id;
    if (!peerId) return;
    const { data: theyBlockedMe } = await supabase.from('user_blocks').select('*').eq('blocker_id', peerId).eq('blocked_id', currentUser.id).maybeSingle();
    const { data: iBlockedThem } = await supabase.from('user_blocks').select('*').eq('blocker_id', currentUser.id).eq('blocked_id', peerId).maybeSingle();
    isBlocked = !!(theyBlockedMe || iBlockedThem);
    document.getElementById('blockedNote').classList.toggle('hidden', !isBlocked);
    document.getElementById('chatBottom').classList.toggle('hidden', isBlocked);
    document.getElementById('blockBtn').textContent = iBlockedThem ? '✅ Unblock' : '🚫 Block';
}

function renderQuickReplies() {
    if (myRole !== 'driver') return;
    const replies = ["I'm here", 'Please answer', 'Running 5 minutes late', 'Collected', 'Delivered'];
    const wrap = document.getElementById('quickReplies');
    wrap.classList.remove('hidden');
    wrap.innerHTML = replies.map(function (r) { return '<button data-text="' + escapeHtml(r) + '">' + escapeHtml(r) + '</button>'; }).join('');
    wrap.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () { sendMessage(btn.dataset.text); });
    });
}

function wireUi() {
    document.getElementById('menuBtn').addEventListener('click', function () { document.getElementById('menuPanel').classList.toggle('open'); });
    document.getElementById('searchToggleBtn').addEventListener('click', function () {
        document.getElementById('chatSearchBar').classList.toggle('show');
        document.getElementById('menuPanel').classList.remove('open');
        document.getElementById('searchInput').focus();
    });
    document.getElementById('searchInput').addEventListener('input', renderMessages);
    document.getElementById('muteBtn').addEventListener('click', function () { saveSettings({ muted: !settings.muted }); });
    document.getElementById('archiveBtn').addEventListener('click', function () { saveSettings({ archived: !settings.archived }); });
    document.getElementById('wallpaperBtn').addEventListener('click', function () {
        const url = prompt('Paste an image URL to use as chat wallpaper (leave blank to clear):', settings.wallpaper || '');
        if (url === null) return;
        saveSettings({ wallpaper: url || null });
        document.getElementById('messageArea').style.backgroundImage = url ? 'url(' + url + ')' : 'none';
    });
    document.getElementById('blockBtn').addEventListener('click', toggleBlock);

    document.getElementById('sendBtn').addEventListener('click', function () {
        const input = document.getElementById('messageInput');
        if (input.value.trim()) { sendMessage(input.value.trim()); input.value = ''; setTyping(false); }
    });
    document.getElementById('messageInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { document.getElementById('sendBtn').click(); }
    });
    document.getElementById('messageInput').addEventListener('input', function () {
        setTyping(true);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(function () { setTyping(false); }, 2500);
    });

    document.getElementById('attachBtn').addEventListener('click', function () { document.getElementById('attachMenu').classList.toggle('open'); });
    document.getElementById('imageFileInput').addEventListener('change', handleImageUpload);
    document.getElementById('cancelReplyBtn').addEventListener('click', function () { replyingTo = null; document.getElementById('replyPreviewBar').classList.remove('show'); });

    document.getElementById('fullscreenImg').addEventListener('click', function () { this.classList.remove('open'); });

    document.getElementById('messageArea').addEventListener('scroll', function () {
        if (this.scrollTop < 40) loadOlderMessages();
    });

    let voiceHoldTimer = null;
    const voiceBtn = document.getElementById('voiceBtn');
    voiceBtn.addEventListener('mousedown', startRecording);
    voiceBtn.addEventListener('touchstart', function (e) { e.preventDefault(); startRecording(); });
    voiceBtn.addEventListener('mouseup', stopRecording);
    voiceBtn.addEventListener('touchend', stopRecording);

    document.addEventListener('click', function (e) {
        if (!e.target.closest('#attachMenu') && !e.target.closest('#attachBtn')) document.getElementById('attachMenu').classList.remove('open');
        if (!e.target.closest('#menuPanel') && !e.target.closest('#menuBtn')) document.getElementById('menuPanel').classList.remove('open');
    });

    document.querySelector('button[data-action="attach-image"]').addEventListener('click', function () {
        document.getElementById('imageFileInput').click();
        document.getElementById('attachMenu').classList.remove('open');
    });
    document.querySelector('button[data-action="attach-location"]').addEventListener('click', function () {
        sendLocation();
        document.getElementById('attachMenu').classList.remove('open');
    });
}

async function saveSettings(patch) {
    settings = Object.assign(settings, patch);
    await supabase.from('chat_participant_settings').upsert({ room_id: room.id, user_id: currentUser.id, ...settings, updated_at: new Date().toISOString() });
    document.getElementById('muteBtn').textContent = settings.muted ? '🔔 Unmute' : '🔕 Mute';
    document.getElementById('archiveBtn').textContent = settings.archived ? '📤 Unarchive' : '📥 Archive';
    document.getElementById('menuPanel').classList.remove('open');
}

async function toggleBlock() {
    const peerId = myRole === 'driver' ? room.customer_id : room.driver_id;
    if (!peerId) return;
    const { data: existing } = await supabase.from('user_blocks').select('*').eq('blocker_id', currentUser.id).eq('blocked_id', peerId).maybeSingle();
    if (existing) await supabase.from('user_blocks').delete().eq('blocker_id', currentUser.id).eq('blocked_id', peerId);
    else await supabase.from('user_blocks').insert({ blocker_id: currentUser.id, blocked_id: peerId });
    document.getElementById('menuPanel').classList.remove('open');
    await checkBlocked();
}

async function loadInitialMessages() {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    messages = (data || []).reverse();
    oldestLoadedAt = messages.length ? messages[0].created_at : null;
    await loadReactionsFor(messages);
    renderMessages();
    scrollToBottom();
}

async function loadOlderMessages() {
    if (!oldestLoadedAt) return;
    const area = document.getElementById('messageArea');
    const prevHeight = area.scrollHeight;
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', room.id).lt('created_at', oldestLoadedAt).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (!data || !data.length) return;
    const older = data.reverse();
    messages = older.concat(messages);
    oldestLoadedAt = messages[0].created_at;
    await loadReactionsFor(older);
    renderMessages();
    area.scrollTop = area.scrollHeight - prevHeight;
}

async function loadReactionsFor(msgs) {
    if (!msgs.length) return;
    const ids = msgs.map(function (m) { return m.id; });
    const { data } = await supabase.from('message_reactions').select('*').in('message_id', ids);
    const byMsg = {};
    (data || []).forEach(function (r) { (byMsg[r.message_id] = byMsg[r.message_id] || []).push(r); });
    msgs.forEach(function (m) { m._reactions = byMsg[m.id] || []; });
}

function scrollToBottom() {
    const area = document.getElementById('messageArea');
    area.scrollTop = area.scrollHeight;
}

function messageById(id) { return messages.find(function (m) { return m.id === id; }); }

function renderMessages() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    const area = document.getElementById('messageArea');
    let lastDate = null;
    const html = [];

    messages.forEach(function (m) {
        if (m.deleted_for_everyone) return;
        if (q && m.message && !m.message.toLowerCase().includes(q)) return;

        const dateLabel = formatDateLabel(m.created_at);
        if (dateLabel !== lastDate) { html.push('<div class="date-sep">' + dateLabel + '</div>'); lastDate = dateLabel; }

        if (m.message_type === 'system') {
            html.push('<div class="msg-row system"><div class="bubble">' + escapeHtml(m.message) + '</div></div>');
            return;
        }

        const mine = m.sender_id === currentUser.id;
        const reply = m.reply_to ? messageById(m.reply_to) : null;
        let body = '';

        if (m.message_type === 'image') {
            body = '<img class="msg-img" src="' + escapeHtml(m.image_url) + '" data-action="view-image">';
        } else if (m.message_type === 'voice') {
            body = '<div class="voice-player"><audio controls src="' + escapeHtml(m.voice_url) + '" style="max-width:180px; height:32px;"></audio><span>' + Math.round(m.voice_duration_seconds || 0) + 's</span></div>';
        } else if (m.message_type === 'location') {
            body = '<div class="location-card">📍 Shared location<div class="mini-loc-map" id="locmap-' + m.id + '" data-lat="' + m.location_lat + '" data-lng="' + m.location_lng + '"></div></div>';
        } else {
            body = escapeHtml(m.message || '') + (m.deleted ? ' <i>(deleted)</i>' : '');
        }

        const reactionsHtml = (m._reactions || []).length
            ? '<div class="msg-reactions">' + Object.entries((m._reactions || []).reduce(function (acc, r) { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {})).map(function (e) { return e[0] + e[1]; }).join(' ') + '</div>'
            : '';

        const ticks = mine ? (m.read_at ? '<span style="color:#3E8BFF;">✓✓</span>' : '<span>✓✓</span>') : '';

        html.push('<div class="msg-row ' + (mine ? 'mine' : '') + '" data-id="' + m.id + '">' +
            '<div class="bubble">' +
                (reply ? '<div class="reply-preview">' + escapeHtml((reply.message || '[attachment]').slice(0, 60)) + '</div>' : '') +
                body +
                reactionsHtml +
                '<div class="msg-meta">' + (m.edited ? '<i>edited</i>' : '') + formatTime(m.created_at) + ' ' + ticks + '</div>' +
                '<div class="msg-actions">' +
                    '<span data-action="reply">Reply</span>' +
                    '<span data-action="react">React</span>' +
                    (mine && !m.deleted ? '<span data-action="edit">Edit</span>' : '') +
                    (mine ? '<span data-action="delete-me">Delete for me</span>' : '') +
                    (mine ? '<span data-action="delete-everyone">Delete for everyone</span>' : '') +
                    '<span data-action="pin">' + (m.pinned ? 'Unpin' : 'Pin') + '</span>' +
                    '<span data-action="copy">Copy</span>' +
                '</div>' +
            '</div>' +
        '</div>');
    });

    area.innerHTML = html.join('');
    wireMessageActions();
    renderPinnedBar();

    messages.filter(function (m) { return m.message_type === 'location'; }).forEach(function (m) {
        const el = document.getElementById('locmap-' + m.id);
        if (el && !el._rendered && el.dataset.lat && el.dataset.lng) {
            el._rendered = true;
            const map = L.map(el).setView([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], 14);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
            L.marker([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)]).addTo(map);
        }
    });
}

function renderPinnedBar() {
    const pinned = messages.filter(function (m) { return m.pinned; });
    const bar = document.getElementById('pinnedBar');
    if (!pinned.length) { bar.classList.remove('show'); return; }
    const last = pinned[pinned.length - 1];
    bar.textContent = '📌 ' + (last.message || '[attachment]').slice(0, 60);
    bar.classList.add('show');
    bar.onclick = function () {
        const row = document.querySelector('.msg-row[data-id="' + last.id + '"]');
        if (row) row.scrollIntoView({ block: 'center' });
    };
}

function wireMessageActions() {
    document.querySelectorAll('.msg-row').forEach(function (row) {
        const id = row.dataset.id;
        const msg = messageById(id);
        if (!msg) return;

        row.querySelectorAll('[data-action]').forEach(function (el) {
            el.addEventListener('click', function () { handleMessageAction(el.dataset.action, msg); });
        });

        const img = row.querySelector('img[data-action="view-image"]');
        if (img) img.addEventListener('click', function () {
            document.getElementById('fullscreenImgTag').src = img.src;
            document.getElementById('fullscreenImg').classList.add('open');
        });
    });
}

async function handleMessageAction(action, msg) {
    if (action === 'reply') {
        replyingTo = msg.id;
        document.getElementById('replyPreviewText').textContent = 'Replying to: ' + (msg.message || '[attachment]').slice(0, 60);
        document.getElementById('replyPreviewBar').classList.add('show');
        document.getElementById('messageInput').focus();
    } else if (action === 'react') {
        const emoji = prompt('React with an emoji:', '👍');
        if (emoji) {
            await supabase.from('message_reactions').upsert({ message_id: msg.id, user_id: currentUser.id, emoji: emoji }, { onConflict: 'message_id,user_id,emoji' });
            await loadReactionsFor([msg]);
            renderMessages();
        }
    } else if (action === 'edit') {
        const text = prompt('Edit message:', msg.message || '');
        if (text !== null && text.trim()) {
            await supabase.from('chat_messages').update({ message: text.trim(), edited: true }).eq('id', msg.id);
            msg.message = text.trim(); msg.edited = true;
            renderMessages();
        }
    } else if (action === 'delete-me') {
        messages = messages.filter(function (m) { return m.id !== msg.id; });
        renderMessages();
    } else if (action === 'delete-everyone') {
        if (!confirm('Delete this message for everyone?')) return;
        await supabase.from('chat_messages').update({ deleted_for_everyone: true, message: null }).eq('id', msg.id);
        msg.deleted_for_everyone = true;
        renderMessages();
    } else if (action === 'pin') {
        await supabase.from('chat_messages').update({ pinned: !msg.pinned }).eq('id', msg.id);
        msg.pinned = !msg.pinned;
        renderMessages();
    } else if (action === 'copy') {
        if (navigator.clipboard) navigator.clipboard.writeText(msg.message || '');
    }
}

async function sendMessage(text, extra) {
    if (isBlocked) return;
    const fields = Object.assign({
        room_id: room.id, sender_id: currentUser.id, sender_type: myRole,
        message: text, message_type: 'text', reply_to: replyingTo,
    }, extra || {});

    replyingTo = null;
    document.getElementById('replyPreviewBar').classList.remove('show');

    const { data, error } = await supabase.from('chat_messages').insert(fields).select().single();
    if (!error && data) {
        messages.push(data);
        renderMessages();
        scrollToBottom();
    }
    await supabase.from('chat_rooms').update({ updated_at: new Date().toISOString() }).eq('id', room.id);
}

async function handleImageUpload() {
    const file = document.getElementById('imageFileInput').files[0];
    if (!file) return;
    const compressed = await compressImage(file);
    const path = room.id + '/' + Date.now() + '.jpg';
    const { error } = await supabase.storage.from('chat-images').upload(path, compressed);
    if (error) { alert('Upload failed: ' + error.message); return; }
    const { data: signed } = await supabase.storage.from('chat-images').createSignedUrl(path, 60 * 60 * 24 * 7);
    await sendMessage(null, { message_type: 'image', image_url: signed ? signed.signedUrl : null });
    document.getElementById('imageFileInput').value = '';
}

function compressImage(file) {
    return new Promise(function (resolve) {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = function (e) {
            img.onload = function () {
                const maxW = 1200;
                const scale = Math.min(1, maxW / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', 0.7);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function sendLocation() {
    if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
    navigator.geolocation.getCurrentPosition(async function (pos) {
        await sendMessage(null, { message_type: 'location', location_lat: pos.coords.latitude, location_lng: pos.coords.longitude });
    }, function () { alert('Could not get your location.'); });
}

function startRecording() {
    if (recorder) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        recordedChunks = [];
        recordStart = Date.now();
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (e) { recordedChunks.push(e.data); };
        recorder.start();
        document.getElementById('voiceBtn').style.color = '#FF6A2B';
    }).catch(function () { alert('Microphone access denied.'); });
}

function stopRecording() {
    if (!recorder) return;
    const durationSec = (Date.now() - recordStart) / 1000;
    recorder.onstop = async function () {
        document.getElementById('voiceBtn').style.color = '';
        recorder.stream.getTracks().forEach(function (t) { t.stop(); });
        recorder = null;
        if (durationSec < 1) return;
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const path = room.id + '/' + Date.now() + '.webm';
        const { error } = await supabase.storage.from('chat-voice').upload(path, blob);
        if (error) { alert('Upload failed: ' + error.message); return; }
        const { data: signed } = await supabase.storage.from('chat-voice').createSignedUrl(path, 60 * 60 * 24 * 7);
        await sendMessage(null, { message_type: 'voice', voice_url: signed ? signed.signedUrl : null, voice_duration_seconds: durationSec });
    };
    recorder.stop();
}

async function setTyping(isTyping) {
    await supabase.from('typing_status').upsert({ room_id: room.id, user_id: currentUser.id, typing: isTyping, updated_at: new Date().toISOString() }, { onConflict: 'room_id,user_id' });
}

async function markRoomRead() {
    await supabase.from('chat_messages').update({ read_at: new Date().toISOString() }).eq('room_id', room.id).is('read_at', null).neq('sender_id', currentUser.id);
}

function subscribeRealtime() {
    supabase.channel('chat-room-' + room.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'room_id=eq.' + room.id }, async function (payload) {
            messages.push(payload.new);
            await loadReactionsFor([payload.new]);
            renderMessages();
            scrollToBottom();
            if (payload.new.sender_id !== currentUser.id) markRoomRead();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: 'room_id=eq.' + room.id }, function (payload) {
            const idx = messages.findIndex(function (m) { return m.id === payload.new.id; });
            if (idx !== -1) { messages[idx] = Object.assign(messages[idx], payload.new); renderMessages(); }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'typing_status', filter: 'room_id=eq.' + room.id }, function (payload) {
            if (payload.new && payload.new.user_id !== currentUser.id) {
                const el = document.getElementById('typingIndicator');
                if (payload.new.typing) {
                    const label = myRole === 'driver' ? 'Customer is typing…' : myRole === 'customer' ? 'Driver is typing…' : 'typing…';
                    el.textContent = label;
                } else {
                    el.textContent = '';
                }
            }
        })
        .subscribe();
}

function setupPresence() {
    presenceChannel = supabase.channel('chat-presence-' + room.id, { config: { presence: { key: currentUser.id } } });
    presenceChannel.on('presence', { event: 'sync' }, function () {
        const state = presenceChannel.presenceState();
        const peerId = myRole === 'driver' ? room.customer_id : room.driver_id;
        updatePeerStatus(peerId && !!state[peerId]);
    });
    presenceChannel.subscribe(async function (status) {
        if (status === 'SUBSCRIBED') await presenceChannel.track({ role: myRole, online_at: new Date().toISOString() });
    });
}
