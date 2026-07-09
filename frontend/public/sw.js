// Minimal PWA service worker: network-first with cache fallback for the app
// shell, so the finish screen still loads offline once it has been visited.
// API calls are never cached — offline finishes live in the IndexedDB outbox.
// TODO: precache hashed build assets (e.g. via vite-plugin-pwa — new
// dependency, ask before adding).
const CACHE = "frontrun-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((m) => m ?? caches.match("/index.html"))
      )
  );
});
