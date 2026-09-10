/* ==========================================================================
   sw.js — service worker: caches the app shell so the app can load and
   run fully offline on repeat visits.
   Strategy: stale-while-revalidate — answer from cache immediately (fast,
   works with zero network), then quietly fetch a fresh copy in the
   background to update the cache for next time. No manual version bump
   needed for ordinary content updates; bump CACHE_NAME only if you add or
   remove files from APP_SHELL and want old caches purged immediately.
   ========================================================================== */

const CACHE_NAME = "aichat-shell-v2";

const APP_SHELL = [
  "./",
  "index.html",
  "ai.html",
  "data.html",
  "manifest.json",
  "1.png",
  "css/style.css",
  "js/common.js",
  "js/auth.js",
  "js/chat.js",
  "js/data.js",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key !== CACHE_NAME;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        const networkFetch = fetch(event.request)
          .then(function (response) {
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(function () {
            // offline and nothing fresh to fetch — fall back to whatever
            // was cached, if anything
            return cached;
          });
        return cached || networkFetch;
      });
    })
  );
});
