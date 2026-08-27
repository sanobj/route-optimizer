// Service Worker for Route Optimizer PWA
const CACHE_NAME = 'route-optimizer-v130';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json'
];

// Install - cache core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    // Don't cache Google Maps API requests
    if (event.request.url.includes('googleapis.com') || 
        event.request.url.includes('gstatic.com')) {
        return;
    }

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return fetch(event.request).then((response) => {
                cache.put(event.request, response.clone());
                return response;
            }).catch(() => {
                return cache.match(event.request);
            });
        })
    );
});
