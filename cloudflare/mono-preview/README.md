# Worker kaynak aktarım alanı

Bu dizin canlı kaynak içermez. Canlı Worker: `ilac-takip-mono-preview`.
Adres: https://ilac-takip-mono-preview.runanyrun.workers.dev
Production branch: `main`. Bu bilgi henüz bir otomatik deploy bağlantısı kurmaz.

Beklenen yapı:

```text
cloudflare/mono-preview/
  wrangler.jsonc             # Yalnız hazırlık hedefi; üretim adı/route/cron yok
  src/index.js              # EKSİK: gerçek Worker giriş modülü
  src/...                   # EKSİK: varsa diğer Worker modülleri
  public/...                # EKSİK: varsa gerçek statik varlıklar
  import-manifest.json       # EKSİK: incelenmiş aktarımın kaynak/hash kaydı
```

`src/index.js` yerine başka bir gerçek giriş dosyası kullanılıyorsa yapılandırma ve
kontrol betiği birlikte incelenerek uyarlanmalı. Sahte Worker veya eski MVP bu alana
kopyalanmamalı. Eski Firebase/OneSignal entegrasyonları buraya taşınmamalı.
Assets binding'i gerçek dağıtımda mevcutsa gerçek dizin ve routing seçenekleri
aktarımdan sonra eklenmeli; kök MVP dizinini assets olarak bağlamayın.

`npm run check:import` kök dizinden çalıştırılır. Kaynak ve envanter gelmeden hata
vermesi beklenir. Wrangler build hook aynı kontrolü çalıştırır. Bu kontrol teknik
bir kilit veya deploy yetkilendirmesi değildir; `--no-build` ile atlanabilir.
Bu hazırlıkta Wrangler komutu, build veya deploy çalıştırılmadı. Cloudflare Builds
bağlantısını etkinleştirmeyin. Yapılandırma Wrangler ile henüz doğrulanmadı.

Aktarım ve test kabul koşulları: [geçiş planı](../../docs/cloudflare-migration.md).
