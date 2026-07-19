let currentUser = null;
let selectedVehicle = VEHICLES[0];
let currentDistance = 0;
let currentDuration = '';
let currentQuote = 0;

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (profile && profile.account_status !== 'active') {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
        return;
    }

    renderVehicles();
    document.getElementById('calcBtn').addEventListener('click', calculateDistance);
    document.getElementById('bookBtn').addEventListener('click', bookNow);
});

function renderVehicles() {
    const grid = document.getElementById('vehicleGrid');
    grid.innerHTML = VEHICLES.map(function (v, i) {
        return (
            '<div class="vopt' + (i === 0 ? ' selected' : '') + '" data-id="' + v.id + '">' +
                '<span class="icon">' + v.icon + '</span>' + v.label +
                '<div style="font-size:10px; margin-top:4px; color:#9AA0A6;">R' + v.base + ' + R' + v.rate.toFixed(2) + '/km</div>' +
            '</div>'
        );
    }).join('');
    grid.querySelectorAll('.vopt').forEach(function (el) {
        el.addEventListener('click', function () {
            grid.querySelectorAll('.vopt').forEach(function (o) { o.classList.remove('selected'); });
            el.classList.add('selected');
            selectedVehicle = VEHICLES.find(function (v) { return v.id === el.dataset.id; });
            if (currentDistance > 0) calculateQuote();
        });
    });
}

function showMsg(type, text) {
    document.getElementById('msgArea').innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

async function calculateDistance() {
    const pickup = document.getElementById('pickup').value.trim();
    const dropoff = document.getElementById('dropoff').value.trim();
    const btn = document.getElementById('calcBtn');

    if (!pickup || !dropoff) { showMsg('error', 'Please enter both pickup and drop-off locations'); return; }

    btn.disabled = true;
    btn.textContent = 'Calculating...';

    try {
        const origins = encodeURIComponent(pickup + ', KwaZulu-Natal, South Africa');
        const destinations = encodeURIComponent(dropoff + ', KwaZulu-Natal, South Africa');
        const res = await fetch('https://api.distancematrix.ai/maps/api/distancematrix/json?key=' + DISTANCE_MATRIX_API_KEY + '&origins=' + origins + '&destinations=' + destinations + '&mode=driving');
        const data = await res.json();
        const el = data && data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0];
        if (data.status === 'OK' && el && el.status === 'OK') {
            currentDistance = Math.round(el.distance.value / 1000);
            currentDuration = formatDuration(el.duration.value);
            showMsg('success', 'Real driving distance: ' + currentDistance + ' km');
            calculateQuote();
            btn.disabled = false;
            btn.textContent = '3. Calculate Distance & Price';
            return;
        }
    } catch (err) { /* fall through */ }

    const fb = fallbackDistance(pickup, dropoff);
    if (fb) {
        currentDistance = fb;
        currentDuration = '';
        showMsg('success', 'Estimated distance: ' + fb + ' km');
        calculateQuote();
    } else {
        showMsg('error', 'Could not calculate distance. Try more specific addresses.');
    }
    btn.disabled = false;
    btn.textContent = '3. Calculate Distance & Price';
}

function calculateQuote() {
    currentQuote = Math.round(selectedVehicle.base + currentDistance * selectedVehicle.rate);
    document.getElementById('quoteAmount').textContent = 'R' + currentQuote;
    document.getElementById('quoteDetail').textContent = selectedVehicle.label + ' • ' + currentDistance + ' km' + (currentDuration ? ' • ~' + currentDuration : '');
    document.getElementById('quoteBox').classList.remove('hidden');
    document.getElementById('bookBtn').classList.remove('hidden');
}

function generateCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

async function geocodeAddress(address) {
    try {
        const q = encodeURIComponent(address + ', KwaZulu-Natal, South Africa');
        const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + q);
        const results = await res.json();
        if (results && results[0]) {
            return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
        }
    } catch (err) { /* best effort — falls back gracefully with no coordinates */ }
    return null;
}

async function bookNow() {
    const pickup = document.getElementById('pickup').value.trim();
    const dropoff = document.getElementById('dropoff').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const receiverName = document.getElementById('receiverName').value.trim();
    const receiverPhone = document.getElementById('receiverPhone').value.trim();

    if (!pickup || !dropoff || !phone || !receiverName || !receiverPhone || currentQuote <= 0) {
        showMsg('error', 'Please fill in all fields and calculate a price first');
        return;
    }

    const btn = document.getElementById('bookBtn');
    btn.disabled = true;
    btn.textContent = 'Booking...';

    const [pickupCoords, dropoffCoords] = await Promise.all([geocodeAddress(pickup), geocodeAddress(dropoff)]);

    const { data, error } = await supabase.from('jobs').insert({
        customer_id: currentUser.id,
        pickup: pickup,
        pickup_lat: pickupCoords ? pickupCoords.lat : null,
        pickup_lng: pickupCoords ? pickupCoords.lng : null,
        dropoff: dropoff,
        dropoff_lat: dropoffCoords ? dropoffCoords.lat : null,
        dropoff_lng: dropoffCoords ? dropoffCoords.lng : null,
        vehicle: selectedVehicle.id,
        distance: currentDistance,
        duration: currentDuration,
        quote: currentQuote,
        customer_phone: phone,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        collection_code: generateCode(),
        delivery_code: generateCode(),
        status: 'pending',
    }).select().single();

    if (error) {
        btn.disabled = false;
        btn.textContent = 'Confirm Delivery';
        showMsg('error', 'Booking failed: ' + error.message);
        return;
    }

    window.location.href = 'driver-assigned.html?job=' + data.id;
}
