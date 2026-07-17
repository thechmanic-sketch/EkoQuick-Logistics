let currentUser = null;
let watchId = null;
let activeJobId = null;
let lastPos = null;
const jobMaps = {};

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') {
        await supabase.auth.signOut();
        window.location.href = 'driver-login.html';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        stopTracking();
        stopPresence();
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('refreshBtn').addEventListener('click', loadJobs);

    beginPresence();
    loadJobs();

    supabase
        .channel('driver-jobs-' + currentUser.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'driver_id=eq.' + currentUser.id }, function (payload) {
            // Our own GPS writes touch driver_lat/lng constantly — only a full
            // reload (which rebuilds the map) when the job actually changes state.
            var oldStatus = payload.old && payload.old.status;
            var newStatus = payload.new && payload.new.status;
            if (payload.eventType !== 'UPDATE' || oldStatus !== newStatus) loadJobs();
        })
        .subscribe();
});

let presenceWatchId = null;

function beginPresence() {
    if (!navigator.geolocation) return;
    presenceWatchId = navigator.geolocation.watchPosition(
        async function (pos) {
            await supabase.from('profiles').update({
                last_lat: pos.coords.latitude,
                last_lng: pos.coords.longitude,
            }).eq('id', currentUser.id);
        },
        function () { /* silently ignore — presence is best-effort */ },
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 }
    );
}

function stopPresence() {
    if (presenceWatchId !== null) { navigator.geolocation.clearWatch(presenceWatchId); presenceWatchId = null; }
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

const STATUS_LABELS = {
    pending: 'Pending',
    offered: 'New job — respond below',
    to_pickup: 'Heading to pickup',
    to_dropoff: 'Heading to drop-off',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

const ACTIVE_STATUSES = ['offered', 'to_pickup', 'to_dropoff'];

async function loadJobs() {
    const { data: jobs, error } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false });
    if (error) {
        document.getElementById('jobsList').innerHTML = '<div class="empty">Failed to load jobs: ' + error.message + '</div>';
        return;
    }

    const active = (jobs || []).filter(function (j) { return ACTIVE_STATUSES.indexOf(j.status) !== -1; });
    const history = (jobs || []).filter(function (j) { return j.status === 'delivered' || j.status === 'cancelled'; });

    destroyAllJobMaps();
    renderActiveJobs(active);
    renderHistory(history);

    // Resume live tracking automatically if we're mid-trip (e.g. after a page reload).
    const inProgress = active.find(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    if (inProgress && activeJobId !== inProgress.id) beginTracking(inProgress.id);
    if (!inProgress) stopTracking();
}

function renderActiveJobs(jobs) {
    const list = document.getElementById('jobsList');
    if (!jobs.length) { list.innerHTML = '<div class="empty">No active jobs right now.</div>'; return; }

    list.innerHTML = jobs.map(function (job) {
        let actionArea = '';

        if (job.status === 'offered') {
            actionArea =
                '<button class="btn btn-blue" data-job="' + job.id + '" data-action="accept">Accept job</button>' +
                '<button class="btn btn-outline-blue" data-job="' + job.id + '" style="margin-top: 8px;" data-action="decline">Decline</button>';
        } else if (job.status === 'to_pickup') {
            actionArea =
                (job.pickup_lat && job.pickup_lng ? '<div id="jobMap-' + job.id + '" style="height: 180px; border: 1px solid var(--line); margin-bottom: 10px;"></div>' : '') +
                '<label>Pickup code (ask the sender)</label>' +
                '<input class="field-plain" id="collectionInput-' + job.id + '" placeholder="4-digit code">' +
                '<div class="msg error hidden" id="collectionError-' + job.id + '"></div>' +
                '<div class="msg error hidden" id="locError-' + job.id + '"></div>' +
                '<button class="btn btn-blue" data-job="' + job.id + '" data-action="confirm-pickup">Confirm pickup</button>';
        } else if (job.status === 'to_dropoff') {
            actionArea =
                (job.dropoff_lat && job.dropoff_lng ? '<div id="jobMap-' + job.id + '" style="height: 180px; border: 1px solid var(--line); margin-bottom: 10px;"></div>' : '') +
                '<label>Delivery code (ask the receiver)</label>' +
                '<input class="field-plain" id="deliveryInput-' + job.id + '" placeholder="4-digit code">' +
                '<div class="msg error hidden" id="deliveryError-' + job.id + '"></div>' +
                '<button class="btn btn-outline-blue" data-job="' + job.id + '" data-action="deliver">Mark Delivered</button>';
        }

        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.distance || 0) + ' km • You earn R' + driverEarning(job.quote).toFixed(2) + '</div>' +
                '<div class="meta">Sender: ' + escapeHtml(job.customer_phone || '') + '</div>' +
                '<div class="meta">Receiver: ' + escapeHtml(job.receiver_name || '') + (job.receiver_phone ? ' (' + escapeHtml(job.receiver_phone) + ')' : '') + '</div>' +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (actionArea ? '<div style="margin-top: 10px;">' + actionArea + '</div>' : '') +
            '</div>'
        );
    }).join('');

    list.querySelectorAll('button[data-action="accept"]').forEach(function (btn) {
        btn.addEventListener('click', function () { acceptJob(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="decline"]').forEach(function (btn) {
        btn.addEventListener('click', function () { declineJob(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="confirm-pickup"]').forEach(function (btn) {
        btn.addEventListener('click', function () { confirmPickup(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="deliver"]').forEach(function (btn) {
        btn.addEventListener('click', function () { markDelivered(btn.dataset.job); });
    });

    jobs.forEach(function (job) {
        if (job.status === 'to_pickup' && job.pickup_lat && job.pickup_lng) {
            ensureJobMap(job.id, job.pickup_lat, job.pickup_lng);
        } else if (job.status === 'to_dropoff' && job.dropoff_lat && job.dropoff_lng) {
            ensureJobMap(job.id, job.dropoff_lat, job.dropoff_lng);
        }
    });
}

function renderHistory(jobs) {
    const totalEl = document.getElementById('statTotalEarned');
    const list = document.getElementById('historyList');
    const delivered = jobs.filter(function (j) { return j.status === 'delivered'; });

    if (totalEl) {
        const total = delivered.reduce(function (sum, j) { return sum + driverEarning(j.quote); }, 0);
        totalEl.textContent = delivered.length + ' completed trips • Total earned: R' + total.toFixed(2);
    }

    if (!jobs.length) { list.innerHTML = '<div class="empty">No completed jobs yet.</div>'; return; }

    list.innerHTML = jobs.map(function (job) {
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.distance || 0) + ' km • You earned R' + driverEarning(job.quote).toFixed(2) + '</div>' +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (job.rating ? '<div class="meta" style="margin-top: 6px;">Rating: ' + '★'.repeat(job.rating) + (job.rating_comment ? ' — "' + escapeHtml(job.rating_comment) + '"' : '') + '</div>' : '') +
            '</div>'
        );
    }).join('');
}

function showJobError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
}

async function acceptJob(jobId) {
    const { error } = await supabase.from('jobs').update({ status: 'to_pickup' }).eq('id', jobId);
    if (error) { alert('Failed to accept job: ' + error.message); return; }
    beginTracking(jobId);
    loadJobs();
}

async function declineJob(jobId) {
    const { error } = await supabase.from('jobs').update({ status: 'pending', driver_id: null }).eq('id', jobId);
    if (error) { alert('Failed to decline job: ' + error.message); return; }
    loadJobs();
}

async function confirmPickup(jobId) {
    const { data: job } = await supabase.from('jobs').select('collection_code').eq('id', jobId).single();
    const entered = (document.getElementById('collectionInput-' + jobId).value || '').trim();

    if (job && job.collection_code && entered !== job.collection_code) {
        showJobError('collectionError-' + jobId, 'Incorrect pickup code — ask the sender to confirm it.');
        return;
    }

    const { error } = await supabase.from('jobs').update({ status: 'to_dropoff' }).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadJobs();
}

function beginTracking(jobId) {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported on this device — live tracking will not work for this trip.');
        return;
    }
    stopTracking();
    activeJobId = jobId;
    watchId = navigator.geolocation.watchPosition(
        async function (pos) {
            lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            await supabase.from('jobs').update({
                driver_lat: pos.coords.latitude,
                driver_lng: pos.coords.longitude,
            }).eq('id', jobId);
            updateJobMapDriverPos(jobId, lastPos.lat, lastPos.lng);
        },
        function (err) {
            var message = err && err.code === 1
                ? 'Location permission was denied — the customer will not see your live position. Please enable location access and accept the job again.'
                : 'Could not get your location (' + (err ? err.message : 'unknown error') + ') — live tracking may not work.';
            var errEl = document.getElementById('locError-' + jobId);
            if (errEl) { errEl.textContent = message; errEl.classList.remove('hidden'); }
            else alert(message);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
}

function stopTracking() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    activeJobId = null;
}

async function markDelivered(jobId) {
    const { data: job } = await supabase.from('jobs').select('delivery_code').eq('id', jobId).single();
    const entered = (document.getElementById('deliveryInput-' + jobId).value || '').trim();

    if (job && job.delivery_code && entered !== job.delivery_code) {
        showJobError('deliveryError-' + jobId, 'Incorrect delivery code — ask the receiver to confirm it.');
        return;
    }

    const { error } = await supabase.from('jobs').update({ status: 'delivered' }).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    if (activeJobId === jobId) stopTracking();
    loadJobs();
}

// ---- In-app route map (Leaflet + free OSRM routing, no API key) ----

function ensureJobMap(jobId, destLat, destLng) {
    const container = document.getElementById('jobMap-' + jobId);
    if (!container) return;

    const map = L.map(container).setView([destLat, destLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    const destMarker = L.marker([destLat, destLng], {
        icon: L.divIcon({ html: '📍', className: 'driver-marker', iconSize: [24, 24] }),
    }).addTo(map);
    jobMaps[jobId] = { map: map, destMarker: destMarker, driverMarker: null, routeLine: null, destLat: destLat, destLng: destLng, lastRouteAt: 0 };

    if (lastPos) updateJobMapDriverPos(jobId, lastPos.lat, lastPos.lng);
}

function updateJobMapDriverPos(jobId, lat, lng) {
    const entry = jobMaps[jobId];
    if (!entry) return;

    if (!entry.driverMarker) {
        entry.driverMarker = L.marker([lat, lng], {
            icon: L.divIcon({ html: '🚚', className: 'driver-marker', iconSize: [28, 28] }),
        }).addTo(entry.map);
    } else {
        entry.driverMarker.setLatLng([lat, lng]);
    }

    entry.map.fitBounds([[lat, lng], [entry.destLat, entry.destLng]], { padding: [24, 24] });

    const now = Date.now();
    if (now - entry.lastRouteAt > 20000) {
        entry.lastRouteAt = now;
        fetchRoute(lat, lng, entry.destLat, entry.destLng).then(function (latlngs) {
            if (!latlngs || !jobMaps[jobId]) return;
            if (entry.routeLine) entry.map.removeLayer(entry.routeLine);
            entry.routeLine = L.polyline(latlngs, { color: '#FF6A2B', weight: 4 }).addTo(entry.map);
        });
    }
}

async function fetchRoute(lat1, lng1, lat2, lng2) {
    try {
        const url = 'https://router.project-osrm.org/route/v1/driving/' + lng1 + ',' + lat1 + ';' + lng2 + ',' + lat2 + '?overview=full&geometries=geojson';
        const res = await fetch(url);
        const data = await res.json();
        const coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
        if (!coords) return null;
        return coords.map(function (c) { return [c[1], c[0]]; });
    } catch (err) {
        return null;
    }
}

function destroyAllJobMaps() {
    Object.keys(jobMaps).forEach(function (id) {
        jobMaps[id].map.remove();
        delete jobMaps[id];
    });
}
