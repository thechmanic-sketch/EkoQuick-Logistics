const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 25;

let allDrivers = [];
let allJobs = [];
let filteredDrivers = [];
let currentPage = 1;
let deliveriesChart = null, earningsChart = null, ratingChart = null;
let miniMap = null;

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

    populateVehicleFilter();
    document.getElementById('driverSearch').addEventListener('input', function () { currentPage = 1; applyFilters(); });
    document.getElementById('statusFilter').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('vehicleFilter').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('sortBy').addEventListener('change', applyFilters);
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);

    await loadDriverShare();
    await loadCommissionRules();
    await loadAll();
    openDriverFromUrl();

    supabase.channel('drivers-page-profiles').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadAll).subscribe();
    supabase.channel('drivers-page-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll).subscribe();
});

function openDriverFromUrl() {
    const driverId = new URLSearchParams(window.location.search).get('driver');
    if (!driverId) return;
    const driver = allDrivers.find(function (d) { return d.id === driverId; });
    if (driver) openDrawer(driver.id);
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function isOnline(driver) {
    return !!(driver.last_seen_at && (Date.now() - new Date(driver.last_seen_at).getTime()) < ONLINE_WINDOW_MS);
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek() { const d = startOfToday(); d.setDate(d.getDate() - d.getDay()); return d; }
function startOfMonth() { const d = startOfToday(); d.setDate(1); return d; }

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
    const { data: drivers } = await supabase.from('profiles').select('*').eq('role', 'driver');
    const { data: jobs } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    allDrivers = drivers || [];
    allJobs = jobs || [];

    renderSummaryCards();
    applyFilters();
    renderAnalytics();
}

function activeJobForDriver(driverId) {
    return allJobs.find(function (j) { return j.driver_id === driverId && (j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'); });
}

function driverStatusLabel(d) {
    if (d.account_status === 'banned') return 'suspended';
    if (d.account_status === 'paused') return 'suspended';
    if (activeJobForDriver(d.id)) return 'busy';
    if (isOnline(d)) return 'online';
    return 'offline';
}

function driverJobs(driverId) {
    return allJobs.filter(function (j) { return j.driver_id === driverId; });
}

function driverDeliveredJobs(driverId) {
    return driverJobs(driverId).filter(function (j) { return j.status === 'delivered' && j.delivered_at; });
}

function driverStats(driverId) {
    const jobs = driverJobs(driverId);
    const delivered = jobs.filter(function (j) { return j.status === 'delivered' && j.delivered_at; });
    const cancelled = jobs.filter(function (j) { return j.status === 'cancelled'; });
    const rated = jobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;

    const todayStart = startOfToday(), weekStart = startOfWeek(), monthStart = startOfMonth();
    const deliveredToday = delivered.filter(function (j) { return new Date(j.delivered_at) >= todayStart; });
    const earningsToday = deliveredToday.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const earningsWeek = delivered.filter(function (j) { return new Date(j.delivered_at) >= weekStart; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const earningsMonth = delivered.filter(function (j) { return new Date(j.delivered_at) >= monthStart; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const earningsLifetime = delivered.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);

    const withDuration = delivered.filter(function (j) { return j.created_at && j.delivered_at; });
    let avgDeliveryMins = null;
    if (withDuration.length) {
        const avgMs = withDuration.reduce(function (s, j) { return s + (new Date(j.delivered_at) - new Date(j.created_at)); }, 0) / withDuration.length;
        avgDeliveryMins = Math.round(avgMs / 60000);
    }

    return {
        delivered: delivered.length,
        cancelled: cancelled.length,
        avgRating: avgRating,
        reviewCount: rated.length,
        avgDeliveryMins: avgDeliveryMins,
        deliveredToday: deliveredToday.length,
        earningsToday: earningsToday,
        earningsWeek: earningsWeek,
        earningsMonth: earningsMonth,
        earningsLifetime: earningsLifetime,
    };
}

function renderSummaryCards() {
    const total = allDrivers.length;
    const online = allDrivers.filter(function (d) { return driverStatusLabel(d) === 'online'; }).length;
    const busy = allDrivers.filter(function (d) { return driverStatusLabel(d) === 'busy'; }).length;
    const offline = allDrivers.filter(function (d) { return driverStatusLabel(d) === 'offline'; }).length;
    const pendingVerification = allDrivers.filter(function (d) { return d.verification_status === 'pending'; }).length;
    const suspended = allDrivers.filter(function (d) { return d.account_status === 'paused' || d.account_status === 'banned'; }).length;

    document.getElementById('driverCountLabel').textContent = total + ' driver' + (total === 1 ? '' : 's');

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('summaryCards').innerHTML =
        card('Total Drivers', total) +
        card('Online', online) +
        card('Busy', busy) +
        card('Offline', offline) +
        card('Pending Verification', pendingVerification) +
        card('Suspended', suspended);
}

function applyFilters() {
    const q = document.getElementById('driverSearch').value.trim().toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const vehicleFilter = document.getElementById('vehicleFilter').value;
    const sortBy = document.getElementById('sortBy').value;

    filteredDrivers = allDrivers.filter(function (d) {
        if (q) {
            const hay = ((d.full_name || '') + ' ' + (d.phone || '') + ' ' + (d.email || '') + ' ' + d.id).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        if (vehicleFilter && d.vehicle_class !== vehicleFilter) return false;
        if (statusFilter) {
            const status = driverStatusLabel(d);
            if (statusFilter === 'online' && status !== 'online') return false;
            if (statusFilter === 'busy' && status !== 'busy') return false;
            if (statusFilter === 'offline' && status !== 'offline') return false;
            if (statusFilter === 'suspended' && status !== 'suspended') return false;
            if (statusFilter === 'verified' && d.verification_status !== 'approved') return false;
            if (statusFilter === 'unverified' && d.verification_status === 'approved') return false;
        }
        return true;
    });

    filteredDrivers.sort(function (a, b) {
        if (sortBy === 'name') return (a.full_name || '').localeCompare(b.full_name || '');
        if (sortBy === 'lastSeen') return new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0);
        const sa = driverStats(a.id), sb = driverStats(b.id);
        if (sortBy === 'rating') return (sb.avgRating || 0) - (sa.avgRating || 0);
        if (sortBy === 'deliveries') return sb.delivered - sa.delivered;
        if (sortBy === 'earnings') return sb.earningsLifetime - sa.earningsLifetime;
        return 0;
    });

    renderTable();
}

function renderTable() {
    const wrap = document.getElementById('driversTableWrap');
    if (!allDrivers.length) { wrap.innerHTML = '<div class="empty">No drivers have registered yet.</div>'; document.getElementById('pagination').innerHTML = ''; return; }
    if (!filteredDrivers.length) { wrap.innerHTML = '<div class="empty">No drivers match your filters.</div>'; document.getElementById('pagination').innerHTML = ''; return; }

    const totalPages = Math.max(1, Math.ceil(filteredDrivers.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filteredDrivers.slice(start, start + PAGE_SIZE);

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr>' +
        '<th>Photo</th><th>Name</th><th>Phone</th><th>Vehicle</th><th>Status</th><th>Verification</th>' +
        '<th>Rating</th><th>Deliveries</th><th>Current Order</th><th>Earnings (lifetime)</th><th>Last Seen</th><th></th>' +
        '</tr></thead><tbody>' +
        pageItems.map(function (d) {
            const status = driverStatusLabel(d);
            const statusBadgeClass = status === 'online' ? 'delivered' : status === 'busy' ? 'pending' : status === 'suspended' ? 'cancelled' : 'cancelled';
            const stats = driverStats(d.id);
            const activeJob = activeJobForDriver(d.id);
            const verifBadge = d.verification_status === 'approved' ? 'delivered' : d.verification_status === 'rejected' ? 'cancelled' : 'pending';
            return '<tr style="cursor:pointer;" data-driver="' + d.id + '">' +
                '<td>' + (d.avatar_url ? '<img src="' + escapeHtml(d.avatar_url) + '" style="width:28px;height:28px;object-fit:cover;border:1px solid var(--line);">' : '—') + '</td>' +
                '<td>' + escapeHtml(d.full_name || '—') + '</td>' +
                '<td>' + escapeHtml(d.phone || '—') + '</td>' +
                '<td>' + vehicleLabel(d.vehicle_class) + '</td>' +
                '<td><span class="badge ' + statusBadgeClass + '">' + status + '</span></td>' +
                '<td><span class="badge ' + verifBadge + '">' + (d.verification_status || 'pending') + '</span></td>' +
                '<td>' + (stats.avgRating ? stats.avgRating.toFixed(1) + ' ★' : '—') + '</td>' +
                '<td>' + stats.delivered + '</td>' +
                '<td>' + (activeJob ? escapeHtml(activeJob.pickup) + ' → ' + escapeHtml(activeJob.dropoff) : '—') + '</td>' +
                '<td>R' + stats.earningsLifetime.toLocaleString(undefined, { maximumFractionDigits: 2 }) + '</td>' +
                '<td>' + (d.last_seen_at ? new Date(d.last_seen_at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—') + '</td>' +
                '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="open-drawer" data-driver="' + d.id + '">View</button></td>' +
                '</tr>';
        }).join('') +
        '</tbody></table>';

    wrap.querySelectorAll('tr[data-driver]').forEach(function (row) {
        row.addEventListener('click', function (e) {
            if (e.target.closest('button')) return;
            openDrawer(row.dataset.driver);
        });
    });
    wrap.querySelectorAll('button[data-action="open-drawer"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openDrawer(btn.dataset.driver); });
    });

    const pag = document.getElementById('pagination');
    pag.innerHTML =
        '<button class="btn btn-outline-blue" id="prevPage" style="width:auto;" ' + (currentPage <= 1 ? 'disabled' : '') + '>Prev</button>' +
        '<span class="meta">Page ' + currentPage + ' of ' + totalPages + ' (' + filteredDrivers.length + ' drivers)</span>' +
        '<button class="btn btn-outline-blue" id="nextPage" style="width:auto;" ' + (currentPage >= totalPages ? 'disabled' : '') + '>Next</button>';
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    if (prevBtn) prevBtn.addEventListener('click', function () { currentPage--; renderTable(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { currentPage++; renderTable(); });
}

function closeDrawer() {
    document.getElementById('driverDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
    if (miniMap) { miniMap.remove(); miniMap = null; }
}

function openDrawer(driverId) {
    const d = allDrivers.find(function (x) { return x.id === driverId; });
    if (!d) return;
    const stats = driverStats(driverId);
    const activeJob = activeJobForDriver(driverId);
    const status = driverStatusLabel(d);
    const jobs = driverJobs(driverId).filter(function (j) { return j.status === 'delivered' || j.status === 'cancelled'; })
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    const reviews = driverJobs(driverId).filter(function (j) { return j.rating; })
        .sort(function (a, b) { return new Date(b.delivered_at || b.created_at) - new Date(a.delivered_at || a.created_at); });

    const docFields = [
        ['license_url', 'Driver Licence', d.license_expiry],
        ['id_doc_url', 'ID Document', null],
        ['vehicle_reg_url', 'Vehicle Registration', null],
        ['insurance_url', 'Insurance', d.insurance_expiry],
    ];

    const drawer = document.getElementById('driverDrawer');
    drawer.innerHTML =
        '<button class="drawer-close" id="closeDrawerBtn">✕</button>' +
        '<h2 style="margin-top:0;">' + escapeHtml(d.full_name || 'Driver') + '</h2>' +

        '<h3>Personal Information</h3>' +
        kv('Full name', d.full_name) + kv('Phone', d.phone) + kv('Email', d.email) + kv('Address', d.address) +
        kv('Joined', d.created_at ? new Date(d.created_at).toLocaleDateString('en-ZA') : '—') +

        '<h3>Vehicle Information</h3>' +
        kv('Class', vehicleLabel(d.vehicle_class)) + kv('Make', d.vehicle_make) + kv('Model', d.vehicle_model) +
        kv('Year', d.vehicle_year) + kv('Colour', d.vehicle_color) + kv('Registration No.', d.registration_number) +

        '<h3>Account Status</h3>' +
        kv('Status', d.account_status) + kv('Verification', d.verification_status) +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
            (d.verification_status !== 'approved' ? '<button class="btn btn-blue" style="width:auto;" data-action="approve">Approve</button>' : '') +
            (d.verification_status !== 'rejected' ? '<button class="btn btn-outline-blue" style="width:auto;" data-action="reject">Reject</button>' : '') +
            (d.account_status === 'active'
                ? '<button class="btn btn-outline-blue" style="width:auto;" data-action="pause">Suspend</button>'
                : '<button class="btn btn-blue" style="width:auto;" data-action="activate">Reactivate</button>') +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="ban">Ban</button>' +
        '</div>' +

        '<h3>Performance</h3>' +
        kv('Completed deliveries', stats.delivered) + kv('Cancelled', stats.cancelled) +
        kv('Average rating', stats.avgRating ? stats.avgRating.toFixed(1) + ' ★' : 'No ratings yet') +
        kv('Reviews', stats.reviewCount) +
        kv('Average delivery time', stats.avgDeliveryMins ? stats.avgDeliveryMins + ' mins' : '—') +

        '<h3>Financial Summary</h3>' +
        kv('Earnings today', 'R' + stats.earningsToday.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kv('Earnings this week', 'R' + stats.earningsWeek.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kv('Earnings this month', 'R' + stats.earningsMonth.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kv('Lifetime earnings', 'R' + stats.earningsLifetime.toLocaleString(undefined, { maximumFractionDigits: 2 })) +

        '<h3>Live Location</h3>' +
        kv('Status', status) +
        kv('Last seen', d.last_seen_at ? new Date(d.last_seen_at).toLocaleString('en-ZA') : '—') +
        kv('Current order', activeJob ? (escapeHtml(activeJob.pickup) + ' → ' + escapeHtml(activeJob.dropoff)) : 'None') +
        (d.last_lat && d.last_lng ? '<div id="driverMiniMap" style="height:200px; margin-top:8px; border:1px solid var(--line);"></div>' : '<div class="meta">No location data available.</div>') +

        '<h3>Documents</h3>' +
        docFields.map(function (f) {
            if (!d[f[0]]) return '<div class="meta">' + f[1] + ': not uploaded.</div>';
            return '<div class="kv-row"><span>' + f[1] + (f[2] ? ' (expires ' + new Date(f[2]).toLocaleDateString('en-ZA') + ')' : '') + '</span>' +
                '<button class="btn btn-outline-blue" style="width:auto;" data-action="view-doc" data-doc="' + escapeHtml(d[f[0]]) + '">View</button></div>';
        }).join('') +
        (d.documents_verified_by ? kv('Verified by', d.documents_verified_by + (d.documents_verified_at ? ' on ' + new Date(d.documents_verified_at).toLocaleDateString('en-ZA') : '')) : '') +

        '<h3>Customer Reviews</h3>' +
        (reviews.length
            ? kv('Average rating', stats.avgRating.toFixed(1) + ' ★') + kv('Total reviews', reviews.length) +
              reviews.slice(0, 5).map(function (j) {
                  return '<div class="job" style="margin-top:8px;"><div>' + j.rating + ' ★</div>' +
                      (j.rating_comment ? '<div class="meta">' + escapeHtml(j.rating_comment) + '</div>' : '') +
                      '<div class="meta">' + new Date(j.delivered_at || j.created_at).toLocaleDateString('en-ZA') + '</div></div>';
              }).join('')
            : '<div class="empty">No customer reviews yet.</div>') +

        '<h3>Order History</h3>' +
        (jobs.length
            ? '<table class="simple-table"><thead><tr><th>Order</th><th>Route</th><th>Completed</th><th>Status</th><th>Fee</th><th>Rating</th></tr></thead><tbody>' +
              jobs.slice(0, 20).map(function (j) {
                  return '<tr><td>' + j.id.slice(0, 8) + '</td><td>' + escapeHtml(j.pickup) + ' → ' + escapeHtml(j.dropoff) + '</td>' +
                      '<td>' + (j.delivered_at ? new Date(j.delivered_at).toLocaleDateString('en-ZA') : '—') + '</td>' +
                      '<td><span class="badge ' + j.status + '">' + j.status + '</span></td>' +
                      '<td>R' + (Number(j.quote) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '</td>' +
                      '<td>' + (j.rating ? j.rating + ' ★' : '—') + '</td></tr>';
              }).join('') + '</tbody></table>'
            : '<div class="empty">This driver has not completed any deliveries.</div>');

    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    drawer.querySelectorAll('button[data-action="view-doc"]').forEach(function (btn) {
        btn.addEventListener('click', function () { viewDriverDoc(btn.dataset.doc); });
    });
    const approveBtn = drawer.querySelector('button[data-action="approve"]');
    if (approveBtn) approveBtn.addEventListener('click', function () { setDriverVerification(driverId, 'approved'); });
    const rejectBtn = drawer.querySelector('button[data-action="reject"]');
    if (rejectBtn) rejectBtn.addEventListener('click', function () { setDriverVerification(driverId, 'rejected'); });
    const pauseBtn = drawer.querySelector('button[data-action="pause"]');
    if (pauseBtn) pauseBtn.addEventListener('click', function () { setAccountStatus(driverId, 'paused'); });
    const activateBtn = drawer.querySelector('button[data-action="activate"]');
    if (activateBtn) activateBtn.addEventListener('click', function () { setAccountStatus(driverId, 'active'); });
    const banBtn = drawer.querySelector('button[data-action="ban"]');
    if (banBtn) banBtn.addEventListener('click', function () {
        if (confirm('This will permanently ban the driver from receiving jobs. Continue?')) setAccountStatus(driverId, 'banned');
    });

    drawer.classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');

    if (d.last_lat && d.last_lng && typeof GoogleMaps !== 'undefined') {
        setTimeout(async function () {
            const mapEl = document.getElementById('driverMiniMap');
            if (!mapEl) return;
            miniMap = await GoogleMaps.createMap('driverMiniMap', [d.last_lat, d.last_lng], 13);
            GoogleMaps.createMarker(miniMap, [d.last_lat, d.last_lng], '🚚', { title: d.full_name || '' });
        }, 50);
    }
}

function kv(label, value) {
    return '<div class="kv-row"><span>' + label + '</span><span>' + escapeHtml(value === 0 ? '0' : (value || '—')) + '</span></div>';
}

async function setDriverVerification(driverId, status) {
    const { error } = await supabase.from('profiles').update({ verification_status: status }).eq('id', driverId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    await logAudit('Set driver verification to ' + status + ' (' + driverId.slice(0, 8) + ')', 'Drivers');
    closeDrawer();
    loadAll();
}

async function setAccountStatus(driverId, status) {
    const { error } = await supabase.from('profiles').update({ account_status: status }).eq('id', driverId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    await logAudit('Set driver account status to ' + status + ' (' + driverId.slice(0, 8) + ')', 'Drivers');
    closeDrawer();
    loadAll();
}

async function viewDriverDoc(path) {
    const { data, error } = await supabase.storage.from('driver-docs').createSignedUrl(path, 300);
    if (error) { alert('Failed to open document: ' + error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
}

function monthKeysLast6() {
    const months = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 5; i >= 0; i--) {
        const m = new Date(d);
        m.setMonth(m.getMonth() - i);
        months.push(m.toISOString().slice(0, 7));
    }
    return months;
}

function renderAnalytics() {
    const delivered = allJobs.filter(function (j) { return j.status === 'delivered' && j.delivered_at; });
    const rated = allJobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;
    const withDuration = delivered.filter(function (j) { return j.created_at && j.delivered_at; });
    let avgDeliveryLabel = '—';
    if (withDuration.length) {
        const avgMs = withDuration.reduce(function (s, j) { return s + (new Date(j.delivered_at) - new Date(j.created_at)); }, 0) / withDuration.length;
        const mins = Math.round(avgMs / 60000);
        avgDeliveryLabel = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + ' mins';
    }
    const lifetimeEarnings = delivered.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('analyticsCards').innerHTML =
        card('Total Deliveries', delivered.length) +
        card('Average Rating', avgRating ? avgRating.toFixed(1) + ' ★' : 'No ratings yet') +
        card('Average Delivery Time', avgDeliveryLabel) +
        card('Lifetime Earnings (all drivers)', 'R' + lifetimeEarnings.toLocaleString(undefined, { maximumFractionDigits: 2 }));

    if (typeof Chart === 'undefined') return;
    const months = monthKeysLast6();
    const deliveriesByMonth = {}, earningsByMonth = {};
    months.forEach(function (m) { deliveriesByMonth[m] = 0; earningsByMonth[m] = 0; });
    delivered.forEach(function (j) {
        const m = j.delivered_at.slice(0, 7);
        if (deliveriesByMonth[m] !== undefined) { deliveriesByMonth[m] += 1; earningsByMonth[m] += driverEarningForJob(j); }
    });
    const labels = months.map(function (m) { return m; });
    const chartTextColor = '#8891A0';
    const gridColor = 'rgba(237,239,243,0.08)';

    if (deliveriesChart) deliveriesChart.destroy();
    if (!delivered.length) {
        document.getElementById('deliveriesChart').replaceWith(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No completed deliveries yet.', id: 'deliveriesChart' }));
    } else {
        deliveriesChart = new Chart(document.getElementById('deliveriesChart'), {
            type: 'bar',
            data: { labels: labels, datasets: [{ label: 'Deliveries per Month', data: months.map(function (m) { return deliveriesByMonth[m]; }), backgroundColor: '#FF6A2B' }] },
            options: { responsive: true, plugins: { legend: { labels: { color: chartTextColor } } }, scales: { x: { ticks: { color: chartTextColor }, grid: { display: false } }, y: { ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
        });
    }

    if (earningsChart) earningsChart.destroy();
    if (!delivered.length) {
        document.getElementById('earningsChart').replaceWith(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No earnings recorded yet.', id: 'earningsChart' }));
    } else {
        earningsChart = new Chart(document.getElementById('earningsChart'), {
            type: 'line',
            data: { labels: labels, datasets: [{ label: 'Monthly Earnings', data: months.map(function (m) { return earningsByMonth[m]; }), borderColor: '#1E8E3E', backgroundColor: 'rgba(30,142,62,0.15)', fill: true, tension: 0.3 }] },
            options: { responsive: true, plugins: { legend: { labels: { color: chartTextColor } } }, scales: { x: { ticks: { color: chartTextColor }, grid: { display: false } }, y: { ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
        });
    }

    if (ratingChart) ratingChart.destroy();
    if (!rated.length) {
        document.getElementById('ratingChart').replaceWith(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No ratings yet.', id: 'ratingChart' }));
    } else {
        const ratingsByMonth = {};
        months.forEach(function (m) { ratingsByMonth[m] = []; });
        rated.forEach(function (j) {
            const m = (j.delivered_at || j.created_at).slice(0, 7);
            if (ratingsByMonth[m]) ratingsByMonth[m].push(j.rating);
        });
        ratingChart = new Chart(document.getElementById('ratingChart'), {
            type: 'line',
            data: {
                labels: labels, datasets: [{
                    label: 'Average Rating', data: months.map(function (m) {
                        const arr = ratingsByMonth[m];
                        return arr.length ? (arr.reduce(function (s, r) { return s + r; }, 0) / arr.length) : null;
                    }), borderColor: '#E8A33D', backgroundColor: 'rgba(232,163,61,0.15)', fill: true, tension: 0.3, spanGaps: true,
                }],
            },
            options: { responsive: true, plugins: { legend: { labels: { color: chartTextColor } } }, scales: { x: { ticks: { color: chartTextColor }, grid: { display: false } }, y: { min: 0, max: 5, ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
        });
    }
}
