let currentUser = null;
let allJobs = [];
let statusFilter = 'all';
let sortMode = 'newest';

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
function downloadCsv(filename, rows) {
    const csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    await loadDriverShare();
    await loadCommissionRules();

    document.getElementById('histSearch').addEventListener('input', renderTable);
    document.getElementById('dateFrom').addEventListener('change', renderTable);
    document.getElementById('dateTo').addEventListener('change', renderTable);
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);

    document.querySelectorAll('#statusFilters .filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#statusFilters .filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            statusFilter = btn.dataset.filter;
            renderTable();
        });
    });
    document.querySelectorAll('#sortFilters .filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#sortFilters .filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            sortMode = btn.dataset.sort;
            renderTable();
        });
    });

    await loadAll();
});

async function loadAll() {
    const { data } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).in('status', ['delivered', 'cancelled']).order('created_at', { ascending: false });
    allJobs = data || [];
    renderSummary();
    renderTable();
}

function renderSummary() {
    const delivered = allJobs.filter(function (j) { return j.status === 'delivered'; });
    const cancelled = allJobs.filter(function (j) { return j.status === 'cancelled'; });
    const lifetimeEarnings = delivered.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const totalDistance = delivered.reduce(function (s, j) { return s + (Number(j.distance) || 0); }, 0);
    const rated = allJobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + allJobs.length + '</div><div class="lbl">Total Deliveries</div></div>' +
        '<div class="summary-card"><div class="num">' + delivered.length + '</div><div class="lbl">Completed Deliveries</div></div>' +
        '<div class="summary-card"><div class="num">' + cancelled.length + '</div><div class="lbl">Cancelled Deliveries</div></div>' +
        '<div class="summary-card"><div class="num">R' + lifetimeEarnings.toFixed(0) + '</div><div class="lbl">Lifetime Earnings</div></div>' +
        '<div class="summary-card"><div class="num">' + (avgRating ? avgRating.toFixed(1) + ' ★' : '—') + '</div><div class="lbl">Average Rating</div></div>' +
        '<div class="summary-card"><div class="num">' + totalDistance.toFixed(1) + ' km</div><div class="lbl">Total Distance Driven</div></div>';
}

function filteredSortedJobs() {
    const q = document.getElementById('histSearch').value.trim().toLowerCase();
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;

    let list = allJobs.filter(function (j) {
        if (statusFilter !== 'all' && j.status !== statusFilter) return false;
        if (q && !(j.id.toLowerCase().includes(q) || (j.sender_name || '').toLowerCase().includes(q) ||
            (j.receiver_name || '').toLowerCase().includes(q) || (j.pickup || '').toLowerCase().includes(q) || (j.dropoff || '').toLowerCase().includes(q))) return false;
        if (from && new Date(j.created_at) < new Date(from)) return false;
        if (to && new Date(j.created_at) > new Date(to + 'T23:59:59')) return false;
        return true;
    });

    list = list.slice();
    if (sortMode === 'newest') list.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    else if (sortMode === 'oldest') list.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    else if (sortMode === 'earnings') list.sort(function (a, b) { return driverEarningForJob(b) - driverEarningForJob(a); });
    else if (sortMode === 'distance') list.sort(function (a, b) { return (Number(b.distance) || 0) - (Number(a.distance) || 0); });
    return list;
}

function renderTable() {
    const list = filteredSortedJobs();
    const body = document.getElementById('histBody');
    const empty = document.getElementById('emptyState');
    if (!list.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = list.map(function (job) {
        return '<tr>' +
            '<td>' + job.id.slice(0, 8) + '</td>' +
            '<td>' + escapeHtml(job.sender_name || '') + '</td>' +
            '<td>' + escapeHtml(job.pickup) + '</td>' +
            '<td>' + escapeHtml(job.dropoff) + '</td>' +
            '<td>' + formatDate(job.delivered_at || job.cancelled_at || job.created_at) + '</td>' +
            '<td><span class="badge ' + (job.status === 'delivered' ? 'delivered' : 'cancelled') + '">' + job.status + '</span></td>' +
            '<td>R' + Number(job.quote || 0).toFixed(2) + '</td>' +
            '<td>' + (job.status === 'delivered' ? 'R' + driverEarningForJob(job).toFixed(2) : 'R0.00') + '</td>' +
            '<td>' + (job.rating ? '★'.repeat(job.rating) : '—') + '</td>' +
            '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-details" data-job="' + job.id + '">View Details</button></td>' +
            '</tr>' +
            '<tr><td colspan="10" style="border:none; padding:0;"><div class="details-row" id="details-' + job.id + '"></div></td></tr>';
    }).join('');

    body.querySelectorAll('button[data-action="toggle-details"]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleDetails(btn.dataset.job); });
    });
}

function toggleDetails(jobId) {
    const el = document.getElementById('details-' + jobId);
    const open = el.classList.contains('open');
    document.querySelectorAll('.details-row.open').forEach(function (d) { d.classList.remove('open'); });
    if (open) return;

    const job = allJobs.find(function (j) { return j.id === jobId; });
    const durationMin = (job.created_at && job.delivered_at) ? Math.round((new Date(job.delivered_at) - new Date(job.created_at)) / 60000) : null;

    const timelineStages = [
        ['Assigned', job.assigned_at], ['Accepted / Heading to Pickup', job.to_pickup_at],
        ['Arrived Pickup', job.arrived_at_pickup_at], ['Picked Up / Heading to Destination', job.to_dropoff_at],
        ['Arrived Destination', job.arrived_at_dropoff_at], ['Delivered', job.delivered_at],
    ];

    el.innerHTML =
        '<h4>General</h4>Job ID: ' + job.id.slice(0, 8) + '<br>Delivery Date: ' + formatDate(job.delivered_at || job.created_at) +
        '<br>Completion Time: ' + formatTime(job.delivered_at) +
        '<h4>Customer</h4>' + escapeHtml(job.sender_name || '—') + '<br>' + escapeHtml(job.customer_phone || '') +
        '<h4>Recipient</h4>' + escapeHtml(job.receiver_name || '—') + '<br>' + escapeHtml(job.receiver_phone || '') +
        '<h4>Pickup</h4>' + escapeHtml(job.pickup) + (job.pickup_contact_name ? '<br>' + escapeHtml(job.pickup_contact_name) : '') +
        '<h4>Drop-off</h4>' + escapeHtml(job.dropoff) +
        '<h4>Parcel</h4>Type: ' + escapeHtml(job.package_type || '—') + '<br>Description: ' + escapeHtml(job.package_description || '—') + '<br>Weight: ' + (job.package_weight_kg ? job.package_weight_kg + ' kg' : '—') +
        '<h4>Delivery</h4>Distance: ' + (job.distance ? Number(job.distance).toFixed(1) + ' km' : '—') +
        '<br>Delivery Duration: ' + (durationMin !== null ? durationMin + ' min' : '—') +
        '<br>Driver Earnings: ' + (job.status === 'delivered' ? 'R' + driverEarningForJob(job).toFixed(2) : 'R0.00') +
        '<h4>Proof of Delivery</h4>' +
        'OTP Status: ' + (job.status === 'delivered' ? 'Verified' : '—') +
        '<br>GPS Coordinates: ' + (job.delivery_photo_lat ? job.delivery_photo_lat.toFixed(5) + ', ' + job.delivery_photo_lng.toFixed(5) : '—') +
        '<br>Delivery Timestamp: ' + formatTime(job.delivered_at) +
        (job.delivery_photo_url ? '<br>Delivery Photo:<br><img class="pod-photo" src="' + escapeHtml(job.delivery_photo_url) + '">' : '<br>Delivery Photo: not captured') +
        (job.delivery_signature_url ? '<br>Customer Signature:<br><img class="pod-photo" src="' + escapeHtml(job.delivery_signature_url) + '">' : '<br>Customer Signature: not captured') +
        '<h4>Customer Review</h4>' + (job.rating ? '★'.repeat(job.rating) + (job.rating_comment ? ' — "' + escapeHtml(job.rating_comment) + '"' : '') : 'No review yet') +
        '<h4>Timeline</h4><ul class="timeline">' + timelineStages.map(function (s) {
            return '<li>' + s[0] + ': ' + (s[1] ? formatTime(s[1]) : 'N/A') + '</li>';
        }).join('') + '</ul>';

    el.classList.add('open');
}

function exportCsv() {
    const list = filteredSortedJobs();
    const rows = [['Job ID', 'Customer', 'Pickup', 'Drop-off', 'Date', 'Status', 'Fee', 'Driver Earnings', 'Rating']];
    list.forEach(function (j) {
        rows.push([j.id, j.sender_name, j.pickup, j.dropoff, j.delivered_at || j.created_at, j.status, j.quote, j.status === 'delivered' ? driverEarningForJob(j).toFixed(2) : '0.00', j.rating || '']);
    });
    downloadCsv('ekoquick-delivery-history.csv', rows);
}
