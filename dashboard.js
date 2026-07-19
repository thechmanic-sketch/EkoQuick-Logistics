let currentUser = null;
let currentProfile = null;
let allJobs = [];
let driversById = {};
let allComplaints = [];
let showingAllOrders = false;

const STATUS_LABELS = {
    pending: 'Waiting for driver assignment',
    offered: 'Waiting for driver to accept',
    to_pickup: 'Driver heading to pickup',
    to_dropoff: 'Driver on the way to you',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};
const BADGE_CLASS = {
    pending: 'pending', offered: 'assigned', to_pickup: 'in_progress', to_dropoff: 'in_progress',
    delivered: 'delivered', cancelled: 'cancelled',
};

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    currentProfile = await getProfile(currentUser.id);
    if (currentProfile && currentProfile.full_name) {
        document.getElementById('welcomeText').textContent = 'Welcome back, ' + currentProfile.full_name.split(' ')[0] + '!';
        document.getElementById('profileNameLabel').textContent = currentProfile.full_name;
    }
    const avatarUrl = (currentProfile && currentProfile.avatar_url) || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34"><rect width="34" height="34" fill="%23161B22"/></svg>';
    document.getElementById('avatarBtn').src = avatarUrl;
    if (currentProfile && currentProfile.avatar_url) {
        const preview = document.getElementById('avatarPreview');
        preview.src = currentProfile.avatar_url;
        preview.classList.remove('hidden');
    }

    document.getElementById('avatarSaveBtn').addEventListener('click', saveAvatar);
    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('bellBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        document.getElementById('profilePanel').classList.remove('open');
        document.getElementById('notifPanel').classList.toggle('open');
    });
    document.getElementById('avatarBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        document.getElementById('notifPanel').classList.remove('open');
        document.getElementById('profilePanel').classList.toggle('open');
    });
    document.addEventListener('click', function () {
        document.getElementById('notifPanel').classList.remove('open');
        document.getElementById('profilePanel').classList.remove('open');
    });
    document.getElementById('orderSearch').addEventListener('input', renderRecentOrders);
    document.getElementById('showAllOrdersBtn').addEventListener('click', function () {
        showingAllOrders = !showingAllOrders;
        this.textContent = showingAllOrders ? 'Show fewer orders' : 'Show all orders';
        renderRecentOrders();
    });

    await loadAll();
    supabase.channel('customer-dashboard-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'customer_id=eq.' + currentUser.id }, loadAll).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

function startOfMonth() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); return d; }

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeEta(job) {
    if (job.status !== 'to_pickup' && job.status !== 'to_dropoff') return '—';
    const destLat = job.status === 'to_pickup' ? job.pickup_lat : job.dropoff_lat;
    const destLng = job.status === 'to_pickup' ? job.pickup_lng : job.dropoff_lng;
    if (!job.driver_lat || !job.driver_lng || !destLat || !destLng) return '—';
    const km = haversineKm(job.driver_lat, job.driver_lng, destLat, destLng);
    return Math.round((km / 30) * 60) + ' min';
}

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
    allJobs = jobs || [];

    const driverIds = [...new Set(allJobs.map(function (j) { return j.driver_id; }).filter(Boolean))];
    driversById = {};
    if (driverIds.length) {
        const { data: drivers } = await supabase.from('profiles').select('id, full_name, avatar_url, phone, vehicle_class').in('id', driverIds);
        (drivers || []).forEach(function (d) { driversById[d.id] = d; });
    }

    const { data: complaints } = await supabase.from('complaints').select('*').eq('customer_id', currentUser.id);
    allComplaints = complaints || [];

    renderSummaryCards();
    renderActiveDeliveries();
    renderRecentOrders();
    renderActivity();
    renderNotifications();
    updateQuickActions();
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

function activeJobs() {
    return allJobs.filter(function (j) { return j.status !== 'delivered' && j.status !== 'cancelled'; });
}

function renderSummaryCards() {
    const active = activeJobs();
    const completed = allJobs.filter(function (j) { return j.status === 'delivered'; });
    const monthStart = startOfMonth();
    const ordersThisMonth = allJobs.filter(function (j) { return new Date(j.created_at) >= monthStart; });
    const lifetimeSpend = completed.reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0);
    const monthSpend = completed.filter(function (j) { return j.delivered_at && new Date(j.delivered_at) >= monthStart; }).reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0);

    if (!allJobs.length) {
        document.getElementById('summaryCardsWrap').innerHTML =
            '<div class="empty">Ready to send your first package?</div>' +
            '<a class="btn btn-blue" href="new-delivery.html" style="display:block; text-align:center; margin-top:10px;">Book Delivery</a>';
        return;
    }

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + active.length + '</div><div class="lbl">Active Deliveries</div></div>' +
        '<div class="summary-card"><div class="num">' + completed.length + '</div><div class="lbl">Completed</div></div>' +
        '<div class="summary-card"><div class="num">' + ordersThisMonth.length + '</div><div class="lbl">Orders This Month</div></div>' +
        '<div class="summary-card"><div class="num">R' + lifetimeSpend.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div><div class="lbl">Lifetime Spend</div><div class="meta" style="margin-top:2px;">R' + monthSpend.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' this month</div></div>';
}

function renderActiveDeliveries() {
    const wrap = document.getElementById('activeDeliveriesWrap');
    const active = activeJobs();
    if (!active.length) { wrap.innerHTML = ''; return; }

    wrap.innerHTML = '<div class="card"><h2>Active ' + (active.length > 1 ? 'Deliveries' : 'Delivery') + '</h2>' +
        active.map(function (job) {
            const driver = driversById[job.driver_id];
            const driverWaLink = driver && driver.phone ? 'https://wa.me/' + driver.phone.replace(/\D/g, '') + '?text=' + encodeURIComponent('Hi, regarding my Ekoquick order ' + job.id.slice(0, 8) + '.') : null;
            return '<div class="job">' +
                '<div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">' +
                    (driver && driver.avatar_url ? '<img src="' + escapeHtml(driver.avatar_url) + '" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:1px solid var(--line);">' : '') +
                    '<div><div class="route">' + (driver ? escapeHtml(driver.full_name) : 'Waiting for driver') + '</div>' +
                    (driver ? '<div class="meta">' + vehicleLabel(driver.vehicle_class) + '</div>' : '') + '</div>' +
                '</div>' +
                '<div class="meta">Order ' + job.id.slice(0, 8) + ' · ' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<span class="badge ' + BADGE_CLASS[job.status] + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (job.status === 'to_pickup' || job.status === 'to_dropoff' ? ' <span class="meta">ETA ' + computeEta(job) + '</span>' : '') +
                '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
                    (job.status === 'to_pickup' || job.status === 'to_dropoff' ? '<a class="btn btn-outline-blue" style="width:auto;" href="live-tracking.html?job=' + job.id + '">Live Track</a>' : '') +
                    (driverWaLink ? '<a class="btn btn-outline-blue" style="width:auto;" target="_blank" href="' + driverWaLink + '">Contact Driver</a>' : '') +
                    '<a class="btn btn-outline-blue" style="width:auto;" target="_blank" href="https://wa.me/27676659966?text=' + encodeURIComponent('Hi Ekoquick, question about order ' + job.id.slice(0, 8) + '.') + '">Contact Support</a>' +
                '</div>' +
            '</div>';
        }).join('') +
    '</div>';
}

function updateQuickActions() {
    const active = activeJobs().find(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; });
    const trackBtn = document.getElementById('trackAction');
    if (active) {
        trackBtn.href = 'live-tracking.html?job=' + active.id;
        trackBtn.classList.remove('disabled');
    } else {
        trackBtn.href = '#';
        trackBtn.classList.add('disabled');
    }
}

function renderRecentOrders() {
    const el = document.getElementById('recentOrders');
    const showAllBtn = document.getElementById('showAllOrdersBtn');
    const q = document.getElementById('orderSearch').value.trim().toLowerCase();

    let list = allJobs;
    if (q) {
        list = list.filter(function (j) {
            const driver = driversById[j.driver_id];
            const hay = (j.id + ' ' + j.pickup + ' ' + j.dropoff + ' ' + (driver ? driver.full_name : '')).toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }

    if (!allJobs.length) { el.innerHTML = '<div class="empty">No deliveries yet. Create your first one!</div>'; showAllBtn.style.display = 'none'; return; }
    if (!list.length) { el.innerHTML = '<div class="empty">No orders match your search.</div>'; showAllBtn.style.display = 'none'; return; }

    showAllBtn.style.display = list.length > 5 ? 'block' : 'none';
    const shown = showingAllOrders ? list : list.slice(0, 5);

    el.innerHTML = shown.map(function (job) {
        const driver = driversById[job.driver_id];
        let actionHtml = '';
        if (job.status === 'offered') actionHtml = '<a class="btn btn-outline-blue" style="width:auto;" href="driver-assigned.html?job=' + job.id + '">View Driver</a>';
        else if (job.status === 'to_pickup' || job.status === 'to_dropoff') actionHtml = '<a class="btn btn-outline-blue" style="width:auto;" href="live-tracking.html?job=' + job.id + '">Track</a>';
        else if (job.status === 'delivered' && !job.rating) actionHtml = '<a class="btn btn-outline-blue" style="width:auto;" href="rate-driver.html?job=' + job.id + '">Rate Driver</a>';

        return '<div class="job">' +
            '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
            '<div class="meta">Order ' + job.id.slice(0, 8) + ' · ' + (driver ? escapeHtml(driver.full_name) + ' · ' : '') + formatDate(job.created_at) + ' · R' + (Number(job.quote) || 0).toFixed(2) + '</div>' +
            '<span class="badge ' + BADGE_CLASS[job.status] + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
            '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
                (actionHtml || '') +
                '<button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-details" data-job="' + job.id + '">View Details</button>' +
            '</div>' +
            '<div class="details-row" id="details-' + job.id + '">' +
                'Pickup code: ' + escapeHtml(job.collection_code || '—') + '<br>' +
                'Delivery code: ' + escapeHtml(job.delivery_code || '—') + '<br>' +
                'Distance: ' + (job.distance || '—') + ' km<br>' +
                (job.rating ? 'Your rating: ' + job.rating + ' ★<br>' : '') +
                (job.rating_comment ? 'Your review: "' + escapeHtml(job.rating_comment) + '"<br>' : '') +
                (job.cancellation_reason ? 'Cancellation reason: ' + escapeHtml(job.cancellation_reason) + '<br>' : '') +
            '</div>' +
        '</div>';
    }).join('');

    el.querySelectorAll('button[data-action="toggle-details"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.getElementById('details-' + btn.dataset.job).classList.toggle('open');
        });
    });
}

function buildActivityEvents() {
    const events = [];
    allJobs.forEach(function (j) {
        events.push({ time: j.created_at, label: 'Delivery booked — ' + j.pickup + ' → ' + j.dropoff });
        if (j.assigned_at) events.push({ time: j.assigned_at, label: 'Driver assigned' });
        if (j.to_dropoff_at) events.push({ time: j.to_dropoff_at, label: 'Parcel picked up' });
        if (j.delivered_at) events.push({ time: j.delivered_at, label: 'Delivered — ' + j.pickup + ' → ' + j.dropoff });
        if (j.rating) events.push({ time: j.delivered_at || j.created_at, label: 'You submitted a ' + j.rating + ' ★ review' });
    });
    allComplaints.forEach(function (c) {
        events.push({ time: c.created_at, label: 'Complaint submitted' });
    });
    events.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
    return events;
}

function renderActivity() {
    const el = document.getElementById('activityTimeline');
    const events = buildActivityEvents();
    if (!events.length) { el.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
    el.innerHTML = events.slice(0, 15).map(function (e) {
        return '<div class="timeline-item"><span>•</span><div>' + escapeHtml(e.label) + '<div class="meta">' + formatTime(e.time) + '</div></div></div>';
    }).join('');
}

function renderNotifications() {
    const notifs = [];
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    allJobs.forEach(function (j) {
        if (j.assigned_at && new Date(j.assigned_at).getTime() >= dayAgo) notifs.push({ time: j.assigned_at, label: 'Driver assigned to your order (' + j.pickup + ' → ' + j.dropoff + ')' });
        if (j.delivered_at && new Date(j.delivered_at).getTime() >= dayAgo) notifs.push({ time: j.delivered_at, label: 'Delivery completed — ' + j.pickup + ' → ' + j.dropoff });
        if (j.payment_status === 'paid' && j.payment_verified_at && new Date(j.payment_verified_at).getTime() >= dayAgo) notifs.push({ time: j.payment_verified_at, label: 'Payment received for order ' + j.id.slice(0, 8) });

        if (j.status === 'to_pickup' && j.driver_lat && j.driver_lng && j.pickup_lat && j.pickup_lng) {
            const km = haversineKm(j.driver_lat, j.driver_lng, j.pickup_lat, j.pickup_lng);
            if (km <= 1) notifs.push({ time: new Date().toISOString(), label: 'Your driver is near the pickup location' });
        }
        if (j.status === 'to_dropoff' && j.driver_lat && j.driver_lng && j.dropoff_lat && j.dropoff_lng) {
            const km = haversineKm(j.driver_lat, j.driver_lng, j.dropoff_lat, j.dropoff_lng);
            if (km <= 1) notifs.push({ time: new Date().toISOString(), label: 'Your driver is near your delivery address' });
        }
    });

    notifs.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

    const bell = document.getElementById('bellCount');
    if (notifs.length) { bell.textContent = notifs.length; bell.classList.remove('hidden'); } else { bell.classList.add('hidden'); }

    const panel = document.getElementById('notifPanel');
    panel.innerHTML = notifs.length
        ? notifs.map(function (n) { return '<div class="notif-item">' + escapeHtml(n.label) + '</div>'; }).join('')
        : '<div class="empty">No notifications.</div>';
}

async function saveAvatar() {
    const file = document.getElementById('avatarFile').files[0];
    if (!file) { alert('Choose a photo first'); return; }

    const btn = document.getElementById('avatarSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const path = currentUser.id + '/avatar-' + Date.now() + '.' + (file.name.split('.').pop() || 'jpg');
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;

        const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        const { error } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
        if (error) throw error;

        document.getElementById('avatarBtn').src = publicUrl;
        const preview = document.getElementById('avatarPreview');
        preview.src = publicUrl;
        preview.classList.remove('hidden');
    } catch (err) {
        alert('Failed to save photo: ' + (err && err.message ? err.message : err));
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save photo';
    }
}
