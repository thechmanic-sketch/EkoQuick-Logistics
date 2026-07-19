let currentUser = null;
let allDrivers = [];
let allCustomers = [];

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('admin-login.html');
    if (!currentUser) return;
    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'admin') { await supabase.auth.signOut(); window.location.href = 'admin-login.html'; return; }

    document.getElementById('logoutBtn').addEventListener('click', async function () { await supabase.auth.signOut(); window.location.href = 'login.html'; });
    document.getElementById('fAudience').addEventListener('change', updateSelectedVisibility);
    document.getElementById('sendBtn').addEventListener('click', sendBroadcast);

    const { data: drivers } = await supabase.from('profiles').select('id, full_name, address').eq('role', 'driver');
    allDrivers = drivers || [];
    const { data: customers } = await supabase.from('profiles').select('id, full_name, address').eq('role', 'customer');
    allCustomers = customers || [];

    updateSelectedVisibility();
    await loadHistory();
});

function updateSelectedVisibility() {
    const audience = document.getElementById('fAudience').value;
    const wrap = document.getElementById('selectedWrap');
    const sel = document.getElementById('fSelected');
    if (audience === 'selected_drivers') {
        wrap.classList.remove('hidden');
        sel.innerHTML = allDrivers.map(function (d) { return '<option value="' + d.id + '">' + escapeHtml(d.full_name) + '</option>'; }).join('');
    } else if (audience === 'selected_customers') {
        wrap.classList.remove('hidden');
        sel.innerHTML = allCustomers.map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.full_name) + '</option>'; }).join('');
    } else {
        wrap.classList.add('hidden');
    }
}

async function sendBroadcast() {
    const msg = document.getElementById('msgArea');
    const message = document.getElementById('fMessage').value.trim();
    const audience = document.getElementById('fAudience').value;
    const region = document.getElementById('fRegion').value.trim() || null;
    if (!message) { msg.textContent = 'Enter a message.'; return; }

    let recipients = [];
    if (audience === 'all_drivers') recipients = allDrivers;
    else if (audience === 'all_customers') recipients = allCustomers;
    else if (audience === 'selected_drivers' || audience === 'selected_customers') {
        const ids = Array.from(document.getElementById('fSelected').selectedOptions).map(function (o) { return o.value; });
        const pool = audience === 'selected_drivers' ? allDrivers : allCustomers;
        recipients = pool.filter(function (p) { return ids.includes(p.id); });
    }

    if (region && (audience === 'all_drivers' || audience === 'all_customers')) {
        recipients = recipients.filter(function (p) { return p.address && p.address.toLowerCase().includes(region.toLowerCase()); });
    }
    const recipientIds = recipients.map(function (p) { return p.id; });

    if (!recipientIds.length) { msg.textContent = 'No recipients matched.'; return; }

    const userType = audience.includes('driver') ? 'driver' : 'customer';
    const notifRows = recipientIds.map(function (id) {
        return { user_id: id, user_type: userType, title: 'Announcement', body: message, type: 'broadcast', priority: 'normal', action_type: null };
    });

    msg.textContent = 'Sending...';
    const { error: notifError } = await supabase.from('notifications').insert(notifRows);
    if (notifError) { msg.textContent = 'Could not send: ' + notifError.message; return; }

    await supabase.from('broadcasts').insert({
        sender_admin_id: currentUser.id, audience: audience, region: region, message: message, recipient_count: recipientIds.length,
    });

    msg.textContent = 'Broadcast sent to ' + recipientIds.length + ' recipient(s).';
    document.getElementById('fMessage').value = '';
    await loadHistory();
}

async function loadHistory() {
    const { data } = await supabase.from('broadcasts').select('*').order('created_at', { ascending: false }).limit(50);
    const body = document.getElementById('historyBody');
    const empty = document.getElementById('emptyState');
    if (!data || !data.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    body.innerHTML = data.map(function (b) {
        return '<tr><td>' + formatTime(b.created_at) + '</td><td>' + b.audience + '</td><td>' + escapeHtml(b.region || '—') + '</td><td>' + escapeHtml(b.message) + '</td><td>' + b.recipient_count + '</td></tr>';
    }).join('');
}
