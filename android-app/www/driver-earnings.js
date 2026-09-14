let currentUser = null;
let currentProfile = null;
let allJobs = [];
let allPayouts = [];
let allWithdrawals = [];
let statusFilter = 'all';

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function startOfDay(d) { const x = new Date(d || Date.now()); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
function downloadCsv(filename, rows) {
    const csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    await loadDriverShare();
    await loadCommissionRules();
    await loadAppSettings();

    document.getElementById('fBankName').value = currentProfile.bank_name || '';
    document.getElementById('fAccountHolder').value = currentProfile.bank_account_holder || '';
    document.getElementById('fAccountNumber').value = currentProfile.bank_account_number || '';
    document.getElementById('fBranchCode').value = currentProfile.bank_branch_code || '';
    document.getElementById('minWithdrawalNote').textContent = 'Minimum withdrawal: R' + appSetting('min_withdrawal_amount', '100');

    document.getElementById('dateFrom').addEventListener('change', renderEarningsTable);
    document.getElementById('dateTo').addEventListener('change', renderEarningsTable);
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('exportBtn').addEventListener('click', exportStatement);
    document.getElementById('saveBankBtn').addEventListener('click', saveBankDetails);
    document.getElementById('requestWithdrawalBtn').addEventListener('click', requestWithdrawal);
    document.querySelectorAll('#statusFilters .filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#statusFilters .filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            statusFilter = btn.dataset.filter;
            renderEarningsTable();
        });
    });

    await loadAll();
});

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).eq('status', 'delivered').order('delivered_at', { ascending: false });
    allJobs = jobs || [];

    const { data: payouts } = await supabase.from('driver_payouts').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false });
    allPayouts = payouts || [];

    const { data: withdrawals } = await supabase.from('withdrawal_requests').select('*').eq('driver_id', currentUser.id).order('requested_at', { ascending: false });
    allWithdrawals = withdrawals || [];

    renderSummary();
    renderCharts();
    renderBalance();
    renderEarningsTable();
    renderPayouts();
    renderWithdrawals();
    renderBreakdown();
}

function renderSummary() {
    const today = startOfDay(), week = startOfWeek(), month = startOfMonth();
    const earningsToday = allJobs.filter(function (j) { return new Date(j.delivered_at) >= today; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const earningsWeek = allJobs.filter(function (j) { return new Date(j.delivered_at) >= week; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const earningsMonth = allJobs.filter(function (j) { return new Date(j.delivered_at) >= month; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const lifetimeEarnings = allJobs.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const pendingPayouts = allPayouts.filter(function (p) { return p.status === 'pending'; }).reduce(function (s, p) { return s + Number(p.total_amount); }, 0);
    const completedPayouts = allPayouts.filter(function (p) { return p.status === 'paid'; }).reduce(function (s, p) { return s + Number(p.total_amount); }, 0);

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">R' + earningsToday.toFixed(0) + '</div><div class="lbl">Earnings Today</div></div>' +
        '<div class="summary-card"><div class="num">R' + earningsWeek.toFixed(0) + '</div><div class="lbl">Earnings This Week</div></div>' +
        '<div class="summary-card"><div class="num">R' + earningsMonth.toFixed(0) + '</div><div class="lbl">Earnings This Month</div></div>' +
        '<div class="summary-card"><div class="num">R' + lifetimeEarnings.toFixed(0) + '</div><div class="lbl">Lifetime Earnings</div></div>' +
        '<div class="summary-card"><div class="num">R' + pendingPayouts.toFixed(0) + '</div><div class="lbl">Pending Payouts</div></div>' +
        '<div class="summary-card"><div class="num">R' + completedPayouts.toFixed(0) + '</div><div class="lbl">Completed Payouts</div></div>';
}

function renderChart(elId, buckets) {
    const max = Math.max.apply(null, buckets.map(function (b) { return b.value; }).concat([1]));
    document.getElementById(elId).innerHTML = buckets.map(function (b) {
        const pct = Math.max(2, Math.round((b.value / max) * 100));
        return '<div class="bar" style="height:' + pct + '%;" data-label="' + escapeHtml(b.label) + ': R' + b.value.toFixed(0) + '"></div>';
    }).join('');
}

function renderCharts() {
    const daily = [];
    for (let i = 29; i >= 0; i--) {
        const day = startOfDay(new Date(Date.now() - i * 86400000));
        const next = new Date(day.getTime() + 86400000);
        const value = allJobs.filter(function (j) { const d = new Date(j.delivered_at); return d >= day && d < next; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
        daily.push({ label: day.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }), value: value });
    }
    renderChart('dailyChart', daily);

    const weekly = [];
    for (let i = 7; i >= 0; i--) {
        const wkStart = new Date(startOfWeek().getTime() - i * 7 * 86400000);
        const wkEnd = new Date(wkStart.getTime() + 7 * 86400000);
        const value = allJobs.filter(function (j) { const d = new Date(j.delivered_at); return d >= wkStart && d < wkEnd; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
        weekly.push({ label: wkStart.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }), value: value });
    }
    renderChart('weeklyChart', weekly);

    const monthly = [];
    for (let i = 5; i >= 0; i--) {
        const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); m.setMonth(m.getMonth() - i);
        const mEnd = new Date(m); mEnd.setMonth(mEnd.getMonth() + 1);
        const value = allJobs.filter(function (j) { const d = new Date(j.delivered_at); return d >= m && d < mEnd; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
        monthly.push({ label: m.toLocaleDateString('en-ZA', { month: 'short' }), value: value });
    }
    renderChart('monthlyChart', monthly);
}

function unpaidJobs() {
    return allJobs.filter(function (j) { return !j.payout_id; });
}

function renderBalance() {
    const unpaid = unpaidJobs();
    const confirmedPaid = unpaid.filter(function (j) { return j.payment_status === 'paid'; });
    const pending = unpaid.filter(function (j) { return j.payment_status !== 'paid'; });

    const availableForWithdrawal = confirmedPaid.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const pendingEarnings = pending.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const currentBalance = availableForWithdrawal + pendingEarnings;
    const lastPayout = allPayouts.find(function (p) { return p.status === 'paid'; });

    document.getElementById('balanceCards').innerHTML =
        '<div class="summary-card"><div class="num">R' + currentBalance.toFixed(0) + '</div><div class="lbl">Current Balance</div></div>' +
        '<div class="summary-card"><div class="num">R' + pendingEarnings.toFixed(0) + '</div><div class="lbl">Pending Earnings</div><div class="meta">Awaiting payment confirmation</div></div>' +
        '<div class="summary-card"><div class="num">R' + availableForWithdrawal.toFixed(0) + '</div><div class="lbl">Available for Withdrawal</div></div>' +
        '<div class="summary-card"><div class="num" style="font-size:14px;">' + (lastPayout ? 'R' + Number(lastPayout.total_amount).toFixed(2) + ' on ' + formatDate(lastPayout.paid_at) : '—') + '</div><div class="lbl">Last Payout</div></div>';
}

async function saveBankDetails() {
    const msg = document.getElementById('bankMsg');
    const fields = {
        bank_name: document.getElementById('fBankName').value.trim() || null,
        bank_account_holder: document.getElementById('fAccountHolder').value.trim() || null,
        bank_account_number: document.getElementById('fAccountNumber').value.trim() || null,
        bank_branch_code: document.getElementById('fBranchCode').value.trim() || null,
    };
    msg.textContent = 'Saving...';
    const { error } = await supabase.from('profiles').update(fields).eq('id', currentUser.id);
    msg.textContent = error ? 'Could not save: ' + error.message : 'Bank details saved.';
    if (!error) currentProfile = Object.assign(currentProfile, fields);
}

async function requestWithdrawal() {
    const msg = document.getElementById('withdrawalMsg');
    const unpaid = unpaidJobs().filter(function (j) { return j.payment_status === 'paid'; });
    const available = unpaid.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const minAmount = parseFloat(appSetting('min_withdrawal_amount', '100')) || 0;

    if (!currentProfile.bank_account_number) { msg.textContent = 'Please save your bank details before requesting a withdrawal.'; return; }
    if (available < minAmount) { msg.textContent = 'Available balance (R' + available.toFixed(2) + ') is below the minimum withdrawal of R' + minAmount.toFixed(2) + '.'; return; }

    const { error } = await supabase.from('withdrawal_requests').insert({ driver_id: currentUser.id, amount: available });
    msg.textContent = error ? 'Could not submit request: ' + error.message : 'Withdrawal request for R' + available.toFixed(2) + ' submitted.';
    if (!error) await loadAll();
}

function renderWithdrawals() {
    const body = document.getElementById('withdrawalBody');
    const empty = document.getElementById('withdrawalEmpty');
    if (!allWithdrawals.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    body.innerHTML = allWithdrawals.map(function (w) {
        return '<tr><td>' + formatDate(w.requested_at) + '</td><td>R' + Number(w.amount).toFixed(2) + '</td><td>' + w.status + '</td><td>' + (w.processed_at ? formatDate(w.processed_at) : '—') + '</td></tr>';
    }).join('');
}

function filteredEarningsJobs() {
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    return allJobs.filter(function (j) {
        if (statusFilter !== 'all' && j.payment_status !== statusFilter) return false;
        if (from && new Date(j.delivered_at) < new Date(from)) return false;
        if (to && new Date(j.delivered_at) > new Date(to + 'T23:59:59')) return false;
        return true;
    });
}

function renderEarningsTable() {
    const list = filteredEarningsJobs();
    const body = document.getElementById('earnBody');
    const empty = document.getElementById('earnEmpty');
    if (!list.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = list.map(function (job) {
        return '<tr>' +
            '<td>' + job.id.slice(0, 8) + '</td>' +
            '<td>' + formatDate(job.delivered_at) + '</td>' +
            '<td>R' + Number(job.quote || 0).toFixed(2) + '</td>' +
            '<td>R' + platformFeeForJob(job).toFixed(2) + '</td>' +
            '<td>R' + driverEarningForJob(job).toFixed(2) + '</td>' +
            '<td>' + (job.payment_status || '—') + '</td>' +
            '<td><a class="btn btn-outline-blue" style="width:auto;" href="driver-history.html">View Delivery</a></td>' +
            '</tr>';
    }).join('');
}

function renderPayouts() {
    const body = document.getElementById('payoutBody');
    const empty = document.getElementById('payoutEmpty');
    if (!allPayouts.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    body.innerHTML = allPayouts.map(function (p) {
        return '<tr><td>' + p.id.slice(0, 8) + '</td><td>' + formatDate(p.period_start) + ' – ' + formatDate(p.period_end) + '</td><td>R' + Number(p.total_amount).toFixed(2) + '</td><td>' + p.status + '</td></tr>';
    }).join('');
}

function renderBreakdown() {
    const totalFees = allJobs.reduce(function (s, j) { return s + Number(j.quote || 0); }, 0);
    const commission = allJobs.reduce(function (s, j) { return s + platformFeeForJob(j); }, 0);
    const driverEarnings = allJobs.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const refunds = allJobs.filter(function (j) { return j.refunded; }).reduce(function (s, j) { return s + Number(j.refund_amount || 0); }, 0);

    document.getElementById('breakdownText').innerHTML =
        'Total Delivery Fees: R' + totalFees.toFixed(2) + '<br>' +
        'Platform Commission: R' + commission.toFixed(2) + '<br>' +
        'Driver Earnings: R' + driverEarnings.toFixed(2) + '<br>' +
        'Bonuses: <i>Not available — no bonus program is built yet.</i><br>' +
        'Tips: <i>Not available — tipping isn\'t built yet.</i><br>' +
        'Refund Adjustments: R' + refunds.toFixed(2);
}

function exportStatement() {
    const list = filteredEarningsJobs();
    const rows = [['Job ID', 'Date', 'Delivery Fee', 'Platform Commission', 'Driver Earnings', 'Payment Status']];
    list.forEach(function (j) {
        rows.push([j.id, j.delivered_at, j.quote, platformFeeForJob(j).toFixed(2), driverEarningForJob(j).toFixed(2), j.payment_status]);
    });
    downloadCsv('ekoquick-earnings-statement.csv', rows);
}
