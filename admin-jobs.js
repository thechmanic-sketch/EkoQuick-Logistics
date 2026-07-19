const STATUS_LABELS = {
    pending: 'Pending',
    offered: 'Assigned',
    to_pickup: 'Heading to Pickup',
    to_dropoff: 'Heading to Drop-off',
    delivered: 'Completed',
    cancelled: 'Cancelled',
};
const STATUS_ORDER = ['pending', 'offered', 'to_pickup', 'to_dropoff', 'delivered'];
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESEND_MAX = 3;

let allJobs = [];
let allDrivers = [];
let allCustomers = [];
let allComplaints = [];
let profilesById = {};
let filteredJobs = [];
let selectedIds = new Set();
let currentPage = 1;
let pageSize = 25;

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;

    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }
    window.currentAdminName = profile.full_name || profile.email || 'Admin';

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('exportBtn').addEventListener('click', function () { exportJobs(filteredJobs); });
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
    document.getElementById('jobSearch').addEventListener('input', function () { currentPage = 1; applyFilters(); });
    document.getElementById('statusFilter').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('driverFilter').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('vehicleFilter').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('dateFrom').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('dateTo').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('pageSizeSelect').addEventListener('change', function () { pageSize = parseInt(this.value, 10); currentPage = 1; renderTable(); });
    document.getElementById('bulkCancelBtn').addEventListener('click', bulkCancel);
    document.getElementById('bulkExportBtn').addEventListener('click', function () { exportJobs(filteredJobs.filter(function (j) { return selectedIds.has(j.id); })); });

    populateVehicleFilter();
    await loadDriverShare();
    await loadAll();
    openJobFromUrl();

    supabase.channel('admin-jobs-page').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll).subscribe();
});

function openJobFromUrl() {
    const jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) return;
    const job = allJobs.find(function (j) { return j.id === jobId; });
    if (job) openJobDrawer(job.id);
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

function formatTime(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function whatsappResend(phone, message) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (!digits) { alert('No phone number on file for this contact.'); return; }
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
}

function populateVehicleFilter() {
    const sel = document.getElementById('vehicleFilter');
    (typeof VEHICLES !== 'undefined' ? VEHICLES : []).forEach(function (v) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.icon + ' ' + v.label;
        sel.appendChild(opt);
    });
}

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: drivers } = await supabase.from('profiles').select('*').eq('role', 'driver');
    const { data: customers } = await supabase.from('profiles').select('*').eq('role', 'customer');
    const { data: complaints } = await supabase.from('complaints').select('*');

    allJobs = jobs || [];
    allDrivers = drivers || [];
    allCustomers = customers || [];
    allComplaints = complaints || [];
    profilesById = {};
    allDrivers.forEach(function (d) { profilesById[d.id] = d; });
    allCustomers.forEach(function (c) { profilesById[c.id] = c; });

    populateDriverFilter();
    renderSummaryCards();
    applyFilters();
}

function populateDriverFilter() {
    const sel = document.getElementById('driverFilter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All drivers</option>' + allDrivers.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + '</option>';
    }).join('');
    sel.value = current;
}

function renderSummaryCards() {
    const total = allJobs.length;
    const pending = allJobs.filter(function (j) { return j.status === 'pending'; }).length;
    const assigned = allJobs.filter(function (j) { return j.status === 'offered'; }).length;
    const active = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; }).length;
    const completed = allJobs.filter(function (j) { return j.status === 'delivered'; }).length;
    const cancelled = allJobs.filter(function (j) { return j.status === 'cancelled'; }).length;

    document.getElementById('jobCountLabel').textContent = total + ' job' + (total === 1 ? '' : 's');

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('summaryCards').innerHTML =
        card('Total Jobs', total) + card('Pending', pending) + card('Assigned', assigned) +
        card('Active Deliveries', active) + card('Completed', completed) + card('Cancelled', cancelled);
}

function applyFilters() {
    const q = document.getElementById('jobSearch').value.trim().toLowerCase();
    const status = document.getElementById('statusFilter').value;
    const driverId = document.getElementById('driverFilter').value;
    const vehicle = document.getElementById('vehicleFilter').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    filteredJobs = allJobs.filter(function (j) {
        if (status && j.status !== status) return false;
        if (driverId && j.driver_id !== driverId) return false;
        if (vehicle && j.vehicle !== vehicle) return false;
        if (dateFrom && new Date(j.created_at) < new Date(dateFrom)) return false;
        if (dateTo && new Date(j.created_at) > new Date(dateTo + 'T23:59:59')) return false;
        if (q) {
            const driver = profilesById[j.driver_id];
            const customer = profilesById[j.customer_id];
            const hay = (
                j.id + ' ' + (customer ? customer.full_name : '') + ' ' + (j.customer_phone || '') + ' ' +
                (driver ? driver.full_name : '') + ' ' + (j.pickup || '') + ' ' + (j.dropoff || '')
            ).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    });

    selectedIds.clear();
    renderTable();
}

function progressDots(status) {
    if (status === 'cancelled') {
        return '<div class="progress-dots cancelled"><span class="dot filled"></span><span class="dot filled"></span><span class="dot filled"></span><span class="dot filled"></span><span class="dot filled"></span></div>';
    }
    const idx = STATUS_ORDER.indexOf(status);
    const filledCount = idx + 1;
    let html = '<div class="progress-dots">';
    for (let i = 0; i < 5; i++) html += '<span class="dot' + (i < filledCount ? ' filled' : '') + '"></span>';
    html += '</div>';
    return html;
}

function computeEta(job) {
    if (job.status !== 'to_pickup' && job.status !== 'to_dropoff') return '—';
    const destLat = job.status === 'to_pickup' ? job.pickup_lat : job.dropoff_lat;
    const destLng = job.status === 'to_pickup' ? job.pickup_lng : job.dropoff_lng;
    if (!job.driver_lat || !job.driver_lng || !destLat || !destLng) return '—';
    const km = haversineKm(job.driver_lat, job.driver_lng, destLat, destLng);
    return Math.round((km / 30) * 60) + ' min';
}

function renderTable() {
    const wrap = document.getElementById('jobsTableWrap');
    if (!allJobs.length) { wrap.innerHTML = '<div class="empty">No jobs found.</div>'; document.getElementById('pagination').innerHTML = ''; return; }
    if (!filteredJobs.length) { wrap.innerHTML = '<div class="empty">No jobs match your filters.</div>'; document.getElementById('pagination').innerHTML = ''; return; }

    const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    const pageItems = filteredJobs.slice(start, start + pageSize);

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr>' +
        '<th><input type="checkbox" id="selectAllBox"></th>' +
        '<th>Job ID</th><th>Customer</th><th>Phone</th><th>Pickup</th><th>Drop-off</th><th>Driver</th><th>Vehicle</th>' +
        '<th>Status</th><th>Progress</th><th>Distance</th><th>Fee</th><th>Created</th><th>ETA</th><th>Rating</th><th>Actions</th>' +
        '</tr></thead><tbody>' +
        pageItems.map(function (job) {
            const customer = profilesById[job.customer_id];
            const driver = profilesById[job.driver_id];
            const statusBadge = job.status === 'delivered' ? 'delivered' : job.status === 'cancelled' ? 'cancelled' : job.status === 'pending' ? 'pending' : 'assigned';
            return '<tr style="cursor:pointer;" data-job="' + job.id + '">' +
                '<td><input type="checkbox" class="rowCheck" data-job="' + job.id + '" ' + (selectedIds.has(job.id) ? 'checked' : '') + '></td>' +
                '<td>' + job.id.slice(0, 8) + '</td>' +
                '<td>' + escapeHtml(customer ? customer.full_name : '—') + '</td>' +
                '<td>' + escapeHtml(job.customer_phone || '—') + '</td>' +
                '<td>' + escapeHtml(job.pickup) + '</td>' +
                '<td>' + escapeHtml(job.dropoff) + '</td>' +
                '<td>' + escapeHtml(driver ? driver.full_name : '—') + '</td>' +
                '<td>' + vehicleLabel(job.vehicle) + '</td>' +
                '<td><span class="badge ' + statusBadge + '">' + STATUS_LABELS[job.status] + '</span></td>' +
                '<td>' + progressDots(job.status) + '</td>' +
                '<td>' + (job.distance || '—') + (job.distance ? ' km' : '') + '</td>' +
                '<td>R' + (Number(job.quote) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '</td>' +
                '<td>' + (formatTime(job.created_at) || '—') + '</td>' +
                '<td>' + computeEta(job) + '</td>' +
                '<td>' + (job.rating ? job.rating + ' ★' : '—') + '</td>' +
                '<td>' + rowActionsMenu(job) + '</td>' +
                '</tr>';
        }).join('') +
        '</tbody></table>';

    wrap.querySelectorAll('tr[data-job]').forEach(function (row) {
        row.addEventListener('click', function (e) {
            if (e.target.closest('.actions-menu') || e.target.type === 'checkbox') return;
            openJobDrawer(row.dataset.job);
        });
    });
    wrap.querySelectorAll('.rowCheck').forEach(function (box) {
        box.addEventListener('click', function (e) { e.stopPropagation(); });
        box.addEventListener('change', function () {
            if (box.checked) selectedIds.add(box.dataset.job); else selectedIds.delete(box.dataset.job);
            updateBulkBar();
        });
    });
    const selectAll = document.getElementById('selectAllBox');
    selectAll.addEventListener('click', function (e) { e.stopPropagation(); });
    selectAll.addEventListener('change', function () {
        pageItems.forEach(function (j) { if (selectAll.checked) selectedIds.add(j.id); else selectedIds.delete(j.id); });
        renderTable();
    });

    wireRowActionButtons(wrap);
    updateBulkBar();

    const pag = document.getElementById('pagination');
    pag.innerHTML =
        '<button class="btn btn-outline-blue" id="prevPage" style="width:auto;" ' + (currentPage <= 1 ? 'disabled' : '') + '>Prev</button>' +
        '<span class="meta">Page ' + currentPage + ' of ' + totalPages + ' (' + filteredJobs.length + ' jobs)</span>' +
        '<button class="btn btn-outline-blue" id="nextPage" style="width:auto;" ' + (currentPage >= totalPages ? 'disabled' : '') + '>Next</button>';
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    if (prevBtn) prevBtn.addEventListener('click', function () { currentPage--; renderTable(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { currentPage++; renderTable(); });
}

function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    if (!selectedIds.size) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    document.getElementById('bulkCountLabel').textContent = selectedIds.size + ' selected';
    const selectedJobs = filteredJobs.filter(function (j) { return selectedIds.has(j.id); });
    const allCancellable = selectedJobs.every(function (j) { return j.status !== 'delivered' && j.status !== 'cancelled'; });
    document.getElementById('bulkCancelBtn').classList.toggle('hidden', !allCancellable);
}

function rowActionsMenu(job) {
    const items = [];
    const isDone = job.status === 'delivered';
    const isCancelled = job.status === 'cancelled';

    if (job.status === 'pending') {
        items.push(btn('assign', 'Assign Driver'));
        items.push(btn('edit', 'Edit Job'));
        items.push(btn('contact-customer', 'Contact Customer'));
        items.push(btn('resend-collection', 'Resend Pickup Code'));
        items.push(btn('cancel', 'Cancel Job'));
    } else if (job.status === 'offered') {
        items.push(btn('assign', 'Reassign Driver'));
        items.push(btn('contact-driver', 'Contact Driver'));
        items.push(btn('contact-customer', 'Contact Customer'));
        items.push(btn('resend-collection', 'Resend Pickup Code'));
        items.push(btn('view-driver', 'View Driver'));
        items.push(btn('cancel', 'Cancel Job'));
    } else if (job.status === 'to_pickup' || job.status === 'to_dropoff') {
        items.push(btn('track', 'Live Track'));
        items.push(btn('contact-driver', 'Contact Driver'));
        items.push(btn('contact-customer', 'Contact Customer'));
        items.push(btn(job.status === 'to_pickup' ? 'resend-collection' : 'resend-delivery', job.status === 'to_pickup' ? 'Resend Pickup Code' : 'Resend Delivery Code'));
        items.push(btn('cancel', 'Cancel Job'));
    } else if (isDone) {
        items.push(btn('view-timeline', 'View Timeline'));
        items.push(btn('view-review', 'View Customer Review'));
        items.push(btn('print', 'Print Job'));
    } else if (isCancelled) {
        items.push(btn('view-cancellation', 'View Cancellation Reason'));
        items.push(btn('view-driver', 'View Driver'));
    }
    items.push(btn('details', 'View Details'));

    function btn(action, label) {
        return '<button data-action="' + action + '" data-job="' + job.id + '">' + label + '</button>';
    }

    return '<details class="actions-menu"><summary>⋮</summary><div class="menu-body">' + items.join('') + '</div></details>';
}

function wireRowActionButtons(wrap) {
    wrap.querySelectorAll('button[data-action]').forEach(function (b) {
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            const job = allJobs.find(function (j) { return j.id === b.dataset.job; });
            if (!job) return;
            const handlers = {
                'assign': function () { openJobDrawer(job.id); },
                'edit': function () { openJobDrawer(job.id); },
                'details': function () { openJobDrawer(job.id); },
                'view-timeline': function () { openJobDrawer(job.id); },
                'view-review': function () { openJobDrawer(job.id); },
                'view-cancellation': function () { openJobDrawer(job.id); },
                'view-driver': function () { openJobDrawer(job.id); },
                'track': function () { window.location.href = 'admin-fleet-map.html'; },
                'contact-driver': function () { const d = profilesById[job.driver_id]; whatsappResend(d ? d.phone : null, 'Ekoquick — regarding order ' + job.id.slice(0, 8) + ' (' + job.pickup + ' → ' + job.dropoff + ').'); },
                'contact-customer': function () { whatsappResend(job.customer_phone, 'Ekoquick — regarding your order ' + job.id.slice(0, 8) + ' (' + job.pickup + ' → ' + job.dropoff + ').'); },
                'resend-collection': function () { resendCode(job, 'collection'); },
                'resend-delivery': function () { resendCode(job, 'delivery'); },
                'cancel': function () { cancelJob(job.id); },
                'print': function () { printJob(job); },
            };
            if (handlers[b.dataset.action]) handlers[b.dataset.action]();
        });
    });
}

async function resendCode(job, type) {
    const isCollection = type === 'collection';
    const count = (isCollection ? job.collection_code_resend_count : job.delivery_code_resend_count) || 0;
    const lastSent = isCollection ? job.collection_code_last_sent_at : job.delivery_code_last_sent_at;
    const code = isCollection ? job.collection_code : job.delivery_code;

    if (job.status === 'delivered' || job.status === 'cancelled') { alert('This job is no longer active.'); return; }
    if (!code) { alert('No code generated for this job.'); return; }
    if (count >= RESEND_MAX) { alert('Maximum resend attempts (' + RESEND_MAX + ') reached.'); return; }
    if (lastSent && (Date.now() - new Date(lastSent).getTime()) < RESEND_COOLDOWN_MS) { alert('Please wait a moment before resending again.'); return; }
    if (!confirm('Resend verification code to customer?')) return;

    const phone = isCollection ? job.customer_phone : job.receiver_phone;
    const label = isCollection ? 'pickup' : 'delivery';
    whatsappResend(phone, 'Ekoquick ' + label + ' code reminder: ' + code + ' — give this to ' + (isCollection ? 'your driver at pickup.' : 'the driver when your parcel arrives.'));

    const field = isCollection ? 'collection_code_resend_count' : 'delivery_code_resend_count';
    const sentField = isCollection ? 'collection_code_last_sent_at' : 'delivery_code_last_sent_at';
    const fields = {};
    fields[field] = count + 1;
    fields[sentField] = new Date().toISOString();
    await supabase.from('jobs').update(fields).eq('id', job.id);
    loadAll();
}

async function cancelJob(jobId) {
    const reason = prompt('Reason for cancellation:');
    if (reason === null) return;
    const { error } = await supabase.from('jobs').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: reason.trim() || null }).eq('id', jobId);
    if (error) { alert('Failed to cancel: ' + error.message); return; }
    loadAll();
}

async function bulkCancel() {
    const jobs = filteredJobs.filter(function (j) { return selectedIds.has(j.id); });
    if (!jobs.length) return;
    if (!confirm('Cancel ' + jobs.length + ' selected job(s)?')) return;
    for (const job of jobs) {
        await supabase.from('jobs').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', job.id);
    }
    selectedIds.clear();
    loadAll();
}

function exportJobs(jobs) {
    if (!jobs.length) { alert('No jobs to export.'); return; }
    const headers = ['Job ID', 'Customer', 'Phone', 'Pickup', 'Drop-off', 'Driver', 'Vehicle', 'Status', 'Distance', 'Fee', 'Created', 'Delivered'];
    const rows = jobs.map(function (j) {
        const customer = profilesById[j.customer_id];
        const driver = profilesById[j.driver_id];
        return [
            j.id, customer ? customer.full_name : '', j.customer_phone || '', j.pickup, j.dropoff,
            driver ? driver.full_name : '', j.vehicle, STATUS_LABELS[j.status], j.distance || '', j.quote || '',
            j.created_at, j.delivered_at || '',
        ].map(function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; }).join(',');
    });
    const csv = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ekoquick-jobs-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function printJob(job) {
    const customer = profilesById[job.customer_id];
    const driver = profilesById[job.driver_id];
    const w = window.open('', '_blank');
    w.document.write(
        '<html><head><title>Job ' + job.id.slice(0, 8) + '</title></head><body style="font-family:sans-serif;">' +
        '<h2>Ekoquick — Job ' + job.id.slice(0, 8) + '</h2>' +
        '<p>Customer: ' + escapeHtml(customer ? customer.full_name : '—') + ' (' + escapeHtml(job.customer_phone || '') + ')</p>' +
        '<p>Route: ' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</p>' +
        '<p>Driver: ' + escapeHtml(driver ? driver.full_name : '—') + '</p>' +
        '<p>Fee: R' + (Number(job.quote) || 0).toFixed(2) + '</p>' +
        '<p>Status: ' + STATUS_LABELS[job.status] + '</p>' +
        '<p>Delivered: ' + (formatTime(job.delivered_at) || '—') + '</p>' +
        '</body></html>'
    );
    w.document.close();
    w.print();
}

function closeDrawer() {
    document.getElementById('jobDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
}

function kv(label, value) {
    return '<div class="kv-row"><span>' + label + '</span><span>' + escapeHtml(value === 0 ? '0' : (value || '—')) + '</span></div>';
}

function otpStatus(job, type) {
    const isCollection = type === 'collection';
    const code = isCollection ? job.collection_code : job.delivery_code;
    if (!code) return null;
    const verifiedAt = isCollection ? job.to_dropoff_at : job.delivered_at;
    const verifiedBefore = isCollection ? (job.status === 'to_dropoff' || job.status === 'delivered') : job.status === 'delivered';
    const status = verifiedBefore ? 'Verified' : (job.status === 'cancelled' ? 'Expired' : 'Pending');
    return {
        code: code,
        status: status,
        lastSent: isCollection ? job.collection_code_last_sent_at : job.delivery_code_last_sent_at,
        resendCount: (isCollection ? job.collection_code_resend_count : job.delivery_code_resend_count) || 0,
        verifiedAt: verifiedBefore ? verifiedAt : null,
    };
}

function openJobDrawer(jobId) {
    const job = allJobs.find(function (j) { return j.id === jobId; });
    if (!job) return;
    const customer = profilesById[job.customer_id];
    const driver = profilesById[job.driver_id];
    const complaint = allComplaints.find(function (c) { return c.job_id === job.id; });
    const isActive = job.status !== 'delivered' && job.status !== 'cancelled';

    const durationLabel = (job.created_at && job.delivered_at)
        ? Math.round((new Date(job.delivered_at) - new Date(job.created_at)) / 60000) + ' mins'
        : '—';

    const collectionOtp = otpStatus(job, 'collection');
    const deliveryOtp = otpStatus(job, 'delivery');

    function otpBlock(label, otp) {
        if (!otp) return '';
        return '<div style="margin-bottom:10px;">' +
            kv(label + ' Status', otp.status) +
            kv(label + ' Last Sent', otp.lastSent ? formatTime(otp.lastSent) : '—') +
            kv(label + ' Resend Count', otp.resendCount + ' / ' + RESEND_MAX) +
            (otp.verifiedAt ? kv(label + ' Verified At', formatTime(otp.verifiedAt)) : '') +
            '</div>';
    }

    const drawer = document.getElementById('jobDrawer');
    drawer.innerHTML =
        '<button class="drawer-close" id="closeDrawerBtn">✕</button>' +
        '<h2 style="margin-top:0;">Job ' + job.id.slice(0, 8) + '</h2>' +

        '<h3>General</h3>' +
        kv('Job ID', job.id) + kv('Current Status', STATUS_LABELS[job.status]) +
        kv('Created', formatTime(job.created_at)) + kv('Assigned', formatTime(job.assigned_at)) +
        kv('Delivered', formatTime(job.delivered_at)) + kv('Delivery Duration', durationLabel) +

        '<h3>Customer</h3>' +
        kv('Name', customer ? customer.full_name : '—') + kv('Phone', job.customer_phone || (customer ? customer.phone : '—')) + kv('Email', customer ? customer.email : '—') +

        '<h3>Pickup</h3>' +
        kv('Address', job.pickup) + kv('Contact Person', customer ? customer.full_name : '—') + kv('Contact Number', job.customer_phone) +

        '<h3>Drop-off</h3>' +
        kv('Address', job.dropoff) + kv('Recipient Name', job.receiver_name) + kv('Recipient Phone', job.receiver_phone) +

        '<h3>Driver</h3>' +
        (driver ? kv('Name', driver.full_name) + kv('Phone', driver.phone) + kv('Vehicle Class', vehicleLabel(driver.vehicle_class)) : '<div class="meta">No driver assigned yet.</div>') +
        (isActive ? (
            '<div style="margin-top:8px;">' +
                '<select class="field-plain" id="drawerDriverSelect">' +
                    '<option value="">' + (driver ? 'Reassign to...' : 'Assign a driver...') + '</option>' +
                    allDrivers.map(function (d) { return '<option value="' + d.id + '"' + (d.id === job.driver_id ? ' selected' : '') + '>' + escapeHtml(d.full_name || d.id) + ' — ' + vehicleLabel(d.vehicle_class) + '</option>'; }).join('') +
                '</select>' +
                '<button class="btn btn-blue" id="assignDriverBtn" style="width:auto; margin-top:6px;">' + (driver ? 'Reassign Driver' : 'Assign Driver') + '</button>' +
            '</div>'
        ) : '') +

        '<h3>Delivery Details</h3>' +
        kv('Distance', job.distance ? job.distance + ' km' : '—') + kv('Delivery Fee', 'R' + (Number(job.quote) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kv('Estimated Time', job.duration ? Math.round(job.duration / 60) + ' min' : '—') +
        kv('Actual Delivery Time', durationLabel) +

        '<h3>Timeline</h3>' +
        kv('Job Created', formatTime(job.created_at)) +
        kv('Driver Assigned', formatTime(job.assigned_at)) +
        kv('Heading to Pickup', formatTime(job.to_pickup_at)) +
        kv('Heading to Drop-off (picked up)', formatTime(job.to_dropoff_at)) +
        kv('Delivered', formatTime(job.delivered_at)) +
        (job.cancelled_at ? kv('Cancelled', formatTime(job.cancelled_at)) : '') +

        (isActive ? ('<h3>OTP Verification</h3>' + otpBlock('Pickup Code', collectionOtp) + otpBlock('Delivery Code', deliveryOtp)) : '') +

        (job.status === 'cancelled' ? ('<h3>Cancellation</h3>' + kv('Reason', job.cancellation_reason || 'Not recorded')) : '') +

        '<h3>Customer Feedback</h3>' +
        kv('Rating', job.rating ? job.rating + ' ★' : 'Not yet rated') +
        (job.rating_comment ? kv('Review', job.rating_comment) : '') +
        (complaint ? kv('Complaint', (CATEGORY_LABEL(complaint.category)) + ' — ' + complaint.status) : '');

    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    const assignBtn = document.getElementById('assignDriverBtn');
    if (assignBtn) assignBtn.addEventListener('click', function () { assignDriver(job.id); });
    drawer.classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');
}

async function assignDriver(jobId) {
    const sel = document.getElementById('drawerDriverSelect');
    const driverId = sel.value;
    if (!driverId) { alert('Please select a driver.'); return; }
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'offered', assigned_at: new Date().toISOString() }).eq('id', jobId);
    if (error) { alert('Failed to assign driver: ' + error.message); return; }
    closeDrawer();
    loadAll();
}

function CATEGORY_LABEL(cat) {
    const labels = {
        late_delivery: 'Late Delivery', rude_behaviour: 'Rude Behaviour', dangerous_driving: 'Dangerous Driving',
        damaged_package: 'Damaged Package', missing_package: 'Missing Package', wrong_delivery: 'Wrong Delivery',
        fraud: 'Fraud', poor_communication: 'Poor Communication', vehicle_hygiene: 'Vehicle Hygiene', other: 'Other',
    };
    return labels[cat] || cat;
}

