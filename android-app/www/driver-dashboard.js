let currentUser = null;
let currentProfile = null;
let watchId = null;
let activeJobId = null;
let lastPos = null;
let allJobs = [];
const jobMaps = {};

const STATUS_LABELS = {
    pending: 'Pending', offered: 'New job — respond below', to_pickup: 'Heading to pickup',
    to_dropoff: 'Heading to drop-off', delivered: 'Delivered', cancelled: 'Cancelled',
};
const BADGE_CLASS = {
    pending: 'pending', offered: 'assigned', to_pickup: 'in_progress', to_dropoff: 'in_progress',
    delivered: 'delivered', cancelled: 'cancelled',
};
const ACTIVE_STATUSES = ['offered', 'to_pickup', 'to_dropoff'];

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek() { const d = startOfDay(); d.setDate(d.getDate() - d.getDay()); return d; }
function startOfMonth() { const d = startOfDay(); d.setDate(1); return d; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') {
        await supabase.auth.signOut();
        window.location.href = 'driver-login.html';
        return;
    }
    if (profile.account_status !== 'active') {
        alert(profile.account_status === 'banned'
            ? 'Your account has been banned. Contact support if you believe this is a mistake.'
            : 'Your account is currently paused. Contact support for more information.');
        await supabase.auth.signOut();
        window.location.href = 'driver-login.html';
        return;
    }
    currentProfile = profile;

    document.getElementById('driverName').textContent = profile.full_name;
    if (profile.avatar_url) document.getElementById('driverAvatar').src = profile.avatar_url;
    document.getElementById('onlineToggle').checked = !!profile.is_online;
    document.getElementById('onlineLabel').textContent = profile.is_online ? 'Online' : 'Offline';

    const banner = document.getElementById('verificationBanner');
    if (profile.verification_status !== 'approved') {
        banner.classList.remove('hidden');
        document.getElementById('verificationBannerText').textContent = !profile.avatar_url
            ? 'Upload your profile photo and documents to start accepting jobs.'
            : profile.verification_status === 'rejected'
                ? 'Your documents were rejected. Please re-upload them.'
                : 'Your documents are pending review — you can\'t accept jobs until approved.';
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        stopTracking();
        stopPresence();
        // Logging out must take the driver off the map and out of dispatch
        // — otherwise admin (which now trusts this toggle as the sole
        // source of truth) would keep showing them Online forever.
        await supabase.from('profiles').update({ is_online: false }).eq('id', currentUser.id);
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('onlineToggle').addEventListener('change', toggleOnline);
    NotifBell.init({ userId: currentUser.id, role: 'driver' });

    if (typeof GeoPermission !== 'undefined') {
        GeoPermission.checkStatus(function (status) {
            if (status === 'denied' || status === 'prompt') {
                GeoPermission.showBanner(
                    document.querySelector('.page-wrap'),
                    'Turn on location so you show up on the map and can be dispatched jobs near you.',
                    function () { beginPresence(); }
                );
            }
        });
    }

    await loadDriverShare();
    await loadCommissionRules();
    beginPresence();
    loadJobs();

    supabase
        .channel('driver-jobs-' + currentUser.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'driver_id=eq.' + currentUser.id }, function (payload) {
            var oldStatus = payload.old && payload.old.status;
            var newStatus = payload.new && payload.new.status;
            if (payload.eventType !== 'UPDATE' || oldStatus !== newStatus) loadJobs();
        })
        .subscribe();

    if (profile.is_online) {
        supabase
            .channel('driver-available-' + currentUser.id)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'status=eq.pending' }, loadJobs)
            .subscribe();
    }
});

async function toggleOnline() {
    const toggle = document.getElementById('onlineToggle');
    const goingOnline = toggle.checked;

    if (!goingOnline) {
        const hasActive = allJobs.some(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
        if (hasActive) {
            toggle.checked = true;
            alert('You can\'t go offline while you have an active delivery. Complete it first.');
            return;
        }
        if (!confirm('Go Offline? You will stop receiving new delivery requests.')) {
            toggle.checked = true;
            return;
        }
    }

    await supabase.from('profiles').update({ is_online: goingOnline }).eq('id', currentUser.id);
    currentProfile.is_online = goingOnline;
    document.getElementById('onlineLabel').textContent = goingOnline ? 'Online' : 'Offline';
    loadJobs();
}

let presenceWatchId = null;

function beginPresence() {
    if (!navigator.geolocation) return;
    presenceWatchId = navigator.geolocation.watchPosition(
        async function (pos) {
            await supabase.from('profiles').update({
                last_lat: pos.coords.latitude,
                last_lng: pos.coords.longitude,
                last_seen_at: new Date().toISOString(),
            }).eq('id', currentUser.id);
        },
        function () { /* silently ignore — presence is best-effort */ },
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 }
    );
}

function stopPresence() {
    if (presenceWatchId !== null) { navigator.geolocation.clearWatch(presenceWatchId); presenceWatchId = null; }
}

async function loadJobs() {
    const { data: jobs, error } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false });
    if (error) return;
    allJobs = jobs || [];

    let availablePending = [];
    if (currentProfile.is_online) {
        const { data: pendingJobs } = await supabase.from('jobs').select('*')
            .eq('status', 'pending').is('driver_id', null).eq('vehicle', currentProfile.vehicle_class)
            .order('created_at', { ascending: false }).limit(5);
        availablePending = pendingJobs || [];
    }

    destroyAllJobMaps();
    renderSummaryCards();
    renderActiveDelivery();
    renderAvailableJobs(availablePending);
    renderRecentDeliveries();
    renderPerformance();
    renderChatUnreadBadge();

    const inProgress = allJobs.find(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    if (inProgress && activeJobId !== inProgress.id) beginTracking(inProgress.id);
    if (!inProgress) stopTracking();
}

function renderSummaryCards() {
    const today = startOfDay();
    const deliveredToday = allJobs.filter(function (j) { return j.status === 'delivered' && j.delivered_at && new Date(j.delivered_at) >= today; });
    const earningsToday = deliveredToday.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const distanceToday = deliveredToday.reduce(function (s, j) { return s + (Number(j.distance) || 0); }, 0);

    const offeredCount = allJobs.filter(function (j) { return j.status === 'offered'; }).length;
    const activeCount = allJobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; }).length;

    const rated = allJobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;

    const delivered = allJobs.filter(function (j) { return j.status === 'delivered'; });
    const cancelled = allJobs.filter(function (j) { return j.status === 'cancelled'; });
    const completionRate = (delivered.length + cancelled.length) ? Math.round((delivered.length / (delivered.length + cancelled.length)) * 100) : null;

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">R' + earningsToday.toFixed(0) + '</div><div class="lbl">Today\'s Earnings</div><div class="meta">' + deliveredToday.length + ' deliveries today</div></div>' +
        '<div class="summary-card"><div class="num">' + offeredCount + '</div><div class="lbl">Available Jobs</div></div>' +
        '<div class="summary-card"><div class="num">' + activeCount + '</div><div class="lbl">Active Deliveries</div></div>' +
        '<div class="summary-card"><div class="num">' + distanceToday.toFixed(1) + ' km</div><div class="lbl">Today\'s Distance</div></div>' +
        '<div class="summary-card"><div class="num">' + (avgRating ? avgRating.toFixed(1) + ' ★' : '—') + '</div><div class="lbl">Average Rating</div><div class="meta">' + rated.length + ' reviews</div></div>' +
        '<div class="summary-card"><div class="num">' + (completionRate !== null ? completionRate + '%' : '—') + '</div><div class="lbl">Completion Rate</div></div>';
}

function computeEtaMin(job) {
    const destLat = job.status === 'to_pickup' ? job.pickup_lat : job.dropoff_lat;
    const destLng = job.status === 'to_pickup' ? job.pickup_lng : job.dropoff_lng;
    if (!job.driver_lat || !job.driver_lng || !destLat || !destLng) return null;
    return haversineKm(job.driver_lat, job.driver_lng, destLat, destLng);
}

function renderActiveDelivery() {
    const active = allJobs.find(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    const card = document.getElementById('activeDeliveryCard');
    const emptyCard = document.getElementById('noActiveDeliveryCard');

    if (!active) { card.classList.add('hidden'); emptyCard.classList.remove('hidden'); return; }
    emptyCard.classList.add('hidden');
    card.classList.remove('hidden');

    const remainingKm = computeEtaMin(active);
    const etaMin = remainingKm !== null ? Math.round((remainingKm / 30) * 60) : null;
    const destLat = active.status === 'to_pickup' ? active.pickup_lat : active.dropoff_lat;
    const destLng = active.status === 'to_pickup' ? active.pickup_lng : active.dropoff_lng;
    const navUrl = destLat && destLng ? mapsDirectionsUrl(destLat, destLng) : null;
    const custDigits = (active.customer_phone || '').replace(/\D/g, '');

    let actionArea = '';
    if (active.status === 'to_pickup') {
        actionArea =
            (active.pickup_lat && active.pickup_lng ? '<div id="jobMap-' + active.id + '" style="height: 180px; border: 1px solid var(--line); margin-bottom: 10px;"></div>' : '') +
            '<label>Pickup code (ask the sender)</label>' +
            '<input class="field-plain" id="collectionInput-' + active.id + '" placeholder="4-digit code">' +
            '<div class="msg error hidden" id="collectionError-' + active.id + '"></div>' +
            '<div class="msg error hidden" id="locError-' + active.id + '"></div>' +
            '<button class="btn btn-blue" data-job="' + active.id + '" data-action="confirm-pickup">Confirm pickup</button>';
    } else {
        actionArea =
            (active.dropoff_lat && active.dropoff_lng ? '<div id="jobMap-' + active.id + '" style="height: 180px; border: 1px solid var(--line); margin-bottom: 10px;"></div>' : '') +
            '<label>Delivery code (ask the receiver)</label>' +
            '<input class="field-plain" id="deliveryInput-' + active.id + '" placeholder="4-digit code">' +
            '<div class="msg error hidden" id="deliveryError-' + active.id + '"></div>' +
            '<button class="btn btn-outline-blue" data-job="' + active.id + '" data-action="deliver">Mark Delivered</button>';
    }

    document.getElementById('activeDeliveryContent').innerHTML =
        '<div class="meta">Job ' + active.id.slice(0, 8) + '</div>' +
        '<div class="route">' + escapeHtml(active.pickup) + ' → ' + escapeHtml(active.dropoff) + '</div>' +
        '<div class="meta">Customer: ' + escapeHtml(active.sender_name || '') + (active.customer_phone ? ' · ' + escapeHtml(active.customer_phone) : '') + '</div>' +
        '<span class="badge ' + BADGE_CLASS[active.status] + '">' + STATUS_LABELS[active.status] + '</span>' +
        '<div class="meta" style="margin-top:6px;">ETA: ' + (etaMin !== null ? etaMin + ' min' : '—') + ' · Distance remaining: ' + (remainingKm !== null ? remainingKm.toFixed(1) + ' km' : '—') + '</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">' +
            (navUrl ? '<a class="btn btn-outline-blue" style="width:auto;" href="' + navUrl + '" target="_blank" rel="noopener">Open Navigation</a>' : '') +
            (custDigits ? '<a class="btn btn-outline-blue" style="width:auto;" href="tel:' + escapeHtml(active.customer_phone) + '">Call Customer</a>' : '') +
            '<a class="btn btn-blue" style="width:auto;" href="chat.html?job=' + active.id + '">💬 Chat</a>' +
            '<a class="btn btn-outline-blue" style="width:auto;" href="driver-admin-chat.html?delivery=' + active.id + '">Need Help</a>' +
            (custDigits ? '<a class="btn btn-outline-blue" style="width:auto;" target="_blank" rel="noopener" href="https://wa.me/' + custDigits + '?text=' + encodeURIComponent('Hi, this is your Ekoquick driver regarding order ' + active.id.slice(0, 8) + '.') + '">WhatsApp Customer</a>' : '') +
        '</div>' +
        '<div style="margin-top:10px;">' + actionArea + '</div>';

    document.querySelectorAll('button[data-action="confirm-pickup"]').forEach(function (btn) {
        btn.addEventListener('click', function () { confirmPickup(btn.dataset.job); });
    });
    document.querySelectorAll('button[data-action="deliver"]').forEach(function (btn) {
        btn.addEventListener('click', function () { markDelivered(btn.dataset.job); });
    });

    if (active.status === 'to_pickup' && active.pickup_lat && active.pickup_lng) ensureJobMap(active.id, active.pickup_lat, active.pickup_lng);
    else if (active.status === 'to_dropoff' && active.dropoff_lat && active.dropoff_lng) ensureJobMap(active.id, active.dropoff_lat, active.dropoff_lng);
}

function renderAvailableJobs(availablePending) {
    const offered = allJobs.filter(function (j) { return j.status === 'offered'; });
    const list = document.getElementById('availableJobsList');
    const combined = offered.concat(availablePending).slice(0, 5);

    if (!combined.length) {
        list.innerHTML = '<div class="empty">No delivery requests available nearby.</div>';
        return;
    }

    list.innerHTML = combined.map(function (job) {
        const isOffered = job.status === 'offered';
        return '<div class="job">' +
            '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
            '<div class="meta">' + (job.distance || 0) + ' km · You earn R' + driverEarningForJob(job).toFixed(2) + ' · ' + (isOffered ? 'Dispatched to you' : 'Open request') + '</div>' +
            '<div style="margin-top:8px; display:flex; gap:8px;">' +
                '<button class="btn btn-blue" style="width:auto;" data-job="' + job.id + '" data-action="' + (isOffered ? 'accept' : 'claim') + '">Accept Job</button>' +
                '<button class="btn btn-outline-blue" style="width:auto;" data-job="' + job.id + '" data-action="' + (isOffered ? 'decline' : 'dismiss') + '">Decline</button>' +
            '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('button[data-action="accept"]').forEach(function (btn) {
        btn.addEventListener('click', function () { acceptJob(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="decline"]').forEach(function (btn) {
        btn.addEventListener('click', function () { declineJob(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="claim"]').forEach(function (btn) {
        btn.addEventListener('click', function () { claimJob(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="dismiss"]').forEach(function (btn) {
        btn.addEventListener('click', function () { btn.closest('.job').remove(); });
    });
}

function renderRecentDeliveries() {
    const delivered = allJobs.filter(function (j) { return j.status === 'delivered'; }).slice(0, 5);
    const body = document.getElementById('recentDeliveriesBody');
    const empty = document.getElementById('recentDeliveriesEmpty');
    if (!delivered.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    body.innerHTML = delivered.map(function (job) {
        return '<tr>' +
            '<td>' + job.id.slice(0, 8) + '</td>' +
            '<td>' + escapeHtml(job.sender_name || '') + '</td>' +
            '<td>' + formatDate(job.delivered_at) + '</td>' +
            '<td>R' + driverEarningForJob(job).toFixed(2) + '</td>' +
            '<td>' + (job.rating ? '★'.repeat(job.rating) : '—') + '</td>' +
            '</tr>';
    }).join('');
}

function renderPerformance() {
    const today = startOfDay(), week = startOfWeek(), month = startOfMonth();
    const delivered = allJobs.filter(function (j) { return j.status === 'delivered'; });
    const cancelled = allJobs.filter(function (j) { return j.status === 'cancelled'; });

    const deliveriesToday = delivered.filter(function (j) { return new Date(j.delivered_at) >= today; }).length;
    const deliveriesWeek = delivered.filter(function (j) { return new Date(j.delivered_at) >= week; }).length;
    const deliveriesMonth = delivered.filter(function (j) { return new Date(j.delivered_at) >= month; }).length;

    const withDuration = delivered.filter(function (j) { return j.assigned_at && j.delivered_at; });
    const avgMin = withDuration.length
        ? Math.round(withDuration.reduce(function (s, j) { return s + (new Date(j.delivered_at) - new Date(j.assigned_at)); }, 0) / withDuration.length / 60000)
        : null;

    const completionRate = (delivered.length + cancelled.length) ? Math.round((delivered.length / (delivered.length + cancelled.length)) * 100) : null;
    const rated = allJobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;

    document.getElementById('performanceGrid').innerHTML =
        '<div class="summary-card"><div class="num">' + deliveriesToday + '</div><div class="lbl">Deliveries Today</div></div>' +
        '<div class="summary-card"><div class="num">' + deliveriesWeek + '</div><div class="lbl">Deliveries This Week</div></div>' +
        '<div class="summary-card"><div class="num">' + deliveriesMonth + '</div><div class="lbl">Deliveries This Month</div></div>' +
        '<div class="summary-card"><div class="num">' + delivered.length + '</div><div class="lbl">Lifetime Deliveries</div></div>' +
        '<div class="summary-card"><div class="num">' + (avgMin !== null ? avgMin + ' min' : '—') + '</div><div class="lbl">Average Delivery Time</div></div>' +
        '<div class="summary-card"><div class="num">—</div><div class="lbl">Acceptance Rate</div><div class="meta">Not tracked — declined jobs aren\'t retained</div></div>' +
        '<div class="summary-card"><div class="num">' + (completionRate !== null ? completionRate + '%' : '—') + '</div><div class="lbl">Completion Rate</div></div>' +
        '<div class="summary-card"><div class="num">' + (avgRating ? avgRating.toFixed(1) + ' ★' : '—') + '</div><div class="lbl">Average Customer Rating</div></div>';
}

async function renderChatUnreadBadge() {
    const { data: rooms } = await supabase.from('chat_rooms').select('id').eq('driver_id', currentUser.id);
    const roomIds = (rooms || []).map(function (r) { return r.id; });
    const badge = document.getElementById('chatUnreadBadge');
    if (!roomIds.length) { badge.classList.add('hidden'); return; }
    const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).in('room_id', roomIds).is('read_at', null).neq('sender_id', currentUser.id);
    if (count) { badge.textContent = count; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
}


function showJobError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
}

async function acceptJob(jobId) {
    if (currentProfile.verification_status !== 'approved') {
        alert('Your documents must be approved before you can accept jobs. Go to "Complete now" above.');
        return;
    }
    const { error } = await supabase.from('jobs').update({ status: 'to_pickup', to_pickup_at: new Date().toISOString() }).eq('id', jobId);
    if (error) { alert('Failed to accept job: ' + error.message); return; }
    window.location.href = 'driver-navigation.html?job=' + jobId;
}

async function claimJob(jobId) {
    if (currentProfile.verification_status !== 'approved') {
        alert('Your documents must be approved before you can accept jobs. Go to "Complete now" above.');
        return;
    }
    const hasActive = allJobs.some(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    if (hasActive) { alert('You already have an active delivery. Complete it before accepting another job.'); return; }

    const { data, error } = await supabase.from('jobs')
        .update({ driver_id: currentUser.id, status: 'to_pickup', assigned_at: new Date().toISOString(), to_pickup_at: new Date().toISOString() })
        .eq('id', jobId).eq('status', 'pending').is('driver_id', null).select();

    if (error) { alert('Failed to accept job: ' + error.message); return; }
    if (!data || !data.length) { alert('This job was just claimed by another driver.'); loadJobs(); return; }

    window.location.href = 'driver-navigation.html?job=' + jobId;
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

    const { error } = await supabase.from('jobs').update({ status: 'to_dropoff', to_dropoff_at: new Date().toISOString() }).eq('id', jobId);
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
    const { data: job } = await supabase.from('jobs').select('delivery_code, payment_method').eq('id', jobId).single();
    const entered = (document.getElementById('deliveryInput-' + jobId).value || '').trim();

    if (job && job.delivery_code && entered !== job.delivery_code) {
        showJobError('deliveryError-' + jobId, 'Incorrect delivery code — ask the receiver to confirm it.');
        return;
    }

    const fields = { status: 'delivered', delivered_at: new Date().toISOString() };
    if (job && job.payment_method === 'cash') fields.payment_status = 'paid';

    const { error } = await supabase.from('jobs').update(fields).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    if (activeJobId === jobId) stopTracking();
    loadJobs();
}

// ---- In-app route map (Google Maps + Routes API) ----

async function ensureJobMap(jobId, destLat, destLng) {
    const container = document.getElementById('jobMap-' + jobId);
    if (!container) return;

    const map = await GoogleMaps.createMap('jobMap-' + jobId, [destLat, destLng], 13);
    const destMarker = GoogleMaps.createMarker(map, [destLat, destLng], '📍', { title: 'Destination' });
    jobMaps[jobId] = { map: map, destMarker: destMarker, driverMarker: null, routeLine: null, destLat: destLat, destLng: destLng, lastRouteAt: 0, userPanned: false, programmatic: false };
    // fitBounds ran on every single GPS tick, silently overriding any
    // manual pan/zoom — track real user interaction (dragstart only ever
    // fires for an actual drag, never programmatically) and stop
    // auto-fitting once they've taken over.
    if (map.addListener) {
        map.addListener('dragstart', function () { jobMaps[jobId] && (jobMaps[jobId].userPanned = true); });
        map.addListener('zoom_changed', function () { const e = jobMaps[jobId]; if (e && !e.programmatic) e.userPanned = true; });
    }

    if (lastPos) updateJobMapDriverPos(jobId, lastPos.lat, lastPos.lng);
}

function updateJobMapDriverPos(jobId, lat, lng) {
    const entry = jobMaps[jobId];
    if (!entry) return;

    if (!entry.driverMarker) {
        entry.driverMarker = GoogleMaps.createMarker(entry.map, [lat, lng], '🚚', { title: 'You' });
    } else {
        entry.driverMarker.setLatLng([lat, lng]);
    }

    if (entry.userPanned) return;
    entry.programmatic = true;
    GoogleMaps.fitBounds(entry.map, [[lat, lng], [entry.destLat, entry.destLng]]);
    setTimeout(function () { if (jobMaps[jobId]) jobMaps[jobId].programmatic = false; }, 300);

    const now = Date.now();
    if (now - entry.lastRouteAt > 20000) {
        entry.lastRouteAt = now;
        GoogleMaps.computeRoutePolyline(lat, lng, entry.destLat, entry.destLng).then(function (latlngs) {
            if (!latlngs || !jobMaps[jobId]) return;
            if (entry.routeLine) entry.routeLine.remove();
            entry.routeLine = GoogleMaps.createPolyline(entry.map, latlngs, '#FF6A2B', 4);
        });
    }
}

function destroyAllJobMaps() {
    Object.keys(jobMaps).forEach(function (id) {
        delete jobMaps[id];
    });
}
