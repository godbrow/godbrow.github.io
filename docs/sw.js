const CACHE = "md-editor-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    const url = new URL(req.url);

    // Cache-first for same-origin assets; network fallback for others
    if (url.origin === location.origin) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        // Only cache successful responses
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        // If we can't fetch, try to fall back to cached index.html for navigations
        if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw;
      }
    }

    // Cross-origin: just network
    return fetch(req);
  })());
});
