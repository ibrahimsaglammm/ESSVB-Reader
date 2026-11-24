# ESSVB-Reader Mimari, Güvenlik ve Gizlilik Kararları (`KARARLAR.md`)

Bu belge, gereksinimlerdeki belirsiz veya birbiriyle gerilim oluşturabilecek noktalar için seçilen **en güvenli ve en gizlilik dostu** kararları kayıt altına alır.

---

## K1. Lisans ve Temiz Oda (Clean-Room) İlkesi
- **Karar:** ESSVB-Reader %100 sıfırdan (clean-room) yazılacak ve **MIT** lisansı ile sunulacaktır.
- **Gerekçe:** Referans alınan `koodo-reader-dev` ve `readest-main` AGPL-3.0 lisanslıdır ve Koodo içinde kapalı kaynak/uyumsuz lisanslı bileşenler mevcuttur. Sıfırdan üretim, hem tam lisans temizliği hem de en küçük kod/bağımlılık yüzeyi sağlar.

## K2. Teknoloji Yığını: Tauri v2 (Rust) + React 19 + TypeScript + Vite
- **Karar:** Çekirdek (ZIP koruması, EPUB2/3 ayrıştırma, HTML/CSS sanitizasyonu, SQLite veritabanı, OS anahtar deposu, TTS motorları, yerel önbellek, yedekleme) tamamen **Rust** ile; arayüz **React + TypeScript + Vite** ile yazılır.
- **Gerekçe:** Electron'da görülen dev saldırı yüzeyi, eski Node/Chromium bağımlılıkları ve preload-RCE riskleri ortadan kalkar. `tauri-plugin-http`, `tauri-plugin-shell`, `tauri-plugin-fs` ve `tauri-plugin-updater` gibi geniş yetkili eklentiler **projeye hiç eklenmez**. Yalnızca `tauri-plugin-dialog` (kullanıcının seçtiği dosya/klasör yolları için) tanımlanır.

## K3. Sürüm `0.1.0`, GitHub Üzerinden Sürekli Güncelleme Kontrolü ve Kullanıcı Onayı
- **Gerilim ve Kullanıcı Talebi:** Başlangıç gizlilik analizinde varsayılan olarak dış ağ çağrısı yapılmaması hedeflenmişti; ancak kullanıcı açık talebiyle uygulamanın **GitHub deposundan (`ibrahimsaglammm/ESSVB-Reader`) sürekli güncelleme kontrolü yapmasını ve güncellemeleri kullanıcıya sorarak uygulamasını** istemiştir.
- **Karar:**
  1. Uygulama sürümü `0.1.0` (Hazırlık Aşaması) olarak `package.json`, `Cargo.toml`, `tauri.conf.json` ve `PKGBUILD` dosyalarına işlenir ve **Hakkında** ekranında açıkça gösterilir.
  2. Varsayılan güncelleme uç noktası resmi GitHub Releases API adresidir (`https://api.github.com/repos/ibrahimsaglammm/ESSVB-Reader/releases/latest`).
  3. **Sürekli Kontrol (Açılışta + Periyodik):** `auto_update_enabled` varsayılan olarak etkindir; açılışta ve ayarlanan aralıkta (varsayılan `60` dakika, `5..1440` dk aralığında ayarlanabilir ve Ayarlar > Gizlilik & Güncelleme içinden tek tıkla tamamen kapatılabilir) GitHub Releases kontrol edilir. Bunun dışında uygulamada hâlâ **0 telemetri, 0 analitik, 0 çökme raporu ve 0 font CDN** vardır.
  4. **Kullanıcı Onayı Zorunluluğu:** Yeni sürüm algılandığında uygulama asla sessizce dosya indirmez veya çalıştırmaz. Doğrudan sürüm notları ve platform paketini (Windows 11 `.exe`/`.msi`/`.zip` veya CachyOS `.pkg.tar.zst`/`.AppImage`) gösteren bir onay penceresi açılır. Yalnızca kullanıcı **"Evet, İndir ve Kur"** derse yalnızca resmi `github.com` / `*.githubusercontent.com` HTTPS adreslerinden indirme yapılır, `SHA-256` özeti doğrulanır ve kurulum başlatılır.

## K4. Üç Katmanlı EPUB İçerik Sandbox'ı
- **Karar:**
  1. **Rust HTML5 + CSS Sanitizasyonu (`ammonia`):** EPUB XHTML dosyalarındaki `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<meta>`, `<base>`, `<link>`, `<audio>`, `<video>`, `<svg>` ve tüm `on*` olay işleyicileri ile `javascript:`/`vbscript:` URI'ları ayrıştırma anında temizlenir. Harici `http(s)://` resim ve stil referansları tamamen kaldırılır. Yerel EPUB resimleri (boyut/oran kontrolü sonrası) güvenli `data:` URI olarak gömülür; yerel CSS içindeki `@import`, `url(...)`, `expression()` kaldırılır.
  2. **Opak Sandbox Iframe:** Bölüm içeriği `<iframe sandbox="allow-same-origin" srcDoc={...}>` içinde render edilir. `allow-scripts`, `allow-forms`, `allow-popups` ve `allow-top-navigation` **kesinlikle kapalıdır** (Readest/Koodo'daki "Script'e İzin Ver" tehlikesi yoktur).
  3. **Çift CSP:** Hem `tauri.conf.json` ana pencere CSP'sinde hem de bölüm HTML'inin `<meta http-equiv="Content-Security-Policy">` etiketinde `script-src 'none'; connect-src 'none'; img-src data:; default-src 'none'` uygulanır.

## K5. ZIP-Slip ve ZIP-Bomb Korumaları
- **Karar:** Rust `zip` sandığı varsayılan özellikleri kapatılarak (`deflate` ile) kullanılır. Hiçbir dosya diske açılmaz; yalnızca bellekte doğrulanarak okunur.
  - Yol doğrulama: `..`, baştaki `/` veya `\`, sürücü harfi (`:`), kontrol/NUL karakterleri reddedilir.
  - Boyut/oran limitleri: EPUB dosya boyutu en fazla `250 MiB`, girdi sayısı en fazla `10.000`, XML/XHTML girdi en fazla `8 MiB`, görsel girdi en fazla `15 MiB`, toplam açılmış boyut en fazla `512 MiB`, sıkıştırma oranı (>1 MiB girdilerde) en fazla `100:1`. ZIP başlık (header) boyutuna güvenilmez; `Read::take(limit + 1)` ile gerçek akış sayılır.

## K6. Türkçe TTS Mimarisi (WinRT Tolga, Linux Piper/espeak-ng, Localhost Ollama, Opt-in Gemini)
- **Karar 1 (Windows 11 — Microsoft Tolga):** Sistem incelemesinde `Microsoft Tolga` (`tr-TR`) sesinin eski `System.Speech` API'sinde değil **Windows OneCore / WinRT** (`Windows.Media.SpeechSynthesis.SpeechSynthesizer`) katmanında kurulu olduğu doğrulandı. PowerShell alt süreci açmak (Koodo'daki enjeksiyon riski) yerine `windows` Rust sandığı üzerinden doğrudan bellek içi WAV sentezi yapılır.
- **Karar 2 (CachyOS / Arch Linux):** Önce `piper` / `piper-tts` (Türkçe `.onnx` modeli varsa) ve ardından `espeak-ng` (`-v tr`) `tokio::process::Command` ile kabuk (shell) çağırmadan doğrudan `stdin` borulaması ile kullanılır. Kurulu değilse arayüzde Arch/CachyOS kurulum yönergesi (`sudo pacman -S espeak-ng` / `piper-tts-bin`) gösterilir.
- **Karar 3 (Yerel Ollama):** Yalnızca `http://localhost:...`, `http://127.0.0.1:...` ve `http://[::1]:...` adreslerine izin verilir (kullanıcı/parola bilgili veya dış host URL'leri reddedilir). Seçilen model metni Türkçe telaffuz/noktalama açısından hazırlar ve üretilen metin yerel çevrimdışı ses motoruna (Tolga veya Linux yerel TTS) gönderilir.
- **Karar 4 (Gemini TTS):** Varsayılan olarak **KAPALI**dır. Etkinleştirmek için hem açık anahtar (toggle) hem OS anahtar deposundan (`keyring`: Windows Credential Manager / Linux libsecret) API anahtarı hem de **gönderim öncesi metin paylaşım onayı** gerekir. API anahtarı URL sorgusuna değil yalnızca `x-goog-api-key` başlığına konur.
- **Karar 5 (Otomatik Geçiş Yok):** Seçili sağlayıcı hata verirse kullanıcıya açık hata gösterilir; kullanıcı onayı olmadan başka bir sağlayıcıya (özellikle bulut Gemini'ye) **asla** otomatik geçilmez.

## K7. Depolama, Gizli Anahtarlar ve Taşınabilir (Portable) Mod
- **Karar:** Tüm kütüphane, raflar, etiketler, notlar, vurgular ve uygulama ayarları gömülü `rusqlite` (SQLite) veritabanında tutulur. API anahtarları **asla** SQLite'a veya JSON yedeğine yazılmaz; yalnızca OS anahtar deposunda (`keyring`) tutulur. Çalıştırılabilir dosyanın yanında `portable.txt` (veya `.portable`) dosyası varsa tüm uygulama verileri `<exe_dir>/data/` altında saklanır.
