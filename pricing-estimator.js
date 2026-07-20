document.addEventListener('DOMContentLoaded', async function () {
    await PricingEngine.load();
    const vehicles = PricingEngine.getConfig().vehicles;

    const vehicleSelect = document.getElementById('estVehicle');
    vehicleSelect.innerHTML = vehicles.map(function (v) {
        return '<option value="' + v.vehicle_id + '">' + v.icon + ' ' + v.label + '</option>';
    }).join('');

    renderVehicleCards(vehicles);

    document.getElementById('estimateBtn').addEventListener('click', getEstimate);
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

    if (!pickup || !dropoff) {
        msgEl.textContent = 'Enter both a pickup and a destination.';
        return;
    }

    const vehicles = PricingEngine.getConfig().vehicles;
    const vehicle = vehicles.find(function (v) { return v.vehicle_id === vehicleId; }) || vehicles[0];

    btn.disabled = true;
    btn.textContent = 'Calculating...';

    let distanceKm = null;
    try {
        const route = await GoogleMaps.computeRoute(pickup, dropoff);
        if (route) distanceKm = route.distanceKm;
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
        trafficLevel: 'light',
        routeType: 'urban',
    });

    document.getElementById('estAmount').textContent = 'R' + breakdown.customerTotal;
    document.getElementById('estDetail').textContent = vehicle.label + ' • ' + distanceKm + ' km • ' + parcelType.charAt(0).toUpperCase() + parcelType.slice(1) + ' • R' + vehicle.base_fare + ' base + R' + parseFloat(vehicle.price_per_km).toFixed(2) + '/km';
    resultEl.classList.add('show');
}
