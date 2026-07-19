let allJobs = [];
let allDrivers = [];
let allCustomers = [];
let driversById = {};
let customersById = {};
let filteredTxns = [];
let txnPage = 1;
const TXN_PAGE_SIZE = 25;
let activePeriod = 'today';
let revenueTrendChart = null, volumeChart = null, avgFeeChart = null, revenueVsRefundsChart = null;
let allPayouts = [];
let payoutWeekStart = startOfWeekDate(new Date());

function startOfWeekDate(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }

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
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
    document.getElementById('txnSearch').addEventListener('input', function () { txnPage = 1; applyTxnFilters(); });
    document.getElementById('txnStatusFilter').addEventListener('change', function () { txnPage = 1; applyTxnFilters(); });
    document.getElementById('txnDriverFilter').addEventListener('change', function () { txnPage = 1; applyTxnFilters(); });
    document.getElementById('txnPaymentMethodFilter').addEventListener('change', function () { txnPage = 1; applyTxnFilters(); });
    document.getElementById('txnDateFrom').addEventListener('change', function () { txnPage = 1; applyTxnFilters(); });
    document.getElementById('txnDateTo').addEventListener('change', function () { txnPage = 1; applyTxnFilters(); });
    document.getElementById('exportTxnBtn').addEventListener('click', function () { exportTransactions(filteredTxns); });
    document.getElementById('exportDriverEarningsBtn').addEventListener('click', exportDriverEarnings);
    document.getElementById('exportRefundsBtn').addEventListener('click', exportRefunds);
    document.getElementById('prevWeekBtn').addEventListener('click', function () { payoutWeekStart.setDate(payoutWeekStart.getDate() - 7); renderPayouts(); });
    document.getElementById('nextWeekBtn').addEventListener('click', function () { payoutWeekStart.setDate(payoutWeekStart.getDate() + 7); renderPayouts(); });

    document.querySelectorAll('.period-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.period-tab').forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            activePeriod = tab.dataset.period;
            renderPeriodRevenue();
        });
    });
    document.querySelectorAll('button[data-report]').forEach(function (btn) {
        btn.addEventListener('click', function () { generateReport(btn.dataset.report); });
    });

    await loadDriverShare();
    await loadCommissionRules();
    await loadAll();

    supabase.channel('finances-page-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll).subscribe();
});

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

function money(n) { return 'R' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek() { const d = startOfToday(); d.setDate(d.getDate() - d.getDay()); return d; }
function startOfMonth() { const d = startOfToday(); d.setDate(1); return d; }

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

function netRevenue(job) {
    const gross = Number(job.quote) || 0;
    const refund = job.refunded ? (Number(job.refund_amount) || gross) : 0;
    return gross - refund;
}

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: drivers } = await supabase.from('profiles').select('*').eq('role', 'driver');
    const { data: customers } = await supabase.from('profiles').select('*').eq('role', 'customer');
    const { data: payouts } = await supabase.from('driver_payouts').select('*').order('created_at', { ascending: false });

    allJobs = jobs || [];
    allDrivers = drivers || [];
    allCustomers = customers || [];
    allPayouts = payouts || [];
    driversById = {};
    allDrivers.forEach(function (d) { driversById[d.id] = d; });
    customersById = {};
    allCustomers.forEach(function (c) { customersById[c.id] = c; });

    populateDriverFilter();
    renderSummaryCards();
    renderPeriodRevenue();
    renderCharts();
    renderDriverEarnings();
    applyTxnFilters();
    renderPaymentMethods();
    renderPayouts();
    renderPayoutHistory();
    renderRefunds();
    renderTopDrivers();
    renderTopCustomers();
}

function populateDriverFilter() {
    const sel = document.getElementById('txnDriverFilter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All drivers</option>' + allDrivers.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + '</option>';
    }).join('');
    sel.value = current;
}

function deliveredJobs() { return allJobs.filter(function (j) { return j.status === 'delivered'; }); }

function renderSummaryCards() {
    const delivered = deliveredJobs();
    const todayStart = startOfToday(), weekStart = startOfWeek(), monthStart = startOfMonth();

    const revToday = delivered.filter(function (j) { return new Date(j.delivered_at) >= todayStart; }).reduce(function (s, j) { return s + netRevenue(j); }, 0);
    const revWeek = delivered.filter(function (j) { return new Date(j.delivered_at) >= weekStart; }).reduce(function (s, j) { return s + netRevenue(j); }, 0);
    const revMonth = delivered.filter(function (j) { return new Date(j.delivered_at) >= monthStart; }).reduce(function (s, j) { return s + netRevenue(j); }, 0);
    const revLifetime = delivered.reduce(function (s, j) { return s + netRevenue(j); }, 0);
    const earningsToday = delivered.filter(function (j) { return new Date(j.delivered_at) >= todayStart; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const commission = delivered.reduce(function (s, j) { return s + platformFeeForJob(j); }, 0);
    const avgFee = delivered.length ? delivered.reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0) / delivered.length : 0;

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('summaryCards').innerHTML =
        card('Revenue Today', money(revToday)) + card('Revenue This Week', money(revWeek)) + card('Revenue This Month', money(revMonth)) +
        card('Total Revenue (Lifetime)', money(revLifetime)) + card('Driver Earnings Today', money(earningsToday)) +
        card('Platform Commission', money(commission)) + card('Average Delivery Fee', money(avgFee)) + card('Total Completed Deliveries', delivered.length);
}

function renderPeriodRevenue() {
    const delivered = deliveredJobs();
    const todayStart = startOfToday();
    let jobs;
    if (activePeriod === 'today') jobs = delivered.filter(function (j) { return new Date(j.delivered_at) >= todayStart; });
    else if (activePeriod === 'yesterday') {
        const yStart = new Date(todayStart); yStart.setDate(yStart.getDate() - 1);
        jobs = delivered.filter(function (j) { return new Date(j.delivered_at) >= yStart && new Date(j.delivered_at) < todayStart; });
    } else if (activePeriod === 'week') jobs = delivered.filter(function (j) { return new Date(j.delivered_at) >= startOfWeek(); });
    else jobs = delivered.filter(function (j) { return new Date(j.delivered_at) >= startOfMonth(); });

    const rev = jobs.reduce(function (s, j) { return s + netRevenue(j); }, 0);
    document.getElementById('periodRevenue').textContent = jobs.length ? money(rev) : 'No revenue for selected period.';
}

function dayKeysLast30() {
    const days = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
    return days;
}

function renderCharts() {
    if (typeof Chart === 'undefined') return;
    const days = dayKeysLast30();
    const delivered = deliveredJobs();
    const labels = days.map(function (d) { return d.slice(5); });
    const chartTextColor = '#8891A0';
    const gridColor = 'rgba(237,239,243,0.08)';

    const revenueByDay = {}, volumeByDay = {}, refundByDay = {}, feeSumByDay = {}, feeCountByDay = {};
    days.forEach(function (d) { revenueByDay[d] = 0; volumeByDay[d] = 0; refundByDay[d] = 0; feeSumByDay[d] = 0; feeCountByDay[d] = 0; });
    delivered.forEach(function (j) {
        if (!j.delivered_at) return;
        const d = j.delivered_at.slice(0, 10);
        if (revenueByDay[d] === undefined) return;
        revenueByDay[d] += netRevenue(j);
        volumeByDay[d] += 1;
        feeSumByDay[d] += Number(j.quote) || 0;
        feeCountByDay[d] += 1;
        if (j.refunded) refundByDay[d] += (Number(j.refund_amount) || Number(j.quote) || 0);
    });

    if (!delivered.length) {
        ['revenueTrendChart', 'volumeChart', 'avgFeeChart', 'revenueVsRefundsChart'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.replaceWith(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No completed deliveries.', id: id }));
        });
        return;
    }

    if (revenueTrendChart) revenueTrendChart.destroy();
    revenueTrendChart = new Chart(document.getElementById('revenueTrendChart'), {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Revenue Trend', data: days.map(function (d) { return revenueByDay[d]; }), borderColor: '#FF6A2B', backgroundColor: 'rgba(255,106,43,0.15)', fill: true, tension: 0.3, pointRadius: 0 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: chartTextColor, maxTicksLimit: 8 }, grid: { color: gridColor } }, y: { ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
    });

    if (volumeChart) volumeChart.destroy();
    volumeChart = new Chart(document.getElementById('volumeChart'), {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Delivery Volume', data: days.map(function (d) { return volumeByDay[d]; }), backgroundColor: '#1A73E8' }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: chartTextColor, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
    });

    if (avgFeeChart) avgFeeChart.destroy();
    avgFeeChart = new Chart(document.getElementById('avgFeeChart'), {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Average Delivery Fee', data: days.map(function (d) { return feeCountByDay[d] ? feeSumByDay[d] / feeCountByDay[d] : null; }), borderColor: '#E8A33D', backgroundColor: 'rgba(232,163,61,0.15)', fill: true, tension: 0.3, spanGaps: true }] },
        options: { responsive: true, plugins: { legend: { labels: { color: chartTextColor } } }, scales: { x: { ticks: { color: chartTextColor, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
    });

    if (revenueVsRefundsChart) revenueVsRefundsChart.destroy();
    revenueVsRefundsChart = new Chart(document.getElementById('revenueVsRefundsChart'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Revenue', data: days.map(function (d) { return revenueByDay[d]; }), backgroundColor: '#1E8E3E' },
                { label: 'Refunds', data: days.map(function (d) { return refundByDay[d]; }), backgroundColor: '#D93025' },
            ],
        },
        options: { responsive: true, plugins: { legend: { labels: { color: chartTextColor } } }, scales: { x: { ticks: { color: chartTextColor, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: chartTextColor }, grid: { color: gridColor } } } },
    });
}

function driverEarningsRow(driverId) {
    const jobs = deliveredJobs().filter(function (j) { return j.driver_id === driverId; });
    const todayStart = startOfToday(), weekStart = startOfWeek(), monthStart = startOfMonth();
    const earningsToday = jobs.filter(function (j) { return new Date(j.delivered_at) >= todayStart; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const earningsWeek = jobs.filter(function (j) { return new Date(j.delivered_at) >= weekStart; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const earningsMonth = jobs.filter(function (j) { return new Date(j.delivered_at) >= monthStart; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const lifetime = jobs.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    return { deliveries: jobs.length, earningsToday: earningsToday, earningsWeek: earningsWeek, earningsMonth: earningsMonth, lifetime: lifetime, avgPerDelivery: jobs.length ? lifetime / jobs.length : 0 };
}

function renderDriverEarnings() {
    const el = document.getElementById('driverEarningsWrap');
    if (!allDrivers.length) { el.innerHTML = '<div class="empty">No drivers on file.</div>'; return; }

    const rows = allDrivers.map(function (d) { return { driver: d, row: driverEarningsRow(d.id) }; })
        .filter(function (r) { return r.row.deliveries > 0; })
        .sort(function (a, b) { return b.row.lifetime - a.row.lifetime; });

    if (!rows.length) { el.innerHTML = '<div class="empty">No completed deliveries.</div>'; return; }

    el.innerHTML =
        '<table class="simple-table"><thead><tr><th>Driver</th><th>Completed Deliveries</th><th>Earnings Today</th><th>Earnings This Week</th><th>Earnings This Month</th><th>Lifetime Earnings</th><th>Avg Per Delivery</th><th>Actions</th></tr></thead><tbody>' +
        rows.map(function (r) {
            return '<tr><td>' + escapeHtml(r.driver.full_name || r.driver.id) + '</td><td>' + r.row.deliveries + '</td>' +
                '<td>' + money(r.row.earningsToday) + '</td><td>' + money(r.row.earningsWeek) + '</td><td>' + money(r.row.earningsMonth) + '</td>' +
                '<td>' + money(r.row.lifetime) + '</td><td>' + money(r.row.avgPerDelivery) + '</td>' +
                '<td><a href="admin-drivers.html?driver=' + r.driver.id + '">View Driver</a></td></tr>';
        }).join('') +
        '</tbody></table>';
}

function txnStatus(job) {
    if (job.status === 'cancelled') return 'cancelled';
    if (job.refunded) return 'refunded';
    return 'completed';
}

function applyTxnFilters() {
    const q = document.getElementById('txnSearch').value.trim().toLowerCase();
    const statusFilter = document.getElementById('txnStatusFilter').value;
    const driverFilter = document.getElementById('txnDriverFilter').value;
    const paymentMethodFilter = document.getElementById('txnPaymentMethodFilter').value;
    const dateFrom = document.getElementById('txnDateFrom').value;
    const dateTo = document.getElementById('txnDateTo').value;

    filteredTxns = allJobs.filter(function (j) { return j.status === 'delivered' || j.status === 'cancelled'; }).filter(function (j) {
        const status = txnStatus(j);
        if (statusFilter && status !== statusFilter) return false;
        if (driverFilter && j.driver_id !== driverFilter) return false;
        if (paymentMethodFilter && j.payment_method !== paymentMethodFilter) return false;
        if (dateFrom && new Date(j.created_at) < new Date(dateFrom)) return false;
        if (dateTo && new Date(j.created_at) > new Date(dateTo + 'T23:59:59')) return false;
        if (q) {
            const driver = driversById[j.driver_id];
            const customer = customersById[j.customer_id];
            const hay = (j.id + ' ' + (driver ? driver.full_name : '') + ' ' + (customer ? customer.full_name : '') + ' ' + (j.customer_phone || '')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    });

    renderTxnTable();
}

function renderTxnTable() {
    const wrap = document.getElementById('txnTableWrap');
    if (!filteredTxns.length) { wrap.innerHTML = '<div class="empty">No transactions found.</div>'; document.getElementById('txnPagination').innerHTML = ''; return; }

    const totalPages = Math.max(1, Math.ceil(filteredTxns.length / TXN_PAGE_SIZE));
    if (txnPage > totalPages) txnPage = totalPages;
    const start = (txnPage - 1) * TXN_PAGE_SIZE;
    const pageItems = filteredTxns.slice(start, start + TXN_PAGE_SIZE);

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr><th>Transaction ID</th><th>Job ID</th><th>Customer</th><th>Driver</th><th>Fee</th><th>Commission</th><th>Driver Earnings</th><th>Payment Method</th><th>Status</th><th>Date</th></tr></thead><tbody>' +
        pageItems.map(function (j) {
            const driver = driversById[j.driver_id];
            const customer = customersById[j.customer_id];
            const status = txnStatus(j);
            const badge = status === 'completed' ? 'delivered' : status === 'refunded' ? 'pending' : 'cancelled';
            return '<tr style="cursor:pointer;" data-job="' + j.id + '">' +
                '<td>' + j.id.slice(0, 8) + '</td><td>' + j.id.slice(0, 8) + '</td>' +
                '<td>' + escapeHtml(customer ? customer.full_name : (j.customer_phone || '—')) + '</td>' +
                '<td>' + escapeHtml(driver ? driver.full_name : '—') + '</td>' +
                '<td>' + money(j.quote) + '</td><td>' + money(platformFeeForJob(j)) + '</td><td>' + money(driverEarningForJob(j)) + '</td>' +
                '<td>' + paymentMethodLabel(j.payment_method) + '</td>' +
                '<td><span class="badge ' + badge + '">' + status + '</span></td>' +
                '<td>' + formatDate(j.created_at) + '</td></tr>';
        }).join('') +
        '</tbody></table>';

    wrap.querySelectorAll('tr[data-job]').forEach(function (row) {
        row.addEventListener('click', function () { openTxnDrawer(row.dataset.job); });
    });

    const pag = document.getElementById('txnPagination');
    pag.innerHTML =
        '<button class="btn btn-outline-blue" id="txnPrev" style="width:auto;" ' + (txnPage <= 1 ? 'disabled' : '') + '>Prev</button>' +
        '<span class="meta">Page ' + txnPage + ' of ' + totalPages + ' (' + filteredTxns.length + ')</span>' +
        '<button class="btn btn-outline-blue" id="txnNext" style="width:auto;" ' + (txnPage >= totalPages ? 'disabled' : '') + '>Next</button>';
    const prevBtn = document.getElementById('txnPrev');
    const nextBtn = document.getElementById('txnNext');
    if (prevBtn) prevBtn.addEventListener('click', function () { txnPage--; renderTxnTable(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { txnPage++; renderTxnTable(); });
}

function closeDrawer() {
    document.getElementById('txnDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
}

function kv(label, value) {
    return '<div class="kv-row"><span>' + label + '</span><span>' + escapeHtml(value === 0 ? '0' : (value || '—')) + '</span></div>';
}

function openTxnDrawer(jobId) {
    const j = allJobs.find(function (x) { return x.id === jobId; });
    if (!j) return;
    const driver = driversById[j.driver_id];
    const customer = customersById[j.customer_id];
    const status = txnStatus(j);

    const drawer = document.getElementById('txnDrawer');
    drawer.innerHTML =
        '<button class="drawer-close" id="closeDrawerBtn">✕</button>' +
        '<h2 style="margin-top:0;">Transaction ' + j.id.slice(0, 8) + '</h2>' +

        '<h3>General</h3>' +
        kv('Transaction ID', j.id) + kv('Job ID', j.id) + kv('Date & Time', formatTime(j.created_at)) +

        '<h3>Customer</h3>' +
        kv('Name', customer ? customer.full_name : '—') + kv('Phone', j.customer_phone || (customer ? customer.phone : '—')) +

        '<h3>Driver</h3>' +
        (driver ? kv('Name', driver.full_name) + kv('Vehicle Class', vehicleLabel(driver.vehicle_class)) : '<div class="meta">No driver assigned.</div>') +

        '<h3>Payment</h3>' +
        kv('Delivery Fee', money(j.quote)) + kv('Platform Commission', money(platformFeeForJob(j))) + kv('Driver Earnings', money(driverEarningForJob(j))) +
        kv('Payment Method', paymentMethodLabel(j.payment_method)) + kv('Payment Status', j.payment_status || '—') +
        (j.payment_method === 'eft' && j.eft_proof_url ? '<div class="kv-row"><span>Proof of Payment</span><span><button class="btn btn-outline-blue" style="width:auto; padding:2px 10px;" id="viewProofBtn">View</button></span></div>' : '') +
        (j.payment_verified_by ? kv('Payment Verified By', j.payment_verified_by + (j.payment_verified_at ? ' on ' + formatDate(j.payment_verified_at) : '')) : '') +
        (j.refunded ? kv('Refund Amount', money(j.refund_amount)) + kv('Refund Reason', j.refund_reason) + kv('Refunded At', formatTime(j.refunded_at)) : '') +

        '<h3>Delivery</h3>' +
        kv('Pickup Address', j.pickup) + kv('Drop-off Address', j.dropoff) + kv('Delivery Status', j.status) +

        '<h3>Actions</h3>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="admin-jobs.html?job=' + j.id + '">View Job</a>' +
            (customer ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" href="admin-customers.html?customer=' + customer.id + '">View Customer</a>' : '') +
            (j.status === 'delivered' && !j.refunded ? '<button class="btn btn-outline-blue" style="width:auto;" id="refundBtn">Issue Refund</button>' : '') +
            (j.payment_method === 'eft' && j.payment_status === 'pending' ? '<button class="btn btn-blue" style="width:auto;" id="verifyEftBtn">Mark EFT as Paid</button>' : '') +
        '</div>';

    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    const refundBtn = document.getElementById('refundBtn');
    if (refundBtn) refundBtn.addEventListener('click', function () { issueRefund(j.id); });
    const viewProofBtn = document.getElementById('viewProofBtn');
    if (viewProofBtn) viewProofBtn.addEventListener('click', function () { viewEftProof(j.eft_proof_url); });
    const verifyEftBtn = document.getElementById('verifyEftBtn');
    if (verifyEftBtn) verifyEftBtn.addEventListener('click', function () { verifyEftPayment(j.id); });

    drawer.classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');
}

async function issueRefund(jobId) {
    const job = allJobs.find(function (j) { return j.id === jobId; });
    const amountStr = prompt('Refund amount (max R' + (Number(job.quote) || 0).toFixed(2) + '):', (Number(job.quote) || 0).toFixed(2));
    if (amountStr === null) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0 || amount > (Number(job.quote) || 0)) { alert('Invalid refund amount.'); return; }
    const reason = prompt('Refund reason:');
    if (reason === null) return;

    const { error } = await supabase.from('jobs').update({
        refunded: true, refund_amount: amount, refund_reason: reason.trim() || null,
        refunded_at: new Date().toISOString(), refunded_by: window.currentAdminName || 'Admin',
    }).eq('id', jobId);
    if (error) { alert('Failed to issue refund: ' + error.message); return; }
    closeDrawer();
    loadAll();
}

function paymentMethodLabel(method) {
    return method === 'card' ? 'Card' : method === 'eft' ? 'EFT' : 'Cash';
}

async function viewEftProof(path) {
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300);
    if (error) { alert('Failed to open proof of payment: ' + error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
}

async function verifyEftPayment(jobId) {
    if (!confirm('Confirm this EFT payment has been received and mark it as paid?')) return;
    const { error } = await supabase.from('jobs').update({
        payment_status: 'paid', payment_verified_by: window.currentAdminName || 'Admin', payment_verified_at: new Date().toISOString(),
    }).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    closeDrawer();
    loadAll();
}

function renderPaymentMethods() {
    const wrap = document.getElementById('paymentMethodsWrap');
    const delivered = deliveredJobs();
    if (!delivered.length) { wrap.innerHTML = '<div class="empty">No completed deliveries.</div>'; return; }

    const totalRevenue = delivered.reduce(function (s, j) { return s + netRevenue(j); }, 0);
    const methods = ['cash', 'card', 'eft'];
    const rows = methods.map(function (m) {
        const jobs = delivered.filter(function (j) { return (j.payment_method || 'cash') === m; });
        const amount = jobs.reduce(function (s, j) { return s + netRevenue(j); }, 0);
        const pct = totalRevenue ? (amount / totalRevenue * 100) : 0;
        return { method: m, count: jobs.length, amount: amount, pct: pct };
    });

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr><th>Method</th><th>Transactions</th><th>Total Amount</th><th>% of Revenue</th></tr></thead><tbody>' +
        rows.map(function (r) {
            return '<tr><td>' + paymentMethodLabel(r.method) + '</td><td>' + r.count + '</td><td>' + money(r.amount) + '</td><td>' + r.pct.toFixed(1) + '%</td></tr>';
        }).join('') +
        '</tbody></table>';
}

function weekLabel(start) {
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return start.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) + ' – ' + end.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderPayouts() {
    document.getElementById('payoutWeekLabel').textContent = weekLabel(payoutWeekStart);
    const weekEnd = new Date(payoutWeekStart); weekEnd.setDate(weekEnd.getDate() + 7);

    const wrap = document.getElementById('payoutsWrap');
    const rows = allDrivers.map(function (d) {
        const jobs = allJobs.filter(function (j) {
            return j.driver_id === d.id && j.status === 'delivered' && !j.payout_id &&
                j.delivered_at && new Date(j.delivered_at) >= payoutWeekStart && new Date(j.delivered_at) < weekEnd;
        });
        const amount = jobs.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
        return { driver: d, jobs: jobs, amount: amount };
    }).filter(function (r) { return r.jobs.length > 0; });

    if (!rows.length) { wrap.innerHTML = '<div class="empty">No unpaid earnings for this week.</div>'; return; }

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr><th>Driver</th><th>Deliveries</th><th>Amount Owed</th><th>Action</th></tr></thead><tbody>' +
        rows.map(function (r) {
            return '<tr><td>' + escapeHtml(r.driver.full_name) + '</td><td>' + r.jobs.length + '</td><td>' + money(r.amount) + '</td>' +
                '<td><button class="btn btn-blue" style="width:auto;" data-action="allocate" data-driver="' + r.driver.id + '">Allocate & Mark Paid</button></td></tr>';
        }).join('') +
        '</tbody></table>';

    wrap.querySelectorAll('button[data-action="allocate"]').forEach(function (btn) {
        btn.addEventListener('click', function () { allocatePayout(btn.dataset.driver); });
    });
}

async function allocatePayout(driverId) {
    const weekEnd = new Date(payoutWeekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const jobs = allJobs.filter(function (j) {
        return j.driver_id === driverId && j.status === 'delivered' && !j.payout_id &&
            j.delivered_at && new Date(j.delivered_at) >= payoutWeekStart && new Date(j.delivered_at) < weekEnd;
    });
    if (!jobs.length) return;
    const amount = jobs.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const driver = driversById[driverId];

    if (!confirm('Allocate ' + money(amount) + ' to ' + (driver ? driver.full_name : driverId) + ' for ' + jobs.length + ' deliveries this week?')) return;

    const periodStart = payoutWeekStart.toISOString().slice(0, 10);
    const periodEnd = new Date(weekEnd.getTime() - 86400000).toISOString().slice(0, 10);

    const { data: payout, error } = await supabase.from('driver_payouts').insert({
        driver_id: driverId, period_start: periodStart, period_end: periodEnd,
        total_amount: amount, job_count: jobs.length, status: 'paid',
        paid_by: window.currentAdminName || 'Admin', paid_at: new Date().toISOString(),
    }).select().single();
    if (error) { alert('Failed to create payout: ' + error.message); return; }

    for (const job of jobs) {
        await supabase.from('jobs').update({ payout_id: payout.id }).eq('id', job.id);
    }
    loadAll();
}

function renderPayoutHistory() {
    const wrap = document.getElementById('payoutHistoryWrap');
    if (!allPayouts.length) { wrap.innerHTML = '<div class="empty">No payouts recorded yet.</div>'; return; }

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr><th>Driver</th><th>Period</th><th>Deliveries</th><th>Amount</th><th>Status</th><th>Paid By</th><th>Paid At</th></tr></thead><tbody>' +
        allPayouts.map(function (p) {
            const driver = driversById[p.driver_id];
            return '<tr><td>' + escapeHtml(driver ? driver.full_name : p.driver_id.slice(0, 8)) + '</td>' +
                '<td>' + formatDate(p.period_start) + ' – ' + formatDate(p.period_end) + '</td>' +
                '<td>' + p.job_count + '</td><td>' + money(p.total_amount) + '</td>' +
                '<td><span class="badge delivered">' + p.status + '</span></td>' +
                '<td>' + escapeHtml(p.paid_by || '—') + '</td><td>' + formatDate(p.paid_at) + '</td></tr>';
        }).join('') +
        '</tbody></table>';
}

function renderRefunds() {
    const refunded = allJobs.filter(function (j) { return j.refunded; });
    const totalAmount = refunded.reduce(function (s, j) { return s + (Number(j.refund_amount) || 0); }, 0);

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('refundSummaryCards').innerHTML =
        card('Total Refunds', refunded.length) + card('Refund Amount', money(totalAmount)) + card('Refunded Jobs', refunded.length);

    const wrap = document.getElementById('refundsTableWrap');
    if (!refunded.length) { wrap.innerHTML = '<div class="empty">No refunds.</div>'; return; }

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr><th>Refund ID</th><th>Job ID</th><th>Customer</th><th>Refund Amount</th><th>Reason</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>' +
        refunded.sort(function (a, b) { return new Date(b.refunded_at) - new Date(a.refunded_at); }).map(function (j) {
            const customer = customersById[j.customer_id];
            return '<tr><td>' + j.id.slice(0, 8) + '</td><td>' + j.id.slice(0, 8) + '</td>' +
                '<td>' + escapeHtml(customer ? customer.full_name : '—') + '</td><td>' + money(j.refund_amount) + '</td>' +
                '<td>' + escapeHtml(j.refund_reason || '—') + '</td><td><span class="badge pending">refunded</span></td>' +
                '<td>' + formatDate(j.refunded_at) + '</td>' +
                '<td><a href="admin-jobs.html?job=' + j.id + '">View Job</a>' + (customer ? ' · <a href="admin-customers.html?customer=' + customer.id + '">View Customer</a>' : '') + '</td></tr>';
        }).join('') +
        '</tbody></table>';
}

function renderTopDrivers() {
    const rows = allDrivers.map(function (d) {
        const row = driverEarningsRow(d.id);
        const rated = deliveredJobs().filter(function (j) { return j.driver_id === d.id && j.rating; });
        const avgRating = rated.length ? (rated.reduce(function (s, j) { return s + j.rating; }, 0) / rated.length) : null;
        return { driver: d, row: row, avgRating: avgRating };
    }).filter(function (r) { return r.row.deliveries > 0; }).sort(function (a, b) { return b.row.lifetime - a.row.lifetime; }).slice(0, 10);

    const el = document.getElementById('topDrivers');
    if (!rows.length) { el.innerHTML = '<div class="empty">No completed deliveries.</div>'; return; }
    el.innerHTML = rows.map(function (r, i) {
        return '<div class="leaderboard-row"><span>' + (i + 1) + '. ' + escapeHtml(r.driver.full_name) + '</span>' +
            '<span>' + money(r.row.lifetime) + ' · ' + r.row.deliveries + ' deliveries · ' + (r.avgRating ? r.avgRating.toFixed(1) + ' ★' : '—') + '</span></div>';
    }).join('');
}

function renderTopCustomers() {
    const rows = allCustomers.map(function (c) {
        const jobs = deliveredJobs().filter(function (j) { return j.customer_id === c.id; });
        const spend = jobs.reduce(function (s, j) { return s + netRevenue(j); }, 0);
        return { customer: c, orders: jobs.length, spend: spend, avgOrder: jobs.length ? spend / jobs.length : 0 };
    }).filter(function (r) { return r.orders > 0; }).sort(function (a, b) { return b.spend - a.spend; }).slice(0, 10);

    const el = document.getElementById('topCustomers');
    if (!rows.length) { el.innerHTML = '<div class="empty">No completed deliveries.</div>'; return; }
    el.innerHTML = rows.map(function (r, i) {
        return '<div class="leaderboard-row"><span>' + (i + 1) + '. ' + escapeHtml(r.customer.full_name) + '</span>' +
            '<span>' + r.orders + ' orders · ' + money(r.spend) + ' · avg ' + money(r.avgOrder) + '</span></div>';
    }).join('');
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

function csvRow(vals) { return vals.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }

function exportTransactions(jobs) {
    if (!jobs.length) { alert('No transactions to export.'); return; }
    const rows = [csvRow(['Transaction ID', 'Job ID', 'Customer', 'Driver', 'Delivery Fee', 'Platform Commission', 'Driver Earnings', 'Status', 'Date'])];
    jobs.forEach(function (j) {
        const driver = driversById[j.driver_id];
        const customer = customersById[j.customer_id];
        rows.push(csvRow([j.id, j.id, customer ? customer.full_name : '', driver ? driver.full_name : '', j.quote || 0, platformFeeForJob(j).toFixed(2), driverEarningForJob(j).toFixed(2), txnStatus(j), j.created_at]));
    });
    downloadCsv(rows.join('\n'), 'ekoquick-transactions-' + new Date().toISOString().slice(0, 10) + '.csv');
}

function exportDriverEarnings() {
    const rows = [csvRow(['Driver', 'Completed Deliveries', 'Earnings Today', 'Earnings This Week', 'Earnings This Month', 'Lifetime Earnings', 'Avg Per Delivery'])];
    allDrivers.forEach(function (d) {
        const row = driverEarningsRow(d.id);
        if (!row.deliveries) return;
        rows.push(csvRow([d.full_name, row.deliveries, row.earningsToday.toFixed(2), row.earningsWeek.toFixed(2), row.earningsMonth.toFixed(2), row.lifetime.toFixed(2), row.avgPerDelivery.toFixed(2)]));
    });
    downloadCsv(rows.join('\n'), 'ekoquick-driver-earnings-' + new Date().toISOString().slice(0, 10) + '.csv');
}

function exportRefunds() {
    const refunded = allJobs.filter(function (j) { return j.refunded; });
    if (!refunded.length) { alert('No refunds to export.'); return; }
    const rows = [csvRow(['Refund ID', 'Job ID', 'Customer', 'Refund Amount', 'Reason', 'Date'])];
    refunded.forEach(function (j) {
        const customer = customersById[j.customer_id];
        rows.push(csvRow([j.id, j.id, customer ? customer.full_name : '', j.refund_amount || 0, j.refund_reason || '', j.refunded_at]));
    });
    downloadCsv(rows.join('\n'), 'ekoquick-refunds-' + new Date().toISOString().slice(0, 10) + '.csv');
}

function generateReport(type) {
    if (type === 'daily' || type === 'weekly' || type === 'monthly') {
        const delivered = deliveredJobs();
        const start = type === 'daily' ? startOfToday() : type === 'weekly' ? startOfWeek() : startOfMonth();
        const jobs = delivered.filter(function (j) { return new Date(j.delivered_at) >= start; });
        const rows = [csvRow(['Job ID', 'Customer', 'Driver', 'Delivery Fee', 'Platform Commission', 'Driver Earnings', 'Delivered At'])];
        jobs.forEach(function (j) {
            const driver = driversById[j.driver_id];
            const customer = customersById[j.customer_id];
            rows.push(csvRow([j.id, customer ? customer.full_name : '', driver ? driver.full_name : '', j.quote || 0, platformFeeForJob(j).toFixed(2), driverEarningForJob(j).toFixed(2), j.delivered_at]));
        });
        downloadCsv(rows.join('\n'), 'ekoquick-' + type + '-revenue-report-' + new Date().toISOString().slice(0, 10) + '.csv');
    } else if (type === 'driver') {
        exportDriverEarnings();
    } else if (type === 'transaction') {
        exportTransactions(filteredTxns);
    } else if (type === 'refund') {
        exportRefunds();
    }
}
