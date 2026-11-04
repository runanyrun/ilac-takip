const SW_VERSION = '20261104-issue7-v2';

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
  './src/safety.js',
  `./src/safety.js?v=${SW_VERSION}`,
];
const SCOPE_URL = new URL(self.registration?.scope || '/', self.location.origin);
const APP_SHELL_PATHS = new Set(['./', './index.html', './manifest.json', './src/styles.css', './src/main.js', './src/safety.js'].map(path => new URL(path, SCOPE_URL).pathname));

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP_SHELL);
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('ilac-takip-v') && key !== CACHE).map(key => caches.delete(key)));
    await clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !APP_SHELL_PATHS.has(url.pathname)) return;
  // API/auth/push requests and unrelated paths must never enter shell caches.

  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request, './index.html'));
    return;
  }

  if (APP_SHELL_PATHS.has(url.pathname)) {
    // Versioned files installed with this shell stay together across releases.
    e.respondWith((async () => {
      if (url.searchParams.get('v') === SW_VERSION) {
        const cached = await (await caches.open(CACHE)).match(e.request);
        if (cached) return cached;
      }
      return networkFirst(e.request);
    })());
    return;
  }

});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    } else {
      const cached = await cache.match(request) || (fallbackUrl ? await cache.match(fallbackUrl) : null);
      if (cached) return cached;
    }
    return networkResponse;
  } catch (_) {
    const cached = (await cache.match(request)) ||
      (fallbackUrl ? await cache.match(fallbackUrl) : null);
    if (cached) return cached;
    return Response.error();
  }
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
  const targetUrl = safeNotificationUrl(e.notification.data && e.notification.data.url);
  e.waitUntil(clients.openWindow(targetUrl));
});

function safeNotificationUrl(value) {
  const base = self.registration?.scope || self.location.origin + '/';
  try {
    const url = new URL(value || './', base);
    if (url.origin === self.location.origin && /^https?:$/.test(url.protocol)) return url.href;
  } catch (_) {}
  return base;
}
