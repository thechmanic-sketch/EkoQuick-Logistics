document.addEventListener('DOMContentLoaded', async function () {
    var { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'admin-login.html'; return; }
    var profile = await getProfile(session.user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
    });

    await loadSummary();
    await loadPendingSuppliers();
    await loadPendingProducts();
    await loadAllOrders();
    await loadApprovedSuppliers();
});

async function loadSummary() {
    var [{ count: pendingSuppliers }, { count: pendingProducts }, { count: orders }] = await Promise.all([
        supabase.from('supplier_details').select('*', { count: 'exact', head: true }).eq('verification_status', 'pending'),
        supabase.from('products').select('*', { count: 'exact', head: true }).eq('approval_status', 'pending'),
        supabase.from('store_orders').select('*', { count: 'exact', head: true }),
    ]);
    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="s-label">Pending Suppliers</div><div class="s-value">' + (pendingSuppliers || 0) + '</div></div>' +
        '<div class="summary-card"><div class="s-label">Pending Products</div><div class="s-value">' + (pendingProducts || 0) + '</div></div>' +
        '<div class="summary-card"><div class="s-label">Total Store Orders</div><div class="s-value">' + (orders || 0) + '</div></div>';
}

async function loadPendingSuppliers() {
    var { data: suppliers } = await supabase
        .from('supplier_details')
        .select('*, profiles:id(full_name, email, phone)')
        .eq('verification_status', 'pending');

    var el = document.getElementById('pendingSuppliers');
    if (!suppliers || suppliers.length === 0) { el.innerHTML = '<div class="empty">No pending supplier applications.</div>'; return; }

    el.innerHTML = suppliers.map(function (s) {
        return '<div class="row-card" data-supplier-id="' + s.id + '">' +
            '<div>' +
                '<b>' + escapeHtmlAdmin(s.business_name) + '</b> — ' + escapeHtmlAdmin((s.profiles && s.profiles.full_name) || '') + '<br>' +
                '<span style="font-size:12px; color:var(--muted);">' + escapeHtmlAdmin((s.profiles && s.profiles.phone) || '') + ' · ' + escapeHtmlAdmin(s.pickup_address) + '</span><br>' +
                '<span style="font-size:12px; color:var(--muted);">' +
                    (s.id_doc_url ? '<a href="#" class="view-doc" data-path="' + s.id_doc_url + '">View ID</a>' : 'No ID uploaded') +
                    (s.business_reg_url ? ' · <a href="#" class="view-doc" data-path="' + s.business_reg_url + '">View Biz Reg</a>' : '') +
                '</span>' +
            '</div>' +
            '<div class="row-actions">' +
                '<button class="btn btn-blue" data-approve="' + s.id + '">Approve</button>' +
                '<button class="btn btn-outline-blue" data-reject="' + s.id + '">Reject</button>' +
            '</div>' +
        '</div>';
    }).join('');

    el.querySelectorAll('[data-approve]').forEach(function (btn) {
        btn.addEventListener('click', function () { setSupplierStatus(btn.getAttribute('data-approve'), 'approved'); });
    });
    el.querySelectorAll('[data-reject]').forEach(function (btn) {
        btn.addEventListener('click', function () { setSupplierStatus(btn.getAttribute('data-reject'), 'rejected'); });
    });
    el.querySelectorAll('.view-doc').forEach(function (a) {
        a.addEventListener('click', async function (e) {
            e.preventDefault();
            var { data } = await supabase.storage.from('supplier-docs').createSignedUrl(a.getAttribute('data-path'), 300);
            if (data && data.signedUrl) window.open(data.signedUrl, '_blank');
        });
    });
}

async function setSupplierStatus(id, status) {
    await supabase.from('supplier_details').update({ verification_status: status }).eq('id', id);
    await loadSummary();
    await loadPendingSuppliers();
    await loadApprovedSuppliers();
}

async function loadPendingProducts() {
    var { data: products } = await supabase
        .from('products')
        .select('*, supplier_details:supplier_id(business_name)')
        .eq('approval_status', 'pending');

    var el = document.getElementById('pendingProducts');
    if (!products || products.length === 0) { el.innerHTML = '<div class="empty">No pending products.</div>'; return; }

    el.innerHTML = products.map(function (p) {
        return '<div class="row-card" data-product-id="' + p.id + '">' +
            '<div>' +
                '<b>' + escapeHtmlAdmin(p.title) + '</b> — R' + Number(p.price).toFixed(2) + ' · Stock ' + p.stock_count + '<br>' +
                '<span style="font-size:12px; color:var(--muted);">' + escapeHtmlAdmin((p.supplier_details && p.supplier_details.business_name) || '') + '</span>' +
            '</div>' +
            '<div class="row-actions">' +
                '<button class="btn btn-blue" data-approve-p="' + p.id + '">Approve</button>' +
                '<button class="btn btn-outline-blue" data-reject-p="' + p.id + '">Reject</button>' +
            '</div>' +
        '</div>';
    }).join('');

    el.querySelectorAll('[data-approve-p]').forEach(function (btn) {
        btn.addEventListener('click', function () { setProductStatus(btn.getAttribute('data-approve-p'), 'approved'); });
    });
    el.querySelectorAll('[data-reject-p]').forEach(function (btn) {
        btn.addEventListener('click', function () { setProductStatus(btn.getAttribute('data-reject-p'), 'rejected'); });
    });
}

async function setProductStatus(id, status) {
    await supabase.from('products').update({ approval_status: status }).eq('id', id);
    await loadSummary();
    await loadPendingProducts();
}

async function loadAllOrders() {
    var { data: orders } = await supabase
        .from('store_orders')
        .select('*, supplier_details:supplier_id(business_name), profiles:customer_id(full_name)')
        .order('created_at', { ascending: false })
        .limit(50);

    var el = document.getElementById('allOrders');
    if (!orders || orders.length === 0) { el.innerHTML = '<div class="empty">No store orders yet.</div>'; return; }

    el.innerHTML = orders.map(function (o) {
        return '<div class="row-card">' +
            '<div>' +
                '<b>R' + Number(o.subtotal).toFixed(2) + '</b> — ' + escapeHtmlAdmin((o.supplier_details && o.supplier_details.business_name) || '') +
                ' → ' + escapeHtmlAdmin((o.profiles && o.profiles.full_name) || '') + '<br>' +
                '<span style="font-size:12px; color:var(--muted);">' + new Date(o.created_at).toLocaleString() + '</span>' +
            '</div>' +
            '<span class="status-pill">' + o.status.replace(/_/g, ' ') + '</span>' +
        '</div>';
    }).join('');
}

async function loadApprovedSuppliers() {
    var { data: suppliers } = await supabase
        .from('supplier_details')
        .select('*, profiles:id(full_name, email, phone)')
        .eq('verification_status', 'approved');

    var el = document.getElementById('approvedSuppliers');
    if (!suppliers || suppliers.length === 0) { el.innerHTML = '<div class="empty">No approved suppliers yet.</div>'; return; }

    el.innerHTML = suppliers.map(function (s) {
        return '<div class="row-card">' +
            '<div><b>' + escapeHtmlAdmin(s.business_name) + '</b> — ' + escapeHtmlAdmin((s.profiles && s.profiles.full_name) || '') + '<br>' +
            '<span style="font-size:12px; color:var(--muted);">' + escapeHtmlAdmin((s.profiles && s.profiles.phone) || '') + '</span></div>' +
        '</div>';
    }).join('');
}

function escapeHtmlAdmin(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
