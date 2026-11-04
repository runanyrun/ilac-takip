> Geliştirme durumu: PR #1/#3/#6 çalışmaları `develop` içinde birleştirildi.
> Bu dal canlı Worker kaynağıyla henüz eşleşmez; **deploy etmeyin**.
> Güncel durum, testler ve gerçek engeller: [Issues #4/#5](docs/issue5/implementation.md).
> `npm test`, `npm run test:browser`, `npm run check:secrets` yerel doğrulamalardır;
> `npm run check:import` doğrulanmış canlı kaynak gelene kadar hata verir.

# Ilac Takip (MVP)

> Bu kök dizin eski MVP olarak korunmaktadır; canlı Cloudflare Worker kaynakları
> ile aynı sürüm kabul edilmemelidir. Dağıtım yapılmayan geçiş hazırlığı ve kaynak
> aktarım adımları: [Cloudflare geçiş planı](docs/cloudflare-migration.md).
> Yeni kaynak alanı: `cloudflare/mono-preview/`. Otomatik kontroller: `npm test`.

Basit ve hizli bir "Ilac Takip" PWA (Progressive Web App).
Amac: ilaclari eklemek, gunluk alim saatlerini takip etmek, stok dusumunu izlemek ve bildirim almak.

## Su An Ne Calisiyor?

- Ilac ekleme / duzenleme / silme
- Gunluk saat bazli alim takibi
- Alim tamamlaninca stoktan dusme
- Basit gecmis kaydi (localStorage)
- Tarayici bildirimi (izin verilirse)
- JSON yedek disari aktarma ve geri yukleme
- PWA manifest + service worker (temel offline destek)

## Teknoloji

- Frontend: Vanilla HTML/CSS/JavaScript
- Depolama: Browser `localStorage`
- Dagitim: Statik host (GitHub Pages, Netlify, Vercel static)

Bu yapi MVP icin bilerek sade tutuldu; build sistemi gerekmez.

## Proje Yapisi

```text
.
├── index.html
├── manifest.json
├── sw.js
├── src
│   ├── main.js
│   └── styles.css
└── .github
    └── workflows
        └── jekyll-docker.yml
```

## Lokal Calistirma

En hizli yol:

```bash
cd ilac-takip
python3 -m http.server 8080
```

Sonra ac:

- `http://localhost:8080`

Not: Service worker icin HTTP server gerekir (dosyayi direkt acmak yerine).

## MVP Yol Haritasi (Pratik)

1. Kod tabanini modulerlestir (UI, storage, alarm, history)
2. Form dogrulama ve hata mesajlarini standartlastir
3. Tarih/saat timezone davranisini netlestir
4. JSON import/export (yedekten geri yukleme)
5. Basit testler (storage ve temel util fonksiyonlari)
6. Backend'e gecis (Supabase/Firebase) + kullanici hesabi
7. Cok cihaz senkronizasyonu ve aile paylasimi

## Onerilen Sonraki Yigin (MVP -> Uretim)

- Mobil uygulama gerekiyorsa: Flutter
- Backend: Supabase (Auth + Postgres + Realtime + Edge Functions)
- Bildirim:
  - Web: Web Push
  - Mobil: Firebase Cloud Messaging
- Analitik ve hata izleme: Sentry

## Ilk Calisan Ozellik Onerisi

"Gunluk alarm tamamla ve stok dusur" akisini production-ready hale getirin:

- Saat bazli planlama
- Tek tikla "Alindi" isaretleme
- Stoktan otomatik dusum
- Dusuk stok uyarisi

Bu ozellik kullaniciya ilk gunden net deger verir.
