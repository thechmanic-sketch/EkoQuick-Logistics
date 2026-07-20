document.addEventListener('DOMContentLoaded', function () {
    const vehicleSelect = document.getElementById('estVehicle');
    vehicleSelect.innerHTML = VEHICLES.map(function (v) {
        return '<option value="' + v.id + '">' + v.icon + ' ' + v.label + '</option>';
    }).join('');

    renderVehicleCards();

    document.getElementById('estimateBtn').addEventListener('click', getEstimate);
});

function renderVehicleCards() {
    const el = document.getElementById('vehicleCards');
    el.innerHTML = VEHICLES.map(function (v) {
        return (
            '<div class="vehicle-card">' +
                '<div class="v-icon">' + v.icon + '</div>' +
                '<h4>' + v.label + '</h4>' +
                '<div class="v-row"><span>Base Fare</span><span>R' + v.base + '</span></div>' +
                '<div class="v-row"><span>Price per KM</span><span>R' + v.rate.toFixed(2) + '</span></div>' +
                '<div class="v-row"><span>Waiting Fee</span><span>R2.00/min</span></div>' +
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

    const vehicle = VEHICLES.find(function (v) { return v.id === vehicleId; }) || VEHICLES[0];

    btn.disabled = true;
    btn.textContent = 'Calculating...';

    let distanceKm = null;
    try {
        const origins = encodeURIComponent(pickup + ', KwaZulu-Natal, South Africa');
        const destinations = encodeURIComponent(dropoff + ', KwaZulu-Natal, South Africa');
        const res = await fetch('https://api.distancematrix.ai/maps/api/distancematrix/json?key=' + DISTANCE_MATRIX_API_KEY + '&origins=' + origins + '&destinations=' + destinations + '&mode=driving');
        const data = await res.json();
        const el = data && data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0];
        if (data.status === 'OK' && el && el.status === 'OK') {
            distanceKm = Math.round(el.distance.value / 1000);
        }
    } catch (err) { /* fall through to fallback table */ }

    if (distanceKm === null) distanceKm = fallbackDistance(pickup, dropoff);

    btn.disabled = false;
    btn.textContent = 'Get Estimate';

    if (distanceKm === null) {
        msgEl.textContent = 'Could not estimate that route — try naming a specific KZN town (e.g. Durban, Pietermaritzburg, Ballito).';
        return;
    }

    const quote = Math.round(vehicle.base + distanceKm * vehicle.rate);
    document.getElementById('estAmount').textContent = 'R' + quote;
    document.getElementById('estDetail').textContent = vehicle.label + ' • ' + distanceKm + ' km • ' + parcelType.charAt(0).toUpperCase() + parcelType.slice(1) + ' • R' + vehicle.base + ' base + R' + vehicle.rate.toFixed(2) + '/km';
    resultEl.classList.add('show');
}
