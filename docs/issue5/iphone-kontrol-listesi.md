# iPhone: tek PWA öncesi kısa kontrol listesi

Amaç yalnız mevcut kurulumları ve yedekleri tanımak. Bu liste **simge silme,
yeniden kurma, veri taşıma veya içe aktarma gerektirmez**; geçiş/deploy onayı değildir.
Şimdi telefon üzerinde işlem yapmanız zorunlu değil; kontrol gerektiğinde kullanın.
Önceden açık ekranlar ve mevcut dosyalar yeterli olabilir; uygulama açık değilse
adımları atlayıp “doğrulanamadı” yazabilirsiniz. Zorla yenileme/güncelleme yapmayın.

1. **Simgeleri tanıyın.** Ana ekranın ekran görüntüsünü alın; benzer uygulamaları
   kendi notunuzda A/B diye ayırın. Simgeleri silmeyin, yeniden adlandırmayın veya
   yeni kurulum eklemeyin. Aynı simge/ad, aynı uygulama olduğunun kanıtı değildir.
2. **Adres bilgisini kaydedin.** Mevcut uygulamada görünen site adresi varsa ekran
   görüntüsüyle birlikte yalnız `https://alan-adı[:port]` kısmını not edin. Adres
   görünmüyorsa **“origin doğrulanamadı”** yazın; tahmin etmeyin. Safari'de benzer
   bir adresin açık olması, ana ekrandaki simgenin aynı origin'e ait olduğunu
   tek başına kanıtlamaz. Geliştirici ayrıca manifest kimliği/scope'u doğrulayacak.
3. **Görünen kayıtları kontrol edin.** İlaç sayısı, görünen doz saatleri, stok ve
   geçmişi yalnız okuyun; gerekirse kendi cihazınızda ekran görüntüsü saklayın.
   ALDIM/ATLADIM/GERİ AL, düzenle, bildirim testi veya izin değiştirme işlemi yapmayın.
4. **Yalnız dışa aktarımı doğrulayın.** Mevcut “Yedekle/Dışa aktar” seçeneğiyle
   Dosyalar'a bir kopya kaydedilebiliyorsa dosyanın varlığını, tarihini ve sıfırdan
   büyük boyutunu kontrol edin. Önizlemede mevcut ilaçlar, saatler ve geçmişin
   bulunup bulunmadığına bakın; dosyayı düzenlemeyin. Bir alan yoksa/okunamıyorsa
   “doğrulanamadı” yazın. Silme, veriyi değiştirme, buluta yükleme veya aboneliği
   yenileme isteyen bir adım çıkarsa devam etmeyin. **İçe aktar/geri yükle yapmayın.**
5. **Kısa sonucu saklayın.** Aşağıdaki tablo yeterli. İndirilebilmiş bir dosya,
   kayıpsız geri yüklenebilir olduğunun kanıtı değildir; biçim ve round-trip testi
   daha sonra özel ortamda bir kopyayla yapılacak. Bu aşamada eski kurulum kalır.

| Simge | Görünen origin / doğrulanamadı | Yedek oluştu mu? / boyut-tarih | Kayıt-saat-geçmiş karşılaştırması |
| --- | --- | --- | --- |
| A | | | Uyumlu / eksik / doğrulanamadı |
| B (varsa) | | | Uyumlu / eksik / doğrulanamadı |

Ekran görüntüleri ve yedekler kişisel sağlık bilgisi içerebilir: **GitHub'a veya
sohbete yüklemeyin**; kendi özel depolamanızda tutun. Paylaşılacak durum özeti
ilaç/hasta adı, reçete, token, abonelik endpoint'i veya URL sorgu parametresi
olmamalı. Gerekirse yalnız redakte edilmiş origin ve “doğrulandı/doğrulanamadı”
sonucunu iletin; kaynak kodu veya secret paylaşmanız istenmiyor.

Farklı origin'ler birbirlerinin localStorage verisini otomatik okuyamaz. Aynı
origin de tek başına aynı manifest kimliği/aynı kurulum demek değildir. Bu liste
hiçbir kaydı birleştirmez, mevcut uygulamayı güncellemez ve simge kaldırmaya izin
vermez. Fiziksel iPhone doğrulaması henüz yapılmış sayılmıyor.
