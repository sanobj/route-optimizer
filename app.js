// Route Optimizer PWA
(function() {
    'use strict';

    // State
    let stops = [];
    let map = null;
    let directionsRenderer = null;
    let apiKey = localStorage.getItem('googleMapsApiKey') || '';

    // DOM Elements
    const startInput = document.getElementById('start-input');
    const gpsBtn = document.getElementById('gps-btn');
    const stopsContainer = document.getElementById('stops-container');
    const addStopBtn = document.getElementById('add-stop-btn');
    const optimizeBtn = document.getElementById('optimize-btn');
    const resultsSection = document.getElementById('results-section');
    const routeSummary = document.getElementById('route-summary');
    const routeSteps = document.getElementById('route-steps');
    const navigateBtn = document.getElementById('navigate-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    const mapContainer = document.getElementById('map');

    // Last optimized route data for navigation link
    let optimizedRoute = null;

    // Initialize
    function init() {
        addStopBtn.addEventListener('click', addStop);
        optimizeBtn.addEventListener('click', optimizeRoute);
        gpsBtn.addEventListener('click', getCurrentLocation);
        settingsBtn.addEventListener('click', openSettings);
        saveKeyBtn.addEventListener('click', saveApiKey);
        cancelSettingsBtn.addEventListener('click', closeSettings);
        navigateBtn.addEventListener('click', openInGoogleMaps);
        startInput.addEventListener('input', updateOptimizeButton);

        // Add two empty stops by default
        addStop();
        addStop();

        // If no API key, prompt settings
        if (!apiKey) {
            setTimeout(openSettings, 500);
        } else {
            loadGoogleMaps();
        }
    }

    // Stop management
    function addStop() {
        const index = stops.length;
        const stopId = Date.now() + index;
        stops.push({ id: stopId, address: '' });

        const stopEl = document.createElement('div');
        stopEl.className = 'input-row';
        stopEl.dataset.id = stopId;
        stopEl.innerHTML = `
            <span class="stop-number">${index + 1}</span>
            <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stopId}">
            <button class="remove-btn" aria-label="Remove stop" data-id="${stopId}">✕</button>
        `;

        stopsContainer.appendChild(stopEl);

        // Event listeners
        const input = stopEl.querySelector('.stop-input');
        const removeBtn = stopEl.querySelector('.remove-btn');

        input.addEventListener('input', (e) => {
            const stop = stops.find(s => s.id === stopId);
            if (stop) stop.address = e.target.value;
            updateOptimizeButton();
        });

        removeBtn.addEventListener('click', () => removeStop(stopId));
        updateOptimizeButton();
    }

    function removeStop(id) {
        stops = stops.filter(s => s.id !== id);
        const el = stopsContainer.querySelector(`[data-id="${id}"]`);
        if (el) el.remove();
        renumberStops();
        updateOptimizeButton();
    }

    function renumberStops() {
        const numbers = stopsContainer.querySelectorAll('.stop-number');
        numbers.forEach((el, i) => {
            el.textContent = i + 1;
        });
    }

    function updateOptimizeButton() {
        const hasStart = startInput.value.trim().length > 0;
        const filledStops = stops.filter(s => s.address.trim().length > 0);
        optimizeBtn.disabled = !(hasStart && filledStops.length >= 2);
    }

    // GPS
    function getCurrentLocation() {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser.');
            return;
        }

        gpsBtn.textContent = '⏳';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                startInput.value = `${latitude}, ${longitude}`;
                gpsBtn.textContent = '🎯';
                updateOptimizeButton();
            },
            (error) => {
                gpsBtn.textContent = '🎯';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        alert('Location permission denied. Please enter your address manually.');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        alert('Location unavailable. Please enter your address manually.');
                        break;
                    default:
                        alert('Could not get your location. Please enter your address manually.');
                }
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // Settings
    function openSettings() {
        apiKeyInput.value = apiKey;
        settingsModal.classList.remove('hidden');
    }

    function closeSettings() {
        settingsModal.classList.add('hidden');
    }

    function saveApiKey() {
        const key = apiKeyInput.value.trim();
        if (!key) {
            alert('Please enter a valid API key.');
            return;
        }
        apiKey = key;
        localStorage.setItem('googleMapsApiKey', apiKey);
        closeSettings();
        loadGoogleMaps();
    }

    // Load Google Maps API
    function loadGoogleMaps() {
        if (!apiKey) return;
        if (window.google && window.google.maps) return;

        // Remove old script if exists
        const oldScript = document.getElementById('google-maps-script');
        if (oldScript) oldScript.remove();

        const script = document.createElement('script');
        script.id = 'google-maps-script';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initMap`;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
            alert('Failed to load Google Maps. Check your API key and that the Maps JavaScript API is enabled.');
        };
        document.body.appendChild(script);
    }

    // Google Maps initialization (called by API callback)
    window.initMap = function() {
        console.log('Google Maps loaded successfully');

        map = new google.maps.Map(mapContainer, {
            center: { lat: 39.8283, lng: -98.5795 }, // Center of US
            zoom: 4,
            disableDefaultUI: true,
            zoomControl: true,
        });
        directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: false,
        });
        mapContainer.classList.add('active');

        // Enable Places Autocomplete on inputs
        console.log('Enabling autocomplete on inputs...');
        enableAutocomplete(startInput);
        document.querySelectorAll('.stop-input').forEach(input => {
            enableAutocomplete(input);
        });
        console.log('Autocomplete setup complete');
    };

    function enableAutocomplete(input) {
        if (!window.google || !google.maps.places) return;

        // Google Autocomplete requires autocomplete attribute to not be "off"
        input.setAttribute('autocomplete', 'new-password');

        const autocomplete = new google.maps.places.Autocomplete(input, {
            fields: ['formatted_address', 'name', 'geometry'],
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place.formatted_address) {
                input.value = place.formatted_address;
            } else if (place.name) {
                input.value = place.name;
            }
            // Update stop state if it's a stop input
            const stopId = parseInt(input.dataset.id);
            if (stopId) {
                const stop = stops.find(s => s.id === stopId);
                if (stop) stop.address = input.value;
            }
            updateOptimizeButton();
        });

        // Prevent form submission on Enter (selects autocomplete instead)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
            }
        });
    }

    // Observe new stop inputs for autocomplete
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    const input = node.querySelector ? node.querySelector('.stop-input') : null;
                    if (input && window.google) {
                        enableAutocomplete(input);
                    }
                }
            });
        });
    });
    observer.observe(stopsContainer, { childList: true });

    // Route Optimization
    async function optimizeRoute() {
        if (!apiKey) {
            openSettings();
            return;
        }

        const origin = startInput.value.trim();
        const waypoints = stops
            .filter(s => s.address.trim().length > 0)
            .map(s => s.address.trim());

        if (!origin || waypoints.length < 2) {
            alert('Please enter a starting location and at least 2 stops.');
            return;
        }

        // Show loading state
        optimizeBtn.innerHTML = '<span class="loading"></span> Optimizing...';
        optimizeBtn.disabled = true;
        resultsSection.classList.add('hidden');

        try {
            const directionsService = new google.maps.DirectionsService();

            // Use last waypoint as destination, rest as waypoints
            const destination = waypoints[waypoints.length - 1];
            const intermediateWaypoints = waypoints.slice(0, -1).map(addr => ({
                location: addr,
                stopover: true,
            }));

            // If we want to return to origin (round trip), set destination = origin
            // For now, optimize the order of all stops
            const request = {
                origin: origin,
                destination: destination,
                waypoints: intermediateWaypoints,
                optimizeWaypoints: true, // This is the magic — reorders for fastest route
                travelMode: google.maps.TravelMode.DRIVING,
            };

            directionsService.route(request, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    displayRoute(result, origin, waypoints);
                } else {
                    handleDirectionsError(status);
                }
                optimizeBtn.innerHTML = 'Optimize Route';
                optimizeBtn.disabled = false;
            });
        } catch (error) {
            alert('Error optimizing route. Please check your addresses and try again.');
            optimizeBtn.innerHTML = 'Optimize Route';
            optimizeBtn.disabled = false;
        }
    }

    function displayRoute(result, origin, originalWaypoints) {
        // Show on map
        if (directionsRenderer) {
            directionsRenderer.setDirections(result);
        }
        mapContainer.classList.add('active');

        const route = result.routes[0];
        const legs = route.legs;

        // Calculate totals
        let totalDistance = 0;
        let totalDuration = 0;
        legs.forEach(leg => {
            totalDistance += leg.distance.value;
            totalDuration += leg.duration.value;
        });

        const distanceMiles = (totalDistance / 1609.34).toFixed(1);
        const hours = Math.floor(totalDuration / 3600);
        const minutes = Math.round((totalDuration % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        // Display summary
        routeSummary.innerHTML = `
            <div class="stat">
                <div class="stat-value">${timeStr}</div>
                <div class="stat-label">Total Time</div>
            </div>
            <div class="stat">
                <div class="stat-value">${distanceMiles} mi</div>
                <div class="stat-label">Total Distance</div>
            </div>
            <div class="stat">
                <div class="stat-value">${legs.length + 1}</div>
                <div class="stat-label">Stops</div>
            </div>
        `;

        // Display optimized order
        const waypointOrder = route.waypoint_order;
        let stepsHtml = '';

        // Start
        stepsHtml += `
            <div class="route-step">
                <span class="marker">🟢</span>
                <div class="step-info">
                    <div class="step-address">${legs[0].start_address}</div>
                    <div class="step-detail">Start</div>
                </div>
            </div>
        `;

        // Intermediate stops in optimized order
        legs.forEach((leg, i) => {
            const isLast = i === legs.length - 1;
            stepsHtml += `
                <div class="route-step">
                    <span class="${isLast ? 'marker' : 'stop-number'}">${isLast ? '🔴' : i + 1}</span>
                    <div class="step-info">
                        <div class="step-address">${leg.end_address}</div>
                        <div class="step-detail">${leg.distance.text} · ${leg.duration.text}</div>
                    </div>
                </div>
            `;
        });

        routeSteps.innerHTML = stepsHtml;
        resultsSection.classList.remove('hidden');

        // Save optimized route for Google Maps navigation link
        optimizedRoute = {
            origin: legs[0].start_address,
            destination: legs[legs.length - 1].end_address,
            waypoints: legs.slice(0, -1).map(leg => leg.end_address),
        };

        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    function handleDirectionsError(status) {
        const messages = {
            'NOT_FOUND': 'One or more addresses could not be found. Please check your entries.',
            'ZERO_RESULTS': 'No route could be found between these locations.',
            'MAX_WAYPOINTS_EXCEEDED': 'Too many stops. Google Maps supports up to 25 waypoints.',
            'INVALID_REQUEST': 'Invalid request. Please check your addresses.',
            'OVER_QUERY_LIMIT': 'API query limit exceeded. Please try again later.',
            'REQUEST_DENIED': 'Request denied. Please check your API key and ensure Directions API is enabled.',
            'UNKNOWN_ERROR': 'An unknown error occurred. Please try again.',
        };
        alert(messages[status] || `Error: ${status}`);
    }

    // Open optimized route in Google Maps app
    function openInGoogleMaps() {
        if (!optimizedRoute) return;

        const { origin, destination, waypoints } = optimizedRoute;
        let url = `https://www.google.com/maps/dir/?api=1`;
        url += `&origin=${encodeURIComponent(origin)}`;
        url += `&destination=${encodeURIComponent(destination)}`;

        if (waypoints.length > 0) {
            url += `&waypoints=${waypoints.map(w => encodeURIComponent(w)).join('|')}`;
        }

        url += `&travelmode=driving`;
        window.open(url, '_blank');
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {
            // Service worker registration failed, app still works
        });
    }

    // Start the app
    init();
})();
