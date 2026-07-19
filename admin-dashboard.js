const ONLINE_WINDOW_MS = 5 * 60 * 1000;
let revenueChart = null, ordersChart = null, successChart = null;
let realtimeStatus = 'connecting';

const EVENT_META = {
    new_order: { icon: '🆕', title: 'New order received' },
    accepted: { icon: '✅', title: 'Driver accepted job' },
    picked_up: { icon: '📦', title: 'Parcel picked up' },
    delivered: { icon: '🏁', title: 'Order delivered' },
    cancelled: { icon: '❌', title: 'Order cancelled' },
};

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;

    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }
    document.getElementById('adminName').textContent = profile.full_name || profile.email || '';

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('refreshBtn').addEventListener('click', loadDashboard);

    startClock();
    await loadDriverShare();
    await loadCommissionRules();
    await loadDashboard();

    supabase
        .channel('dashboard-jobs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadDashboard)
        .subscribe(function (status) { realtimeStatus = status; renderSystemStatus(); });

    supabase
        .channel('dashboard-profiles')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadDashboard)
        .subscribe();

    setInterval(loadDashboard, 20000);
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function startClock() {
    function tick() {
        document.getElementById('clockDisplay').textContent = new Date().toLocaleString('en-ZA', {
            weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
    }
    tick();
    setInterval(tick, 1000);
}

function isOnline(driver) {
    return !!(driver.last_seen_at && (Date.now() - new Date(driver.last_seen_at).getTime()) < ONLINE_WINDOW_MS);
}

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}
function startOfWeek() {
    const d = startOfToday();
    d.setDate(d.getDate() - d.getDay());
    return d;
}
function startOfMonth() {
    const d = startOfToday();
    d.setDate(1);
    return d;
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : '';
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let lastLoadOk = null;
let lastSyncAt = null;

async function loadDashboard() {
    const { data: jobs, error: jobsError } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: drivers, error: driversError } = await supabase.from('profiles').select('*').eq('role', 'driver');
    const { data: customers } = await supabase.from('profiles').select('id').eq('role', 'customer');

    lastLoadOk = !jobsError && !driversError;
    lastSyncAt = new Date();

    if (jobsError) { renderSystemStatus(); return; }

    await autoAssignPending(jobs || [], drivers || []);

    renderKpis(jobs || [], drivers || [], (customers || []).length);
    renderActivityFeed(jobs || [], drivers || []);
    renderCharts(jobs || []);
    renderRecentOrders(jobs || [], drivers || []);
    renderDriverStatus(jobs || [], drivers || []);
    renderSystemStatus(drivers || []);
    renderBell(jobs || []);
}

function renderBell(jobs) {
    const complaints = jobs.filter(function (j) { return j.rating && j.rating <= 2; }).length;
    const el = document.getElementById('bellCount');
    if (complaints > 0) { el.textContent = complaints; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
}

function kpiCard(title, value, sub, subClass) {
    return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div>' +
        (sub ? '<div class="kpi-sub' + (subClass ? ' ' + subClass : '') + '">' + sub + '</div>' : '') + '</div>';
}

function renderKpis(jobs, drivers, customerCount) {
    const todayStart = startOfToday();
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();

    const ordersToday = jobs.filter(function (j) { return new Date(j.created_at) >= todayStart; });
    const ordersYesterday = jobs.filter(function (j) { return new Date(j.created_at) >= yesterdayStart && new Date(j.created_at) < todayStart; });
    const diff = ordersToday.length - ordersYesterday.length;
    const diffLabel = ordersYesterday.length === 0 && ordersToday.length === 0 ? '' :
        (diff >= 0 ? '+' : '') + diff + ' vs yesterday';

    const pending = jobs.filter(function (j) { return j.status === 'pending'; }).length;
    const toPickup = jobs.filter(function (j) { return j.status === 'to_pickup'; }).length;
    const toDropoff = jobs.filter(function (j) { return j.status === 'to_dropoff'; }).length;

    const deliveredToday = jobs.filter(function (j) { return j.delivered_at && new Date(j.delivered_at) >= todayStart; });
    const cancelledToday = jobs.filter(function (j) { return (j.cancelled_at && new Date(j.cancelled_at) >= todayStart) || (j.status === 'cancelled' && !j.cancelled_at && new Date(j.created_at) >= todayStart); });

    const deliveredAll = jobs.filter(function (j) { return j.status === 'delivered' && j.delivered_at; });
    const revToday = deliveredAll.filter(function (j) { return new Date(j.delivered_at) >= todayStart; }).reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0);
    const revWeek = deliveredAll.filter(function (j) { return new Date(j.delivered_at) >= weekStart; }).reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0);
    const revMonth = deliveredAll.filter(function (j) { return new Date(j.delivered_at) >= monthStart; }).reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0);

    const activeJobDriverIds = jobs.filter(function (j) { return j.status === 'to_pickup' || j.status === 'to_dropoff'; }).map(function (j) { return j.driver_id; });
    const online = drivers.filter(isOnline);
    const busy = online.filter(function (d) { return activeJobDriverIds.indexOf(d.id) !== -1; });
    const offline = drivers.filter(function (d) { return !isOnline(d); });

    const rated = jobs.filter(function (j) { return j.rating; });
    const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length).toFixed(1) + ' ★' : 'No ratings yet';

    const withDuration = deliveredAll.filter(function (j) { return j.created_at && j.delivered_at; });
    let avgDeliveryLabel = '—';
    if (withDuration.length) {
        const avgMs = withDuration.reduce(function (s, j) { return s + (new Date(j.delivered_at) - new Date(j.created_at)); }, 0) / withDuration.length;
        const mins = Math.round(avgMs / 60000);
        avgDeliveryLabel = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + ' mins';
    }

    document.getElementById('kpiGrid').innerHTML =
        kpiCard('Orders Today', ordersToday.length, diffLabel, diff >= 0 ? 'up' : 'down') +
        kpiCard('Pending Orders', pending) +
        kpiCard('Active Deliveries', toPickup + toDropoff, 'Pickup: ' + toPickup + ' · Drop-off: ' + toDropoff) +
        kpiCard('Completed Today', deliveredToday.length) +
        kpiCard('Cancelled Today', cancelledToday.length) +
        kpiCard('Revenue Today', 'R' + revToday.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kpiCard('Revenue This Week', 'R' + revWeek.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kpiCard('Revenue This Month', 'R' + revMonth.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kpiCard('Drivers Online', online.length) +
        kpiCard('Drivers Busy', busy.length) +
        kpiCard('Drivers Offline', offline.length) +
        kpiCard('Average Rating', avgRating) +
        kpiCard('Total Customers', customerCount) +
        kpiCard('Average Delivery Time', avgDeliveryLabel);
}

function renderActivityFeed(jobs, drivers) {
    const el = document.getElementById('activityFeed');
    const nameById = {};
    drivers.forEach(function (d) { nameById[d.id] = d.full_name; });

    const events = [];
    jobs.forEach(function (j) {
        events.push({ time: j.created_at, type: 'new_order', job: j });
        if (j.to_pickup_at) events.push({ time: j.to_pickup_at, type: 'accepted', job: j });
        if (j.to_dropoff_at) events.push({ time: j.to_dropoff_at, type: 'picked_up', job: j });
        if (j.delivered_at) events.push({ time: j.delivered_at, type: 'delivered', job: j });
        if (j.cancelled_at) events.push({ time: j.cancelled_at, type: 'cancelled', job: j });
    });
    events.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

    if (!events.length) { el.innerHTML = '<div class="empty">No orders yet today.</div>'; return; }

    el.innerHTML = events.slice(0, 20).map(function (e) {
        const meta = EVENT_META[e.type];
        const driverName = e.job.driver_id ? (nameById[e.job.driver_id] || 'Driver') : null;
        return (
            '<div class="activity-item">' +
                '<span class="activity-icon">' + meta.icon + '</span>' +
                '<div>' +
                    '<div>' + meta.title + ' — ' + escapeHtml(e.job.pickup) + ' → ' + escapeHtml(e.job.dropoff) + '</div>' +
                    '<div class="activity-time">' + (driverName ? escapeHtml(driverName) + ' · ' : '') +
                        (e.job.customer_phone ? escapeHtml(e.job.customer_phone) + ' · ' : '') +
                        new Date(e.time).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }).join('');
}

function dayKeysLast30() {
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
}

function renderCharts(jobs) {
    if (typeof Chart === 'undefined') return;
    const days = dayKeysLast30();

    const revenueByDay = {};
    const ordersByDay = {};
    days.forEach(function (d) { revenueByDay[d] = 0; ordersByDay[d] = { completed: 0, pending: 0, cancelled: 0 }; });

    jobs.forEach(function (j) {
        const createdDay = j.created_at ? j.created_at.slice(0, 10) : null;
        if (createdDay && ordersByDay[createdDay]) {
            if (j.status === 'delivered') ordersByDay[createdDay].completed += 1;
            else if (j.status === 'cancelled') ordersByDay[createdDay].cancelled += 1;
            else ordersByDay[createdDay].pending += 1;
        }
        if (j.status === 'delivered' && j.delivered_at) {
            const d = j.delivered_at.slice(0, 10);
            if (revenueByDay[d] !== undefined) revenueByDay[d] += Number(j.quote) || 0;
        }
    });

    const labels = days.map(function (d) { return d.slice(5); });
    const chartTextColor = '#8891A0';
    const gridColor = 'rgba(237,239,243,0.08)';

    if (revenueChart) revenueChart.destroy();
    revenueChart = new Chart(document.getElementById('revenueChart'), {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Revenue', data: days.map(function (d) { return revenueByDay[d]; }), borderColor: '#FF6A2B', backgroundColor: 'rgba(255,106,43,0.15)', fill: true, tension: 0.3, pointRadius: 0 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: chartTextColor, maxTicksLimit: 8 }, grid: { color: gridColor } }, y: { ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
    });

    if (ordersChart) ordersChart.destroy();
    ordersChart = new Chart(document.getElementById('ordersChart'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Completed', data: days.map(function (d) { return ordersByDay[d].completed; }), backgroundColor: '#1E8E3E' },
                { label: 'Pending', data: days.map(function (d) { return ordersByDay[d].pending; }), backgroundColor: '#E8A33D' },
                { label: 'Cancelled', data: days.map(function (d) { return ordersByDay[d].cancelled; }), backgroundColor: '#D93025' },
            ],
        },
        options: { responsive: true, plugins: { legend: { labels: { color: chartTextColor } } }, scales: { x: { stacked: true, ticks: { color: chartTextColor, maxTicksLimit: 8 }, grid: { display: false } }, y: { stacked: true, ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
    });

    const deliveredCount = jobs.filter(function (j) { return j.status === 'delivered'; }).length;
    const cancelledCount = jobs.filter(function (j) { return j.status === 'cancelled'; }).length;
    if (successChart) successChart.destroy();
    if (deliveredCount + cancelledCount === 0) {
        document.getElementById('successChart').replaceWith(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No completed or cancelled orders yet.', id: 'successChart' }));
        return;
    }
    successChart = new Chart(document.getElementById('successChart'), {
        type: 'doughnut',
        data: { labels: ['Delivered', 'Cancelled'], datasets: [{ data: [deliveredCount, cancelledCount], backgroundColor: ['#1E8E3E', '#D93025'] }] },
        options: { plugins: { legend: { labels: { color: chartTextColor } } } },
    });
}

function renderRecentOrders(jobs, drivers) {
    const el = document.getElementById('recentOrders');
    if (!jobs.length) { el.innerHTML = '<div class="empty">No orders yet today.</div>'; return; }

    const nameById = {};
    drivers.forEach(function (d) { nameById[d.id] = d.full_name; });

    const recent = jobs.slice(0, 10);
    el.innerHTML =
        '<table class="simple-table"><thead><tr><th>Order</th><th>Customer</th><th>Driver</th><th>Route</th><th>Status</th><th>Created</th></tr></thead><tbody>' +
        recent.map(function (j) {
            return '<tr>' +
                '<td>' + j.id.slice(0, 8) + '</td>' +
                '<td>' + escapeHtml(j.customer_phone || '—') + '</td>' +
                '<td>' + escapeHtml(j.driver_id ? (nameById[j.driver_id] || '—') : '—') + '</td>' +
                '<td>' + escapeHtml(j.pickup) + ' → ' + escapeHtml(j.dropoff) + '</td>' +
                '<td><span class="badge ' + j.status + '">' + j.status + '</span></td>' +
                '<td>' + new Date(j.created_at).toLocaleDateString('en-ZA') + '</td>' +
                '</tr>';
        }).join('') +
        '</tbody></table>';
}

function renderDriverStatus(jobs, drivers) {
    const el = document.getElementById('driverStatusPanel');
    const activeByDriver = {};
    jobs.forEach(function (j) {
        if (j.status === 'to_pickup' || j.status === 'to_dropoff') activeByDriver[j.driver_id] = j;
    });

    const activeDrivers = drivers.filter(function (d) { return activeByDriver[d.id]; });
    if (!activeDrivers.length) { el.innerHTML = '<div class="empty">No drivers currently on a delivery.</div>'; return; }

    const ratingsByDriver = {};
    jobs.forEach(function (j) {
        if (j.driver_id && j.rating) {
            if (!ratingsByDriver[j.driver_id]) ratingsByDriver[j.driver_id] = [];
            ratingsByDriver[j.driver_id].push(j.rating);
        }
    });

    el.innerHTML = activeDrivers.map(function (d) {
        const job = activeByDriver[d.id];
        const destLat = job.status === 'to_pickup' ? job.pickup_lat : job.dropoff_lat;
        const destLng = job.status === 'to_pickup' ? job.pickup_lng : job.dropoff_lng;
        let eta = '—';
        if (job.driver_lat && job.driver_lng && destLat && destLng) {
            const km = haversineKm(job.driver_lat, job.driver_lng, destLat, destLng);
            eta = Math.round((km / 30) * 60) + ' min';
        }
        const ratings = ratingsByDriver[d.id];
        const avgRating = ratings ? (ratings.reduce(function (s, r) { return s + r; }, 0) / ratings.length).toFixed(1) : '—';

        return (
            '<div class="job">' +
                '<div style="display:flex; align-items:center; gap:10px;">' +
                    (d.avatar_url ? '<img src="' + escapeHtml(d.avatar_url) + '" style="width:32px; height:32px; object-fit:cover; border:1px solid var(--line);">' : '') +
                    '<div class="route">' + escapeHtml(d.full_name) + '</div>' +
                '</div>' +
                '<div class="meta">' + vehicleLabel(d.vehicle_class) + ' • ' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.status === 'to_pickup' ? 'Heading to pickup' : 'Heading to drop-off') + ' • ETA ' + eta + ' • Rating ' + avgRating + '</div>' +
            '</div>'
        );
    }).join('');
}

function renderSystemStatus(drivers) {
    drivers = drivers || [];
    const dbOk = lastLoadOk !== false;
    const realtimeOk = realtimeStatus === 'SUBSCRIBED';
    const gpsActive = drivers.some(isOnline);

    function pill(label, ok, warn) {
        const dot = ok ? 'green' : (warn ? 'yellow' : 'red');
        const text = ok ? 'Operational' : (warn ? 'Warning' : 'Offline');
        return '<div class="status-pill"><span class="status-dot ' + dot + '"></span>' + label + ': ' + text + '</div>';
    }

    document.getElementById('systemStatus').innerHTML =
        pill('API', dbOk) +
        pill('Database', dbOk) +
        pill('Realtime', realtimeOk, true) +
        pill('GPS Tracking', gpsActive, true) +
        '<div class="status-pill"><span class="status-dot ' + (dbOk ? 'green' : 'red') + '"></span>Last sync: ' + (lastSyncAt ? lastSyncAt.toLocaleTimeString('en-ZA') : '—') + '</div>';
}

let autoAssigning = false;
async function autoAssignPending(jobs, drivers) {
    if (autoAssigning) return;
    const unassigned = jobs.filter(function (j) { return j.status === 'pending' && !j.driver_id; });
    if (!unassigned.length) return;

    autoAssigning = true;
    try {
        const busyDriverIds = jobs
            .filter(function (j) { return j.driver_id && (j.status === 'offered' || j.status === 'to_pickup' || j.status === 'to_dropoff'); })
            .map(function (j) { return j.driver_id; });

        for (const job of unassigned) {
            const candidates = drivers.filter(function (d) {
                return d.vehicle_class === job.vehicle && d.verification_status === 'approved' &&
                    d.account_status === 'active' && busyDriverIds.indexOf(d.id) === -1;
            });
            if (!candidates.length) continue;

            let chosen = candidates[0];
            if (job.pickup_lat && job.pickup_lng) {
                const withDistance = candidates
                    .filter(function (d) { return d.last_lat && d.last_lng; })
                    .map(function (d) { return { driver: d, dist: haversineKm(job.pickup_lat, job.pickup_lng, d.last_lat, d.last_lng) }; })
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
