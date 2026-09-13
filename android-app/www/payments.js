let currentUser = null;
let allJobs = [];
let driversById = {};
let activeFilter = 'all';

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    document.getElementById('paySearch').addEventListener('input', renderTable);
    document.getElementById('dateFrom').addEventListener('change', renderTable);
    document.getElementById('dateTo').addEventListener('change', renderTable);
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            renderTable();
        });
    });

    await loadAll();
    supabase.channel('customer-payments').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'customer_id=eq.' + currentUser.id }, loadAll).subscribe();
});

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
    allJobs = jobs || [];

    const driverIds = [...new Set(allJobs.map(function (j) { return j.driver_id; }).filter(Boolean))];
    driversById = {};
    if (driverIds.length) {
        const { data: drivers } = await supabase.from('profiles').select('id, full_name').in('id', driverIds);
        (drivers || []).forEach(function (d) { driversById[d.id] = d; });
    }

    renderSummary();
    renderTable();
    renderRefunds();
}

function startOfMonth() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); return d; }

function renderSummary() {
    const monthStart = startOfMonth();
    const totalSpent = allJobs.filter(function (j) { return j.payment_status === 'paid'; }).reduce(function (s, j) { return s + Number(j.quote || 0); }, 0);
    const thisMonth = allJobs.filter(function (j) { return j.payment_status === 'paid' && new Date(j.created_at) >= monthStart; }).reduce(function (s, j) { return s + Number(j.quote || 0); }, 0);
    const completed = allJobs.filter(function (j) { return j.payment_status === 'paid'; }).length;
    const pending = allJobs.filter(function (j) { return j.payment_status === 'pending'; }).length;
    const refunds = allJobs.filter(function (j) { return j.refunded; }).reduce(function (s, j) { return s + Number(j.refund_amount || 0); }, 0);

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">R' + totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div><div class="lbl">Total Spent</div></div>' +
        '<div class="summary-card"><div class="num">R' + thisMonth.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div><div class="lbl">Payments This Month</div></div>' +
        '<div class="summary-card"><div class="num">' + completed + '</div><div class="lbl">Completed Payments</div></div>' +
        '<div class="summary-card"><div class="num">' + pending + '</div><div class="lbl">Pending Payments</div></div>' +
        '<div class="summary-card"><div class="num">R' + refunds.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div><div class="lbl">Refunds Received</div></div>';
}

function filteredJobs() {
    const q = document.getElementById('paySearch').value.trim().toLowerCase();
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    return allJobs.filter(function (j) {
        if (activeFilter !== 'all' && j.payment_status !== activeFilter) return false;
        if (q && !j.id.toLowerCase().includes(q)) return false;
        if (from && new Date(j.created_at) < new Date(from)) return false;
        if (to && new Date(j.created_at) > new Date(to + 'T23:59:59')) return false;
        return true;
    });
}

function renderTable() {
    const jobs = filteredJobs();
    const body = document.getElementById('payBody');
    const empty = document.getElementById('emptyState');

    if (!jobs.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = jobs.map(function (job) {
        return '<tr>' +
            '<td>PAY-' + job.id.slice(0, 8) + '</td>' +
            '<td>' + job.id.slice(0, 8) + '</td>' +
            '<td>' + (job.delivered_at ? formatDate(job.delivered_at) : formatDate(job.created_at)) + '</td>' +
            '<td>R' + Number(job.quote || 0).toFixed(2) + '</td>' +
            '<td>' + (job.payment_method || '—').toUpperCase() + '</td>' +
            '<td><span class="badge ' + (job.payment_status === 'paid' ? 'delivered' : job.payment_status === 'refunded' ? 'cancelled' : job.payment_status === 'failed' ? 'cancelled' : 'pending') + '">' + (job.payment_status || 'pending') + '</span></td>' +
            '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-details" data-job="' + job.id + '">View Details</button></td>' +
            '</tr>' +
            '<tr><td colspan="7" style="border:none; padding:0;"><div class="details-row" id="details-' + job.id + '"></div></td></tr>';
    }).join('');

    body.querySelectorAll('button[data-action="toggle-details"]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleDetails(btn.dataset.job); });
    });
}

function toggleDetails(jobId) {
    const el = document.getElementById('details-' + jobId);
    const open = el.classList.contains('open');
    document.querySelectorAll('.details-row.open').forEach(function (d) { d.classList.remove('open'); });
    if (open) return;

    const job = allJobs.find(function (j) { return j.id === jobId; });
    const driver = driversById[job.driver_id];

    el.innerHTML =
        '<h4>General</h4>' +
        'Payment ID: PAY-' + job.id.slice(0, 8) + '<br>Order ID: ' + job.id.slice(0, 8) +
        '<br>Transaction Date: ' + formatDate(job.created_at) + '<br>Status: ' + (job.payment_status || 'pending') +
        '<h4>Customer</h4>' + escapeHtml(job.sender_name || '') + '<br>' + escapeHtml(job.customer_phone || '') +
        '<h4>Delivery</h4>Pickup: ' + escapeHtml(job.pickup) + '<br>Drop-off: ' + escapeHtml(job.dropoff) +
        '<br>Driver: ' + (driver ? escapeHtml(driver.full_name) : '—') +
        '<h4>Financial</h4>Delivery Fee: R' + Number(job.quote || 0).toFixed(2) +
        '<br>Total Paid: R' + (job.payment_status === 'paid' ? Number(job.quote || 0).toFixed(2) : '0.00') +
        (job.refunded ? '<br>Refunded: R' + Number(job.refund_amount || 0).toFixed(2) : '') +
        '<h4>Invoice & Receipt</h4><i>Not available — PDF invoice/receipt generation isn\'t built yet.</i>';

    el.classList.add('open');
}

function renderRefunds() {
    const refunded = allJobs.filter(function (j) { return j.refunded; });
    const wrap = document.getElementById('refundsList');
    const empty = document.getElementById('refundsEmpty');
    if (!refunded.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    wrap.innerHTML = refunded.map(function (j) {
        return '<div class="method-card">' +
            '<b>Refund for Order ' + j.id.slice(0, 8) + '</b>' +
            '<div class="meta">Amount: R' + Number(j.refund_amount || 0).toFixed(2) + '</div>' +
            '<div class="meta">Reason: ' + escapeHtml(j.refund_reason || '—') + '</div>' +
            '<div class="meta">Date: ' + (j.refunded_at ? formatDate(j.refunded_at) : '—') + '</div>' +
        '</div>';
    }).join('');
}
