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
    offered: 'Awaiting driver',
    to_pickup: 'Heading to pickup',
    to_dropoff: 'Heading to drop-off',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

function renderStats(jobs) {
    const delivered = jobs.filter(function (j) { return j.status === 'delivered'; });
    const revenue = delivered.reduce(function (sum, j) { return sum + (Number(j.quote) || 0); }, 0);
    const driverPayouts = delivered.reduce(function (sum, j) { return sum + driverEarning(j.quote); }, 0);
    const platformRevenue = delivered.reduce(function (sum, j) { return sum + platformFee(j.quote); }, 0);
    const rated = jobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length
        ? (rated.reduce(function (sum, j) { return sum + j.rating; }, 0) / rated.length).toFixed(1)
        : '—';

    document.getElementById('statRevenue').textContent = 'R' + revenue.toLocaleString();
    document.getElementById('statTrips').textContent = delivered.length;
    document.getElementById('statRating').textContent = avgRating === '—' ? '—' : avgRating + ' ★';
    document.getElementById('statPlatform').textContent = 'R' + platformRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 });
    document.getElementById('statDrivers').textContent = 'R' + driverPayouts.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderReviews(jobs) {
    const el = document.getElementById('reviewsList');
    if (!el) return;

    const rated = jobs.filter(function (j) { return j.rating; }).sort(function (a, b) { return a.rating - b.rating; });
    if (!rated.length) { el.innerHTML = '<div class="empty">No reviews yet.</div>'; return; }

    el.innerHTML = rated.map(function (job) {
        const driver = driversCache.find(function (d) { return d.id === job.driver_id; });
        const isComplaint = job.rating <= 2;
        return (
            '<div class="job">' +
                (isComplaint ? '<span class="badge cancelled">Complaint</span>' : '') +
                '<div class="route" style="margin-top: 6px;">' + '★'.repeat(job.rating) + '☆'.repeat(5 - job.rating) + ' — ' + escapeHtml(driver ? driver.full_name : 'Unknown driver') + '</div>' +
                '<div class="meta">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                (job.rating_comment ? '<div class="meta" style="margin-top:6px;">"' + escapeHtml(job.rating_comment) + '"</div>' : '') +
                '<div class="meta">Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
            '</div>'
        );
    }).join('');
}

function renderFleetMap(jobs) {
    const active = jobs.filter(function (j) {
        return (j.status === 'to_pickup' || j.status === 'to_dropoff') && j.driver_lat && j.driver_lng;
    });
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
            .filter(function (j) { return j.driver_id && (j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'); })
            .map(function (j) { return j.driver_id; });

        for (const job of unassigned) {
            const candidates = driversCache.filter(function (d) {
                return d.vehicle_class === job.vehicle && d.verification_status === 'approved' && busyDriverIds.indexOf(d.id) === -1;
            });
            if (!candidates.length) continue;

            let chosen = candidates[0];
            if (job.pickup_lat && job.pickup_lng) {
                const withDistance = candidates
                    .filter(function (d) { return d.last_lat && d.last_lng; })
                    .map(function (d) {
                        return { driver: d, dist: haversineKm(job.pickup_lat, job.pickup_lng, d.last_lat, d.last_lng) };
                    })
                    .sort(function (a, b) { return a.dist - b.dist; });
                if (withDistance.length) chosen = withDistance[0].driver;
            }

            const { error } = await supabase.from('jobs').update({ driver_id: chosen.id, status: 'offered' }).eq('id', job.id);
            if (!error) busyDriverIds.push(chosen.id);
        }
    } finally {
        autoAssigning = false;
    }
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : '';
}

function renderDrivers() {
    const el = document.getElementById('driversList');
    if (!el) return;
    if (!driversCache.length) { el.innerHTML = '<div class="empty">No drivers signed up yet.</div>'; return; }

    const vehicleOptions = (typeof VEHICLES !== 'undefined' ? VEHICLES : [])
        .map(function (v) { return '<option value="' + v.id + '">' + v.icon + ' ' + v.label + '</option>'; })
        .join('');

    const docFields = [
        ['license_url', 'Licence'],
        ['id_doc_url', 'ID'],
        ['vehicle_reg_url', 'Vehicle reg'],
        ['insurance_url', 'Insurance'],
    ];

    el.innerHTML = driversCache.map(function (d) {
        const docLinks = docFields.map(function (f) {
            if (!d[f[0]]) return '';
            return '<button class="btn btn-outline-blue" style="margin-right: 6px; margin-bottom: 6px; display:inline-block; width:auto;" data-doc="' + escapeHtml(d[f[0]]) + '" data-action="view-doc">' + f[1] + '</button>';
        }).join('');

        return (
            '<div class="job">' +
                '<div style="display:flex; align-items:center; gap:10px;">' +
                    (d.avatar_url ? '<img src="' + escapeHtml(d.avatar_url) + '" style="width:40px; height:40px; object-fit:cover; border:1px solid var(--line);">' : '') +
                    '<div class="route">' + escapeHtml(d.full_name || d.id) + '</div>' +
                '</div>' +
                '<span class="badge ' + (d.verification_status === 'approved' ? 'delivered' : d.verification_status === 'rejected' ? 'cancelled' : 'pending') + '" style="margin-top: 8px;">' + (d.verification_status || 'pending') + '</span>' +
                (docLinks ? '<div style="margin-top: 8px;">' + docLinks + '</div>' : '<div class="meta" style="margin-top: 8px;">No documents uploaded yet.</div>') +
                '<div style="margin-top: 10px;">' +
                    '<select class="field-plain" id="vehicleSelect-' + d.id + '" style="margin-bottom: 8px;">' +
                        '<option value="">No vehicle class set</option>' +
                        vehicleOptions +
                    '</select>' +
                    '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="save-vehicle">Save vehicle class</button>' +
                '</div>' +
                '<div style="margin-top: 8px;">' +
                    '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="approve" style="margin-right: 8px;">Approve</button>' +
                    '<button class="btn btn-outline-blue" data-driver="' + d.id + '" data-action="reject">Reject</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    driversCache.forEach(function (d) {
        const sel = document.getElementById('vehicleSelect-' + d.id);
        if (sel && d.vehicle_class) sel.value = d.vehicle_class;
    });

    el.querySelectorAll('button[data-action="save-vehicle"]').forEach(function (btn) {
        btn.addEventListener('click', function () { saveDriverVehicle(btn.dataset.driver); });
    });
    el.querySelectorAll('button[data-action="approve"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setDriverVerification(btn.dataset.driver, 'approved'); });
    });
    el.querySelectorAll('button[data-action="reject"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setDriverVerification(btn.dataset.driver, 'rejected'); });
    });
    el.querySelectorAll('button[data-action="view-doc"]').forEach(function (btn) {
        btn.addEventListener('click', function () { viewDriverDoc(btn.dataset.doc); });
    });
}

async function setDriverVerification(driverId, status) {
    const { error } = await supabase.from('profiles').update({ verification_status: status }).eq('id', driverId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadJobs();
}

async function viewDriverDoc(path) {
    const { data, error } = await supabase.storage.from('driver-docs').createSignedUrl(path, 300);
    if (error) { alert('Failed to open document: ' + error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
}

async function saveDriverVehicle(driverId) {
    const sel = document.getElementById('vehicleSelect-' + driverId);
    const vehicleClass = sel.value;
    if (!vehicleClass) { alert('Please choose a vehicle class'); return; }
    const { error } = await supabase.from('profiles').update({ vehicle_class: vehicleClass }).eq('id', driverId);
    if (error) { alert('Failed to save: ' + error.message); return; }
    loadJobs();
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadJobs() {
    const list = document.getElementById('jobsList');
    const { data: jobs, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">Failed to load jobs: ' + error.message + '</div>'; return; }

    const { data: drivers } = await supabase.from('profiles').select('id, full_name, vehicle_class, last_lat, last_lng, avatar_url, verification_status, license_url, id_doc_url, vehicle_reg_url, insurance_url').eq('role', 'driver');
    driversCache = drivers || [];

    renderStats(jobs || []);
    renderFleetMap(jobs || []);
    renderDrivers();
    renderReviews(jobs || []);
    await autoAssignPending(jobs || []);

    if (!jobs || jobs.length === 0) { list.innerHTML = '<div class="empty">No jobs yet.</div>'; return; }

    const driverOptions = driversCache.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + ' — ' + vehicleLabel(d.vehicle_class) + '</option>';
    }).join('');

    list.innerHTML = jobs.map(function (job) {
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + vehicleLabel(job.vehicle) + ' • ' + (job.distance || 0) + ' km • R' + (job.quote || 0) +
                    ' (driver R' + driverEarning(job.quote).toFixed(2) + ' / us R' + platformFee(job.quote).toFixed(2) + ')' +
                    ' • Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
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
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'offered' }).eq('id', jobId);
    if (error) { alert('Failed to assign driver: ' + error.message); return; }
    loadJobs();
}
