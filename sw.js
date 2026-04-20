const SW_VERSION = '20260420';
const CACHE = `ilac-takip-v${SW_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  `./index.html?v=${SW_VERSION}`,
  './manifest.json',
  `./manifest.json?v=${SW_VERSION}`,
  './src/styles.css',
  `./src/styles.css?v=${SW_VERSION}`,
  './src/main.js',
  `./src/main.js?v=${SW_VERSION}`,
];
const APP_SHELL_PATHS = new Set(['/', '/index.html', '/manifest.json', '/src/styles.css', '/src/main.js']);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP_SHELL);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request, './index.html'));
    return;
  }

  if (APP_SHELL_PATHS.has(url.pathname)) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  e.respondWith(staleWhileRevalidate(e.request));
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    const cached = (await cache.match(request, { ignoreSearch: true })) ||
      (fallbackUrl ? await cache.match(fallbackUrl, { ignoreSearch: true }) : null);
    if (cached) return cached;
    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then(response => {
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) return cached;
  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;
  return Response.error();
}

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
