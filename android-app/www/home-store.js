document.addEventListener('DOMContentLoaded', loadHomeStoreProducts);

async function loadHomeStoreProducts() {
    var grid = document.getElementById('homeStoreGrid');
    if (!grid || typeof supabase === 'undefined') return;

    var { data: products, error } = await supabase
        .from('products')
        .select('*, supplier_details:supplier_id(business_name)')
        .eq('approval_status', 'approved')
        .eq('active', true)
        .gt('stock_count', 0)
        .order('created_at', { ascending: false })
        .limit(8);

    if (error || !products || products.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; color:var(--muted); font-family:var(--font-mono); font-size:13px;">New products coming very soon.</div>';
        return;
    }

    grid.innerHTML = products.map(function (p) {
        var supplierName = (p.supplier_details && p.supplier_details.business_name) || 'Ekoquick Supplier';
        return '<a class="home-store-card" href="store.html" style="text-decoration:none;">' +
            '<img src="' + (p.photo_url || '') + '" onerror="this.style.background=\'var(--ink)\'">' +
            '<div class="hsc-body">' +
                '<div class="hsc-title">' + escapeHtmlHomeStore(p.title) + '</div>' +
                '<div class="hsc-supplier">' + escapeHtmlHomeStore(supplierName) + '</div>' +
                '<div class="hsc-price">R' + Number(p.price).toFixed(2) + '</div>' +
            '</div>' +
        '</a>';
    }).join('');
}

function escapeHtmlHomeStore(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
