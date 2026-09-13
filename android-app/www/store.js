let allStoreProducts = [];

document.addEventListener('DOMContentLoaded', function () {
    loadStoreProducts();
    var searchInput = document.getElementById('storeSearchInput');
    if (searchInput) searchInput.addEventListener('input', renderStoreGrid);
});

async function loadStoreProducts() {
    var { data: products, error } = await supabase
        .from('products')
        .select('*, supplier_details:supplier_id(business_name)')
        .eq('approval_status', 'approved')
        .eq('active', true)
        .gt('stock_count', 0)
        .order('created_at', { ascending: false });

    allStoreProducts = error ? [] : (products || []);
    renderStoreGrid();
}

function renderStoreGrid() {
    var grid = document.getElementById('storeGrid');
    var countEl = document.getElementById('productCount');
    var searchInput = document.getElementById('storeSearchInput');
    var q = searchInput ? searchInput.value.trim().toLowerCase() : '';

    var products = allStoreProducts.filter(function (p) {
        if (!q) return true;
        var supplierName = (p.supplier_details && p.supplier_details.business_name) || '';
        return p.title.toLowerCase().includes(q) || supplierName.toLowerCase().includes(q);
    });

    if (allStoreProducts.length === 0) {
        grid.innerHTML = '<div class="store-empty">No products available yet — check back soon.</div>';
        if (countEl) countEl.textContent = '';
        return;
    }
    if (products.length === 0) {
        grid.innerHTML = '<div class="store-empty">No products match "' + escapeHtmlStore(q) + '".</div>';
        if (countEl) countEl.textContent = '0 products';
        return;
    }

    if (countEl) countEl.textContent = products.length + ' product' + (products.length === 1 ? '' : 's');

    grid.innerHTML = products.map(function (p) {
        var supplierName = (p.supplier_details && p.supplier_details.business_name) || 'Ekoquick Supplier';
        return '<div class="store-card">' +
            '<img src="' + (p.photo_url || '') + '" onerror="this.style.background=\'var(--ink)\'">' +
            '<div class="sc-body">' +
                '<div class="sc-shop">' + escapeHtmlStore(supplierName) + '</div>' +
                '<div class="sc-title">' + escapeHtmlStore(p.title) + '</div>' +
                '<div class="sc-price">R' + Number(p.price).toFixed(2) + '</div>' +
            '</div>' +
            '<button data-id="' + p.id + '">Add to Cart</button>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('button[data-id]').forEach(function (btn) {
        btn.addEventListener('click', function () { addToCart(btn.getAttribute('data-id'), btn); });
    });
}

async function addToCart(productId, btn) {
    var { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html?redirect=store.html';
        return;
    }
    var profile = await getProfile(session.user.id);
    if (!profile || profile.role !== 'customer') {
        alert('Only customer accounts can shop. Please log in as a customer.');
        return;
    }

    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = 'Adding...';

    var { data: existing } = await supabase.from('cart_items').select('*').eq('customer_id', session.user.id).eq('product_id', productId).maybeSingle();
    if (existing) {
        await supabase.from('cart_items').update({ qty: existing.qty + 1 }).eq('id', existing.id);
    } else {
        await supabase.from('cart_items').insert({ customer_id: session.user.id, product_id: productId, qty: 1 });
    }

    btn.textContent = 'Added ✓';
    setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 1200);
}

function escapeHtmlStore(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
