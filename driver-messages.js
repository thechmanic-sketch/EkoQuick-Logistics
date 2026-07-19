let currentUser = null;

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    await renderCustomerThread();
    await renderSupportThreads();
});

async function renderCustomerThread() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).in('status', ['to_pickup', 'to_dropoff']).limit(1);
    const job = jobs && jobs[0];
    const wrap = document.getElementById('customerThread');
    if (!job) { wrap.innerHTML = '<div class="empty">No active delivery right now.</div>'; return; }

    const custDigits = (job.customer_phone || '').replace(/\D/g, '');
    const recipDigits = (job.receiver_phone || '').replace(/\D/g, '');
    wrap.innerHTML = '<div class="thread-card">' +
        '<div class="route">Job ' + job.id.slice(0, 8) + '</div>' +
        '<div class="meta">Customer: ' + escapeHtml(job.sender_name || '—') + '</div>' +
        (custDigits ? '<a class="btn btn-outline-blue" style="width:auto; margin-top:6px;" target="_blank" rel="noopener" href="https://wa.me/' + custDigits + '?text=' + encodeURIComponent('Hi, this is your Ekoquick driver.') + '">Message Customer</a>' : '') +
        (recipDigits ? ' <a class="btn btn-outline-blue" style="width:auto;" target="_blank" rel="noopener" href="https://wa.me/' + recipDigits + '?text=' + encodeURIComponent('Hi, this is your Ekoquick driver, on my way with your delivery.') + '">Message Recipient</a>' : '') +
    '</div>';
}

async function renderSupportThreads() {
    const { data: tickets } = await supabase.from('support_tickets').select('*').eq('driver_id', currentUser.id).order('updated_at', { ascending: false }).limit(10);
    const wrap = document.getElementById('supportThreads');
    const empty = document.getElementById('emptyState');
    if (!tickets || !tickets.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    const html = [];
    for (const t of tickets) {
        const { data: messages } = await supabase.from('support_ticket_messages').select('*').eq('ticket_id', t.id).order('created_at', { ascending: false }).limit(1);
        const last = messages && messages[0];
        html.push('<div class="thread-card">' +
            '<div class="route">' + escapeHtml(t.subject) + '</div>' +
            '<div class="meta">' + (last ? escapeHtml(last.sender_name) + ': ' + escapeHtml(last.message.slice(0, 80)) : 'No messages') + '</div>' +
            '<div class="meta">' + (last ? formatTime(last.created_at) : '') + '</div>' +
            '<a class="btn btn-outline-blue" style="width:auto; margin-top:6px;" href="driver-support.html">Open</a>' +
        '</div>');
    }
    wrap.innerHTML = html.join('');
}
