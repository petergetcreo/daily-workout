/* Network-first with a short timeout, falling back to cache.

   The obvious choice for an offline app is cache-first, but that makes a
   deploy take two page loads to appear: the first load is served from the old
   cache while the new worker installs. Network-first fixes that — you always
   get the current build when you have signal — and the timeout means a flaky
   gym connection still falls back to cache quickly instead of hanging.

   The whole app is ~50 KB, so the network round trip costs very little.

   Bump CACHE when the asset list below changes. */
const CACHE = 'daily-workout-v4';
const NET_TIMEOUT = 2500;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './engine.js',
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

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT);
    fetch(request).then(
      response => {
        clearTimeout(timer);
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
        }
        resolve(response);
      },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fromNetwork(e.request).catch(() =>
      caches.match(e.request).then(hit => hit || caches.match('./index.html'))
    )
  );
});
