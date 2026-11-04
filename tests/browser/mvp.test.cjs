const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit, devices } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');

let server, browser, base;
let serverUnavailable = false;
before(async () => {
  const root = resolve(__dirname, '../..');
  server = createServer(async (req, res) => {
    if (serverUnavailable) { req.socket.destroy(); return; }
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
  const engine = process.env.ILAC_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
  browser = await engine.launch({ headless: true,
    ...(engine === chromium && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve) || resolve()); });

async function profile(t, options = {}, initialize) {
  const context = await browser.newContext(options);
  if (initialize) await context.addInitScript(initialize); t.after(() => context.close());
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

test('Alt gezinme: sayfalar erişilebilir, seçili sekme belirtilir ve ekle düğmesi doğru yerde görünür', async t => {
  const { page } = await profile(t);
  const tabs = page.locator('#app > nav.tabs');
  assert.equal(await tabs.count(), 1);
  assert.equal(await tabs.locator('.tab').count(), 3);
  assert.equal(await tabs.locator('[aria-current="page"]').getAttribute('data-tab'), 'bugun');
  const bottom = await tabs.boundingBox();
  const content = await page.locator('#app > .content').boundingBox();
  assert.ok(bottom && content && bottom.y >= content.y + content.height - 2);
  await tabs.locator('[data-tab="ilaclar"]').click();
  assert.equal(await tabs.locator('[aria-current="page"]').getAttribute('data-tab'), 'ilaclar');
  assert.equal(await page.locator('#add-drug-fab').isVisible(), true);
  await tabs.locator('[data-tab="gecmis"]').click();
  assert.equal(await tabs.locator('[aria-current="page"]').getAttribute('data-tab'), 'gecmis');
  assert.equal(await page.locator('#add-drug-fab').isVisible(), false);
});

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
  // Fail the real local transport: WebKit's protocol offline switch can abort
  // navigation internally before its service worker gets to serve the cache.
  serverUnavailable = true; t.after(() => { serverUnavailable = false; });
  await page.reload({ waitUntil: 'domcontentloaded' });
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
    assert.equal(await page.locator('.history-text').filter({ hasText: skipped ? 'Atlanan doz geri alındı' : 'Alınan doz geri alındı' }).count(), 1);
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

const iphone = { ...devices['iPhone 13'], defaultBrowserType: undefined, timezoneId: 'Europe/Istanbul' };

test('iPhone ekranı: eski renkler/gezinme, doğrulama, kayıpsız düzenleme ve stok', async t => {
  const { page } = await profile(t, iphone);
  const messages=[];
  page.on('dialog', dialog => { messages.push(dialog.message()); return dialog.accept(); });
  await add(page, 'Synthetic phone');
  const initial = await state(page);
  await add(page, 'Synthetic untouched');
  assert.equal(await page.locator('#add-drug-fab').isVisible(), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 245, 243)');
  await page.evaluate(() => {
    const rows=JSON.parse(localStorage.ilac_drugs_v2);
    rows[0].extension={ preserve:'unknown field' };
    rows[1].legacyExtra={keep:true}; delete rows[1].usageCondition;
    localStorage.setItem('ilac_drugs_v2',JSON.stringify(rows));
  });
  const untouched=(await state(page)).drugs[1];
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForFunction(()=>typeof openAddModal==='function');
  await page.locator('[data-tab="ilaclar"]').click();
  await page.locator('.drug-card').first().click();
  await page.getByRole('button',{name:/Düzenle/}).click();
  await page.locator('#drug-name').fill('Synthetic phone edited');
  await page.locator('#drug-daily').fill('1.5');
  await page.getByRole('button',{name:'Kaydet',exact:true}).click();
  assert.match(messages.at(-1),/tam sayı/);
  assert.equal((await state(page)).drugs[0].name,'Synthetic phone');
  await page.locator('#drug-daily').fill('2');
  await page.locator('#time-slots input').fill('');
  await page.getByRole('button',{name:'Kaydet',exact:true}).click();
  assert.match(messages.at(-1),/alarm saatleri/);
  await page.locator('#time-slots input').fill('08:00');
  await page.locator('.add-time-btn').click();
  await page.locator('#time-slots input').nth(1).fill('08:00');
  await page.getByRole('button',{name:'Kaydet',exact:true}).click();
  assert.match(messages.at(-1),/farklı alarm/);
  await page.locator('#time-slots input').nth(1).fill('21:15');
  await page.locator('#drug-duration').selectOption('sure');
  await page.locator('#drug-days').fill('0');
  await page.getByRole('button',{name:'Kaydet',exact:true}).click();
  assert.match(messages.at(-1),/pozitif tam gün/);
  await page.locator('#drug-days').fill('7');
  await page.getByRole('button',{name:'Kaydet',exact:true}).click();
  const edited=(await state(page)).drugs[0];
  assert.deepEqual(edited.extension,{preserve:'unknown field'});
  assert.deepEqual(edited.times,['08:00','21:15']);
  assert.equal(edited.id,initial.drugs[0].id);
  assert.deepEqual((await state(page)).drugs[1],untouched);
  assert.equal((await state(page)).history[0].action,'İlaç düzenlendi');
  // No overflow in the existing phone layout or editor navigation.
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('[data-tab="bugun"]').click();
  assert.equal(await page.locator('#add-drug-fab').isVisible(),false);
  await page.locator('[data-tab="ilaclar"]').click();
  await page.locator('.drug-card').first().click();
  page.removeAllListeners('dialog');
  let promptCount=0;
  page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept(++promptCount===1?'1.5':'5'):dialog.accept());
  await page.getByRole('button',{name:/Stok/}).click();
  assert.equal((await state(page)).drugs[0].stock,30);
  await page.getByRole('button',{name:/Stok/}).click();
  assert.equal((await state(page)).drugs[0].stock,35);
  assert.deepEqual((await state(page)).drugs[1],untouched);
});

test('iPhone: yerel gün, aynı anda ekleme ve constructor yerine SW hatırlatması', async t => {
  const {page}=await profile(t,iphone,()=>{
    Object.defineProperty(navigator,'standalone',{value:true,configurable:true});
    window.__localReminders=[];
    function PhoneNotification(){throw Error('iPhone Notification constructor must not be used');}
    PhoneNotification.permission='granted';
    PhoneNotification.requestPermission=async()=> 'granted';
    window.Notification=PhoneNotification;
    navigator.serviceWorker.getRegistration=async()=>({showNotification:async(title,options)=>window.__localReminders.push({title,...options})});
  });
  // 00:30 Istanbul is still the previous UTC date: default date must stay local.
  await page.clock.install({time:new Date('2026-11-02T21:30:00Z')});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof openAddModal==='function');
  await page.locator('[data-tab="ilaclar"]').click();
  await page.locator('#add-drug-fab').click();
  assert.equal(await page.locator('#drug-date').inputValue(),'2026-11-03');
  await page.locator('#drug-name').fill('Synthetic first');
  await page.locator('#time-slots input').fill('00:31');
  await page.getByRole('button',{name:'Kaydet',exact:true}).click();
  await page.locator('#add-drug-fab').click();
  await page.locator('#drug-name').fill('Synthetic second');
  await page.locator('#time-slots input').fill('00:31');
  await page.getByRole('button',{name:'Kaydet',exact:true}).click();
  const saved=await state(page);
  assert.notEqual(saved.drugs[0].id,saved.drugs[1].id);
  await page.clock.fastForward(61000);
  const shown=await page.evaluate(()=>window.__localReminders);
  assert.equal(shown.length,2);
  assert.equal(new Set(shown.map(n=>n.tag)).size,2);
  assert.deepEqual((await state(page)).drugs,saved.drugs);
  await page.clock.fastForward(60000);
  assert.equal(await page.evaluate(()=>window.__localReminders.length),2);
});

test('iPhone Safari desteği yokken izin düğmesi hata vermez; PWA kimliği değişmez', async t => {
  const {page}=await profile(t,iphone,()=>{Object.defineProperty(window,'Notification',{value:undefined,configurable:true});});
  await page.locator('[data-tab="ilaclar"]').click();
  assert.match(await page.locator('#notif-prompt').innerText(),/ana ekrandan/);
  let message;
  page.on('dialog',dialog=>{message=dialog.message();return dialog.accept();});
  await page.evaluate(()=>requestNotif());
  assert.match(message,/desteklemiyor/);
  const identity=await page.evaluate(async()=>{
    const manifest=await (await fetch(document.querySelector('link[rel="manifest"]').href)).json();
    return {id:manifest.id,start_url:manifest.start_url,scope:manifest.scope,display:manifest.display};
  });
  assert.deepEqual(identity,{id:'/ilac-takip',start_url:'./index.html',scope:'./',display:'standalone'});
});
