let currentUser = null;
let allExpenses = [];
let allJobs = [];

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function startOfMonth() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); return d; }
const CATEGORY_LABELS = { fuel: 'Fuel', repairs: 'Repairs', parking: 'Parking', tolls: 'Tolls', maintenance: 'Maintenance', other: 'Other' };

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    await loadDriverShare();
    await loadCommissionRules();

    document.getElementById('fDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('addExpenseBtn').addEventListener('click', addExpense);

    await loadAll();
});

async function loadAll() {
    const { data: expenses } = await supabase.from('driver_expenses').select('*').eq('driver_id', currentUser.id).order('expense_date', { ascending: false });
    allExpenses = expenses || [];

    const { data: jobs } = await supabase.from('jobs').select('quote, vehicle, driver_id, status, delivered_at').eq('driver_id', currentUser.id).eq('status', 'delivered');
    allJobs = jobs || [];

    renderSummary();
    renderMonthly();
    renderTable();
}

async function addExpense() {
    const msg = document.getElementById('addMsg');
    const amount = parseFloat(document.getElementById('fAmount').value);
    if (!amount || amount <= 0) { msg.textContent = 'Enter a valid amount.'; return; }

    const { error } = await supabase.from('driver_expenses').insert({
        driver_id: currentUser.id,
        category: document.getElementById('fCategory').value,
        amount: amount,
        expense_date: document.getElementById('fDate').value || new Date().toISOString().slice(0, 10),
        notes: document.getElementById('fNotes').value.trim() || null,
    });

    if (error) { msg.textContent = 'Could not save: ' + error.message; return; }
    document.getElementById('fAmount').value = '';
    document.getElementById('fNotes').value = '';
    msg.textContent = 'Expense added.';
    await loadAll();
}

function renderSummary() {
    const byCategory = {};
    allExpenses.forEach(function (e) { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount); });

    document.getElementById('summaryCards').innerHTML = Object.keys(CATEGORY_LABELS).map(function (cat) {
        return '<div class="summary-card"><div class="num">R' + (byCategory[cat] || 0).toFixed(0) + '</div><div class="lbl">' + CATEGORY_LABELS[cat] + '</div></div>';
    }).join('');
}

function renderMonthly() {
    const monthStart = startOfMonth();
    const monthExpenses = allExpenses.filter(function (e) { return new Date(e.expense_date) >= monthStart; });
    const totalExpenses = monthExpenses.reduce(function (s, e) { return s + Number(e.amount); }, 0);
    const monthEarnings = allJobs.filter(function (j) { return j.delivered_at && new Date(j.delivered_at) >= monthStart; }).reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const profit = monthEarnings - totalExpenses;

    document.getElementById('monthlySummary').innerHTML =
        'Earnings this month: R' + monthEarnings.toFixed(2) + '<br>' +
        'Expenses this month: R' + totalExpenses.toFixed(2) + '<br>' +
        '<b>Profit After Expenses: R' + profit.toFixed(2) + '</b>';
}

function renderTable() {
    const body = document.getElementById('expenseBody');
    const empty = document.getElementById('emptyState');
    if (!allExpenses.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = allExpenses.map(function (e) {
        return '<tr>' +
            '<td>' + formatDate(e.expense_date) + '</td>' +
            '<td>' + CATEGORY_LABELS[e.category] + '</td>' +
            '<td>R' + Number(e.amount).toFixed(2) + '</td>' +
            '<td>' + escapeHtml(e.notes || '—') + '</td>' +
            '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="delete" data-id="' + e.id + '">Delete</button></td>' +
            '</tr>';
    }).join('');

    body.querySelectorAll('button[data-action="delete"]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            if (!confirm('Delete this expense?')) return;
            await supabase.from('driver_expenses').delete().eq('id', btn.dataset.id);
            loadAll();
        });
    });
}
