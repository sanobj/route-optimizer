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
    const endInput = document.getElementById('end-input');
    const gpsBtn = document.getElementById('gps-btn');
    const stopsContainer = document.getElementById('stops-container');
    const addStopBtn = document.getElementById('add-stop-btn');
    const optimizeBtn = document.getElementById('optimize-btn');
    const routeSummary = document.getElementById('route-summary');
    const resultActions = document.getElementById('result-actions');
    const navigateBtn = document.getElementById('navigate-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    const mapContainer = document.getElementById('map');

    // End mode state: 'none', 'round-trip', 'address'
    let endMode = 'none';
    const endModeBtns = document.querySelectorAll('.end-mode-btn');
    const endInputRow = document.querySelector('.end-input-row');

    // Last optimized route data for navigation link
    let optimizedRoute = null;

    // Track currently loaded saved route name
    let currentLoadedRouteName = null;

    // Suppress scroll when auto-optimizing from load
    let suppressScroll = false;

    // Initialize
    function init() {
        addStopBtn.addEventListener('click', addStop);
        optimizeBtn.addEventListener('click', optimizeRoute);
        document.getElementById('clear-btn').addEventListener('click', clearAll);
        gpsBtn.addEventListener('click', getCurrentLocation);
        settingsBtn.addEventListener('click', openSettings);
        saveKeyBtn.addEventListener('click', saveApiKey);
        cancelSettingsBtn.addEventListener('click', closeSettings);
        navigateBtn.addEventListener('click', openInGoogleMaps);
        startInput.addEventListener('input', updateOptimizeButton);
        endInput.addEventListener('input', updateOptimizeButton);

        // End mode toggle
        endModeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                endMode = btn.dataset.mode;
                endModeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (endMode === 'address') {
                    endInputRow.classList.remove('hidden');
                } else {
                    endInputRow.classList.add('hidden');
                }
                updateOptimizeButton();
            });
        });

        // Add one empty stop by default
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
        stops.push({ id: stopId, address: '', pinned: false });

        const stopEl = document.createElement('div');
        stopEl.className = 'input-row';
        stopEl.dataset.id = stopId;
        stopEl.innerHTML = `
            <button class="pin-btn" aria-label="Pin this stop" data-id="${stopId}" title="Pin to keep position">🔓</button>
            <span class="stop-number">${index + 1}</span>
            <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stopId}">
            <span class="drag-handle" data-id="${stopId}">☰</span>
            <button class="remove-btn" aria-label="Remove stop" data-id="${stopId}">✕</button>
        `;

        stopsContainer.appendChild(stopEl);

        // Event listeners
        const input = stopEl.querySelector('.stop-input');
        const removeBtn = stopEl.querySelector('.remove-btn');
        const pinBtn = stopEl.querySelector('.pin-btn');

        input.addEventListener('input', (e) => {
            const stop = stops.find(s => s.id === stopId);
            if (stop) stop.address = e.target.value;
            updateOptimizeButton();
        });

        removeBtn.addEventListener('click', () => removeStop(stopId));
        pinBtn.addEventListener('click', () => togglePin(stopId));
        updateOptimizeButton();

        // Auto-focus the new input
        input.focus();
    }

    function togglePin(id) {
        const stop = stops.find(s => s.id === id);
        if (!stop) return;
        stop.pinned = !stop.pinned;

        const row = stopsContainer.querySelector(`[data-id="${id}"]`);
        const pinBtn = row.querySelector('.pin-btn');
        if (stop.pinned) {
            pinBtn.textContent = '📌';
            pinBtn.title = 'Unpin to allow optimization';
            row.classList.add('pinned');
        } else {
            pinBtn.textContent = '🔓';
            pinBtn.title = 'Pin to keep position';
            row.classList.remove('pinned');
        }
    }

    function moveStop(id, direction) {
        const index = stops.findIndex(s => s.id === id);
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= stops.length) return;

        // Swap in array
        [stops[index], stops[newIndex]] = [stops[newIndex], stops[index]];

        // Swap DOM elements
        const rows = Array.from(stopsContainer.children);
        const el = rows[index];
        if (direction === -1) {
            stopsContainer.insertBefore(el, rows[newIndex]);
        } else {
            stopsContainer.insertBefore(rows[newIndex], el);
        }

        renumberStops();
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
        let endReady = true;
        if (endMode === 'address') {
            endReady = endInput.value.trim().length > 0;
        }
        optimizeBtn.disabled = !(hasStart && endReady && filledStops.length >= 1);
    }

    function clearAll() {
        // Save current state to history before clearing (if there's anything to save)
        const origin = startInput.value.trim();
        const filledStops = stops.filter(s => s.address.trim().length > 0);
        if (origin || filledStops.length > 0) {
            const destination = endMode === 'address' ? endInput.value.trim() : '';
            saveToHistory({
                origin: origin || '(none)',
                destination: destination || '(none)',
                stops: filledStops.map(s => ({ address: s.address, pinned: s.pinned })),
                totalTime: '-',
                totalDistance: '-',
                timestamp: Date.now(),
                endMode: endMode,
                cleared: true,
            });
        }

        // Clear start
        startInput.value = '';

        // Reset end mode to none
        endMode = 'none';
        endModeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === 'none'));
        endInputRow.classList.add('hidden');
        endInput.value = '';

        // Clear stops and add one empty
        stopsContainer.innerHTML = '';
        stops = [];
        addStop();

        // Hide summary and actions
        routeSummary.classList.add('hidden');
        resultActions.classList.add('hidden');

        // Clear map
        if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
        if (window._routeMarkers) {
            window._routeMarkers.forEach(m => m.setMap(null));
            window._routeMarkers = [];
        }

        // Reset state
        optimizedRoute = null;
        currentLoadedRouteName = null;
        updateOptimizeButton();
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
                // Reverse geocode to get a street address
                if (window.google && google.maps) {
                    const geocoder = new google.maps.Geocoder();
                    geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
                        if (status === 'OK' && results[0]) {
                            startInput.value = results[0].formatted_address;
                        } else {
                            // Fallback to coordinates if reverse geocode fails
                            startInput.value = `${latitude}, ${longitude}`;
                        }
                        gpsBtn.textContent = '🎯';
                        updateOptimizeButton();
                    });
                } else {
                    startInput.value = `${latitude}, ${longitude}`;
                    gpsBtn.textContent = '🎯';
                    updateOptimizeButton();
                }
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
            gestureHandling: 'cooperative',
        });
        directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: true,
        });
        mapContainer.classList.add('active');

        // Enable Places Autocomplete on inputs
        console.log('Enabling autocomplete on inputs...');
        enableAutocomplete(startInput);
        enableAutocomplete(endInput);
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

        // Fix for mobile: prevent pac-container from disappearing on touch
        // by stopping the blur event when touching autocomplete results
        input.addEventListener('blur', (e) => {
            // Small delay to allow pac-item click/touch to register
            setTimeout(() => {}, 300);
        });
    }

    // Global fix: prevent touchstart on pac-items from triggering blur on input
    document.addEventListener('touchstart', (e) => {
        if (e.target.closest('.pac-container')) {
            e.stopPropagation();
        }
    }, true);

    document.addEventListener('touchend', (e) => {
        if (e.target.closest('.pac-container')) {
            e.stopPropagation();
        }
    }, true);

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

    // ===== TOUCH DRAG TO REORDER =====
    let dragState = null;
    let dragHoldTimer = null;
    let dragReady = false;

    stopsContainer.addEventListener('touchstart', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;

        const row = handle.closest('.input-row');
        if (!row) return;

        const touch = e.touches[0];

        // Start a hold timer — must hold for 500ms before drag activates
        dragReady = false;
        dragHoldTimer = setTimeout(() => {
            dragReady = true;
            const rect = row.getBoundingClientRect();

            dragState = {
                row: row,
                id: parseInt(row.dataset.id) || parseFloat(row.dataset.id),
                startY: touch.clientY,
                offsetY: touch.clientY - rect.top,
                rowHeight: rect.height,
            };

            row.classList.add('dragging');
            row.style.zIndex = '100';
            // Haptic feedback if available
            if (navigator.vibrate) navigator.vibrate(30);
        }, 500);
    }, { passive: true });

    stopsContainer.addEventListener('touchmove', (e) => {
        // If hold timer hasn't fired yet, cancel it (user is scrolling)
        if (!dragReady && dragHoldTimer) {
            clearTimeout(dragHoldTimer);
            dragHoldTimer = null;
            return;
        }

        if (!dragState) return;
        e.preventDefault();

        const touch = e.touches[0];
        const rows = Array.from(stopsContainer.querySelectorAll('.input-row'));
        const currentIndex = rows.indexOf(dragState.row);

        // Determine which row we're hovering over
        for (let i = 0; i < rows.length; i++) {
            if (i === currentIndex) continue;
            const rect = rows[i].getBoundingClientRect();
            const midY = rect.top + rect.height / 2;

            if (i < currentIndex && touch.clientY < midY) {
                // Move up
                stopsContainer.insertBefore(dragState.row, rows[i]);
                swapStops(currentIndex, i);
                break;
            } else if (i > currentIndex && touch.clientY > midY) {
                // Move down
                if (rows[i].nextSibling) {
                    stopsContainer.insertBefore(dragState.row, rows[i].nextSibling);
                } else {
                    stopsContainer.appendChild(dragState.row);
                }
                swapStops(currentIndex, i);
                break;
            }
        }
    }, { passive: false });

    stopsContainer.addEventListener('touchend', () => {
        clearTimeout(dragHoldTimer);
        dragHoldTimer = null;
        dragReady = false;
        if (!dragState) return;
        dragState.row.classList.remove('dragging');
        dragState.row.style.zIndex = '';
        dragState = null;
        renumberStops();
    });

    function swapStops(fromIndex, toIndex) {
        const item = stops.splice(fromIndex, 1)[0];
        stops.splice(toIndex, 0, item);
    }

    // ===== MOUSE DRAG TO REORDER (Desktop) =====
    stopsContainer.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;

        e.preventDefault();
        const row = handle.closest('.input-row');
        if (!row) return;

        dragState = {
            row: row,
            id: parseInt(row.dataset.id) || parseFloat(row.dataset.id),
            startY: e.clientY,
        };

        row.classList.add('dragging');
        row.style.zIndex = '100';

        const onMouseMove = (ev) => {
            if (!dragState) return;

            const rows = Array.from(stopsContainer.querySelectorAll('.input-row'));
            const currentIndex = rows.indexOf(dragState.row);

            for (let i = 0; i < rows.length; i++) {
                if (i === currentIndex) continue;
                const rect = rows[i].getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                if (i < currentIndex && ev.clientY < midY) {
                    stopsContainer.insertBefore(dragState.row, rows[i]);
                    swapStops(currentIndex, i);
                    break;
                } else if (i > currentIndex && ev.clientY > midY) {
                    if (rows[i].nextSibling) {
                        stopsContainer.insertBefore(dragState.row, rows[i].nextSibling);
                    } else {
                        stopsContainer.appendChild(dragState.row);
                    }
                    swapStops(currentIndex, i);
                    break;
                }
            }
        };

        const onMouseUp = () => {
            if (dragState) {
                dragState.row.classList.remove('dragging');
                dragState.row.style.zIndex = '';
                dragState = null;
                renumberStops();
            }
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Route Optimization
    async function optimizeRoute() {
        if (!apiKey) {
            openSettings();
            return;
        }

        const origin = startInput.value.trim();
        const filledStops = stops.filter(s => s.address.trim().length > 0);

        // Determine destination based on end mode
        let destination;
        if (endMode === 'round-trip') {
            destination = origin;
        } else if (endMode === 'address') {
            destination = endInput.value.trim();
            if (!destination) {
                alert('Please enter an end address.');
                return;
            }
        } else {
            // "none" mode — no fixed end
            destination = null;
        }

        if (!origin || filledStops.length < 1) {
            alert('Please enter a start and at least 1 stop.');
            return;
        }

        // Show loading state
        optimizeBtn.innerHTML = '<span class="loading"></span> Optimizing...';
        optimizeBtn.disabled = true;
        routeSummary.classList.add('hidden');
        resultActions.classList.add('hidden');

        // Separate pinned and unpinned stops
        const pinnedStops = filledStops.filter(s => s.pinned);

        if (destination === null) {
            // No end mode: use last waypoint as destination, optimize the rest
            if (filledStops.length === 1) {
                runDirections(origin, filledStops[0].address.trim(), [], false);
            } else {
                const allAddresses = filledStops.map(s => s.address.trim());
                const dest = allAddresses[allAddresses.length - 1];
                const waypoints = allAddresses.slice(0, -1);

                if (pinnedStops.length === 0) {
                    runDirections(origin, dest, waypoints, true);
                } else {
                    optimizeWithPinnedStops(origin, dest, filledStops);
                }
            }
        } else {
            // Have a fixed destination (round-trip or address)
            if (pinnedStops.length === 0) {
                runDirections(origin, destination, filledStops.map(s => s.address.trim()), true);
            } else {
                optimizeWithPinnedStops(origin, destination, filledStops);
            }
        }
    }

    function optimizeWithPinnedStops(origin, destination, filledStops) {
        // Strategy: Send all waypoints but DON'T optimize.
        // Instead, we manually figure out the best order:
        // 1. Pinned stops stay in their exact positions
        // 2. Unpinned stops between pinned stops get optimized within those segments

        // First, identify segments between pinned stops
        // A segment is a group of unpinned stops between two fixed points
        const allAddresses = filledStops.map(s => s.address.trim());
        const pinnedIndices = filledStops.reduce((acc, s, i) => {
            if (s.pinned) acc.push(i);
            return acc;
        }, []);
        const unpinnedIndices = filledStops.reduce((acc, s, i) => {
            if (!s.pinned) acc.push(i);
            return acc;
        }, []);

        if (unpinnedIndices.length === 0) {
            // All stops are pinned — just route in order, no optimization
            runDirections(origin, destination, allAddresses, false);
            return;
        }

        // For the optimization: we keep pinned stops in order and let Google
        // optimize the unpinned ones around them.
        // We build waypoints array preserving pinned order.
        // Google's optimizeWaypoints will reorder ALL waypoints, which we don't want.
        // So we make multiple segment calls or use a single call without optimization
        // but with our own ordering logic.

        // Simpler approach: Use a single Directions call.
        // Mark pinned waypoints as NOT optimizable by splitting into legs.
        // Actually, the simplest correct approach:
        // Build segments between fixed points, optimize each segment independently.

        const segments = [];
        let segStart = origin;
        let currentUnpinned = [];

        for (let i = 0; i < filledStops.length; i++) {
            if (filledStops[i].pinned) {
                // End current segment
                if (currentUnpinned.length > 0) {
                    segments.push({
                        origin: segStart,
                        destination: filledStops[i].address.trim(),
                        waypoints: currentUnpinned.slice(),
                        optimize: true,
                    });
                    currentUnpinned = [];
                } else {
                    segments.push({
                        origin: segStart,
                        destination: filledStops[i].address.trim(),
                        waypoints: [],
                        optimize: false,
                    });
                }
                segStart = filledStops[i].address.trim();
            } else {
                currentUnpinned.push(filledStops[i].address.trim());
            }
        }

        // Final segment to destination
        if (currentUnpinned.length > 0) {
            segments.push({
                origin: segStart,
                destination: destination,
                waypoints: currentUnpinned.slice(),
                optimize: true,
            });
        } else {
            segments.push({
                origin: segStart,
                destination: destination,
                waypoints: [],
                optimize: false,
            });
        }

        // Now resolve each segment, then combine into one final ordered waypoints list
        resolveSegments(segments, origin, destination);
    }

    function resolveSegments(segments, origin, destination) {
        const directionsService = new google.maps.DirectionsService();
        let resolvedWaypoints = [];
        let completed = 0;
        const segmentResults = new Array(segments.length);

        segments.forEach((seg, idx) => {
            if (seg.waypoints.length === 0) {
                // No waypoints to optimize in this segment
                segmentResults[idx] = [];
                completed++;
                if (completed === segments.length) {
                    finalizeSegments(segmentResults, segments, origin, destination);
                }
            } else if (!seg.optimize || seg.waypoints.length === 1) {
                // Only one waypoint or no optimization needed
                segmentResults[idx] = seg.waypoints;
                completed++;
                if (completed === segments.length) {
                    finalizeSegments(segmentResults, segments, origin, destination);
                }
            } else {
                // Optimize this segment
                const request = {
                    origin: seg.origin,
                    destination: seg.destination,
                    waypoints: seg.waypoints.map(addr => ({ location: addr, stopover: true })),
                    optimizeWaypoints: true,
                    travelMode: google.maps.TravelMode.DRIVING,
                };

                directionsService.route(request, (result, status) => {
                    if (status === google.maps.DirectionsStatus.OK) {
                        const order = result.routes[0].waypoint_order;
                        segmentResults[idx] = order.map(i => seg.waypoints[i]);
                    } else {
                        // Fallback: use original order
                        segmentResults[idx] = seg.waypoints;
                    }
                    completed++;
                    if (completed === segments.length) {
                        finalizeSegments(segmentResults, segments, origin, destination);
                    }
                });
            }
        });
    }

    function finalizeSegments(segmentResults, segments, origin, destination) {
        // Build final ordered waypoints list
        const finalWaypoints = [];
        for (let i = 0; i < segments.length; i++) {
            // Add optimized waypoints for this segment
            segmentResults[i].forEach(addr => finalWaypoints.push(addr));
            // Add the segment destination (which is a pinned stop) unless it's the final destination
            if (segments[i].destination !== destination) {
                finalWaypoints.push(segments[i].destination);
            }
        }

        // Now make one final directions call with the fully ordered waypoints (no optimization)
        runDirections(origin, destination, finalWaypoints, false);
    }

    function runDirections(origin, destination, waypoints, optimize) {
        const directionsService = new google.maps.DirectionsService();

        const request = {
            origin: origin,
            destination: destination,
            waypoints: waypoints.map(addr => ({
                location: addr,
                stopover: true,
            })),
            optimizeWaypoints: optimize,
            travelMode: google.maps.TravelMode.DRIVING,
        };

        directionsService.route(request, (result, status) => {
            if (status === google.maps.DirectionsStatus.OK) {
                try {
                    displayRoute(result, origin, waypoints);
                } catch (e) {
                    console.error('displayRoute error:', e);
                }
            } else {
                handleDirectionsError(status);
            }
            optimizeBtn.innerHTML = 'Optimize Route';
            optimizeBtn.disabled = false;
            updateOptimizeButton();
        });
    }

    // Custom map markers
    function addCustomMarker(position, emoji, title) {
        const marker = new google.maps.Marker({
            position: position,
            map: map,
            title: title,
            label: {
                text: emoji,
                fontSize: '18px',
            },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 0,
            },
        });
        window._routeMarkers.push(marker);
    }

    function addNumberedMarker(position, label, color, address) {
        const svg = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
                <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 24 16 24s16-12 16-24C32 7.2 24.8 0 16 0z" fill="${color}"/>
                <circle cx="16" cy="16" r="10" fill="white"/>
                <text x="16" y="21" text-anchor="middle" font-size="12" font-weight="bold" fill="${color}">${label}</text>
            </svg>
        `)}`;

        const marker = new google.maps.Marker({
            position: position,
            map: map,
            icon: {
                url: svg,
                scaledSize: new google.maps.Size(32, 40),
                anchor: new google.maps.Point(16, 40),
            },
        });

        if (address) {
            const infoWindow = new google.maps.InfoWindow({
                content: `<div style="display:flex;align-items:flex-start;gap:8px;font-size:13px;font-weight:500;padding:2px 0;"><span style="flex:1;">${address}</span><button onclick="this.closest('.gm-style-iw-c').querySelector('button.gm-ui-hover-effect')?.click();window._closeInfoWindow()" style="background:none;border:none;font-size:16px;cursor:pointer;padding:0 2px;color:#666;flex-shrink:0;">✕</button></div>`,
                maxWidth: 220,
                headerDisabled: true,
            });
            marker.addListener('click', () => {
                if (window._openInfoWindow) window._openInfoWindow.close();
                infoWindow.open(map, marker);
                window._openInfoWindow = infoWindow;
            });
        }

        window._routeMarkers.push(marker);
    }

    window._closeInfoWindow = function() {
        if (window._openInfoWindow) {
            window._openInfoWindow.close();
            window._openInfoWindow = null;
        }
    };

    function reorderStopsToMatch(orderedAddresses, excludeLast) {
        // Reorder the stops array and DOM to match the optimized route order
        // orderedAddresses is the list of waypoint addresses in optimized order
        // excludeLast: if true, keep the last filled stop in place (it was used as destination)
        if (!orderedAddresses || orderedAddresses.length === 0) return;

        const filledStops = stops.filter(s => s.address.trim().length > 0);
        const emptyStops = stops.filter(s => s.address.trim().length === 0);

        // If excludeLast, separate the last filled stop (destination) from the reorderable ones
        let lastStop = null;
        let reorderableStops = filledStops;
        if (excludeLast && filledStops.length > 1) {
            lastStop = filledStops[filledStops.length - 1];
            reorderableStops = filledStops.slice(0, -1);
        }

        // Build new ordered array of filled stops based on optimized addresses
        const reordered = [];
        const used = new Set();

        orderedAddresses.forEach(addr => {
            // Find the matching stop (by address, case-insensitive)
            const match = reorderableStops.find((s, i) => !used.has(i) && s.address.trim().toLowerCase() === addr.toLowerCase());
            if (match) {
                used.add(reorderableStops.indexOf(match));
                reordered.push(match);
            } else {
                // Fallback: try next unmatched stop (Google may return slightly different formatting)
                const partial = reorderableStops.find((s, i) => !used.has(i));
                if (partial) {
                    used.add(reorderableStops.indexOf(partial));
                    partial.address = addr; // Update to the Google-formatted address
                    reordered.push(partial);
                }
            }
        });

        // Add any remaining reorderable stops that weren't matched
        reorderableStops.forEach((s, i) => {
            if (!used.has(i)) reordered.push(s);
        });

        // Rebuild stops array: reordered + lastStop (if excluded) + empty
        if (lastStop) {
            stops = [...reordered, lastStop, ...emptyStops];
        } else {
            stops = [...reordered, ...emptyStops];
        }

        // Rebuild DOM
        stopsContainer.innerHTML = '';
        stops.forEach((stop, index) => {
            const stopEl = document.createElement('div');
            stopEl.className = 'input-row' + (stop.pinned ? ' pinned' : '');
            stopEl.dataset.id = stop.id;
            stopEl.innerHTML = `
                <button class="pin-btn" aria-label="Pin this stop" data-id="${stop.id}" title="${stop.pinned ? 'Unpin to allow optimization' : 'Pin to keep position'}">${stop.pinned ? '📌' : '🔓'}</button>
                <span class="stop-number">${index + 1}</span>
                <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stop.id}" value="${stop.address}">
                <span class="drag-handle" data-id="${stop.id}">☰</span>
                <button class="remove-btn" aria-label="Remove stop" data-id="${stop.id}">✕</button>
            `;
            stopsContainer.appendChild(stopEl);

            const input = stopEl.querySelector('.stop-input');
            const removeBtn = stopEl.querySelector('.remove-btn');
            const pinBtn = stopEl.querySelector('.pin-btn');

            input.addEventListener('input', (e) => {
                const s = stops.find(st => st.id === stop.id);
                if (s) s.address = e.target.value;
                updateOptimizeButton();
            });

            removeBtn.addEventListener('click', () => removeStop(stop.id));
            pinBtn.addEventListener('click', () => togglePin(stop.id));

            if (window.google && google.maps.places) {
                enableAutocomplete(input);
            }
        });
    }

    function displayRoute(result, origin, originalWaypoints) {
        // Show on map
        if (directionsRenderer) {
            directionsRenderer.setDirections(result);
            // Hide default A, B, C markers — we'll add our own
            directionsRenderer.setOptions({ suppressMarkers: true });
        }
        mapContainer.classList.add('active');

        // Reorder the input stops to match the optimized route
        const route = result.routes[0];
        const legs = route.legs;

        // Update start input to Google-formatted address
        startInput.value = legs[0].start_address;

        // The intermediate stops are legs[0].end_address through legs[n-2].end_address
        // (last leg end is the destination, not a waypoint)
        if (legs.length > 1) {
            const optimizedStopAddresses = legs.slice(0, -1).map(leg => leg.end_address);
            // In "No End" mode, the last filled stop was used as destination,
            // so we only reorder the waypoint stops (exclude the last one)
            if (endMode === 'none') {
                reorderStopsToMatch(optimizedStopAddresses, true);
            } else {
                reorderStopsToMatch(optimizedStopAddresses, false);
            }
        } else if (legs.length === 1 && stops.filter(s => s.address.trim()).length === 1) {
            // Single stop — update its address to the Google-formatted version
            const filledStop = stops.find(s => s.address.trim().length > 0);
            if (filledStop) {
                filledStop.address = legs[0].end_address;
                const input = stopsContainer.querySelector(`[data-id="${filledStop.id}"] .stop-input`);
                if (input) input.value = filledStop.address;
            }
        }

        // Update end input if in address mode
        if (endMode === 'address') {
            endInput.value = legs[legs.length - 1].end_address;
        }

        // Clear old custom markers
        if (window._routeMarkers) {
            window._routeMarkers.forEach(m => m.setMap(null));
        }
        window._routeMarkers = [];

        // Add custom numbered markers
        // Start marker (green)
        addCustomMarker(legs[0].start_location, '📍', 'Start');

        // Intermediate stops (numbered)
        legs.forEach((leg, i) => {
            const isLast = i === legs.length - 1;
            const label = isLast ? '●' : String(i + 1);
            const color = isLast ? '#ea4335' : '#1a73e8';
            addNumberedMarker(leg.end_location, label, color, leg.end_address);
        });

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

        // Build leg breakdown HTML
        let breakdownHtml = '<div class="route-breakdown hidden">';
        // Show first address (start)
        breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label breakdown-start">Start</span> ${legs[0].start_address}</div>`;
        // Show each leg's distance/time then the next address
        legs.forEach((leg, i) => {
            breakdownHtml += `<div class="breakdown-arrow">↓ ${leg.distance.text} · ${leg.duration.text}</div>`;
            const isLast = i === legs.length - 1;
            const label = isLast ? 'End' : `${i + 1}`;
            const cls = isLast ? 'breakdown-end' : '';
            breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label ${cls}">${label}</span> ${leg.end_address}</div>`;
        });
        breakdownHtml += '</div>';

        // Display summary
        routeSummary.innerHTML = `
            <div class="summary-stats">
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
            </div>
            <div class="summary-expand-hint">Tap for breakdown ▾</div>
            ${breakdownHtml}
        `;
        routeSummary.classList.remove('hidden');
        resultActions.classList.remove('hidden');

        // Toggle breakdown on click
        routeSummary.onclick = () => {
            const breakdown = routeSummary.querySelector('.route-breakdown');
            const hint = routeSummary.querySelector('.summary-expand-hint');
            if (breakdown) {
                breakdown.classList.toggle('hidden');
                hint.textContent = breakdown.classList.contains('hidden') ? 'Tap for breakdown ▾' : 'Tap to collapse ▴';
            }
        };

        // Save optimized route for Google Maps navigation link
        optimizedRoute = {
            origin: legs[0].start_address,
            destination: legs[legs.length - 1].end_address,
            waypoints: legs.slice(0, -1).map(leg => leg.end_address),
        };

        // Auto-save to route history
        const filledStopsForHistory = stops.filter(s => s.address.trim().length > 0);
        saveToHistory({
            origin: legs[0].start_address,
            destination: legs[legs.length - 1].end_address,
            stops: filledStopsForHistory.map(s => ({ address: s.address, pinned: s.pinned })),
            totalTime: timeStr,
            totalDistance: distanceMiles + ' mi',
            timestamp: Date.now(),
            endMode: endMode,
        });

        // Scroll to map unless suppressed (e.g. auto-optimize from load)
        if (!suppressScroll) {
            mapContainer.scrollIntoView({ behavior: 'smooth' });
        }
        suppressScroll = false;
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

    // ===== SAVED ROUTES =====
    const saveRouteBtn = document.getElementById('save-route-btn');
    const savedRoutesList = document.getElementById('saved-routes-list');
    const savedRoutesBtn = document.getElementById('saved-routes-btn');
    const savedRoutesModal = document.getElementById('saved-routes-modal');
    const closeSavedRoutesBtn = document.getElementById('close-saved-routes-btn');

    saveRouteBtn.addEventListener('click', saveCurrentRoute);
    savedRoutesBtn.addEventListener('click', openSavedRoutes);
    closeSavedRoutesBtn.addEventListener('click', closeSavedRoutes);

    function openSavedRoutes() {
        renderSavedRoutes();
        savedRoutesModal.classList.remove('hidden');
    }

    function closeSavedRoutes() {
        savedRoutesModal.classList.add('hidden');
    }

    function getSavedRoutes() {
        const data = localStorage.getItem('savedRoutes');
        return data ? JSON.parse(data) : [];
    }

    function setSavedRoutes(routes) {
        localStorage.setItem('savedRoutes', JSON.stringify(routes));
    }

    function saveCurrentRoute() {
        const origin = startInput.value.trim();
        const destination = endMode === 'address' ? endInput.value.trim() : '';
        const waypoints = stops
            .filter(s => s.address.trim().length > 0)
            .map(s => ({ address: s.address.trim(), pinned: s.pinned }));

        if (!origin || waypoints.length === 0) {
            alert('Nothing to save. Enter addresses first.');
            return;
        }

        const defaultName = currentLoadedRouteName || `Route ${getSavedRoutes().length + 1}`;
        const saved = getSavedRoutes();
        const existingWithDefault = saved.findIndex(r => r.name.toLowerCase() === defaultName.toLowerCase());

        // If this would overwrite, make that clear in the prompt
        let promptMsg = 'Name this route:';
        if (existingWithDefault !== -1 && currentLoadedRouteName) {
            promptMsg = `Current save: "${currentLoadedRouteName}"\n\nKeeping the same name will overwrite.\nRename to save as new.`;
        }

        const name = prompt(promptMsg, defaultName);
        if (!name) return; // User cancelled

        const trimmedName = name.trim();
        const existingIndex = saved.findIndex(r => r.name.toLowerCase() === trimmedName.toLowerCase());

        const route = {
            id: Date.now(),
            name: trimmedName,
            origin: origin,
            destination: destination,
            endMode: endMode,
            stops: waypoints.map(s => s.address),
            pinnedIndices: waypoints.reduce((acc, s, i) => { if (s.pinned) acc.push(i); return acc; }, []),
            createdAt: new Date().toLocaleDateString(),
        };

        if (existingIndex !== -1) {
            saved[existingIndex] = route;
        } else {
            saved.unshift(route);
        }

        setSavedRoutes(saved);
        currentLoadedRouteName = trimmedName;
    }

    function loadRoute(id) {
        const saved = getSavedRoutes();
        const route = saved.find(r => r.id === id);
        if (!route) return;

        // Track loaded route name
        currentLoadedRouteName = route.name;

        // Clear current stops
        stopsContainer.innerHTML = '';
        stops = [];

        // Set origin
        startInput.value = route.origin;

        // Restore end mode
        const savedEndMode = route.endMode || (route.destination ? 'address' : 'none');
        endMode = savedEndMode;
        endModeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === endMode);
        });
        if (endMode === 'address') {
            endInputRow.classList.remove('hidden');
            endInput.value = route.destination || '';
        } else {
            endInputRow.classList.add('hidden');
            endInput.value = '';
        }

        // Add saved stops
        route.stops.forEach(address => {
            const index = stops.length;
            const stopId = Date.now() + index + Math.random();
            stops.push({ id: stopId, address: address, pinned: false });

            const stopEl = document.createElement('div');
            stopEl.className = 'input-row';
            stopEl.dataset.id = stopId;
            stopEl.innerHTML = `
                <button class="pin-btn" aria-label="Pin this stop" data-id="${stopId}" title="Pin to keep position">🔓</button>
                <span class="stop-number">${index + 1}</span>
                <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stopId}" value="${address}">
                <span class="drag-handle" data-id="${stopId}">☰</span>
                <button class="remove-btn" aria-label="Remove stop" data-id="${stopId}">✕</button>
            `;

            stopsContainer.appendChild(stopEl);

            const input = stopEl.querySelector('.stop-input');
            const removeBtn = stopEl.querySelector('.remove-btn');
            const pinBtn = stopEl.querySelector('.pin-btn');

            input.addEventListener('input', (e) => {
                const stop = stops.find(s => s.id === stopId);
                if (stop) stop.address = e.target.value;
                updateOptimizeButton();
            });

            removeBtn.addEventListener('click', () => removeStop(stopId));
            pinBtn.addEventListener('click', () => togglePin(stopId));

            // Enable autocomplete on the new input
            if (window.google && google.maps.places) {
                enableAutocomplete(input);
            }
        });

        updateOptimizeButton();
        closeSavedRoutes();

        // Auto-optimize the loaded route
        suppressScroll = true;
        setTimeout(() => optimizeRoute(), 100);
    }

    function deleteRoute(id) {
        if (!confirm('Delete this saved route?')) return;
        const saved = getSavedRoutes().filter(r => r.id !== id);
        setSavedRoutes(saved);
        renderSavedRoutes();
    }

    function renderSavedRoutes() {
        const saved = getSavedRoutes();

        if (saved.length === 0) {
            savedRoutesList.innerHTML = '<p class="empty-state">No saved routes yet</p>';
            return;
        }

        savedRoutesList.innerHTML = saved.map(route => `
            <div class="saved-route-card">
                <div class="route-name">${route.name}</div>
                <div class="route-stops-preview">🟢 ${route.origin} → ${route.stops.length} stop${route.stops.length > 1 ? 's' : ''} → 🔴 ${route.destination || 'N/A'}</div>
                <div class="route-meta">Saved ${route.createdAt}</div>
                <div class="saved-route-actions">
                    <button class="btn-load" onclick="window._loadRoute(${route.id})">Load</button>
                    <button class="btn-delete-route" onclick="window._deleteRoute(${route.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    // Expose to onclick handlers
    window._loadRoute = loadRoute;
    window._deleteRoute = deleteRoute;

    // ===== ROUTE HISTORY =====
    function getHistory() {
        const data = localStorage.getItem('routeHistory');
        return data ? JSON.parse(data) : [];
    }

    function setHistory(history) {
        localStorage.setItem('routeHistory', JSON.stringify(history));
    }

    function saveToHistory(entry) {
        const history = getHistory();
        history.unshift(entry);
        // Keep last 50 entries
        if (history.length > 50) history.length = 50;
        setHistory(history);
    }

    // History modal elements
    const historyBtn = document.getElementById('history-btn');
    const historyModal = document.getElementById('history-modal');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const historyList = document.getElementById('history-list');

    historyBtn.addEventListener('click', openHistory);
    closeHistoryBtn.addEventListener('click', closeHistory);
    clearHistoryBtn.addEventListener('click', () => {
        if (!confirm('Clear all route history?')) return;
        setHistory([]);
        renderHistory();
    });

    function openHistory() {
        renderHistory();
        historyModal.classList.remove('hidden');
    }

    function closeHistory() {
        historyModal.classList.add('hidden');
    }

    function renderHistory() {
        const history = getHistory();

        if (history.length === 0) {
            historyList.innerHTML = '<p class="empty-state">No history yet</p>';
            return;
        }

        historyList.innerHTML = history.map((entry, idx) => {
            const date = new Date(entry.timestamp).toLocaleDateString(undefined, {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit'
            });
            const stopCount = entry.stops ? entry.stops.length : 0;
            const clearedTag = entry.cleared ? ' <span class="history-cleared">Cleared</span>' : '';
            return `
                <div class="history-card${entry.cleared ? ' history-card-cleared' : ''}">
                    <div class="history-title">${date}${clearedTag}</div>
                    <div class="history-route">
                        <span class="history-origin">📍 ${entry.origin}</span>
                        <span class="history-arrow">→ ${stopCount} stop${stopCount !== 1 ? 's' : ''} →</span>
                        <span class="history-dest">🔴 ${entry.destination}</span>
                    </div>
                    <div class="history-meta">
                        <span>${entry.totalTime} · ${entry.totalDistance}</span>
                    </div>
                    <div class="history-actions">
                        <button class="btn-load" onclick="window._loadHistory(${idx})">Load</button>
                        <button class="btn-delete-route" onclick="window._deleteHistory(${idx})">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function loadHistory(idx) {
        const history = getHistory();
        const entry = history[idx];
        if (!entry) return;

        // History loads don't have a saved route name
        currentLoadedRouteName = null;

        // Clear current stops
        stopsContainer.innerHTML = '';
        stops = [];

        // Set origin
        startInput.value = entry.origin;

        // Restore end mode
        const savedEndMode = entry.endMode || 'address';
        endMode = savedEndMode;
        endModeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === endMode);
        });
        if (endMode === 'address') {
            endInputRow.classList.remove('hidden');
            endInput.value = entry.destination;
        } else {
            endInputRow.classList.add('hidden');
            endInput.value = '';
        }

        // Add stops (supports both old format [string] and new format [{address, pinned}])
        const allStops = entry.stops || [];
        allStops.forEach(stopData => {
            const address = typeof stopData === 'string' ? stopData : stopData.address;
            const pinned = typeof stopData === 'string' ? false : !!stopData.pinned;
            const index = stops.length;
            const stopId = Date.now() + index + Math.random();
            stops.push({ id: stopId, address: address, pinned: pinned });

            const stopEl = document.createElement('div');
            stopEl.className = 'input-row' + (pinned ? ' pinned' : '');
            stopEl.dataset.id = stopId;
            stopEl.innerHTML = `
                <button class="pin-btn" aria-label="Pin this stop" data-id="${stopId}" title="${pinned ? 'Unpin to allow optimization' : 'Pin to keep position'}">${pinned ? '📌' : '🔓'}</button>
                <span class="stop-number">${index + 1}</span>
                <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stopId}" value="${address}">
                <span class="drag-handle" data-id="${stopId}">☰</span>
                <button class="remove-btn" aria-label="Remove stop" data-id="${stopId}">✕</button>
            `;
            stopsContainer.appendChild(stopEl);

            const input = stopEl.querySelector('.stop-input');
            const removeBtn = stopEl.querySelector('.remove-btn');
            const pinBtn = stopEl.querySelector('.pin-btn');

            input.addEventListener('input', (e) => {
                const s = stops.find(st => st.id === stopId);
                if (s) s.address = e.target.value;
                updateOptimizeButton();
            });

            removeBtn.addEventListener('click', () => removeStop(stopId));
            pinBtn.addEventListener('click', () => togglePin(stopId));

            if (window.google && google.maps.places) {
                enableAutocomplete(input);
            }
        });

        updateOptimizeButton();
        closeHistory();
        // Auto-optimize the loaded route
        suppressScroll = true;
        setTimeout(() => optimizeRoute(), 100);
    }

    function deleteHistory(idx) {
        if (!confirm('Delete this history entry?')) return;
        const history = getHistory();
        history.splice(idx, 1);
        setHistory(history);
        renderHistory();
    }

    // Expose to onclick handlers
    window._loadHistory = loadHistory;
    window._deleteHistory = deleteHistory;

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {
            // Service worker registration failed, app still works
        });
    }

    // Start the app
    init();
})();
