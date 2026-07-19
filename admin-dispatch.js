let allJobs = [];
let allDrivers = [];
let selectedJobId = null;
let dispatchMap = null;
let dispatchMarkers = [];

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;

    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });

    dispatchMap = L.map('dispatchMap').setView([-29.6, 30.9], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(dispatchMap);

    await loadDriverShare();
    await load();

    supabase.channel('dispatch-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : '';
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function load() {
    const { data: jobs } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: drivers } = await supabase.from('profiles').select('id, full_name, vehicle_class, last_lat, last_lng, last_seen_at, verification_status, account_status').eq('role', 'driver');

    allJobs = jobs || [];
    allDrivers = drivers || [];

    renderUnassigned();
    if (selectedJobId) renderNearbyDrivers(selectedJobId);
}

function renderUnassigned() {
    const el = document.getElementById('unassignedList');
    const unassigned = allJobs.filter(function (j) { return j.status === 'pending' && !j.driver_id; });

    if (!unassigned.length) { el.innerHTML = '<div class="empty">No unassigned orders — everything is dispatched.</div>'; return; }

    el.innerHTML = unassigned.map(function (job) {
        return (
            '<div class="job dispatch-job' + (job.id === selectedJobId ? ' selected' : '') + '" data-job="' + job.id + '" style="cursor:pointer;">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + vehicleLabel(job.vehicle) + ' • ' + (job.distance || 0) + ' km • R' + (job.quote || 0) + '</div>' +
            '</div>'
        );
    }).join('');

    el.querySelectorAll('.dispatch-job').forEach(function (card) {
        card.addEventListener('click', function () {
            selectedJobId = card.dataset.job;
            renderUnassigned();
            renderNearbyDrivers(selectedJobId);
        });
    });
}

function renderNearbyDrivers(jobId) {
    const el = document.getElementById('nearbyDrivers');
    const job = allJobs.find(function (j) { return j.id === jobId; });
    if (!job) { el.innerHTML = '<div class="empty">Select an order to see matching drivers.</div>'; return; }

    const busyDriverIds = allJobs
        .filter(function (j) { return j.driver_id && (j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'); })
        .map(function (j) { return j.driver_id; });

    const matching = allDrivers.filter(function (d) {
        return d.vehicle_class === job.vehicle && d.verification_status === 'approved' && d.account_status === 'active';
    });

    const withDistance = matching.map(function (d) {
        const busy = busyDriverIds.indexOf(d.id) !== -1;
        const dist = (job.pickup_lat && job.pickup_lng && d.last_lat && d.last_lng)
            ? haversineKm(job.pickup_lat, job.pickup_lng, d.last_lat, d.last_lng)
            : null;
        return { driver: d, dist: dist, busy: busy };
    }).sort(function (a, b) {
        if (a.dist === null) return 1;
        if (b.dist === null) return -1;
        return a.dist - b.dist;
    });

    if (!withDistance.length) { el.innerHTML = '<div class="empty">No approved ' + vehicleLabel(job.vehicle) + ' drivers on file.</div>'; return; }

    el.innerHTML =
        '<button class="btn btn-blue" id="autoAssignBtn" style="margin-bottom: 10px;">Auto-assign nearest available</button>' +
        withDistance.map(function (w) {
            const eta = w.dist !== null ? Math.round((w.dist / 30) * 60) + ' min' : '—';
            return (
                '<div class="job">' +
                    '<div class="route">' + escapeHtml(w.driver.full_name) + '</div>' +
                    '<div class="meta">' + (w.dist !== null ? w.dist.toFixed(1) + ' km away • ETA ~' + eta : 'Location unknown') + '</div>' +
                    '<span class="badge ' + (w.busy ? 'cancelled' : 'delivered') + '" style="margin-top: 6px;">' + (w.busy ? 'Busy' : 'Free') + '</span>' +
                    '<div style="margin-top: 8px;">' +
                        '<button class="btn btn-blue" data-driver="' + w.driver.id + '"' + (w.busy ? ' disabled' : '') + ' data-action="assign-driver">Assign</button>' +
                    '</div>' +
                '</div>'
            );
        }).join('');

    document.getElementById('autoAssignBtn').addEventListener('click', function () { autoAssignOne(job); });
    el.querySelectorAll('button[data-action="assign-driver"]').forEach(function (btn) {
        btn.addEventListener('click', function () { assignDriverToJob(job.id, btn.dataset.driver); });
    });

    renderDispatchMap(job, withDistance);
}

function renderDispatchMap(job, withDistance) {
    dispatchMarkers.forEach(function (m) { dispatchMap.removeLayer(m); });
    dispatchMarkers = [];

    if (job.pickup_lat && job.pickup_lng) {
        const pickupMarker = L.marker([job.pickup_lat, job.pickup_lng], {
            icon: L.divIcon({ html: '📦', className: 'driver-marker', iconSize: [26, 26] }),
        }).bindPopup('Pickup: ' + escapeHtml(job.pickup)).addTo(dispatchMap);
        dispatchMarkers.push(pickupMarker);
        dispatchMap.setView([job.pickup_lat, job.pickup_lng], 11);
    }

    withDistance.forEach(function (w) {
        if (!w.driver.last_lat || !w.driver.last_lng) return;
        const m = L.marker([w.driver.last_lat, w.driver.last_lng], {
            icon: L.divIcon({ html: w.busy ? '🚫' : '🚚', className: 'driver-marker', iconSize: [24, 24] }),
        }).bindPopup(escapeHtml(w.driver.full_name)).addTo(dispatchMap);
        dispatchMarkers.push(m);
    });
}

async function assignDriverToJob(jobId, driverId) {
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'offered' }).eq('id', jobId);
    if (error) { alert('Failed to assign: ' + error.message); return; }
    selectedJobId = null;
    load();
}

async function autoAssignOne(job) {
    const busyDriverIds = allJobs
        .filter(function (j) { return j.driver_id && (j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'); })
        .map(function (j) { return j.driver_id; });

    const candidates = allDrivers.filter(function (d) {
        return d.vehicle_class === job.vehicle && d.verification_status === 'approved' &&
            d.account_status === 'active' && busyDriverIds.indexOf(d.id) === -1;
    });
    if (!candidates.length) { alert('No available driver of that vehicle class right now.'); return; }

    let chosen = candidates[0];
    if (job.pickup_lat && job.pickup_lng) {
        const withDistance = candidates
            .filter(function (d) { return d.last_lat && d.last_lng; })
            .map(function (d) { return { driver: d, dist: haversineKm(job.pickup_lat, job.pickup_lng, d.last_lat, d.last_lng) }; })
            .sort(function (a, b) { return a.dist - b.dist; });
        if (withDistance.length) chosen = withDistance[0].driver;
    }

    assignDriverToJob(job.id, chosen.id);
}
