// Service worker for v1 Editor – offline first

const CACHE = 'shell-v1';
const FILES = [
  '/',
  '/index.html',
  '/ui.json',
  '/styles.css',
  '/app.js',
  '/worker.js'
];

// Install – pre‑cache every essential file
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES))
  );
  // Activate immediately, don't wait for old tabs
  self.skipWaiting();
});

// Activate – remove any previous version caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(name => name !== CACHE).map(name => caches.delete(name))
      )
    )
  );
  // Claim all clients so the worker controls them immediately
  self.clients.claim();
});

// Fetch – cache first, network fallback (offline resilience)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      // Return cached response immediately, fetch update in background
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Update the cache with the fresh response for next time
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cached); // if network fails, fallback to cached
      // Return the cached copy first, then update
      return cached || fetchPromise;
    })
  );
});

// Placeholder for future background sync
self.addEventListener('sync', event => {
  // TODO: implement cloud sync when online
  console.log('Sync event received:', event.tag);
});
