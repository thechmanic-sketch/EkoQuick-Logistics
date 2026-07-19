let customersCache = [];

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
    document.getElementById('customerSearch').addEventListener('input', function () {
        renderCustomers(this.value.trim().toLowerCase());
    });

    loadCustomers();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

async function loadCustomers() {
    const { data: customers, error } = await supabase.from('profiles').select('id, full_name, phone, email, account_status').eq('role', 'customer');
    if (error) {
        document.getElementById('customersList').innerHTML = '<div class="empty">Failed to load: ' + error.message + '</div>';
        return;
    }

    const { data: jobs } = await supabase.from('jobs').select('customer_id, quote, status, created_at');

    const byCustomer = {};
    (jobs || []).forEach(function (j) {
        if (!byCustomer[j.customer_id]) byCustomer[j.customer_id] = { orders: 0, spend: 0, last: null };
        const c = byCustomer[j.customer_id];
        c.orders += 1;
        if (j.status === 'delivered') c.spend += Number(j.quote) || 0;
        if (!c.last || new Date(j.created_at) > new Date(c.last)) c.last = j.created_at;
    });

    customersCache = (customers || []).map(function (c) {
        const stats = byCustomer[c.id] || { orders: 0, spend: 0, last: null };
        return Object.assign({}, c, stats);
    }).sort(function (a, b) { return b.spend - a.spend; });

    document.getElementById('statCustomerCount').textContent = customersCache.length;
    document.getElementById('statCustomerSpend').textContent = 'R' + customersCache.reduce(function (s, c) { return s + c.spend; }, 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

    renderCustomers('');
}

function renderCustomers(query) {
    const el = document.getElementById('customersList');
    let list = customersCache;
    if (query) {
        list = list.filter(function (c) {
            return (c.full_name || '').toLowerCase().indexOf(query) !== -1 ||
                (c.phone || '').toLowerCase().indexOf(query) !== -1;
        });
    }

    if (!list.length) { el.innerHTML = '<div class="empty">No customers found.</div>'; return; }

    el.innerHTML = list.map(function (c) {
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(c.full_name || c.id) + '</div>' +
                '<div class="meta">' + escapeHtml(c.phone || 'No phone') + ' • ' + escapeHtml(c.email || '') + '</div>' +
                '<div class="meta">' + c.orders + ' orders • R' + c.spend.toFixed(2) + ' lifetime spend' + (c.last ? ' • Last order: ' + new Date(c.last).toLocaleDateString('en-ZA') : '') + '</div>' +
                (c.account_status !== 'active' ? '<span class="badge cancelled" style="margin-top:6px;">' + c.account_status + '</span>' : '') +
                '<div style="margin-top: 10px;">' +
                    (c.phone ? '<a class="btn btn-outline-blue" style="width:auto; display:inline-block; margin-right:8px;" href="tel:' + escapeHtml(c.phone) + '">Call</a>' : '') +
                    (c.phone ? '<a class="btn btn-outline-blue" style="width:auto; display:inline-block; margin-right:8px;" href="https://wa.me/' + c.phone.replace(/[^0-9]/g, '') + '" target="_blank" rel="noopener">Message</a>' : '') +
                    (c.account_status === 'active'
                        ? '<button class="btn btn-outline-blue" style="width:auto; display:inline-block;" data-customer="' + c.id + '" data-action="block">Block</button>'
                        : '<button class="btn btn-blue" style="width:auto; display:inline-block;" data-customer="' + c.id + '" data-action="unblock">Unblock</button>') +
                '</div>' +
            '</div>'
        );
    }).join('');

    el.querySelectorAll('button[data-action="block"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setCustomerStatus(btn.dataset.customer, 'banned'); });
    });
    el.querySelectorAll('button[data-action="unblock"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setCustomerStatus(btn.dataset.customer, 'active'); });
    });
}

async function setCustomerStatus(customerId, status) {
    const { error } = await supabase.from('profiles').update({ account_status: status }).eq('id', customerId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadCustomers();
}
