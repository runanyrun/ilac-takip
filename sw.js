const CACHE = 'ilac-takip-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './src/styles.css',
  './src/main.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(networkResponse => {
        if (e.request.method === 'GET' && e.request.url.startsWith(self.location.origin)) {
          const copy = networkResponse.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return networkResponse;
      });
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});
