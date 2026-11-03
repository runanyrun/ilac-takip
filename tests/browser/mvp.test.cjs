const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');

let server, browser, base;
before(async () => {
  const root = resolve(__dirname, '../..');
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://test.invalid');
      const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      // Only application assets; never expose Git metadata, environment or fixture files.
      if (!['/index.html', '/manifest.json', '/sw.js', '/src/main.js', '/src/safety.js', '/src/styles.css'].includes(url.pathname === '/' ? '/index.html' : url.pathname)) {
        res.writeHead(404); res.end(); return;
      }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      res.setHeader('content-type', mime[extname(path)]); res.end(await readFile(path));
    } catch (_) { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve) || resolve()); });

async function profile(t) {
  const context = await browser.newContext(); t.after(() => context.close());
  // Test the local MVP only. No Firebase SDK, fonts, live API or push provider calls.
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openAddModal === 'function');
  t.after(() => assert.deepEqual(errors, []));
  return { page, context };
}
async function add(page, name = 'Synthetic') {
  await page.locator('[data-tab="ilaclar"]').click();
  await page.locator('#add-drug-fab').click();
  await page.locator('#drug-name').fill(name);
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
}
const state = page => page.evaluate(() => ({ drugs: JSON.parse(localStorage.ilac_drugs_v2 || '[]'),
  log: JSON.parse(localStorage.ilac_log_v2 || '{}'), history: JSON.parse(localStorage.ilac_history_v2 || '[]') }));

test('MVP tarayıcı: CRUD, alım/geri alma/atlama, geçmiş ve offline veri kalıcılığı', async t => {
  const { page, context } = await profile(t);
  page.on('dialog', dialog => dialog.accept());
  await add(page);
  await page.locator('[data-tab="bugun"]').click();
  await page.getByRole('button', { name: 'ALDIM', exact: true }).click();
  assert.equal((await state(page)).drugs[0].stock, 29);
  assert.equal((await state(page)).history[0].doseKey, Object.keys((await state(page)).log)[0]);
  await page.locator('[data-tab="gecmis"]').click();
  assert.equal(await page.locator('#history-list .history-item').count(), 2);
  await page.getByRole('button', { name: 'GERİ AL', exact: true }).click();
  assert.equal((await state(page)).drugs[0].stock, 30);
  await page.locator('[data-tab="bugun"]').click();
  await page.getByRole('button', { name: 'ATLADIM', exact: true }).click();
  assert.ok(Object.values((await state(page)).log).includes('skipped'));
  assert.equal((await state(page)).drugs[0].stock, 30);
  await page.locator('[data-tab="ilaclar"]').click(); await page.locator('.drug-card').click();
  await page.getByRole('button', { name: /Düzenle/ }).click();
  await page.locator('#drug-name').fill('Synthetic edited');
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openAddModal === 'function');
  assert.equal((await state(page)).drugs[0].name, 'Synthetic edited');
  await page.locator('[data-tab="ilaclar"]').click(); await page.locator('.drug-card').click();
  await page.getByRole('button', { name: /Düzenle/ }).click();
  await page.locator('#delete-btn').click();
  assert.equal((await state(page)).drugs.length, 0);
  assert.ok((await state(page)).history.some(h => h.action === 'İlaç silindi'));
});

test('MVP tarayıcı: HTML ve attribute içeriği ilaç/detay/geçmiş ekranında çalışmaz', async t => {
  const { page } = await profile(t);
  const name = '<img src=x onerror="window.injected=true">\'"';
  await add(page, name);
  assert.equal(await page.locator('.drug-card-name').textContent(), name);
  await page.locator('.drug-card').click();
  assert.equal(await page.locator('#detail-content img').count(), 0);
  await page.evaluate(() => closeModal());
  await page.locator('[data-tab="gecmis"]').click();
  assert.equal(await page.locator('.history-text strong').first().textContent(), name);
  assert.equal(await page.evaluate(() => window.injected), undefined);
});

test('MVP tarayıcı: bozuk kayıt değişmez, kullanıcıya uyarı verilir', async t => {
  const { page } = await profile(t);
  await page.evaluate(() => localStorage.setItem('ilac_drugs_v2', '{broken'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('alert').waitFor();
  let message; page.on('dialog', dialog => { message = dialog.message(); return dialog.accept(); });
  await add(page);
  assert.match(message, /yazma durduruldu/);
  assert.equal(await page.evaluate(() => localStorage.ilac_drugs_v2), '{broken');
});

test('MVP tarayıcı: yedek dışa aktar/içe aktar ve bozuk yedeği reddet', async t => {
  const { page } = await profile(t);
  await add(page);
  const exported = await page.evaluate(() => currentBackup());
  const before = await state(page);
  page.on('dialog', dialog => dialog.accept());
  // Real file-input/FileReader path, using synthetic data only.
  await page.evaluate(() => { importData(); });
  await page.locator('#import-file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...exported, drugs: [] })) });
  await page.waitForFunction(() => JSON.parse(localStorage.ilac_drugs_v2).length === 0);
  await page.evaluate(() => { importData(); });
  await page.locator('#import-file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.waitForFunction(() => JSON.parse(localStorage.ilac_drugs_v2).length === 1);
  assert.deepEqual(await state(page), before);
  await page.evaluate(() => { importData(); });
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await page.waitForTimeout(100);
  assert.deepEqual(await state(page), before);
});

test('MVP tarayıcı: alım sırasında kota hatası stok/alım/geçmişi değiştirmez', async t => {
  const { page } = await profile(t); await add(page);
  const before = await state(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ilac_log_v2') throw new DOMException('Synthetic quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  let message; page.on('dialog', dialog => { message = dialog.message(); return dialog.accept(); });
  await page.locator('[data-tab="bugun"]').click();
  await page.getByRole('button', { name: 'ALDIM', exact: true }).click();
  assert.match(message, /geri alındı/);
  assert.deepEqual(await state(page), before);
});

async function historyFixture(page, skipped, legacy = false) {
  const key = '2026-11-02_1_08:00';
  const data = {
    drugs: [
      { id: 1, name: 'Synthetic target', stock: skipped ? 10 : 9, daily: 1, times: ['08:00','20:00'], duration: 'omur_boyu', alarm: false, usageCondition: 'tok' },
      // Legacy/unknown fields must survive undo without normalization or data loss.
      { id: 2, name: 'Synthetic other', stock: 27, daily: 1, times: ['09:00'], duration: 'omur_boyu', alarm: false, extra: { preserve: ['all','fields'] } }
    ],
    log: { [key]: skipped ? 'skipped' : '2026-11-02T08:01:00.000Z', '2026-11-02_1_20:00': 'skipped', '2026-11-02_2_09:00': '2026-11-02T09:01:00.000Z' },
    history: [
      { drugId: 1, name: 'Synthetic target', action: skipped ? 'Doz atlandı' : 'İlaç alındı', ts: '2026-11-02T08:01:00.000Z', ...(legacy ? {} : { doseKey: key }) },
      { drugId: 2, name: 'Synthetic other', action: 'İlaç eklendi', ts: '2026-11-01T07:00:00.000Z' }
    ]
  };
  await page.evaluate(data => {
    localStorage.setItem('ilac_drugs_v2', JSON.stringify(data.drugs));
    localStorage.setItem('ilac_log_v2', JSON.stringify(data.log));
    localStorage.setItem('ilac_history_v2', JSON.stringify(data.history));
  }, data);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof undoDose === 'function');
  await page.locator('[data-tab="gecmis"]').click();
  return { key, data, button: page.locator(`[data-history-dose-key="${key}"]`) };
}

for (const skipped of [false, true]) {
  test(`Geçmiş GERİ AL: ${skipped ? 'atlandı stok değiştirmez' : 'alındı stok iade eder'}; diğer ilaç ve dozlar korunur`, async t => {
    const { page } = await profile(t);
    const { key, data, button } = await historyFixture(page, skipped);
    page.on('dialog', dialog => dialog.accept());
    assert.equal(await button.count(), 1);
    const row = button.locator('..');
    assert.equal(await row.locator('.history-dot').count(), 1);
    assert.equal(await row.locator('.history-date').count(), 1);
    // A linked event gets a button in the existing row, not a duplicate dose card.
    assert.equal(await page.locator('.history-text').filter({ hasText: skipped ? 'Doz atlandı' : 'İlaç alındı' }).count(), 1);
    await button.click();
    const after = await state(page);
    assert.equal(after.drugs[0].stock, 10);
    assert.deepEqual(after.drugs[1], data.drugs[1]);
    assert.deepEqual(after.drugs[0], { ...data.drugs[0], stock: 10 });
    const expectedLog = { ...data.log }; delete expectedLog[key];
    assert.deepEqual(after.log, expectedLog);
    assert.deepEqual(after.history.slice(1), data.history);
    assert.equal(after.history[0].action, skipped ? 'Atlama geri alındı' : 'İlaç iadesi');
    assert.equal(await button.count(), 0);
    // A stale history action must never turn into another ALDIM or refund twice.
    await page.evaluate(key => undoDose(key), key);
    assert.deepEqual(await state(page), after);
  });
}

test('Geçmiş GERİ AL: iptal ve depolama hatası tüm mevcut kayıtları korur', async t => {
  const { page } = await profile(t);
  const { data, button } = await historyFixture(page, false);
  page.once('dialog', dialog => dialog.dismiss());
  await button.click();
  assert.deepEqual(await state(page), data);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'ilac_log_v2') throw new DOMException('Synthetic quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const messages=[];
  page.on('dialog', dialog => { messages.push(dialog.message()); return dialog.accept(); });
  await button.click();
  assert.ok(messages.some(message => /geri alındı/.test(message)));
  assert.deepEqual(await state(page), data);
  assert.equal(await button.count(), 1);
});

test('Geçmiş GERİ AL: eski atlandı kaydı eşleştirme tahmini yapmadan geri alınabilir', async t => {
  const { page } = await profile(t);
  const { data, key, button } = await historyFixture(page, true, true);
  page.on('dialog', dialog => dialog.accept());
  assert.equal(await button.count(), 1);
  await button.click();
  const after = await state(page);
  assert.deepEqual(after.drugs, data.drugs);
  assert.equal(Object.hasOwn(after.log, key), false);
  assert.deepEqual(after.history.slice(1), data.history);
});
