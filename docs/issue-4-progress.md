> Bu dosya önceki PR #3 aşamasının kaydıdır. Güncel entegrasyon/test durumu: [Issue #5 uygulaması](issue5/implementation.md). Canlıya dağıtım yapılmadı.

# Issue #4 — PR #3 üzerinde veri koruma ve güvenlik

Bu çalışma PR #3'ün `1c62d53` commit'inden devam eder; aynı dal kullanılır.
Canlı kaynak yerine **eski MVP ve hazırlık/test altyapısı** düzeltilmiştir.
Cloudflare deploy, Git Builds değişikliği, KV erişimi, yeni Worker veya origin
değişikliği yapılmamıştır. OneSignal/Firebase entegrasyonu eklenmemiştir.

## Önce çalıştırılan testler

PR #3 güncel hali: `npm test` → 18 test, 11 geçti, 2 TODO assertion başarısız,
5 canlı-kaynak senaryosu atlandı. Açılışta yeniden yazmayı engelleyen PR düzeltmesi
korundu; yalnız bu kontrol daha sonraki kullanıcı yazmalarını korumuyordu.

## Uygulanan düzeltmeler

- `src/safety.js`: mevcut anahtarlarda şekil/sürüm/saat/kimlik/doz/stok doğrulaması.
  Bozuk veya desteklenmeyen kayıtlar sessizce boş listeyle değiştirilmez; kalıcı
  yazmalar durdurulur. Kullanıcıya uyarı ve yalnız ilaç/alım/geçmiş anahtarlarını
  içeren ham kurtarma dosyası dışa aktarma seçeneği sunulur. Token'lar dahil edilmez.
- İlaç, stok, doz ve geçmiş değişiklikleri birlikte doğrulanır. Yakalanan depolama
  hatasında yazılmış anahtarlar eski ham değerlerine, uygulama belleği eski durumuna
  döner. Başka sekmenin farklı verisi görülürse yazma reddedilir. Geri alma da
  başarısız olursa yazmalar durdurulur ve kurtarma uyarısı verilir.
- Yedek içe aktarma aynı korumayı kullanır; bozuk sürüm, hatalı id/saat/stok ve
  yinelenen kayıtlar reddedilir. Eski sürümsüz `{drugs,takenLog}` biçimi korunur.
- İlaç adı, doktor/hastane, not, saat ve geçmiş alanları HTML ve attribute bağlamında
  escape edilir. Fotoğrafta yalnız base64 JPEG/PNG/WebP görüntülenir; SVG, script
  ve harici URL'ler gösterilmez. Ham depolanan fotoğraf kendiliğinden silinmez.
- ALDIM kaydı artık animasyon gecikmesinden sonra değil, işlem sırasında saklanır.
  Stok yoksa alım reddedilir; atlama stok düşürmez. Aynı saatli alarmlar birbirini
  iptal etmez; silinen ilacın zamanlayıcısı yeniden kurulan planla temizlenir.
- SW cache temizliği uygulama önekiyle sınırlandı, HTTP hata yanıtında cache fallback
  eklendi, sürüm sorgularını yok sayan eşleştirme kaldırıldı. Safety modülü offline
  kabuğa eklendi. Yeni SW açık sayfayı otomatik devralmak yerine kullanıcı yenileme
  eylemiyle etkinleşir. Bildirim tıklaması başka origin'e yönlendiremez.
- Eski Node Push demosu artık en az 32 karakterlik özel `PUSH_DEMO_TOKEN` olmadan
  başlamaz; istekleri Bearer token ile kontrol eder, CORS'u kapatır ve yalnız
  `127.0.0.1` dinler. Bu tek yöneticili demo **çok kullanıcılı üretim servisi değildir**.
  Mevcut demo curl istemcileri token başlığı gerektirir; canlı API değiştirilmedi.

## Doğrulama

- `npm test`: 27 senaryo; 22 geçti, 5 atlandı, 0 TODO, 0 beklenmeyen hata.
- `npm run test:browser`: 5 Chromium testi geçti. CRUD, alım/geri alma/atlama,
  geçmiş, reload/offline, HTML enjeksiyonu, bozuk veri, yedek roundtrip ve kota
  hatasında koruma gerçek DOM ve localStorage üzerinde sentetik verilerle çalıştı.
- Ortamdaki Chromium ile komut:
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser`.
  Diğer ortamlarda `npm ci --ignore-scripts` ve `npx playwright install chromium`
  sonrasında `npm run test:browser` kullanılabilir.
- CI'ye aynı lockfile kurulumu, Chromium kurulumu ve browser komutu eklendi.
  Yerel başarı GitHub Actions'ın çalışıp başarılı olduğu iddiası değildir.
- JavaScript sözdizimi ve `git diff --check` kontrolleri geçti.
- `check:import` gerçek kaynak/manifest eksikliğinde hata vermeye devam eder.

## Tamamlanmayan kabul kriterleri / sınırlar

1. Canlı Worker dosyaları ve import manifesti hâlâ yok. PR #3'te kaydedilmiş API
   envanteri korunmuştur; bu oturumda Cloudflare kaynak okuma aracı yoktur.
   Güvenli kaynak aktarımı için `cloudflare-migration.md` adımlarını izleyin.
   Gerçek `scheduled`, retry, 404/410, birden çok cihaz ve API izolasyonuna ait beş
   test bu nedenle atlanır; bunlar başarılı sayılmaz. Issue #4 tamamen bitmedi.
2. Gerçek iPhone'da kurulum, izin ve uygulama kapalıyken teslim testi yapılmadı.
   Sağlayıcı HTTP 201 cevabı cihaz teslimi kanıtı değildir.
3. localStorage çok anahtarlı işlem veya süreçler arası kilit sağlamaz. Yakalanmış
   yazma hataları geri alınır; tam süreç/cihaz kapanması veya aynı anda iki sekmenin
   kontrol-yazma aralığına girmesi için atomiklik garantisi verilmez. Tam çözüm,
   gerçek kaynak ve uyumlu veri geçişiyle IndexedDB transaction/Web Locks gibi
   bir mekanizmanın ayrıca değerlendirilmesini gerektirir.
4. Ham kurtarma dosyası otomatik içe alınmaz: bozuk kayda doğrudan yazmak yerine
   kullanıcı verisini korur; dosya yerelde incelenip geçerli yedeğe dönüştürülmeli.
   Şekil doğrulaması önceki uyumsuz veriyi gizleyebilir, fakat anahtarları silmez.
5. Mevcut geçmişin 200 olay sınırı, tarayıcı depolamasının kullanıcı tarafından
   silinebilmesi, düz metin yedekler, 5 MB içe aktarma sınırı, tedavi/doz anlamı ve
   kapalı tarayıcıdaki yerel timer sınırlamaları ayrıca ele alınmalıdır. Kritik
   ilaç hatırlatmaları yalnız yerel timer'a dayandırılmamalıdır.
6. Gerçek eski-yeni canlı cache geçişi, gerçek API yetkilendirmesi ve geri dönüş
   provası kaynak aktarılmadan doğrulanamaz. Production deploy yapılmamalıdır.
