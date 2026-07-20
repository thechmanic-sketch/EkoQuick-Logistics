// Google Maps Platform integration — single shared module for geocoding,
// reverse-geocoding, route/distance calculation, and Places Autocomplete.
// Do not call Google's REST endpoints directly with fetch() for Geocoding —
// the legacy Geocoding web-service flatly rejects HTTP-referrer-restricted
// keys ("API keys with referer restrictions cannot be used with this API").
// Geocoding must go through the Maps JavaScript API's Geocoder class, which
// is designed for browser/referrer-restricted use. Routes API (used for
// distance/duration) works fine via direct fetch() with a referrer-restricted
// key, since the browser sends the page's Referer header automatically.

const GoogleMaps = (function () {
    let loadPromise = null;
    let geocoder = null;

    function load() {
        if (loadPromise) return loadPromise;
        loadPromise = new Promise(function (resolve, reject) {
            if (window.google && window.google.maps) { resolve(window.google.maps); return; }
            window.__gmapsCallback = function () {
                geocoder = new google.maps.Geocoder();
                resolve(window.google.maps);
            };
            const script = document.createElement('script');
            script.src = 'https://maps.googleapis.com/maps/api/js?key=' + GOOGLE_MAPS_API_KEY + '&libraries=places&callback=__gmapsCallback&loading=async';
            script.async = true;
            script.onerror = function () { reject(new Error('Failed to load Google Maps JavaScript API')); };
            document.head.appendChild(script);
        });
        return loadPromise;
    }

    async function geocodeAddress(address) {
        await load();
        return new Promise(function (resolve) {
            geocoder.geocode({ address: address + ', KwaZulu-Natal, South Africa' }, function (results, status) {
                if (status === 'OK' && results && results[0]) {
                    const loc = results[0].geometry.location;
                    resolve({ lat: loc.lat(), lng: loc.lng(), formattedAddress: results[0].formatted_address });
                } else {
                    resolve(null);
                }
            });
        });
    }

    async function reverseGeocode(lat, lng) {
        await load();
        return new Promise(function (resolve) {
            geocoder.geocode({ location: { lat: lat, lng: lng } }, function (results, status) {
                if (status === 'OK' && results && results[0]) resolve(results[0].formatted_address);
                else resolve(null);
            });
        });
    }

    // Distance + duration via Routes API. Falls back to null on any failure
    // so callers can fall back to the KZN_DISTANCES table like before.
    async function computeRoute(originAddress, destinationAddress) {
        try {
            const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes?key=' + GOOGLE_MAPS_API_KEY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.legs.steps.navigationInstruction',
                },
                body: JSON.stringify({
                    origin: { address: originAddress + ', KwaZulu-Natal, South Africa' },
                    destination: { address: destinationAddress + ', KwaZulu-Natal, South Africa' },
                    travelMode: 'DRIVE',
                    routingPreference: 'TRAFFIC_AWARE',
                }),
            });
            const data = await res.json();
            const route = data && data.routes && data.routes[0];
            if (!route) return null;
            return {
                distanceKm: Math.round(route.distanceMeters / 1000),
                durationSeconds: parseInt(route.duration, 10) || 0,
            };
        } catch (err) {
            return null;
        }
    }

    // Binds Places Autocomplete to an existing <input>. onPlace receives
    // { lat, lng, formattedAddress } when the user picks a suggestion.
    async function attachAutocomplete(inputEl, onPlace) {
        await load();
        const autocomplete = new google.maps.places.Autocomplete(inputEl, {
            componentRestrictions: { country: 'za' },
            fields: ['formatted_address', 'geometry'],
        });
        autocomplete.addListener('place_changed', function () {
            const place = autocomplete.getPlace();
            if (!place || !place.geometry) return;
            onPlace({
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
                formattedAddress: place.formatted_address,
            });
        });
        return autocomplete;
    }

    return {
        load: load,
        geocodeAddress: geocodeAddress,
        reverseGeocode: reverseGeocode,
        computeRoute: computeRoute,
        attachAutocomplete: attachAutocomplete,
    };
})();
