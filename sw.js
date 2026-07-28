/* Cache-first service worker. Bump CACHE when you change any asset. */
const CACHE = 'daily-workout-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './exercises.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) {
        // refresh the cache in the background, but serve instantly
        fetch(e.request)
          .then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res)); })
          .catch(() => {});
        return hit;
      }
      return fetch(e.request).catch(() => caches.match('./index.html'));
    })
  );
});
