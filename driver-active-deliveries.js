let currentUser = null;
let currentProfile = null;
let allJobs = [];
let watchId = null;
let lastPos = null;
const jobMaps = {};

const STATUS_LABELS = { to_pickup: 'Heading to Pickup', to_dropoff: 'Heading to Destination' };

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;

    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    await loadDriverShare();
    await loadCommissionRules();

    document.getElementById('onlineStatusLine').textContent = currentProfile.is_online ? 'You are Online' : 'You are Offline';
    document.getElementById('refreshBtn').addEventListener('click', loadAll);

    await loadAll();

    supabase.channel('driver-active-' + currentUser.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'driver_id=eq.' + currentUser.id }, loadAll)
        .subscribe();
});

async function loadAll() {
    const { data } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false });
    allJobs = data || [];
    renderSummary();
    renderList();

    const active = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    if (active.length) beginTracking();
    else stopTracking();
}

function renderSummary() {
    const active = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    const today = startOfDay();
    const deliveredToday = allJobs.filter(function (j) { return j.status === 'delivered' && j.delivered_at && new Date(j.delivered_at) >= today; });
    const earningsToday = deliveredToday.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);

    const notArrived = active.filter(function (j) { return j.status === 'to_pickup' && !j.arrived_at_pickup_at; });
    const nextPickup = notArrived.length ? notArrived[0].pickup : (active.length ? '—' : '—');

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + active.length + '</div><div class="lbl">Active Deliveries</div></div>' +
        '<div class="summary-card"><div class="num" style="font-size:14px;">' + escapeHtml(nextPickup) + '</div><div class="lbl">Next Pickup</div></div>' +
        '<div class="summary-card"><div class="num">' + deliveredToday.length + '</div><div class="lbl">Deliveries Completed Today</div></div>' +
        '<div class="summary-card"><div class="num">R' + earningsToday.toFixed(0) + '</div><div class="lbl">Today\'s Earnings</div></div>';
}

function computeRemainingKm(job) {
    const destLat = job.status === 'to_pickup' ? job.pickup_lat : job.dropoff_lat;
    const destLng = job.status === 'to_pickup' ? job.pickup_lng : job.dropoff_lng;
    if (!job.driver_lat || !job.driver_lng || !destLat || !destLng) return null;
    return haversineKm(job.driver_lat, job.driver_lng, destLat, destLng);
}

function renderList() {
    destroyAllJobMaps();
    const active = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    const wrap = document.getElementById('jobList');
    const empty = document.getElementById('emptyState');

    if (!active.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    wrap.innerHTML = active.map(function (job) { return renderJobCard(job); }).join('');
    wireJobCard();

    active.forEach(function (job) {
        const arrivedPickup = !!job.arrived_at_pickup_at;
        const arrivedDropoff = !!job.arrived_at_dropoff_at;
        if (job.status === 'to_pickup' && !arrivedPickup && job.pickup_lat && job.pickup_lng) ensureJobMap(job.id, job.pickup_lat, job.pickup_lng);
        else if (job.status === 'to_dropoff' && !arrivedDropoff && job.dropoff_lat && job.dropoff_lng) ensureJobMap(job.id, job.dropoff_lat, job.dropoff_lng);
    });
}

function renderJobCard(job) {
    const remainingKm = computeRemainingKm(job);
    const etaMin = remainingKm !== null ? Math.round((remainingKm / 30) * 60) : null;
    const arrivedPickup = !!job.arrived_at_pickup_at;
    const arrivedDropoff = !!job.arrived_at_dropoff_at;
    const custDigits = (job.customer_phone || '').replace(/\D/g, '');
    const recipDigits = (job.receiver_phone || '').replace(/\D/g, '');
    const pickupContactDigits = (job.pickup_contact_phone || job.customer_phone || '').replace(/\D/g, '');

    let actionArea = '';
    if (job.status === 'to_pickup' && !arrivedPickup) {
        const navUrl = job.pickup_lat && job.pickup_lng ? mapsDirectionsUrl(job.pickup_lat, job.pickup_lng) : null;
        actionArea =
            (job.pickup_lat && job.pickup_lng ? '<div id="jobMap-' + job.id + '" style="height: 160px; border: 1px solid var(--line); margin-bottom: 10px;"></div>' : '') +
            '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
                (navUrl ? '<a class="btn btn-outline-blue" style="width:auto;" href="' + navUrl + '" target="_blank" rel="noopener">Open Navigation</a>' : '') +
                (pickupContactDigits ? '<a class="btn btn-outline-blue" style="width:auto;" href="tel:' + escapeHtml(job.pickup_contact_phone || job.customer_phone) + '">Call Pickup Contact</a>' : '') +
                '<a class="btn btn-blue" style="width:auto;" href="chat.html?job=' + job.id + '">💬 Chat</a>' +
                (custDigits ? '<a class="btn btn-outline-blue" style="width:auto;" target="_blank" rel="noopener" href="https://wa.me/' + custDigits + '?text=' + encodeURIComponent('Hi, this is your Ekoquick driver.') + '">WhatsApp Customer</a>' : '') +
                '<button class="btn btn-blue" style="width:auto;" data-job="' + job.id + '" data-action="arrived-pickup">I\'ve Arrived</button>' +
            '</div>';
    } else if (job.status === 'to_pickup' && arrivedPickup) {
        actionArea =
            '<label>Pickup code (ask the sender)</label>' +
            '<input class="field-plain" id="collectionInput-' + job.id + '" placeholder="4-digit code">' +
            '<div class="msg error hidden" id="collectionError-' + job.id + '"></div>' +
            '<button class="btn btn-blue" data-job="' + job.id + '" data-action="confirm-pickup">Parcel Picked Up</button>';
    } else if (job.status === 'to_dropoff' && !arrivedDropoff) {
        const navUrl = job.dropoff_lat && job.dropoff_lng ? mapsDirectionsUrl(job.dropoff_lat, job.dropoff_lng) : null;
        actionArea =
            (job.dropoff_lat && job.dropoff_lng ? '<div id="jobMap-' + job.id + '" style="height: 160px; border: 1px solid var(--line); margin-bottom: 10px;"></div>' : '') +
            '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
                (navUrl ? '<a class="btn btn-outline-blue" style="width:auto;" href="' + navUrl + '" target="_blank" rel="noopener">Open Navigation</a>' : '') +
                (recipDigits ? '<a class="btn btn-outline-blue" style="width:auto;" href="tel:' + escapeHtml(job.receiver_phone) + '">Call Recipient</a>' : '') +
                '<a class="btn btn-blue" style="width:auto;" href="chat.html?job=' + job.id + '">💬 Chat</a>' +
                (recipDigits ? '<a class="btn btn-outline-blue" style="width:auto;" target="_blank" rel="noopener" href="https://wa.me/' + recipDigits + '?text=' + encodeURIComponent('Hi, this is your Ekoquick driver, on my way with your delivery.') + '">WhatsApp Recipient</a>' : '') +
                '<button class="btn btn-blue" style="width:auto;" data-job="' + job.id + '" data-action="arrived-dropoff">I\'ve Arrived</button>' +
            '</div>';
    } else if (job.status === 'to_dropoff' && arrivedDropoff) {
        actionArea =
            '<label>Delivery code (ask the receiver)</label>' +
            '<input class="field-plain" id="deliveryInput-' + job.id + '" placeholder="4-digit code">' +
            '<div class="msg error hidden" id="deliveryError-' + job.id + '"></div>' +
            '<label style="margin-top:8px;">Delivery Photo (optional)</label>' +
            '<input type="file" id="photoInput-' + job.id + '" accept="image/*" capture="environment" class="field-plain">' +
            '<label>Customer Signature</label>' +
            '<canvas id="sigCanvas-' + job.id + '" width="280" height="100" style="border:1px solid var(--line); background:#fff; width:100%; touch-action:none;"></canvas>' +
            '<button type="button" class="btn btn-outline-blue" style="width:auto; margin-top:4px;" data-action="clear-sig" data-job="' + job.id + '">Clear Signature</button>' +
            '<button class="btn btn-blue" style="margin-top:8px;" data-job="' + job.id + '" data-action="complete">Complete Delivery</button>';
    }

    return '<div class="job-card">' +
        '<div class="meta">Job ' + job.id.slice(0, 8) + '</div>' +
        '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
        '<div class="meta">Customer: ' + escapeHtml(job.sender_name || '') + (job.customer_phone ? ' · ' + escapeHtml(job.customer_phone) : '') + '</div>' +
        '<div class="meta">Recipient: ' + escapeHtml(job.receiver_name || '') + (job.receiver_phone ? ' · ' + escapeHtml(job.receiver_phone) : '') + '</div>' +
        '<span class="badge in_progress">' + (arrivedPickup && job.status === 'to_pickup' ? 'Arrived at Pickup' : arrivedDropoff && job.status === 'to_dropoff' ? 'Arrived at Destination' : STATUS_LABELS[job.status]) + '</span>' +
        '<div class="meta" style="margin-top:6px;">ETA: ' + (etaMin !== null ? etaMin + ' min' : '—') + ' · Remaining distance: ' + (remainingKm !== null ? remainingKm.toFixed(1) + ' km' : '—') + ' · Vehicle: ' + escapeHtml(job.vehicle || '') + '</div>' +
        '<div style="margin-top:10px;">' + actionArea + '</div>' +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-details" data-job="' + job.id + '">View Details</button>' +
            '<a class="btn btn-outline-blue" style="width:auto;" href="driver-navigation.html?job=' + job.id + '">Full-Screen Navigation</a>' +
        '</div>' +
        '<div class="details-row" id="details-' + job.id + '"></div>' +
        renderEmergencyRow(job) +
    '</div>';
}

function renderEmergencyRow(job) {
    return '<div class="emergency-row">' +
        '<button class="emergency-btn" data-job="' + job.id + '" data-action="report-issue">Report Issue</button>' +
        '<button class="emergency-btn" data-job="' + job.id + '" data-action="contact-dispatch">Contact Dispatch</button>' +
        '<button class="emergency-btn" data-job="' + job.id + '" data-action="emergency">Emergency Assistance</button>' +
    '</div>';
}

function wireJobCard() {
    document.querySelectorAll('button[data-action="arrived-pickup"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setArrived(btn.dataset.job, 'arrived_at_pickup_at'); });
    });
    document.querySelectorAll('button[data-action="arrived-dropoff"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setArrived(btn.dataset.job, 'arrived_at_dropoff_at'); });
    });
    document.querySelectorAll('button[data-action="confirm-pickup"]').forEach(function (btn) {
        btn.addEventListener('click', function () { confirmPickup(btn.dataset.job); });
    });
    document.querySelectorAll('button[data-action="complete"]').forEach(function (btn) {
        btn.addEventListener('click', function () { completeDelivery(btn.dataset.job); });
    });
    document.querySelectorAll('button[data-action="toggle-details"]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleDetails(btn.dataset.job); });
    });
    document.querySelectorAll('button[data-action="report-issue"]').forEach(function (btn) {
        btn.addEventListener('click', function () { reportIssue(btn.dataset.job); });
    });
    document.querySelectorAll('button[data-action="contact-dispatch"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            window.open('https://wa.me/27676659966?text=' + encodeURIComponent('Dispatch, I need assistance with job ' + btn.dataset.job.slice(0, 8) + '.'), '_blank', 'noopener');
        });
    });
    document.querySelectorAll('button[data-action="emergency"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (!confirm('This sends an emergency alert to dispatch via WhatsApp. For life-threatening emergencies, call local emergency services directly. Continue?')) return;
            window.open('https://wa.me/27676659966?text=' + encodeURIComponent('EMERGENCY — I need urgent help with job ' + btn.dataset.job.slice(0, 8) + '.'), '_blank', 'noopener');
        });
    });
    document.querySelectorAll('canvas[id^="sigCanvas-"]').forEach(wireSignaturePad);
    document.querySelectorAll('button[data-action="clear-sig"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const canvas = document.getElementById('sigCanvas-' + btn.dataset.job);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        });
    });
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

async function setArrived(jobId, field) {
    const fields = {};
    fields[field] = new Date().toISOString();
    await supabase.from('jobs').update(fields).eq('id', jobId);
    loadAll();
}

async function confirmPickup(jobId) {
    const { data: job } = await supabase.from('jobs').select('collection_code').eq('id', jobId).single();
    const entered = (document.getElementById('collectionInput-' + jobId).value || '').trim();
    if (job && job.collection_code && entered !== job.collection_code) {
        const el = document.getElementById('collectionError-' + jobId);
        el.textContent = 'Incorrect pickup code — ask the sender to confirm it.';
        el.classList.remove('hidden');
        return;
    }
    await supabase.from('jobs').update({ status: 'to_dropoff', to_dropoff_at: new Date().toISOString() }).eq('id', jobId);
    loadAll();
}

async function completeDelivery(jobId) {
    const { data: job } = await supabase.from('jobs').select('delivery_code, payment_method').eq('id', jobId).single();
    const enteredEl = document.getElementById('deliveryInput-' + jobId);
    const entered = (enteredEl.value || '').trim();
    if (job && job.delivery_code && entered !== job.delivery_code) {
        const el = document.getElementById('deliveryError-' + jobId);
        el.textContent = 'Incorrect delivery code — ask the receiver to confirm it.';
        el.classList.remove('hidden');
        return;
    }

    const fields = { status: 'delivered', delivered_at: new Date().toISOString() };
    if (job && job.payment_method === 'cash') fields.payment_status = 'paid';
    if (lastPos) { fields.delivery_photo_lat = lastPos.lat; fields.delivery_photo_lng = lastPos.lng; }

    const canvas = document.getElementById('sigCanvas-' + jobId);
    const sigDataUrl = canvas ? canvas.toDataURL('image/png') : null;
    const isBlank = sigDataUrl && sigDataUrl === document.createElement('canvas').toDataURL('image/png');

    if (sigDataUrl && !isBlank) {
        const sigBlob = await (await fetch(sigDataUrl)).blob();
        const sigPath = currentUser.id + '/' + jobId + '-signature-' + Date.now() + '.png';
        const { error: sigErr } = await supabase.storage.from('delivery-proofs').upload(sigPath, sigBlob);
        if (!sigErr) fields.delivery_signature_url = supabase.storage.from('delivery-proofs').getPublicUrl(sigPath).data.publicUrl;
    }

    const photoInput = document.getElementById('photoInput-' + jobId);
    if (photoInput && photoInput.files && photoInput.files[0]) {
        const file = photoInput.files[0];
        const path = currentUser.id + '/' + jobId + '-photo-' + Date.now() + '.' + file.name.split('.').pop();
        const { error: photoErr } = await supabase.storage.from('delivery-proofs').upload(path, file);
        if (!photoErr) fields.delivery_photo_url = supabase.storage.from('delivery-proofs').getPublicUrl(path).data.publicUrl;
    }

    const { error } = await supabase.from('jobs').update(fields).eq('id', jobId);
    if (error) { alert('Failed to complete delivery: ' + error.message); return; }
    stopTracking();
    loadAll();
}

async function toggleDetails(jobId) {
    const el = document.getElementById('details-' + jobId);
    const open = el.classList.contains('open');
    document.querySelectorAll('.details-row.open').forEach(function (d) { d.classList.remove('open'); });
    if (open) return;

    const job = allJobs.find(function (j) { return j.id === jobId; });
    const timelineStages = [
        ['Job Assigned', job.assigned_at], ['Job Accepted / Heading to Pickup', job.to_pickup_at],
        ['Arrived Pickup', job.arrived_at_pickup_at], ['Parcel Picked Up / Heading to Destination', job.to_dropoff_at],
        ['Arrived Destination', job.arrived_at_dropoff_at], ['Delivered', job.delivered_at],
    ];

    el.innerHTML =
        '<h4>General</h4>Job ID: ' + job.id.slice(0, 8) + '<br>Created: ' + formatTime(job.created_at) +
        '<h4>Parcel</h4>Type: ' + escapeHtml(job.package_type || '—') + '<br>Description: ' + escapeHtml(job.package_description || '—') +
        '<br>Weight: ' + (job.package_weight_kg ? job.package_weight_kg + ' kg' : '—') +
        '<br>Special Instructions: ' + escapeHtml(job.pickup_notes || job.dropoff_notes || '—') +
        '<h4>Timeline</h4><ul class="timeline">' + timelineStages.map(function (s) {
            return '<li class="' + (s[1] ? 'done' : '') + '">' + s[0] + '<br><span style="font-size:11px;">' + (s[1] ? formatTime(s[1]) : 'Pending') + '</span></li>';
        }).join('') + '</ul>';
    el.classList.add('open');
}

async function reportIssue(jobId) {
    const description = prompt('Describe the issue you\'re experiencing with this delivery:');
    if (!description) return;
    const { data: ticket, error } = await supabase.from('support_tickets').insert({
        driver_id: currentUser.id, job_id: jobId, category: 'delivery_issue', priority: 'high',
        subject: 'Delivery issue — job ' + jobId.slice(0, 8), description: description,
    }).select().single();
    if (!error && ticket) {
        await supabase.from('support_ticket_messages').insert({ ticket_id: ticket.id, sender_type: 'driver', sender_name: currentProfile.full_name, message: description });
        alert('Issue reported to dispatch.');
    } else {
        alert('Could not submit report. Please try again.');
    }
}

function beginTracking() {
    if (watchId !== null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
        async function (pos) {
            lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            const active = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
            for (const job of active) {
                await supabase.from('jobs').update({ driver_lat: lastPos.lat, driver_lng: lastPos.lng }).eq('id', job.id);
                updateJobMapDriverPos(job.id, lastPos.lat, lastPos.lng);
            }
        },
        function () { /* best-effort */ },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
}
function stopTracking() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

function ensureJobMap(jobId, destLat, destLng) {
    const container = document.getElementById('jobMap-' + jobId);
    if (!container) return;
    const map = L.map(container).setView([destLat, destLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    const destMarker = L.marker([destLat, destLng], { icon: L.divIcon({ html: '📍', className: 'driver-marker', iconSize: [24, 24] }) }).addTo(map);
    jobMaps[jobId] = { map: map, destMarker: destMarker, driverMarker: null, destLat: destLat, destLng: destLng };
    if (lastPos) updateJobMapDriverPos(jobId, lastPos.lat, lastPos.lng);
}
function updateJobMapDriverPos(jobId, lat, lng) {
    const entry = jobMaps[jobId];
    if (!entry) return;
    if (!entry.driverMarker) entry.driverMarker = L.marker([lat, lng], { icon: L.divIcon({ html: '🚚', className: 'driver-marker', iconSize: [28, 28] }) }).addTo(entry.map);
    else entry.driverMarker.setLatLng([lat, lng]);
    entry.map.fitBounds([[lat, lng], [entry.destLat, entry.destLng]], { padding: [24, 24] });
}
function destroyAllJobMaps() {
    Object.keys(jobMaps).forEach(function (id) { jobMaps[id].map.remove(); delete jobMaps[id]; });
}
