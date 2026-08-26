// Route Optimizer PWA
(function() {
    'use strict';

    // State
    let stops = [];
    let map = null;
    let directionsRenderer = null;
    let apiKey = localStorage.getItem('googleMapsApiKey') || '';
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
            <button class="pin-btn" aria-label="Pin this stop" data-id="${stopId}" title="Pin to keep position">🔓</button>
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

    // Settings
    const advancedInfoBtn = document.getElementById('advanced-info-btn');
    const advancedInfo = document.getElementById('advanced-info');
    if (advancedInfoBtn && advancedInfo) {
        advancedInfoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            advancedInfo.classList.toggle('hidden');
        });
    }

    function openSettings() {
        apiKeyInput.value = apiKey;
        document.getElementById('dark-mode-toggle').checked = darkMode;
        document.getElementById('advanced-ui-toggle').checked = advancedUI;
        if (advancedInfo) advancedInfo.classList.add('hidden');
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

    function optimizeWithPinnedStops(origin, destination, filledStops) {
        // Strategy: For mixed bus/res types without pins, let Google optimize ALL stops together
        // for the best overall route, then reorder the result so businesses come first.
        // For pinned stops, split at pin boundaries and optimize each segment.

        const allAddresses = filledStops.map(s => s.address.trim());
        const hasPins = filledStops.some(s => s.pinned);
        const hasMixedTypes = filledStops.some(s => s.type === 'bus') && 
                              filledStops.some(s => s.type !== 'bus');

        // If there are pinned stops, use segment-based approach
        if (hasPins) {
            optimizeWithSegments(origin, destination, filledStops);
            return;
        }

        // No pins: optimize all stops together, then ensure businesses come first
        const directionsService = new google.maps.DirectionsService();
        
        if (!hasMixedTypes) {
            // All same type — just let Google optimize everything
            directionsService.route({
                origin: origin,
                destination: destination,
                waypoints: allAddresses.map(addr => ({ location: addr, stopover: true })),
                optimizeWaypoints: true,
                travelMode: google.maps.TravelMode.DRIVING,
            }, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    try { displayRoute(result, origin, allAddresses); } catch(e) { console.error(e); }
                } else { handleDirectionsError(status); }
                optimizeBtn.innerHTML = 'Optimize Route';
                optimizeBtn.disabled = false;
                updateOptimizeButton();
            });
            return;
        }

        // Mixed types: optimize all together, then move businesses to front (sorted by proximity to origin)
        // First, geocode origin and businesses to sort by distance
        const geocoder = new google.maps.Geocoder();
        const busStops = filledStops.filter(s => s.type === 'bus');
        const otherStops = filledStops.filter(s => s.type !== 'bus');
        const busAddresses = busStops.map(s => s.address.trim());
        const otherAddresses = otherStops.map(s => s.address.trim());

        // Get origin coordinates
        geocoder.geocode({ address: origin }, (originResults, originStatus) => {
            let originLat = 0, originLng = 0;
            if (originStatus === 'OK' && originResults[0]) {
                originLat = originResults[0].geometry.location.lat();
                originLng = originResults[0].geometry.location.lng();
            }

            // Geocode all businesses to sort by distance from origin
            const busGeoPromises = busAddresses.map(addr => new Promise(resolve => {
                geocoder.geocode({ address: addr }, (results, status) => {
                    if (status === 'OK' && results[0]) {
                        resolve({ addr, lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() });
                    } else {
                        resolve({ addr, lat: originLat, lng: originLng });
                    }
                });
            }));

            Promise.all(busGeoPromises).then(busGeos => {
                // Sort businesses using nearest-neighbor chain from origin
                // (visit closest unvisited business from current position)
                const sortedBus = [];
                const remaining = [...busGeos];
                let curLat = originLat;
                let curLng = originLng;

                while (remaining.length > 0) {
                    let nearestIdx = 0;
                    let nearestDist = Infinity;
                    for (let i = 0; i < remaining.length; i++) {
                        const dist = Math.pow(remaining[i].lat - curLat, 2) + Math.pow(remaining[i].lng - curLng, 2);
                        if (dist < nearestDist) {
                            nearestDist = dist;
                            nearestIdx = i;
                        }
                    }
                    const nearest = remaining.splice(nearestIdx, 1)[0];
                    sortedBus.push(nearest);
                    curLat = nearest.lat;
                    curLng = nearest.lng;
                }

                const sortedBusAddresses = sortedBus.map(g => g.addr);

                // Now optimize residences: from last business to destination
                const lastBus = sortedBusAddresses[sortedBusAddresses.length - 1] || origin;
                
                directionsService.route({
                    origin: lastBus,
                    destination: destination,
                    waypoints: otherAddresses.map(addr => ({ location: addr, stopover: true })),
                    optimizeWaypoints: true,
                    travelMode: google.maps.TravelMode.DRIVING,
                }, (resResult, resStatus) => {
                    let orderedOther = otherAddresses;
                    if (resStatus === google.maps.DirectionsStatus.OK && resResult.routes[0].waypoint_order) {
                        const resOrder = resResult.routes[0].waypoint_order;
                        orderedOther = resOrder.map(i => otherAddresses[i]);
                    }

                    // Final route: origin → sorted businesses → optimized residences → destination
                    const finalWaypoints = [...sortedBusAddresses, ...orderedOther];
                    directionsService.route({
                        origin: origin,
                        destination: destination,
                        waypoints: finalWaypoints.map(addr => ({ location: addr, stopover: true })),
                        optimizeWaypoints: false,
                        travelMode: google.maps.TravelMode.DRIVING,
                    }, (finalResult, finalStatus) => {
                        if (finalStatus === google.maps.DirectionsStatus.OK) {
                            try { displayRoute(finalResult, origin, finalWaypoints); } catch(e) { console.error(e); }
                        } else { handleDirectionsError(finalStatus); }
                        optimizeBtn.innerHTML = 'Optimize Route';
                        optimizeBtn.disabled = false;
                        updateOptimizeButton();
                    });
                });
            });
        });
    }

    function finishMixedRoute(directionsService, origin, destination, orderedBus, otherAddresses) {
        const lastBus = orderedBus.length > 0 ? orderedBus[orderedBus.length - 1] : origin;
        
        if (otherAddresses.length === 0) {
            // Only bus stops
            directionsService.route({
                origin: origin,
                destination: destination,
                waypoints: orderedBus.map(addr => ({ location: addr, stopover: true })),
                optimizeWaypoints: false,
                travelMode: google.maps.TravelMode.DRIVING,
            }, (r, s) => {
                if (s === google.maps.DirectionsStatus.OK) {
                    try { displayRoute(r, origin, orderedBus); } catch(e) { console.error(e); }
                } else { handleDirectionsError(s); }
                optimizeBtn.innerHTML = 'Optimize Route';
                optimizeBtn.disabled = false;
                updateOptimizeButton();
            });
            return;
        }

        // Optimize residences from last business to destination
        directionsService.route({
            origin: lastBus,
            destination: destination,
            waypoints: otherAddresses.map(addr => ({ location: addr, stopover: true })),
            optimizeWaypoints: true,
            travelMode: google.maps.TravelMode.DRIVING,
        }, (resResult, resStatus) => {
            let orderedOther = otherAddresses;
            if (resStatus === google.maps.DirectionsStatus.OK) {
                const resLegs = resResult.routes[0].legs;
                orderedOther = resLegs.slice(0, -1).map(l => l.end_address);
            }

            // Final combined route
            const finalWaypoints = [...orderedBus, ...orderedOther];
            directionsService.route({
                origin: origin,
                destination: destination,
                waypoints: finalWaypoints.map(addr => ({ location: addr, stopover: true })),
                optimizeWaypoints: false,
                travelMode: google.maps.TravelMode.DRIVING,
            }, (finalResult, finalStatus) => {
                if (finalStatus === google.maps.DirectionsStatus.OK) {
                    try { displayRoute(finalResult, origin, finalWaypoints); } catch(e) { console.error(e); }
                } else { handleDirectionsError(finalStatus); }
                optimizeBtn.innerHTML = 'Optimize Route';
                optimizeBtn.disabled = false;
                updateOptimizeButton();
            });
        });
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

        // Step 1: Geocode all stops to get coordinates
        const geocoder = new google.maps.Geocoder();
        const geocodePromises = stopsForOptimize.map(stop => {
            return new Promise((resolve) => {
                geocoder.geocode({ address: stop.address.trim() }, (results, status) => {
                    if (status === 'OK' && results[0]) {
                        resolve({
                            stop: stop,
                            lat: results[0].geometry.location.lat(),
                            lng: results[0].geometry.location.lng(),
                        });
                    } else {
                        // Fallback: no coordinates, place at end
                        resolve({ stop: stop, lat: null, lng: null });
                    }
                });
            });
        });

        // Also geocode origin
        const originGeo = await new Promise((resolve) => {
            geocoder.geocode({ address: origin }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    resolve({ lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() });
                } else {
                    resolve({ lat: 0, lng: 0 });
                }
            });
        });

        const geoStops = await Promise.all(geocodePromises);

        // Step 2: Nearest-neighbor sort within type groups
        // Separate pinned stops (keep in place) from unpinned
        const pinned = geoStops.filter(g => g.stop.pinned);
        const unpinned = geoStops.filter(g => !g.stop.pinned);

        // Sort unpinned by type (bus first, then none, then res)
        const unpinnedBus = unpinned.filter(g => g.stop.type === 'bus');
        const unpinnedNone = unpinned.filter(g => !g.stop.type || g.stop.type === 'none');
        const unpinnedRes = unpinned.filter(g => g.stop.type === 'res');

        // Apply nearest-neighbor within each type group
        function nearestNeighborSort(items, startLat, startLng) {
            const sorted = [];
            const remaining = [...items];
            let currentLat = startLat;
            let currentLng = startLng;

            while (remaining.length > 0) {
                let nearestIdx = 0;
                let nearestDist = Infinity;

                for (let i = 0; i < remaining.length; i++) {
                    if (remaining[i].lat === null) continue;
                    const dist = Math.pow(remaining[i].lat - currentLat, 2) + Math.pow(remaining[i].lng - currentLng, 2);
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestIdx = i;
                    }
                }

                const nearest = remaining.splice(nearestIdx, 1)[0];
                sorted.push(nearest);
                if (nearest.lat !== null) {
                    currentLat = nearest.lat;
                    currentLng = nearest.lng;
                }
            }
            return sorted;
        }

        // Sort each type group by nearest-neighbor
        let lastLat = originGeo.lat;
        let lastLng = originGeo.lng;

        const sortedBus = nearestNeighborSort(unpinnedBus, lastLat, lastLng);
        if (sortedBus.length > 0) {
            const lastBus = sortedBus[sortedBus.length - 1];
            if (lastBus.lat) { lastLat = lastBus.lat; lastLng = lastBus.lng; }
        }

        const sortedNone = nearestNeighborSort(unpinnedNone, lastLat, lastLng);
        if (sortedNone.length > 0) {
            const lastNone = sortedNone[sortedNone.length - 1];
            if (lastNone.lat) { lastLat = lastNone.lat; lastLng = lastNone.lng; }
        }

        const sortedRes = nearestNeighborSort(unpinnedRes, lastLat, lastLng);

        // Combine: bus → none → res (all nearest-neighbor sorted)
        const allSorted = [...sortedBus, ...sortedNone, ...sortedRes];

        // Build final order: pinned stops at their absolute positions, sorted stops fill the gaps
        const finalOrder = new Array(geoStops.length).fill(null);
        
        // First, place pinned stops at their original user positions
        geoStops.forEach((g, i) => {
            if (g.stop.pinned) {
                finalOrder[i] = g;
            }
        });
        
        // Fill remaining slots with sorted unpinned stops
        let sortedIdx = 0;
        for (let i = 0; i < finalOrder.length; i++) {
            if (finalOrder[i] === null) {
                finalOrder[i] = allSorted[sortedIdx++];
            }
        }

        // Step 3: Split into batches
        const batches = [];
        for (let i = 0; i < finalOrder.length; i += MAX_WAYPOINTS) {
            batches.push(finalOrder.slice(i, i + MAX_WAYPOINTS));
        }

        // Step 4: Optimize each batch via Directions API
        const directionsService = new google.maps.DirectionsService();
        const batchResults = [];
        let batchOrigin = origin;

        for (let b = 0; b < batches.length; b++) {
            const batch = batches[b];
            const isLastBatch = b === batches.length - 1;

            // Determine batch destination
            let batchDest;
            if (isLastBatch) {
                if (destination) {
                    batchDest = destination;
                } else {
                    // No end mode: last stop is destination
                    batchDest = batch[batch.length - 1].stop.address.trim();
                    batch.pop(); // Remove from waypoints
                }
            } else {
                // Use last stop of this batch as destination (bridge to next batch)
                batchDest = batch[batch.length - 1].stop.address.trim();
                batch.pop();
            }

            const waypoints = batch.map(g => g.stop.address.trim());

            const result = await new Promise((resolve) => {
                directionsService.route({
                    origin: batchOrigin,
                    destination: batchDest,
                    waypoints: waypoints.map(addr => ({ location: addr, stopover: true })),
                    optimizeWaypoints: false,
                    travelMode: google.maps.TravelMode.DRIVING,
                }, (res, status) => {
                    if (status === google.maps.DirectionsStatus.OK) {
                        resolve(res);
                    } else {
                        console.error('Batch', b + 1, 'failed:', status);
                        resolve(null);
                    }
                });
            });

            if (result) {
                batchResults.push({ result, batchOrigin, batchDest, batchStops: batch });
            }

            // Next batch starts where this one ends
            batchOrigin = batchDest;
        }

        // Step 5: Display all batches on map
        if (batchResults.length > 0) {
            displayBatchedRoute(batchResults, origin, finalOrder);
        } else {
            alert('Route optimization failed. Please try fewer stops.');
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

        // Combine all legs from all batches
        let allLegs = [];
        let totalDistance = 0;
        let totalDuration = 0;

        batchResults.forEach((batch, bIdx) => {
            const route = batch.result.routes[0];
            route.legs.forEach((leg, i) => {
                allLegs.push({ leg, batchIdx: bIdx });
                totalDistance += leg.distance.value;
                totalDuration += leg.duration.value;
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

        // Breakdown
        let breakdownHtml = '<div class="route-breakdown hidden">';
        breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label breakdown-start">Start</span> ${firstLeg.start_address}</div>`;
        let legNum = 1;
        allLegs.forEach((item, i) => {
            const isLast = i === allLegs.length - 1;
            breakdownHtml += `<div class="breakdown-arrow">↓ ${item.leg.distance.text} · ${item.leg.duration.text}</div>`;
            const label = isLast ? 'End' : `${legNum}`;
            const cls = isLast ? 'breakdown-end' : '';
            breakdownHtml += `<div class="breakdown-stop"><span class="breakdown-label ${cls}">${label}</span> ${item.leg.end_address}</div>`;
            if (!isLast) legNum++;
        });
        breakdownHtml += '</div>';

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
                    <div class="stat-value">${allLegs.length}</div>
                    <div class="stat-label">Stops</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${batchResults.length}</div>
                    <div class="stat-label">Routes</div>
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
        window._routeMarkers.push({ marker, type: 'start' });
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
                <button class="pin-btn" aria-label="Pin this stop" data-id="${stop.id}" title="${stop.pinned ? 'Unpin to allow optimization' : 'Pin to keep position'}">${stop.pinned ? '📌' : '🔓'}</button>
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
            let cls = isLast ? 'breakdown-end' : '';
            // Add bus/res color to label when Advanced UI is on
            if (!isLast && advancedUI) {
                const stop = stops[i];
                if (stop && stop.type === 'bus') cls = 'breakdown-bus';
                else if (stop && stop.type === 'res') cls = 'breakdown-res';
            }
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
                <button class="pin-btn" aria-label="Pin this stop" data-id="${stopId}" title="${pinned ? 'Unpin to allow optimization' : 'Pin to keep position'}">${pinned ? '📌' : '🔓'}</button>
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
                <button class="pin-btn" aria-label="Pin this stop" data-id="${stopId}" title="${pinned ? 'Unpin to allow optimization' : 'Pin to keep position'}">${pinned ? '📌' : '🔓'}</button>
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

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {
            // Service worker registration failed, app still works
        });
    }

    // Start the app
    init();
})();
