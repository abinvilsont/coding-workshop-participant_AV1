/*
 * ACME Facility Desk service worker - makes the app installable and quick to open.
 *
 * - App files (/assets/*, hashed by Vite) are cached on first use and served from the cache.
 * - Pages always try the network first, then fall back to the cached app, so the app
 *   still opens offline (it then shows "Cannot reach the server" for its data).
 * - The API (/api/...) is NEVER cached: incident data must always be live and private.
 *
 * Bump VERSION to drop old caches.
 */
const VERSION = 'v1';
const CACHE = `facility-desk-${VERSION}`;
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('facility-desk-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Network first, so a new deploy shows up at once; the cached app when offline
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    // Hashed file names never change content: cache first
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })),
    );
  }
});
