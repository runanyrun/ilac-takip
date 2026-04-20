// Supabase Edge Function örneği (Deno)
// Gereken secret'lar:
// - VAPID_SUBJECT
// - VAPID_PUBLIC_KEY
// - VAPID_PRIVATE_KEY
// Ayrıca subscription/schedule verilerini DB'den okumanız gerekir.

import webpush from 'npm:web-push@3.6.7';

const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (_req) => {
  // TODO: Supabase DB'den due alarmları çekin.
  // Bu örnek sadece tek örnek payload gönderimini gösterir.

  // const { data: subscriptions } = await supabase.from('push_subscriptions').select('*')
  // const { data: dueItems } = await supabase.rpc('get_due_alarms')

  const fakeSubscription = null;

  if (!fakeSubscription) {
    return new Response(JSON.stringify({ ok: true, sent: 0, note: 'DB sorgularını ekleyin' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = JSON.stringify({
    title: '💊 İlaç Zamanı',
    body: 'Örnek Supabase Edge Push bildirimi',
    tag: 'ilac-demo',
    url: './index.html',
  });

  await webpush.sendNotification(fakeSubscription, payload);

  return new Response(JSON.stringify({ ok: true, sent: 1 }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
