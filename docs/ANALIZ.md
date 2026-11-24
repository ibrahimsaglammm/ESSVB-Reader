# Mevcut EPUB Okuyucuların Teknik, Gizlilik, Güvenlik ve Lisans Analizi (Aşama 1)

**Hazırlayan:** Ajan A – Analiz ve Güvenlik Denetçisi  
**Tarih:** 24 Kasım 2026  
**İncelenen Referans Projeler (Salt Okunur — Hiçbir Dosya Değiştirilmedi):**
1. `koodo-reader-dev` (`v2.4.9`, Electron + React + TypeScript + kapalı kaynak `kookit`)
2. `readest-main` (`v0.12.20`, Tauri v2 + Next.js + Rust)

---

## 1. İki Projenin Teknoloji Yığını, Lisansı ve Bağımlılık Karşılaştırması

| Özellik | Koodo Reader (`koodo-reader-dev`) | Readest (`readest-main`) |
|---|---|---|
| **Sürüm** | `2.4.9` (`package.json:4`) | `0.12.20` (`apps/readest-app/package.json:3`), Rust crate `0.2.2` (`apps/readest-app/src-tauri/Cargo.toml:3`) |
| **Masaüstü Çerçevesi** | Electron `35.7.5` (`package.json:84`, `yarn.lock`) | Tauri v2 `2.11.5` (özel fork `packages/tauri`, `Cargo.toml:49`) — Windows/macOS'ta Wry, Linux'ta CEF (`src-tauri/Cargo.toml:17-29`) |
| **Ön Yüz (UI)** | React `19.3.1`, React Router `7.18.4`, Zustand `5.0.16`, Vite `6.4.5`, TS `5.9.3`, `i18next` (`package.json`) | Next.js `16.4.6`, React `19.2.9`, Tailwind CSS `4.3.3`, DaisyUI `5.7.22`, Zustand `5.0.10`, Zod `4.6.7`, TS (`apps/readest-app/package.json`) |
| **EPUB/Belge Motoru** | Kapalı kaynak `src/assets/lib/kookit.min.js` içine gömülü `foliate-js` türevi + `JSZip 3.10.1` / `fflate 0.8.2` + `public/lib/` altında `pdfjs 4.7.76`, `7z-wasm`, `libunrar`, `tesseractjs`, `onnxruntime-web 1.23.2` (`index.html:28-61`, `AGENTS.md:11-25`) | Forklanmış `packages/foliate-js` + Rust hızlı ayrıştırma (`epub_parser.rs`, `mobi_parser.rs`, `pdf_parser.rs`, `comic_parser.rs`) + `pdfjs-dist 6.2.108` + `@zip.js/zip.js 2.8.26` (`src-tauri/Cargo.toml:121-160`) |
| **Veritabanı / Depolama** | Masaüstü: `better-sqlite3 13.0.3` (`<userData>/uploads/data/config/*.db`, `main.js:71-74,446-467`), `electron-store 8.1.0`, `localStorage`; Web: `localforage` + `sqljs-wasm`; İsteğe bağlı Go HTTP/OPDS sunucu (`httpserver/main.go`, `modernc.org/sqlite`) | Yerel: `tauri-plugin-turso` / `@readest/turso-database-wasm` + `$APPDATA/settings.json` + `library.json`; Bulut: Supabase Postgres + Cloudflare R2 / S3 + Google Drive / OneDrive / WebDAV (`docs/architecture.md`) |
| **TTS Motorları** | Web Speech API, Koodo Pro Bulut TTS (`/api/v1/pro/reader/get_tts_audio`), 16 yerleşik ses eklentisi (Azure, Polly, OpenAI, ElevenLabs, Coqui, ChatTTS, Windows SAPI PowerShell `worker.ps1`) + SQLite'den `eval()` ile çalışan özel JS eklentileri (`main.js:108-142,1203-1253`, `sapi-util.js`) | Edge TTS WebSocket (`wss://api.msedgeservices.com/...`), Readest Voice GPU bulut TTS (`/api/tts/readest/*`), `tauri-plugin-native-tts` (`speech-dispatcher`, Android/iOS), Web Speech API, OpenAI-uyumlu özel TTS, EPUB3 Media Overlays |
| **Lisans** | **AGPL-3.0** (`LICENSE:1-661`), yazar: App by Troye (`package.json:6-8`) — **ancak repo içinde kapalı kaynak `kookit*.min.*` ve derlenmiş macOS OCR ikilileri var** | **AGPL-3.0-or-later** (`LICENSE:1-661`, `Cargo.toml:42`), hak sahibi: Bilingify LLC (`Cargo.toml:40`) |
| **Paketleme / Hedefler** | `electron-builder 26.16.1`: Win (NSIS/portable/zip/appx), macOS (DMG), Linux (Snap/DEB/RPM/AppImage) + Docker/Caddy | Tauri bundle: Win (NSIS/portable), macOS (DMG/AppStore), Linux (CEF AppImage/deb/rpm/Flatpak/Nix), Android, iOS, Cloudflare Workers Web |

---

## 2. Tespit Edilen Tüm Telemetri, Analitik, Çökme Raporlama, Güncelleme Kontrolü ve Dış Ağ Çağrıları

### 2.1 Koodo Reader (`koodo-reader-dev`)
Üçüncü parti SDK (Google Analytics, Sentry, Matomo vb.) bulunmamasına rağmen, uygulama **arka planda otomatik birinci parti ağ çağrıları, donanım parmak izi takibi ve CDN yüklemeleri** yapmaktadır:

| Tür | Hedef / Uç Nokta | Davranış ve Kanıt (`dosya:satır`) |
|---|---|---|
| **DNS Ön-Getirme** | `https://web.koodoreader.com` | Her açılışta DNS sorgusu tetikler (`index.html:6`). |
| **Otomatik Güncelleme Kontrolü** | `https://api.koodoreader.com/api/update`, `/api/update_dev` (ve `.cn`) | **Her açılışta koşulsuz çalışır**; `isDisableUpdate === "yes"` ayarı yalnızca diyalogu gizler, HTTP isteğini engellemez (`src/components/dialogs/updateDialog/component.tsx:43-55,80`, `src/utils/request/common.ts:15-44`). |
| **Cihaz Parmak İzi + Bildirim Anketi** | `POST https://api.koodoreader.com/api/get_notification` | OS donanım `node-machine-id` (`MachineGuid` / `/etc/machine-id`) değerini `device_uuid` olarak gönderir (`main.js:191-215,1548-1551`, `header/component.tsx:729-741`, `common.ts:238-251`). Web'de `clearAllData()` `fingerPrint` değerini silinip geri yazar (`src/utils/common.ts:1453-1463`). |
| **Koodo Cloud / Dev Test Sunucusu** | `https://cloudtestv2.960960.xyz` (aktif `CloudMode: "test"`), `https://cloud.koodoreader.com`, `.cn`, `http://192.168.28.159:8000` | Giriş, Pro AI/TTS/OCR, cihaz listesi ve **üçüncü parti OAuth token sunucu-taraflı şifreleme** (`/api/v1/pro/thirdparty/encrypt_token`) (`kookit-extra-browser.min.js`, `src/utils/request/thirdparty.ts:87-135`, `user.ts:67-85`). |
| **Harici URL'ye Cihaz ID Sızıntısı** | `https://koodoreader.com/<lang>/pricing`, `/faq` | `temp_token` ve donanım `device_uuid` bilgisini sorgu dizgesinde tarayıcıya ekler (`reader.ts:251-256`, `header/component.tsx:774-786,985-994`). |
| **Doğrulanmamış Kurulum İndirme** | `https://dl.koodoreader.com/v.../Koodo-Reader-...exe` | Ham `https.get()` ile `%TEMP%` içine indirip doğrudan çalıştırır (`main.js:1010-1073`). |
| **Dış CDN & Varlıklar** | `unpkg.com` (`tesseract.js-core@6.1.2`, `onnxruntime-web@1.23.2`), `tessdata.projectnaptha.com`, `storage.koodoreader.com/.cn`, `apis.google.com/js/api.js`, `dl.koodoreader.com/websites/google-picker.html`, `www.google.com` | OCR WASM/modelleri, fontlar, arka planlar, sözlükler ve proxy testi (`builtinOcrUtil.ts:8-10,45-46`, `fontUtil.ts:249-251`, `importDialog/component.tsx:332`, `network-util.js:115`). |
| **Discord Rich Presence** | Yerel Discord IPC (`1490863275074781305`) | Okunan kitap başlığı, yazarı ve yüzdeyi Discord'a yayınlar (`discord-rpc-util.js:5,57-81`). |

### 2.2 Readest (`readest-main`)
Readest çok sayıda **telemetri, çökme raporlama, otomatik yazı tipi CDN'i ve bulut servisini** varsayılan olarak etkinleştirir:

| Tür | Hedef / Uç Nokta | Davranış ve Kanıt (`dosya:satır`) |
|---|---|---|
| **PostHog Analitik** | `https://us.i.posthog.com` | `.env:5-6` içinde base64 gömülü anahtar; üretim derlemelerinde açılır (`PHContext.tsx:9-59`, `telemetry.ts:3-79`, `AuthContext.tsx:55`, `error.tsx:25`). |
| **Sentry Çökme Raporlama** | `https://*.sentry.io` | **Kullanıcı kapatma ayarı yok.** Derleme zamanında `SENTRY_DSN` verilmişse Rust panic + WebView JS + mobil çökmeleri otomatik gider (`src-tauri/Cargo.toml:162-189`, `lib.rs:472-480,568-634`, `sentry_config.rs:14-16`). |
| **Otomatik Güncelleme Kontrolü** | `https://download.readest.com/releases/latest.json`, `github.com/readest/readest/.../latest.json`, `release-notes.json`, `nightly/latest.json` | Varsayılan `autoCheckUpdates: true` (24 saatte bir) — açılışta Kütüphane/Okuyucu ekranında otomatik sorgular (`constants.ts:235,1018-1042`, `library/page.tsx:507`, `reader/page.tsx:37`, `tauri.conf.json:257-258`). |
| **Her Bölüm Yüklemesinde Dış Font CDN'leri** | `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.jsdelivr.net` (`misans-webfont`), `cdnjs.cloudflare.com` (`lxgw-wenkai`), `storage.readest.com`, `db.onlinewebfonts.com` | **Her yeniden akışlı EPUB bölümü açılışında** `mountAdditionalFonts` tetiklenir (`FoliateViewer.tsx:671`, `src/styles/fonts.ts:9-190`, `tauri.conf.json:22-23`). |
| **Otomatik Word Lens / Demo İndirmeleri** | `https://cdn.readest.com/wordlens`, `cdn.readest.com/books/*.epub` | `wordLensAutoDownload` varsayılan `true` (`constants.ts:355`, `FoliateViewer.tsx:831-832`); web ilk açılışta demo kitap indirir (`useDemoBooks.ts:27-39`). |
| **Bulut, Ödeme, Auth, Çeviri & TTS** | `*.supabase.co`, `auth-cf.readest.com`, `web.readest.com`, `node.readest.com`, `*.cloudflarestorage.com`, `*.stripe.com`, `wss://api.msedgeservices.com`, DeepL/Google/Bing/Yandex/OpenAI/DeepSeek/OpenRouter/Gemini, Wikipedia/Wiktionary, Hardcover/Readwise/Notion/KOReader/Pagebound | Tam listeler `tauri.conf.json:19-25`, `capabilities/default.json:85-124`, `supabase.ts`, `edgeTTS.ts:23`, `readest.ts:19-38`. |
| **LAN Tarama & Sunucular** | LocalSend UDP multicast `224.0.0.167:53317`, TCP `53318-53327`, `/24` alt ağ taraması; Loopback HTTP proxy | Etkinleştirildiğinde tüm yerel `/24` ağını aktif tarar (`localsend/service.rs:34-35,120-179`, `localsend/commands.rs:157-172`). |
| **Discord Rich Presence** | Yerel Discord IPC (`1462683110612144348`) | Okunan kitap bilgisini yayınlar (`src-tauri/src/discord_rpc.rs:7,30-35`). |

---

## 3. Güvenlik Denetimi Özeti

### 3.1 Koodo Reader Güvenlik Bulguları
1. **[KRİTİK] Electron Ana Süreçte RCE (`eval`):** `resolveCustomVoicePlugin()` (`main.js:108-142,1203-1253`), istemciden gelen `script` ve `scriptSHA256` değerlerini birbirine karşı doğrulayıp doğrudan Node.js ana sürecinde `eval(script)` çalıştırır.
2. **[KRİTİK] Sınırsız Dosya Sistemi & Keyfi SQL Köprüsü:** `preload.js:202-254` ve `main.js:742-816,1660-1673,2000-2009`, renderer'a tam `fs` (`writeFileSync`, `rmSync`), sınırsız SQLite çalıştırma (`custom-database-command`) ve doğrulamasız `shell.openPath` sunar.
3. **[KRİTİK] Korumasız EPUB Iframe & Sıfır CSP:** `index.html:1-69` içinde CSP yoktur; `main.js:2455-2484` tüm HTTP yanıtlarına global `Access-Control-Allow-Origin: *` basar. `kookit.min.js` EPUB HTML'ini `DOMPurify` olmadan `doc.body.innerHTML` ile yazar ve `isAllowScript === "yes"` iken `sandbox` özniteliğini tamamen kaldırır -> aynı kök (same-origin) üzerinden `window.parent.electronAPI` ile tam RCE.
4. **[KRİTİK] İmzasız Oto-Güncelleme Çalıştırma:** `main.js:1010-1073` HTTP durum kodu veya imza/SHA-256 doğrulamadan `.exe` indirip `{ shell: true }` ile çalıştırır.
5. **[YÜKSEK] PowerShell Komut Enjeksiyonu:** `ocr-util.js:38` ve `biometric-util.js:27-28`, Unicode tırnakları (`\u2018`/`\u2019`) kaçırmayan `escapePsSingle` nedeniyle `-ExecutionPolicy Bypass` altında enjeksiyona açıktır.
6. **[YÜKSEK] Zip-Bomb Koruması Yok & Kırık Kimlik Bilgisi Şifreleme:** `yauzl`, `JSZip`, `fflate`, `backup-util.js` açma boyutu/oran sınırı uygulamaz. `main.js:1476-1501` `safeStorage`'dan çıkarak aynı dosyadaki düz metin `fingerPrint` ile basit XOR şifrelemesine düşürür; Web'de düz Base64 payload'lı HS256 JWT; AI/OPDS/kilit parolaları düz metin saklanır.
7. **[BAĞIMLILIKLAR]** EOL Electron `35.7.5`, geçişli `axios@0.27.2` (SSRF/CSRF CVE'leri), `form-data@2.3.3/4.0.0` (CVE-2025-7783), `qs@6.5.3/6.11.2`, ölü `request@2.88.x`, `crypto-js`, `rangy`, `jszip`, `discord-rpc`.

### 3.2 Readest Güvenlik Bulguları
1. **[KRİTİK] 6 Sözlük Sağlayıcısında Doğrudan Ana Uygulama DOM'unda Stored/Reflected XSS:** `bglProvider.ts:78`, `starDictProvider.ts:59`, `slobProvider.ts:39`, `mdictProvider.ts:682,723`, `wikipediaProvider.ts:52,67`, `wiktionaryProvider.ts:46,159` ham `innerHTML` kullanır; Tauri ana penceresinde `unsafe-inline` / `unsafe-eval` ve geniş IPC izinleri olduğu için tam istismara açıktır.
2. **[KRİTİK/YÜKSEK] EPUB Script Modunda Iframe Sandbox Yok & Zayıf CSP:** `allowScript: true` iken `DOMPurify` atlanır ve `iframe.contentWindow.eval()` çalıştırılır (`FoliateViewer.tsx:713-803`, `inlineEventHandlers.ts:15`); aynı origin nedeniyle `window.top.__TAURI_INTERNALS__` açıktır. `allowScript: false` iken dahi `sanitizer.ts:26-27,61-68` harici `http(s):` kaynaklara izin verir.
3. **[KRİTİK] Chromium CLI Flag Enjeksiyonu & İmzasız Stable Güncellemeler:** `spawn_fresh_browser.rs:110-128` URL doğrulaması veya `--` ayıracı olmadan `url`'i doğrudan tarayıcı argümanı geçirir. `UpdaterWindow.tsx:132-297` yalnızca nightly derlemelerde minisign doğrular; kararlı Windows Portable / Linux AppImage / Android APK güncellemelerini imzasız çalıştırır.
4. **[YÜKSEK] Linux CEF Sandbox Kapalı & IPC Scope Atlamaları:** `lib.rs:645-646` CEF sandbox'ı `Disabled` yapar. `localsend_send_files`, `epub_parser`, `mobi_parser`, `comic_parser`, `reveal_item_in_dir` ve `get_environment_variable` Tauri `fs_scope` kontrolünü atlar.
5. **[YÜKSEK] Düz Metin API Anahtarları ve Yedek Sızıntısı:** `$APPDATA/settings.json` içinde S3, WebDAV, OpenRouter/AI, Notion, Readwise, OPDS parolaları düz metin tutulur ve `backupService.ts:116-140` şifresiz yedekten `webdav.username`/`password` alanlarını temizlemeyi unutur.
6. **[BAĞIMLILIKLAR]** Bakımsız `cocoa 0.25` / `objc 0.2.7`, çift `reqwest`/`zip`, panic üreten `mobi 0.8`, statik `openssl-sys`, 60+ manuel `pnpm` CVE override yığını.

---

## 4. Lisans Uyumluluğu ve "Temiz Oda" (Clean-Room) Kararı

- **Her iki referans proje (`koodo-reader-dev` ve `readest-main`) AGPL-3.0 lisanslıdır.** AGPL-3.0 güçlü copyleft (ağ kullanımı dahil) şartı koşar; bu projelerden kod, stil dosyası, yerelleştirme veya mimari parça kopyalamak türev eseri zorunlu olarak AGPL-3.0'a bağlar.
- Ek olarak `koodo-reader-dev`, AGPL-3.0 lisansı altında olmasına rağmen kapalı kaynak `kookit*.min.*` ve kaynağı verilmeyen `public/lib/7z-wasm` (LGPL + unRAR kısıtı — GPLv3/AGPLv3 ile uyumsuz) ile lisans çelişkisi barındırmaktadır.
- **Karar:** **ESSVB-Reader %100 sıfırdan ("clean-room") yazılacaktır.** İki referans projeden tek satır kod, varlık veya yerelleştirme dosyası kopyalanmayacaktır. Yeni proje **MIT** lisansı ile yayımlanacak ve kullanılan tüm üçüncü parti açık kaynak paketler `THIRD_PARTY_LICENSES.md` içinde belgelenecektir.

---

## 5. Teknoloji Yığını Seçimi ve Gerekçesi

| Kriter | Electron (Koodo modeli) | Qt / C++ | **Tauri v2 + Rust + React/TS (Seçilen)** |
|---|---|---|---|
| **Saldırı Yüzeyi & Bellek Güvenliği** | Node.js runtime + Chromium tam paketi (~200+ MB ikili, yüksek CVE yüzeyi) | C++ bellek güvenliği riskleri, ağır QWebEngine (Chromium) veya özel HTML ayrıştırıcı ihtiyacı | **Rust bellek güvenli çekirdek**, sıfır Node.js çalışma zamanı, en az yetki ACL (`capabilities/default.json`), sıkı CSP |
| **Kurulum Boyutu & Kaynak Tüketimi** | ~100–220 MB kurulum, yüksek RAM | ~40–150 MB | **~8–25 MB** ikili/kurulum, yerel WebView2 (Win 11) ve WebKitGTK (Arch/CachyOS) kullanımı |
| **EPUB/ZIP Güvenliği** | JS motorunda yüksek RAM, zayıf IPC sınırı riski | C++ libzip/zlib riskleri | **Rust `zip` + `ammonia` HTML5 sanitizer**: tek byte taşma ve zip-slip/zip-bomb korumaları, sandbox iframe |
| **İşletim Sistemi Entegrasyonu** | PowerShell alt süreç ihtiyacı (enjekte edilebilir) | İyi ama çapraz derleme/WebEngine zorluğu | Doğrudan **WinRT `Windows.Media.SpeechSynthesis`** (Microsoft Tolga), **OS Keyring** (Credential Manager / libsecret), yerel **`rusqlite` (bundled)** |
| **Çapraz Platform Paketleme** | Win/Linux kolay ama ağır | Çoklu derleme karmaşık | Win 11 (`.msi`/`.exe` NSIS + portable `.zip`) ve CachyOS/Arch Linux (AppImage + `PKGBUILD`) tek kod tabanında |

**Sonuç:** **Tauri v2 (Rust) + React 19 + TypeScript + Vite** mimarisi; en küçük saldırı yüzeyi, bellek güvenli ZIP/EPUB/SQLite/TTS işlemleri, sıfır Node.js çalışma zamanı ve resmi Windows 11 + Arch Linux/CachyOS paketleme desteği nedeniyle seçilmiştir.
