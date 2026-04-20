import express from 'express';
import cors from 'cors';
import webpush from 'web-push';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8787;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID ayarları eksik. .env değerlerini doldurun.');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Demo amaçlı in-memory store. Prod'da DB kullanın.
const subscriptionsByEndpoint = new Map();
const schedulesByEndpoint = new Map();

app.get('/api/push/health', (_req, res) => {
  res.json({ ok: true, subscriptions: subscriptionsByEndpoint.size });
});

app.post('/api/push/subscriptions', (req, res) => {
  const { subscription, timezone, userAgent, standalone } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'subscription.endpoint gerekli' });
  }
  subscriptionsByEndpoint.set(subscription.endpoint, {
    subscription,
    timezone: timezone || 'Europe/Istanbul',
    userAgent: userAgent || '',
    standalone: !!standalone,
    updatedAt: new Date().toISOString(),
  });
  res.json({ ok: true });
});

app.post('/api/push/schedules', (req, res) => {
  const { endpoint, alarms } = req.body || {};
  if (!endpoint || !Array.isArray(alarms)) {
    return res.status(400).json({ error: 'endpoint ve alarms[] gerekli' });
  }
  if (!subscriptionsByEndpoint.has(endpoint)) {
    return res.status(404).json({ error: 'subscription bulunamadı' });
  }
  schedulesByEndpoint.set(endpoint, alarms);
  res.json({ ok: true, alarmCount: alarms.length });
});

app.post('/api/push/send-test', async (req, res) => {
  const { endpoint } = req.body || {};
  const targets = endpoint
    ? [subscriptionsByEndpoint.get(endpoint)].filter(Boolean)
    : Array.from(subscriptionsByEndpoint.values());

  const payload = JSON.stringify({
    title: '💊 Test Bildirimi',
    body: 'Web Push altyapısı çalışıyor.',
    tag: 'push-test',
    url: './index.html',
  });

  const results = await Promise.allSettled(
    targets.map(t => webpush.sendNotification(t.subscription, payload))
  );

  results.forEach((r, idx) => {
    if (r.status === 'rejected') {
      const sub = targets[idx]?.subscription;
      const statusCode = r.reason?.statusCode;
      if ((statusCode === 404 || statusCode === 410) && sub?.endpoint) {
        subscriptionsByEndpoint.delete(sub.endpoint);
        schedulesByEndpoint.delete(sub.endpoint);
      }
    }
  });

  res.json({ ok: true, sent: targets.length, results: results.map(r => r.status) });
});

// Cron ile dakikada bir çağırın: Vercel cron / GitHub Action / server cron
app.post('/api/push/dispatch-due', async (_req, res) => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowTime = `${hh}:${mm}`;

  const sendJobs = [];

  for (const [endpoint, alarms] of schedulesByEndpoint.entries()) {
    const subMeta = subscriptionsByEndpoint.get(endpoint);
    if (!subMeta) continue;

    const dueItems = alarms.filter(a => a.time === nowTime);
    for (const item of dueItems) {
      const payload = JSON.stringify({
        title: '💊 İlaç Zamanı',
        body: `${item.name} — ${item.daily} adet`,
        tag: `drug_${item.drugId}_${item.time}`,
        url: './index.html',
        drugId: item.drugId,
        alarmTime: item.time,
      });
      sendJobs.push(webpush.sendNotification(subMeta.subscription, payload));
    }
  }

  const results = await Promise.allSettled(sendJobs);
  res.json({ ok: true, nowTime, sent: sendJobs.length, results: results.map(r => r.status) });
});

app.listen(PORT, () => {
  console.log(`Push server running on http://localhost:${PORT}`);
});
