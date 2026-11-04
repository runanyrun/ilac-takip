# Cloudflare geçiş hazırlığı — dağıtım yapılmadı

## Kaynakların durumu

- Eski MVP: GitHub `main`, commit `67e55a04e39101df2f51e833320d4af23b0a93a5`.
- Canlı Worker: `ilac-takip-mono-preview`.
- Canlı adres: https://ilac-takip-mono-preview.runanyrun.workers.dev
- Production branch: `main`.
- Görev kaydı: https://github.com/runanyrun/ilac-takip/issues/2
- Issue sahibinin bildirdiği canlı mimari: dakikalık cron, `PUSH_KV` binding ve
  standart VAPID Web Push; OneSignal kaldırılmış. Apple Web Push ve Google FCM
  servislerinden HTTP 201 kabul yanıtları alınmış; cihaz teslimi ayrıca test edilmeli.
  Google FCM'nin Web Push taşıyıcısı olması eski Firebase SDK entegrasyonunu
  geri getirmeyi gerektirmez. Bunlar issue beyanıdır, bu ortamda bağımsız
  doğrulanmış canlı kaynak/teslim bulguları değildir.
- Bu incelemede canlı HTTP isteği ağ proxy'sinde `403 CONNECT tunnel failed` ile
  engellendi. Bu, uygulamanın kendisinin 403 döndürdüğünü göstermez.
- Cloudflare hesabı/API kaynak okuma aracı bağlı değil. Worker kodu, deployment ID,
  cron/binding yapılandırmasının gerçek dağıtımdaki karşılığı, compatibility flags
  ve canlı localStorage şeması henüz bağımsız doğrulanmadı. GitHub ve canlı kaynak
  aynı sürüm kabul edilmedi.

## Mevcut dosyaları koruma

Kök `index.html`, `src/`, `sw.js`, `manifest.json`, `firebase-messaging-sw.js`,
`backend/` ve `supabase/` eski MVP olarak yerinde korundu. İlk hazırlıkta uygulama
koduna dokunulmadı; Issue #4 kapsamında aşağıda belirtilen yerel güvenlik/veri
koruma düzeltmeleri yapıldı. Bunlar canlı Worker'ın kaynakları değildir.
Hiçbiri yeni Worker için giriş veya assets dizini olarak bağlanmadı.
Eski Firebase dosyalarının korunması yeni entegrasyona dahil edildikleri anlamına
gelmez. Yeni Worker'a Firebase veya OneSignal eklemeyin.

Geçmiş sürüm Git commit'iyle sabittir; aynı içeriği ikinci kez kopyalamıyoruz.
Mevcut Jekyll workflow değiştirilmedi. Eklenen workflow yalnız Node testleri yapar.

## Gerekli kaynak aktarımı

1. Cloudflare Dashboard'da doğru hesap ve `ilac-takip-mono-preview` Worker'ını
   açın. Aktif deployment/version kimliğini kaydedin. Kaynağın asıl build deposu
   varsa, o deployment'ı üreten **tam commit** ve lockfile tercih edilmelidir.
2. Asıl depo yoksa Dashboard editöründen/export olanağından aktif sürümün giriş
   modülünü ve **bütün ek modüllerini** alın. Alternatif olarak yetkili bir
   operatör Cloudflare Workers API'nin script content okuma işlemini kullanabilir:
   `GET /accounts/{account_id}/workers/scripts/ilac-takip-mono-preview/content`.
   Modüler yanıtın multipart dosyaları korunmalıdır. Kaynak kopyasının aktif
   deployment'a ait olduğu ayrıca doğrulanmalıdır; yalnız HTTP sayfasını
   indirmek sunucu kodunu elde etmez.
3. Varsa statik varlıkları, kaynak haritalarını ve build girdilerini asıl build
   çıktısından alın. Tarayıcıdan kaydedilmiş HTML tek başına yeterli değildir.
   Cron ifadeleri, runtime tarihi/flags, binding **adları ve türleri**, route ve
   assets davranışını ayrı envantere alın. KV/D1/R2 içeriklerini dışa aktarmayın.
4. Ham aktarımı önce Git tarafından yok sayılan `private-transfer/` altında veya
   depo dışında tutun. Kaynakta gömülü secret, gerçek abonelik, endpoint, ilaç
   kaydı veya cihaz token'ı bulunmadığını inceleyin. Secret değerlerini kopyalamayın;
   mevcut platform secret binding'lerini koruyun. Kimlik bilgilerini sohbete veya
   komut geçmişine yazmayın.
5. İncelenmiş kodu `cloudflare/mono-preview/src/`, varsa assets'i `public/` altına
   yerleştirin. Giriş `src/index.js` değilse Wrangler ve doğrulama betiğini gerçek
   girişe göre birlikte uyarlayın. Eski MVP'yi buraya kopyalamayın.
6. `import-manifest.json` oluşturun. Gerçek deployment ID, UTC aktarım zamanı ve
   incelenen her kaynak/asset dosyası için SHA-256 içersin:

   ```json
   {
     "worker": "ilac-takip-mono-preview",
     "deploymentId": "GERCEK_DEPLOYMENT_KIMLIGI",
     "exportedAt": "GERCEK_ISO_8601_ZAMANI",
     "files": [{ "path": "src/index.js", "sha256": "GERCEK_SHA256" }]
   }
   ```

   Bu örnek veriyi manifest olarak kaydetmeyin. Hash kontrolü kaynak kökeninin
   bağımsız kanıtı değildir; operatörün aktif deployment eşleştirmesi de gerekir.
7. Gerçek compatibility date/flags ve binding yapılandırmasını inceleyerek taslağa
   uyarlayın. Hazırlık config'indeki tarih canlı tarih olarak kabul edilmemeli.
   Cron ve route'ları bu aşamada etkinleştirmeyin. Üretim Worker adını hazırlık
   hedefinin yerine koymayın. Daha sonra ayrı onaylı dağıtım işi gereklidir.

Wrangler yerel doğrulaması kaynak aktarıldıktan ve bağımlılıklar gerçek kaynakla
eşleştirildikten sonra, sabitlenmiş Wrangler sürümü ve lockfile ile yapılmalı.
Bu aşamada sahte runtime bağımlılığı veya kilit dosyası üretilmedi.

## Otomatik testler

Node 24+ (CI: Node 24). Birim testleri yerleşik Node API'lerini kullanır;
tarayıcı testleri lockfile ile sabitlenen Playwright gerektirir. Çalıştırıcı bu ortamda alt
süreçlerin yalnız dosya düzeyinde başarı raporlamasını önlemek için
`--test-isolation=none` kullanır; her test kendi VM ortamını oluşturur:

```sh
cd /workspace/ilac-takip
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
npm run check:import
```

`check:import` kaynak eksikken **başarısız olmalıdır**. Testlerin yeşil olması canlı
geçişe hazır olunduğunu göstermez. `test.todo` bilinen MVP hatalarını gerçek
assertion'larla gösterir; `test.skip` canlı kaynak eksikliğidir. Çıktıdaki passed,
todo ve skipped ayrı değerlendirilmelidir.

- localStorage: anahtarların korunması, sentetik veri turu, yedek alanları ve token
  dışlanması; bozuk JSON'un üzerine yazılmaması normal regresyon testidir.
- Web Push: gerçek MVP `push` handler'ı, metin fallback, bildirim tıklaması.
- Service worker: ağ kesilmesinde cache fallback. VM mock'u kullanılır; gerçek
  tarayıcı kurulumu, lifecycle ve origin izolasyonunu kanıtlamaz.
- Zamanlayıcı: izin kontrolü ve aynı saate kurulu alarmların birbirini iptal etmemesi.
- Cron: gerçek Node demo handler'ları mock taşıyıcı ile çalıştırılır; ağ isteği ve
  gerçek teslim yoktur. Bunlar Cloudflare `scheduled()` testleri değildir.
- Canlı cron/yetkilendirme senaryoları kaynak eksikliği nedeniyle açıkça skip'tir.

## Aktarım sonrası zorunlu test kapıları

1. Gerçek Worker modülünü Cloudflare'ın yerel test runtime'ına (Workers Vitest
   pool / Miniflare) bağlayın; production binding yerine yerel test binding'leri
   ve sentetik veri kullanın. `PUSH_KV` için yalnız yerel test namespace kullanın;
   production aboneliklerini okumayın veya kopyalamayın. Dakikalık cron davranışını
   izole saatle doğrulayın, production cron'u tetiklemeyin.
   Eksik kaynak skip'lerini gerçek handler testleriyle
   değiştirin. `scheduled()` olayını doğrudan tetikleyin; zaman dilimi, aynı olayın
   tekrarı, kaçırılan dakika, retry ve 404/410 temizliğini doğrulayın.
2. Abonelik API'sinde kimlik doğrulama, cihazlar arası izolasyon, şema ve CORS
   sınırlarını test edin. Push taşıyıcısını mock'layın. CI'ye gerçek endpoint/key
   koymayın. Gerçek cihaz teslim testi daha sonra ayrı ve izinli yapılmalı.
3. Playwright ile gerçek aktarılmış assets üzerinde localStorage'ı sentetik veriyle
   doldurun. Eski-yeni sürüm, reload, offline, iki sekme, kota hatası, bozuk yedek,
   içe aktarma rollback ve fotoğraflı büyük yedeği test edin.
4. Service worker güncellemesinde eski açık sekme, yeni assets, cache sürümü,
   notificationclick ve diğer uygulama cache'lerinin korunmasını sınayın.
5. Canlı anahtar listesini doğrulayın. Şu an bilinen MVP anahtarlarını silmeyin veya
   yeniden adlandırmayın: `ilac_drugs_v2`, `ilac_log_v2`, `ilac_history_v2`,
   `ilac_focus_photo_size_v1`, `ilac_fcm_token_v1`, `ilac_test_device_token_v1`.
   Eski token anahtarını korumak Firebase'i yeniden etkinleştirme gerekçesi değildir.
   Canlı sürümde ek anahtarlar olabilir; bunların envanteri henüz yok.
6. Aynı origin'i korumak esastır. Farklı test Worker adresi gerçek localStorage'ı
   paylaşmaz; boş test profili gerçek veri kaybı kanıtı değildir. Kullanıcı yedeği
   ve geri yükleme provası olmadan origin/şema geçişi yapılmamalı.

## Dağıtım sınırı

Bu değişikliklerde deploy script'i, Cloudflare token'ı, production route'u veya
aktif cron eklenmedi. `workers_dev: false` tek başına deploy kilidi değildir.
Build hook da yetki sistemi değildir. Cloudflare Builds production branch bağlantısı
bu PR kapsamında kurulmaz. Üretim deploy'u ve ilk cron etkinleştirmesi sonraki,
açıkça yetkilendirilmiş işin konusu olmalıdır. Öncesinde canlı sürüme geri dönüş
ve veri şeması geriye uyumluluğu kanıtlanmalıdır.

## 2026-11-03 — Cloudflare API üzerinden doğrulanan salt-okunur envanter

Bu bölüm canlı Cloudflare hesabındaki **okuma** isteklerine dayanır; kaynak dosyası henüz depoya aktarılmamıştır.

- Worker: `ilac-takip-mono-preview`
- Compatibility date: `2026-10-01`
- Compatibility flags: `[]`
- Usage model: `standard`
- Binding: `PUSH_KV` (`kv_namespace`); namespace ID'si ve içeriği burada yayımlanmaz.
- Cron: `* * * * *` (her dakika), Cloudflare schedules API ile doğrulandı.
- Workers Scripts API ile canlı kaynak yaklaşık 48.619 karakterlik multipart yanıt olarak okunabiliyor. Yanıtta `async fetch(`, `async scheduled(` ve `/api/push/sync` izleri doğrulandı.
- Bu kontroller **kaynak aktarımı, güvenlik taraması veya canlı cihaz bildirimi testi değildir**. Kaynakta sır bulunmadığı sonucu çıkarılamaz.

### Aktarım kapısı

Canlı kaynak public depoya eklenmeden önce yerel/güvenli bir ortamda VAPID özel anahtarları, gömülü tokenlar, abonelik endpointleri ve kişisel veri açısından incelenmeli. Sırlar koddan ayrılıp Cloudflare secret binding olarak yönetilmeli. Kaynak hash/manifest ile belgelenmeden `check:import` başarılı kabul edilmemeli. Canlı Worker'a otomatik veya manuel deploy yapılmamalı.
