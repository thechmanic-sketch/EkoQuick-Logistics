let pickupCoords = null, dropoffCoords = null;
let pickupMap = null, dropoffMap = null, pickupMarker = null, dropoffMarker = null;

document.addEventListener('DOMContentLoaded', function () {
    // Wire the button up first — if PricingEngine.load() below fails or
    // times out, the page must not end up with a dead "Get Estimate"
    // button that silently does nothing when clicked.
    document.getElementById('estimateBtn').addEventListener('click', getEstimate);

    // This feeds a real Routes API distance calculation the same way the
    // booking flow does, so it needs full addresses, not just town names —
    // keep the default street-level filter (accuracy over broad matching),
    // and back it with map pickers below for anyone who'd rather point at
    // the map than type an address.
    GoogleMaps.attachAutocomplete(document.getElementById('estPickup'), function (place) {
        pickupCoords = { lat: place.lat, lng: place.lng };
    }).catch(function () {});
    GoogleMaps.attachAutocomplete(document.getElementById('estDropoff'), function (place) {
        dropoffCoords = { lat: place.lat, lng: place.lng };
    }).catch(function () {});

    wireMapPickers();

    PricingEngine.load().then(function () {
        const vehicles = PricingEngine.getConfig().vehicles;

        const vehicleSelect = document.getElementById('estVehicle');
        vehicleSelect.innerHTML = vehicles.map(function (v) {
            return '<option value="' + v.vehicle_id + '">' + v.icon + ' ' + v.label + '</option>';
        }).join('');

        renderVehicleCards(vehicles);
    }).catch(function (err) {
        console.error('PricingEngine.load() failed', err);
        document.getElementById('estimateMsg').textContent = 'Pricing is temporarily unavailable — please try again shortly.';
    });
});

function renderVehicleCards(vehicles) {
    const el = document.getElementById('vehicleCards');
    el.innerHTML = vehicles.map(function (v) {
        return (
            '<div class="vehicle-card">' +
                '<div class="v-icon">' + v.icon + '</div>' +
                '<h4>' + v.label + '</h4>' +
                '<div class="v-row"><span>Base Fare</span><span>R' + v.base_fare + '</span></div>' +
                '<div class="v-row"><span>Price per KM</span><span>R' + parseFloat(v.price_per_km).toFixed(2) + '</span></div>' +
                '<div class="v-row"><span>Waiting Fee</span><span>R' + parseFloat(PricingEngine.getConfig().settings.pricing_waiting_charge_per_min || 2).toFixed(2) + '/min</span></div>' +
            '</div>'
        );
    }).join('');
}

function wireMapPickers() {
    document.getElementById('estPickMapBtn').addEventListener('click', async function () {
        const mapEl = document.getElementById('estPickupMap');
        mapEl.classList.toggle('hidden');
        if (!mapEl.classList.contains('hidden') && !pickupMap) {
            pickupMap = await GoogleMaps.createMap('estPickupMap', [-29.6, 30.9], 8);
            pickupMap.addListener('click', async function (e) {
                const lat = e.latLng.lat(), lng = e.latLng.lng();
                pickupCoords = { lat: lat, lng: lng };
                if (pickupMarker) pickupMarker.setLatLng([lat, lng]); else pickupMarker = GoogleMaps.createMarker(pickupMap, [lat, lng], '📍');
                const addr = await GoogleMaps.reverseGeocode(lat, lng);
                if (addr) GoogleMaps.showAddressInInput('estPickup', addr);
            });
        }
    });

    document.getElementById('estPickMapBtn2').addEventListener('click', async function () {
        const mapEl = document.getElementById('estDropoffMap');
        mapEl.classList.toggle('hidden');
        if (!mapEl.classList.contains('hidden') && !dropoffMap) {
            dropoffMap = await GoogleMaps.createMap('estDropoffMap', [-29.6, 30.9], 8);
            dropoffMap.addListener('click', async function (e) {
                const lat = e.latLng.lat(), lng = e.latLng.lng();
                dropoffCoords = { lat: lat, lng: lng };
                if (dropoffMarker) dropoffMarker.setLatLng([lat, lng]); else dropoffMarker = GoogleMaps.createMarker(dropoffMap, [lat, lng], '📍');
                const addr = await GoogleMaps.reverseGeocode(lat, lng);
                if (addr) GoogleMaps.showAddressInInput('estDropoff', addr);
            });
        }
    });
}

async function getEstimate() {
    const pickup = document.getElementById('estPickup').value.trim();
    const dropoff = document.getElementById('estDropoff').value.trim();
    const vehicleId = document.getElementById('estVehicle').value;
    const parcelType = document.getElementById('estParcelType').value;
    const btn = document.getElementById('estimateBtn');
    const msgEl = document.getElementById('estimateMsg');
    const resultEl = document.getElementById('estimateResult');

    msgEl.textContent = '';
    resultEl.classList.remove('show');

    if (!PricingEngine.getConfig()) {
        msgEl.textContent = 'Pricing is still loading — please try again in a moment.';
        return;
    }

    if (!pickup || !dropoff) {
        msgEl.textContent = 'Enter both a pickup and a destination.';
        return;
    }

    const vehicles = PricingEngine.getConfig().vehicles;
    const vehicle = vehicles.find(function (v) { return v.vehicle_id === vehicleId; }) || vehicles[0];

    btn.disabled = true;
    btn.textContent = 'Calculating...';

    let distanceKm = null;
    let trafficLevel = 'light';
    let routeType = 'urban';
    try {
        const route = await GoogleMaps.computeRoute(pickup, dropoff);
        if (route) {
            distanceKm = route.distanceKm;
            trafficLevel = route.trafficLevel || 'light';
            routeType = route.routeType || 'urban';
        }
    } catch (err) { /* fall through to fallback table */ }

    if (distanceKm === null) distanceKm = fallbackDistance(pickup, dropoff);

    btn.disabled = false;
    btn.textContent = 'Get Estimate';

    if (distanceKm === null) {
        msgEl.textContent = 'Could not estimate that route — try naming a specific KZN town (e.g. Durban, Pietermaritzburg, Ballito).';
        return;
    }

    const breakdown = PricingEngine.calculateQuote({
        vehicleId: vehicle.vehicle_id,
        distanceKm: distanceKm,
        weightKg: 0,
        parcelCategory: parcelType,
        extraStops: 0,
        waitingMinutes: 0,
        priority: 'normal',
        trafficLevel: trafficLevel,
        routeType: routeType,
    });

    document.getElementById('estAmount').textContent = 'R' + breakdown.customerTotal;
    document.getElementById('estDetail').textContent = vehicle.label + ' • ' + distanceKm + ' km • ' + parcelType.charAt(0).toUpperCase() + parcelType.slice(1) + ' • R' + vehicle.base_fare + ' base + R' + parseFloat(vehicle.price_per_km).toFixed(2) + '/km';
    resultEl.classList.add('show');
}
