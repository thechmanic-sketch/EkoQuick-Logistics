let currentUser = null;
let currentDetails = null;

document.addEventListener('DOMContentLoaded', async function () {
    var { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'supplier-login.html'; return; }

    var profile = await getProfile(session.user.id);
    if (!profile || profile.role !== 'supplier') {
        await supabase.auth.signOut();
        window.location.href = 'supplier-login.html';
        return;
    }
    currentUser = { id: session.user.id, full_name: profile.full_name };
    document.getElementById('supplierName').textContent = profile.full_name || '';

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'supplier-login.html';
    });

    document.getElementById('addProductForm').addEventListener('submit', addProduct);

    await loadDetails();
    await loadOrders();
    await loadProducts();

    supabase.channel('supplier-orders-' + currentUser.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders', filter: 'supplier_id=eq.' + currentUser.id }, loadOrders)
        .subscribe();
});

async function loadDetails() {
    var { data } = await supabase.from('supplier_details').select('*').eq('id', currentUser.id).single();
    currentDetails = data;
    var banner = document.getElementById('approvalBanner');
    if (!data || data.verification_status === 'pending') {
        banner.innerHTML = '⏳ Your account is pending admin approval. You can add products now, but nothing will be visible to customers until you\'re approved.';
    } else if (data.verification_status === 'rejected') {
        banner.innerHTML = '⚠️ Your account was not approved. Contact support for details.';
    } else {
        banner.innerHTML = '✅ Approved — ' + data.business_name;
    }
}

async function loadOrders() {
    var { data: orders } = await supabase
        .from('store_orders')
        .select('*, order_items(*)')
        .eq('supplier_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(30);

    var list = document.getElementById('ordersList');
    if (!orders || orders.length === 0) {
        list.innerHTML = '<div class="empty">No orders yet.</div>';
    } else {
        list.innerHTML = orders.map(renderOrderCard).join('');
        orders.forEach(function (o) {
            if (o.status !== 'pending') return;
            var readyBtn = document.getElementById('ready-' + o.id);
            var cancelBtn = document.getElementById('cancel-' + o.id);
            if (readyBtn) readyBtn.addEventListener('click', function () { markOrderReady(o.id); });
            if (cancelBtn) cancelBtn.addEventListener('click', function () { cancelOrder(o.id); });
        });
    }

    var summary = document.getElementById('summaryCards');
    var pendingCount = (orders || []).filter(function (o) { return o.status === 'pending'; }).length;
    var totalEarned = (orders || []).filter(function (o) { return o.status !== 'cancelled' && o.status !== 'cancelled_by_supplier'; })
        .reduce(function (sum, o) { return sum + Number(o.subtotal) - Number(o.platform_fee); }, 0);
    summary.innerHTML =
        '<div class="summary-card"><div class="s-label">Pending Orders</div><div class="s-value">' + pendingCount + '</div></div>' +
        '<div class="summary-card"><div class="s-label">Net Earnings (all time)</div><div class="s-value">R' + totalEarned.toFixed(2) + '</div></div>';
}

function renderOrderCard(o) {
    var items = (o.order_items || []).map(function (i) { return i.qty + '× ' + i.title; }).join(', ');
    var actions = '';
    if (o.status === 'pending') {
        actions = '<div class="order-actions">' +
            '<button class="btn btn-blue" id="ready-' + o.id + '" style="width:auto;">Mark Ready</button>' +
            '<button class="btn btn-outline-blue" id="cancel-' + o.id + '" style="width:auto;">Cancel — Out of Stock</button>' +
            '</div>';
    }
    return '<div class="order-card">' +
        '<div class="orow"><b>R' + Number(o.subtotal).toFixed(2) + '</b><span class="status-pill ' + (o.status === 'pending' ? 'pending' : o.status.indexOf('cancel') === 0 ? 'rejected' : 'approved') + '">' + o.status.replace(/_/g, ' ') + '</span></div>' +
        '<div class="pmeta" style="font-size:12px; color:var(--muted); margin-top:4px;">' + items + '</div>' +
        '<div class="pmeta" style="font-size:11px; color:var(--muted); margin-top:2px;">' + new Date(o.created_at).toLocaleString() + '</div>' +
        actions +
        '</div>';
}

async function markOrderReady(orderId) {
    await supabase.from('store_orders').update({ status: 'ready', ready_at: new Date().toISOString() }).eq('id', orderId);
    loadOrders();
}

async function cancelOrder(orderId) {
    if (!confirm('Cancel this order due to being out of stock? The customer will be refunded by admin.')) return;
    await supabase.from('store_orders').update({ status: 'cancelled_by_supplier', cancelled_at: new Date().toISOString(), cancellation_reason: 'Out of stock' }).eq('id', orderId);
    loadOrders();
}

async function loadProducts() {
    var { data: products } = await supabase.from('products').select('*').eq('supplier_id', currentUser.id).order('created_at', { ascending: false });
    var list = document.getElementById('productsList');
    if (!products || products.length === 0) {
        list.innerHTML = '<div class="empty">No products yet — add your first one above.</div>';
        return;
    }
    list.innerHTML = products.map(function (p) {
        return '<div class="product-card">' +
            '<img src="' + (p.photo_url || '') + '" onerror="this.style.display=\'none\'">' +
            '<div class="pinfo">' +
                '<div class="ptitle">' + escapeHtml(p.title) + '</div>' +
                '<div class="pmeta">R' + Number(p.price).toFixed(2) + ' · Stock: ' + p.stock_count + '</div>' +
            '</div>' +
            '<span class="status-pill ' + p.approval_status + '">' + p.approval_status + '</span>' +
        '</div>';
    }).join('');
}

async function addProduct(e) {
    e.preventDefault();
    var msg = document.getElementById('addProductMsg');
    msg.textContent = '';
    var title = document.getElementById('pTitle').value.trim();
    var description = document.getElementById('pDescription').value.trim();
    var price = parseFloat(document.getElementById('pPrice').value);
    var stock = parseInt(document.getElementById('pStock').value, 10);
    var photoFile = document.getElementById('pPhoto').files[0];

    if (!title || !price || price <= 0 || isNaN(stock) || stock < 0) {
        msg.textContent = 'Please fill in title, a valid price and stock count.';
        return;
    }

    var photoUrl = null;
    if (photoFile) {
        var ext = photoFile.name.split('.').pop();
        var path = currentUser.id + '/' + Date.now() + '.' + ext;
        var { error: uploadError } = await supabase.storage.from('product-photos').upload(path, photoFile);
        if (uploadError) { msg.textContent = uploadError.message; return; }
        photoUrl = supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
    }

    var { error } = await supabase.from('products').insert({
        supplier_id: currentUser.id,
        title: title,
        description: description,
        price: price,
        stock_count: stock,
        photo_url: photoUrl,
    });
    if (error) { msg.textContent = error.message; return; }

    msg.textContent = 'Product added — pending admin approval.';
    document.getElementById('addProductForm').reset();
    loadProducts();
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
