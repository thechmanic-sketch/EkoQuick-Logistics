let currentUser = null;
let currentProfile = null;
let allTickets = [];
let allJobs = [];
let statusFilter = 'all';
let openTicketId = null;

const CATEGORY_LABELS = {
    delivery_issue: 'Delivery Issue', customer_issue: 'Customer Issue', vehicle_breakdown: 'Vehicle Breakdown',
    navigation_problem: 'Navigation Problem', payment_issue: 'Payment Issue', technical_problem: 'Technical Issue',
    account_issue: 'Account Issue', accident_report: 'Accident Report', safety_concern: 'Safety Concern', other: 'Other',
    driver_complaint: 'Driver Complaint', missing_parcel: 'Missing Parcel', damaged_parcel: 'Damaged Parcel',
};
const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', waiting_driver: 'Waiting for Driver', waiting_customer: 'Waiting', resolved: 'Resolved', closed: 'Closed' };

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    document.getElementById('dispatchWaBtn').href = 'https://wa.me/27676659966?text=' + encodeURIComponent('Dispatch, this is ' + currentProfile.full_name + ', I need assistance.');
    document.getElementById('breakdownBtn').addEventListener('click', function () { emergencyTicket('vehicle_breakdown', 'Vehicle Breakdown'); });
    document.getElementById('accidentBtn').addEventListener('click', function () { emergencyTicket('accident_report', 'Accident'); });
    document.getElementById('medicalBtn').addEventListener('click', function () { emergencyTicket('safety_concern', 'Medical Emergency'); });
    document.getElementById('securityBtn').addEventListener('click', function () { emergencyTicket('safety_concern', 'Security Threat'); });

    document.getElementById('ticketSearch').addEventListener('input', renderTable);
    document.getElementById('createTicketBtn').addEventListener('click', openCreateModal);
    document.getElementById('cancelCreateBtn').addEventListener('click', function () { document.getElementById('createModal').classList.remove('open'); });
    document.getElementById('submitTicketBtn').addEventListener('click', submitTicket);
    document.getElementById('closeModalBtn').addEventListener('click', function () { document.getElementById('ticketModal').classList.remove('open'); openTicketId = null; });
    document.getElementById('sendReplyBtn').addEventListener('click', sendReply);
    document.getElementById('closeTicketBtn').addEventListener('click', closeTicket);

    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            statusFilter = btn.dataset.filter;
            renderTable();
        });
    });

    await loadAll();
    supabase.channel('driver-support-tickets-' + currentUser.id).on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets', filter: 'driver_id=eq.' + currentUser.id }, loadAll).subscribe();
});

async function loadAll() {
    const { data: tickets } = await supabase.from('support_tickets').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false });
    allTickets = tickets || [];

    const { data: jobs } = await supabase.from('jobs').select('id, pickup, dropoff').eq('driver_id', currentUser.id).order('created_at', { ascending: false }).limit(50);
    allJobs = jobs || [];
    document.getElementById('fJob').innerHTML = '<option value="">None</option>' + allJobs.map(function (j) {
        return '<option value="' + j.id + '">' + j.id.slice(0, 8) + ' — ' + escapeHtml(j.pickup) + ' → ' + escapeHtml(j.dropoff) + '</option>';
    }).join('');

    renderSummary();
    renderTable();
}

function renderSummary() {
    const open = allTickets.filter(function (t) { return t.status === 'open'; }).length;
    const inProgress = allTickets.filter(function (t) { return t.status === 'in_progress'; }).length;
    const resolved = allTickets.filter(function (t) { return t.status === 'resolved'; }).length;
    const closed = allTickets.filter(function (t) { return t.status === 'closed'; }).length;

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + open + '</div><div class="lbl">Open Tickets</div></div>' +
        '<div class="summary-card"><div class="num">' + inProgress + '</div><div class="lbl">In Progress</div></div>' +
        '<div class="summary-card"><div class="num">' + resolved + '</div><div class="lbl">Resolved</div></div>' +
        '<div class="summary-card"><div class="num">' + closed + '</div><div class="lbl">Closed</div></div>';
}

function filteredTickets() {
    const q = document.getElementById('ticketSearch').value.trim().toLowerCase();
    return allTickets.filter(function (t) {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (q && !(t.id.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || (t.job_id || '').toLowerCase().includes(q))) return false;
        return true;
    });
}

function renderTable() {
    const tickets = filteredTickets();
    const body = document.getElementById('ticketBody');
    const empty = document.getElementById('emptyState');
    if (!tickets.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = tickets.map(function (t) {
        return '<tr>' +
            '<td>' + t.id.slice(0, 8) + '</td>' +
            '<td>' + escapeHtml(t.subject) + '</td>' +
            '<td>' + (CATEGORY_LABELS[t.category] || t.category) + '</td>' +
            '<td>' + (t.job_id ? t.job_id.slice(0, 8) : '—') + '</td>' +
            '<td>' + t.priority + '</td>' +
            '<td><span class="badge ' + (t.status === 'resolved' ? 'delivered' : t.status === 'closed' ? 'cancelled' : 'pending') + '">' + (STATUS_LABELS[t.status] || t.status) + '</span></td>' +
            '<td>' + formatTime(t.created_at) + '</td>' +
            '<td>' + formatTime(t.updated_at) + '</td>' +
            '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="open-ticket" data-id="' + t.id + '">View</button></td>' +
            '</tr>';
    }).join('');

    body.querySelectorAll('button[data-action="open-ticket"]').forEach(function (btn) {
        btn.addEventListener('click', function () { openTicket(btn.dataset.id); });
    });
}

function openCreateModal() {
    document.getElementById('fSubject').value = '';
    document.getElementById('fDescription').value = '';
    document.getElementById('fAttachment').value = '';
    document.getElementById('createMsg').textContent = '';
    document.getElementById('createModal').classList.add('open');
}

async function submitTicket() {
    const subject = document.getElementById('fSubject').value.trim();
    const description = document.getElementById('fDescription').value.trim();
    const msg = document.getElementById('createMsg');
    if (!subject || !description) { msg.textContent = 'Subject and description are required.'; return; }

    msg.textContent = 'Submitting...';
    const { data: ticket, error } = await supabase.from('support_tickets').insert({
        driver_id: currentUser.id,
        job_id: document.getElementById('fJob').value || null,
        category: document.getElementById('fCategory').value,
        priority: document.getElementById('fPriority').value,
        subject: subject, description: description,
    }).select().single();

    if (error || !ticket) { msg.textContent = 'Could not submit ticket. Please try again.'; return; }

    let attachmentUrl = null;
    const fileInput = document.getElementById('fAttachment');
    if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const path = currentUser.id + '/' + ticket.id + '-' + Date.now() + '.' + file.name.split('.').pop();
        const { error: uploadError } = await supabase.storage.from('support-attachments').upload(path, file);
        if (!uploadError) attachmentUrl = path;
    }

    await supabase.from('support_ticket_messages').insert({
        ticket_id: ticket.id, sender_type: 'driver', sender_name: currentProfile.full_name,
        message: description, attachment_url: attachmentUrl,
    });

    document.getElementById('createModal').classList.remove('open');
    await loadAll();
}

async function emergencyTicket(category, label) {
    if (!confirm(label + ' — send a High Priority alert to dispatch now?')) return;
    const { data: ticket, error } = await supabase.from('support_tickets').insert({
        driver_id: currentUser.id, category: category, priority: 'urgent',
        subject: label + ' — ' + currentProfile.full_name,
        description: 'Driver-initiated emergency report: ' + label,
        incident_type: category, incident_at: new Date().toISOString(),
    }).select().single();
    if (!error && ticket) {
        await supabase.from('support_ticket_messages').insert({ ticket_id: ticket.id, sender_type: 'driver', sender_name: currentProfile.full_name, message: label + ' reported.' });
        alert(label + ' reported to dispatch.');
        loadAll();
    }
}

async function openTicket(ticketId) {
    openTicketId = ticketId;
    const ticket = allTickets.find(function (t) { return t.id === ticketId; });
    document.getElementById('ticketModalTitle').textContent = ticket.subject;
    document.getElementById('ticketModalMeta').innerHTML =
        'Ticket ' + ticket.id.slice(0, 8) + ' · ' + (CATEGORY_LABELS[ticket.category] || ticket.category) + ' · ' + ticket.priority +
        (ticket.job_id ? ' · Delivery ' + ticket.job_id.slice(0, 8) : '') + '<br>Status: ' + (STATUS_LABELS[ticket.status] || ticket.status);

    await renderMessages(ticketId);
    document.getElementById('ticketModal').classList.add('open');

    supabase.channel('driver-ticket-' + ticketId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_ticket_messages', filter: 'ticket_id=eq.' + ticketId }, function () { renderMessages(ticketId); })
        .subscribe();
}

async function renderMessages(ticketId) {
    const { data: messages } = await supabase.from('support_ticket_messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
    document.getElementById('ticketMessages').innerHTML = (messages || []).map(function (m) {
        return '<div class="chat-msg ' + (m.sender_type === 'staff' ? 'staff' : 'driver') + '"><div>' + escapeHtml(m.message) + '</div>' +
            (m.attachment_url ? '<div class="chat-meta">📎 Attachment</div>' : '') +
            '<div class="chat-meta">' + escapeHtml(m.sender_name) + ' · ' + formatTime(m.created_at) + '</div></div>';
    }).join('') || '<div class="empty">No messages yet.</div>';
}

async function sendReply() {
    if (!openTicketId) return;
    const text = document.getElementById('replyText').value.trim();
    if (!text) return;
    await supabase.from('support_ticket_messages').insert({ ticket_id: openTicketId, sender_type: 'driver', sender_name: currentProfile.full_name, message: text });
    await supabase.from('support_tickets').update({ status: 'waiting_driver', updated_at: new Date().toISOString() }).eq('id', openTicketId).eq('status', 'in_progress');
    document.getElementById('replyText').value = '';
    await renderMessages(openTicketId);
}

async function closeTicket() {
    if (!openTicketId) return;
    if (!confirm('Close this ticket?')) return;
    await supabase.from('support_tickets').update({ status: 'closed', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', openTicketId);
    document.getElementById('ticketModal').classList.remove('open');
    openTicketId = null;
    await loadAll();
}
