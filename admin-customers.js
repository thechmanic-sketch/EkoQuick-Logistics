const CATEGORY_LABELS = {
    late_delivery: 'Late Delivery', rude_behaviour: 'Rude Behaviour', dangerous_driving: 'Dangerous Driving',
    damaged_package: 'Damaged Package', missing_package: 'Missing Package', wrong_delivery: 'Wrong Delivery',
    fraud: 'Fraud', poor_communication: 'Poor Communication', vehicle_hygiene: 'Vehicle Hygiene', other: 'Other',
};

let allCustomers = [];
let allJobs = [];
let allComplaints = [];
let allNotes = [];
let driversById = {};
let filteredCustomers = [];
let currentPage = 1;
let pageSize = 25;

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;

    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }
    window.currentAdminName = profile.full_name || profile.email || 'Admin';

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('exportBtn').addEventListener('click', function () { exportCustomers(filteredCustomers); });
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
    document.getElementById('customerSearch').addEventListener('input', function () { currentPage = 1; applyFilters(); });
    document.getElementById('statusFilter').addEventListener('change', function () { currentPage = 1; applyFilters(); });
    document.getElementById('pageSizeSelect').addEventListener('change', function () { pageSize = parseInt(this.value, 10); currentPage = 1; renderTable(); });

    await loadAll();
    openCustomerFromUrl();

    supabase.channel('customers-page-profiles').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadAll).subscribe();
    supabase.channel('customers-page-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll).subscribe();
    supabase.channel('customers-page-complaints').on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, loadAll).subscribe();
});

function openCustomerFromUrl() {
    const id = new URLSearchParams(window.location.search).get('customer');
    if (!id) return;
    const c = allCustomers.find(function (x) { return x.id === id; });
    if (c) openDrawer(c.id);
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-ZA');
}

function startOfMonth() {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
}

async function loadAll() {
    const { data: customers } = await supabase.from('profiles').select('*').eq('role', 'customer');
    const { data: jobs } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: drivers } = await supabase.from('profiles').select('id, full_name, phone').eq('role', 'driver');
    const { data: complaints } = await supabase.from('complaints').select('*');
    const { data: notes } = await supabase.from('customer_notes').select('*').order('created_at', { ascending: true });

    allCustomers = customers || [];
    allJobs = jobs || [];
    allComplaints = complaints || [];
    allNotes = notes || [];
    driversById = {};
    (drivers || []).forEach(function (d) { driversById[d.id] = d; });

    renderSummaryCards();
    applyFilters();
}

function customerJobs(customerId) {
    return allJobs.filter(function (j) { return j.customer_id === customerId; });
}

function customerStats(customerId) {
    const jobs = customerJobs(customerId);
    const completed = jobs.filter(function (j) { return j.status === 'delivered'; });
    const cancelled = jobs.filter(function (j) { return j.status === 'cancelled'; });
    const active = jobs.filter(function (j) { return j.status !== 'delivered' && j.status !== 'cancelled'; });
    const totalSpend = completed.reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0);
    const rated = jobs.filter(function (j) { return j.rating; });
    const avgRatingGiven = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;
    const lastOrder = jobs.length ? jobs.reduce(function (a, b) { return new Date(a.created_at) > new Date(b.created_at) ? a : b; }) : null;

    return {
        totalOrders: jobs.length, completed: completed.length, cancelled: cancelled.length, active: active.length,
        totalSpend: totalSpend, avgRatingGiven: avgRatingGiven, lastOrderAt: lastOrder ? lastOrder.created_at : null,
        reviewCount: rated.length,
    };
}

function renderSummaryCards() {
    const total = allCustomers.length;
    const monthStart = startOfMonth();
    const newThisMonth = allCustomers.filter(function (c) { return c.created_at && new Date(c.created_at) >= monthStart; }).length;
    const active = allCustomers.filter(function (c) { return c.account_status === 'active'; }).length;
    const returning = allCustomers.filter(function (c) { return customerJobs(c.id).length > 1; }).length;
    const withActiveJobs = allCustomers.filter(function (c) { return customerStats(c.id).active > 0; }).length;
    const complaintCustomerIds = new Set(allComplaints.map(function (x) { return x.customer_id; }));
    const withComplaints = allCustomers.filter(function (c) { return complaintCustomerIds.has(c.id); }).length;

    document.getElementById('customerCountLabel').textContent = total + ' customer' + (total === 1 ? '' : 's');

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('summaryCards').innerHTML =
        card('Total Customers', total) + card('New This Month', newThisMonth) + card('Active Customers', active) +
        card('Returning Customers', returning) + card('With Active Jobs', withActiveJobs) + card('With Complaints', withComplaints);
}

function applyFilters() {
    const q = document.getElementById('customerSearch').value.trim().toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const monthStart = startOfMonth();
    const complaintCustomerIds = new Set(allComplaints.map(function (x) { return x.customer_id; }));

    filteredCustomers = allCustomers.filter(function (c) {
        if (q) {
            const hay = ((c.full_name || '') + ' ' + (c.phone || '') + ' ' + (c.email || '') + ' ' + c.id + ' ' +
                customerJobs(c.id).map(function (j) { return j.id; }).join(' ')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        if (statusFilter === 'active' && c.account_status !== 'active') return false;
        if (statusFilter === 'new' && !(c.created_at && new Date(c.created_at) >= monthStart)) return false;
        if (statusFilter === 'returning' && customerJobs(c.id).length <= 1) return false;
        if (statusFilter === 'active-jobs' && customerStats(c.id).active === 0) return false;
        if (statusFilter === 'complaints' && !complaintCustomerIds.has(c.id)) return false;
        return true;
    });

    renderTable();
}

function renderTable() {
    const wrap = document.getElementById('customersTableWrap');
    if (!allCustomers.length) { wrap.innerHTML = '<div class="empty">No customers found.</div>'; document.getElementById('pagination').innerHTML = ''; return; }
    if (!filteredCustomers.length) { wrap.innerHTML = '<div class="empty">No customers match your filters.</div>'; document.getElementById('pagination').innerHTML = ''; return; }

    const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    const pageItems = filteredCustomers.slice(start, start + pageSize);

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr>' +
        '<th>Photo</th><th>Customer ID</th><th>Name</th><th>Phone</th><th>Email</th><th>Active Jobs</th><th>Completed</th>' +
        '<th>Total Orders</th><th>Total Spend</th><th>Avg Rating Given</th><th>Last Order</th><th>Status</th><th></th>' +
        '</tr></thead><tbody>' +
        pageItems.map(function (c) {
            const stats = customerStats(c.id);
            const statusBadge = c.account_status === 'active' ? 'delivered' : 'cancelled';
            return '<tr style="cursor:pointer;" data-customer="' + c.id + '">' +
                '<td>' + (c.avatar_url ? '<img src="' + escapeHtml(c.avatar_url) + '" style="width:28px;height:28px;object-fit:cover;border:1px solid var(--line);">' : '—') + '</td>' +
                '<td>' + c.id.slice(0, 8) + '</td>' +
                '<td>' + escapeHtml(c.full_name || '—') + '</td>' +
                '<td>' + escapeHtml(c.phone || '—') + '</td>' +
                '<td>' + escapeHtml(c.email || '—') + '</td>' +
                '<td>' + stats.active + '</td>' +
                '<td>' + stats.completed + '</td>' +
                '<td>' + stats.totalOrders + '</td>' +
                '<td>R' + stats.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 2 }) + '</td>' +
                '<td>' + (stats.avgRatingGiven ? stats.avgRatingGiven.toFixed(1) + ' ★' : '—') + '</td>' +
                '<td>' + formatDate(stats.lastOrderAt) + '</td>' +
                '<td><span class="badge ' + statusBadge + '">' + c.account_status + '</span></td>' +
                '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="open-drawer" data-customer="' + c.id + '">View</button></td>' +
                '</tr>';
        }).join('') +
        '</tbody></table>';

    wrap.querySelectorAll('tr[data-customer]').forEach(function (row) {
        row.addEventListener('click', function (e) { if (e.target.closest('button')) return; openDrawer(row.dataset.customer); });
    });
    wrap.querySelectorAll('button[data-action="open-drawer"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openDrawer(btn.dataset.customer); });
    });

    const pag = document.getElementById('pagination');
    pag.innerHTML =
        '<button class="btn btn-outline-blue" id="prevPage" style="width:auto;" ' + (currentPage <= 1 ? 'disabled' : '') + '>Prev</button>' +
        '<span class="meta">Page ' + currentPage + ' of ' + totalPages + ' (' + filteredCustomers.length + ' customers)</span>' +
        '<button class="btn btn-outline-blue" id="nextPage" style="width:auto;" ' + (currentPage >= totalPages ? 'disabled' : '') + '>Next</button>';
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    if (prevBtn) prevBtn.addEventListener('click', function () { currentPage--; renderTable(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { currentPage++; renderTable(); });
}

function closeDrawer() {
    document.getElementById('customerDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
}

function kv(label, value) {
    return '<div class="kv-row"><span>' + label + '</span><span>' + escapeHtml(value === 0 ? '0' : (value || '—')) + '</span></div>';
}

function whatsappLink(phone, message) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (!digits) return null;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message || '');
}

function openDrawer(customerId) {
    const c = allCustomers.find(function (x) { return x.id === customerId; });
    if (!c) return;
    const stats = customerStats(customerId);
    const jobs = customerJobs(customerId).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    const activeJobs = jobs.filter(function (j) { return j.status !== 'delivered' && j.status !== 'cancelled'; });
    const reviews = jobs.filter(function (j) { return j.rating; });
    const complaints = allComplaints.filter(function (x) { return x.customer_id === customerId; });
    const notes = allNotes.filter(function (n) { return n.customer_id === customerId; });

    const drawer = document.getElementById('customerDrawer');
    drawer.innerHTML =
        '<button class="drawer-close" id="closeDrawerBtn">✕</button>' +
        '<h2 style="margin-top:0;">' + escapeHtml(c.full_name || 'Customer') + '</h2>' +

        '<h3>Personal Information</h3>' +
        kv('Customer ID', c.id) + kv('Full Name', c.full_name) + kv('Phone', c.phone) + kv('Email', c.email) +
        kv('Date Joined', formatDate(c.created_at)) + kv('Account Status', c.account_status) +

        '<h3>Order Summary</h3>' +
        kv('Active Jobs', stats.active) + kv('Completed Jobs', stats.completed) + kv('Cancelled Jobs', stats.cancelled) +
        kv('Total Orders', stats.totalOrders) + kv('Lifetime Spend', 'R' + stats.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 2 })) +
        kv('Average Delivery Rating Given', stats.avgRatingGiven ? stats.avgRatingGiven.toFixed(1) + ' ★' : 'No ratings yet') +

        '<h3>Active Deliveries</h3>' +
        (activeJobs.length ? activeJobs.map(function (j) {
            const driver = driversById[j.driver_id];
            return '<div class="job" style="margin-bottom:8px;">' +
                kv('Job ID', j.id.slice(0, 8)) + kv('Assigned Driver', driver ? driver.full_name : '—') +
                kv('Status', j.status) +
                '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center; margin-top:6px; display:inline-block;" href="admin-fleet-map.html">Live Tracking</a>' +
                '</div>';
        }).join('') : '<div class="empty">No active deliveries.</div>') +

        '<h3>Order History</h3>' +
        (jobs.length ? '<table class="simple-table"><thead><tr><th>Order</th><th>Driver</th><th>Pickup</th><th>Drop-off</th><th>Fee</th><th>Status</th><th>Order Date</th><th>Delivered</th><th>Rating</th><th></th></tr></thead><tbody>' +
            jobs.slice(0, 30).map(function (j) {
                const driver = driversById[j.driver_id];
                return '<tr><td>' + j.id.slice(0, 8) + '</td><td>' + escapeHtml(driver ? driver.full_name : '—') + '</td>' +
                    '<td>' + escapeHtml(j.pickup) + '</td><td>' + escapeHtml(j.dropoff) + '</td>' +
                    '<td>R' + (Number(j.quote) || 0).toFixed(2) + '</td><td><span class="badge ' + j.status + '">' + j.status + '</span></td>' +
                    '<td>' + formatDate(j.created_at) + '</td><td>' + formatDate(j.delivered_at) + '</td>' +
                    '<td>' + (j.rating ? j.rating + ' ★' : '—') + '</td>' +
                    '<td><a href="admin-jobs.html?job=' + j.id + '">View Job</a></td></tr>';
            }).join('') + '</tbody></table>'
            : '<div class="empty">No completed orders.</div>') +

        '<h3>Reviews</h3>' +
        kv('Average Rating Given', stats.avgRatingGiven ? stats.avgRatingGiven.toFixed(1) + ' ★' : '—') + kv('Total Reviews Submitted', stats.reviewCount) +
        (reviews.length ? reviews.slice(0, 10).map(function (j) {
            const driver = driversById[j.driver_id];
            return '<div class="job" style="margin-top:8px;"><div>' + j.rating + ' ★ — ' + escapeHtml(driver ? driver.full_name : 'Unknown driver') + '</div>' +
                (j.rating_comment ? '<div class="meta">' + escapeHtml(j.rating_comment) + '</div>' : '') +
                '<div class="meta">' + formatDate(j.delivered_at || j.created_at) + ' · <a href="admin-jobs.html?job=' + j.id + '">View Job</a></div></div>';
        }).join('') : '<div class="empty">No reviews.</div>') +

        '<h3>Complaints</h3>' +
        kv('Total Complaints', complaints.length) +
        kv('Open Complaints', complaints.filter(function (x) { return x.status === 'open' || x.status === 'investigating'; }).length) +
        kv('Resolved Complaints', complaints.filter(function (x) { return x.status === 'resolved'; }).length) +
        (complaints.length ? '<table class="simple-table"><thead><tr><th>Complaint</th><th>Related Job</th><th>Category</th><th>Status</th><th>Date</th><th>Assigned</th></tr></thead><tbody>' +
            complaints.map(function (x) {
                return '<tr><td>' + x.id.slice(0, 8) + '</td><td>' + (x.job_id ? '<a href="admin-jobs.html?job=' + x.job_id + '">' + x.job_id.slice(0, 8) + '</a>' : '—') + '</td>' +
                    '<td>' + (CATEGORY_LABELS[x.category] || x.category) + '</td><td><span class="badge ' + (x.status === 'resolved' ? 'delivered' : x.status === 'dismissed' ? 'cancelled' : 'pending') + '">' + x.status + '</span></td>' +
                    '<td>' + formatDate(x.created_at) + '</td><td>' + escapeHtml(x.assigned_staff || '—') + '</td></tr>';
            }).join('') + '</tbody></table>'
            : '<div class="empty">No complaints.</div>') +

        '<h3>Account Activity</h3>' +
        '<div class="meta">' + buildActivityTimeline(c, jobs, reviews, complaints) + '</div>' +

        '<h3>Internal Notes</h3>' +
        '<div id="notesList">' + (notes.length ? notes.map(function (n) {
            return '<div class="meta" style="margin-bottom:6px;">' + escapeHtml(n.note) + '<br><span style="color:var(--muted-dim); font-size:11px;">' + escapeHtml(n.author || 'Admin') + ' · ' + formatTime(n.created_at) + '</span></div>';
        }).join('') : '<div class="empty">No internal notes yet.</div>') + '</div>' +
        '<textarea class="field-plain" id="newNoteText" rows="2" placeholder="e.g. VIP customer, requires special handling..." style="margin-top:6px;"></textarea>' +
        '<button class="btn btn-outline-blue" id="addNoteBtn" style="width:auto; margin-top:6px;">Add Note</button>' +

        '<h3>Actions</h3>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            (c.phone ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="tel:' + c.phone + '">Call</a>' : '') +
            (c.phone ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" target="_blank" href="' + whatsappLink(c.phone, 'Ekoquick — checking in.') + '">Message</a>' : '') +
            (c.account_status === 'active'
                ? '<button class="btn btn-outline-blue" style="width:auto;" data-action="block">Block Customer</button>'
                : '<button class="btn btn-blue" style="width:auto;" data-action="unblock">Unblock Customer</button>') +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="export">Export Customer History</button>' +
        '</div>';

    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    document.getElementById('addNoteBtn').addEventListener('click', function () { addCustomerNote(c.id); });
    const blockBtn = drawer.querySelector('button[data-action="block"]');
    if (blockBtn) blockBtn.addEventListener('click', function () { setCustomerStatus(c.id, 'banned'); });
    const unblockBtn = drawer.querySelector('button[data-action="unblock"]');
    if (unblockBtn) unblockBtn.addEventListener('click', function () { setCustomerStatus(c.id, 'active'); });
    const exportBtn = drawer.querySelector('button[data-action="export"]');
    if (exportBtn) exportBtn.addEventListener('click', function () { exportCustomerHistory(c, jobs); });

    drawer.classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');
}

function buildActivityTimeline(c, jobs, reviews, complaints) {
    const events = [];
    if (c.created_at) events.push({ time: c.created_at, label: 'Account created' });
    jobs.forEach(function (j) { events.push({ time: j.created_at, label: 'Order placed (' + j.pickup + ' → ' + j.dropoff + ')' }); });
    reviews.forEach(function (j) { events.push({ time: j.delivered_at || j.created_at, label: 'Review submitted (' + j.rating + ' ★)' }); });
    complaints.forEach(function (x) { events.push({ time: x.created_at, label: 'Complaint submitted (' + (CATEGORY_LABELS[x.category] || x.category) + ')' }); });
    events.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
    if (!events.length) return 'No activity recorded.';
    return events.slice(0, 20).map(function (e) { return escapeHtml(e.label) + ' — ' + formatTime(e.time); }).join('<br>');
}

async function addCustomerNote(customerId) {
    const text = document.getElementById('newNoteText').value.trim();
    if (!text) return;
    await supabase.from('customer_notes').insert({ customer_id: customerId, author: window.currentAdminName || 'Admin', note: text });
    await loadAll();
    openDrawer(customerId);
}

async function setCustomerStatus(customerId, status) {
    const { error } = await supabase.from('profiles').update({ account_status: status }).eq('id', customerId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    closeDrawer();
    loadAll();
}

function exportCustomers(customers) {
    if (!customers.length) { alert('No customers to export.'); return; }
    const headers = ['Customer ID', 'Name', 'Phone', 'Email', 'Active Jobs', 'Completed Jobs', 'Total Orders', 'Total Spend', 'Avg Rating Given', 'Last Order', 'Status'];
    const rows = customers.map(function (c) {
        const stats = customerStats(c.id);
        return [c.id, c.full_name || '', c.phone || '', c.email || '', stats.active, stats.completed, stats.totalOrders,
            stats.totalSpend.toFixed(2), stats.avgRatingGiven ? stats.avgRatingGiven.toFixed(1) : '', formatDate(stats.lastOrderAt), c.account_status]
            .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    });
    downloadCsv(headers.join(',') + '\n' + rows.join('\n'), 'ekoquick-customers-' + new Date().toISOString().slice(0, 10) + '.csv');
}

function exportCustomerHistory(customer, jobs) {
    const headers = ['Order ID', 'Pickup', 'Drop-off', 'Fee', 'Status', 'Order Date', 'Delivered', 'Rating'];
    const rows = jobs.map(function (j) {
        return [j.id, j.pickup, j.dropoff, j.quote || '', j.status, j.created_at, j.delivered_at || '', j.rating || '']
            .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    });
    downloadCsv(headers.join(',') + '\n' + rows.join('\n'), 'ekoquick-' + (customer.full_name || customer.id).replace(/[^a-z0-9]/gi, '-') + '-history.csv');
}

function downloadCsv(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
