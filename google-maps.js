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
    const addressRevealers = {}; // fieldId -> function(addr)

    // Never hang forever: if Google's script is slow, blocked (ad-blocker,
    // network), or errors, load() rejects after 10s instead of leaving every
    // caller's `await` stuck — which previously froze whole page init
    // sequences (auto-assign never running, bookings never completing) with
    // no error shown anywhere.
    function load() {
        if (loadPromise) return loadPromise;
        loadPromise = new Promise(function (resolve, reject) {
            if (window.google && window.google.maps) { resolve(window.google.maps); return; }
            const timeoutId = setTimeout(function () {
                reject(new Error('Google Maps script load timed out'));
            }, 10000);
            window.__gmapsCallback = function () {
                clearTimeout(timeoutId);
                geocoder = new google.maps.Geocoder();
                resolve(window.google.maps);
            };
            const script = document.createElement('script');
            script.src = 'https://maps.googleapis.com/maps/api/js?key=' + GOOGLE_MAPS_API_KEY + '&libraries=places,geometry&callback=__gmapsCallback&loading=async';
            script.async = true;
            script.onerror = function () { clearTimeout(timeoutId); reject(new Error('Failed to load Google Maps JavaScript API')); };
            document.head.appendChild(script);
        });
        // Don't cache a failed load forever — let the next call retry.
        loadPromise.catch(function () { loadPromise = null; });
        return loadPromise;
    }

    async function geocodeAddress(address) {
        try { await load(); } catch (err) { return null; }
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
        try { await load(); } catch (err) { return null; }
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

    // Turn-by-turn route polyline + live ETA between two coordinates, for the
    // driver's live route line and for real (not straight-line/haversine) ETA
    // shown to customer/admin. Returns { path: [[lat,lng],...], durationSeconds,
    // distanceKm } or null on failure.
    async function computeRouteDetails(originLat, originLng, destLat, destLng) {
        try {
            await load();
            const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes?key=' + GOOGLE_MAPS_API_KEY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters',
                },
                body: JSON.stringify({
                    origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
                    destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
                    travelMode: 'DRIVE',
                    routingPreference: 'TRAFFIC_AWARE',
                }),
            });
            const data = await res.json();
            const route = data && data.routes && data.routes[0];
            const encoded = route && route.polyline && route.polyline.encodedPolyline;
            if (!encoded) return null;
            const path = google.maps.geometry.encoding.decodePath(encoded);
            return {
                path: path.map(function (p) { return [p.lat(), p.lng()]; }),
                durationSeconds: parseInt(route.duration, 10) || 0,
                distanceKm: route.distanceMeters ? Math.round(route.distanceMeters / 1000) : null,
            };
        } catch (err) {
            return null;
        }
    }

    // Back-compat shim — just the polyline path, same shape callers already use.
    async function computeRoutePolyline(originLat, originLng, destLat, destLng) {
        const details = await computeRouteDetails(originLat, originLng, destLat, destLng);
        return details ? details.path : null;
    }

    // Binds Places Autocomplete to an existing <input>. Google retired the
    // legacy Autocomplete widget for new Cloud projects (March 2025) — new
    // projects must use PlaceAutocompleteElement, a separate custom element,
    // not an attribute on a plain <input>. This hides the original input
    // (kept in the DOM so the rest of the app can keep reading/writing
    // .value unchanged) and inserts the new element right after it, syncing
    // the original input's value whenever a suggestion is selected.
    // onPlace receives { lat, lng, formattedAddress } on selection.
    async function attachAutocomplete(inputEl, onPlace, options) {
        await load();
        if (!google.maps.places.PlaceAutocompleteElement) {
            throw new Error('PlaceAutocompleteElement unavailable — check Places API (New) is enabled for this key');
        }
        const acOptions = { componentRestrictions: { country: 'za' } };
        // Bias toward specific addresses (street/premise level), not just
        // cities/suburbs/landmarks, which is all the element suggests by
        // default with no type filter set. Callers that only need
        // area-level input (e.g. a price estimator) can pass
        // { includedPrimaryTypes: [] } to drop this filter entirely, or
        // their own list of types.
        if (!options || !('includedPrimaryTypes' in options)) {
            acOptions.includedPrimaryTypes = ['street_address', 'route', 'premise', 'subpremise'];
        } else if (options.includedPrimaryTypes && options.includedPrimaryTypes.length) {
            acOptions.includedPrimaryTypes = options.includedPrimaryTypes;
        }
        const autocompleteEl = new google.maps.places.PlaceAutocompleteElement(acOptions);
        autocompleteEl.id = inputEl.id + 'Autocomplete';
        // It renders as its own custom element, not an <input>/<select>, so
        // it falls outside every page's "input, select { ... }" sizing/
        // spacing rules — set the same box model directly here so it lines
        // up with the field it's replacing instead of looking oversized,
        // uncentered, or crowded against whatever sits below it.
        const inputStyle = window.getComputedStyle(inputEl);
        autocompleteEl.style.cssText =
            'display:block; width:100%; box-sizing:border-box;' +
            'margin-bottom:' + inputStyle.marginBottom + ';' +
            'min-height:' + inputStyle.height + ';';
        // Google renders this element with its own light Material theme by
        // default, ignoring page CSS entirely — match it to the dark theme
        // via its documented custom properties instead of leaving a bright
        // white box sitting inside a dark form.
        autocompleteEl.style.setProperty('--gmp-mat-color-surface', inputStyle.backgroundColor);
        autocompleteEl.style.setProperty('--gmp-mat-color-on-surface', inputStyle.color);
        autocompleteEl.style.setProperty('--gmp-mat-color-on-surface-variant', inputStyle.color);
        autocompleteEl.style.setProperty('--gmp-mat-color-outline', inputStyle.borderTopColor);

        inputEl.style.display = 'none';
        inputEl.insertAdjacentElement('afterend', autocompleteEl);

        // The widget's own displayed text does not reliably persist after a
        // selection, so — same as the map-click flow — swap back to the
        // plain input, pre-filled with the selected address, as the visible
        // confirmation of what was picked.
        let searchAgainLink = null;
        function showInInput(addr) {
            inputEl.value = addr || '';
            autocompleteEl.style.display = 'none';
            inputEl.style.display = 'block';
            if (!searchAgainLink) {
                searchAgainLink = document.createElement('a');
                searchAgainLink.href = '#';
                searchAgainLink.textContent = '🔍 Search address instead';
                searchAgainLink.style.cssText = 'display:block; font-size:11px; margin-top:4px; color: var(--orange);';
                searchAgainLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    inputEl.style.display = 'none';
                    autocompleteEl.style.display = 'block';
                });
                inputEl.insertAdjacentElement('afterend', searchAgainLink);
            }
            searchAgainLink.style.display = 'block';
        }
        addressRevealers[inputEl.id] = showInInput;

        autocompleteEl.addEventListener('gmp-select', async function (event) {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({ fields: ['formattedAddress', 'location'] });
            showInInput(place.formattedAddress);
            onPlace({
                lat: place.location ? place.location.lat() : null,
                lng: place.location ? place.location.lng() : null,
                formattedAddress: place.formattedAddress,
            });
        });

        return autocompleteEl;
    }

    // Shows an address (e.g. from a reverse-geocoded map click) in the plain
    // input for a field that has attachAutocomplete() wired to it, swapping
    // away from the autocomplete widget the same way selecting a suggestion
    // does — one code path for both ways of picking an address.
    function showAddressInInput(fieldId, addr) {
        const reveal = addressRevealers[fieldId];
        if (reveal) { reveal(addr); return; }
        const inputEl = document.getElementById(fieldId);
        if (inputEl) inputEl.value = addr || '';
    }

    // ---- Map rendering helpers ----
    // Mirror Leaflet's API shape ([lat,lng] arrays, .setLatLng/.setLatLngs/
    // .remove()) on purpose, so converting a Leaflet map to Google Maps in
    // any given file is close to mechanical rather than a redesign.

    // Never throws — most callers do `await GoogleMaps.createMap(...)` inline
    // in their page-init sequence with no .catch(), and a rejection there
    // used to abort everything after it (auto-assign, data loading, etc.).
    // If Google's script fails to load, this returns a harmless no-op stub
    // instead: the map just won't render, but the rest of the page keeps
    // working.
    function noopMap() {
        return {
            addListener: function () {}, setCenter: function () {}, setZoom: function () {},
            fitBounds: function () {}, __failed: true,
        };
    }

    async function createMap(elementId, center, zoom) {
        try {
            await load();
        } catch (err) {
            console.error('Google Maps failed to load — map will not render:', err);
            return noopMap();
        }
        const container = document.getElementById(elementId);
        if (!container) return noopMap();
        return new google.maps.Map(container, {
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
    function noopMarker() {
        const w = { setLatLng: function () {}, setIcon: function () {}, remove: function () {}, on: function () { return w; }, bindPopup: function () { return w; }, openPopup: function () {} };
        return w;
    }

    function createMarker(map, position, emoji, opts) {
        if (!map || map.__failed || typeof google === 'undefined') return noopMarker();
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
            setIcon: function (newEmoji) { marker.setLabel({ text: newEmoji, fontSize: '22px' }); },
            remove: function () { marker.setMap(null); },
            on: function (eventName, handler) { marker.addListener(eventName, handler); return wrapper; },
            bindPopup: function (html) {
                if (infoWindow) infoWindow.setContent(html);
                else {
                    infoWindow = new google.maps.InfoWindow({ content: html });
                    marker.addListener('click', function () { infoWindow.open(map, marker); });
                }
                return wrapper;
            },
            openPopup: function () { if (infoWindow) infoWindow.open(map, marker); },
        };
        return wrapper;
    }

    function createPolyline(map, latlngs, color, weight) {
        if (!map || map.__failed || typeof google === 'undefined') return { setLatLngs: function () {}, setStyle: function () {}, remove: function () {} };
        const line = new google.maps.Polyline({
            path: latlngs.map(function (p) { return { lat: p[0], lng: p[1] }; }),
            map: map,
            strokeColor: color || '#FF6A2B',
            strokeWeight: weight || 4,
        });
        return {
            raw: line,
            setLatLngs: function (pts) { line.setPath(pts.map(function (p) { return { lat: p[0], lng: p[1] }; })); },
            setStyle: function (opts) { if (opts && opts.color) line.setOptions({ strokeColor: opts.color }); },
            remove: function () { line.setMap(null); },
        };
    }

    function fitBounds(map, points, paddingPx) {
        if (!map || map.__failed || typeof google === 'undefined') return;
        if (!points.length) return;
        if (points.length === 1) { map.setCenter({ lat: points[0][0], lng: points[0][1] }); map.setZoom(14); return; }
        const bounds = new google.maps.LatLngBounds();
        points.forEach(function (p) { bounds.extend({ lat: p[0], lng: p[1] }); });
        map.fitBounds(bounds, paddingPx || 30);
    }

    function setView(map, center, zoom) {
        if (!map || map.__failed) return;
        map.setCenter({ lat: center[0], lng: center[1] });
        map.setZoom(zoom);
    }

    return {
        load: load,
        geocodeAddress: geocodeAddress,
        reverseGeocode: reverseGeocode,
        computeRoute: computeRoute,
        computeRoutePolyline: computeRoutePolyline,
        computeRouteDetails: computeRouteDetails,
        attachAutocomplete: attachAutocomplete,
        showAddressInInput: showAddressInInput,
        createMap: createMap,
        createMarker: createMarker,
        createPolyline: createPolyline,
        fitBounds: fitBounds,
        setView: setView,
    };
})();
