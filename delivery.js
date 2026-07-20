let currentUser = null;
let currentProfile = null;
let selectedVehicle = null;
let currentBreakdown = null;
let currentDistance = 0;
let currentDuration = '';
let currentDurationSeconds = 0;
let currentQuote = 0;
let selectedPaymentMethod = 'cash';
let selectedDeliveryType = 'standard';
let selectedSchedule = 'now';
let currentStep = 1;
let pickupCoords = null;
let dropoffCoords = null;
let pickupMode = new URLSearchParams(window.location.search).get('mode') === 'pickup';
let pickupMap = null, dropoffMap = null, pickupMarker = null, dropoffMarker = null;

const TOTAL_STEPS = 5;

const PAYMENT_METHODS = [
    { id: 'cash', label: 'Cash on delivery', available: true, note: 'Pay the driver directly when your parcel is collected or delivered.' },
    { id: 'card', label: 'Card', available: false, note: 'Coming soon — card payments will be available once our payment gateway is connected.' },
    { id: 'eft', label: 'EFT (Business accounts only)', available: false, businessOnly: true, note: 'Manually verified bank transfer. Upload proof of payment after booking.' },
];

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    currentProfile = await getProfile(currentUser.id);
    if (currentProfile && currentProfile.account_status !== 'active') {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
        return;
    }

    await loadAppSettings();
    await PricingEngine.load();
    selectedVehicle = PricingEngine.getConfig().vehicles[0];

    if (pickupMode) {
        applyPickupModeLabels();
        if (currentProfile) {
            document.getElementById('receiverName').value = currentProfile.full_name || '';
            document.getElementById('receiverPhone').value = currentProfile.phone || '';
            document.getElementById('receiverEmail').value = currentProfile.email || '';
        }
        const { data: defaultAddr } = await supabase.from('saved_addresses').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (defaultAddr) {
            document.getElementById('dropoff').value = defaultAddr.street || '';
            if (defaultAddr.lat && defaultAddr.lng) dropoffCoords = { lat: defaultAddr.lat, lng: defaultAddr.lng };
        }
        document.getElementById('packageType').value = 'store_pickup';
    } else if (currentProfile) {
        document.getElementById('senderName').value = currentProfile.full_name || '';
        document.getElementById('senderPhone').value = currentProfile.phone || '';
        document.getElementById('senderEmail').value = currentProfile.email || '';
    }

    renderStepIndicator();
    renderVehicles();
    renderPaymentOptions();
    wireNav();
    wireMapPickers();
    wireScheduleToggles();

    document.getElementById('savedAddrBtn1').addEventListener('click', showSavedAddresses);
    document.getElementById('calcBtn').addEventListener('click', calculateDistance);
    document.getElementById('bookBtn').addEventListener('click', bookNow);
});

function applyPickupModeLabels() {
    document.title = 'Ekoquick — Request a Pickup';
    document.getElementById('wizardTitle').textContent = 'Request a Pickup';
    document.getElementById('step1Title').textContent = '1. Where do we collect it?';
    document.getElementById('senderNameLabel').textContent = 'Store / Business Name';
    document.getElementById('senderPhoneLabel').textContent = 'Store Phone Number (if known)';
    document.getElementById('pickupLabel').textContent = 'Store / Collection Address';
    document.getElementById('pickup').placeholder = 'e.g. Game Pavilion, Musgrave Road, Durban';

    document.getElementById('step2Title').textContent = '2. Your Details';
    document.getElementById('receiverNameLabel').textContent = 'Your Full Name';
    document.getElementById('receiverPhoneLabel').textContent = 'Your Phone Number';
    document.getElementById('receiverEmailLabel').textContent = 'Your Email (optional)';
    document.getElementById('dropoffLabel').textContent = 'Your Address';
    document.getElementById('dropoff').placeholder = 'e.g. 12 Main Road, Pietermaritzburg';
    document.getElementById('codeNote').textContent = "We'll generate a collection code so the driver can confirm your order at the store, and a delivery code for you to give the driver when it arrives.";

    document.getElementById('step3Title').textContent = '3. What are we collecting?';
    document.getElementById('packageDescLabel').textContent = 'Order / item description';
    document.getElementById('packageDescription').placeholder = 'e.g. Order #4021 at the counter, ready for collection';
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function showMsg(elId, type, text) {
    document.getElementById(elId).innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}
function clearMsg(elId) {
    document.getElementById(elId).innerHTML = '';
}

function phoneLooksValid(p) {
    return /^[0-9+][0-9 ]{6,}$/.test(p.trim());
}

// ---- Step indicator / navigation ----

let maxStepReached = 1;

function renderStepIndicator() {
    const labels = pickupMode ? ['Store', 'You', 'Item', 'Vehicle', 'Payment'] : ['Pickup', 'Recipient', 'Parcel', 'Vehicle', 'Payment'];
    const el = document.getElementById('stepIndicator');
    el.innerHTML = labels.map(function (label, i) {
        const n = i + 1;
        const reachable = n <= maxStepReached;
        return '<div class="step-dot' + (n === currentStep ? ' active' : n < currentStep ? ' done' : '') + (reachable ? ' clickable' : '') + '" data-step="' + n + '">' + label + '</div>';
    }).join('');
    el.querySelectorAll('.step-dot.clickable').forEach(function (dot) {
        dot.addEventListener('click', function () { goToStep(parseInt(dot.dataset.step, 10)); });
    });
}

function goToStep(n) {
    if (n > maxStepReached) return;
    currentStep = n;
    document.querySelectorAll('.step-panel').forEach(function (p) { p.classList.toggle('active', parseInt(p.dataset.step, 10) === n); });
    renderStepIndicator();
    if (n === 5) renderOrderSummary();
    window.scrollTo(0, 0);
}

function advanceToStep(n) {
    maxStepReached = Math.max(maxStepReached, n);
    goToStep(n);
}

function wireNav() {
    document.getElementById('next1').addEventListener('click', function () {
        clearMsg('msgArea1');
        const name = document.getElementById('senderName').value.trim();
        const phone = document.getElementById('senderPhone').value.trim();
        const pickup = document.getElementById('pickup').value.trim();
        if (!name) { showMsg('msgArea1', 'error', pickupMode ? 'Store / business name is required.' : 'Your full name is required.'); return; }
        if (!pickupMode && (!phone || !phoneLooksValid(phone))) { showMsg('msgArea1', 'error', 'A valid phone number is required.'); return; }
        if (phone && !phoneLooksValid(phone)) { showMsg('msgArea1', 'error', 'Phone number looks invalid.'); return; }
        if (!pickup) { showMsg('msgArea1', 'error', pickupMode ? 'Store / collection address missing.' : 'Pickup address missing.'); return; }
        advanceToStep(2);
    });

    document.getElementById('back2').addEventListener('click', function () { goToStep(1); });
    document.getElementById('next2').addEventListener('click', function () {
        clearMsg('msgArea2');
        const name = document.getElementById('receiverName').value.trim();
        const phone = document.getElementById('receiverPhone').value.trim();
        const dropoff = document.getElementById('dropoff').value.trim();
        if (!name) { showMsg('msgArea2', 'error', 'Recipient name is required.'); return; }
        if (!phone || !phoneLooksValid(phone)) { showMsg('msgArea2', 'error', 'Recipient phone invalid.'); return; }
        if (!dropoff) { showMsg('msgArea2', 'error', 'Delivery address missing.'); return; }
        advanceToStep(3);
    });

    document.getElementById('back3').addEventListener('click', function () { goToStep(2); });
    document.getElementById('next3').addEventListener('click', function () { advanceToStep(4); });

    document.getElementById('back4').addEventListener('click', function () { goToStep(3); });
    document.getElementById('next4').addEventListener('click', function () {
        if (currentQuote <= 0) { showMsg('msgArea4', 'error', 'Please calculate the price first.'); return; }
        advanceToStep(5);
    });

    document.getElementById('back5').addEventListener('click', function () { goToStep(4); });
}

// ---- Map pickers (Leaflet + Nominatim, no Google Maps key connected) ----

function wireMapPickers() {
    document.getElementById('pickMapBtn1').addEventListener('click', function () {
        const mapEl = document.getElementById('pickupMap');
        mapEl.classList.toggle('hidden');
        if (!mapEl.classList.contains('hidden') && !pickupMap) {
            pickupMap = L.map('pickupMap').setView([-29.6, 30.9], 8);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(pickupMap);
            pickupMap.on('click', async function (e) {
                pickupCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                if (pickupMarker) pickupMarker.setLatLng(e.latlng); else pickupMarker = L.marker(e.latlng).addTo(pickupMap);
                const addr = await reverseGeocode(e.latlng.lat, e.latlng.lng);
                if (addr) document.getElementById('pickup').value = addr;
            });
        }
    });

    document.getElementById('pickMapBtn2').addEventListener('click', function () {
        const mapEl = document.getElementById('dropoffMap');
        mapEl.classList.toggle('hidden');
        if (!mapEl.classList.contains('hidden') && !dropoffMap) {
            dropoffMap = L.map('dropoffMap').setView([-29.6, 30.9], 8);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(dropoffMap);
            dropoffMap.on('click', async function (e) {
                dropoffCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                if (dropoffMarker) dropoffMarker.setLatLng(e.latlng); else dropoffMarker = L.marker(e.latlng).addTo(dropoffMap);
                const addr = await reverseGeocode(e.latlng.lat, e.latlng.lng);
                if (addr) document.getElementById('dropoff').value = addr;
            });
        }
    });
}

async function showSavedAddresses() {
    const wrap = document.getElementById('savedAddrList1');
    const showing = !wrap.classList.contains('hidden');
    if (showing) { wrap.classList.add('hidden'); return; }

    const { data } = await supabase.from('saved_addresses').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
    if (!data || !data.length) {
        wrap.textContent = 'No saved addresses.';
        wrap.classList.remove('hidden');
        return;
    }
    wrap.classList.remove('hidden');
    wrap.innerHTML = data.map(function (a) {
        return '<div style="padding:6px 0; border-bottom:1px solid var(--line); cursor:pointer;" data-lat="' + (a.lat || '') + '" data-lng="' + (a.lng || '') + '" data-street="' + escapeHtml(a.street) + '">' +
            '<b>' + escapeHtml(a.label) + '</b><br><span class="meta">' + escapeHtml(a.street) + '</span></div>';
    }).join('');
    wrap.querySelectorAll('div[data-street]').forEach(function (el) {
        el.addEventListener('click', function () {
            document.getElementById('pickup').value = el.dataset.street;
            if (el.dataset.lat && el.dataset.lng) pickupCoords = { lat: parseFloat(el.dataset.lat), lng: parseFloat(el.dataset.lng) };
            wrap.classList.add('hidden');
        });
    });
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng);
        const data = await res.json();
        return data && data.display_name ? data.display_name : null;
    } catch (err) { return null; }
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

// ---- Payment options ----

function renderPaymentOptions() {
    const isBusiness = currentProfile && currentProfile.customer_type === 'business';
    const el = document.getElementById('paymentOptions');
    el.innerHTML = PAYMENT_METHODS.map(function (m) {
        const unlocked = m.id === 'eft' ? (m.available || isBusiness) : m.available;
        return (
            '<label style="display:flex; align-items:flex-start; gap:8px; margin-bottom:10px; opacity:' + (unlocked ? '1' : '0.5') + ';">' +
                '<input type="radio" name="paymentMethod" value="' + m.id + '" ' + (m.id === 'cash' ? 'checked' : '') + (unlocked ? '' : ' disabled') + '>' +
                '<span><b>' + m.label + '</b><br><span style="font-size:11px; color:var(--muted-dim);">' + m.note + '</span></span>' +
            '</label>'
        );
    }).join('');

    el.querySelectorAll('input[name="paymentMethod"]').forEach(function (input) {
        input.addEventListener('change', function () {
            selectedPaymentMethod = input.value;
            document.getElementById('eftProofArea').classList.toggle('hidden', selectedPaymentMethod !== 'eft');
            renderOrderSummary();
        });
    });
}

// ---- Vehicles / delivery type / schedule ----

function renderVehicles() {
    const vehicles = PricingEngine.getConfig().vehicles;
    const grid = document.getElementById('vehicleGrid');
    grid.innerHTML = vehicles.map(function (v, i) {
        return (
            '<div class="vopt' + (i === 0 ? ' selected' : '') + '" data-id="' + v.vehicle_id + '">' +
                '<span class="icon">' + v.icon + '</span>' + v.label +
                '<div style="font-size:10px; margin-top:4px; color:#9AA0A6;">R' + v.base_fare + ' + R' + parseFloat(v.price_per_km).toFixed(2) + '/km</div>' +
            '</div>'
        );
    }).join('');
    grid.querySelectorAll('.vopt').forEach(function (el) {
        el.addEventListener('click', function () {
            grid.querySelectorAll('.vopt').forEach(function (o) { o.classList.remove('selected'); });
            el.classList.add('selected');
            selectedVehicle = vehicles.find(function (v) { return v.vehicle_id === el.dataset.id; });
            if (currentDistance > 0) calculateQuote();
        });
    });
}

function wireScheduleToggles() {
    document.querySelectorAll('.schedule-toggle button[data-type]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.schedule-toggle button[data-type]').forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            selectedDeliveryType = btn.dataset.type;
            if (currentDistance > 0) calculateQuote();
        });
    });
    document.querySelectorAll('.schedule-toggle button[data-when]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.schedule-toggle button[data-when]').forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            selectedSchedule = btn.dataset.when;
            document.getElementById('scheduleFields').classList.toggle('hidden', selectedSchedule !== 'later');
        });
    });
}

// ---- Distance / price calculation ----

async function calculateDistance() {
    const pickup = document.getElementById('pickup').value.trim();
    const dropoff = document.getElementById('dropoff').value.trim();
    const btn = document.getElementById('calcBtn');
    clearMsg('msgArea4');

    if (!pickup || !dropoff) { showMsg('msgArea4', 'error', 'Pickup and drop-off addresses are required.'); return; }

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
            currentDurationSeconds = el.duration.value;
            currentDuration = formatDuration(el.duration.value);
            calculateQuote();
            btn.disabled = false;
            btn.textContent = 'Calculate Distance & Price';
            return;
        }
    } catch (err) { /* fall through */ }

    const fb = fallbackDistance(pickup, dropoff);
    if (fb) {
        currentDistance = fb;
        currentDurationSeconds = Math.round((fb / 30) * 3600);
        currentDuration = formatDuration(currentDurationSeconds);
        calculateQuote();
    } else {
        showMsg('msgArea4', 'error', 'Could not calculate distance. Try more specific addresses.');
    }
    btn.disabled = false;
    btn.textContent = 'Calculate Distance & Price';
}

function calculateQuote() {
    const weightKg = parseFloat(document.getElementById('packageWeight').value) || 0;
    const parcelCategory = document.getElementById('packageType').value;
    const priority = selectedDeliveryType === 'express' ? 'express' : (selectedSchedule === 'later' ? 'scheduled' : 'normal');

    // Traffic/route data isn't wired to a live provider yet (see Admin > Pricing
    // Engine notes) — defaults to the lightest/most common multiplier so quotes
    // aren't inflated until that's connected.
    currentBreakdown = PricingEngine.calculateQuote({
        vehicleId: selectedVehicle.vehicle_id,
        distanceKm: currentDistance,
        durationLabel: currentDuration,
        weightKg: weightKg,
        parcelCategory: parcelCategory,
        extraStops: 0,
        waitingMinutes: 0,
        priority: priority,
        trafficLevel: 'light',
        routeType: 'urban',
    });
    currentQuote = currentBreakdown.customerTotal;

    document.getElementById('quoteAmount').textContent = 'R' + currentQuote;
    document.getElementById('quoteDetail').textContent = selectedVehicle.label + ' • ' + currentDistance + ' km' +
        (selectedDeliveryType === 'express' ? ' • Express (+50%)' : '');
    document.getElementById('quoteEta').textContent = 'Estimated travel time: ' + (currentDuration || '—');
    document.getElementById('quoteBox').classList.remove('hidden');
    document.getElementById('next4').classList.remove('hidden');
}

function generateCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

// ---- Order summary (step 5) ----

function renderOrderSummary() {
    const scheduleLabel = selectedSchedule === 'later'
        ? ('Scheduled: ' + (document.getElementById('scheduleDate').value || '—') + ' ' + (document.getElementById('scheduleTime').value || ''))
        : 'Deliver now';
    const lines = [
        [pickupMode ? 'Collecting from' : 'Pickup Address', document.getElementById('pickup').value.trim()],
        [pickupMode ? 'Delivering to' : 'Delivery Address', document.getElementById('dropoff').value.trim()],
        ['Vehicle Class', selectedVehicle.label],
        ['Distance', currentDistance + ' km'],
        ['Delivery Fee', 'R' + currentQuote],
        ['Estimated Time', currentDuration || '—'],
        ['Delivery Type', selectedDeliveryType === 'express' ? 'Express' : 'Standard'],
        ['Schedule', scheduleLabel],
        ['Payment Method', selectedPaymentMethod.toUpperCase()],
    ];
    document.getElementById('orderSummary').innerHTML = lines.map(function (l) {
        return '<div class="summary-line"><span>' + l[0] + '</span><span>' + escapeHtml(String(l[1])) + '</span></div>';
    }).join('');
}

// ---- Booking submission ----

async function bookNow() {
    clearMsg('msgArea5');

    const pickup = document.getElementById('pickup').value.trim();
    const dropoff = document.getElementById('dropoff').value.trim();
    const senderPhone = document.getElementById('senderPhone').value.trim();
    const receiverName = document.getElementById('receiverName').value.trim();
    const receiverPhone = document.getElementById('receiverPhone').value.trim();

    if (!pickup || !dropoff || (!pickupMode && !senderPhone) || !receiverName || !receiverPhone || currentQuote <= 0 || !selectedVehicle) {
        showMsg('msgArea5', 'error', 'Please complete all required fields and calculate a price first.');
        return;
    }
    if (!document.getElementById('agreeCheckbox').checked) {
        showMsg('msgArea5', 'error', 'Please confirm the information provided is correct.');
        return;
    }

    const maxActiveOrders = parseInt(appSetting('customer_max_active_orders', '0'), 10) || 0;
    if (maxActiveOrders > 0) {
        const { data: activeJobs } = await supabase.from('jobs').select('id').eq('customer_id', currentUser.id).in('status', ['pending', 'offered', 'to_pickup', 'to_dropoff']);
        if ((activeJobs || []).length >= maxActiveOrders) {
            showMsg('msgArea5', 'error', 'You have reached the maximum of ' + maxActiveOrders + ' active order(s). Please wait for a current order to complete before booking another.');
            return;
        }
    }

    let eftProofFile = null;
    if (selectedPaymentMethod === 'eft') {
        eftProofFile = document.getElementById('eftProofFile').files[0];
        if (!eftProofFile) { showMsg('msgArea5', 'error', 'Please upload your proof of EFT payment'); return; }
    }

    let scheduledAt = null;
    if (selectedSchedule === 'later') {
        const date = document.getElementById('scheduleDate').value;
        const time = document.getElementById('scheduleTime').value;
        if (!date || !time) { showMsg('msgArea5', 'error', 'Please select a date and time for scheduled delivery.'); return; }
        scheduledAt = new Date(date + 'T' + time).toISOString();
    }

    const btn = document.getElementById('bookBtn');
    btn.disabled = true;
    btn.textContent = 'Booking...';

    if (!pickupCoords) pickupCoords = await geocodeAddress(pickup);
    if (!dropoffCoords) dropoffCoords = await geocodeAddress(dropoff);

    let eftProofUrl = null;
    if (eftProofFile) {
        const path = currentUser.id + '/' + Date.now() + '-' + eftProofFile.name;
        const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, eftProofFile);
        if (uploadError) {
            btn.disabled = false;
            btn.textContent = 'Book Delivery';
            showMsg('msgArea5', 'error', 'Failed to upload proof of payment: ' + uploadError.message);
            return;
        }
        eftProofUrl = path;
    }

    const { data, error } = await supabase.from('jobs').insert({
        customer_id: currentUser.id,
        pickup: pickup,
        pickup_lat: pickupCoords ? pickupCoords.lat : null,
        pickup_lng: pickupCoords ? pickupCoords.lng : null,
        dropoff: dropoff,
        dropoff_lat: dropoffCoords ? dropoffCoords.lat : null,
        dropoff_lng: dropoffCoords ? dropoffCoords.lng : null,
        vehicle: selectedVehicle.vehicle_id,
        distance: currentDistance,
        duration: currentDuration,
        quote: currentQuote,
        pricing_breakdown: currentBreakdown,
        customer_phone: senderPhone,
        sender_name: document.getElementById('senderName').value.trim(),
        sender_email: document.getElementById('senderEmail').value.trim() || null,
        pickup_contact_name: document.getElementById('pickupContactName').value.trim() || null,
        pickup_contact_phone: document.getElementById('pickupContactPhone').value.trim() || null,
        pickup_notes: document.getElementById('pickupNotes').value.trim() || null,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        receiver_email: document.getElementById('receiverEmail').value.trim() || null,
        dropoff_notes: document.getElementById('dropoffNotes').value.trim() || null,
        package_type: document.getElementById('packageType').value,
        package_description: document.getElementById('packageDescription').value.trim() || null,
        package_quantity: parseInt(document.getElementById('packageQuantity').value, 10) || 1,
        package_weight_kg: parseFloat(document.getElementById('packageWeight').value) || null,
        package_dimensions: document.getElementById('packageDimensions').value.trim() || null,
        fragile: document.getElementById('fragile').checked,
        keep_upright: document.getElementById('keepUpright').checked,
        handle_with_care: document.getElementById('handleWithCare').checked,
        delivery_type: selectedDeliveryType,
        scheduled_at: scheduledAt,
        collection_code: generateCode(),
        delivery_code: generateCode(),
        status: 'pending',
        payment_method: selectedPaymentMethod,
        payment_status: 'pending',
        eft_proof_url: eftProofUrl,
    }).select().single();

    if (error) {
        btn.disabled = false;
        btn.textContent = 'Book Delivery';
        showMsg('msgArea5', 'error', 'Booking failed: ' + error.message);
        return;
    }

    window.location.href = 'driver-assigned.html?job=' + data.id;
}
