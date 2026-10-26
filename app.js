// Route Optimizer PWA
(function() {
    'use strict';

    // State
    let stops = [];
    let map = null;
    let directionsRenderer = null;
    let apiKey = localStorage.getItem('googleMapsApiKey') || '';
    let aiKey = localStorage.getItem('geminiApiKey') || '';
    let advancedUI = localStorage.getItem('advancedUI') === 'true';
    let darkMode = localStorage.getItem('darkMode') === 'true';

    // Apply theme immediately to prevent flash
    if (darkMode) document.documentElement.setAttribute('data-theme', 'dark');
    if (advancedUI) document.documentElement.setAttribute('data-advanced-ui', 'true');

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
        document.getElementById('clear-btn')?.addEventListener('click', clearAll);
        gpsBtn.addEventListener('click', getCurrentLocation);
        settingsBtn.addEventListener('click', openSettings);
        saveKeyBtn.addEventListener('click', saveApiKey);
        cancelSettingsBtn.addEventListener('click', closeSettings);
        navigateBtn.addEventListener('click', openInGoogleMaps);
        startInput.addEventListener('input', updateOptimizeButton);
        endInput.addEventListener('input', updateOptimizeButton);

        document.getElementById('clear-start-btn')?.addEventListener('click', () => {
            startInput.value = '';
            updateOptimizeButton();
        });
        document.getElementById('clear-end-btn')?.addEventListener('click', () => {
            endInput.value = '';
            updateOptimizeButton();
        });

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
        stops.push({ id: stopId, address: '', pinned: false, type: 'none' });

        const stopEl = document.createElement('div');
        stopEl.className = 'input-row' + (advancedUI ? ' row-default' : '');
        stopEl.dataset.id = stopId;
        stopEl.innerHTML = `
            <button class="pin-btn" aria-label="Lock this stop" data-id="${stopId}" title="Tap to lock this stop in place">${lockIcon(false)}</button>
            <span class="stop-number" data-id="${stopId}">${index + 1}</span>
            <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stopId}">
            <span class="drag-handle" data-id="${stopId}">≡</span>
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

    // Lock state icons (emoji). Note: Apple renders these differently from
    // Windows/Android, but the dimmed-vs-highlighted styling carries the state.
    function lockIcon(isLocked) {
        return isLocked ? '🔒' : '🔓';
    }

    function togglePin(id) {
        const stop = stops.find(s => s.id === id);
        if (!stop) return;
        stop.pinned = !stop.pinned;

        const row = stopsContainer.querySelector(`[data-id="${id}"]`);
        const pinBtn = row.querySelector('.pin-btn');
        if (stop.pinned) {
            pinBtn.innerHTML = lockIcon(true);
            pinBtn.title = 'Locked — tap to unlock';
            pinBtn.classList.add('locked');
            row.classList.add('pinned');
        } else {
            pinBtn.innerHTML = lockIcon(false);
            pinBtn.title = 'Tap to lock this stop in place';
            pinBtn.classList.remove('locked');
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
        // Hide any lingering Google autocomplete dropdown
        document.querySelectorAll('.pac-container').forEach(c => c.style.display = 'none');
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
                stops: filledStops.map(s => ({ address: s.address, pinned: s.pinned, type: s.type, rush: !!s.rush })),
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
        if (mapFilterRow) mapFilterRow.classList.add('hidden');

        // Clear map
        if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
        if (window._routeMarkers) {
            window._routeMarkers.forEach(m => m.marker.setMap(null));
            window._routeMarkers = [];
        }
        if (window._routePolylines) {
            window._routePolylines.forEach(p => p.polyline.setMap(null));
            window._routePolylines = [];
        }

        // Reset state
        optimizedRoute = null;
        currentLoadedRouteName = null;
        updateOptimizeButton();
    }

    // ===== RUSH TOGGLE (tap circle) =====
    // Tap the stop number circle to toggle rush (gold)
    stopsContainer.addEventListener('click', (e) => {
        if (!advancedUI) return;
        const numberEl = e.target.closest('.stop-number');
        if (!numberEl) return;

        const row = numberEl.closest('.input-row');
        if (!row) return;

        const id = Number(row.dataset.id);
        const stop = stops.find(s => s.id === id);
        if (!stop) return;

        // Toggle rush
        stop.rush = !stop.rush;
        row.classList.toggle('rush', stop.rush);

        // Update number circle — rush overrides color
        numberEl.classList.toggle('stop-num-rush', stop.rush);
    });

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

    // GPS for end location
    const endGpsBtn = document.getElementById('end-gps-btn');
    if (endGpsBtn) {
        endGpsBtn.addEventListener('click', getEndLocation);
    }

    function getEndLocation() {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser.');
            return;
        }

        endGpsBtn.textContent = '⏳';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                if (window.google && google.maps) {
                    const geocoder = new google.maps.Geocoder();
                    geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
                        if (status === 'OK' && results[0]) {
                            endInput.value = results[0].formatted_address;
                        } else {
                            endInput.value = `${latitude}, ${longitude}`;
                        }
                        endGpsBtn.textContent = '🎯';
                        updateOptimizeButton();
                    });
                } else {
                    endInput.value = `${latitude}, ${longitude}`;
                    endGpsBtn.textContent = '🎯';
                    updateOptimizeButton();
                }
            },
            (error) => {
                endGpsBtn.textContent = '🎯';
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

    // Help modal (default-feature guide)
    const helpBtn = document.getElementById('help-btn');
    const helpModal = document.getElementById('help-modal');
    const closeHelpBtn = document.getElementById('close-help-btn');
    if (helpBtn && helpModal) {
        helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
        const closeHelp = () => helpModal.classList.add('hidden');
        if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeHelp);
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) closeHelp();
        });
    }

    // Settings
    const advancedInfoBtn = document.getElementById('advanced-info-btn');
    const advancedInfo = document.getElementById('advanced-info');
    if (advancedInfoBtn && advancedInfo) {
        advancedInfoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            advancedInfo.classList.toggle('hidden');
        });
    }

    // App version tag in settings (keep in sync with sw.js CACHE_NAME)
    const APP_VERSION = 'v193';
    const appVersionEl = document.getElementById('app-version');
    if (appVersionEl) appVersionEl.textContent = APP_VERSION;

    // API key setup info toggle
    const apiKeyInfoBtn = document.getElementById('api-key-info-btn');
    const apiKeyInfo = document.getElementById('api-key-info');
    if (apiKeyInfoBtn && apiKeyInfo) {
        apiKeyInfoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            apiKeyInfo.classList.toggle('hidden');
        });
    }

    // AI (Gemini) key setup info toggle
    const aiKeyInput = document.getElementById('ai-key-input');
    const aiKeyInfoBtn = document.getElementById('ai-key-info-btn');
    const aiKeyInfo = document.getElementById('ai-key-info');
    if (aiKeyInfoBtn && aiKeyInfo) {
        aiKeyInfoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            aiKeyInfo.classList.toggle('hidden');
        });
    }

    function openSettings() {
        apiKeyInput.value = apiKey;
        if (aiKeyInput) aiKeyInput.value = aiKey;
        document.getElementById('dark-mode-toggle').checked = darkMode;
        document.getElementById('advanced-ui-toggle').checked = advancedUI;
        if (advancedInfo) advancedInfo.classList.add('hidden');
        if (apiKeyInfo) apiKeyInfo.classList.add('hidden');
        if (aiKeyInfo) aiKeyInfo.classList.add('hidden');
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

        // Save AI (Gemini) key — optional, may be blank
        aiKey = aiKeyInput ? aiKeyInput.value.trim() : '';
        localStorage.setItem('geminiApiKey', aiKey);
        updateAiButtonVisibility();

        // Save dark mode setting
        darkMode = document.getElementById('dark-mode-toggle').checked;
        localStorage.setItem('darkMode', darkMode.toString());
        applyTheme();

        // Save advanced UI setting
        advancedUI = document.getElementById('advanced-ui-toggle').checked;
        localStorage.setItem('advancedUI', advancedUI.toString());
        applyAdvancedUI();

        closeSettings();
        loadGoogleMaps();
    }

    function applyTheme() {
        if (darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        // Update Google Maps style if map exists
        if (map) {
            map.setOptions({
                styles: darkMode ? [
                    { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
                    { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
                    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
                    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
                    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#255763' }] },
                    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
                    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
                    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
                ] : [],
            });
        }
    }

    function applyAdvancedUI() {
        // Set/remove data attribute for CSS
        if (advancedUI) {
            document.documentElement.setAttribute('data-advanced-ui', 'true');
        } else {
            document.documentElement.removeAttribute('data-advanced-ui');
        }
        // Show/hide the stop number cycling (handled in click handler)
        // Reset stop types if advanced UI is turned off
        if (!advancedUI) {
            stops.forEach(s => { s.type = 'none'; });
            stopsContainer.querySelectorAll('.stop-number').forEach(el => {
                el.classList.remove('stop-num-bus', 'stop-num-res');
            });
            stopsContainer.querySelectorAll('.input-row').forEach(el => {
                el.classList.remove('row-default', 'row-bus', 'row-res');
            });
        } else {
            // Add row-default to any rows that don't already have a type class
            stopsContainer.querySelectorAll('.input-row').forEach(el => {
                if (!el.classList.contains('row-bus') && !el.classList.contains('row-res')) {
                    el.classList.add('row-default');
                }
            });
        }
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
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&callback=initMap`;
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
            styles: darkMode ? [
                { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
                { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
                { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
                { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
                { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#255763' }] },
                { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
                { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
                { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
            ] : [],
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
        // Only drag from the drag handle
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

    // ===== SWIPE TO DELETE (left) & RUSH (right) — Advanced UI =====
    let swipeState = null;

    function initSwipeDelete(container) {
        container.addEventListener('touchstart', (e) => {
            if (!advancedUI) return;
            if (dragReady || dragState) return; // Don't interfere with drag-to-reorder
            if (e.target.closest('.pin-btn') || e.target.closest('.stop-number')) return;

            const row = e.target.closest('.input-row');
            if (!row) return;

            const touch = e.touches[0];
            swipeState = {
                row: row,
                startX: touch.clientX,
                startY: touch.clientY,
                currentX: 0,
                swiping: false,
                direction: null, // 'left' or 'right'
            };
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!swipeState) return;
            if (dragReady || dragState) { swipeState = null; return; }

            const touch = e.touches[0];
            const dx = touch.clientX - swipeState.startX;
            const dy = touch.clientY - swipeState.startY;

            // If vertical movement is greater, it's a scroll — cancel swipe
            if (!swipeState.swiping && Math.abs(dy) > Math.abs(dx)) {
                swipeState = null;
                return;
            }

            // Swipe left (delete)
            if (dx < -10) {
                swipeState.swiping = true;
                swipeState.direction = 'left';
                e.preventDefault();
                swipeState.currentX = Math.max(dx, -120);
                swipeState.row.style.transform = `translateX(${swipeState.currentX}px)`;
                swipeState.row.style.transition = 'none';

                // Remove any rush bg
                let rushBg = swipeState.row.nextElementSibling;
                if (rushBg && rushBg.classList.contains('swipe-rush-bg')) rushBg.remove();

                // Show delete background
                let bg = swipeState.row.previousElementSibling;
                if (!bg || !bg.classList.contains('swipe-delete-bg')) {
                    bg = document.createElement('div');
                    bg.className = 'swipe-delete-bg';
                    bg.textContent = 'Delete';
                    swipeState.row.parentElement.insertBefore(bg, swipeState.row);
                }
                bg.style.height = swipeState.row.offsetHeight + 'px';
                bg.style.top = swipeState.row.offsetTop + 'px';
            }

            // Swipe right (bus/res selector)
            if (dx > 10) {
                swipeState.swiping = true;
                swipeState.direction = 'right';
                e.preventDefault();
                swipeState.currentX = Math.min(dx, 120);
                swipeState.row.style.transform = `translateX(${swipeState.currentX}px)`;
                swipeState.row.style.transition = 'none';

                // Remove any delete bg
                let delBg = swipeState.row.previousElementSibling;
                if (delBg && delBg.classList.contains('swipe-delete-bg')) delBg.remove();

                // Show bus/res selector background
                let bg = swipeState.row.nextElementSibling;
                if (!bg || !bg.classList.contains('swipe-type-bg')) {
                    bg = document.createElement('div');
                    bg.className = 'swipe-type-bg';
                    bg.innerHTML = '<button class="swipe-type-btn swipe-bus-btn">Bus</button><button class="swipe-type-btn swipe-res-btn">Res</button>';
                    swipeState.row.parentElement.insertBefore(bg, swipeState.row.nextSibling);
                }
                bg.style.height = swipeState.row.offsetHeight + 'px';
                bg.style.top = swipeState.row.offsetTop + 'px';
            }
        }, { passive: false });

        container.addEventListener('touchend', () => {
            if (!swipeState) return;
            const { row, currentX, swiping, direction } = swipeState;
            swipeState = null;

            if (!swiping) return;

            if (direction === 'left' && currentX < -80) {
                // Delete
                row.style.transition = 'transform 0.2s ease';
                row.style.transform = 'translateX(-100%)';
                setTimeout(() => {
                    const bg = row.previousElementSibling;
                    if (bg && bg.classList.contains('swipe-delete-bg')) bg.remove();

                    const id = Number(row.dataset.id);
                    if (id) {
                        removeStop(id);
                    } else if (row.querySelector('#start-input')) {
                        startInput.value = '';
                        updateOptimizeButton();
                    } else if (row.querySelector('#end-input')) {
                        endInput.value = '';
                        updateOptimizeButton();
                    }
                    row.style.transform = '';
                    row.style.transition = '';
                }, 200);
            } else if (direction === 'right' && currentX > 80) {
                // Hold row open — show bus/res selector, wait for tap
                row.style.transition = 'transform 0.2s ease';
                row.style.transform = 'translateX(120px)';

                const bg = row.nextElementSibling;
                if (bg && bg.classList.contains('swipe-type-bg')) {
                    const id = Number(row.dataset.id);
                    const stop = stops.find(s => s.id === id);

                    const closePanel = (newType) => {
                        if (stop && newType !== undefined) {
                            stop.type = newType;
                            // Update circle color
                            const numEl = row.querySelector('.stop-number');
                            if (numEl) {
                                numEl.classList.remove('stop-num-bus', 'stop-num-res');
                                if (newType === 'bus') numEl.classList.add('stop-num-bus');
                                else if (newType === 'res') numEl.classList.add('stop-num-res');
                            }
                            // Update row border
                            row.classList.remove('row-default', 'row-bus', 'row-res');
                            if (newType === 'bus') row.classList.add('row-bus');
                            else if (newType === 'res') row.classList.add('row-res');
                            else row.classList.add('row-default');
                        }
                        // Snap back
                        row.style.transition = 'transform 0.2s ease';
                        row.style.transform = 'translateX(0)';
                        setTimeout(() => {
                            row.style.transform = '';
                            row.style.transition = '';
                            if (bg) bg.remove();
                        }, 200);
                    };

                    bg.querySelector('.swipe-bus-btn').onclick = () => closePanel(stop.type === 'bus' ? 'none' : 'bus');
                    bg.querySelector('.swipe-res-btn').onclick = () => closePanel(stop.type === 'res' ? 'none' : 'res');
                }
            } else {
                // Snap back
                row.style.transition = 'transform 0.2s ease';
                row.style.transform = 'translateX(0)';
                setTimeout(() => {
                    row.style.transform = '';
                    row.style.transition = '';
                    const bg = row.previousElementSibling;
                    if (bg && bg.classList.contains('swipe-delete-bg')) bg.remove();
                    const typeBg = row.nextElementSibling;
                    if (typeBg && typeBg.classList.contains('swipe-type-bg')) typeBg.remove();
                }, 200);
            }
        });
    }

    // Init swipe on stops container
    initSwipeDelete(stopsContainer);

    // Init swipe on start/end location containers
    initSwipeDelete(document.querySelector('.start-location'));
    initSwipeDelete(document.querySelector('.end-location'));

    // ===== SWIPE TO DELETE CARDS (Advanced UI) =====
    function initCardSwipeDelete(container, onDelete) {
        let cardSwipeState = null;

        container.addEventListener('touchstart', (e) => {
            if (!advancedUI) return;
            const card = e.target.closest('.saved-route-card, .history-card');
            if (!card) return;
            if (e.target.closest('.btn-load')) return;

            const touch = e.touches[0];
            cardSwipeState = {
                card: card,
                startX: touch.clientX,
                startY: touch.clientY,
                currentX: 0,
                swiping: false,
            };
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!cardSwipeState) return;

            const touch = e.touches[0];
            const dx = touch.clientX - cardSwipeState.startX;
            const dy = touch.clientY - cardSwipeState.startY;

            if (!cardSwipeState.swiping && Math.abs(dy) > Math.abs(dx)) {
                cardSwipeState = null;
                return;
            }

            if (dx < -10) {
                cardSwipeState.swiping = true;
                e.preventDefault();
                cardSwipeState.currentX = Math.max(dx, -120);
                cardSwipeState.card.style.transform = `translateX(${cardSwipeState.currentX}px)`;
                cardSwipeState.card.style.transition = 'none';

                let bg = cardSwipeState.card.previousElementSibling;
                if (!bg || !bg.classList.contains('swipe-delete-bg')) {
                    bg = document.createElement('div');
                    bg.className = 'swipe-delete-bg';
                    bg.textContent = 'Delete';
                    cardSwipeState.card.parentElement.insertBefore(bg, cardSwipeState.card);
                }
                bg.style.height = cardSwipeState.card.offsetHeight + 'px';
                bg.style.top = cardSwipeState.card.offsetTop + 'px';
            }
        }, { passive: false });

        container.addEventListener('touchend', () => {
            if (!cardSwipeState) return;
            const { card, currentX, swiping } = cardSwipeState;
            cardSwipeState = null;

            if (!swiping) return;

            if (currentX < -80) {
                card.style.transition = 'transform 0.2s ease';
                card.style.transform = 'translateX(-100%)';
                setTimeout(() => {
                    const bg = card.previousElementSibling;
                    if (bg && bg.classList.contains('swipe-delete-bg')) bg.remove();
                    onDelete(card);
                    card.remove();
                }, 200);
            } else {
                card.style.transition = 'transform 0.2s ease';
                card.style.transform = 'translateX(0)';
                setTimeout(() => {
                    card.style.transform = '';
                    card.style.transition = '';
                    const bg = card.previousElementSibling;
                    if (bg && bg.classList.contains('swipe-delete-bg')) bg.remove();
                }, 200);
            }
        });
    }

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

        // Pre-sort: reorder unpinned stops so businesses come before residences
        // Pinned stops stay in their exact positions
        const sortedFilledStops = [];
        const unpinnedBus = filledStops.filter(s => !s.pinned && s.type === 'bus');
        const unpinnedRes = filledStops.filter(s => !s.pinned && s.type === 'res');
        const unpinnedNone = filledStops.filter(s => !s.pinned && s.type === 'none');
        const unpinnedSorted = [...unpinnedBus, ...unpinnedNone, ...unpinnedRes];

        let unpinnedIdx = 0;
        for (let i = 0; i < filledStops.length; i++) {
            if (filledStops[i].pinned) {
                sortedFilledStops.push(filledStops[i]);
            } else {
                sortedFilledStops.push(unpinnedSorted[unpinnedIdx++]);
            }
        }

        // Use sortedFilledStops for optimization
        const stopsForOptimize = sortedFilledStops;

        // If more than 23 waypoints, use batched optimization
        const MAX_WAYPOINTS = 23;
        if (stopsForOptimize.length > MAX_WAYPOINTS) {
            batchedOptimize(origin, destination, stopsForOptimize);
            return;
        }

        if (destination === null) {
            // No end mode: use last waypoint as destination, optimize the rest
            if (stopsForOptimize.length === 1) {
                runDirections(origin, stopsForOptimize[0].address.trim(), [], false);
            } else {
                // Last stop in sorted order becomes destination
                const dest = stopsForOptimize[stopsForOptimize.length - 1].address.trim();
                const stopsWithoutDest = stopsForOptimize.slice(0, -1);
                const waypoints = stopsWithoutDest.map(s => s.address.trim());

                if (pinnedStops.length === 0) {
                    // Optimize bus stops and res stops separately to keep bus first
                    const hasMixedTypes = unpinnedBus.length > 0 && (unpinnedRes.length > 0 || unpinnedNone.length > 0);
                    if (hasMixedTypes) {
                        optimizeWithPinnedStops(origin, dest, stopsWithoutDest);
                    } else {
                        runDirections(origin, dest, waypoints, true);
                    }
                } else {
                    optimizeWithPinnedStops(origin, dest, stopsWithoutDest);
                }
            }
        } else {
            // Have a fixed destination (round-trip or address)
            if (pinnedStops.length === 0) {
                const hasMixedTypes = unpinnedBus.length > 0 && (unpinnedRes.length > 0 || unpinnedNone.length > 0);
                if (hasMixedTypes) {
                    optimizeWithPinnedStops(origin, destination, stopsForOptimize);
                } else {
                    runDirections(origin, destination, stopsForOptimize.map(s => s.address.trim()), true);
                }
            } else {
                optimizeWithPinnedStops(origin, destination, stopsForOptimize);
            }
        }
    }

    // ===== TRUE OPTIMIZATION: Distance Matrix + Nearest-Neighbor + 2-opt =====

    // Geocode cache to avoid re-geocoding the same address
    const _geoCache = {};

    // Geocode an address to {lat, lng} using the Geocoding API (already enabled).
    // Includes retry on OVER_QUERY_LIMIT with exponential backoff.
    async function geocodeAddress(addr) {
        const key = addr.trim().toLowerCase();
        if (_geoCache[key]) return _geoCache[key];

        const geocoder = new google.maps.Geocoder();
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            const { coords, status } = await new Promise((resolve) => {
                geocoder.geocode({ address: addr }, (results, s) => {
                    if (s === 'OK' && results[0]) {
                        resolve({
                            coords: {
                                lat: results[0].geometry.location.lat(),
                                lng: results[0].geometry.location.lng(),
                            },
                            status: s,
                        });
                    } else {
                        resolve({ coords: null, status: s });
                    }
                });
            });

            if (coords) {
                _geoCache[key] = coords;
                return coords;
            }

            if (status === 'OVER_QUERY_LIMIT') {
                attempts++;
                // Wait before retrying (200ms, 400ms, 800ms)
                await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempts)));
            } else {
                // Non-rate-limit error — don't retry
                return null;
            }
        }
        return null;
    }

    // Haversine distance (in meters) between two lat/lng points.
    function haversine(a, b) {
        if (!a || !b) return Infinity;
        const R = 6371000; // Earth radius in meters
        const toRad = d => d * Math.PI / 180;
        const dLat = toRad(b.lat - a.lat);
        const dLng = toRad(b.lng - a.lng);
        const lat1 = toRad(a.lat);
        const lat2 = toRad(b.lat);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    // Build a distance matrix from straight-line (haversine) distances between points.
    // Uses only the Geocoding API (already enabled) — no Distance Matrix API needed.
    // points is an array of address strings. Returns a 2D array of distances in meters.
    // Geocodes sequentially with a small delay to avoid Geocoding API rate limits.
    async function getDistanceMatrix(points) {
        const n = points.length;
        // Geocode all points (cached, sequential to avoid QPS limits)
        const coords = [];
        for (let i = 0; i < n; i++) {
            const c = await geocodeAddress(points[i]);
            coords.push(c);
            // Small delay only for uncached geocodes — but since geocodeAddress
            // resolves instantly from cache, the delay only matters for new lookups.
        }

        // If any geocode failed, return null so callers can fall back.
        if (coords.some(c => c === null)) {
            console.warn('Geocode failed for one or more addresses — using fallback optimization.');
            return null;
        }

        const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) { matrix[i][j] = 0; continue; }
                matrix[i][j] = haversine(coords[i], coords[j]);
            }
        }
        return matrix;
    }

    // Nearest-neighbor construction: build a route from fixed start index through
    // all waypoint indices to fixed end index, using the distance matrix.
    // startIdx and endIdx are indices into the matrix; waypointIndices are the stops to order.
    function nearestNeighborRoute(matrix, startIdx, waypointIndices, endIdx) {
        const route = [];
        const remaining = [...waypointIndices];
        let current = startIdx;

        while (remaining.length > 0) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const d = matrix[current][remaining[i]];
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }
            const next = remaining.splice(bestIdx, 1)[0];
            route.push(next);
            current = next;
        }
        return route;
    }

    // Total cost of a route: start → route[0] → route[1] → ... → end
    function routeCost(matrix, startIdx, route, endIdx) {
        let cost = 0;
        let prev = startIdx;
        for (const idx of route) {
            cost += matrix[prev][idx];
            prev = idx;
        }
        cost += matrix[prev][endIdx];
        return cost;
    }

    // 2-opt improvement: repeatedly reverse segments if it shortens the total route.
    // This removes crossings and local inefficiencies (e.g. 10->11->12 vs 10->12->11).
    function twoOptImprove(matrix, startIdx, route, endIdx) {
        let best = route.slice();
        let improved = true;
        let iterations = 0;
        const maxIterations = 50; // safety cap

        while (improved && iterations < maxIterations) {
            improved = false;
            iterations++;
            for (let i = 0; i < best.length - 1; i++) {
                for (let j = i + 1; j < best.length; j++) {
                    // Reverse segment between i and j
                    const candidate = best.slice(0, i).concat(
                        best.slice(i, j + 1).reverse(),
                        best.slice(j + 1)
                    );
                    if (routeCost(matrix, startIdx, candidate, endIdx) < routeCost(matrix, startIdx, best, endIdx) - 0.5) {
                        best = candidate;
                        improved = true;
                    }
                }
            }
        }
        return best;
    }

    // Optimize a group of stops (addresses) between a fixed origin and destination.
    // Returns a promise resolving to the optimally ordered address array.
    async function optimizeGroup(originAddr, stopAddresses, destAddr) {
        if (stopAddresses.length <= 1) return stopAddresses.slice();

        // Build points: [origin, ...stops, destination]
        const points = [originAddr, ...stopAddresses, destAddr];
        const matrix = await getDistanceMatrix(points);

        // If geocoding failed, return original order (better than garbage)
        if (!matrix) return stopAddresses.slice();

        const startIdx = 0;
        const endIdx = points.length - 1;
        const waypointIndices = stopAddresses.map((_, i) => i + 1); // indices 1..n

        // Build initial route with nearest-neighbor, then improve with 2-opt
        let route = nearestNeighborRoute(matrix, startIdx, waypointIndices, endIdx);
        route = twoOptImprove(matrix, startIdx, route, endIdx);

        // Map indices back to addresses
        return route.map(idx => points[idx]);
    }

    function optimizeWithPinnedStops(origin, destination, filledStops) {
        // Strategy: For mixed bus/res types without pins, let Google optimize ALL stops together
        // for the best overall route, then reorder the result so businesses come first.
        // For pinned stops, split at pin boundaries and optimize each segment.

        const hasPins = filledStops.some(s => s.pinned);

        // If there are pinned stops, use segment-based approach
        if (hasPins) {
            optimizeWithSegments(origin, destination, filledStops);
            return;
        }

        // No pins: use true optimization (Distance Matrix + 2-opt) per type group
        runTrueOptimization(origin, destination, filledStops);
    }

    // Optimize a group with Google's real driving-time optimizer (optimizeWaypoints:true).
    // Returns the group's stop addresses in optimal driving order between origin→dest.
    // This uses actual road/traffic distances (Directions API) — far better than
    // straight-line haversine for real geography (freeways, hills, one-way roads).
    async function optimizeGroupGoogle(originAddr, stopAddresses, destAddr) {
        if (stopAddresses.length === 0) return [];
        if (stopAddresses.length === 1) return stopAddresses.slice();

        // Google's optimizeWaypoints caps at 23 waypoints per request. For larger
        // groups, fall back to the haversine matrix optimizer.
        if (stopAddresses.length > 23) {
            return await optimizeGroup(originAddr, stopAddresses, destAddr);
        }

        const directionsService = new google.maps.DirectionsService();
        const result = await new Promise((resolve) => {
            directionsService.route({
                origin: originAddr,
                destination: destAddr,
                waypoints: stopAddresses.map(addr => ({ location: addr, stopover: true })),
                optimizeWaypoints: true,
                travelMode: google.maps.TravelMode.DRIVING,
            }, (res, status) => {
                resolve(status === google.maps.DirectionsStatus.OK ? res : null);
            });
        });

        if (!result) return stopAddresses.slice(); // fallback: original order
        const order = result.routes[0].waypoint_order;
        return order.map(i => stopAddresses[i]);
    }

    // Shortest OPEN tour from a start through all stops with no fixed end.
    // Uses haversine + nearest-neighbor + 2-opt (which naturally handles open tours)
    // to decide the order and endpoint, then re-optimizes with Google's real
    // driving-time optimizer using that endpoint fixed — so the ordering reflects
    // actual roads, not straight-line distance.
    async function optimizeOpenTour(startAddr, stopAddresses) {
        if (stopAddresses.length === 0) return [];
        if (stopAddresses.length === 1) return stopAddresses.slice();

        // Step 1: pick an endpoint + rough order using an open-tour heuristic on
        // real geography (geocode + haversine NN/2-opt with no closing leg).
        const points = [startAddr, ...stopAddresses];
        const coords = [];
        for (const p of points) coords.push(await geocodeAddress(p));

        let endpointAddr = null;
        if (!coords.some(c => c === null)) {
            const n = points.length;
            const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++)
                    matrix[i][j] = i === j ? 0 : haversine(coords[i], coords[j]);

            const waypointIndices = stopAddresses.map((_, i) => i + 1);
            // Open-tour cost: no return leg. Use a huge sentinel endIdx trick by
            // scoring only the path cost (start→...→last), not a closing leg.
            let route = nearestNeighborRoute(matrix, 0, waypointIndices, 0);
            route = twoOptImproveOpen(matrix, 0, route);
            endpointAddr = points[route[route.length - 1]];
        }

        // Step 2: if we found a good endpoint, let Google optimize the rest of the
        // stops between start and that endpoint using real driving distances.
        if (endpointAddr && stopAddresses.length >= 2) {
            const middle = stopAddresses.filter(a => a !== endpointAddr);
            const ordered = await optimizeGroupGoogle(startAddr, middle, endpointAddr);
            return [...ordered, endpointAddr];
        }

        // Fallback: no geocode — just let Google optimize toward the last stop.
        return await optimizeGroupGoogle(startAddr, stopAddresses.slice(0, -1), stopAddresses[stopAddresses.length - 1])
            .then(ord => [...ord, stopAddresses[stopAddresses.length - 1]]);
    }

    // Optimize businesses first, then residences, choosing the business endpoint
    // that minimizes the TOTAL combined route. Businesses always precede residences.
    //
    // Approach:
    //  1. Geocode everything; build a haversine helper.
    //  2. For each candidate business endpoint, estimate total cost using haversine:
    //       origin →(best business order ending at candidate)→ candidate
    //       + candidate → (best residence order) → destination
    //     Estimate each leg with an open/closed nearest-neighbor + 2-opt on haversine.
    //  3. Pick the candidate business endpoint with the lowest estimated total.
    //  4. Do the REAL Google driving optimization for both legs using that endpoint.
    async function optimizeBusThenRes(origin, busAddresses, otherAddresses, destination) {
        // Geocode all points
        const originCoord = await geocodeAddress(origin);
        const busCoords = [];
        for (const a of busAddresses) busCoords.push(await geocodeAddress(a));
        const resCoords = [];
        for (const a of otherAddresses) resCoords.push(await geocodeAddress(a));
        const destCoord = destination ? await geocodeAddress(destination) : null;

        const geocodeOk = originCoord && !busCoords.some(c => !c) && !resCoords.some(c => !c) && (!destination || destCoord);

        // Helper: haversine open-tour cost from a start coord through a set of coords,
        // returning { cost, order } where order is indices into the coords array.
        const openTourCost = (startCoord, coords) => {
            if (coords.length === 0) return { cost: 0, order: [] };
            const n = coords.length;
            const remaining = coords.map((_, i) => i);
            const order = [];
            let cur = startCoord;
            let cost = 0;
            while (remaining.length) {
                let bi = 0, bd = Infinity;
                for (let i = 0; i < remaining.length; i++) {
                    const d = haversine(cur, coords[remaining[i]]);
                    if (d < bd) { bd = d; bi = i; }
                }
                const next = remaining.splice(bi, 1)[0];
                order.push(next);
                cost += bd;
                cur = coords[next];
            }
            return { cost, order };
        };

        // Helper: cost of a residence run from a start coord through all residences to destination.
        const resRunCost = (startCoord) => {
            const { cost, order } = openTourCost(startCoord, resCoords);
            let total = cost;
            if (destCoord && order.length) total += haversine(resCoords[order[order.length - 1]], destCoord);
            return total;
        };

        // Rank candidate business endpoints by a fast haversine estimate of the
        // TOTAL combined route (business leg ending at candidate + residence leg).
        let candidates = busAddresses.map((addr, e) => ({ addr, e, est: Infinity }));
        if (geocodeOk) {
            for (const cand of candidates) {
                const e = cand.e;
                const otherBusIdx = busCoords.map((_, i) => i).filter(i => i !== e);
                const otherBusCoords = otherBusIdx.map(i => busCoords[i]);
                const { cost: busCost, order } = openTourCost(originCoord, otherBusCoords);
                let busLeg = busCost;
                if (order.length) {
                    busLeg += haversine(otherBusCoords[order[order.length - 1]], busCoords[e]);
                } else {
                    busLeg += haversine(originCoord, busCoords[e]);
                }
                cand.est = busLeg + resRunCost(busCoords[e]);
            }
            candidates.sort((a, b) => a.est - b.est);
        }

        // Helper: build the real Google-ordered bus+res route for a given business
        // endpoint, and return { bus, res, seconds } using actual driving durations.
        const buildAndMeasure = async (busEndAddr) => {
            let bus;
            if (busEndAddr && busAddresses.length >= 2) {
                const middle = busAddresses.filter(a => a !== busEndAddr);
                const ord = await optimizeGroupGoogle(origin, middle, busEndAddr);
                bus = [...ord, busEndAddr];
            } else if (busAddresses.length >= 2) {
                bus = await optimizeOpenTour(origin, busAddresses);
            } else {
                bus = busAddresses.slice();
            }
            const rStart = bus[bus.length - 1];
            let res;
            if (destination) {
                res = await optimizeGroupGoogle(rStart, otherAddresses, destination);
            } else {
                res = await optimizeOpenTour(rStart, otherAddresses);
            }
            // Measure the real combined driving time for this ordering.
            const seconds = await measureRouteSeconds(origin, [...bus, ...res], destination);
            return { bus, res, seconds };
        };

        // Verify the top few candidates with REAL driving times and keep the best.
        // (Haversine ranking can be wrong; a few extra Directions calls fix that.)
        const TObeat = geocodeOk ? Math.min(3, candidates.length) : 1;
        let best = null;
        if (candidates.length === 0) {
            best = await buildAndMeasure(null);
        } else {
            for (let i = 0; i < TObeat; i++) {
                const trial = await buildAndMeasure(candidates[i].addr);
                if (!best || (trial.seconds != null && (best.seconds == null || trial.seconds < best.seconds))) {
                    best = trial;
                }
            }
        }

        return { bus: best.bus, res: best.res };
    }

    // Measure the real total driving time (seconds) for a fixed-order route.
    // Uses Directions with optimizeWaypoints:false so it reflects the exact order.
    // Handles the 23-waypoint limit by chunking and summing.
    async function measureRouteSeconds(origin, orderedStops, destination) {
        try {
            const directionsService = new google.maps.DirectionsService();
            const MAXW = 23;
            let total = 0;
            let legOrigin = origin;
            const stops = orderedStops.slice();
            const finalDest = destination || stops.pop();
            if (finalDest == null) return null;

            for (let i = 0; i < stops.length || i === 0; i += MAXW) {
                const chunk = stops.slice(i, i + MAXW);
                const isLast = i + MAXW >= stops.length;
                const dest = isLast ? finalDest : chunk[chunk.length - 1];
                const wps = isLast ? chunk : chunk.slice(0, -1);
                const res = await new Promise((resolve) => {
                    directionsService.route({
                        origin: legOrigin,
                        destination: dest,
                        waypoints: wps.map(a => ({ location: a, stopover: true })),
                        optimizeWaypoints: false,
                        travelMode: google.maps.TravelMode.DRIVING,
                    }, (r, s) => resolve(s === google.maps.DirectionsStatus.OK ? r : null));
                });
                if (!res) return null;
                res.routes[0].legs.forEach(l => { total += l.duration.value; });
                legOrigin = dest;
                if (isLast) break;
            }
            return total;
        } catch (e) {
            return null;
        }
    }

    // 2-opt for an OPEN tour (no closing leg back to an end index).
    function twoOptImproveOpen(matrix, startIdx, route) {
        const openCost = (r) => {
            let cost = 0, prev = startIdx;
            for (const idx of r) { cost += matrix[prev][idx]; prev = idx; }
            return cost;
        };
        let best = route.slice();
        let improved = true, iterations = 0;
        const maxIterations = 50;
        while (improved && iterations < maxIterations) {
            improved = false;
            iterations++;
            for (let i = 0; i < best.length - 1; i++) {
                for (let j = i + 1; j < best.length; j++) {
                    const candidate = best.slice(0, i).concat(
                        best.slice(i, j + 1).reverse(),
                        best.slice(j + 1)
                    );
                    if (openCost(candidate) < openCost(best) - 0.5) {
                        best = candidate;
                        improved = true;
                    }
                }
            }
        }
        return best;
    }

    // True optimization using Google's real driving-time optimizer, per type group.
    // Businesses optimized first (origin → businesses), then residences
    // (last business → residences → destination). Guarantees bus-before-res ordering
    // while using real road distances for the best in-group order.
    async function runTrueOptimization(origin, destination, filledStops) {
        try {
            const busStops = filledStops.filter(s => s.type === 'bus');
            const otherStops = filledStops.filter(s => s.type !== 'bus');
            const busAddresses = busStops.map(s => s.address.trim());
            const otherAddresses = otherStops.map(s => s.address.trim());

            let orderedBus = [];
            let orderedOther = [];

            // Businesses come first, residences second, but we choose the business
            // ENDPOINT so the *combined* route is shortest — not just the business
            // leg in isolation. Otherwise the business tour can end far from the
            // residences and force a long jump, wrecking the overall time.
            if (busAddresses.length > 0 && otherAddresses.length > 0) {
                const combo = await optimizeBusThenRes(origin, busAddresses, otherAddresses, destination);
                orderedBus = combo.bus;
                orderedOther = combo.res;
            } else if (busAddresses.length > 0) {
                // Only businesses
                orderedBus = destination
                    ? await optimizeGroupGoogle(origin, busAddresses, destination)
                    : await optimizeOpenTour(origin, busAddresses);
            } else if (otherAddresses.length > 0) {
                // Only residences
                orderedOther = destination
                    ? await optimizeGroupGoogle(origin, otherAddresses, destination)
                    : await optimizeOpenTour(origin, otherAddresses);
            }

            const finalWaypoints = [...orderedBus, ...orderedOther];

            // Get the actual route directions in this exact order
            const directionsService = new google.maps.DirectionsService();
            directionsService.route({
                origin: origin,
                destination: destination,
                waypoints: finalWaypoints.map(addr => ({ location: addr, stopover: true })),
                optimizeWaypoints: false,
                travelMode: google.maps.TravelMode.DRIVING,
                drivingOptions: {
                    departureTime: new Date(),
                    trafficModel: 'bestguess',
                },
            }, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    try { displayRoute(result, origin, finalWaypoints); } catch(e) { console.error(e); }
                } else { handleDirectionsError(status); }
                optimizeBtn.innerHTML = 'Optimize Route';
                optimizeBtn.disabled = false;
                updateOptimizeButton();
            });
        } catch (e) {
            console.error('True optimization error:', e);
            optimizeBtn.innerHTML = 'Optimize Route';
            optimizeBtn.disabled = false;
            updateOptimizeButton();
        }
    }

    // Pick the residence address that is geographically closest to the last business,
    // so the bus→res handoff doesn't jump across the map.
    async function pickClosestToGroup(busAddresses, otherAddresses, origin) {
        if (otherAddresses.length <= 1) return otherAddresses[0];
        // Geocode the last bus address and all residences, pick the nearest one.
        const lastBusCoord = await geocodeAddress(busAddresses[busAddresses.length - 1]);
        if (!lastBusCoord) return otherAddresses[0]; // fallback

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < otherAddresses.length; i++) {
            const c = await geocodeAddress(otherAddresses[i]);
            if (!c) continue;
            const d = haversine(lastBusCoord, c);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        return otherAddresses[bestIdx];
    }

    function optimizeWithSegments(origin, destination, filledStops) {
        // Segment-based approach for routes with pinned stops

        const allAddresses = filledStops.map(s => s.address.trim());
        const unpinnedIndices = filledStops.reduce((acc, s, i) => {
            if (!s.pinned) acc.push(i);
            return acc;
        }, []);

        if (unpinnedIndices.length === 0) {
            // All stops are pinned — just route in order, no optimization
            runDirections(origin, destination, allAddresses, false);
            return;
        }

        // Build segments: split at pinned stops and at type boundaries
        const segments = [];
        let segStart = origin;
        let currentUnpinned = [];
        let currentType = null;

        for (let i = 0; i < filledStops.length; i++) {
            const stop = filledStops[i];

            if (stop.pinned) {
                // End current segment at this pinned stop
                if (currentUnpinned.length > 0) {
                    segments.push({
                        origin: segStart,
                        destination: stop.address.trim(),
                        waypoints: currentUnpinned.slice(),
                        optimize: true,
                    });
                    currentUnpinned = [];
                } else {
                    segments.push({
                        origin: segStart,
                        destination: stop.address.trim(),
                        waypoints: [],
                        optimize: false,
                    });
                }
                segStart = stop.address.trim();
                currentType = null;
            } else {
                // Check for type boundary (bus -> non-bus or non-bus -> bus)
                const stopType = stop.type || 'none';
                const effectiveType = stopType === 'bus' ? 'bus' : 'other';

                if (currentType !== null && effectiveType !== currentType && currentUnpinned.length > 0) {
                    // Type boundary — end the current segment
                    // Use last waypoint as destination so Google optimizes freely within the group
                    const lastWaypoint = currentUnpinned.pop();
                    segments.push({
                        origin: segStart,
                        destination: lastWaypoint,
                        waypoints: currentUnpinned.slice(),
                        optimize: true,
                    });
                    segStart = lastWaypoint;
                    currentUnpinned = [stop.address.trim()];
                } else {
                    currentUnpinned.push(stop.address.trim());
                }
                currentType = effectiveType;
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

    // ===== BATCHED OPTIMIZATION (25+ stops) =====
    async function batchedOptimize(origin, destination, stopsForOptimize) {
        const MAX_WAYPOINTS = 23;

        try {
            // Step 1: Separate stops by pin status and type
            const pinnedStops = stopsForOptimize.filter(s => s.pinned);
            const busStops = stopsForOptimize.filter(s => !s.pinned && s.type === 'bus');
            const otherStops = stopsForOptimize.filter(s => !s.pinned && s.type !== 'bus');

            const busAddresses = busStops.map(s => s.address.trim());
            const otherAddresses = otherStops.map(s => s.address.trim());

            // Step 2: Optimize using the combined bus+res logic (same as small routes):
            // choose the business endpoint that minimizes the TOTAL bus+res route,
            // so the business leg ends where it best sets up the residence leg.
            let orderedBus = [];
            let orderedOther = [];

            if (busAddresses.length > 0 && otherAddresses.length > 0) {
                const combo = await optimizeBusThenRes(origin, busAddresses, otherAddresses, destination);
                orderedBus = combo.bus;
                orderedOther = combo.res;
            } else if (busAddresses.length > 0) {
                orderedBus = destination
                    ? await optimizeGroupGoogle(origin, busAddresses, destination)
                    : await optimizeOpenTour(origin, busAddresses);
            } else if (otherAddresses.length > 0) {
                orderedOther = destination
                    ? await optimizeGroupGoogle(origin, otherAddresses, destination)
                    : await optimizeOpenTour(origin, otherAddresses);
            }

            // Combined optimized order (addresses)
            let orderedAddresses = [...orderedBus, ...orderedOther];

            // Map ordered addresses back to stop objects (for markers/colors)
            const orderedStopObjs = orderedAddresses.map(addr => {
                const match = stopsForOptimize.find(s => s.address.trim() === addr);
                return { stop: match || { address: addr, type: 'none', rush: false } };
            });

            // Handle pinned stops: keep at their absolute user positions
            let finalStopObjs = orderedStopObjs;
            if (pinnedStops.length > 0) {
                finalStopObjs = new Array(stopsForOptimize.length).fill(null);
                stopsForOptimize.forEach((s, i) => {
                    if (s.pinned) finalStopObjs[i] = { stop: s };
                });
                let oi = 0;
                for (let i = 0; i < finalStopObjs.length; i++) {
                    if (finalStopObjs[i] === null) finalStopObjs[i] = orderedStopObjs[oi++];
                }
            }

            const finalOrderedAddresses = finalStopObjs.map(o => o.stop.address.trim());

            // Step 3: Split into batches (order is already optimal — no re-optimization)
            const directionsService = new google.maps.DirectionsService();
            const batchResults = [];
            let batchOrigin = origin;

            // Determine the final destination (No End mode = last stop)
            let workingAddresses = finalOrderedAddresses.slice();
            let finalDest = destination;
            if (!destination) {
                finalDest = workingAddresses.pop(); // last stop is destination
            }

            const batches = [];
            for (let i = 0; i < workingAddresses.length; i += MAX_WAYPOINTS) {
                batches.push(workingAddresses.slice(i, i + MAX_WAYPOINTS));
            }

            for (let b = 0; b < batches.length; b++) {
                const batch = batches[b];
                const isLastBatch = b === batches.length - 1;

                let batchDest;
                let waypoints;
                if (isLastBatch) {
                    batchDest = finalDest;
                    waypoints = batch;
                } else {
                    // Bridge to next batch: last stop of this batch becomes its destination
                    batchDest = batch[batch.length - 1];
                    waypoints = batch.slice(0, -1);
                }

                const result = await new Promise((resolve) => {
                    directionsService.route({
                        origin: batchOrigin,
                        destination: batchDest,
                        waypoints: waypoints.map(addr => ({ location: addr, stopover: true })),
                        optimizeWaypoints: false, // order already optimal
                        travelMode: google.maps.TravelMode.DRIVING,
                        drivingOptions: {
                            departureTime: new Date(),
                            trafficModel: 'bestguess',
                        },
                    }, (res, status) => {
                        if (status === google.maps.DirectionsStatus.OK) resolve(res);
                        else { console.error('Batch', b + 1, 'failed:', status); resolve(null); }
                    });
                });

                if (result) {
                    batchResults.push({ result, batchOrigin, batchDest });
                }
                batchOrigin = batchDest;
            }

            // Step 4: Display
            if (batchResults.length > 0) {
                displayBatchedRoute(batchResults, origin, finalStopObjs);
            } else {
                alert('Route optimization failed. Please try fewer stops.');
            }
        } catch (e) {
            console.error('Batched optimize error:', e);
            alert('Route optimization failed. Please try again.');
        }

        optimizeBtn.innerHTML = 'Optimize Route';
        optimizeBtn.disabled = false;
        updateOptimizeButton();
    }

    // Display batched route results
    function displayBatchedRoute(batchResults, origin, finalOrder) {
        mapContainer.classList.add('active');

        // Clear old markers and polylines
        if (window._routeMarkers) {
            window._routeMarkers.forEach(m => m.marker.setMap(null));
        }
        window._routeMarkers = [];
        if (window._routePolylines) {
            window._routePolylines.forEach(p => p.polyline.setMap(null));
        }
        window._routePolylines = [];
        if (directionsRenderer) {
            directionsRenderer.setDirections({ routes: [] });
        }

        // Combine all legs from all batches (traffic-aware when available)
        let allLegs = [];
        let totalDistance = 0;
        let totalDuration = 0;
        let anyTraffic = false;

        batchResults.forEach((batch, bIdx) => {
            const route = batch.result.routes[0];
            route.legs.forEach((leg, i) => {
                allLegs.push({ leg, batchIdx: bIdx });
                totalDistance += leg.distance.value;
                totalDuration += legDurationSecs(leg);
                if (legHasTraffic(leg)) anyTraffic = true;
            });
        });

        // Reorder the stops list to match the optimized route order
        const optimizedAddresses = allLegs.slice(0, -1).map(item => item.leg.end_address);
        if (optimizedAddresses.length > 0) {
            const hasNoEnd = endMode === 'none';
            reorderStopsToMatch(optimizedAddresses, hasNoEnd);
        }
        if (allLegs.length > 0) {
            startInput.value = allLegs[0].leg.start_address;
        }
        if (endMode === 'none' && allLegs.length > 0) {
            const lastFilledStop = stops.filter(s => s.address.trim().length > 0).pop();
            if (lastFilledStop) {
                lastFilledStop.address = allLegs[allLegs.length - 1].leg.end_address;
                const lastInput = stopsContainer.querySelector(`[data-id="${lastFilledStop.id}"] .stop-input`);
                if (lastInput) lastInput.value = lastFilledStop.address;
            }
        }
        if (endMode === 'address') {
            endInput.value = allLegs[allLegs.length - 1].leg.end_address;
        }

        // Draw polylines for each batch with type colors
        const filledStopsAfterReorder = stops.filter(s => s.address.trim().length > 0);
        let polylineStopIdx = 0;
        batchResults.forEach((batch, bIdx) => {
            const route = batch.result.routes[0];
            route.legs.forEach((leg, i) => {
                const path = [];
                leg.steps.forEach(step => {
                    if (google.maps.geometry) {
                        google.maps.geometry.encoding.decodePath(step.polyline.points).forEach(p => path.push(p));
                    }
                });
                const polylinePath = path.length > 0 ? path : [leg.start_location, leg.end_location];

                // Determine color based on the stop this leg leads to
                let strokeColor = '#4285F4';
                let legType = 'none';
                if (polylineStopIdx < filledStopsAfterReorder.length) {
                    const stop = filledStopsAfterReorder[polylineStopIdx];
                    if (stop) {
                        if (stop.type === 'bus') { strokeColor = '#ff8c00'; legType = 'bus'; }
                        else if (stop.type === 'res') { strokeColor = '#9c27b0'; legType = 'res'; }
                    }
                    polylineStopIdx++;
                }

                const polyline = new google.maps.Polyline({
                    path: polylinePath,
                    strokeColor: strokeColor,
                    strokeOpacity: 0.8,
                    strokeWeight: 5,
                    map: map,
                });
                window._routePolylines.push({ polyline, type: legType });
            });
        });

        // Add start marker
        const firstLeg = allLegs[0].leg;
        addCustomMarker(firstLeg.start_location, '📍', 'Start');

        // Add numbered markers for each stop with type/rush colors
        let stopNum = 1;
        allLegs.forEach((item, i) => {
            const isLast = i === allLegs.length - 1;
            const label = isLast ? '●' : String(stopNum);
            let color;
            let markerType = 'none';
            let isRush = false;

            if (isLast) {
                color = '#ea4335';
                markerType = 'end';
                // In No End mode, last stop is a user stop — check for rush/type
                if (endMode === 'none') {
                    const lastStop = filledStopsAfterReorder[filledStopsAfterReorder.length - 1];
                    if (lastStop) {
                        if (lastStop.rush) isRush = true;
                        if (lastStop.type === 'bus') { color = '#ff8c00'; markerType = 'bus'; }
                        else if (lastStop.type === 'res') { color = '#9c27b0'; markerType = 'res'; }
                    }
                }
            } else {
                // Match to reordered stops array
                const stop = filledStopsAfterReorder[i];
                if (stop) {
                    if (stop.type === 'bus') {
                        color = '#ff8c00';
                        markerType = 'bus';
                    } else if (stop.type === 'res') {
                        color = '#9c27b0';
                        markerType = 'res';
                    } else {
                        color = '#1a73e8';
                    }
                    isRush = !!stop.rush;
                } else {
                    color = '#1a73e8';
                }
            }
            addNumberedMarker(item.leg.end_location, label, color, item.leg.end_address, markerType, isRush);
            if (!isLast) stopNum++;
        });

        // Fit map to show all markers
        const bounds = new google.maps.LatLngBounds();
        allLegs.forEach(item => {
            bounds.extend(item.leg.start_location);
            bounds.extend(item.leg.end_location);
        });
        map.fitBounds(bounds);

        // Summary
        const distanceMiles = (totalDistance / 1609.34).toFixed(1);
        const hours = Math.floor(totalDuration / 3600);
        const minutes = Math.round((totalDuration % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const timeLabel = anyTraffic ? 'Time (with traffic)' : 'Total Time';

        // Breakdown (traffic-aware when available)
        const batchedLegValues = [];
        let breakdownHtml = '<div class="route-breakdown hidden">';
        breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label breakdown-start">Start</span> ${firstLeg.start_address}</div>`;
        let legNum = 1;
        allLegs.forEach((item, i) => {
            const isLast = i === allLegs.length - 1;
            batchedLegValues.push({ dist: item.leg.distance.value, dur: legDurationSecs(item.leg) });
            breakdownHtml += `<div class="breakdown-arrow">↓ ${item.leg.distance.text} · ${legDurationText(item.leg)}${legHasTraffic(item.leg) ? ' 🚦' : ''}</div>`;
            const label = isLast ? 'End' : `${legNum}`;
            let cls = isLast ? 'breakdown-end' : '';
            // Box color = type (bus/res); number color = gold if rush. Advanced UI only.
            if (!isLast && advancedUI) {
                const stop = filledStopsAfterReorder[i];
                if (stop && stop.type === 'bus') cls = 'breakdown-bus';
                else if (stop && stop.type === 'res') cls = 'breakdown-res';
                if (stop && stop.rush) cls += ' breakdown-rush';
            }
            breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label ${cls}">${label}</span> ${item.leg.end_address}</div>`;
            if (!isLast) legNum++;
        });
        breakdownHtml += '</div>';

        routeSummary.innerHTML = `
            <div class="summary-stats">
                <div class="stat">
                    <div class="stat-value">${timeStr}</div>
                    <div class="stat-label">${timeLabel}</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${distanceMiles} mi</div>
                    <div class="stat-label">Total Distance</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${allLegs.length}</div>
                    <div class="stat-label">Stops</div>
                </div>
            </div>
            <div class="summary-expand-hint">Tap for breakdown ▾</div>
            ${breakdownHtml}
        `;
        routeSummary.classList.remove('hidden');
        routeSummary.onclick = () => {
            const breakdown = routeSummary.querySelector('.route-breakdown');
            const hint = routeSummary.querySelector('.summary-expand-hint');
            if (breakdown) {
                breakdown.classList.toggle('hidden');
                hint.textContent = breakdown.classList.contains('hidden') ? 'Tap for breakdown ▾' : 'Tap to collapse ▴';
            }
        };
        initBreakdownSplit(routeSummary.querySelector('.route-breakdown'), batchedLegValues);

        // Multiple navigation links
        const navHtml = batchResults.map((batch, i) => {
            const r = batch.result.routes[0];
            const legs = r.legs;
            const bOrigin = legs[0].start_address;
            const bDest = legs[legs.length - 1].end_address;
            const bWaypoints = legs.slice(0, -1).map(l => l.end_address);
            let url = `https://www.google.com/maps/dir/?api=1`;
            url += `&origin=${encodeURIComponent(bOrigin)}`;
            url += `&destination=${encodeURIComponent(bDest)}`;
            if (bWaypoints.length > 0) {
                url += `&waypoints=${bWaypoints.map(w => encodeURIComponent(w)).join('|')}`;
            }
            url += `&travelmode=driving`;
            return `<button class="btn btn-navigate" onclick="window.open('${url}', '_blank')">Route ${i + 1} of ${batchResults.length} — Google Maps</button>`;
        }).join('');

        resultActions.innerHTML = navHtml + `<button id="save-route-btn" class="btn btn-save" onclick="window._saveCurrentRoute()">💾 Save Route</button>`;
        resultActions.classList.remove('hidden');

        if (mapFilterRow && advancedUI) mapFilterRow.classList.remove('hidden');

        // Save optimized route for single-route navigation fallback
        optimizedRoute = {
            origin: firstLeg.start_address,
            destination: allLegs[allLegs.length - 1].leg.end_address,
            waypoints: allLegs.slice(0, -1).map(item => item.leg.end_address),
        };

        // Capture structured context for the AI assistant
        setLastRouteContext(allLegs.map(item => item.leg), { totalDistance, totalDuration, anyTraffic });

        // Auto-save to history
        const filledStopsForHistory = stops.filter(s => s.address.trim().length > 0);
        saveToHistory({
            origin: firstLeg.start_address,
            destination: allLegs[allLegs.length - 1].leg.end_address,
            stops: filledStopsForHistory.map(s => ({ address: s.address, pinned: s.pinned, type: s.type, rush: !!s.rush })),
            totalTime: timeStr,
            totalDistance: distanceMiles + ' mi',
            timestamp: Date.now(),
            endMode: endMode,
        });

        if (!suppressScroll) {
            mapContainer.scrollIntoView({ behavior: 'smooth' });
        }
        suppressScroll = false;
    }

    function runDirections(origin, destination, waypoints, optimize) {
        const directionsService = new google.maps.DirectionsService();

        // Google's Directions service does NOT return duration_in_traffic when
        // optimizeWaypoints is true. So when we need Google to optimize the order,
        // we first request the optimal order WITHOUT traffic, then re-request once
        // with the order fixed (optimizeWaypoints:false) + drivingOptions, which
        // DOES return traffic-aware durations. When we're not optimizing, we can
        // ask for traffic directly in a single request.
        const finish = () => {
            optimizeBtn.innerHTML = 'Optimize Route';
            optimizeBtn.disabled = false;
            updateOptimizeButton();
        };

        // Helper: render a route in a FIXED order with traffic requested.
        const renderWithTraffic = (orderedWaypoints) => {
            directionsService.route({
                origin: origin,
                destination: destination,
                waypoints: orderedWaypoints.map(addr => ({ location: addr, stopover: true })),
                optimizeWaypoints: false,
                travelMode: google.maps.TravelMode.DRIVING,
                drivingOptions: { departureTime: new Date(), trafficModel: 'bestguess' },
            }, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    try { displayRoute(result, origin, orderedWaypoints); }
                    catch (e) { console.error('displayRoute error:', e); }
                } else {
                    handleDirectionsError(status);
                }
                finish();
            });
        };

        if (!optimize) {
            // No optimization needed — ask for traffic directly in one request.
            renderWithTraffic(waypoints);
            return;
        }

        // Step 1: get Google's optimal waypoint order (no traffic on this request).
        directionsService.route({
            origin: origin,
            destination: destination,
            waypoints: waypoints.map(addr => ({ location: addr, stopover: true })),
            optimizeWaypoints: true,
            travelMode: google.maps.TravelMode.DRIVING,
        }, (result, status) => {
            if (status !== google.maps.DirectionsStatus.OK) {
                handleDirectionsError(status);
                finish();
                return;
            }
            // Step 2: reorder our waypoints to the optimal order, then re-request
            // with the order fixed so we get duration_in_traffic.
            const order = result.routes[0].waypoint_order;
            const orderedWaypoints = (order && order.length === waypoints.length)
                ? order.map(i => waypoints[i])
                : waypoints;
            renderWithTraffic(orderedWaypoints);
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
        window._routeMarkers.push({ marker, type: 'start' });
    }

    // ===== TRAFFIC-AWARE DURATION HELPERS =====
    // When a Directions request includes drivingOptions.departureTime, each leg
    // gains a `duration_in_traffic` field. Prefer it when present, otherwise fall
    // back to the free-flow `duration`.
    function legDurationSecs(leg) {
        if (leg && leg.duration_in_traffic && typeof leg.duration_in_traffic.value === 'number') {
            return leg.duration_in_traffic.value;
        }
        return leg && leg.duration ? leg.duration.value : 0;
    }

    // Human text for a leg's duration, preferring the traffic-aware value.
    function legDurationText(leg) {
        if (leg && leg.duration_in_traffic && leg.duration_in_traffic.text) {
            return leg.duration_in_traffic.text;
        }
        return leg && leg.duration ? leg.duration.text : '';
    }

    // True if this leg carries a traffic-aware duration (so we can label it).
    function legHasTraffic(leg) {
        return !!(leg && leg.duration_in_traffic && typeof leg.duration_in_traffic.value === 'number');
    }

    // Format seconds into "1h 23m" / "23m" / "45s"
    function formatDurationSecs(secs) {
        secs = Math.round(secs);
        const h = Math.floor(secs / 3600);
        const m = Math.round((secs % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${secs}s`;
    }

    // Format meters into "1.8 mi"
    function formatDistanceMeters(meters) {
        return `${(meters / 1609.34).toFixed(1)} mi`;
    }

    // Wire up click-to-split behavior on a rendered breakdown.
    // legValues is an array of { dist, dur } (meters, seconds) for each leg, in order.
    // Clicking a stop shows cumulative distance/time above (Start→stop) and below (stop→End).
    function initBreakdownSplit(breakdownEl, legValues) {
        if (!breakdownEl) return;
        const stopEls = Array.from(breakdownEl.querySelectorAll('.breakdown-stop'));
        // stopEls[0] = Start, stopEls[k] = end of leg k-1 (arrives after legValues[k-1])
        const totalDist = legValues.reduce((s, l) => s + l.dist, 0);
        const totalDur = legValues.reduce((s, l) => s + l.dur, 0);

        // ---- Departure time + buffer controls (inserted once at the top) ----
        const controls = document.createElement('div');
        controls.className = 'breakdown-controls';
        controls.innerHTML =
            `<div class="bc-field">` +
                `<label>Depart</label>` +
                `<input type="time" class="depart-time-input" aria-label="Departure time">` +
            `</div>` +
            `<div class="bc-field">` +
                `<label>Buffer (min)</label>` +
                `<input type="number" class="buffer-input" min="0" step="1" value="7" aria-label="Buffer minutes per stop">` +
            `</div>` +
            `<div class="bc-hint">Set a departure time, then tap a stop to see your arrival.</div>`;
        breakdownEl.insertBefore(controls, breakdownEl.firstChild);

        const departInput = controls.querySelector('.depart-time-input');
        const bufferInput = controls.querySelector('.buffer-input');
        // Don't let taps on the controls collapse the breakdown
        controls.addEventListener('click', (ev) => ev.stopPropagation());

        // When depart/buffer change, refresh the currently-selected stop's arrival
        // by toggling it off then on.
        departInput.addEventListener('change', () => {
            const sel = breakdownEl.querySelector('.breakdown-stop.breakdown-selected');
            if (sel) { sel.click(); sel.click(); }
        });
        bufferInput.addEventListener('change', () => {
            const sel = breakdownEl.querySelector('.breakdown-stop.breakdown-selected');
            if (sel) { sel.click(); sel.click(); }
        });

        stopEls.forEach((el, k) => {
            el.classList.add('breakdown-selectable');
            el.addEventListener('click', (e) => {
                e.stopPropagation(); // don't collapse the whole breakdown

                // Remove any existing split rows and clear selection
                breakdownEl.querySelectorAll('.breakdown-split').forEach(n => n.remove());
                const already = el.classList.contains('breakdown-selected');
                stopEls.forEach(s => s.classList.remove('breakdown-selected'));
                if (already) return; // toggle off

                el.classList.add('breakdown-selected');

                let aboveDist = 0, aboveDur = 0;
                for (let i = 0; i < k; i++) { aboveDist += legValues[i].dist; aboveDur += legValues[i].dur; }
                const belowDist = totalDist - aboveDist;
                const belowDur = totalDur - aboveDur;

                // Buffer: N min of service time for each stop visited before arriving here.
                // Start (k=0) isn't a serviced stop; the selected stop isn't counted.
                const bufferMinPer = Math.max(0, parseInt(bufferInput.value, 10) || 0);
                const stopsBefore = Math.max(0, k - 1);
                const bufferSecs = stopsBefore * bufferMinPer * 60;

                // Arrival time = departure + drive time to here + buffers along the way.
                let arrivalHtml = '';
                const departVal = departInput.value; // "HH:MM"
                if (departVal) {
                    const [h, m] = departVal.split(':').map(Number);
                    const depart = new Date();
                    depart.setHours(h, m, 0, 0);
                    const arrival = new Date(depart.getTime() + (aboveDur + bufferSecs) * 1000);
                    const arrivalStr = arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    const driveMin = Math.round(aboveDur / 60);
                    const bufMin = Math.round(bufferSecs / 60);
                    arrivalHtml =
                        `<div class="split-arrival-result">Arrive <strong>${arrivalStr}</strong>` +
                        `<span class="arrival-detail">${driveMin} min driving + ${bufMin} min buffer (${stopsBefore} stop${stopsBefore === 1 ? '' : 's'})</span></div>`;
                } else {
                    arrivalHtml = `<div class="split-arrival-result muted">Set a departure time above to see arrival.</div>`;
                }

                // "Arrive by" clock: enter a target arrival for THIS stop → when to leave.
                const leadSecs = aboveDur + bufferSecs;

                const split = document.createElement('div');
                split.className = 'breakdown-split';
                split.innerHTML =
                    `<div class="split-row"><span class="split-tag split-above">Above</span> ${formatDistanceMeters(aboveDist)} · ${formatDurationSecs(aboveDur)}</div>` +
                    `<div class="split-row"><span class="split-tag split-below">Below</span> ${formatDistanceMeters(belowDist)} · ${formatDurationSecs(belowDur)}</div>` +
                    arrivalHtml +
                    `<div class="split-arrive-by">` +
                        `<button type="button" class="arrival-clock-btn" aria-label="Set arrival time">🕐 Arrive by…</button>` +
                        `<div class="arrival-input-row hidden">` +
                            `<input type="time" class="arrival-time-input" aria-label="Target arrival time">` +
                        `</div>` +
                        `<div class="arrival-result hidden"></div>` +
                    `</div>`;
                el.insertAdjacentElement('afterend', split);

                // Wire up the "arrive by" clock
                const clockBtn = split.querySelector('.arrival-clock-btn');
                const inputRow = split.querySelector('.arrival-input-row');
                const timeInput = split.querySelector('.arrival-time-input');
                const resultEl = split.querySelector('.arrival-result');

                clockBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    inputRow.classList.toggle('hidden');
                    if (!inputRow.classList.contains('hidden')) timeInput.focus();
                });
                inputRow.addEventListener('click', (ev) => ev.stopPropagation());

                const computeLeave = (ev) => {
                    if (ev) ev.stopPropagation();
                    const val = timeInput.value; // "HH:MM"
                    if (!val) {
                        resultEl.textContent = 'Pick a time first.';
                        resultEl.classList.remove('hidden');
                        return;
                    }
                    const [hh, mm] = val.split(':').map(Number);
                    const arrive = new Date();
                    arrive.setHours(hh, mm, 0, 0);
                    const leave = new Date(arrive.getTime() - leadSecs * 1000);
                    const leaveStr = leave.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    const driveMin = Math.round(aboveDur / 60);
                    const bufMin = Math.round(bufferSecs / 60);
                    resultEl.innerHTML =
                        `Leave by <strong>${leaveStr}</strong>` +
                        `<span class="arrival-detail">${driveMin} min driving + ${bufMin} min buffer (${stopsBefore} stop${stopsBefore === 1 ? '' : 's'})</span>`;
                    resultEl.classList.remove('hidden');
                };
                timeInput.addEventListener('change', computeLeave);
            });
        });
    }

    function addNumberedMarker(position, label, color, address, stopType, isRush) {
        const innerFill = isRush ? '#ffb74d' : 'white';
        const textFill = isRush ? '#000' : color;
        const svg = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
                <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 24 16 24s16-12 16-24C32 7.2 24.8 0 16 0z" fill="${color}"/>
                <circle cx="16" cy="16" r="10" fill="${innerFill}"/>
                <text x="16" y="21" text-anchor="middle" font-size="12" font-weight="bold" fill="${textFill}">${label}</text>
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

        window._routeMarkers.push({ marker, type: stopType || 'none' });
    }

    window._closeInfoWindow = function() {
        if (window._openInfoWindow) {
            window._openInfoWindow.close();
            window._openInfoWindow = null;
        }
    };

    // ===== MAP FILTER (Advanced UI) =====
    const mapFilterRow = document.getElementById('map-filter-row');
    if (mapFilterRow) {
        mapFilterRow.querySelectorAll('.map-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                mapFilterRow.querySelectorAll('.map-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                applyMapFilter(btn.dataset.filter);
            });
        });
    }

    function applyMapFilter(filter) {
        if (!window._routeMarkers) return;
        window._routeMarkers.forEach(item => {
            if (filter === 'all') {
                item.marker.setVisible(true);
            } else if (filter === 'bus') {
                item.marker.setVisible(item.type === 'bus' || item.type === 'start');
            } else if (filter === 'res') {
                item.marker.setVisible(item.type === 'res' || item.type === 'start');
            }
        });
        // Show/hide polylines
        if (window._routePolylines) {
            window._routePolylines.forEach(item => {
                if (filter === 'all') {
                    item.polyline.setVisible(true);
                } else if (filter === 'bus') {
                    item.polyline.setVisible(item.type === 'bus' || item.type === 'start');
                } else if (filter === 'res') {
                    item.polyline.setVisible(item.type === 'res' || item.type === 'end');
                }
            });
        }
    }

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

        // Helper: extract street portion for fuzzy matching
        function streetPart(addr) {
            // Get everything before the first comma (street address)
            return addr.split(',')[0].trim().toLowerCase();
        }

        orderedAddresses.forEach(addr => {
            const addrLower = addr.toLowerCase();
            const addrStreet = streetPart(addr);

            // Try exact match first
            let matchIdx = reorderableStops.findIndex((s, i) => !used.has(i) && s.address.trim().toLowerCase() === addrLower);
            
            // Try street-part match (handles Google adding/removing city/state/zip)
            if (matchIdx === -1) {
                matchIdx = reorderableStops.findIndex((s, i) => !used.has(i) && streetPart(s.address) === addrStreet);
            }

            // Try contains match (one address contains the other's street)
            if (matchIdx === -1) {
                matchIdx = reorderableStops.findIndex((s, i) => !used.has(i) && (addrLower.includes(streetPart(s.address)) || s.address.trim().toLowerCase().includes(addrStreet)));
            }

            if (matchIdx !== -1) {
                used.add(matchIdx);
                reorderableStops[matchIdx].address = addr;
                reordered.push(reorderableStops[matchIdx]);
            } else {
                // Last resort fallback: next unused stop
                const fallbackIdx = reorderableStops.findIndex((s, i) => !used.has(i));
                if (fallbackIdx !== -1) {
                    used.add(fallbackIdx);
                    reorderableStops[fallbackIdx].address = addr;
                    reordered.push(reorderableStops[fallbackIdx]);
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
            stopEl.className = 'input-row' + (stop.pinned ? ' pinned' : '') + (stop.rush ? ' rush' : '') + (advancedUI ? (stop.type === 'bus' ? ' row-bus' : stop.type === 'res' ? ' row-res' : ' row-default') : '');
            stopEl.dataset.id = stop.id;
            stopEl.innerHTML = `
                <button class="pin-btn ${stop.pinned ? 'locked' : ''}" aria-label="Lock this stop" data-id="${stop.id}" title="${stop.pinned ? 'Locked — tap to unlock' : 'Tap to lock this stop in place'}">${lockIcon(stop.pinned)}</button>
                <span class="stop-number ${stop.type === 'bus' ? 'stop-num-bus' : stop.type === 'res' ? 'stop-num-res' : ''}" data-id="${stop.id}">${index + 1}</span>
                <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stop.id}" value="${stop.address}">
                <span class="drag-handle" data-id="${stop.id}">≡</span>
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
            directionsRenderer.setOptions({ suppressMarkers: true });
            // Hide the default polyline — we'll draw our own per-leg polylines
            directionsRenderer.setOptions({ polylineOptions: { visible: false } });
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

        // In "No End" mode, update the last stop's address to Google-formatted version
        if (endMode === 'none' && legs.length > 0) {
            const lastFilledStop = stops.filter(s => s.address.trim().length > 0).pop();
            if (lastFilledStop) {
                lastFilledStop.address = legs[legs.length - 1].end_address;
                const lastInput = stopsContainer.querySelector(`[data-id="${lastFilledStop.id}"] .stop-input`);
                if (lastInput) lastInput.value = lastFilledStop.address;
            }
        }

        // Clear old custom markers and polylines
        if (window._routeMarkers) {
            window._routeMarkers.forEach(m => m.marker.setMap(null));
        }
        window._routeMarkers = [];
        if (window._routePolylines) {
            window._routePolylines.forEach(p => p.polyline.setMap(null));
        }
        window._routePolylines = [];

        // Add custom numbered markers
        // Start marker (green)
        addCustomMarker(legs[0].start_location, '📍', 'Start');

        // Intermediate stops (numbered) — color by type
        legs.forEach((leg, i) => {
            const isLast = i === legs.length - 1;
            const label = isLast ? '●' : String(i + 1);
            let color;
            let markerType = 'none';
            let isRush = false;
            if (isLast) {
                color = '#ea4335'; // red for end
                markerType = 'end';
                // In No End mode, the last stop is a user stop — check for rush
                if (endMode === 'none') {
                    const lastStop = stops[stops.length - 1];
                    if (lastStop && lastStop.rush) isRush = true;
                    if (lastStop && lastStop.type === 'bus') { color = '#ff8c00'; markerType = 'bus'; }
                    else if (lastStop && lastStop.type === 'res') { color = '#9c27b0'; markerType = 'res'; }
                }
            } else {
                // Match stop type by index in the reordered stops array
                const stop = stops[i];
                if (stop && stop.type === 'bus') {
                    color = '#ff8c00'; // orange for business
                    markerType = 'bus';
                } else if (stop && stop.type === 'res') {
                    color = '#9c27b0'; // purple for residence
                    markerType = 'res';
                } else {
                    color = '#1a73e8'; // blue default
                }
                if (stop && stop.rush) isRush = true;
            }
            addNumberedMarker(leg.end_location, label, color, leg.end_address, markerType, isRush);
        });

        // Draw per-leg polylines with type info for filtering
        if (window._routePolylines) {
            window._routePolylines.forEach(p => p.polyline.setMap(null));
        }
        window._routePolylines = [];

        legs.forEach((leg, i) => {
            // Determine the type of this leg based on the destination stop
            let legType = 'none';
            if (i < legs.length - 1) {
                const stop = stops[i];
                if (stop) legType = stop.type || 'none';
            } else {
                // Last leg — use the type of the last waypoint stop (or 'res' if going to end)
                const lastWaypointStop = stops[stops.length - 1];
                legType = (lastWaypointStop && lastWaypointStop.type) || 'end';
            }

            // Determine color
            let strokeColor = '#4285F4'; // default blue
            if (legType === 'bus') strokeColor = '#ff8c00';
            else if (legType === 'res') strokeColor = '#9c27b0';

            // Build path from leg steps
            const path = [];
            leg.steps.forEach(step => {
                const decodedPath = google.maps.geometry ? 
                    google.maps.geometry.encoding.decodePath(step.polyline.points) :
                    step.path || [];
                decodedPath.forEach(point => path.push(point));
            });

            // If geometry library isn't loaded, use lat_lngs from step
            const polylinePath = path.length > 0 ? path : [leg.start_location, leg.end_location];

            const polyline = new google.maps.Polyline({
                path: polylinePath,
                strokeColor: strokeColor,
                strokeOpacity: 0.8,
                strokeWeight: 5,
                map: map,
            });

            window._routePolylines.push({ polyline, type: legType });
        });

        // Calculate totals (traffic-aware when available)
        let totalDistance = 0;
        let totalDuration = 0;
        let anyTraffic = false;
        legs.forEach(leg => {
            totalDistance += leg.distance.value;
            totalDuration += legDurationSecs(leg);
            if (legHasTraffic(leg)) anyTraffic = true;
        });

        const distanceMiles = (totalDistance / 1609.34).toFixed(1);
        const hours = Math.floor(totalDuration / 3600);
        const minutes = Math.round((totalDuration % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const timeLabel = anyTraffic ? 'Time (with traffic)' : 'Total Time';

        // Build leg breakdown HTML
        const routeLegValues = [];
        let breakdownHtml = '<div class="route-breakdown hidden">';
        // Show first address (start)
        breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label breakdown-start">Start</span> ${legs[0].start_address}</div>`;
        // Show each leg's distance/time then the next address (traffic-aware)
        legs.forEach((leg, i) => {
            routeLegValues.push({ dist: leg.distance.value, dur: legDurationSecs(leg) });
            breakdownHtml += `<div class="breakdown-arrow">↓ ${leg.distance.text} · ${legDurationText(leg)}${legHasTraffic(leg) ? ' 🚦' : ''}</div>`;
            const isLast = i === legs.length - 1;
            const label = isLast ? 'End' : `${i + 1}`;
            let cls = isLast ? 'breakdown-end' : '';
            // Box color = type (bus/res); number color = gold if rush. Advanced UI only.
            if (!isLast && advancedUI) {
                const stop = stops[i];
                if (stop && stop.type === 'bus') cls = 'breakdown-bus';
                else if (stop && stop.type === 'res') cls = 'breakdown-res';
                if (stop && stop.rush) cls += ' breakdown-rush';
            }
            breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label ${cls}">${label}</span> ${leg.end_address}</div>`;
        });
        breakdownHtml += '</div>';

        // Display summary
        routeSummary.innerHTML = `
            <div class="summary-stats">
                <div class="stat">
                    <div class="stat-value">${timeStr}</div>
                    <div class="stat-label">${timeLabel}</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${distanceMiles} mi</div>
                    <div class="stat-label">Total Distance</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${legs.length}</div>
                    <div class="stat-label">Stops</div>
                </div>
            </div>
            <div class="summary-expand-hint">Tap for breakdown ▾</div>
            ${breakdownHtml}
        `;
        routeSummary.classList.remove('hidden');
        resultActions.classList.remove('hidden');
        if (mapFilterRow && advancedUI) mapFilterRow.classList.remove('hidden');

        // Toggle breakdown on click
        routeSummary.onclick = () => {
            const breakdown = routeSummary.querySelector('.route-breakdown');
            const hint = routeSummary.querySelector('.summary-expand-hint');
            if (breakdown) {
                breakdown.classList.toggle('hidden');
                hint.textContent = breakdown.classList.contains('hidden') ? 'Tap for breakdown ▾' : 'Tap to collapse ▴';
            }
        };
        initBreakdownSplit(routeSummary.querySelector('.route-breakdown'), routeLegValues);

        // Save optimized route for Google Maps navigation link
        optimizedRoute = {
            origin: legs[0].start_address,
            destination: legs[legs.length - 1].end_address,
            waypoints: legs.slice(0, -1).map(leg => leg.end_address),
        };

        // Capture structured context for the AI assistant
        setLastRouteContext(legs, { totalDistance, totalDuration, anyTraffic });

        // Auto-save to route history
        const filledStopsForHistory = stops.filter(s => s.address.trim().length > 0);
        saveToHistory({
            origin: legs[0].start_address,
            destination: legs[legs.length - 1].end_address,
            stops: filledStopsForHistory.map(s => ({ address: s.address, pinned: s.pinned, type: s.type, rush: !!s.rush })),
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
            .map(s => ({ address: s.address.trim(), pinned: s.pinned, type: s.type || 'none', rush: !!s.rush }));

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
            stops: waypoints.map(s => ({ address: s.address, pinned: s.pinned, type: s.type || 'none', rush: !!s.rush })),
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
        route.stops.forEach((stopData, i) => {
            const address = typeof stopData === 'string' ? stopData : stopData.address || stopData;
            const type = (typeof stopData === 'object' && stopData.type) ? stopData.type : 'none';
            const pinned = (typeof stopData === 'object' && stopData.pinned) ? true : (route.pinnedIndices ? route.pinnedIndices.includes(i) : false);
            const rush = (typeof stopData === 'object' && stopData.rush) ? true : false;
            const index = stops.length;
            const stopId = Date.now() + index + Math.random();
            stops.push({ id: stopId, address: address, pinned: pinned, type: type, rush: rush });

            const stopEl = document.createElement('div');
            stopEl.className = 'input-row' + (pinned ? ' pinned' : '') + (rush ? ' rush' : '') + (advancedUI ? (type === 'bus' ? ' row-bus' : type === 'res' ? ' row-res' : ' row-default') : '');
            stopEl.dataset.id = stopId;
            const numClass = type === 'bus' ? 'stop-num-bus' : type === 'res' ? 'stop-num-res' : '';
            stopEl.innerHTML = `
                <button class="pin-btn ${pinned ? 'locked' : ''}" aria-label="Lock this stop" data-id="${stopId}" title="${pinned ? 'Locked — tap to unlock' : 'Tap to lock this stop in place'}">${lockIcon(pinned)}</button>
                <span class="stop-number ${numClass}" data-id="${stopId}">${index + 1}</span>
                <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stopId}" value="${address}">
                <span class="drag-handle" data-id="${stopId}">≡</span>
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
            <div class="saved-route-card" data-id="${route.id}">
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
    window._saveCurrentRoute = saveCurrentRoute;

    // ===== ROUTE HISTORY =====
    function getHistory() {
        const data = localStorage.getItem('routeHistory');
        if (!data) return [];
        const history = JSON.parse(data);
        // Expire entries older than 3 days
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const filtered = history.filter(entry => (now - entry.timestamp) < threeDays);
        if (filtered.length !== history.length) {
            localStorage.setItem('routeHistory', JSON.stringify(filtered));
        }
        return filtered;
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
                <div class="history-card${entry.cleared ? ' history-card-cleared' : ''}" data-idx="${idx}">
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

        // Add stops (supports both old format [string] and new format [{address, pinned, type}])
        const allStops = entry.stops || [];
        allStops.forEach(stopData => {
            const address = typeof stopData === 'string' ? stopData : stopData.address;
            const pinned = typeof stopData === 'string' ? false : !!stopData.pinned;
            const rush = typeof stopData === 'string' ? false : !!stopData.rush;
            const type = (typeof stopData === 'object' && stopData.type) ? stopData.type : 'none';
            const index = stops.length;
            const stopId = Date.now() + index + Math.random();
            stops.push({ id: stopId, address: address, pinned: pinned, type: type, rush: rush });

            const stopEl = document.createElement('div');
            stopEl.className = 'input-row' + (pinned ? ' pinned' : '') + (rush ? ' rush' : '') + (advancedUI ? (type === 'bus' ? ' row-bus' : type === 'res' ? ' row-res' : ' row-default') : '');
            stopEl.dataset.id = stopId;
            const numClass = type === 'bus' ? 'stop-num-bus' : type === 'res' ? 'stop-num-res' : '';
            stopEl.innerHTML = `
                <button class="pin-btn ${pinned ? 'locked' : ''}" aria-label="Lock this stop" data-id="${stopId}" title="${pinned ? 'Locked — tap to unlock' : 'Tap to lock this stop in place'}">${lockIcon(pinned)}</button>
                <span class="stop-number ${numClass}" data-id="${stopId}">${index + 1}</span>
                <input type="text" class="stop-input" placeholder="Enter destination address" autocomplete="new-password" data-id="${stopId}" value="${address}">
                <span class="drag-handle" data-id="${stopId}">≡</span>
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

    // Init swipe-to-delete on saved routes and history cards
    initCardSwipeDelete(savedRoutesList, (card) => {
        const id = Number(card.dataset.id);
        if (id) {
            const saved = getSavedRoutes().filter(r => r.id !== id);
            setSavedRoutes(saved);
        }
    });

    initCardSwipeDelete(historyList, (card) => {
        const idx = parseInt(card.dataset.idx);
        if (!isNaN(idx)) {
            const history = getHistory();
            history.splice(idx, 1);
            setHistory(history);
        }
    });

    // =====================================================================
    // AI ROUTE ASSISTANT (Gemini, user-supplied key)
    // =====================================================================
    // Holds a snapshot of the last rendered route so the assistant can reason
    // about real drive times (traffic-aware) without re-querying the API.
    let lastRouteContext = null;

    function setLastRouteContext(legs, totals) {
        if (!legs || legs.length === 0) { lastRouteContext = null; return; }
        lastRouteContext = {
            start: legs[0].start_address,
            end: legs[legs.length - 1].end_address,
            trafficAware: !!(totals && totals.anyTraffic),
            totalDistanceMeters: totals ? totals.totalDistance : null,
            totalDurationSecs: totals ? totals.totalDuration : null,
            legs: legs.map((leg, i) => ({
                from: leg.start_address,
                to: leg.end_address,
                distanceText: leg.distance ? leg.distance.text : '',
                distanceMeters: leg.distance ? leg.distance.value : null,
                durationSecs: legDurationSecs(leg),
                durationText: legDurationText(leg),
                withTraffic: legHasTraffic(leg),
            })),
        };
    }

    // ----- DOM wiring for chat -----
    const aiChatBtn = document.getElementById('ai-chat-btn');
    const aiChatPanel = document.getElementById('ai-chat-panel');
    const aiChatCloseBtn = document.getElementById('ai-chat-close-btn');
    const aiChatMessages = document.getElementById('ai-chat-messages');
    const aiChatForm = document.getElementById('ai-chat-form');
    const aiChatInput = document.getElementById('ai-chat-input');
    const aiChatSend = document.getElementById('ai-chat-send');

    // Running conversation history sent to Gemini (excludes the system preamble).
    const aiHistory = [];

    function updateAiButtonVisibility() {
        if (!aiChatBtn) return;
        if (aiKey) aiChatBtn.classList.remove('hidden');
        else aiChatBtn.classList.add('hidden');
    }
    updateAiButtonVisibility();

    if (aiChatBtn) {
        aiChatBtn.addEventListener('click', () => {
            if (!aiKey) { openSettings(); return; }
            aiChatPanel.classList.remove('hidden');
            setTimeout(() => aiChatInput.focus(), 100);
        });
    }
    if (aiChatCloseBtn) {
        aiChatCloseBtn.addEventListener('click', () => aiChatPanel.classList.add('hidden'));
    }
    if (aiChatForm) {
        aiChatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = aiChatInput.value.trim();
            if (text) handleAiMessage(text);
        });
    }

    function appendAiMessage(text, kind) {
        const el = document.createElement('div');
        el.className = 'ai-msg ai-msg-' + kind;
        el.textContent = text;
        aiChatMessages.appendChild(el);
        aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
        return el;
    }

    // Build a compact, structured description of the current app state.
    function buildRouteStateForAI() {
        const filledStops = stops.filter(s => s.address.trim().length > 0);
        const now = new Date();
        return {
            currentTime: now.toLocaleString(),
            startLocation: startInput.value.trim() || null,
            endMode: endMode, // 'none' | 'round-trip' | 'address'
            endAddress: endMode === 'address' ? (endInput.value.trim() || null) : null,
            stops: filledStops.map((s, i) => ({
                index: i + 1,
                address: s.address.trim(),
                pinned: !!s.pinned,
                type: s.type || 'none',
                rush: !!s.rush,
            })),
            optimizedRoute: lastRouteContext,
        };
    }

    const AI_SYSTEM_PROMPT = `You are the Route Assistant inside a multi-stop driving route optimizer app.
You help the user understand and modify their route. You are given the current route state as JSON, including stops (in current order), the end mode, and — if the route has been optimized — the per-leg driving times (traffic-aware when "withTraffic" is true) in "optimizedRoute".

You can answer questions using the leg durations provided. Examples:
- Departure/arrival math: if the user must arrive at a stop by a certain time, sum the driving seconds of the legs leading to that stop (plus any buffer the user mentions) and subtract from the target time to tell them when to leave.
- "Will I make it on time", "how long to stop N", "what's the total drive time", etc.

You can also CHANGE the route by emitting actions. Only change things the user actually asked to change.

ALWAYS reply with a single JSON object (no markdown, no code fences) of this exact shape:
{
  "reply": "<natural-language message to show the user>",
  "actions": [ <zero or more action objects> ]
}

Each stop also has attributes the user can set, and so can you:
- "category": "bus" (business), "res" (residence), or "none". Businesses are always routed before residences.
- "rush": true/false — marks a stop as urgent/high-priority (shown in gold).
- "pinned": true/false — locks a stop in its current position; only unpinned stops get reordered.
These are reflected in the route state's "stops" entries (type, rush, pinned).

Supported action objects:
- {"type":"reorder","order":[<1-based stop indices in the NEW order>]}  // must include every current stop index exactly once
- {"type":"add","address":"<full address or place>","position":<1-based index or omit for end>}
- {"type":"remove","index":<1-based stop index>}
- {"type":"pin","index":<1-based stop index>,"pinned":true|false}
- {"type":"setType","index":<1-based stop index>,"category":"bus"|"res"|"none"}  // business / residence / clear
- {"type":"setRush","index":<1-based stop index>,"rush":true|false}
- {"type":"setEnd","mode":"none"|"round-trip"|"address","address":"<required only when mode=address>"}
- {"type":"reoptimize"}  // re-run the optimizer after changes

Interpretation hints:
- "make stop 2 a business/work/office" -> setType category "bus". "make it a home/house/residence" -> setType category "res". "clear the tag / make it normal" -> category "none".
- "mark stop 3 as rush/urgent/priority" -> setRush rush true. "remove rush" -> setRush rush false.
- "lock / pin stop 4" -> pin pinned true. "unlock / unpin" -> pin pinned false.
- You can combine several actions in one response (e.g. tag two stops and reoptimize).

Rules:
- If the user only asks a question, return an empty "actions" array.
- After changes that affect ordering or stops (add/remove/reorder/setEnd/setType), usually include a final {"type":"reoptimize"} so the map and times refresh, unless the user says not to. (pin/setRush alone don't require reoptimize unless the user wants the order recomputed.)
- Times you compute should use the traffic-aware leg durations when available; say so if you used traffic estimates.
- Be concise and friendly. Never invent drive times that aren't derivable from the data; if the route hasn't been optimized yet, ask the user to tap Optimize first.`;

    async function handleAiMessage(text) {
        if (!aiKey) { openSettings(); return; }
        aiChatInput.value = '';
        appendAiMessage(text, 'user');
        aiHistory.push({ role: 'user', text });

        aiChatSend.disabled = true;
        const typingEl = appendAiMessage('Thinking…', 'typing');

        try {
            const state = buildRouteStateForAI();
            const parsed = await callGemini(state);
            typingEl.remove();

            const reply = (parsed && parsed.reply) ? parsed.reply : "Sorry, I couldn't come up with a response.";
            appendAiMessage(reply, 'bot');
            aiHistory.push({ role: 'model', text: reply });

            const actions = (parsed && Array.isArray(parsed.actions)) ? parsed.actions : [];
            if (actions.length > 0) applyAiActions(actions);
        } catch (err) {
            typingEl.remove();
            console.error('AI error:', err);
            appendAiMessage(err && err.message ? err.message : 'Something went wrong talking to the assistant.', 'error');
        } finally {
            aiChatSend.disabled = false;
            aiChatInput.focus();
        }
    }

    // Cache the resolved model name for this session so we only call ListModels once.
    let _resolvedModelCandidates = null; // ordered list of model names to try

    // Preferred models in priority order. The "-latest" aliases are listed FIRST
    // because Google retires versioned IDs over time, and some keys return a 404 on
    // a specific version (e.g. gemini-2.5-flash) even though ListModels shows it —
    // the alias keeps working in that case.
    // Lighter flash models are listed first: since Google's Dec 2025 quota
    // changes, heavier models (and some -pro aliases) have a ZERO free-tier daily
    // quota and return 429 immediately, while flash-lite / flash still have a
    // usable free allowance. callGemini falls through 404s AND 429s, so a
    // limit-0 model is skipped in favor of one that still works for free.
    const AI_MODEL_PREFERENCES = [
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash',
        'gemini-flash-latest',
    ];

    // Build an ORDERED list of candidate models to try, so a single bad/retired
    // model name doesn't block the chat — callGemini falls through on a 404.
    // We combine our preferences with whatever the key's ListModels reports.
    async function resolveModelCandidates() {
        if (_resolvedModelCandidates) return _resolvedModelCandidates;

        // Models that support generateContent but are NOT general chat models.
        // These must be excluded or we may pick e.g. a TTS model, which rejects
        // multi-turn chat with a 400. Matched as substrings of the model name.
        const EXCLUDE = ['tts', 'image', 'imagen', 'vision', 'embedding', 'embed',
            'aqa', 'learnlm', 'gemma', 'audio', 'live', 'native-audio', 'thinking'];
        const isChatModel = (name) => {
            const n = name.toLowerCase();
            if (EXCLUDE.some(bad => n.includes(bad))) return false;
            // Must look like a Gemini text model.
            return n.startsWith('gemini');
        };

        let usable = [];
        try {
            const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(aiKey)}`;
            const res = await fetch(listUrl);
            if (res.ok) {
                const data = await res.json();
                usable = (data.models || [])
                    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
                    .map(m => (m.name || '').replace(/^models\//, ''))
                    .filter(isChatModel);
            }
        } catch (e) {
            console.warn('ListModels failed; will try preferred models directly.', e);
        }

        const candidates = [];
        const add = (name) => { if (name && !candidates.includes(name)) candidates.push(name); };

        // Step 1: preferred models that the key actually lists. If the list call
        //         failed, try all preferred and let any 404s fall through.
        for (const pref of AI_MODEL_PREFERENCES) {
            if (usable.length === 0 || usable.includes(pref)) add(pref);
        }
        // Step 2: any other flash chat models the key lists.
        usable.filter(n => n.includes('flash')).forEach(add);
        // Step 3: any remaining chat-capable models.
        usable.forEach(add);

        // Absolute fallback so the array is never empty.
        if (candidates.length === 0) AI_MODEL_PREFERENCES.forEach(add);

        _resolvedModelCandidates = candidates;
        return _resolvedModelCandidates;
    }

    // Call Gemini's generateContent REST endpoint, trying each candidate model in
    // order and falling through to the next one on a 404 (model not found/retired).
    async function callGemini(routeState) {
        const candidates = await resolveModelCandidates();

        // Build conversation: system preamble + current state + prior turns.
        const contents = [];
        contents.push({
            role: 'user',
            parts: [{ text: AI_SYSTEM_PROMPT + '\n\nCURRENT ROUTE STATE (JSON):\n' + JSON.stringify(routeState) }],
        });
        contents.push({
            role: 'model',
            parts: [{ text: '{"reply":"Got it — I have your current route. What would you like to know or change?","actions":[]}' }],
        });
        aiHistory.forEach(m => {
            contents.push({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] });
        });

        const body = {
            contents,
            generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json',
            },
        };

        let lastErr = null;
        for (let i = 0; i < candidates.length; i++) {
            const model = candidates[i];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(aiKey)}`;

            let res;
            try {
                res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } catch (netErr) {
                throw new Error('Network error reaching the AI service. Check your connection.');
            }

            if (res.ok) {
                const data = await res.json();
                const textOut = data &&
                    data.candidates &&
                    data.candidates[0] &&
                    data.candidates[0].content &&
                    data.candidates[0].content.parts &&
                    data.candidates[0].content.parts[0] &&
                    data.candidates[0].content.parts[0].text;
                if (!textOut) throw new Error('The assistant returned an empty response.');
                return parseAiJson(textOut);
            }

            // Not OK — read the error detail.
            let detail = '';
            try { const j = await res.json(); detail = j.error && j.error.message ? j.error.message : ''; } catch (e) {}

            if (res.status === 404) {
                // Model not found/retired for this key — try the next candidate.
                lastErr = new Error('No usable Gemini model found for your key. ' + detail);
                continue;
            }
            if (res.status === 429) {
                // Rate limited OR this model has a zero free-tier quota (Google set
                // several models' free daily limit to 0). Either way, try the next
                // candidate — a lighter flash model often still has free quota.
                lastErr = new Error('rate-limit');
                continue;
            }
            if (res.status === 401 || res.status === 403) {
                // Auth/permission problems won't be fixed by another model — stop now.
                throw new Error('AI request rejected (' + res.status + '). Check that your Gemini key is valid and the Generative Language API is enabled for its project. ' + detail);
            }
            if (res.status === 400) {
                // A 400 is usually model-specific (e.g. a TTS/specialized model that
                // doesn't support multi-turn chat) — try the next candidate. The
                // exception is an invalid API key, which we surface immediately.
                if (/api[_ ]?key|API_KEY_INVALID/i.test(detail)) {
                    throw new Error('Your Gemini API key appears to be invalid. ' + detail);
                }
                lastErr = new Error('AI request rejected (400). ' + detail);
                continue;
            }
            lastErr = new Error('AI request failed (' + res.status + '). ' + detail);
        }

        // Every candidate failed — reset so we re-list next time.
        _resolvedModelCandidates = null;
        if (lastErr && lastErr.message === 'rate-limit') {
            throw new Error("Every available model hit its free-tier limit. Google now sets some models' free daily quota to 0, so this may not reset — to use the assistant reliably you may need to enable billing (pay-as-you-go) on the key's project. Flash models cost only fractions of a cent per message.");
        }
        throw lastErr || new Error('No usable Gemini model was available for your key.');
    }

    // Parse the model's JSON, tolerating accidental code fences or stray text.
    function parseAiJson(raw) {
        let s = String(raw).trim();
        // Strip ```json ... ``` fences if present.
        s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        try {
            return JSON.parse(s);
        } catch (e) {
            // Last resort: grab the first {...} block.
            const start = s.indexOf('{');
            const end = s.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                try { return JSON.parse(s.slice(start, end + 1)); } catch (e2) {}
            }
            // No valid JSON — treat the whole thing as a plain reply.
            return { reply: s, actions: [] };
        }
    }

    // Apply the actions the AI requested against the live app state.
    function applyAiActions(actions) {
        let changed = false;
        let wantsReoptimize = false;

        for (const action of actions) {
            if (!action || typeof action.type !== 'string') continue;
            try {
                switch (action.type) {
                    case 'reorder': changed = aiReorder(action.order) || changed; break;
                    case 'add': changed = aiAddStop(action.address, action.position) || changed; break;
                    case 'remove': changed = aiRemoveStop(action.index) || changed; break;
                    case 'pin': changed = aiSetPin(action.index, action.pinned) || changed; break;
                    case 'setType': changed = aiSetType(action.index, action.category) || changed; break;
                    case 'setRush': changed = aiSetRush(action.index, action.rush) || changed; break;
                    case 'setEnd': changed = aiSetEnd(action.mode, action.address) || changed; break;
                    case 'reoptimize': wantsReoptimize = true; break;
                    default: break;
                }
            } catch (e) {
                console.error('Failed to apply AI action', action, e);
            }
        }

        if (changed) {
            appendAiMessage('✓ Route updated', 'action');
            renumberStops();
            updateOptimizeButton();
        }

        if (wantsReoptimize) {
            const canOptimize = startInput.value.trim() &&
                stops.filter(s => s.address.trim().length > 0).length >= 1 && !optimizeBtn.disabled;
            if (canOptimize) {
                appendAiMessage('Re-optimizing…', 'action');
                optimizeRoute();
            }
        }
    }

    // Rebuild the stops DOM from the current `stops` array (used after reorders).
    function rebuildStopsDOM() {
        const snapshot = stops.map(s => ({ ...s }));
        stopsContainer.innerHTML = '';
        stops = [];
        snapshot.forEach(() => addStop()); // creates fresh rows with new ids
        // Now fill addresses/state into the freshly created rows in order.
        snapshot.forEach((s, i) => {
            const target = stops[i];
            if (!target) return;
            target.address = s.address;
            target.pinned = s.pinned;
            target.type = s.type || 'none';
            target.rush = !!s.rush;
            const row = stopsContainer.querySelector(`[data-id="${target.id}"]`);
            if (row) {
                const input = row.querySelector('.stop-input');
                if (input) input.value = s.address;
                // Reflect pin state
                const pinBtn = row.querySelector('.pin-btn');
                if (s.pinned && pinBtn) {
                    pinBtn.innerHTML = lockIcon(true);
                    pinBtn.classList.add('locked');
                    row.classList.add('pinned');
                }
                // Reflect type/rush styling (advanced UI)
                const numEl = row.querySelector('.stop-number');
                if (numEl) {
                    if (s.type === 'bus') numEl.classList.add('stop-num-bus');
                    else if (s.type === 'res') numEl.classList.add('stop-num-res');
                    if (s.rush) numEl.classList.add('stop-num-rush');
                }
                if (s.type === 'bus') { row.classList.remove('row-default'); row.classList.add('row-bus'); }
                else if (s.type === 'res') { row.classList.remove('row-default'); row.classList.add('row-res'); }
                if (s.rush) row.classList.add('rush');
            }
        });
        renumberStops();
    }

    function aiReorder(order) {
        const filled = stops.filter(s => s.address.trim().length > 0);
        if (!Array.isArray(order) || order.length !== filled.length) return false;
        // Validate it's a permutation of 1..n.
        const sorted = [...order].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i + 1) return false;

        const reordered = order.map(idx => filled[idx - 1]);
        // Keep any empty stops at the end.
        const empties = stops.filter(s => s.address.trim().length === 0);
        stops = [...reordered, ...empties];
        rebuildStopsDOM();
        return true;
    }

    function aiAddStop(address, position) {
        if (!address || !address.trim()) return false;
        addStop(); // appends a new empty stop at end
        const newStop = stops[stops.length - 1];
        newStop.address = address.trim();
        const row = stopsContainer.querySelector(`[data-id="${newStop.id}"]`);
        if (row) { const input = row.querySelector('.stop-input'); if (input) input.value = address.trim(); }

        // If a specific position was requested, move it there.
        if (typeof position === 'number' && position >= 1 && position <= stops.length) {
            const fromIdx = stops.length - 1;
            const toIdx = position - 1;
            const [moved] = stops.splice(fromIdx, 1);
            stops.splice(toIdx, 0, moved);
            rebuildStopsDOM();
        }
        return true;
    }

    function aiRemoveStop(index) {
        const filled = stops.filter(s => s.address.trim().length > 0);
        if (typeof index !== 'number' || index < 1 || index > filled.length) return false;
        const target = filled[index - 1];
        removeStop(target.id);
        return true;
    }

    function aiSetPin(index, pinned) {
        const filled = stops.filter(s => s.address.trim().length > 0);
        if (typeof index !== 'number' || index < 1 || index > filled.length) return false;
        const target = filled[index - 1];
        const shouldPin = pinned !== false; // default to pin=true
        if (!!target.pinned !== shouldPin) togglePin(target.id);
        return true;
    }

    function aiSetEnd(mode, address) {
        if (!['none', 'round-trip', 'address'].includes(mode)) return false;
        endMode = mode;
        endModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        if (mode === 'address') {
            endInputRow.classList.remove('hidden');
            if (address && address.trim()) endInput.value = address.trim();
        } else {
            endInputRow.classList.add('hidden');
            if (mode !== 'address') endInput.value = '';
        }
        updateOptimizeButton();
        return true;
    }

    // Business/Residence tagging and Rush are Advanced-UI features. If the AI uses
    // them while Advanced UI is off, turn it on so the change is actually visible.
    function ensureAdvancedUI() {
        if (advancedUI) return;
        advancedUI = true;
        localStorage.setItem('advancedUI', 'true');
        const toggle = document.getElementById('advanced-ui-toggle');
        if (toggle) toggle.checked = true;
        applyAdvancedUI();
    }

    // Set a stop's category: 'bus' (business), 'res' (residence), or 'none'.
    function aiSetType(index, category) {
        const filled = stops.filter(s => s.address.trim().length > 0);
        if (typeof index !== 'number' || index < 1 || index > filled.length) return false;

        // Normalize common synonyms the model might emit.
        let cat = String(category || '').toLowerCase().trim();
        if (['business', 'bus', 'commercial', 'work', 'office'].includes(cat)) cat = 'bus';
        else if (['residence', 'res', 'home', 'house', 'residential'].includes(cat)) cat = 'res';
        else if (['none', 'default', 'clear', 'normal', ''].includes(cat)) cat = 'none';
        else return false;

        ensureAdvancedUI();
        const target = filled[index - 1];
        target.type = cat;

        const row = stopsContainer.querySelector(`[data-id="${target.id}"]`);
        if (row) {
            const numEl = row.querySelector('.stop-number');
            if (numEl) {
                numEl.classList.remove('stop-num-bus', 'stop-num-res');
                if (cat === 'bus') numEl.classList.add('stop-num-bus');
                else if (cat === 'res') numEl.classList.add('stop-num-res');
            }
            row.classList.remove('row-default', 'row-bus', 'row-res');
            if (cat === 'bus') row.classList.add('row-bus');
            else if (cat === 'res') row.classList.add('row-res');
            else row.classList.add('row-default');
        }
        return true;
    }

    // Toggle/set the rush (gold/urgent) flag on a stop.
    function aiSetRush(index, rush) {
        const filled = stops.filter(s => s.address.trim().length > 0);
        if (typeof index !== 'number' || index < 1 || index > filled.length) return false;

        ensureAdvancedUI();
        const target = filled[index - 1];
        target.rush = (rush !== false); // default to true

        const row = stopsContainer.querySelector(`[data-id="${target.id}"]`);
        if (row) {
            row.classList.toggle('rush', target.rush);
            const numEl = row.querySelector('.stop-number');
            if (numEl) numEl.classList.toggle('stop-num-rush', target.rush);
        }
        return true;
    }

    // Register Service Worker with automatic update handling.
    if ('serviceWorker' in navigator) {
        // updateViaCache: 'none' forces the browser to fetch sw.js from the network
        // every time, so a new version is detected immediately instead of being
        // served from the HTTP cache.
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
            .then((registration) => {
                // Check for an updated service worker on load.
                registration.update();

                // When a new worker is found and finishes installing, activate it.
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // A new version is ready and an old one is controlling the page.
                            newWorker.postMessage({ type: 'SKIP_WAITING' });
                        }
                    });
                });

                // Also check for updates whenever the app regains focus.
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') registration.update();
                });
            })
            .catch(() => {
                // Service worker registration failed, app still works
            });

        // When the active service worker changes, reload once to load the new files.
        let _reloadedForSW = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (_reloadedForSW) return;
            _reloadedForSW = true;
            window.location.reload();
        });
    }

    // Start the app
    init();
})();
