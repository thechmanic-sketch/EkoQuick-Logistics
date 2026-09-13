let cartCurrentUser = null;
let cartData = [];

document.addEventListener('DOMContentLoaded', async function () {
    var { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'login.html?redirect=cart.html'; return; }
    var profile = await getProfile(session.user.id);
    if (!profile || profile.role !== 'customer') {
        alert('Only customer accounts can check out. Please log in as a customer.');
        window.location.href = 'store.html';
        return;
    }
    cartCurrentUser = { id: session.user.id, phone: profile.phone, name: profile.full_name };
    document.getElementById('deliveryPhone').value = profile.phone || '';
    document.getElementById('deliveryAddress').value = profile.address || '';

    await loadCart();
    document.getElementById('checkoutBtn').addEventListener('click', checkout);
});

async function loadCart() {
    var { data: items } = await supabase
        .from('cart_items')
        .select('*, products(*, profiles:supplier_id(full_name), supplier_details(business_name))')
        .eq('customer_id', cartCurrentUser.id);

    cartData = items || [];
    var container = document.getElementById('cartItems');
    var checkoutBox = document.getElementById('checkoutBox');

    if (cartData.length === 0) {
        container.innerHTML = '<div style="color:var(--muted); font-family:var(--font-mono); font-size:13px;">Your cart is empty. <a href="store.html" style="color:var(--orange);">Browse the store →</a></div>';
        checkoutBox.style.display = 'none';
        return;
    }

    container.innerHTML = cartData.map(function (item) {
        var p = item.products;
        var supplierName = (p.supplier_details && p.supplier_details.business_name) || 'Supplier';
        return '<div class="cart-item" data-cart-id="' + item.id + '">' +
            '<img src="' + (p.photo_url || '') + '" onerror="this.style.background=\'var(--ink-2)\'">' +
            '<div class="ci-info">' +
                '<div class="ci-title">' + escapeHtmlCart(p.title) + '</div>' +
                '<div class="ci-supplier">' + escapeHtmlCart(supplierName) + ' · R' + Number(p.price).toFixed(2) + '</div>' +
            '</div>' +
            '<div class="ci-qty">' +
                '<button class="qty-dec">−</button><span>' + item.qty + '</span><button class="qty-inc">+</button>' +
            '</div>' +
            '<button class="ci-remove">Remove</button>' +
        '</div>';
    }).join('');

    container.querySelectorAll('.cart-item').forEach(function (row) {
        var cartId = row.getAttribute('data-cart-id');
        row.querySelector('.qty-inc').addEventListener('click', function () { changeQty(cartId, 1); });
        row.querySelector('.qty-dec').addEventListener('click', function () { changeQty(cartId, -1); });
        row.querySelector('.ci-remove').addEventListener('click', function () { removeFromCart(cartId); });
    });

    checkoutBox.style.display = 'block';
    updateTotals();
}

async function changeQty(cartId, delta) {
    var item = cartData.find(function (i) { return i.id === cartId; });
    if (!item) return;
    var newQty = item.qty + delta;
    if (newQty <= 0) { await removeFromCart(cartId); return; }
    await supabase.from('cart_items').update({ qty: newQty }).eq('id', cartId);
    loadCart();
}

async function removeFromCart(cartId) {
    await supabase.from('cart_items').delete().eq('id', cartId);
    loadCart();
}

function updateTotals() {
    var subtotal = cartData.reduce(function (sum, i) { return sum + (i.products.price * i.qty); }, 0);
    var supplierCount = new Set(cartData.map(function (i) { return i.products.supplier_id; })).size;
    document.getElementById('ckSubtotal').textContent = 'R' + subtotal.toFixed(2);
    document.getElementById('ckDelivery').textContent = supplierCount + ' quote' + (supplierCount === 1 ? '' : 's') + ' calculated at checkout';
    document.getElementById('ckPlatformFee').textContent = 'R2.00 × ' + supplierCount + ' order' + (supplierCount === 1 ? '' : 's');
    document.getElementById('ckTotal').textContent = 'R' + subtotal.toFixed(2) + ' + delivery';
}

function generateCartCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

async function checkout() {
    var msg = document.getElementById('checkoutMsg');
    msg.textContent = '';
    var address = document.getElementById('deliveryAddress').value.trim();
    var phone = document.getElementById('deliveryPhone').value.trim();
    var paymentMethod = document.getElementById('paymentMethod').value;

    if (!address || !phone) { msg.textContent = 'Please enter a delivery address and phone number.'; return; }
    if (cartData.length === 0) { msg.textContent = 'Your cart is empty.'; return; }

    var btn = document.getElementById('checkoutBtn');
    btn.disabled = true;
    btn.textContent = 'Placing order...';

    try {
        await PricingEngine.load();
        var dropoffCoords = await geocodeAddress(address);

        var bySupplier = {};
        cartData.forEach(function (item) {
            var sid = item.products.supplier_id;
            if (!bySupplier[sid]) bySupplier[sid] = [];
            bySupplier[sid].push(item);
        });

        var supplierIds = Object.keys(bySupplier);
        for (var i = 0; i < supplierIds.length; i++) {
            var supplierId = supplierIds[i];
            var items = bySupplier[supplierId];
            var subtotal = items.reduce(function (sum, it) { return sum + (it.products.price * it.qty); }, 0);

            var { data: supplierDetails } = await supabase.from('supplier_details').select('*').eq('id', supplierId).single();
            var pickupAddress = supplierDetails ? supplierDetails.pickup_address : '';
            var pickupCoords = supplierDetails && supplierDetails.pickup_lat
                ? { lat: supplierDetails.pickup_lat, lng: supplierDetails.pickup_lng }
                : await geocodeAddress(pickupAddress);

            var distanceKm = 5, durationLabel = null;
            if (pickupCoords && dropoffCoords) {
                var route = await GoogleMaps.computeRouteDetails(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
                if (route) { distanceKm = route.distanceKm; durationLabel = Math.round(route.durationSeconds / 60) + ' min'; }
            }

            var quote = PricingEngine.calculateQuote({
                vehicleId: 'bike',
                distanceKm: distanceKm,
                weightKg: 1,
                parcelCategory: 'parcel',
                priority: 'normal',
                trafficLevel: 'light',
                routeType: 'urban',
                durationLabel: durationLabel,
            });

            var { data: job, error: jobError } = await supabase.from('jobs').insert({
                customer_id: cartCurrentUser.id,
                pickup: pickupAddress,
                pickup_lat: pickupCoords ? pickupCoords.lat : null,
                pickup_lng: pickupCoords ? pickupCoords.lng : null,
                dropoff: address,
                dropoff_lat: dropoffCoords ? dropoffCoords.lat : null,
                dropoff_lng: dropoffCoords ? dropoffCoords.lng : null,
                vehicle: 'bike',
                distance: distanceKm,
                duration: durationLabel,
                quote: quote.customerTotal,
                pricing_breakdown: quote,
                customer_phone: phone,
                sender_name: (supplierDetails && supplierDetails.business_name) || 'Ekoquick Store Supplier',
                receiver_name: cartCurrentUser.name || 'Customer',
                receiver_phone: phone,
                package_type: 'parcel',
                package_description: items.map(function (it) { return it.qty + 'x ' + it.products.title; }).join(', '),
                delivery_type: 'standard',
                collection_code: generateCartCode(),
                delivery_code: generateCartCode(),
                status: 'pending',
                payment_method: paymentMethod,
                payment_status: 'pending',
            }).select().single();

            if (jobError) { msg.textContent = 'Order failed: ' + jobError.message; btn.disabled = false; btn.textContent = 'Place Order'; return; }

            var { data: storeOrder, error: orderError } = await supabase.from('store_orders').insert({
                customer_id: cartCurrentUser.id,
                supplier_id: supplierId,
                job_id: job.id,
                subtotal: subtotal,
                platform_fee: 2,
                status: 'pending',
            }).select().single();

            if (orderError) { msg.textContent = 'Order failed: ' + orderError.message; btn.disabled = false; btn.textContent = 'Place Order'; return; }

            var orderItemsPayload = items.map(function (it) {
                return { store_order_id: storeOrder.id, product_id: it.products.id, title: it.products.title, qty: it.qty, unit_price: it.products.price };
            });
            await supabase.from('order_items').insert(orderItemsPayload);

            items.forEach(function (it) {
                supabase.from('products').update({ stock_count: Math.max(0, it.products.stock_count - it.qty) }).eq('id', it.products.id);
            });
        }

        await supabase.from('cart_items').delete().eq('customer_id', cartCurrentUser.id);
        window.location.href = 'my-orders.html';
    } catch (err) {
        msg.textContent = 'Something went wrong: ' + (err && err.message ? err.message : err);
        btn.disabled = false;
        btn.textContent = 'Place Order';
    }
}

function escapeHtmlCart(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
