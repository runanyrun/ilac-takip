# Web Push Kurulum Notları

## 1) VAPID key üretimi

```bash
npx web-push generate-vapid-keys
```

Üretilen `publicKey` frontend'e, `privateKey` sadece backend'e konur.

## 2) Frontend ayarı

`index.html` içinde:

```html
<script>
  window.__PUSH_PUBLIC_KEY__ = 'PUBLIC_KEY_BURAYA';
  window.__PUSH_SERVER_BASE_URL__ = 'https://your-push-server.example.com';
</script>
```

## 3) Backend ayarı (Node örneği)

```bash
cd backend/node
cp .env.example .env
npm i
npm run dev
```

`.env` içine VAPID değerlerini girin.

## 4) Test

1. iPhone Safari'de siteyi aç
2. Share -> Add to Home Screen
3. Home Screen'den uygulamayı aç
4. "İzin Ver" ile bildirim izni ver
5. Backend'e test isteği at:

```bash
curl -X POST http://localhost:8787/api/push/send-test -H 'content-type: application/json' -d '{}'
```

## 5) Zamanlı gönderim

Gerçek alarm için backend'de `/api/push/dispatch-due` endpoint'ini dakikada bir cron ile tetikleyin.
