# ESSVB-Reader Mobil Kurulum Rehberi (Samsung Galaxy S21 FE & iPad 9. Nesil)

ESSVB-Reader `v0.2.2` sürümünden itibaren sıfır telemetri ve çevrimdışı çalışma ilkelerini koruyarak Android, iPadOS ve iPad Safari PWA platformlarını destekler.

---

## 1. Samsung Galaxy S21 FE (Android `.apk`)

1. [GitHub Releases](https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/latest) sayfasından **`ESSVB-Reader-0.2.2-android-arm64.apk`** dosyasını telefonunuza indirin.
2. İndirilen dosyaya dokunun ve ilk kez kuruyorsanız Android ayarlarından **Bilinmeyen uygulamalardan yükle** iznini verin.
3. **Çevrimdışı Türkçe Sesli Okuma:**
   - Telefonunuzda *Ayarlar > Genel yönetim > Metin-konuşma çıktısı* (Samsung TTS veya Google Speech Services) bölümünden **Türkçe (tr-TR)** ses paketinin çevrimdışı indirildiğinden emin olun.
   - Uygulama doğrudan cihaz içi `TextToSpeech` motorunu (`EssvbTtsPlugin`) kullanır; ekran kapalıyken de medya bildirimiyle okuma devam eder.
4. **Desteklenen Dosyalar:** `.epub`, `.pdf`, `.docx`, `.doc`.

---

## 2. iPad 9. Nesil — Yerel Uygulama (`.ipa`)

Apple App Store dışından yüklemek için ücretsiz **AltStore** veya **Sideloadly** kullanabilirsiniz (Apple geliştirici hesabı olmadan ücretsiz kişisel Apple ID ile çalışır, 7 günde bir Wi-Fi üzerinden yenilenir):

1. GitHub Releases sayfasından **`ESSVB-Reader-0.2.2-ipad-ios-unsigned.ipa`** dosyasını bilgisayarınıza indirin.
2. Bilgisayarınızda **AltServer / AltStore** veya **Sideloadly**'yi açıp iPad'i USB/Wi-Fi ile bağlayın, kendi Apple ID'nizle `.ipa` paketini imzalayıp yükleyin.
3. iPad'de *Ayarlar > Genel > VPN ve Aygıt Yönetimi* altından profilinize **Güven** verin.
4. **Arka Plan & Türkçe Sesli Okuma:**
   - Uygulama arka plan ses modu (`UIBackgroundModes: audio`) ile iOS'un yerel **AVSpeechSynthesizer** motorunu kullanır (Ayarlar > Erişilebilirlik > Sesli İçerik > Sesler > Türkçe bölümünden **Yelda / Cem** sesini indirebilirsiniz).
   - **Dosyalar (Files)** uygulamasından EPUB, PDF ve DOC/DOCX kitaplarınızı doğrudan açabilirsiniz.

---

## 3. iPad 9. Nesil — Bilgisayarsız Çevrimdışı PWA (Safari Ana Ekrana Ekle)

Bilgisayar veya 7 günlük yenileme olmadan kullanmak için:

1. `ESSVB-Reader-0.2.2-pwa-offline.zip` arşivini kendi ağınızda/GitHub Pages'de açın (veya repo Ayarlar > Pages > GitHub Actions etkinleştirildiyse `https://ibrahimsaglammm.github.io/ESSVB-Reader/` adresini Safari'de açın).
2. iPad Safari'de sağ üstteki **Paylaş (Share)** simgesine dokunun ve **Ana Ekrana Ekle**'yi seçin.
3. Uygulama tam ekran modunda çalışır (`manifest.webmanifest` + `sw.js`); eklediğiniz `.epub`, `.docx` ve `.txt` kitaplar cihazınızın yerel **IndexedDB** alanında güvenle saklanır ve internet olmadan açılır.
4. *Not:* PWA sürümü Safari'nin `speechSynthesis` motorunu kullanır; PDF ve eski `.doc` dosyaları ile ekran kilitliyken kesintisiz sesli okuma için `.ipa` veya Android `.apk` sürümünü kullanmanız önerilir.
