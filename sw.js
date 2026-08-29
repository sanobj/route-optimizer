// Service Worker for Route Optimizer PWA
const CACHE_NAME = 'route-optimizer-v175';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css?v=175',
    './app.js?v=175',
    './manifest.json'
];

// Allow the page to tell a waiting worker to activate immediately.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

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

// Fetch - network first, fall back to cache when offline.
// This means an online user always gets the latest app files on refresh,
// while an offline user still gets the last cached version.
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Only handle GET requests; let everything else pass through.
    if (req.method !== 'GET') return;

    // Don't intercept Google Maps / gstatic requests — always go to network.
    if (req.url.includes('googleapis.com') || req.url.includes('gstatic.com')) {
        return;
    }

    event.respondWith(
        fetch(req)
            .then((response) => {
                // Cache a copy of successful, same-origin (basic) responses only.
                if (response && response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return response;
            })
            .catch(() =>
                // Offline: serve from cache, falling back to index.html for navigations.
                caches.match(req).then((cached) => cached || caches.match('./index.html'))
            )
    );
});
