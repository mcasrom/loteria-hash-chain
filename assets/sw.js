// Service Worker — Registro verificable de participaciones (PWA)
// Estrategia: network-first para HTML/API, cache-first para assets estáticos.
const CACHE = 'loteria-hash-v2';
const CORE = ['/', '/assets/favicon.svg', '/assets/icon-192.png', '/assets/icon-512.png', '/assets/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo manejar peticiones del mismo origen y GET
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Assets estáticos: cache-first (no se actualizan a menudo)
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      }))
    );
    return;
  }

  // HTML/páginas: network-first, fallback a cache si offline
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});
