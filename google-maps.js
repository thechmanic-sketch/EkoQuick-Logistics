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
    //
    // Also derives trafficLevel and routeType for the Pricing Engine, since
    // Routes API has no direct "highway vs urban vs residential" field:
    //   - trafficLevel: ratio of traffic-aware duration to static (no-traffic)
    //     duration — a big gap means real congestion on this route right now.
    //   - routeType: inferred from average speed (distance / duration) —
    //     highway-speed trips read as 'highway', stop-start trips read as
    //     'residential'. Gravel/mountain have no reliable signal from this
    //     API without deeper road data, so those stay admin-set only.
    async function computeRoute(originAddress, destinationAddress) {
        try {
            const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes?key=' + GOOGLE_MAPS_API_KEY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
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

            const distanceKm = route.distanceMeters / 1000;
            const durationSeconds = parseInt(route.duration, 10) || 0;
            const staticDurationSeconds = parseInt(route.staticDuration, 10) || durationSeconds;

            const trafficRatio = staticDurationSeconds > 0 ? durationSeconds / staticDurationSeconds : 1;
            let trafficLevel = 'light';
            if (trafficRatio >= 1.5) trafficLevel = 'severe';
            else if (trafficRatio >= 1.25) trafficLevel = 'heavy';
            else if (trafficRatio >= 1.1) trafficLevel = 'moderate';

            const avgSpeedKmh = durationSeconds > 0 ? (distanceKm / (durationSeconds / 3600)) : 0;
            let routeType = 'urban';
            if (avgSpeedKmh >= 80) routeType = 'highway';
            else if (avgSpeedKmh >= 55) routeType = 'rural';
            else if (avgSpeedKmh >= 35) routeType = 'urban';
            else routeType = 'residential';

            return {
                distanceKm: Math.round(distanceKm),
                durationSeconds: durationSeconds,
                trafficLevel: trafficLevel,
                routeType: routeType,
            };
        } catch (err) {
            return null;
        }
    }

    // Binds Places Autocomplete to an existing <input>. Google retired the
    // legacy Autocomplete widget for new Cloud projects (March 2025) — new
    // projects must use PlaceAutocompleteElement, a separate custom element,
    // not an attribute on a plain <input>. This hides the original input
    // (kept in the DOM so the rest of the app can keep reading/writing
    // .value unchanged) and inserts the new element right after it, syncing
    // the original input's value whenever a suggestion is selected.
    // onPlace receives { lat, lng, formattedAddress } on selection.
    async function attachAutocomplete(inputEl, onPlace) {
        await load();
        if (!google.maps.places.PlaceAutocompleteElement) {
            throw new Error('PlaceAutocompleteElement unavailable — check Places API (New) is enabled for this key');
        }
        const autocompleteEl = new google.maps.places.PlaceAutocompleteElement({
            componentRestrictions: { country: 'za' },
        });
        autocompleteEl.id = inputEl.id + 'Autocomplete';
        autocompleteEl.style.width = '100%';
        autocompleteEl.style.display = 'block';

        inputEl.style.display = 'none';
        inputEl.insertAdjacentElement('afterend', autocompleteEl);

        autocompleteEl.addEventListener('gmp-select', async function (event) {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({ fields: ['formattedAddress', 'location'] });
            inputEl.value = place.formattedAddress || '';
            onPlace({
                lat: place.location ? place.location.lat() : null,
                lng: place.location ? place.location.lng() : null,
                formattedAddress: place.formattedAddress,
            });
        });

        return autocompleteEl;
    }

    // ---- Map rendering helpers ----
    // Mirror Leaflet's API shape ([lat,lng] arrays, .setLatLng/.setLatLngs/
    // .remove()) on purpose, so converting a Leaflet map to Google Maps in
    // any given file is close to mechanical rather than a redesign.

    async function createMap(elementId, center, zoom) {
        await load();
        return new google.maps.Map(document.getElementById(elementId), {
            center: { lat: center[0], lng: center[1] },
            zoom: zoom,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            zoomControl: true,
        });
    }

    // emoji: a short string (e.g. '🚚') rendered as the marker label, matching
    // the emoji divIcon markers used throughout the app today.
    function createMarker(map, position, emoji, opts) {
        const marker = new google.maps.Marker({
            position: { lat: position[0], lng: position[1] },
            map: map,
            label: emoji ? { text: emoji, fontSize: '22px' } : undefined,
            title: (opts && opts.title) || '',
        });
        let infoWindow = null;
        const wrapper = {
            raw: marker,
            setLatLng: function (pos) { marker.setPosition({ lat: pos[0], lng: pos[1] }); },
            remove: function () { marker.setMap(null); },
            bindPopup: function (html) {
                infoWindow = new google.maps.InfoWindow({ content: html });
                marker.addListener('click', function () { infoWindow.open(map, marker); });
                return wrapper;
            },
            openPopup: function () { if (infoWindow) infoWindow.open(map, marker); },
        };
        return wrapper;
    }

    function createPolyline(map, latlngs, color, weight) {
        const line = new google.maps.Polyline({
            path: latlngs.map(function (p) { return { lat: p[0], lng: p[1] }; }),
            map: map,
            strokeColor: color || '#FF6A2B',
            strokeWeight: weight || 4,
        });
        return {
            raw: line,
            setLatLngs: function (pts) { line.setPath(pts.map(function (p) { return { lat: p[0], lng: p[1] }; })); },
            remove: function () { line.setMap(null); },
        };
    }

    function fitBounds(map, points, paddingPx) {
        if (!points.length) return;
        if (points.length === 1) { map.setCenter({ lat: points[0][0], lng: points[0][1] }); map.setZoom(14); return; }
        const bounds = new google.maps.LatLngBounds();
        points.forEach(function (p) { bounds.extend({ lat: p[0], lng: p[1] }); });
        map.fitBounds(bounds, paddingPx || 30);
    }

    function setView(map, center, zoom) {
        map.setCenter({ lat: center[0], lng: center[1] });
        map.setZoom(zoom);
    }

    return {
        load: load,
        geocodeAddress: geocodeAddress,
        reverseGeocode: reverseGeocode,
        computeRoute: computeRoute,
        attachAutocomplete: attachAutocomplete,
        createMap: createMap,
        createMarker: createMarker,
        createPolyline: createPolyline,
        fitBounds: fitBounds,
        setView: setView,
    };
})();
