let currentUser = null;
let currentProfile = null;
let allJobs = [];
let hasActiveDelivery = false;
let currentSort = 'closest';
const dismissed = {};

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (v) { return v.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}
function distToPickup(job) {
    if (!currentProfile.last_lat || !currentProfile.last_lng || !job.pickup_lat || !job.pickup_lng) return null;
    return haversineKm(currentProfile.last_lat, currentProfile.last_lng, job.pickup_lat, job.pickup_lng);
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;

    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') {
        window.location.href = 'driver-login.html';
        return;
    }

    await loadDriverShare();
    await loadCommissionRules();
    await loadAppSettings();

    document.getElementById('onlineStatusLine').textContent = currentProfile.is_online
        ? 'You are Online — eligible jobs will appear below.'
        : 'You are Offline — go online from the Dashboard to receive new jobs.';

    document.getElementById('jobSearch').addEventListener('input', renderList);
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('closeDetailsBtn').addEventListener('click', function () { document.getElementById('detailsModal').classList.remove('open'); });
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentSort = btn.dataset.sort;
            renderList();
        });
    });

    await loadAll();

    supabase.channel('driver-available-jobs-' + currentUser.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'status=eq.pending' }, loadAll)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'driver_id=eq.' + currentUser.id }, loadAll)
        .subscribe();
});

async function loadAll() {
    const { data: mine } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id);
    hasActiveDelivery = (mine || []).some(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    const offered = (mine || []).filter(function (j) { return j.status === 'offered'; });

    let pending = [];
    if (currentProfile.is_online) {
        const { data } = await supabase.from('jobs').select('*')
            .eq('status', 'pending').is('driver_id', null).eq('vehicle', currentProfile.vehicle_class)
            .order('created_at', { ascending: false });
        pending = (data || []).filter(function (j) { return !j.scheduled_at || new Date(j.scheduled_at) <= new Date(); });

        const maxRadius = parseFloat(appSetting('driver_max_radius_km', '0')) || 0;
        if (maxRadius > 0 && currentProfile.last_lat && currentProfile.last_lng) {
            pending = pending.filter(function (j) {
                const d = distToPickup(j);
                return d === null || d <= maxRadius;
            });
        }
    }

    allJobs = offered.concat(pending).filter(function (j) { return !dismissed[j.id]; });
    renderSummary();
    renderList();
}

function renderSummary() {
    const dists = allJobs.map(distToPickup).filter(function (d) { return d !== null; });
    const avgDist = dists.length ? (dists.reduce(function (s, d) { return s + d; }, 0) / dists.length) : null;
    const nearby = dists.filter(function (d) { return d <= 10; }).length;
    const totalEarnings = allJobs.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + allJobs.length + '</div><div class="lbl">Available Jobs</div></div>' +
        '<div class="summary-card"><div class="num">' + nearby + '</div><div class="lbl">Nearby Jobs (≤10km)</div></div>' +
        '<div class="summary-card"><div class="num">R' + totalEarnings.toFixed(0) + '</div><div class="lbl">Estimated Earnings Available</div></div>' +
        '<div class="summary-card"><div class="num">' + (avgDist !== null ? avgDist.toFixed(1) + ' km' : '—') + '</div><div class="lbl">Average Distance to Pickup</div></div>';
}

function sortedFilteredJobs() {
    const q = document.getElementById('jobSearch').value.trim().toLowerCase();
    let list = allJobs.filter(function (j) {
        if (!q) return true;
        return j.id.toLowerCase().includes(q) || (j.pickup || '').toLowerCase().includes(q) || (j.sender_name || '').toLowerCase().includes(q);
    });

    list = list.slice();
    if (currentSort === 'closest') {
        list.sort(function (a, b) { return (distToPickup(a) || Infinity) - (distToPickup(b) || Infinity); });
    } else if (currentSort === 'earnings') {
        list.sort(function (a, b) { return driverEarningForJob(b) - driverEarningForJob(a); });
    } else if (currentSort === 'newest') {
        list.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    } else if (currentSort === 'shortest') {
        list.sort(function (a, b) { return (Number(a.distance) || Infinity) - (Number(b.distance) || Infinity); });
    }
    return list;
}

function renderList() {
    const list = sortedFilteredJobs();
    const wrap = document.getElementById('jobList');
    const empty = document.getElementById('emptyState');

    if (!list.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    wrap.innerHTML = list.map(function (job) {
        const isOffered = job.status === 'offered';
        const distPickup = distToPickup(job);
        return '<div class="job-card">' +
            '<div class="meta">Job ' + job.id.slice(0, 8) + (isOffered ? ' · Dispatched to you' : ' · Open request') + '</div>' +
            '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
            (job.pickup_contact_name ? '<div class="meta">Pickup contact: ' + escapeHtml(job.pickup_contact_name) + ' ' + escapeHtml(job.pickup_contact_phone || '') + '</div>' : '') +
            (job.receiver_name ? '<div class="meta">Recipient: ' + escapeHtml(job.receiver_name) + '</div>' : '') +
            '<div class="meta">Distance to pickup: ' + (distPickup !== null ? distPickup.toFixed(1) + ' km' : '—') +
                ' · Delivery distance: ' + (job.distance ? Number(job.distance).toFixed(1) + ' km' : '—') +
                ' · Vehicle: ' + vehicleLabel(job.vehicle) + '</div>' +
            '<div class="meta">You earn <b>R' + driverEarningForJob(job).toFixed(2) + '</b> · Delivery fee R' + Number(job.quote || 0).toFixed(2) + '</div>' +
            (job.package_type ? '<div class="meta">Parcel: ' + escapeHtml(job.package_type) + (job.package_weight_kg ? ' · ' + job.package_weight_kg + 'kg' : '') + (job.fragile ? ' · Fragile' : '') + '</div>' : '') +
            (job.pickup_notes || job.dropoff_notes ? '<div class="meta">Notes: ' + escapeHtml(job.pickup_notes || job.dropoff_notes) + '</div>' : '') +
            '<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">' +
                '<button class="btn btn-blue" style="width:auto;" data-job="' + job.id + '" data-action="' + (isOffered ? 'accept' : 'claim') + '">Accept Job</button>' +
                '<button class="btn btn-outline-blue" style="width:auto;" data-job="' + job.id + '" data-action="' + (isOffered ? 'decline' : 'dismiss') + '">Decline</button>' +
                '<button class="btn btn-outline-blue" style="width:auto;" data-job="' + job.id + '" data-action="details">View Details</button>' +
            '</div>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('button[data-action="accept"]').forEach(function (btn) {
        btn.addEventListener('click', function () { acceptOffered(btn.dataset.job); });
    });
    wrap.querySelectorAll('button[data-action="decline"]').forEach(function (btn) {
        btn.addEventListener('click', function () { declineOffered(btn.dataset.job); });
    });
    wrap.querySelectorAll('button[data-action="claim"]').forEach(function (btn) {
        btn.addEventListener('click', function () { claimJob(btn.dataset.job); });
    });
    wrap.querySelectorAll('button[data-action="dismiss"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (!confirm('Decline this delivery? It will remain available to other drivers.')) return;
            dismissed[btn.dataset.job] = true;
            allJobs = allJobs.filter(function (j) { return j.id !== btn.dataset.job; });
            renderSummary(); renderList();
        });
    });
    wrap.querySelectorAll('button[data-action="details"]').forEach(function (btn) {
        btn.addEventListener('click', function () { showDetails(btn.dataset.job); });
    });
}

function showDetails(jobId) {
    const job = allJobs.find(function (j) { return j.id === jobId; });
    if (!job) return;
    document.getElementById('detailsContent').innerHTML =
        '<h4>General</h4>Job ID: ' + job.id.slice(0, 8) +
        '<h4>Customer</h4>' + escapeHtml(job.sender_name || '') + '<br>' + escapeHtml(job.customer_phone || '') +
        '<h4>Pickup</h4>' + escapeHtml(job.pickup) + '<br>' + escapeHtml(job.pickup_contact_name || '') + ' ' + escapeHtml(job.pickup_contact_phone || '') +
        '<h4>Drop-off</h4>' + escapeHtml(job.dropoff) + '<br>' + escapeHtml(job.receiver_name || '') + ' ' + escapeHtml(job.receiver_phone || '') +
        '<h4>Parcel</h4>Type: ' + escapeHtml(job.package_type || '—') + '<br>Description: ' + escapeHtml(job.package_description || '—') +
        '<br>Weight: ' + (job.package_weight_kg ? job.package_weight_kg + ' kg' : '—') + '<br>Fragile: ' + (job.fragile ? 'Yes' : 'No') +
        '<h4>Delivery</h4>Distance: ' + (job.distance ? Number(job.distance).toFixed(1) + ' km' : '—') +
        '<br>Estimated Earnings: R' + driverEarningForJob(job).toFixed(2);
    document.getElementById('detailsModal').classList.add('open');
}

async function acceptOffered(jobId) {
    if (currentProfile.verification_status !== 'approved') { alert('Your documents must be approved before you can accept jobs.'); return; }
    if (hasActiveDelivery) { alert('You already have an active delivery. Complete it before accepting another job.'); return; }
    const { error } = await supabase.from('jobs').update({ status: 'to_pickup', to_pickup_at: new Date().toISOString() }).eq('id', jobId);
    if (error) { alert('Failed to accept job: ' + error.message); return; }
    window.location.href = 'driver-navigation.html?job=' + jobId;
}

async function declineOffered(jobId) {
    if (!confirm('Decline this delivery?')) return;
    const { error } = await supabase.from('jobs').update({ status: 'pending', driver_id: null }).eq('id', jobId);
    if (error) { alert('Failed to decline job: ' + error.message); return; }
    loadAll();
}

async function claimJob(jobId) {
    if (currentProfile.verification_status !== 'approved') { alert('Your documents must be approved before you can accept jobs.'); return; }
    if (!currentProfile.is_online) { alert('Go Online from the Dashboard before accepting jobs.'); return; }
    if (hasActiveDelivery) { alert('You already have an active delivery. Complete it before accepting another job.'); return; }

    const { data, error } = await supabase.from('jobs')
        .update({ driver_id: currentUser.id, status: 'to_pickup', assigned_at: new Date().toISOString(), to_pickup_at: new Date().toISOString() })
        .eq('id', jobId).eq('status', 'pending').is('driver_id', null).select();

    if (error) { alert('Failed to accept job: ' + error.message); return; }
    if (!data || !data.length) { alert('This job was just claimed by another driver.'); loadAll(); return; }

    window.location.href = 'driver-navigation.html?job=' + jobId;
}
