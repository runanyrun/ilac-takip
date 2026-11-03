import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceWorker } from './helpers.mjs';

test('MVP Web Push: payload bildirime dönüşür ve waitUntil ile beklenir', async () => {
  let shown, completion;
  const { listeners } = serviceWorker({ self: { registration: {
    showNotification: async (title, options) => { shown = { title, options }; }
  } } });
  listeners.get('push')({ data: { json: () => ({ title: 'Synthetic reminder', body: 'Synthetic', drugId: 1 }) },
    waitUntil: p => { completion = p; } });
  assert.ok(completion); await completion;
  assert.equal(shown.title, 'Synthetic reminder');
  assert.equal(shown.options.data.drugId, 1);
});

test('MVP Web Push: JSON olmayan mesaj için metin yedeği', async () => {
  let body, completion;
  const { listeners } = serviceWorker({ self: { registration: {
    showNotification: async (_, options) => { body = options.body; }
  } } });
  listeners.get('push')({ data: { json() { throw new Error('not JSON'); }, text: () => 'Synthetic' },
    waitUntil: p => { completion = p; } });
  await completion; assert.equal(body, 'Synthetic');
});

test('MVP service worker: ağ kesilince önbellekteki uygulamaya döner', async () => {
  const expected = new Response('synthetic app');
  const { context } = serviceWorker({
    fetch: async () => { throw new Error('offline'); },
    caches: { open: async () => ({ match: async () => expected }) }
  });
  assert.equal(await context.networkFirst({}), expected);
});

test('MVP: bildirim tıklaması hedefi açar', async () => {
  let opened, closed = false, completion;
  const { listeners } = serviceWorker({ clients: { openWindow: async url => { opened = url; } } });
  listeners.get('notificationclick')({ notification: { data: { url: './index.html' }, close() { closed = true; } },
    waitUntil: p => { completion = p; } });
  await completion; assert.ok(closed); assert.equal(opened, './index.html');
});
