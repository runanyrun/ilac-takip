import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { timingSafeEqual } from 'node:crypto';
import { functions, source } from './helpers.mjs';

function demoBackend() {
  const routes = new Map(), sent = [], middleware = [];
  const app = { use(fn) { if (typeof fn === 'function') middleware.push(fn); }, get() {}, post: (path, handler) => routes.set(path, handler), listen() {} };
  const express = Object.assign(() => app, { json() {} });
  const token = 'synthetic-test-only-token-not-a-secret';
  const context = vm.createContext({ express, cors() {}, console, Buffer, timingSafeEqual,
    process: { env: { PUSH_DEMO_TOKEN: token, VAPID_SUBJECT: 'mailto:synthetic@example.invalid', VAPID_PUBLIC_KEY: 'mock', VAPID_PRIVATE_KEY: 'mock' } },
    webpush: { setVapidDetails() {}, sendNotification: async (_, payload) => sent.push(JSON.parse(payload)) },
    Date: class extends Date { getHours() { return 8; } getMinutes() { return 0; } }
  });
  vm.runInContext(source('backend/node/server.js').replace(/^import .*;\r?\n/gm, ''), context);
  async function request(path, body, authorization = `Bearer ${token}`) {
    let result, status = 200;
    const req = { body, headers: { authorization } };
    const res = { status(code) { status = code; return this; }, json(value) { result = value; } };
    for (const fn of middleware) {
      let allowed = false; fn(req, res, () => { allowed = true; });
      if (!allowed) return { status, result };
    }
    await routes.get(path)(req, res);
    return { status, result };
  }
  return { request, sent };
}

test('MVP Node demo: kimliksiz veya hatalı token cron çalıştıramaz', async () => {
  const { request, sent } = demoBackend();
  for (const token of ['', 'Bearer wrong'])
    assert.equal((await request('/api/push/dispatch-due', {}, token)).status, 401);
  assert.equal(sent.length, 0);
});

test('MVP Node demo cron: kayıt yokken teslim denemesi yok', async () => {
  const { request, sent } = demoBackend();
  const { result } = await request('/api/push/dispatch-due', {});
  assert.equal(result.sent, 0); assert.equal(sent.length, 0);
});

test('MVP Node demo cron: yalnız vadesi gelen plan mock taşıyıcıya gönderilir', async () => {
  const { request, sent } = demoBackend();
  const endpoint = 'https://synthetic.invalid/push';
  await request('/api/push/subscriptions', { subscription: { endpoint } });
  const response = await request('/api/push/schedules', { endpoint, alarms: [
    { drugId: 1, name: 'Synthetic', daily: 1, time: '08:00' },
    { drugId: 2, name: 'Synthetic later', daily: 1, time: '09:00' }
  ] });
  assert.equal(response.status, 200);
  const { result } = await request('/api/push/dispatch-due', {});
  assert.equal(result.sent, 1); assert.equal(sent.length, 1); assert.equal(sent[0].drugId, 1);
});

function scheduler() {
  const timers = [], notifications = [];
  let instant = '2026-11-03T07:59:00Z';
  const c = functions('function scheduleAlarms()', 'function isWebPushCapable()', {
    alarmTimers: [], drugs: [{ id: 1, name: 'A', alarm: true, times: ['08:00'], daily: 1 },
      { id: 2, name: 'B', alarm: true, times: ['08:00'], daily: 1 }],
    window: { Notification: true }, takenLog: {}, todayStr: () => '2026-11-03',
    Notification: Object.assign(function (_, options) { notifications.push(options); }, { permission: 'granted' }),
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } },
    setTimeout(fn, delay) { const timer = { fn, delay, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cancelled = true; }
  });
  return { c, timers, notifications, advance: value => { instant = value; } };
}

test('MVP yerel zamanlayıcı: izinsizken alarm kurulmaz', () => {
  const { c, timers } = scheduler(); c.Notification.permission = 'denied';
  c.scheduleAlarms(); assert.equal(timers.length, 0);
});

test('MVP: aynı saatli ikinci ilaç ilk alarm tarafından iptal edilmez', () => {
  const { c, timers } = scheduler(); c.scheduleAlarms();
  assert.equal(timers.length, 2); timers[0].fn();
  assert.equal(timers[1].cancelled, false);
});

// Gerçek Worker aktarılmadı: sahte cron implementasyonunu test ederek başarı iddia etmeyin.
for (const scenario of [
  'scheduled handler dakikalık olayı yerel PUSH_KV binding ile işler',
  'aynı cron olayı tekrar işlendiğinde tek teslim oluşturulur',
  'Europe/Istanbul ve farklı zaman dilimlerinde doğru doz seçilir',
  'kaçırılmış dakika, yeniden deneme ve 404/410 abonelik temizliği',
  'yetkisiz abonelik ve plan istekleri reddedilir'
]) test.skip(`CANLI KAYNAK BEKLENİYOR: ${scenario}`, () => {});


test('yerel hatırlatma: gelecekteki başlangıç ve uzun timer taşması erken bildirim üretmez', async () => {
  const { c, timers, notifications } = scheduler();
  c.drugs = [{id:1,name:'Future',alarm:true,times:['08:00'],date:'2027-01-01',daily:1}];
  c.scheduleAlarms();
  assert.equal(timers[0].delay,2147483647);
  await timers[0].fn();
  assert.equal(notifications.length,0);
  assert.equal(timers[1].delay,2147483647);
});
test('yerel hatırlatma: iPhone uyumlu service worker gösterimi, alındı/atlandı için sessiz kalır', async () => {
  const {c,timers,advance}=scheduler();
  const shown=[];
  c.navigator={serviceWorker:{getRegistration:async()=>({showNotification:async(title,options)=>shown.push({title,options})})}};
  c.Notification=Object.assign(function(){throw Error('Constructor unavailable');},{permission:'granted'});
  c.takenLog={'2026-11-03_2_08:00':'skipped'};
  c.scheduleAlarms();advance('2026-11-03T08:00:00Z');
  await timers[0].fn();await timers[1].fn();
  assert.equal(shown.length,1);assert.equal(shown[0].options.tag,'drug_1_08:00');
});
test('bildirim sunucu hatası yerel zamanlayıcıyı durdurmaz veya başarı gibi gösterilmez',async()=>{
  const alerts=[];let scheduled=0;
  const c=functions('async function requestNotif()', 'function hasFirebaseConfig',{
    Notification:{requestPermission:async()=> 'granted'},alert:text=>alerts.push(text),
    setupWebPush:async()=>{throw Error('Synthetic 503');},setupFirebaseMessaging:async()=>{},
    checkNotifBanner(){},scheduleAlarms(){scheduled++;}
  });
  await c.requestNotif();
  assert.equal(scheduled,1);assert.match(alerts[0],/bağlantısı kurulamadı/);
});
