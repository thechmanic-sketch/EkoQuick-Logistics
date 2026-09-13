let homeEstPickupCoords = null, homeEstDropoffCoords = null;
let homeEstPickupMap = null, homeEstDropoffMap = null, homeEstPickupMarker = null, homeEstDropoffMarker = null;

document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('homeEstimateBtn');
    if (!btn) return; // section not present on this page

    // Wire the button up first — if PricingEngine.load() below fails or
    // times out, the page must not end up with a dead "Get Estimate"
    // button that silently does nothing when clicked.
    btn.addEventListener('click', getHomeEstimate);

    GoogleMaps.attachAutocomplete(document.getElementById('homeEstPickup'), function (place) {
        homeEstPickupCoords = { lat: place.lat, lng: place.lng };
    }).catch(function () {});
    GoogleMaps.attachAutocomplete(document.getElementById('homeEstDropoff'), function (place) {
        homeEstDropoffCoords = { lat: place.lat, lng: place.lng };
    }).catch(function () {});

    wireHomeEstMapPickers();

    PricingEngine.load().then(function () {
        const vehicles = PricingEngine.getConfig().vehicles;
        const vehicleSelect = document.getElementById('homeEstVehicle');
        vehicleSelect.innerHTML = vehicles.map(function (v) {
            return '<option value="' + v.vehicle_id + '">' + v.icon + ' ' + v.label + '</option>';
        }).join('');
    }).catch(function (err) {
        console.error('PricingEngine.load() failed', err);
        document.getElementById('homeEstimateMsg').textContent = 'Pricing is temporarily unavailable — please try again shortly.';
    });
});

function wireHomeEstMapPickers() {
    document.getElementById('homeEstPickMapBtn').addEventListener('click', async function () {
        const mapEl = document.getElementById('homeEstPickupMap');
        mapEl.classList.toggle('hidden');
        if (!mapEl.classList.contains('hidden') && !homeEstPickupMap) {
            homeEstPickupMap = await GoogleMaps.createMap('homeEstPickupMap', [-29.6, 30.9], 8);
            homeEstPickupMap.addListener('click', async function (e) {
                const lat = e.latLng.lat(), lng = e.latLng.lng();
                homeEstPickupCoords = { lat: lat, lng: lng };
                if (homeEstPickupMarker) homeEstPickupMarker.setLatLng([lat, lng]); else homeEstPickupMarker = GoogleMaps.createMarker(homeEstPickupMap, [lat, lng], '📍');
                const addr = await GoogleMaps.reverseGeocode(lat, lng);
                if (addr) GoogleMaps.showAddressInInput('homeEstPickup', addr);
            });
        }
    });

    document.getElementById('homeEstPickMapBtn2').addEventListener('click', async function () {
        const mapEl = document.getElementById('homeEstDropoffMap');
        mapEl.classList.toggle('hidden');
        if (!mapEl.classList.contains('hidden') && !homeEstDropoffMap) {
            homeEstDropoffMap = await GoogleMaps.createMap('homeEstDropoffMap', [-29.6, 30.9], 8);
            homeEstDropoffMap.addListener('click', async function (e) {
                const lat = e.latLng.lat(), lng = e.latLng.lng();
                homeEstDropoffCoords = { lat: lat, lng: lng };
                if (homeEstDropoffMarker) homeEstDropoffMarker.setLatLng([lat, lng]); else homeEstDropoffMarker = GoogleMaps.createMarker(homeEstDropoffMap, [lat, lng], '📍');
                const addr = await GoogleMaps.reverseGeocode(lat, lng);
                if (addr) GoogleMaps.showAddressInInput('homeEstDropoff', addr);
            });
        }
    });
}

async function getHomeEstimate() {
    const pickup = document.getElementById('homeEstPickup').value.trim();
    const dropoff = document.getElementById('homeEstDropoff').value.trim();
    const vehicleId = document.getElementById('homeEstVehicle').value;
    const parcelType = document.getElementById('homeEstParcelType').value;
    const btn = document.getElementById('homeEstimateBtn');
    const msgEl = document.getElementById('homeEstimateMsg');
    const resultEl = document.getElementById('homeEstimateResult');

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

    document.getElementById('homeEstAmount').textContent = 'R' + breakdown.customerTotal;
    document.getElementById('homeEstDetail').textContent = vehicle.label + ' • ' + distanceKm + ' km • ' + parcelType.charAt(0).toUpperCase() + parcelType.slice(1) + ' • R' + vehicle.base_fare + ' base + R' + parseFloat(vehicle.price_per_km).toFixed(2) + '/km';
    resultEl.classList.add('show');
}
