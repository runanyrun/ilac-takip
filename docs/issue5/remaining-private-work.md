# Yönetici takibi: özel erişim bekleniyor

Dayanak: Issue #5 yönetici yorumu `6612043466` (2026-11-03). P4 hazırlığı kabul
edildi; üretim onayı verilmedi. Bu devam adımında uygulama kodu değiştirilmedi ve
sentetik regresyonlar tekrar çalıştırılarak üretim hazır sonucu üretilmedi.

## Tek somut engel ve minimum eylem

**Engel: gerçek Worker'ın onaylı kaynak/provenance dosyasına, read-consumer
incelemesine ve ağ erişimi kapalı gerçek-modül harness'ine aynı yetkili özel
çalışma ortamında erişim yok.** Mevcut Cloudflare bağlantısının salt okunur metadata
analizi bunu karşılamıyor. Bu checkout'ta reviewed entry module veya private-transfer
alanı yok; yapılandırılmış özel kaynak mount'u/credential binding'i de bulunmuyor.

Buna bağlı üç iş **BEKLEMEDE**: P4 diagnostic-only kanıtı; gerçek orijinal/aday
karşılaştırmalı testler; gerçek rollback provası. Yeni bir gerçek aday veya yeni
üretim testi sonucu yok. Kaynak kapısı değiştirilmedi; Issue #4/#5 açık kalır.

**Kullanıcıdan gereken minimum eylem:** onaylı gerçek kaynağın zaten bulunduğu özel
geliştirme/test ortamına yetkili erişim sağlamak veya aynı kontrol paketini o
ortamdaki yetkili geliştiriciye işletmek. Kaynağı/secrets'ı GitHub'a, sohbete ya da
bu public checkout'a yapıştırmak/göndermek gerekmiyor. Güvenlik denetimini aşacak
bir aktarım seçeneği önerilmiyor. Ortam mevcut değilse bu erişime bağlı işler
beklemede kalır; tekrar tekrar sentetik test çalıştırmak engeli çözmez.

[iPhone kısa kontrol listesi](iphone-kontrol-listesi.md) bağımsız olarak hazırlandı.
Kullanıcıdan şimdi simge silmesi, kurulum/izin değiştirmesi veya veri taşıması
istenmiyor. Ekran görüntüsü/yedeklerin paylaşılması da bu engelin çözümü değildir.

## Açık risk takibi

| Kalem | Açık risk / gerekli kanıt | Kabul koşulu | Durum |
| --- | --- | --- | --- |
| P4 okuyucuları / yan etkiler | Metadata kaydının status ekranı dışında functional state, lease, dedup veya timezone kararında kullanılmadığı kanıtlanmadı; alias/dinamik key okuyucuları özel inceleme ister | Gerçek kaynak hash'ine bağlı bütün okuyucular/yan etkiler listesi; kaldırma sonrası durum ekranı yanlış “cron durdu” demiyor; yalnız tek ifade farkı | Özel erişim bekliyor |
| P3 sync / 429 sınıflandırması | PUT/storage hatası generic 400'e dönüşebilir; aynı veri/TTL yenilemesi ve paralel güncelleme semantiği doğrulanmadı | Gerçek 400 validation ile storage geçici hatası ayrılıyor; bilinen quota/rate-limit durumu açıkça sınıflandırılıyor; saved/revision ancak kalıcı başarıdan sonra; idempotent reconcile + bounded backoff; expiry korunuyor | Özel erişim bekliyor |
| P5 teslimat durumu | Provider kabulünden sonra durum yazması başarısız olursa catch devam edebilir | Kabul edilmiş ama commit edilmemiş olay “belirsiz” olarak uzlaştırılıyor; yeniden gönderim politikası açık; diagnostic-only kanıtı olmadan yazma kaldırılmıyor | Özel erişim bekliyor |
| P6 dedup / retry | KV get-then-put atomik değil; marker 429 veya crash yinelenen gönderime yol açabilir | Sabit occurrence kimliği, doğru sahiplik/claim; overlap/crash/Retry-After senaryoları; exactly-once iddiası yok; marker sessizce atlanmıyor | Özel erişim bekliyor |
| P7 bakım / eşzamanlı yenileme | Eski snapshot yeni P3 plan/aboneliğini ezebilir; gereksiz yazma atlanırken TTL kaybolabilir | Yalnız kanıtlanmış timestamp-only bakım kaldırılıyor; gerçek değişiklik revision/seri yazıcı ile korunuyor; 404/410 cleanup yalnız eski subscription version'ını etkiliyor | Özel erişim bekliyor |

429 tek başına günlük kota ile aynı anahtara saniyelik yazma sınırını ayırt etmez.
Geçmiş kullanıcı kota bildirimi ve aggregate analytics ayrı kanıtlar olarak korunur;
429 grubu dönmemesi veya sentetik retry testi gerçek hatanın yokluğunu kanıtlamaz.
Retry süresi/TTL politikası için bu adımda yeni değer seçilmedi.

## Gerçek modül ve rollback kabul kapısı

Aşağıdaki ölçütler **hazırlandı, uygulanmış test sonucu değildir**. Hepsi aynı
özel kaynak sürümü ve kapalı ağlı fake KV/provider ortamında tamamlanmalı:

- [ ] Orijinal deployment kimliği, kaynak/modül hash'leri, compatibility ayarları,
  binding referansları ve cron kaydı özel ortamda doğrulandı; config ve veri
  yedeğinin okunabilirliği doğrulandı. Gizli değerler rapora alınmadı.
- [ ] P4'ün tüm okuyanları, alias'ları, argüman yan etkileri incelendi; diagnostic-only
  kararı bağımsız reviewer tarafından kaydedildi. Status okuyucusu yok/stale
  heartbeat'i güvenli biçimde ifade ediyor, functional state buna dayanmıyor.
- [ ] Gerçek orijinal/aday kaynak farkı yalnız P4 ifadesi; diğer PUT'lar, API,
  manifest, varlıklar, abonelik/ilaç alanları, doz saatleri ve timezone davranışı
  aynı. Matcher reddederse force/guard gevşetme yerine özel manuel inceleme var.
- [ ] Gerçek handler'da 1.440 boş tur ve 1/2/100 cihaz trace karşılaştırması yapıldı;
  P4 girişimi yok, P3/P5/P6/P7 trace/state/TTL farkları açıklandı. P4'ün eski 429'u
  nedeniyle önceden yarıda kalan işin artık devam etmesi ayrıca ölçüldü.
- [ ] Gerçek modülde P3/P5/P6/P7 persistence hatası, provider kabulü sonrası crash,
  overlap, gecikmiş tur, DST ve eşzamanlı renewal/404/410 senaryoları çalıştırıldı.
  Mevcut baseline hataları “parite var” diye giderilmiş sayılmadı.
- [ ] Fake binding'lerin aynı state snapshot'ıyla **orijinal → aday → orijinal**
  rollback provası yapıldı; occurrence/dedup ledger uzlaştırıldı. Yeni abonelikler
  veya gerçek ilaç kayıtları eski snapshot ile ezilmiyor; kabul edilmiş teslimat
  tekrar gönderilmek üzere sıfırlanmıyor. Veri silme/yeniden enrollment yok.
- [ ] Rollback'in P4 yazma maliyetini ve eski 429 davranışını geri getirebileceği
  kaydedildi; başarısızlık halinde otomatik deploy/cron değişikliği yok. Gelecekteki
  gerçek rollback/deploy için ayrı kullanıcı onayı gerekiyor.
- [ ] Kaynak içermeyen yalnız pass/fail, işlem sayıları ve artifact hash'leri raporlandı;
  reviewed source-import, fiziksel cihaz ve ayrı dağıtım kabul koşulları korunuyor.

Bu kapı tamamlanmadan ne P4 gerçek düzeltmesi ne tüm KV kotası sorununun çözümü
ne de tek-PWA geçişi tamamlandı olarak işaretlenir. D1 referans kuyruğu bağlanmaz.
