const STALE_GPS_MS = 10 * 60 * 1000;
// How fresh a GPS ping has to be for a driver to actually show on the map —
// tighter than a general "online" window since this controls visibility,
// not just a status label. A driver whose location hasn't updated within
// this window isn't live, even if their Online toggle is still on.
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const TRAIL_MAX_POINTS = 100;

let fleetMap = null;
let driverMarkers = {};
let jobMarkers = {};
let routeLines = {};
let allDrivers = [];
let allJobs = [];
let profilesById = {};
let selectedDriverId = null;
let selectedJobId = null;
let eventLog = [];
let prevSnapshot = {};
let driverTrails = {}; // driverId -> [[lat,lng], ...] breadcrumb of recent live positions
let selectedTrailLine = null;
let followSelected = false;

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
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('fullscreenBtn').addEventListener('click', function () {
        const el = document.querySelector('.fleet-grid');
        if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen();
    });
    document.getElementById('driverSearch').addEventListener('input', renderDriverList);
    document.getElementById('statusFilter').addEventListener('change', renderDriverList);
    document.getElementById('vehicleFilter').addEventListener('change', renderDriverList);

    populateVehicleFilter();

    // Runs alongside (not before) the critical data loads below, so a
    // slow/blocked Google Maps script never delays the fleet list/data.
    GoogleMaps.createMap('fleetMap', [-29.6, 30.9], 8).then(function (m) { fleetMap = m; renderMap(); });

    await loadDriverShare();
    await loadCommissionRules();
    await loadAll();

    supabase.channel('fleet-map-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll).subscribe();
    supabase.channel('fleet-map-drivers').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadAll).subscribe();
    setInterval(loadAll, 8000);
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
    return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function whatsappLink(phone, message) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (!digits) return null;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message || '');
}

function isOnline(driver) {
    // Trust the driver's own Online toggle, not just GPS heartbeat recency
    // — see admin-drivers.js isOnline() for why. last_seen_at staleness is
    // still used separately below (driverStatus) to flag "attention" when
    // an online driver's GPS has stopped updating during an active job.
    return driver.is_online === true;
}

function isLive(driver) {
    // Whether a driver should actually show on the map right now — the
    // Online toggle alone isn't enough (it can't detect a crashed app or
    // dead connection), so also require a recent GPS ping.
    return isOnline(driver) && !!driver.last_seen_at && (Date.now() - new Date(driver.last_seen_at).getTime()) < LIVE_WINDOW_MS;
}

function activeJobForDriver(driverId) {
    return allJobs.find(function (j) { return j.driver_id === driverId && (j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'); });
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function recordTrailPoint(driverId, pos) {
    const trail = driverTrails[driverId] || (driverTrails[driverId] = []);
    const last = trail[trail.length - 1];
    if (last && last[0] === pos[0] && last[1] === pos[1]) return; // no movement, don't pad the trail
    trail.push(pos);
    if (trail.length > TRAIL_MAX_POINTS) trail.shift();
}

function renderSelectedTrail() {
    if (!selectedDriverId || !driverMarkers[selectedDriverId]) {
        if (selectedTrailLine) { selectedTrailLine.remove(); selectedTrailLine = null; }
        return;
    }
    const trail = driverTrails[selectedDriverId] || [];
    if (trail.length < 2) {
        if (selectedTrailLine) { selectedTrailLine.remove(); selectedTrailLine = null; }
        return;
    }
    if (selectedTrailLine) selectedTrailLine.setLatLngs(trail);
    else selectedTrailLine = GoogleMaps.createPolyline(fleetMap, trail, '#FF6A2B', 3);
}

function computeEta(job) {
    if (job.status !== 'to_pickup' && job.status !== 'to_dropoff') return '—';
    const destLat = job.status === 'to_pickup' ? job.pickup_lat : job.dropoff_lat;
    const destLng = job.status === 'to_pickup' ? job.pickup_lng : job.dropoff_lng;
    if (!job.driver_lat || !job.driver_lng || !destLat || !destLng) return '—';
    const km = haversineKm(job.driver_lat, job.driver_lng, destLat, destLng);
    return Math.round((km / 30) * 60) + ' min';
}

function driverStatus(d) {
    const job = activeJobForDriver(d.id);
    if (job && job.driver_lat && job.driver_lng && job.status !== 'offered') {
        const staleGps = d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) > STALE_GPS_MS;
        if (staleGps) return 'attention';
        return 'busy';
    }
    if (job) return 'busy';
    if (isOnline(d)) {
        // The Online toggle can't detect a crashed app, force-closed tab,
        // or dead connection — only a logout click turns it off cleanly.
        // A very stale GPS heartbeat while still marked online is the only
        // signal we have that they may not actually be reachable.
        const staleGps = d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) > STALE_GPS_MS;
        if (staleGps) return 'attention';
        return 'online';
    }
    return 'offline';
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

    allJobs = jobs || [];
    allDrivers = drivers || [];
    profilesById = {};
    allDrivers.forEach(function (d) { profilesById[d.id] = d; });

    detectEvents();
    document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('en-ZA');

    renderSummaryCards();
    renderDriverList();
    renderMap();
    if (selectedDriverId) renderDriverDetails(selectedDriverId);
    if (selectedJobId) renderJobDetails(selectedJobId);
}

function detectEvents() {
    const nextSnapshot = {};
    allDrivers.forEach(function (d) {
        const wasOnline = prevSnapshot[d.id] ? prevSnapshot[d.id].online : null;
        const nowOnline = isOnline(d);
        nextSnapshot[d.id] = { online: nowOnline };
        if (wasOnline !== null && wasOnline !== nowOnline) {
            pushEvent(nowOnline ? (d.full_name + ' came online') : (d.full_name + ' went offline'), 'driver', d.id);
        }
    });
    allJobs.forEach(function (j) {
        const key = 'job:' + j.id;
        const prevStatus = prevSnapshot[key] ? prevSnapshot[key].status : null;
        nextSnapshot[key] = { status: j.status };
        if (prevStatus && prevStatus !== j.status) {
            const driver = profilesById[j.driver_id];
            const driverName = driver ? driver.full_name : 'Driver';
            const labels = {
                offered: driverName + ' accepted a job',
                to_pickup: driverName + ' heading to pickup',
                to_dropoff: 'Parcel picked up by ' + driverName,
                delivered: 'Delivery completed — ' + j.pickup + ' → ' + j.dropoff,
                cancelled: 'Job cancelled — ' + j.pickup + ' → ' + j.dropoff,
            };
            if (labels[j.status]) pushEvent(labels[j.status], 'job', j.id);
        }
    });
    prevSnapshot = nextSnapshot;
}

function pushEvent(text, type, id) {
    eventLog.unshift({ text: text, type: type, id: id, time: new Date().toISOString() });
    eventLog = eventLog.slice(0, 30);
    renderEvents();
}

function renderEvents() {
    const el = document.getElementById('eventsList');
    if (!eventLog.length) { el.innerHTML = '<div class="empty">No events yet.</div>'; return; }
    el.innerHTML = eventLog.map(function (e, i) {
        return '<div class="event-item" data-idx="' + i + '">' + escapeHtml(e.text) + '<div style="color:var(--muted-dim); font-size:10px;">' + formatTime(e.time) + '</div></div>';
    }).join('');
    el.querySelectorAll('.event-item').forEach(function (row) {
        row.addEventListener('click', function () {
            const e = eventLog[parseInt(row.dataset.idx, 10)];
            if (e.type === 'driver') { selectDriver(e.id); } else { selectJob(e.id); }
        });
    });
}

function renderSummaryCards() {
    const total = allDrivers.length;
    const online = allDrivers.filter(function (d) { return driverStatus(d) === 'online'; }).length;
    const busy = allDrivers.filter(function (d) { return driverStatus(d) === 'busy' || driverStatus(d) === 'attention'; }).length;
    const offline = allDrivers.filter(function (d) { return driverStatus(d) === 'offline'; }).length;
    const active = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; }).length;

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('summaryCards').innerHTML =
        card('Total Drivers', total) + card('Online', online) + card('Busy', busy) + card('Offline', offline) + card('Active Deliveries', active);
}

function renderDriverList() {
    const el = document.getElementById('driverList');
    const q = document.getElementById('driverSearch').value.trim().toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const vehicleFilter = document.getElementById('vehicleFilter').value;

    let list = allDrivers.filter(function (d) {
        if (q) {
            const hay = ((d.full_name || '') + ' ' + (d.phone || '') + ' ' + d.id).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        if (vehicleFilter && d.vehicle_class !== vehicleFilter) return false;
        if (statusFilter) {
            const s = driverStatus(d);
            if (statusFilter === 'busy' && s !== 'busy' && s !== 'attention') return false;
            if (statusFilter !== 'busy' && s !== statusFilter) return false;
        }
        return true;
    });

    if (!allDrivers.length) { el.innerHTML = '<div class="empty">No drivers online.</div>'; return; }
    if (!list.length) { el.innerHTML = '<div class="empty">No drivers match your search.</div>'; return; }

    const dotColor = { online: '#1E8E3E', busy: '#1A73E8', offline: '#8891A0', attention: '#E8A33D' };

    el.innerHTML = list.map(function (d) {
        const status = driverStatus(d);
        const job = activeJobForDriver(d.id);
        return '<div class="driver-row' + (d.id === selectedDriverId ? ' selected' : '') + '" data-driver="' + d.id + '">' +
            '<span class="status-dot-inline" style="background:' + dotColor[status] + ';"></span><b>' + escapeHtml(d.full_name || d.id) + '</b>' +
            '<div class="meta">' + vehicleLabel(d.vehicle_class) + ' · ' + status + '</div>' +
            (job ? '<div class="meta">Job ' + job.id.slice(0, 8) + ' · ' + job.status + '</div>' : '') +
            '<div class="meta">Last seen: ' + (d.last_seen_at ? formatTime(d.last_seen_at) : 'never') + '</div>' +
            '</div>';
    }).join('');

    el.querySelectorAll('.driver-row').forEach(function (row) {
        row.addEventListener('click', function () { selectDriver(row.dataset.driver); });
    });
}

function renderMap() {
    const seenDrivers = {};
    const dotColor = { online: '#1E8E3E', busy: '#1A73E8', offline: '#8891A0', attention: '#E8A33D' };
    const dotEmoji = { online: '🟢', busy: '🔵', offline: '⚪', attention: '🟠' };

    allDrivers.forEach(function (d) {
        if (!d.last_lat || !d.last_lng) return;
        // Only show a driver on the map while they're actually live — not
        // just toggled Online with stale/no recent GPS. A driver mid-
        // delivery stays visible through a brief GPS hiccup (flagged
        // 'attention' by driverStatus) since losing the pin during an
        // active job would be worse than a stale one.
        const job = activeJobForDriver(d.id);
        if (!job && !isLive(d)) return;
        const status = driverStatus(d);
        seenDrivers[d.id] = true;
        const pos = [d.last_lat, d.last_lng];
        recordTrailPoint(d.id, pos);
        if (driverMarkers[d.id]) {
            driverMarkers[d.id].setLatLng(pos);
            driverMarkers[d.id].setIcon(dotEmoji[status]);
        } else {
            driverMarkers[d.id] = GoogleMaps.createMarker(fleetMap, pos, dotEmoji[status]);
            driverMarkers[d.id].on('click', function () { selectDriver(d.id); });
        }
        driverMarkers[d.id].bindPopup(popupForDriver(d, status));
    });
    Object.keys(driverMarkers).forEach(function (id) {
        if (!seenDrivers[id]) { driverMarkers[id].remove(); delete driverMarkers[id]; }
    });

    renderSelectedTrail();
    if (followSelected && selectedDriverId && seenDrivers[selectedDriverId]) {
        const d = allDrivers.find(function (x) { return x.id === selectedDriverId; });
        if (d && d.last_lat && d.last_lng) fleetMap.setCenter({ lat: d.last_lat, lng: d.last_lng });
    }

    const seenJobs = {};
    const activeJobs = allJobs.filter(function (j) { return j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    activeJobs.forEach(function (j) {
        if (j.pickup_lat && j.pickup_lng) {
            const key = j.id + '-pickup';
            seenJobs[key] = true;
            if (!jobMarkers[key]) {
                jobMarkers[key] = GoogleMaps.createMarker(fleetMap, [j.pickup_lat, j.pickup_lng], '📦');
                jobMarkers[key].on('click', function () { selectJob(j.id); });
            }
            jobMarkers[key].bindPopup(popupForJob(j));
        }
        if (j.dropoff_lat && j.dropoff_lng) {
            const key = j.id + '-dropoff';
            seenJobs[key] = true;
            if (!jobMarkers[key]) {
                jobMarkers[key] = GoogleMaps.createMarker(fleetMap, [j.dropoff_lat, j.dropoff_lng], '🏁');
                jobMarkers[key].on('click', function () { selectJob(j.id); });
            }
            jobMarkers[key].bindPopup(popupForJob(j));
        }

        const lineKey = j.id;
        if (j.driver_lat && j.driver_lng) {
            let dest = null, color = null;
            if (j.status === 'to_pickup' && j.pickup_lat && j.pickup_lng) { dest = [j.pickup_lat, j.pickup_lng]; color = '#1A73E8'; }
            else if (j.status === 'to_dropoff' && j.dropoff_lat && j.dropoff_lng) { dest = [j.dropoff_lat, j.dropoff_lng]; color = '#1E8E3E'; }
            if (dest) {
                seenJobs['line-' + lineKey] = true;
                const points = [[j.driver_lat, j.driver_lng], dest];
                if (routeLines[lineKey]) { routeLines[lineKey].setLatLngs(points); routeLines[lineKey].setStyle({ color: color }); }
                else { routeLines[lineKey] = GoogleMaps.createPolyline(fleetMap, points, color, 3); }
            }
        }
    });
    Object.keys(jobMarkers).forEach(function (key) {
        if (!seenJobs[key]) { jobMarkers[key].remove(); delete jobMarkers[key]; }
    });
    Object.keys(routeLines).forEach(function (key) {
        if (!seenJobs['line-' + key]) { routeLines[key].remove(); delete routeLines[key]; }
    });
}

function popupForDriver(d, status) {
    const job = activeJobForDriver(d.id);
    return '<b>' + escapeHtml(d.full_name || '') + '</b><br>' +
        escapeHtml(d.phone || '') + ' · ' + vehicleLabel(d.vehicle_class) + '<br>' +
        'Status: ' + status + '<br>' +
        (job ? 'Job: ' + job.pickup + ' → ' + job.dropoff + '<br>ETA: ' + computeEta(job) + '<br>' : '') +
        'Last seen: ' + formatTime(d.last_seen_at);
}

function popupForJob(j) {
    const customer = profilesById[j.customer_id];
    const driver = profilesById[j.driver_id];
    return '<b>Job ' + j.id.slice(0, 8) + '</b><br>' +
        (customer ? 'Customer: ' + escapeHtml(customer.full_name) + '<br>' : '') +
        'Pickup: ' + escapeHtml(j.pickup) + '<br>Drop-off: ' + escapeHtml(j.dropoff) + '<br>' +
        'Driver: ' + escapeHtml(driver ? driver.full_name : '—') + '<br>' +
        'Status: ' + j.status + '<br>ETA: ' + computeEta(j);
}

function kv(label, value) {
    return '<div class="kv-row"><span>' + label + '</span><span>' + escapeHtml(value === 0 ? '0' : (value || '—')) + '</span></div>';
}

function selectDriver(driverId) {
    if (selectedDriverId !== driverId) followSelected = false;
    selectedDriverId = driverId;
    selectedJobId = null;
    const d = allDrivers.find(function (x) { return x.id === driverId; });
    if (d && d.last_lat && d.last_lng) GoogleMaps.setView(fleetMap, [d.last_lat, d.last_lng], 13);
    if (driverMarkers[driverId]) driverMarkers[driverId].openPopup();
    renderDriverList();
    renderDriverDetails(driverId);
    renderSelectedTrail();
}

function toggleFollowSelected() {
    followSelected = !followSelected;
    renderDriverDetails(selectedDriverId);
}

function selectJob(jobId) {
    followSelected = false;
    selectedJobId = jobId;
    selectedDriverId = null;
    const j = allJobs.find(function (x) { return x.id === jobId; });
    if (j && j.pickup_lat && j.pickup_lng) GoogleMaps.setView(fleetMap, [j.pickup_lat, j.pickup_lng], 13);
    renderJobDetails(jobId);
    renderSelectedTrail();
}

function driverStatsToday(driverId) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const delivered = allJobs.filter(function (j) { return j.driver_id === driverId && j.status === 'delivered' && j.delivered_at; });
    const deliveredToday = delivered.filter(function (j) { return new Date(j.delivered_at) >= todayStart; });
    const earningsToday = deliveredToday.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const rated = allJobs.filter(function (j) { return j.driver_id === driverId && j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;
    return { deliveredToday: deliveredToday.length, earningsToday: earningsToday, avgRating: avgRating };
}

function renderDriverDetails(driverId) {
    const d = allDrivers.find(function (x) { return x.id === driverId; });
    const panel = document.getElementById('detailsPanel');
    if (!d) { panel.innerHTML = '<h2 style="margin-top:0;">Details</h2><div class="empty">Driver not found.</div>'; return; }
    const job = activeJobForDriver(d.id);
    const customer = job ? profilesById[job.customer_id] : null;
    const stats = driverStatsToday(d.id);
    const status = driverStatus(d);
    const callLink = d.phone ? 'tel:' + d.phone : null;
    const waLink = whatsappLink(d.phone, 'Ekoquick — checking in.');

    panel.innerHTML =
        '<h2 style="margin-top:0;">Driver</h2>' +
        kv('Name', d.full_name) + kv('Phone', d.phone) + kv('Vehicle', vehicleLabel(d.vehicle_class)) + kv('Status', status) +
        '<h3 style="font-size:11px; color:var(--muted-dim); margin:14px 0 6px; text-transform:uppercase;">Current Job</h3>' +
        (job ? kv('Job ID', job.id.slice(0, 8)) + kv('Customer', customer ? customer.full_name : '—') + kv('Pickup', job.pickup) + kv('Drop-off', job.dropoff) + kv('ETA', computeEta(job)) + kv('Status', job.status) : '<div class="meta">No active job.</div>') +
        '<h3 style="font-size:11px; color:var(--muted-dim); margin:14px 0 6px; text-transform:uppercase;">Performance</h3>' +
        kv('Rating', stats.avgRating ? stats.avgRating.toFixed(1) + ' ★' : 'No ratings yet') +
        kv('Deliveries Today', stats.deliveredToday) + kv('Earnings Today', 'R' + stats.earningsToday.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        '<h3 style="font-size:11px; color:var(--muted-dim); margin:14px 0 6px; text-transform:uppercase;">Location</h3>' +
        kv('Coordinates', d.last_lat && d.last_lng ? d.last_lat.toFixed(5) + ', ' + d.last_lng.toFixed(5) : 'No GPS data') +
        kv('Last Seen', formatTime(d.last_seen_at)) +
        kv('Trail points', (driverTrails[d.id] || []).length) +
        '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
            (callLink ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="' + callLink + '">Call Driver</a>' : '') +
            (waLink ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" target="_blank" href="' + waLink + '">Message</a>' : '') +
            '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="admin-drivers.html?driver=' + d.id + '">Driver Profile</a>' +
            (job ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="admin-jobs.html?job=' + job.id + '">View Job</a>' : '') +
            '<button type="button" class="btn ' + (followSelected ? 'btn-blue' : 'btn-outline-blue') + '" style="width:auto;" id="followDriverBtn">' + (followSelected ? '📍 Following…' : '📍 Follow on Map') + '</button>' +
        '</div>';
    const followBtn = document.getElementById('followDriverBtn');
    if (followBtn) followBtn.addEventListener('click', toggleFollowSelected);
}

function renderJobDetails(jobId) {
    const j = allJobs.find(function (x) { return x.id === jobId; });
    const panel = document.getElementById('detailsPanel');
    if (!j) { panel.innerHTML = '<h2 style="margin-top:0;">Details</h2><div class="empty">Job not found.</div>'; return; }
    const customer = profilesById[j.customer_id];
    const driver = profilesById[j.driver_id];
    const custWaLink = whatsappLink(j.customer_phone, 'Ekoquick — regarding your order ' + j.id.slice(0, 8) + '.');
    const driverWaLink = driver ? whatsappLink(driver.phone, 'Ekoquick — regarding order ' + j.id.slice(0, 8) + '.') : null;

    panel.innerHTML =
        '<h2 style="margin-top:0;">Job ' + j.id.slice(0, 8) + '</h2>' +
        kv('Customer', customer ? customer.full_name : '—') +
        kv('Pickup', j.pickup) + kv('Drop-off', j.dropoff) +
        kv('Assigned Driver', driver ? driver.full_name : '—') +
        kv('Status', j.status) + kv('ETA', computeEta(j)) +
        '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
            '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="admin-jobs.html?job=' + j.id + '">Open Job Details</a>' +
            (custWaLink ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" target="_blank" href="' + custWaLink + '">Contact Customer</a>' : '') +
            (driverWaLink ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" target="_blank" href="' + driverWaLink + '">Contact Driver</a>' : '') +
        '</div>';
}
