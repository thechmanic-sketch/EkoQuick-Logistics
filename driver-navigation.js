let currentUser = null;
let currentProfile = null;
let job = null;
let map = null;
let driverMarker = null;
let destMarker = null;
let routeLine = null;
let watchId = null;
let lastPos = null;
let lastRouteAt = 0;

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

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    await loadDriverShare();
    await loadCommissionRules();

    document.getElementById('recenterBtn').addEventListener('click', recenter);
    document.getElementById('fullscreenBtn').addEventListener('click', function () {
        const el = document.getElementById('navMap');
        if (document.fullscreenElement) document.exitFullscreen();
        else el.requestFullscreen && el.requestFullscreen();
    });
    document.getElementById('contactDispatchBtn').addEventListener('click', function () {
        window.open('https://wa.me/27676659966?text=' + encodeURIComponent('Dispatch, I need assistance with job ' + (job ? job.id.slice(0, 8) : '') + '.'), '_blank', 'noopener');
    });
    document.getElementById('emergencyCallBtn').addEventListener('click', function () {
        alert('For life-threatening emergencies, call your local emergency services number directly. This app does not connect to emergency services.');
    });
    document.getElementById('reportAccidentBtn').addEventListener('click', function () { fileIncident('accident_report', 'Accident'); });
    document.getElementById('breakdownBtn').addEventListener('click', function () { fileIncident('vehicle_breakdown', 'Vehicle Breakdown'); });
    document.getElementById('clearSigBtn').addEventListener('click', function () {
        const canvas = document.getElementById('sigCanvas');
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    });
    wireSignaturePad(document.getElementById('sigCanvas'));

    await loadJob();
    beginTracking();

    supabase.channel('driver-nav-' + currentUser.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'driver_id=eq.' + currentUser.id }, loadJob)
        .subscribe();
});

async function loadJob() {
    const jobIdParam = new URLSearchParams(window.location.search).get('job');
    let data;
    if (jobIdParam) {
        const res = await supabase.from('jobs').select('*').eq('id', jobIdParam).eq('driver_id', currentUser.id).single();
        data = res.data;
    } else {
        const res = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).in('status', ['to_pickup', 'to_dropoff']).order('created_at', { ascending: false }).limit(1);
        data = res.data && res.data[0];
    }

    if (!data || (data.status !== 'to_pickup' && data.status !== 'to_dropoff')) {
        document.getElementById('jobRoute').textContent = 'No active delivery to navigate.';
        document.getElementById('actionPanel').innerHTML = '<a class="btn btn-outline-blue" href="driver-dashboard.html">Back to Dashboard</a>';
        return;
    }
    job = data;
    document.getElementById('needHelpBtn').href = 'driver-admin-chat.html?delivery=' + job.id;
    render();
}

function destCoords() {
    return job.status === 'to_pickup'
        ? { lat: job.pickup_lat, lng: job.pickup_lng, label: 'Pickup' }
        : { lat: job.dropoff_lat, lng: job.dropoff_lng, label: 'Destination' };
}

function render() {
    const dest = destCoords();
    const remainingKm = (lastPos && dest.lat && dest.lng) ? haversineKm(lastPos.lat, lastPos.lng, dest.lat, dest.lng) : null;
    const etaMin = remainingKm !== null ? Math.round((remainingKm / 30) * 60) : null;

    document.getElementById('jobRoute').textContent = 'Job ' + job.id.slice(0, 8) + ' — ' + job.pickup + ' → ' + job.dropoff;
    document.getElementById('statusText').textContent = job.status === 'to_pickup' ? (job.arrived_at_pickup_at ? 'Arrived at Pickup' : 'Heading to Pickup') : (job.arrived_at_dropoff_at ? 'Arrived at Destination' : 'Heading to Destination');
    document.getElementById('etaText').textContent = 'ETA: ' + (etaMin !== null ? etaMin + ' min' : '—');
    document.getElementById('distanceText').textContent = 'Distance: ' + (remainingKm !== null ? remainingKm.toFixed(1) + ' km' : '—');

    initMap();
    if (dest.lat && dest.lng) {
        const pos = [dest.lat, dest.lng];
        if (!destMarker) destMarker = L.marker(pos, { icon: L.divIcon({ html: '📍', className: 'driver-marker', iconSize: [26, 26] }) }).addTo(map);
        else destMarker.setLatLng(pos);
    }

    renderCustomerPanel();
    renderActionPanel();
}

function renderCustomerPanel() {
    const panel = document.getElementById('customerPanel');
    const label = job.status === 'to_pickup'
        ? 'Customer: ' + (job.sender_name || '—') + (job.customer_phone ? ' · ' + job.customer_phone : '')
        : 'Recipient: ' + (job.receiver_name || '—') + (job.receiver_phone ? ' · ' + job.receiver_phone : '');
    panel.innerHTML = escapeHtml(label) + ' <a class="btn btn-blue" style="width:auto; margin-left:8px;" href="chat.html?job=' + job.id + '">💬 Chat</a>';
    panel.classList.remove('hidden');
}

function renderActionPanel() {
    const panel = document.getElementById('actionPanel');
    const extras = document.getElementById('completionExtras');
    extras.classList.add('hidden');

    const custDigits = (job.customer_phone || '').replace(/\D/g, '');
    const recipDigits = (job.receiver_phone || '').replace(/\D/g, '');

    if (job.status === 'to_pickup' && !job.arrived_at_pickup_at) {
        panel.innerHTML =
            '<button class="btn btn-blue" id="startNavBtn">Focus Route on Map</button>' +
            '<button class="btn btn-blue" id="arrivedBtn">I\'ve Arrived</button>' +
            '<a class="btn btn-outline-blue" id="externalNavLink" href="#" style="width:auto;">Open in Google Maps ↗</a>';
        document.getElementById('startNavBtn').addEventListener('click', focusRoute);
        document.getElementById('externalNavLink').addEventListener('click', openExternalNav);
        document.getElementById('arrivedBtn').addEventListener('click', function () { setArrived('arrived_at_pickup_at'); });
    } else if (job.status === 'to_pickup' && job.arrived_at_pickup_at) {
        panel.innerHTML =
            '<label style="width:100%;">Pickup code (optional)</label>' +
            '<input class="field-plain" id="collectionInput" placeholder="4-digit code" style="width:100%;">' +
            '<div class="msg error hidden" id="collectionError" style="width:100%;"></div>' +
            '<button class="btn btn-blue" id="pickedUpBtn">Parcel Picked Up</button>' +
            (custDigits ? '<a class="btn btn-outline-blue" href="tel:' + escapeHtml(job.customer_phone) + '">Call Customer</a>' : '');
        document.getElementById('pickedUpBtn').addEventListener('click', confirmPickup);
    } else if (job.status === 'to_dropoff' && !job.arrived_at_dropoff_at) {
        panel.innerHTML =
            '<button class="btn btn-blue" id="startNavBtn">Focus Route on Map</button>' +
            (recipDigits ? '<a class="btn btn-outline-blue" href="tel:' + escapeHtml(job.receiver_phone) + '">Call Recipient</a>' : '') +
            '<button class="btn btn-blue" id="arrivedBtn">I\'ve Arrived</button>' +
            '<a class="btn btn-outline-blue" id="externalNavLink" href="#" style="width:auto;">Open in Google Maps ↗</a>';
        document.getElementById('startNavBtn').addEventListener('click', focusRoute);
        document.getElementById('externalNavLink').addEventListener('click', openExternalNav);
        document.getElementById('arrivedBtn').addEventListener('click', function () { setArrived('arrived_at_dropoff_at'); });
    } else if (job.status === 'to_dropoff' && job.arrived_at_dropoff_at) {
        panel.innerHTML =
            '<label style="width:100%;">Delivery code</label>' +
            '<input class="field-plain" id="deliveryInput" placeholder="4-digit code" style="width:100%;">' +
            '<div class="msg error hidden" id="deliveryError" style="width:100%;"></div>' +
            '<button class="btn btn-blue" id="completeBtn">Complete Delivery</button>';
        extras.classList.remove('hidden');
        document.getElementById('completeBtn').addEventListener('click', completeDelivery);
    }
}

// Keeps the driver in-app: re-centers the map on the live route immediately
// instead of waiting for the next periodic refresh.
function focusRoute() {
    recenter();
    const dest = destCoords();
    if (lastPos && dest.lat && dest.lng) {
        lastRouteAt = 0; // force fetchRoute() to run again right away
        fetchRoute(lastPos.lat, lastPos.lng, dest.lat, dest.lng).then(function (latlngs) {
            if (!latlngs) return;
            if (routeLine) map.removeLayer(routeLine);
            routeLine = L.polyline(latlngs, { color: '#FF6A2B', weight: 4 }).addTo(map);
        });
    }
}

// Opens turn-by-turn navigation in the Google Maps app — leaving Ekoquick
// open in the background usually pauses this page's live location updates
// (mobile browsers throttle background tabs), so the customer/admin live
// map will stop moving until the driver returns to this tab. Offered as an
// explicit opt-in for drivers who want voice-guided turn-by-turn, not the
// default action.
function openExternalNav(e) {
    if (e) e.preventDefault();
    const dest = destCoords();
    if (!dest.lat || !dest.lng) { alert('No coordinates available for this destination yet.'); return; }
    if (!confirm('This opens Google Maps outside Ekoquick. Your live location may stop updating for the customer until you return to this tab. Continue?')) return;
    window.open(mapsDirectionsUrl(dest.lat, dest.lng), '_blank', 'noopener');
}

async function setArrived(field) {
    const fields = {};
    fields[field] = new Date().toISOString();
    await supabase.from('jobs').update(fields).eq('id', job.id);
    await loadJob();
}

async function confirmPickup() {
    const { data: j } = await supabase.from('jobs').select('collection_code').eq('id', job.id).single();
    const entered = (document.getElementById('collectionInput').value || '').trim();
    if (j && j.collection_code && entered !== j.collection_code) {
        const el = document.getElementById('collectionError');
        el.textContent = 'Incorrect pickup code.'; el.classList.remove('hidden');
        return;
    }
    await supabase.from('jobs').update({ status: 'to_dropoff', to_dropoff_at: new Date().toISOString() }).eq('id', job.id);
    await loadJob();
}

async function completeDelivery() {
    const { data: j } = await supabase.from('jobs').select('delivery_code, payment_method').eq('id', job.id).single();
    const entered = (document.getElementById('deliveryInput').value || '').trim();
    if (j && j.delivery_code && entered !== j.delivery_code) {
        const el = document.getElementById('deliveryError');
        el.textContent = 'Incorrect delivery code.'; el.classList.remove('hidden');
        return;
    }

    const fields = { status: 'delivered', delivered_at: new Date().toISOString() };
    if (j && j.payment_method === 'cash') fields.payment_status = 'paid';
    if (lastPos) { fields.delivery_photo_lat = lastPos.lat; fields.delivery_photo_lng = lastPos.lng; }

    const canvas = document.getElementById('sigCanvas');
    const sigDataUrl = canvas.toDataURL('image/png');
    const blankUrl = document.createElement('canvas').toDataURL('image/png');
    if (sigDataUrl !== blankUrl) {
        const sigBlob = await (await fetch(sigDataUrl)).blob();
        const sigPath = currentUser.id + '/' + job.id + '-signature-' + Date.now() + '.png';
        const { error: sigErr } = await supabase.storage.from('delivery-proofs').upload(sigPath, sigBlob);
        if (!sigErr) fields.delivery_signature_url = supabase.storage.from('delivery-proofs').getPublicUrl(sigPath).data.publicUrl;
    }

    const photoInput = document.getElementById('photoInput');
    if (photoInput.files && photoInput.files[0]) {
        const file = photoInput.files[0];
        const path = currentUser.id + '/' + job.id + '-photo-' + Date.now() + '.' + file.name.split('.').pop();
        const { error: photoErr } = await supabase.storage.from('delivery-proofs').upload(path, file);
        if (!photoErr) fields.delivery_photo_url = supabase.storage.from('delivery-proofs').getPublicUrl(path).data.publicUrl;
    }

    const { error } = await supabase.from('jobs').update(fields).eq('id', job.id);
    if (error) { alert('Failed to complete delivery: ' + error.message); return; }
    stopTracking();
    window.location.href = 'driver-dashboard.html';
}

async function fileIncident(incidentType, label) {
    const description = prompt('Briefly describe the ' + label.toLowerCase() + ':');
    if (!description) return;
    await supabase.from('support_tickets').insert({
        driver_id: currentUser.id, job_id: job ? job.id : null, category: incidentType, priority: 'urgent',
        subject: label + ' report' + (job ? ' — job ' + job.id.slice(0, 8) : ''),
        description: description, incident_type: incidentType, incident_at: new Date().toISOString(),
        incident_lat: lastPos ? lastPos.lat : null, incident_lng: lastPos ? lastPos.lng : null,
    });
    alert(label + ' reported to dispatch.');
}

function wireSignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    function pos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
    }
    function start(e) { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
    function end() { drawing = false; }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start);
    canvas.addEventListener('touchmove', move);
    canvas.addEventListener('touchend', end);
}

function initMap() {
    if (map) return;
    map = L.map('navMap', { zoomControl: true }).setView([-29.6, 30.9], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
}

function recenter() {
    if (!map) return;
    const dest = destCoords();
    const pts = [];
    if (lastPos) pts.push([lastPos.lat, lastPos.lng]);
    if (dest.lat && dest.lng) pts.push([dest.lat, dest.lng]);
    if (pts.length === 1) map.setView(pts[0], 14);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30] });
}

function beginTracking() {
    if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
        async function (pos) {
            lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            const speedKmh = pos.coords.speed !== null && pos.coords.speed !== undefined ? Math.round(pos.coords.speed * 3.6) : null;
            document.getElementById('speedText').textContent = 'Speed: ' + (speedKmh !== null ? speedKmh + ' km/h' : '—');

            if (job) {
                await supabase.from('jobs').update({ driver_lat: lastPos.lat, driver_lng: lastPos.lng }).eq('id', job.id);
                render();

                if (!driverMarker) driverMarker = L.marker([lastPos.lat, lastPos.lng], { icon: L.divIcon({ html: '🚚', className: 'driver-marker', iconSize: [30, 30] }) }).addTo(map);
                else driverMarker.setLatLng([lastPos.lat, lastPos.lng]);
                recenter();

                const dest = destCoords();
                const now = Date.now();
                if (dest.lat && dest.lng && now - lastRouteAt > 20000) {
                    lastRouteAt = now;
                    fetchRoute(lastPos.lat, lastPos.lng, dest.lat, dest.lng).then(function (latlngs) {
                        if (!latlngs) return;
                        if (routeLine) map.removeLayer(routeLine);
                        routeLine = L.polyline(latlngs, { color: '#FF6A2B', weight: 4 }).addTo(map);
                    });
                }
            }
        },
        function () { /* best-effort */ },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
}
function stopTracking() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

async function fetchRoute(lat1, lng1, lat2, lng2) {
    try {
        const url = 'https://router.project-osrm.org/route/v1/driving/' + lng1 + ',' + lat1 + ';' + lng2 + ',' + lat2 + '?overview=full&geometries=geojson';
        const res = await fetch(url);
        const data = await res.json();
        const coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
        if (!coords) return null;
        return coords.map(function (c) { return [c[1], c[0]]; });
    } catch (err) { return null; }
}
