const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const HIGH_PRIORITY_MS = 30 * 60 * 1000;
const NORMAL_PRIORITY_MS = 10 * 60 * 1000;
const AUTO_ASSIGN_KEY = 'ekoquick_dispatch_auto_assign';

let allJobs = [];
let allDrivers = [];
let profilesById = {};
let selectedJobId = null;
let dispatchMap = null;
let dispatchMarkers = [];
let dispatchLog = [];
let autoAssignTimer = null;

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
    document.getElementById('globalSearch').addEventListener('input', function () { renderUnassigned(); renderActiveDeliveries(); });
    document.getElementById('priorityFilter').addEventListener('change', renderUnassigned);
    document.getElementById('jobVehicleFilter').addEventListener('change', renderUnassigned);
    document.getElementById('driverVehicleFilter').addEventListener('change', function () { if (selectedJobId) renderNearbyDrivers(selectedJobId); });
    document.getElementById('driverSortBy').addEventListener('change', function () { if (selectedJobId) renderNearbyDrivers(selectedJobId); });

    const autoToggle = document.getElementById('autoAssignToggle');
    autoToggle.checked = localStorage.getItem(AUTO_ASSIGN_KEY) === '1';
    autoToggle.addEventListener('change', function () {
        localStorage.setItem(AUTO_ASSIGN_KEY, autoToggle.checked ? '1' : '0');
        setupAutoAssignTimer();
    });

    populateVehicleFilters();

    dispatchMap = L.map('dispatchMap').setView([-29.6, 30.9], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(dispatchMap);

    await loadDriverShare();
    await loadAll();
    setupAutoAssignTimer();

    supabase.channel('dispatch-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll).subscribe();
    supabase.channel('dispatch-drivers').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadAll).subscribe();
    setInterval(loadAll, 10000);
});

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
    if (!iso) return '—';
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

function whatsappLink(phone, message) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (!digits) return null;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message || '');
}

function isOnline(d) {
    return !!(d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < ONLINE_WINDOW_MS);
}

function busyDriverIds() {
    return allJobs
        .filter(function (j) { return j.driver_id && (j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'); })
        .map(function (j) { return j.driver_id; });
}

function jobPriority(job) {
    const age = Date.now() - new Date(job.created_at).getTime();
    if (age > HIGH_PRIORITY_MS) return 'high';
    if (age > NORMAL_PRIORITY_MS) return 'normal';
    return 'low';
}

function populateVehicleFilters() {
    ['jobVehicleFilter', 'driverVehicleFilter'].forEach(function (id) {
        const sel = document.getElementById(id);
        (typeof VEHICLES !== 'undefined' ? VEHICLES : []).forEach(function (v) {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.icon + ' ' + v.label;
            sel.appendChild(opt);
        });
    });
}

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: drivers } = await supabase.from('profiles').select('*').eq('role', 'driver');
    const { data: log } = await supabase.from('dispatch_log').select('*').order('created_at', { ascending: false }).limit(30);

    allJobs = jobs || [];
    allDrivers = drivers || [];
    dispatchLog = log || [];
    profilesById = {};
    allDrivers.forEach(function (d) { profilesById[d.id] = d; });
    const { data: customers } = await supabase.from('profiles').select('id, full_name, phone').eq('role', 'customer');
    (customers || []).forEach(function (c) { profilesById[c.id] = c; });

    renderSummaryCards();
    renderUnassigned();
    if (selectedJobId && !allJobs.find(function (j) { return j.id === selectedJobId && j.status === 'pending' && !j.driver_id; })) {
        selectedJobId = null;
    }
    if (selectedJobId) renderNearbyDrivers(selectedJobId);
    else document.getElementById('nearbyDrivers').innerHTML = '<div class="empty">Select an order to see matching drivers.</div>';
    renderActiveDeliveries();
    renderDispatchLogTimeline();
}

function avgDispatchTimeLabel() {
    const withAssign = allJobs.filter(function (j) { return j.created_at && j.assigned_at; }).slice(0, 50);
    if (!withAssign.length) return '—';
    const avgMs = withAssign.reduce(function (s, j) { return s + (new Date(j.assigned_at) - new Date(j.created_at)); }, 0) / withAssign.length;
    const mins = avgMs / 60000;
    return mins < 1 ? Math.round(avgMs / 1000) + ' sec' : mins.toFixed(1) + ' min';
}

function renderSummaryCards() {
    const pending = allJobs.filter(function (j) { return j.status === 'pending'; }).length;
    const unassigned = allJobs.filter(function (j) { return j.status === 'pending' && !j.driver_id; }).length;
    const busy = busyDriverIds();
    const available = allDrivers.filter(function (d) { return isOnline(d) && d.account_status === 'active' && d.verification_status === 'approved' && busy.indexOf(d.id) === -1; }).length;
    const busyCount = allDrivers.filter(function (d) { return busy.indexOf(d.id) !== -1; }).length;
    const active = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; }).length;

    document.getElementById('queueCount').textContent = unassigned;

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('summaryCards').innerHTML =
        card('Pending Jobs', pending) + card('Unassigned Jobs', unassigned) + card('Available Drivers', available) +
        card('Busy Drivers', busyCount) + card('Active Deliveries', active) + card('Avg Dispatch Time', avgDispatchTimeLabel());
}

function renderUnassigned() {
    const el = document.getElementById('unassignedList');
    const q = document.getElementById('globalSearch').value.trim().toLowerCase();
    const priorityFilter = document.getElementById('priorityFilter').value;
    const vehicleFilter = document.getElementById('jobVehicleFilter').value;

    let unassigned = allJobs.filter(function (j) { return j.status === 'pending' && !j.driver_id; });

    if (priorityFilter) unassigned = unassigned.filter(function (j) { return jobPriority(j) === priorityFilter; });
    if (vehicleFilter) unassigned = unassigned.filter(function (j) { return j.vehicle === vehicleFilter; });
    if (q) {
        unassigned = unassigned.filter(function (j) {
            const customer = profilesById[j.customer_id];
            const hay = (j.id + ' ' + (customer ? customer.full_name : '') + ' ' + (j.customer_phone || '') + ' ' + j.pickup + ' ' + j.dropoff).toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }

    if (!unassigned.length) { el.innerHTML = '<div class="empty">No jobs waiting for dispatch.</div>'; return; }

    const priorityBadge = { high: 'cancelled', normal: 'pending', low: 'delivered' };

    el.innerHTML = unassigned.map(function (job) {
        const customer = profilesById[job.customer_id];
        const priority = jobPriority(job);
        return (
            '<div class="job dispatch-job' + (job.id === selectedJobId ? ' selected' : '') + '" data-job="' + job.id + '" style="cursor:pointer;">' +
                '<span class="badge ' + priorityBadge[priority] + '">' + priority + '</span>' +
                '<div class="route" style="margin-top:6px;">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + vehicleLabel(job.vehicle) + ' • ' + (job.distance || 0) + ' km • R' + (job.quote || 0) + '</div>' +
                '<div class="meta">Customer: ' + escapeHtml(customer ? customer.full_name : (job.customer_phone || '—')) + '</div>' +
                '<div class="meta">Created: ' + formatTime(job.created_at) + '</div>' +
                '<div style="margin-top:8px; display:flex; gap:6px;">' +
                    '<button class="btn btn-blue" style="width:auto;" data-action="select-job" data-job="' + job.id + '">Assign Driver</button>' +
                    '<button class="btn btn-outline-blue" style="width:auto;" data-action="cancel-job" data-job="' + job.id + '">Cancel Job</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    el.querySelectorAll('.dispatch-job').forEach(function (card) {
        card.addEventListener('click', function (e) {
            if (e.target.closest('button')) return;
            selectJob(card.dataset.job);
        });
    });
    el.querySelectorAll('button[data-action="select-job"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); selectJob(btn.dataset.job); });
    });
    el.querySelectorAll('button[data-action="cancel-job"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); cancelJob(btn.dataset.job); });
    });
}

function selectJob(jobId) {
    selectedJobId = jobId;
    renderUnassigned();
    renderNearbyDrivers(jobId);
}

async function cancelJob(jobId) {
    const reason = prompt('Reason for cancellation:');
    if (reason === null) return;
    const { error } = await supabase.from('jobs').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: reason.trim() || null }).eq('id', jobId);
    if (error) { alert('Failed to cancel: ' + error.message); return; }
    if (selectedJobId === jobId) selectedJobId = null;
    loadAll();
}

function driverStatsToday(driverId) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const delivered = allJobs.filter(function (j) { return j.driver_id === driverId && j.status === 'delivered' && j.delivered_at; });
    const deliveredToday = delivered.filter(function (j) { return new Date(j.delivered_at) >= todayStart; });
    const earningsToday = deliveredToday.reduce(function (s, j) { return s + driverEarning(j.quote); }, 0);
    const rated = allJobs.filter(function (j) { return j.driver_id === driverId && j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;
    return { deliveredToday: deliveredToday.length, earningsToday: earningsToday, avgRating: avgRating };
}

function candidatesForJob(job, vehicleFilter) {
    const busy = busyDriverIds();
    let matching = allDrivers.filter(function (d) {
        return d.vehicle_class === job.vehicle && d.verification_status === 'approved' &&
            d.account_status === 'active' && isOnline(d) && busy.indexOf(d.id) === -1;
    });
    if (vehicleFilter) matching = matching.filter(function (d) { return d.vehicle_class === vehicleFilter; });

    return matching.map(function (d) {
        const dist = (job.pickup_lat && job.pickup_lng && d.last_lat && d.last_lng)
            ? haversineKm(job.pickup_lat, job.pickup_lng, d.last_lat, d.last_lng) : null;
        const stats = driverStatsToday(d.id);
        return { driver: d, dist: dist, eta: dist !== null ? Math.round((dist / 30) * 60) : null, stats: stats };
    });
}

function pickRecommendation(withStats) {
    if (!withStats.length) return null;
    const withDistance = withStats.filter(function (w) { return w.dist !== null; }).sort(function (a, b) { return a.dist - b.dist; });
    if (withDistance.length) {
        const closest = withDistance[0];
        const reason = 'Closest driver (' + closest.dist.toFixed(1) + ' km away)';
        return { pick: closest, reason: reason };
    }
    const withRating = withStats.filter(function (w) { return w.stats.avgRating !== null; }).sort(function (a, b) { return b.stats.avgRating - a.stats.avgRating; });
    if (withRating.length) return { pick: withRating[0], reason: 'Highest rated nearby' };
    return { pick: withStats[0], reason: 'Available now' };
}

function renderNearbyDrivers(jobId) {
    const el = document.getElementById('nearbyDrivers');
    const job = allJobs.find(function (j) { return j.id === jobId; });
    if (!job) { el.innerHTML = '<div class="empty">Select an order to see matching drivers.</div>'; return; }

    const vehicleFilter = document.getElementById('driverVehicleFilter').value;
    const sortBy = document.getElementById('driverSortBy').value;
    let withStats = candidatesForJob(job, vehicleFilter);

    if (!withStats.length) { el.innerHTML = '<div class="empty">All drivers are currently busy or offline.</div>'; renderDispatchMap(job, []); return; }

    const rec = pickRecommendation(withStats);

    withStats = withStats.slice().sort(function (a, b) {
        if (sortBy === 'rating') return (b.stats.avgRating || 0) - (a.stats.avgRating || 0);
        if (sortBy === 'deliveries') return b.stats.deliveredToday - a.stats.deliveredToday;
        if (sortBy === 'earnings') return b.stats.earningsToday - a.stats.earningsToday;
        if (a.dist === null) return 1;
        if (b.dist === null) return -1;
        return a.dist - b.dist;
    });

    let html = '';
    if (rec) {
        html += '<div class="recommend-card">' +
            '<div class="recommend-tag">Recommended</div>' +
            '<div class="route">' + escapeHtml(rec.pick.driver.full_name) + '</div>' +
            '<div class="meta">' + escapeHtml(rec.reason) + '</div>' +
            '<button class="btn btn-blue" style="margin-top:8px;" data-action="assign-driver" data-driver="' + rec.pick.driver.id + '">Assign Recommended Driver</button>' +
            '</div>';
    }

    html += withStats.map(function (w) {
        const eta = w.eta !== null ? w.eta + ' min' : '—';
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(w.driver.full_name) + '</div>' +
                '<div class="meta">' + vehicleLabel(w.driver.vehicle_class) + ' • ' + (w.dist !== null ? w.dist.toFixed(1) + ' km away · ETA ' + eta : 'Location unknown') + '</div>' +
                '<div class="meta">Rating: ' + (w.stats.avgRating ? w.stats.avgRating.toFixed(1) + ' ★' : '—') + ' · Deliveries today: ' + w.stats.deliveredToday + ' · Earnings today: R' + w.stats.earningsToday.toFixed(2) + '</div>' +
                '<div class="meta">Last seen: ' + formatTime(w.driver.last_seen_at) + '</div>' +
                '<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">' +
                    '<button class="btn btn-blue" style="width:auto;" data-action="assign-driver" data-driver="' + w.driver.id + '">Assign</button>' +
                    (w.driver.phone ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="tel:' + w.driver.phone + '">Call</a>' : '') +
                    (w.driver.phone ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" target="_blank" href="' + whatsappLink(w.driver.phone, 'Ekoquick — new job available.') + '">Message</a>' : '') +
                    '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="admin-drivers.html">View Profile</a>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    el.innerHTML = html;

    el.querySelectorAll('button[data-action="assign-driver"]').forEach(function (btn) {
        btn.addEventListener('click', function () { confirmAssign(job, btn.dataset.driver); });
    });

    renderDispatchMap(job, withStats);
}

function confirmAssign(job, driverId) {
    const driver = profilesById[driverId];
    const candidate = candidatesForJob(job, '').find(function (w) { return w.driver.id === driverId; });
    const eta = candidate && candidate.eta !== null ? candidate.eta + ' min' : '—';
    const msg = 'Assign Driver?\n\nDriver: ' + (driver ? driver.full_name : driverId) +
        '\nJob ID: ' + job.id.slice(0, 8) + '\nPickup: ' + job.pickup + '\nETA: ' + eta;
    if (!confirm(msg)) return;
    assignDriverToJob(job.id, driverId);
}

async function assignDriverToJob(jobId, driverId) {
    const job = allJobs.find(function (j) { return j.id === jobId; });
    const isReassign = !!(job && job.driver_id);
    const previousDriverId = job ? job.driver_id : null;

    const fields = { driver_id: driverId, status: 'offered', assigned_at: new Date().toISOString() };
    const { error } = await supabase.from('jobs').update(fields).eq('id', jobId);
    if (error) { alert('Failed to assign: ' + error.message); return; }

    await supabase.from('dispatch_log').insert({
        job_id: jobId,
        action: isReassign ? 'reassign' : 'assign',
        previous_driver_id: previousDriverId,
        new_driver_id: driverId,
        admin_name: window.currentAdminName || 'Admin',
    });

    selectedJobId = null;
    loadAll();
}

async function reassignDriver(jobId) {
    const job = allJobs.find(function (j) { return j.id === jobId; });
    if (!job) return;
    if (job.status === 'delivered' || job.status === 'cancelled') { alert('This job cannot be reassigned.'); return; }

    const candidates = candidatesForJob(job, '');
    if (!candidates.length) { alert('No available drivers to reassign to right now.'); return; }

    const options = candidates.map(function (w, i) { return (i + 1) + '. ' + w.driver.full_name + (w.dist !== null ? ' (' + w.dist.toFixed(1) + ' km)' : ''); }).join('\n');
    const choice = prompt('Reassign to which driver?\n' + options + '\n\nEnter a number:');
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || !candidates[idx]) { alert('Invalid selection.'); return; }

    assignDriverToJob(jobId, candidates[idx].driver.id);
}

function renderDispatchMap(job, withStats) {
    dispatchMarkers.forEach(function (m) { dispatchMap.removeLayer(m); });
    dispatchMarkers = [];

    if (job.pickup_lat && job.pickup_lng) {
        const pickupMarker = L.marker([job.pickup_lat, job.pickup_lng], {
            icon: L.divIcon({ html: '📦', className: 'driver-marker', iconSize: [26, 26] }),
        }).bindPopup('<b>Job ' + job.id.slice(0, 8) + '</b><br>Pickup: ' + escapeHtml(job.pickup) + '<br>Drop-off: ' + escapeHtml(job.dropoff)).addTo(dispatchMap);
        dispatchMarkers.push(pickupMarker);
        dispatchMap.setView([job.pickup_lat, job.pickup_lng], 11);
    }
    if (job.dropoff_lat && job.dropoff_lng) {
        const dropoffMarker = L.marker([job.dropoff_lat, job.dropoff_lng], {
            icon: L.divIcon({ html: '🏁', className: 'driver-marker', iconSize: [22, 22] }),
        }).bindPopup('Drop-off: ' + escapeHtml(job.dropoff)).addTo(dispatchMap);
        dispatchMarkers.push(dropoffMarker);
    }

    withStats.forEach(function (w) {
        if (!w.driver.last_lat || !w.driver.last_lng) return;
        const m = L.marker([w.driver.last_lat, w.driver.last_lng], {
            icon: L.divIcon({ html: '🟢', className: 'driver-marker', iconSize: [22, 22] }),
        }).bindPopup(
            '<b>' + escapeHtml(w.driver.full_name) + '</b><br>' + vehicleLabel(w.driver.vehicle_class) +
            '<br>' + (w.dist !== null ? w.dist.toFixed(1) + ' km to pickup' : 'Distance unknown') +
            '<br>ETA: ' + (w.eta !== null ? w.eta + ' min' : '—') +
            '<br><button onclick="confirmAssign(allJobs.find(j=>j.id===\'' + job.id + '\'), \'' + w.driver.id + '\')">Assign Driver</button>'
        ).addTo(dispatchMap);
        dispatchMarkers.push(m);
    });
}

function renderActiveDeliveries() {
    const el = document.getElementById('activeDeliveries');
    const q = document.getElementById('globalSearch').value.trim().toLowerCase();
    let active = allJobs.filter(function (j) { return j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'; });

    if (q) {
        active = active.filter(function (j) {
            const driver = profilesById[j.driver_id];
            const customer = profilesById[j.customer_id];
            const hay = (j.id + ' ' + (driver ? driver.full_name : '') + ' ' + (customer ? customer.full_name : '') + ' ' + j.pickup + ' ' + j.dropoff).toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }

    if (!active.length) { el.innerHTML = '<div class="empty">No active deliveries.</div>'; return; }

    el.innerHTML =
        '<table class="simple-table"><thead><tr><th>Job ID</th><th>Driver</th><th>Customer</th><th>Status</th><th>ETA</th><th>Actions</th></tr></thead><tbody>' +
        active.map(function (j) {
            const driver = profilesById[j.driver_id];
            const customer = profilesById[j.customer_id];
            const destLat = j.status === 'to_pickup' ? j.pickup_lat : j.dropoff_lat;
            const destLng = j.status === 'to_pickup' ? j.pickup_lng : j.dropoff_lng;
            const eta = (j.driver_lat && j.driver_lng && destLat && destLng) ? Math.round((haversineKm(j.driver_lat, j.driver_lng, destLat, destLng) / 30) * 60) + ' min' : '—';
            const custWa = whatsappLink(j.customer_phone, 'Ekoquick — regarding order ' + j.id.slice(0, 8) + '.');
            const driverWa = driver ? whatsappLink(driver.phone, 'Ekoquick — regarding order ' + j.id.slice(0, 8) + '.') : null;
            return '<tr>' +
                '<td>' + j.id.slice(0, 8) + '</td>' +
                '<td>' + escapeHtml(driver ? driver.full_name : '—') + '</td>' +
                '<td>' + escapeHtml(customer ? customer.full_name : (j.customer_phone || '—')) + '</td>' +
                '<td><span class="badge ' + (j.status === 'offered' ? 'pending' : 'assigned') + '">' + j.status + '</span></td>' +
                '<td>' + eta + '</td>' +
                '<td style="display:flex; gap:4px; flex-wrap:wrap;">' +
                    '<a class="btn btn-outline-blue" style="width:auto; padding:2px 8px; text-decoration:none;" href="admin-fleet-map.html">Live Track</a>' +
                    '<a class="btn btn-outline-blue" style="width:auto; padding:2px 8px; text-decoration:none;" href="admin-jobs.html">View Job</a>' +
                    '<button class="btn btn-outline-blue" style="width:auto; padding:2px 8px;" data-action="reassign" data-job="' + j.id + '">Reassign</button>' +
                    (driverWa ? '<a class="btn btn-outline-blue" style="width:auto; padding:2px 8px; text-decoration:none;" target="_blank" href="' + driverWa + '">Contact Driver</a>' : '') +
                    (custWa ? '<a class="btn btn-outline-blue" style="width:auto; padding:2px 8px; text-decoration:none;" target="_blank" href="' + custWa + '">Contact Customer</a>' : '') +
                '</td>' +
                '</tr>';
        }).join('') +
        '</tbody></table>';

    el.querySelectorAll('button[data-action="reassign"]').forEach(function (btn) {
        btn.addEventListener('click', function () { reassignDriver(btn.dataset.job); });
    });
}

function renderDispatchLogTimeline() {
    const el = document.getElementById('dispatchTimeline');
    if (!dispatchLog.length) { el.innerHTML = '<div class="empty">No recent events.</div>'; return; }

    el.innerHTML = dispatchLog.map(function (log) {
        const job = allJobs.find(function (j) { return j.id === log.job_id; });
        const newDriver = profilesById[log.new_driver_id];
        const prevDriver = profilesById[log.previous_driver_id];
        const label = log.action === 'reassign'
            ? 'Reassigned ' + (job ? job.pickup + ' → ' + job.dropoff : log.job_id.slice(0, 8)) + ' from ' + (prevDriver ? prevDriver.full_name : '—') + ' to ' + (newDriver ? newDriver.full_name : '—')
            : 'Assigned ' + (newDriver ? newDriver.full_name : '—') + ' to ' + (job ? job.pickup + ' → ' + job.dropoff : log.job_id.slice(0, 8));
        return '<div class="meta" style="padding:6px 0; border-bottom:1px solid var(--line);">' + escapeHtml(label) +
            '<br><span style="color:var(--muted-dim); font-size:11px;">' + escapeHtml(log.admin_name || 'Admin') + ' · ' + formatTime(log.created_at) + '</span></div>';
    }).join('');
}

function setupAutoAssignTimer() {
    if (autoAssignTimer) clearInterval(autoAssignTimer);
    const enabled = document.getElementById('autoAssignToggle').checked;
    if (!enabled) return;
    autoAssignTimer = setInterval(runAutoAssign, 15000);
    runAutoAssign();
}

let autoAssigning = false;
async function runAutoAssign() {
    if (autoAssigning) return;
    const unassigned = allJobs.filter(function (j) { return j.status === 'pending' && !j.driver_id; });
    if (!unassigned.length) return;

    autoAssigning = true;
    try {
        for (const job of unassigned) {
            const candidates = candidatesForJob(job, '');
            if (!candidates.length) continue;
            const rec = pickRecommendation(candidates);
            if (!rec) continue;
            await assignDriverToJobSilently(job.id, rec.pick.driver.id);
        }
    } finally {
        autoAssigning = false;
    }
}

async function assignDriverToJobSilently(jobId, driverId) {
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'offered', assigned_at: new Date().toISOString() }).eq('id', jobId);
    if (error) return;
    await supabase.from('dispatch_log').insert({ job_id: jobId, action: 'assign', new_driver_id: driverId, admin_name: (window.currentAdminName || 'Admin') + ' (auto)' });
}
