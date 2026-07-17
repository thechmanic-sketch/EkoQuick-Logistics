let currentUser = null;
let driversCache = [];
let fleetMap = null;
let fleetMarkers = {};
let autoAssigning = false;

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('admin-login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('refreshBtn').addEventListener('click', loadJobs);

    fleetMap = L.map('fleetMap').setView([-29.6, 30.9], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(fleetMap);

    loadJobs();

    supabase
        .channel('admin-jobs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadJobs)
        .subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

const STATUS_LABELS = {
    pending: 'Pending',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

function renderStats(jobs) {
    const delivered = jobs.filter(function (j) { return j.status === 'delivered'; });
    const revenue = delivered.reduce(function (sum, j) { return sum + (Number(j.quote) || 0); }, 0);
    const rated = jobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length
        ? (rated.reduce(function (sum, j) { return sum + j.rating; }, 0) / rated.length).toFixed(1)
        : '—';

    document.getElementById('statRevenue').textContent = 'R' + revenue.toLocaleString();
    document.getElementById('statTrips').textContent = delivered.length;
    document.getElementById('statRating').textContent = avgRating === '—' ? '—' : avgRating + ' ★';
}

function renderFleetMap(jobs) {
    const active = jobs.filter(function (j) { return j.status === 'in_progress' && j.driver_lat && j.driver_lng; });
    const seen = {};

    active.forEach(function (job) {
        seen[job.id] = true;
        const pos = [job.driver_lat, job.driver_lng];
        if (fleetMarkers[job.id]) {
            fleetMarkers[job.id].setLatLng(pos);
        } else {
            fleetMarkers[job.id] = L.marker(pos, {
                icon: L.divIcon({ html: '🚚', className: 'driver-marker', iconSize: [28, 28] }),
            }).bindPopup(escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff)).addTo(fleetMap);
        }
    });

    Object.keys(fleetMarkers).forEach(function (id) {
        if (!seen[id]) {
            fleetMap.removeLayer(fleetMarkers[id]);
            delete fleetMarkers[id];
        }
    });
}

async function autoAssignPending(jobs) {
    if (autoAssigning) return;
    const unassigned = jobs.filter(function (j) { return j.status === 'pending' && !j.driver_id; });
    if (!unassigned.length) return;

    autoAssigning = true;
    try {
        const busyDriverIds = jobs
            .filter(function (j) { return j.driver_id && (j.status === 'assigned' || j.status === 'in_progress'); })
            .map(function (j) { return j.driver_id; });

        for (const job of unassigned) {
            const available = driversCache.find(function (d) { return busyDriverIds.indexOf(d.id) === -1; });
            if (!available) break;
            const { error } = await supabase.from('jobs').update({ driver_id: available.id, status: 'assigned' }).eq('id', job.id);
            if (!error) busyDriverIds.push(available.id);
        }
    } finally {
        autoAssigning = false;
    }
}

async function loadJobs() {
    const list = document.getElementById('jobsList');
    const { data: jobs, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">Failed to load jobs: ' + error.message + '</div>'; return; }

    const { data: drivers } = await supabase.from('profiles').select('id, full_name').eq('role', 'driver');
    driversCache = drivers || [];

    renderStats(jobs || []);
    renderFleetMap(jobs || []);
    await autoAssignPending(jobs || []);

    if (!jobs || jobs.length === 0) { list.innerHTML = '<div class="empty">No jobs yet.</div>'; return; }

    const driverOptions = driversCache.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + '</option>';
    }).join('');

    list.innerHTML = jobs.map(function (job) {
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.distance || 0) + ' km • R' + (job.quote || 0) + ' • Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
                (job.receiver_name ? '<div class="meta">Receiver: ' + escapeHtml(job.receiver_name) + '</div>' : '') +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (job.rating ? '<div class="meta" style="margin-top: 6px;">Rating: ' + '★'.repeat(job.rating) + (job.rating_comment ? ' — "' + escapeHtml(job.rating_comment) + '"' : '') + '</div>' : '') +
                '<div style="margin-top: 10px;">' +
                    '<select class="field-plain" id="driverSelect-' + job.id + '" style="margin-bottom: 8px;">' +
                        '<option value="">Assign a driver...</option>' +
                        driverOptions +
                    '</select>' +
                    '<button class="btn btn-blue" data-job="' + job.id + '" data-action="assign">Assign Driver</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    jobs.forEach(function (job) {
        if (job.driver_id) {
            const sel = document.getElementById('driverSelect-' + job.id);
            if (sel) sel.value = job.driver_id;
        }
    });

    list.querySelectorAll('button[data-action="assign"]').forEach(function (btn) {
        btn.addEventListener('click', function () { assignDriver(btn.dataset.job); });
    });
}

async function assignDriver(jobId) {
    const sel = document.getElementById('driverSelect-' + jobId);
    const driverId = sel.value;
    if (!driverId) { alert('Please select a driver'); return; }
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'assigned' }).eq('id', jobId);
    if (error) { alert('Failed to assign driver: ' + error.message); return; }
    loadJobs();
}
