let currentUser = null;
let driversCache = [];
let allJobsCache = [];
let fleetMap = null;
let fleetMarkers = {};
let onlineMarkers = {};
let autoAssigning = false;

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

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
    document.getElementById('jobSearch').addEventListener('input', applyJobFilters);
    document.getElementById('jobStatusFilter').addEventListener('change', applyJobFilters);

    fleetMap = L.map('fleetMap').setView([-29.6, 30.9], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(fleetMap);

    await loadDriverShare();
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

function isOnline(driver) {
    return !!(driver.last_seen_at && (Date.now() - new Date(driver.last_seen_at).getTime()) < ONLINE_WINDOW_MS);
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
    const activeJobsByDriver = {};
    jobs.forEach(function (j) {
        if ((j.status === 'to_pickup' || j.status === 'to_dropoff') && j.driver_lat && j.driver_lng) {
            activeJobsByDriver[j.driver_id] = j;
        }
    });

    const seenJobs = {};
    Object.keys(activeJobsByDriver).forEach(function (driverId) {
        const job = activeJobsByDriver[driverId];
        seenJobs[job.id] = true;
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
        if (!seenJobs[id]) { fleetMap.removeLayer(fleetMarkers[id]); delete fleetMarkers[id]; }
    });

    // Online drivers not currently mid-trip: plot them too, so admin can see
    // the whole available fleet, not just drivers already on a job.
    const seenOnline = {};
    driversCache.forEach(function (d) {
        if (activeJobsByDriver[d.id] || !isOnline(d) || !d.last_lat || !d.last_lng) return;
        seenOnline[d.id] = true;
        const pos = [d.last_lat, d.last_lng];
        if (onlineMarkers[d.id]) {
            onlineMarkers[d.id].setLatLng(pos);
        } else {
            onlineMarkers[d.id] = L.marker(pos, {
                icon: L.divIcon({ html: '🟢', className: 'driver-marker', iconSize: [20, 20] }),
            }).bindPopup(escapeHtml(d.full_name) + ' — online').addTo(fleetMap);
        }
    });
    Object.keys(onlineMarkers).forEach(function (id) {
        if (!seenOnline[id]) { fleetMap.removeLayer(onlineMarkers[id]); delete onlineMarkers[id]; }
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
                return d.vehicle_class === job.vehicle && d.verification_status === 'approved' &&
                    d.account_status === 'active' && busyDriverIds.indexOf(d.id) === -1;
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

        const online = isOnline(d);
        const statusBadge = d.account_status === 'active' ? '' : '<span class="badge cancelled" style="margin-left:6px;">' + d.account_status + '</span>';

        return (
            '<div class="job">' +
                '<div style="display:flex; align-items:center; gap:10px;">' +
                    (d.avatar_url ? '<img src="' + escapeHtml(d.avatar_url) + '" style="width:40px; height:40px; object-fit:cover; border:1px solid var(--line);">' : '') +
                    '<div class="route">' + escapeHtml(d.full_name || d.id) + '</div>' +
                '</div>' +
                '<span class="badge ' + (online ? 'delivered' : 'cancelled') + '" style="margin-top: 8px;">' + (online ? 'Online' : 'Offline') + '</span> ' +
                '<span class="badge ' + (d.verification_status === 'approved' ? 'delivered' : d.verification_status === 'rejected' ? 'cancelled' : 'pending') + '">' + (d.verification_status || 'pending') + '</span>' +
                statusBadge +
                (docLinks ? '<div style="margin-top: 8px;">' + docLinks + '</div>' : '<div class="meta" style="margin-top: 8px;">No documents uploaded yet.</div>') +
                '<div style="margin-top: 10px;">' +
                    '<label>Full name</label>' +
                    '<input class="field-plain" id="nameInput-' + d.id + '" value="' + escapeHtml(d.full_name || '') + '">' +
                    '<label>Phone</label>' +
                    '<input class="field-plain" id="phoneInput-' + d.id + '" value="' + escapeHtml(d.phone || '') + '">' +
                    '<select class="field-plain" id="vehicleSelect-' + d.id + '" style="margin-bottom: 8px;">' +
                        '<option value="">No vehicle class set</option>' +
                        vehicleOptions +
                    '</select>' +
                    '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="save-profile">Save profile</button>' +
                '</div>' +
                '<div style="margin-top: 8px;">' +
                    '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="approve" style="margin-right: 8px;">Approve</button>' +
                    '<button class="btn btn-outline-blue" data-driver="' + d.id + '" data-action="reject">Reject</button>' +
                '</div>' +
                '<div style="margin-top: 8px;">' +
                    (d.account_status === 'active'
                        ? '<button class="btn btn-outline-blue" data-driver="' + d.id + '" data-action="pause" style="margin-right: 8px;">Pause</button>'
                        : '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="activate" style="margin-right: 8px;">Reactivate</button>') +
                    '<button class="btn btn-outline-blue" data-driver="' + d.id + '" data-action="ban">Ban / Cut profile</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    driversCache.forEach(function (d) {
        const sel = document.getElementById('vehicleSelect-' + d.id);
        if (sel && d.vehicle_class) sel.value = d.vehicle_class;
    });

    el.querySelectorAll('button[data-action="save-profile"]').forEach(function (btn) {
        btn.addEventListener('click', function () { saveDriverProfile(btn.dataset.driver); });
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
    el.querySelectorAll('button[data-action="pause"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setAccountStatus(btn.dataset.driver, 'paused'); });
    });
    el.querySelectorAll('button[data-action="activate"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setAccountStatus(btn.dataset.driver, 'active'); });
    });
    el.querySelectorAll('button[data-action="ban"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (confirm('This will permanently ban the driver from receiving jobs. Continue?')) {
                setAccountStatus(btn.dataset.driver, 'banned');
            }
        });
    });
}

async function setDriverVerification(driverId, status) {
    const { error } = await supabase.from('profiles').update({ verification_status: status }).eq('id', driverId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadJobs();
}

async function setAccountStatus(driverId, status) {
    const { error } = await supabase.from('profiles').update({ account_status: status }).eq('id', driverId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadJobs();
}

async function viewDriverDoc(path) {
    const { data, error } = await supabase.storage.from('driver-docs').createSignedUrl(path, 300);
    if (error) { alert('Failed to open document: ' + error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
}

async function saveDriverProfile(driverId) {
    const vehicleClass = document.getElementById('vehicleSelect-' + driverId).value;
    const fullName = document.getElementById('nameInput-' + driverId).value.trim();
    const phone = document.getElementById('phoneInput-' + driverId).value.trim();
    if (!fullName) { alert('Name cannot be empty'); return; }

    const { error } = await supabase.from('profiles').update({
        full_name: fullName,
        phone: phone,
        vehicle_class: vehicleClass || null,
    }).eq('id', driverId);
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

function formatTime(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function whatsappResend(phone, message) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (!digits) { alert('No phone number on file for this contact.'); return; }
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
}

async function loadJobs() {
    const list = document.getElementById('jobsList');
    const { data: jobs, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">Failed to load jobs: ' + error.message + '</div>'; return; }

    const { data: drivers } = await supabase.from('profiles').select('id, full_name, phone, vehicle_class, last_lat, last_lng, last_seen_at, avatar_url, verification_status, account_status, license_url, id_doc_url, vehicle_reg_url, insurance_url').eq('role', 'driver');
    driversCache = drivers || [];
    allJobsCache = jobs || [];

    renderStats(jobs || []);
    renderFleetMap(jobs || []);
    renderDrivers();
    renderReviews(jobs || []);
    await autoAssignPending(jobs || []);

    applyJobFilters();
}

function applyJobFilters() {
    const query = (document.getElementById('jobSearch').value || '').trim().toLowerCase();
    const status = document.getElementById('jobStatusFilter').value;

    let filtered = allJobsCache;
    if (status) filtered = filtered.filter(function (j) { return j.status === status; });
    if (query) {
        filtered = filtered.filter(function (j) {
            return (j.pickup || '').toLowerCase().indexOf(query) !== -1 ||
                (j.dropoff || '').toLowerCase().indexOf(query) !== -1 ||
                (j.customer_phone || '').toLowerCase().indexOf(query) !== -1 ||
                (j.receiver_phone || '').toLowerCase().indexOf(query) !== -1;
        });
    }
    renderJobsList(filtered);
}

function renderJobsList(jobs) {
    const list = document.getElementById('jobsList');
    if (!jobs || jobs.length === 0) { list.innerHTML = '<div class="empty">No jobs match.</div>'; return; }

    const driverOptions = driversCache.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + ' — ' + vehicleLabel(d.vehicle_class) + '</option>';
    }).join('');

    list.innerHTML = jobs.map(function (job) {
        const isDone = job.status === 'delivered' || job.status === 'cancelled';

        const codesHtml =
            (job.collection_code
                ? '<div class="meta">Pickup code: <b>' + escapeHtml(job.collection_code) + '</b> ' +
                    '<button class="btn btn-outline-blue" style="width:auto; display:inline-block; padding:4px 10px; font-size:10px;" data-job="' + job.id + '" data-action="resend-collection">Resend</button></div>'
                : '') +
            (job.delivery_code
                ? '<div class="meta" style="margin-top:4px;">Delivery code: <b>' + escapeHtml(job.delivery_code) + '</b> ' +
                    '<button class="btn btn-outline-blue" style="width:auto; display:inline-block; padding:4px 10px; font-size:10px;" data-job="' + job.id + '" data-action="resend-delivery">Resend</button></div>'
                : '');

        const timelineHtml = isDone
            ? '<div class="meta" style="margin-top: 8px; line-height:1.8;">' +
                'Booked: ' + (formatTime(job.created_at) || '—') + '<br>' +
                'Accepted (heading to pickup): ' + (formatTime(job.to_pickup_at) || '—') + '<br>' +
                'Picked up (heading to drop-off): ' + (formatTime(job.to_dropoff_at) || '—') + '<br>' +
                'Delivered: ' + (formatTime(job.delivered_at) || '—') +
              '</div>'
            : '';

        const assignHtml = isDone ? '' :
            '<div style="margin-top: 10px;">' +
                '<select class="field-plain" id="driverSelect-' + job.id + '" style="margin-bottom: 8px;">' +
                    '<option value="">Assign a driver...</option>' +
                    driverOptions +
                '</select>' +
                '<button class="btn btn-blue" data-job="' + job.id + '" data-action="assign">Assign Driver</button>' +
            '</div>';

        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + vehicleLabel(job.vehicle) + ' • ' + (job.distance || 0) + ' km • R' + (job.quote || 0) +
                    ' (driver R' + driverEarning(job.quote).toFixed(2) + ' / us R' + platformFee(job.quote).toFixed(2) + ')' +
                    ' • Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
                (job.receiver_name ? '<div class="meta">Receiver: ' + escapeHtml(job.receiver_name) + '</div>' : '') +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (job.rating ? '<div class="meta" style="margin-top: 6px;">Rating: ' + '★'.repeat(job.rating) + (job.rating_comment ? ' — "' + escapeHtml(job.rating_comment) + '"' : '') + '</div>' : '') +
                (codesHtml ? '<div style="margin-top: 8px;">' + codesHtml + '</div>' : '') +
                timelineHtml +
                assignHtml +
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
    list.querySelectorAll('button[data-action="resend-collection"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const job = jobs.find(function (j) { return j.id === btn.dataset.job; });
            if (!job) return;
            whatsappResend(job.customer_phone, 'Ekoquick pickup code reminder: ' + job.collection_code + ' — give this to your driver at pickup.');
        });
    });
    list.querySelectorAll('button[data-action="resend-delivery"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const job = jobs.find(function (j) { return j.id === btn.dataset.job; });
            if (!job) return;
            whatsappResend(job.receiver_phone, 'Ekoquick delivery code reminder: ' + job.delivery_code + ' — give this to the driver when your parcel arrives.');
        });
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
