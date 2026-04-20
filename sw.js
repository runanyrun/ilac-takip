const CACHE = 'ilac-takip-v4';
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

self.addEventListener('push', e => {
  let payload = {
    title: '💊 İlaç Zamanı',
    body: 'İlacınızı almayı unutmayın.',
    tag: 'ilac-reminder',
    url: './',
  };

  if (e.data) {
    try {
      payload = { ...payload, ...e.data.json() };
    } catch (_) {
      const text = e.data.text();
      if (text) payload.body = text;
    }
  }

  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: {
        url: payload.url || './',
        drugId: payload.drugId || null,
        alarmTime: payload.alarmTime || null,
      },
      badge: payload.badge || undefined,
      icon: payload.icon || undefined,
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(clients.openWindow(targetUrl));
});
