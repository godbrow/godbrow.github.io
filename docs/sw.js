/* =========================================================
   Vanilla Markdown Lab — sw.js
   Simple offline-first cache layer (App Shell strategy)
========================================================= */

const CACHE_NAME = "vml-cache-v1";

/*
  Core assets to cache.
  Keep this SMALL and stable.
  Only include essential shell files.
*/
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js"
];

/* -----------------------------
   Install event
   - pre-cache app shell
----------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );

  // force immediate activation
  self.skipWaiting();
});

/* -----------------------------
   Activate event
   - cleanup old caches
----------------------------- */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );

  self.clients.claim();
});

/* -----------------------------
   Fetch strategy
   - cache-first for app shell
   - network fallback for freshness
----------------------------- */

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // clone response before caching
          const copy = res.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, copy);
          });

          return res;
        })
        .catch(() => {
          // optional offline fallback behavior
          // could return a custom offline page later
          return new Response(
            "Offline — content not available in cache.",
            {
              headers: { "Content-Type": "text/plain" }
            }
          );
        });
    })
  );
});
