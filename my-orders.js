let currentUser = null;
let allJobs = [];
let driversById = {};
let activeFilter = 'all';

const STATUS_LABELS = {
    pending: 'Pending', offered: 'Driver Assigned', to_pickup: 'Heading to Pickup',
    to_dropoff: 'Heading to Destination', delivered: 'Delivered', cancelled: 'Cancelled',
};
const BADGE_CLASS = {
    pending: 'pending', offered: 'assigned', to_pickup: 'in_progress', to_dropoff: 'in_progress',
    delivered: 'delivered', cancelled: 'cancelled',
};
const COMPLAINT_CATEGORIES = [
    ['late_delivery', 'Late Delivery'], ['rude_behaviour', 'Rude Behaviour'], ['dangerous_driving', 'Dangerous Driving'],
    ['damaged_package', 'Damaged Package'], ['missing_package', 'Missing Package'], ['wrong_delivery', 'Wrong Delivery'],
    ['fraud', 'Fraud'], ['poor_communication', 'Poor Communication'], ['vehicle_hygiene', 'Vehicle Hygiene'], ['other', 'Other'],
];

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (v) { return v.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    document.getElementById('orderSearch').addEventListener('input', renderTable);
    document.getElementById('dateFrom').addEventListener('change', renderTable);
    document.getElementById('dateTo').addEventListener('change', renderTable);
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            renderTable();
        });
    });

    await loadAll();
    supabase.channel('customer-my-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'customer_id=eq.' + currentUser.id }, loadAll).subscribe();
});

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
    allJobs = jobs || [];

    const driverIds = [...new Set(allJobs.map(function (j) { return j.driver_id; }).filter(Boolean))];
    driversById = {};
    if (driverIds.length) {
        const { data: drivers } = await supabase.from('profiles').select('id, full_name, phone, vehicle_class').in('id', driverIds);
        (drivers || []).forEach(function (d) { driversById[d.id] = d; });
    }

    renderSummaryCards();
    renderTable();
}

function driverRatingFor(driverId) {
    const rated = allJobs.filter(function (j) { return j.driver_id === driverId && j.rating; });
    return null; // per-driver global average needs a fresh query; computed on demand when a details row opens
}

function renderSummaryCards() {
    const active = allJobs.filter(function (j) { return j.status !== 'delivered' && j.status !== 'cancelled'; });
    const completed = allJobs.filter(function (j) { return j.status === 'delivered'; });
    const cancelled = allJobs.filter(function (j) { return j.status === 'cancelled'; });
    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + active.length + '</div><div class="lbl">Active Orders</div></div>' +
        '<div class="summary-card"><div class="num">' + completed.length + '</div><div class="lbl">Completed Orders</div></div>' +
        '<div class="summary-card"><div class="num">' + cancelled.length + '</div><div class="lbl">Cancelled Orders</div></div>' +
        '<div class="summary-card"><div class="num">' + allJobs.length + '</div><div class="lbl">Total Orders</div></div>';
}

function filteredJobs() {
    const q = document.getElementById('orderSearch').value.trim().toLowerCase();
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    return allJobs.filter(function (j) {
        if (activeFilter === 'active' && (j.status === 'delivered' || j.status === 'cancelled')) return false;
        if (activeFilter === 'delivered' && j.status !== 'delivered') return false;
        if (activeFilter === 'cancelled' && j.status !== 'cancelled') return false;
        if (q && !(j.id.toLowerCase().includes(q) || (j.pickup || '').toLowerCase().includes(q) || (j.dropoff || '').toLowerCase().includes(q))) return false;
        if (from && new Date(j.created_at) < new Date(from)) return false;
        if (to && new Date(j.created_at) > new Date(to + 'T23:59:59')) return false;
        return true;
    });
}

function renderTable() {
    const jobs = filteredJobs();
    const body = document.getElementById('ordersBody');
    const empty = document.getElementById('emptyState');

    if (!jobs.length) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    body.innerHTML = jobs.map(function (job) {
        const driver = driversById[job.driver_id];
        let actions = '<button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-details" data-job="' + job.id + '">View Details</button>';
        if (job.status !== 'delivered' && job.status !== 'cancelled') {
            actions += ' <a class="btn btn-outline-blue" style="width:auto;" href="live-tracking.html?job=' + job.id + '">Track</a>';
        }
        return '<tr>' +
            '<td>' + job.id.slice(0, 8) + '</td>' +
            '<td>' + escapeHtml(job.pickup) + '</td>' +
            '<td>' + escapeHtml(job.dropoff) + '</td>' +
            '<td>' + (driver ? escapeHtml(driver.full_name) : '—') + '</td>' +
            '<td>' + vehicleLabel(job.vehicle) + '</td>' +
            '<td><span class="badge ' + BADGE_CLASS[job.status] + '">' + STATUS_LABELS[job.status] + '</span></td>' +
            '<td>R' + Number(job.quote || 0).toFixed(2) + '</td>' +
            '<td>' + formatDate(job.created_at) + '</td>' +
            '<td>' + (job.delivered_at ? formatDate(job.delivered_at) : '—') + '</td>' +
            '<td>' + actions + '</td>' +
            '</tr>' +
            '<tr><td colspan="10" style="border:none; padding:0;"><div class="details-row" id="details-' + job.id + '"></div></td></tr>';
    }).join('');

    body.querySelectorAll('button[data-action="toggle-details"]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleDetails(btn.dataset.job); });
    });
}

async function toggleDetails(jobId) {
    const el = document.getElementById('details-' + jobId);
    const open = el.classList.contains('open');
    document.querySelectorAll('.details-row.open').forEach(function (d) { d.classList.remove('open'); });
    if (open) return;

    const job = allJobs.find(function (j) { return j.id === jobId; });
    const driver = driversById[job.driver_id];
    let driverRatingLine = 'No ratings yet';
    if (job.driver_id) {
        const { data: rated } = await supabase.from('jobs').select('rating').eq('driver_id', job.driver_id).not('rating', 'is', null);
        if (rated && rated.length) {
            const avg = rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length;
            driverRatingLine = avg.toFixed(1) + ' ★ (' + rated.length + ' ratings)';
        }
    }

    const timelineStages = [
        ['Order Created', job.created_at], ['Driver Assigned', job.assigned_at], ['Heading to Pickup', job.to_pickup_at],
        ['Parcel Picked Up', job.to_dropoff_at], ['Heading to Destination', job.to_dropoff_at],
        ['Delivered', job.delivered_at], ['Completed', job.delivered_at],
    ];

    let feedbackHtml = '';
    if (job.status === 'delivered') {
        if (job.rating) {
            feedbackHtml = '<div><b>Your rating:</b> ' + '★'.repeat(job.rating) + (job.rating_comment ? ' — "' + escapeHtml(job.rating_comment) + '"' : '') + '</div>';
        } else {
            feedbackHtml = '<a class="btn btn-outline-blue" style="width:auto; display:inline-block;" href="rate-driver.html?job=' + job.id + '">Leave Review</a> ';
        }
        feedbackHtml += ' <button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-complaint" data-job="' + job.id + '">Report Complaint</button>';
    }

    el.innerHTML =
        '<h4>General</h4>' +
        'Order ID: ' + job.id.slice(0, 8) + '<br>Status: ' + STATUS_LABELS[job.status] +
        '<h4>Pickup</h4>' + escapeHtml(job.pickup) + (job.pickup_contact_name ? '<br>Contact: ' + escapeHtml(job.pickup_contact_name) + ' ' + escapeHtml(job.pickup_contact_phone || '') : '') +
        '<h4>Drop-off</h4>' + escapeHtml(job.dropoff) + (job.receiver_name ? '<br>Recipient: ' + escapeHtml(job.receiver_name) + ' ' + escapeHtml(job.receiver_phone || '') : '') +
        '<h4>Driver</h4>' + (driver ? escapeHtml(driver.full_name) + '<br>' + escapeHtml(driver.phone || '') + '<br>' + vehicleLabel(driver.vehicle_class) + '<br>' + driverRatingLine : 'Not yet assigned') +
        '<h4>Delivery</h4>Distance: ' + (job.distance ? Number(job.distance).toFixed(1) + ' km' : '—') +
        '<br>Delivery Fee: R' + Number(job.quote || 0).toFixed(2) +
        '<h4>Timeline</h4>' + timelineStages.map(function (s) { return s[0] + ': ' + (s[1] ? formatTime(s[1]) : 'Pending'); }).join('<br>') +
        '<h4>Proof of Delivery</h4><i>Not available — delivery photo/signature capture isn\'t built yet. OTP status: ' +
        (job.status === 'delivered' ? 'Verified' : 'Pending') + '</i>' +
        '<h4>Payment</h4>Method: ' + (job.payment_method || '—').toUpperCase() +
        '<br>Amount: R' + Number(job.quote || 0).toFixed(2) +
        '<br>Status: ' + (job.payment_status || '—') +
        '<h4>Feedback</h4>' + feedbackHtml +
        '<div class="complaint-form" id="complaint-' + job.id + '">' +
            '<h4>Report a Complaint</h4>' +
            '<select class="field-plain" id="complaintCategory-' + job.id + '">' +
                COMPLAINT_CATEGORIES.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') +
            '</select>' +
            '<textarea class="field-plain" id="complaintDesc-' + job.id + '" rows="3" placeholder="Describe the issue..."></textarea>' +
            '<button class="btn btn-blue" data-action="submit-complaint" data-job="' + job.id + '" style="margin-top:6px;">Submit Complaint</button>' +
            '<div class="meta" id="complaintMsg-' + job.id + '"></div>' +
        '</div>';

    el.classList.add('open');

    const complaintBtn = el.querySelector('button[data-action="toggle-complaint"]');
    if (complaintBtn) {
        complaintBtn.addEventListener('click', function () {
            document.getElementById('complaint-' + jobId).classList.toggle('open');
        });
    }
    const submitBtn = el.querySelector('button[data-action="submit-complaint"]');
    if (submitBtn) {
        submitBtn.addEventListener('click', function () { submitComplaint(job); });
    }
}

async function submitComplaint(job) {
    const category = document.getElementById('complaintCategory-' + job.id).value;
    const description = document.getElementById('complaintDesc-' + job.id).value.trim();
    const msgEl = document.getElementById('complaintMsg-' + job.id);
    if (!description) { msgEl.textContent = 'Please describe the issue.'; return; }

    const { error } = await supabase.from('complaints').insert({
        customer_id: currentUser.id, driver_id: job.driver_id, job_id: job.id,
        category: category, description: description,
    });
    msgEl.textContent = error ? 'Could not submit complaint. Please try again.' : 'Complaint submitted. Our support team will follow up.';
}
