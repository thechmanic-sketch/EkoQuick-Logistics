let currentUser = null;
let currentProfile = null;
let chat = null;
let messages = [];

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    const deliveryId = new URLSearchParams(window.location.search).get('delivery');

    await ensureChat(deliveryId);
    renderStatus();
    wireUi();
    await loadMessages();
    subscribeRealtime();
});

async function ensureChat(deliveryId) {
    let query = supabase.from('driver_admin_chats').select('*').eq('driver_id', currentUser.id).neq('status', 'resolved').order('created_at', { ascending: false }).limit(1);
    const { data: existing } = await query;
    if (existing && existing[0]) { chat = existing[0]; return; }

    const { data: created } = await supabase.from('driver_admin_chats')
        .insert({ driver_id: currentUser.id, delivery_id: deliveryId || null })
        .select().single();
    chat = created;
}

function renderStatus() {
    document.getElementById('statusLine').textContent = chat.delivery_id ? 'Delivery #' + chat.delivery_id.slice(0, 8) + ' · ' + chat.status : chat.status;
}

function wireUi() {
    document.getElementById('sendBtn').addEventListener('click', send);
    document.getElementById('messageInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
}

async function send() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const { data, error } = await supabase.from('driver_admin_messages').insert({
        chat_id: chat.id, sender_id: currentUser.id, sender_type: 'driver', message: text,
    }).select().single();
    if (!error && data) { messages.push(data); renderMessages(); }
    await supabase.from('driver_admin_chats').update({ status: 'waiting', updated_at: new Date().toISOString() }).eq('id', chat.id);
}

async function loadMessages() {
    const { data } = await supabase.from('driver_admin_messages').select('*').eq('chat_id', chat.id).order('created_at', { ascending: true });
    messages = data || [];
    renderMessages();
}

function renderMessages() {
    const area = document.getElementById('messageArea');
    area.innerHTML = messages.map(function (m) {
        if (m.sender_type === 'system') return '<div class="msg-row system"><div class="bubble">' + escapeHtml(m.message) + '</div></div>';
        const mine = m.sender_type === 'driver';
        return '<div class="msg-row ' + (mine ? 'mine' : '') + '"><div class="bubble">' + escapeHtml(m.message) +
            '<div class="msg-meta">' + formatTime(m.created_at) + '</div></div></div>';
    }).join('');
    area.scrollTop = area.scrollHeight;
}

function subscribeRealtime() {
    supabase.channel('driver-admin-chat-' + chat.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_admin_messages', filter: 'chat_id=eq.' + chat.id }, function (payload) {
            messages.push(payload.new);
            renderMessages();
        })
        .subscribe();
}
