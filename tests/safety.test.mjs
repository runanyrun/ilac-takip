import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source, serviceWorker } from './helpers.mjs';

const context = vm.createContext({});
vm.runInContext(source('src/safety.js'), context);
const safety = context.IlacSafety;
const drug = () => ({ id: 1, name: 'Synthetic', stock: 30, daily: 1, times: ['08:00'], duration: 'omur_boyu' });
const backup = () => ({ format: 'ilac-takip-backup', version: 2, drugs: [drug()], takenLog: {}, history: [] });

test('Yedek: eski biçim kabul edilir; desteklenmeyen sürüm ve tehlikeli yapılar reddedilir', () => {
  assert.doesNotThrow(() => safety.backup({ drugs: [drug()], takenLog: {} }));
  for (const change of [
    b => { b.version = 999; }, b => { b.format = 'other'; },
    b => { b.drugs[0].id = '1);alert(1)//'; },
    b => { b.drugs[0].stock = -1; }, b => { b.drugs[0].times = ['25:00']; },
    b => { b.drugs[0].times = ['08:00', '08:00']; },
    b => { b.drugs.push(drug()); }, b => { b.history = [{}]; },
    b => { b.takenLog = { bad: 'not-a-date' }; }
  ]) { const b = backup(); change(b); assert.throws(() => safety.backup(b)); }
});

test('HTML metni ve tırnaklar escape edilir; SVG/harici fotoğraf yüklenmez', () => {
  assert.equal(safety.html('<img src=x onerror="x">\'&'), '&lt;img src=x onerror=&quot;x&quot;&gt;&#39;&amp;');
  for (const value of ['https://synthetic.invalid/photo', 'javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'x" onerror="alert(1)'])
    assert.equal(safety.photo(value), '');
  assert.equal(safety.photo('data:image/jpeg;base64,YQ=='), 'data:image/jpeg;base64,YQ==');
});

function fixture() {
  const values = new Map([['drugs', JSON.stringify([drug()])], ['log', '{}'], ['history', '[]']]);
  const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const specs = { drugs: { valid: safety.validDrugs, empty: () => [] }, log: { valid: safety.validLog, empty: () => ({}) }, history: { valid: safety.validHistory, empty: () => [] } };
  return { values, store, open: () => safety.storage(store, specs) };
}

test('İçe aktarmada ikinci yazma başarısızsa ilk anahtar eski ham değerine döner', () => {
  const f = fixture(), s = f.open(), before = [...f.values];
  const write = f.store.setItem;
  f.store.setItem = (key, value) => { if (key === 'log') throw new Error('quota'); write(key, value); };
  assert.throws(() => s.commit({ drugs: [], log: {}, history: [] }), /geri alındı/);
  assert.deepEqual([...f.values], before);
});

test('Başka sekmenin değişikliği eski bellek kopyasıyla ezilmez', () => {
  const f = fixture(), s = f.open(); s.read('drugs');
  const edited = drug(); edited.stock = 29;
  f.values.set('drugs', JSON.stringify([edited]));
  assert.throws(() => s.commit({ drugs: [] }), /Başka sekmede/);
  assert.equal(JSON.parse(f.values.get('drugs'))[0].stock, 29);
});

test('Bozuk diğer anahtar da bütün yazmaları engeller ve ham değer korunur', () => {
  const f = fixture(); f.values.set('history', '{broken'); const s = f.open();
  assert.throws(() => s.commit({ drugs: [] }), /yazma durduruldu/);
  assert.equal(f.values.get('history'), '{broken');
  assert.equal(JSON.parse(f.values.get('drugs')).length, 1);
});

test('SW güncellemesi yalnız uygulamaya ait eski cache adlarını siler', async () => {
  const deleted = []; let completion;
  const currentCache = 'ilac-takip-v' + source('sw.js').match(/const SW_VERSION = '([^']+)'/)[1];
  const { listeners } = serviceWorker({ caches: { keys: async () => ['other-app', 'ilac-takip-vold', currentCache],
    delete: async k => { deleted.push(k); } }, clients: { claim: async () => {} } });
  listeners.get('activate')({ waitUntil: p => { completion = p; } }); await completion;
  assert.deepEqual(deleted, ['ilac-takip-vold']);
});

test('SW HTTP 500 durumunda cache kullanır, sürüm sorgularını karıştırmaz', async () => {
  const expected = new Response('cached'); const options = [];
  const { context } = serviceWorker({ fetch: async () => new Response('error', { status: 500 }),
    caches: { open: async () => ({ match: async (_request, opt) => { options.push(opt); return expected; } }) } });
  assert.equal(await context.networkFirst({}), expected);
  assert.ok(options.every(option => !option?.ignoreSearch));
});

test('SW bildirim hedefi aynı origin ile sınırlıdır', () => {
  const { context } = serviceWorker();
  for (const value of ['https://synthetic.invalid', 'javascript:alert(1)', '//synthetic.invalid'])
    assert.equal(context.safeNotificationUrl(value), 'https://test.invalid/');
});


test('SW never caches API/auth or unrelated navigation, including subpath installations', () => {
  const { listeners } = serviceWorker({ self: { registration: {scope:'https://test.invalid/ilac-takip/'} } });
  for(const path of ['/api/backup','/ilac-takip/api/status','/other/index.html']) {
    let intercepted = false;
    listeners.get('fetch')({request:{method:'GET',url:'https://test.invalid'+path,mode:'navigate'},respondWith(){intercepted=true;}});
    assert.equal(intercepted,false);
  }
});

test('Doz sayısı ile saat sayısı eşleşmeyen yedek mevcut veriyi değiştirmeden reddedilir', () => {
  const b=backup();b.drugs[0].daily=2;
  assert.throws(()=>safety.backup(b));
  b.drugs[0].times.push('20:00');assert.doesNotThrow(()=>safety.backup(b));
  // Legacy local data remains readable; no automatic rewrite/migration.
  b.drugs[0].times.pop();assert.equal(safety.validDrugs(b.drugs),true);
});

test('Yarım doz işlemi yeniden açılışta stok, alım ve geçmişi birlikte geri alır',()=>{
  const f=fixture(),before=Object.fromEntries(f.values);
  const changed=drug();changed.stock=29;
  const after={drugs:JSON.stringify([changed]),log:JSON.stringify({'2026-11-04_1_08:00':true}),history:JSON.stringify([{name:'Synthetic',action:'alındı',ts:'2026-11-04T08:00:00Z'}])};
  f.values.set('ilac_transaction_v1',JSON.stringify({version:1,before,after}));
  f.values.set('drugs',after.drugs);f.values.set('log',after.log);
  const s=f.open();assert.equal(s.read('drugs')[0].stock,30);
  assert.deepEqual([...f.values],Object.entries(before));
});

test('Başarısız rollback journalı korur; sonraki açılış tutarlı kurtarır',()=>{
  const f=fixture(),s=f.open(),original=f.store.setItem;
  let failed=false;
  f.store.setItem=(key,value)=>{if(key==='log'){failed=true;throw Error('quota');}if(key==='drugs'&&failed)throw Error('rollback quota');original(key,value);};
  const changed=drug();changed.stock=29;
  assert.throws(()=>s.commit({drugs:[changed],log:{'2026-11-04_1_08:00':true}}),/geri alma tamamlanamadı/);
  assert.ok(f.values.has('ilac_transaction_v1'));
  f.store.setItem=original;const recovered=f.open();
  assert.equal(recovered.read('drugs')[0].stock,30);assert.equal(f.values.get('log'),'{}');
  assert.equal(f.values.has('ilac_transaction_v1'),false);
});

test('Divergent veya bozuk journal veriyi ezmez; yazmayı durdurur',()=>{
  for(const raw of ['{broken',JSON.stringify({version:1,before:{drugs:'[]'},after:{drugs:'[]'}})]){
    const f=fixture();f.values.set('ilac_transaction_v1',raw);const old=f.values.get('drugs'),s=f.open();
    assert.throws(()=>s.commit({drugs:[]}),/yazma durduruldu/);
    assert.equal(f.values.get('drugs'),old);assert.equal(f.values.get('ilac_transaction_v1'),raw);
  }
});

test('SW aynı sürümün kurulu dosyasını ağdaki farklı bundle ile karıştırmaz',async()=>{
  let response;
  const version=source('sw.js').match(/const SW_VERSION = '([^']+)'/)[1];
  const cached=new Response('installed');
  const {listeners}=serviceWorker({fetch:async()=>{throw Error('Must use installed cache');},caches:{open:async()=>({match:async()=>cached})}});
  listeners.get('fetch')({request:{method:'GET',url:'https://test.invalid/src/main.js?v='+version},respondWith:p=>{response=p;}});
  assert.equal(await (await response).text(),'installed');
});
